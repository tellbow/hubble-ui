package data_stash

import (
	"testing"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/cilium/hubble-ui/backend/domain/events"
	"github.com/cilium/hubble-ui/backend/internal/ns_watcher/common"
)

// A namespace created and deleted within one debounce window (100 ms) must
// be flushed as Deleted, not as the first event.
func TestPushNamespaceEventAddThenDelete(t *testing.T) {
	ns := &v1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "short-lived"}}
	ds := New()
	ds.PushNamespaceEvent(common.EventFromNSObject(events.Added, ns))
	ds.PushNamespaceEvent(common.EventFromNSObject(events.Deleted, ns))
	got := ds.FlushNamespaces()
	if len(got) != 1 || got[0].Event != events.Deleted {
		t.Fatalf("flushed %v for a namespace that was added and then deleted, want Deleted", got[0].Event)
	}
}

// And the other way round: deleted and created again is Added.
func TestPushNamespaceEventDeleteThenAdd(t *testing.T) {
	ns := &v1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "recreated"}}
	ds := New()
	ds.PushNamespaceEvent(common.EventFromNSObject(events.Deleted, ns))
	ds.PushNamespaceEvent(common.EventFromNSObject(events.Added, ns))
	got := ds.FlushNamespaces()
	if len(got) != 1 || got[0].Event != events.Added {
		t.Fatalf("flushed %v for a namespace that was deleted and created again, want Added", got[0].Event)
	}
}
