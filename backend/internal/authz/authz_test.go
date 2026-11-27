package authz

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/cilium/cilium/api/v1/flow"
	v1 "github.com/cilium/cilium/pkg/hubble/api/v1"
	"github.com/cilium/cilium/pkg/hubble/filters"
	"google.golang.org/protobuf/proto"
	authorizationv1 "k8s.io/api/authorization/v1"

	"github.com/cilium/hubble-ui/backend/internal/auth"
)

// grants maps a user or group to the namespaces RBAC lets it see; "" is a
// ClusterRoleBinding.
type grants map[string][]string

func (g grants) review(calls *int, fail *bool) Review {
	return func(_ context.Context, sar *authorizationv1.SubjectAccessReview) (bool, error) {
		*calls++
		if *fail {
			return false, errors.New("API server down")
		}

		ra := sar.Spec.ResourceAttributes
		if ra.Group != Group || ra.Resource != Resource || ra.Verb != Verb {
			return false, nil
		}

		for _, who := range append([]string{sar.Spec.User}, sar.Spec.Groups...) {
			if slices.Contains(g[who], ra.Namespace) || slices.Contains(g[who], "") {
				return true, nil
			}
		}

		return false, nil
	}
}

var (
	ann   = &auth.Principal{Subject: "idp#ann", User: "oidc:ann", Groups: []string{"oidc:shop-devs"}}
	admin = &auth.Principal{Subject: "idp#root", User: "oidc:root", Groups: []string{"oidc:platform"}}
	rbac  = grants{"oidc:shop-devs": {"shop"}, "oidc:platform": {""}}
)

func cluster(context.Context) ([]string, error) {
	return []string{"billing", "payments", "shop"}, nil
}

func TestAnswersAreCachedAndFailuresDeny(t *testing.T) {
	calls, fail := 0, false
	a := New(slog.New(slog.DiscardHandler), rbac.review(&calls, &fail), cluster)
	now := time.Unix(0, 0)
	a.now = func() time.Time { return now }
	s := a.For(t.Context(), ann)

	if !s.Namespace("shop") || s.Namespace("payments") || s.All() {
		t.Fatal("ann sees shop only")
	}

	before := calls
	s.Namespace("shop")
	if calls != before {
		t.Error("asked again within a minute")
	}

	now = now.Add(allowedFor)
	fail = true
	if s.Namespace("shop") {
		t.Error("allowed while the API server fails")
	}

	before = calls
	s.Namespace("shop")
	if calls != before {
		t.Error("a failure was not remembered for a while")
	}

	now = now.Add(failedFor)
	fail = false
	if !s.Namespace("shop") {
		t.Error("not asked again after the API server came back")
	}

	if !a.For(t.Context(), admin).All() {
		t.Error("a ClusterRoleBinding covers every namespace")
	}
}

func ep(ns, pod string, labels ...string) *flow.Endpoint {
	return &flow.Endpoint{Namespace: ns, PodName: pod, Identity: 1000, Labels: labels}
}

func policy(ns, name string) *flow.Policy {
	return &flow.Policy{Namespace: ns, Name: name, Kind: "CiliumNetworkPolicy"}
}

func flowOf(src, dst *flow.Endpoint) *flow.Flow {
	return &flow.Flow{
		Source:           src,
		Destination:      dst,
		IP:               &flow.IP{Source: "10.0.0.1", Destination: "10.0.0.2"},
		SourceNames:      []string{"src.example"},
		DestinationNames: []string{"dst.example"},
		Summary:          "TCP Flags: SYN", //nolint:staticcheck // deprecated, still sent by older agents
		Ethernet:         &flow.Ethernet{Source: "aa:aa", Destination: "bb:bb"},
		EgressAllowedBy:  []*flow.Policy{policy(src.GetNamespace(), "egress")},
		IngressAllowedBy: []*flow.Policy{policy(dst.GetNamespace(), "ingress"), policy("", "cluster-wide")},
	}
}

