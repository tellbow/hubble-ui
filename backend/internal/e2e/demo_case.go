package e2e

import (
	"log/slog"
	"time"

	"github.com/cilium/hubble-ui/backend/domain/events"
	"github.com/cilium/hubble-ui/backend/internal/mock/factories"
	"github.com/cilium/hubble-ui/backend/internal/mock/sources"
	ns_common "github.com/cilium/hubble-ui/backend/internal/ns_watcher/common"
	"github.com/cilium/hubble-ui/backend/pkg/rate_limiter"
)

// enableDemoCase serves the flows of e2e/fixtures/demo, the Playwright tests'
// cluster: a client calling an api, DNS and two hosts on the internet, one of
// them denied by policy, and a second namespace.
func (tc *TestsController) enableDemoCase() error {
	flowsLogFile, err := tc.openLogFile("demo", "flows.json.log")
	if err != nil {
		return err
	}

	nsSource := sources.Namespaces([]*ns_common.NSEvent{
		factories.CreateNSEvent(events.Added, "demo"),
		factories.CreateNSEvent(events.Added, "other"),
	})

	flowsSource := sources.LogFile(
		flowsLogFile,
		tc.log.With(slog.String("source", "demo-flows")),
		sources.LogFileSourceOpts{},
	)

	tc.clients.SetSource(sources.Combine(nsSource, flowsSource))
	tc.clients.SetFlowsRateLimit(rate_limiter.RateLimit{Limit: 1000, Period: time.Second})

	return nil
}
