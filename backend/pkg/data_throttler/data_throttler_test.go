package data_throttler

import (
	"runtime"
	"testing"
	"time"
)

// Every service map stream makes a throttler and reads its Ticker(); Stop
// must end the goroutine Ticker() starts.
func TestStopEndsTickerGoroutine(t *testing.T) {
	before := runtime.NumGoroutine()
	for i := range 100 {
		d, _ := New[int](time.Millisecond, 500)
		_ = d.Ticker()
		d.Push(i) // the goroutine has something to signal and nobody reads it
		time.Sleep(2 * time.Millisecond)
		d.Stop()
	}
	deadline := time.Now().Add(time.Second)
	for runtime.NumGoroutine()-before > 5 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if left := runtime.NumGoroutine() - before; left > 5 {
		t.Fatalf("%d goroutines left behind by 100 stopped throttlers", left)
	}
}

func TestStopWithoutTicker(t *testing.T) {
	d, _ := New[int](time.Millisecond, 500)
	d.Stop()
	d.Stop()
}
