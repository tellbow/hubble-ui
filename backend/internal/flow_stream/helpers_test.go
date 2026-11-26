package flow_stream

import (
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/cilium/hubble-ui/backend/proto/ui"
)

func TestExtractFlowsRequestKeepsTheUIsTimeRange(t *testing.T) {
	since := timestamppb.New(time.Now().Add(-5 * time.Minute))

	got := ExtractFlowsRequest(&ui.GetEventsRequest{Since: since}).GetSince()
	if !got.AsTime().Equal(since.AsTime()) {
		t.Fatalf("since = %v, want %v", got.AsTime(), since.AsTime())
	}

	if got := ExtractFlowsRequest(&ui.GetEventsRequest{}).GetSince(); got != nil {
		t.Fatalf("since = %v without a time range", got.AsTime())
	}
}
