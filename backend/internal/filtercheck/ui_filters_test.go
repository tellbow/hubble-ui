// Package filtercheck checks that the frontend's filters mean the same to
// hubble-relay as they do in the browser.
package filtercheck

import (
	"encoding/json"
	"log/slog"
	"os"
	"testing"

	"github.com/cilium/cilium/api/v1/flow"
	v1 "github.com/cilium/cilium/pkg/hubble/api/v1"
	"github.com/cilium/cilium/pkg/hubble/filters"
	"google.golang.org/protobuf/encoding/protojson"
)

// testdata/ui-filters.json is written by the frontend's
// src/domain/filtering/__tests__/fields.test.ts: the FlowFilters the UI sends
// for each case, and whether the browser keeps each flow.
type golden struct {
	Flows map[string]json.RawMessage `json:"flows"`
	Cases []struct {
		Name      string            `json:"name"`
		Whitelist []json.RawMessage `json:"whitelist"`
		Blacklist []json.RawMessage `json:"blacklist"`
		Expected  map[string]bool   `json:"expected"`
	} `json:"cases"`
}

func TestCiliumAgreesWithTheBrowser(t *testing.T) {
	raw, err := os.ReadFile("testdata/ui-filters.json")
	if err != nil {
		t.Fatal(err)
	}

	var g golden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}

	flows := map[string]*flow.Flow{}
	for name, j := range g.Flows {
		f := &flow.Flow{}
		if err := protojson.Unmarshal(j, f); err != nil {
			t.Fatalf("flow %s: %v", name, err)
		}
		flows[name] = f
	}

	build := func(t *testing.T, js []json.RawMessage) filters.FilterFuncs {
		ffs := make([]*flow.FlowFilter, 0, len(js))
		for _, j := range js {
			ff := &flow.FlowFilter{}
			if err := protojson.Unmarshal(j, ff); err != nil {
				t.Fatal(err)
			}
			ffs = append(ffs, ff)
		}

		fns, err := filters.BuildFilterList(t.Context(), ffs, filters.DefaultFilters(slog.Default()))
		if err != nil {
			t.Fatalf("relay would refuse the filter: %v", err)
		}
		return fns
	}

	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			wl, bl := build(t, c.Whitelist), build(t, c.Blacklist)
			for name, want := range c.Expected {
				got := filters.Apply(wl, bl, &v1.Event{Event: flows[name]})
				if got != want {
					t.Errorf("flow %s: relay keeps it: %v, the browser: %v", name, got, want)
				}
			}
		})
	}
}
