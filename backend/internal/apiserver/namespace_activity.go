package apiserver

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/cilium/cilium/api/v1/flow"

	"github.com/cilium/hubble-ui/backend/internal/authz"
	cp "github.com/cilium/hubble-ui/backend/internal/customprotocol"
	"github.com/cilium/hubble-ui/backend/proto/ui"
)

// The overview counts relay's newest flows once per page load; page loads
// within activityMaxAge share one relay query.
const (
	activityFlows   = 10000
	activityMaxAge  = 30 * time.Second
	activityTimeout = 10 * time.Second
)

type activityCache struct {
	mu   sync.Mutex
	at   time.Time
	last *ui.NamespaceActivity
}

// namespaceActivity returns the counts at most activityMaxAge old.
func (srv *APIServer) namespaceActivity(ctx context.Context) (*ui.NamespaceActivity, error) {
	c := &srv.activity
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.last != nil && time.Since(c.at) < activityMaxAge {
		return c.last, nil
	}

	ctx, cancel := context.WithTimeout(ctx, activityTimeout)
	defer cancel()

	flows, err := srv.clients.RelayClient().RecentFlows(ctx, activityFlows)
	if err != nil {
		return nil, err
	}

	c.last, c.at = countByNamespace(flows), time.Now()
	return c.last, nil
}

// sendNamespaceActivity sends the counts to a control stream once: they are
// a snapshot for the welcome screen, not kept in sync.
func (srv *APIServer) sendNamespaceActivity(ch *cp.Channel, scope *authz.Scope, log *slog.Logger) {
	act, err := srv.namespaceActivity(ch.Context())
	if err != nil {
		log.Debug("namespace activity not available", "error", err)
		return
	}

	act = visibleActivity(act, scope)

	resp := &ui.GetControlStreamResponse{
		Event: &ui.GetControlStreamResponse_Activity{Activity: act},
	}
	_ = ch.SendProto(resp)
}

// countByNamespace counts each flow once for its source's namespace and once
// for its destination's, if that is another one.
func countByNamespace(flows []*flow.Flow) *ui.NamespaceActivity {
	byNs := map[string]*ui.NamespaceActivity_Entry{}
	count := func(ns string, f *flow.Flow) {
		if ns == "" {
			return
		}

		e := byNs[ns]
		if e == nil {
			e = &ui.NamespaceActivity_Entry{Namespace: ns}
			byNs[ns] = e
		}

		e.Flows++
		if f.GetVerdict() == flow.Verdict_DROPPED {
			e.Dropped++
		}
	}

	act := &ui.NamespaceActivity{}
	for _, f := range flows {
		act.FlowsCounted++

		src, dst := f.GetSource().GetNamespace(), f.GetDestination().GetNamespace()
		count(src, f)
		if dst != src {
			count(dst, f)
		}
	}

	entries := make([]*ui.NamespaceActivity_Entry, 0, len(byNs))
	for _, e := range byNs {
		entries = append(entries, e)
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].GetNamespace() < entries[j].GetNamespace()
	})

	act.Namespaces = entries
	return act
}

// visibleActivity keeps the counts of the namespaces scope covers; the
// cache is shared, so it is copied, not changed.
func visibleActivity(act *ui.NamespaceActivity, scope *authz.Scope) *ui.NamespaceActivity {
	if scope.All() {
		return act
	}

	out := &ui.NamespaceActivity{FlowsCounted: act.GetFlowsCounted()}
	for _, e := range act.GetNamespaces() {
		if scope.Namespace(e.GetNamespace()) {
			out.Namespaces = append(out.Namespaces, e)
		}
	}

	return out
}
