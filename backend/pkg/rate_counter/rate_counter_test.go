package rate_counter

import (
	"fmt"
	"math"
	"testing"
	"time"
)

type Test struct {
	countingFn   CountingFn
	countNum     int
	delay        time.Duration
	expectedRate float64
	eps          float64
}

// CountingFn counts on rc, letting time pass with wait.
type CountingFn func(rc *RateCounter, wait func(time.Duration))

func TestEverything(t *testing.T) {
	runTests(t, []Test{
		{
			countNum:     10,
			delay:        10 * time.Millisecond,
			expectedRate: 100,
			eps:          5,
		},
		{
			countNum:     10,
			delay:        100 * time.Millisecond,
			expectedRate: 10.0,
			eps:          1,
		},
		{
			countNum:     20,
			delay:        50 * time.Millisecond,
			expectedRate: 20.0,
			eps:          1,
		},
		{
			countNum:     10,
			delay:        10 * time.Millisecond,
			expectedRate: 100.0,
			eps:          5,
		},
		{
			countNum:     100,
			delay:        10 * time.Millisecond,
			expectedRate: 100.0,
			eps:          5,
		},
		{
			countNum:     5,
			delay:        20 * time.Millisecond,
			expectedRate: 50,
			eps:          5,
		},
		{
			countingFn: func(rc *RateCounter, wait func(time.Duration)) {
				for range 5 {
					rc.Count()

					wait(20 * time.Millisecond)
				}

				wait(100 * time.Millisecond)
			},
			expectedRate: 25,
			eps:          1,
		},
	})
}

func runTests(t *testing.T, tests []Test) {
	for _, test := range tests {
		test.Run(t)
	}
}

func (td *Test) Run(t *testing.T) {
	testName := fmt.Sprintf(
		"cnum %d / delay %s",
		td.countNum,
		td.delay,
	)

	if td.countingFn != nil {
		testName = "countingFn"
	}

	t.Run(testName, func(t *testing.T) {
		// A fake clock: sleeping made the rates depend on the OS's timers
		// (macOS oversleeps 10 ms sleeps by ~10%).
		now := time.Unix(0, 0)
		wait := func(d time.Duration) { now = now.Add(d) }

		rc := New()
		rc.now = func() time.Time { return now }
		if td.countingFn == nil {
			for range td.countNum {
				rc.Count()

				wait(td.delay)
			}
		} else {
			td.countingFn(rc, wait)
		}

		r := rc.Rate()
		t.Logf("rate: %.5f\n", r)
		if math.Abs(r-td.expectedRate) > td.eps {
			logInternal(t, rc)

			t.Fatalf(
				"got rate: %.5f, expected: %.5f\n",
				r,
				td.expectedRate,
			)
		}
	})
}

func logInternal(t *testing.T, rc *RateCounter) {
	// t.Logf(
	// 	"quants: %s\n",
	// 	rc.quants,
	// )
}

// Run with -race: polls of one channel count and read concurrently.
func TestConcurrentUse(t *testing.T) {
	rc := New()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 1000 {
			rc.Count()
		}
	}()
	for range 1000 {
		_ = rc.Rate()
		_ = rc.LastCount()
	}
	<-done
}
