package service

import (
	"testing"

	pbFlow "github.com/cilium/cilium/api/v1/flow"
)

// World peers of one identity share one card, whatever their DNS names, in
// single- and dual-stack clusters alike.
func TestWorldServiceIdIsItsIdentity(t *testing.T) {
	for _, lbl := range []string{"reserved:world", "reserved:world-ipv4"} {
		pod := &pbFlow.Endpoint{Identity: 1234, Labels: []string{"k8s:app=web"}}
		world := &pbFlow.Endpoint{Identity: 9, Labels: []string{lbl}}
		ids := map[string]bool{}
		for _, name := range []string{"api.example.com", "cdn.example.com"} {
			_, dst := IdsFromFlowProto(&pbFlow.Flow{Source: pod, Destination: world, DestinationNames: []string{name}})
			ids[dst] = true
		}
		if len(ids) != 1 || !ids["9"] {
			t.Errorf("%s: world service ids %v, want only \"9\"", lbl, ids)
		}
	}
}
