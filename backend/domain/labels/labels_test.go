package labels

import "testing"

// Dual-stack clusters label world traffic world-ipv4 / world-ipv6.
func TestPropsIsWorld(t *testing.T) {
	for _, lbl := range []string{"reserved:world", "reserved:world-ipv4", "reserved:world-ipv6"} {
		if !Props([]string{lbl}).IsWorld {
			t.Errorf("%s is not world", lbl)
		}
	}
	if Props([]string{"reserved:host"}).IsWorld {
		t.Error("reserved:host is world")
	}
}