func TestFlowShowsOnlyTheUsersNamespaces(t *testing.T) {
	calls, fail := 0, false
	a := New(slog.New(slog.DiscardHandler), rbac.review(&calls, &fail), cluster)
	s := a.For(t.Context(), ann)

	world := &flow.Endpoint{Identity: 2, Labels: []string{"reserved:world"}}
	host := &flow.Endpoint{Identity: 1, Labels: []string{"reserved:host"}}

	t.Run("both ends theirs", func(t *testing.T) {
		f := s.Flow(flowOf(ep("shop", "web"), ep("shop", "cart")))
		if f.GetDestination().GetPodName() != "cart" || f.GetIP().GetDestination() != "10.0.0.2" {
			t.Errorf("own flow changed: %v", f)
		}

		if f.GetIngressAllowedBy()[0].GetName() != "ingress" || f.GetIngressAllowedBy()[1].GetName() != "hidden" {
			t.Errorf("policies %v", f.GetIngressAllowedBy())
		}
	})

	t.Run("other namespace's end is hidden", func(t *testing.T) {
		in := flowOf(ep("shop", "web"), ep("payments", "api", "k8s:app=api"))
		f := s.Flow(in)
		d := f.GetDestination()
		if d.GetNamespace() != "" || d.GetPodName() != "" || len(d.GetLabels()) != 0 || d.GetIdentity() != 0 ||
			d.GetWorkloads()[0].GetName() != HiddenName {
			t.Errorf("destination shows: %v", d)
		}

		//nolint:staticcheck // Summary is deprecated, still sent by older agents
		if f.GetIP().GetDestination() != "" || f.GetDestinationNames() != nil || f.GetSummary() != "" || f.GetEthernet() != nil {
			t.Errorf("flow shows the destination: %v", f)
		}

		if f.GetSource().GetPodName() != "web" || f.GetIP().GetSource() != "10.0.0.1" {
			t.Errorf("own end changed: %v", f.GetSource())
		}

		if f.GetIngressAllowedBy()[0].GetName() != "hidden" || f.GetEgressAllowedBy()[0].GetName() != "egress" {
			t.Errorf("policies: egress %v ingress %v", f.GetEgressAllowedBy(), f.GetIngressAllowedBy())
		}

		if in.GetDestination().GetPodName() != "api" {
			t.Error("the flow given was changed, not a copy")
		}
	})

	t.Run("past the L7 proxy, the namespace is in the labels", func(t *testing.T) {
		own := ep("", "", "k8s:io.kubernetes.pod.namespace=shop")
		other := ep("", "", "k8s:io.kubernetes.pod.namespace=payments")
		if f := s.Flow(flowOf(own, other)); f == nil || f.GetDestination().GetWorkloads()[0].GetName() != HiddenName {
			t.Errorf("got %v", f)
		}

		if f := s.Flow(flowOf(other, other)); f != nil {
			t.Errorf("another namespace's flow shows: %v", f)
		}
	})

	t.Run("world and host stay as they are", func(t *testing.T) {
		if f := s.Flow(flowOf(ep("shop", "web"), world)); f == nil || f.GetIP().GetDestination() != "10.0.0.2" {
			t.Errorf("got %v", f)
		}

		if f := s.Flow(flowOf(host, world)); f != nil {
			t.Errorf("a flow outside any namespace shows: %v", f)
		}
	})

	t.Run("an admin sees flows unchanged", func(t *testing.T) {
		in := flowOf(ep("payments", "api"), ep("billing", "db"))
		if f := a.For(t.Context(), admin).Flow(in); !proto.Equal(f, in) {
			t.Errorf("got %v", f)
		}
	})

	if Everything.Flow(flowOf(host, world)) == nil {
		t.Error("without a login everything shows")
	}
}

// The user's own filters run on the flow as the user may see it: a filter on
// the hidden end matches nothing, so which flows come through says nothing
// about it.
func TestUserFiltersSeeOnlyWhatTheUserSees(t *testing.T) {
	calls, fail := 0, false
	s := New(slog.New(slog.DiscardHandler), rbac.review(&calls, &fail), cluster).For(t.Context(), ann)

	nss, err := s.Namespaces()
	if err != nil || !slices.Equal(nss, []string{"shop"}) {
		t.Fatalf("ann's namespaces: %v %v", nss, err)
	}

	// What relay is asked for: flows with an end in shop.
	relay, err := filters.BuildFilterList(t.Context(), FlowFilters(nss), filters.DefaultFilters(slog.New(slog.DiscardHandler)))
	if err != nil {
		t.Fatal(err)
	}

	toPayments := flowOf(ep("shop", "web"), ep("payments", "api", "k8s:app=api"))
	pastProxy := flowOf(ep("", "", "k8s:io.kubernetes.pod.namespace=shop"), ep("billing", "db"))
	elsewhere := flowOf(ep("payments", "api"), ep("billing", "db"))
	for name, f := range map[string]*flow.Flow{"to payments": toPayments, "past the proxy": pastProxy} {
		if !relay.MatchOne(&v1.Event{Event: f}) {
			t.Errorf("relay is not asked for a flow %s", name)
		}
	}

	if relay.MatchOne(&v1.Event{Event: elsewhere}) {
		t.Error("relay is asked for flows outside shop")
	}

	seen := s.Flow(toPayments)
	for _, user := range [][]*flow.FlowFilter{
		{{DestinationPod: []string{"payments/"}}},
		{{DestinationLabel: []string{"k8s:app=api"}}},
		{{DestinationIp: []string{"10.0.0.2"}}},
	} {
		wl, err := filters.BuildFilterList(t.Context(), user, filters.DefaultFilters(slog.New(slog.DiscardHandler)))
		if err != nil {
			t.Fatal(err)
		}

		if filters.Apply(wl, nil, &v1.Event{Event: seen}) {
			t.Errorf("filter %v matches the hidden end", user)
		}

		if !filters.Apply(nil, wl, &v1.Event{Event: seen}) {
			t.Errorf("filter %v, negated, drops the flow by its hidden end", user)
		}
	}
}
