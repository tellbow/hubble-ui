package apiserver

import (
	"log/slog"
	"strings"
	"testing"

	pb_flow "github.com/cilium/cilium/api/v1/flow"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/cilium/hubble-ui/backend/proto/ui"
)

func eventsFiltering(httpPath string) *ui.GetEventsRequest {
	return &ui.GetEventsRequest{
		Whitelist: []*ui.EventFilter{{
			Filter: &ui.EventFilter_FlowFilter{FlowFilter: &pb_flow.FlowFilter{HttpPath: []string{httpPath}}},
		}},
	}
}

// hubble-relay ends the stream without an error on a filter its nodes
// reject, so the backend checks filters as the nodes do before asking it.
func TestCheckFiltersRejectsWhatCiliumRejects(t *testing.T) {
	if err := checkFilters(t.Context(), slog.Default(), eventsFiltering("^/api/")); err != nil {
		t.Fatalf("a valid filter was rejected: %v", err)
	}

	err := checkFilters(t.Context(), slog.Default(), eventsFiltering("(?=x)"))
	if status.Code(err) != codes.InvalidArgument || !strings.Contains(err.Error(), "invalid http path filter") {
		t.Fatalf("got %v, want InvalidArgument naming the http path filter", err)
	}
}
