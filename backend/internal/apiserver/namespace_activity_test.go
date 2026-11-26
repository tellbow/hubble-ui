package apiserver

import (
	"testing"

	"github.com/cilium/cilium/api/v1/flow"
	"google.golang.org/protobuf/proto"

	"github.com/cilium/hubble-ui/backend/proto/ui"
)

func TestCountByNamespace(t *testing.T) {
	f := func(src, dst string, v flow.Verdict) *flow.Flow {
		return &flow.Flow{
			Verdict:     v,
			Source:      &flow.Endpoint{Namespace: src},
			Destination: &flow.Endpoint{Namespace: dst},
		}
	}

	got := countByNamespace([]*flow.Flow{
		f("demo", "demo", flow.Verdict_FORWARDED),
		f("demo", "", flow.Verdict_DROPPED), // to the world
		f("demo", "other", flow.Verdict_FORWARDED),
		f("", "other", flow.Verdict_DROPPED), // from the world
	})

	want := &ui.NamespaceActivity{
		FlowsCounted: 4,
		Namespaces: []*ui.NamespaceActivity_Entry{
			{Namespace: "demo", Flows: 3, Dropped: 1},
			{Namespace: "other", Flows: 2, Dropped: 1},
		},
	}

	if !proto.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
