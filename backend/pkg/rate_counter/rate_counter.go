package rate_counter

import (
	"sync"
	"time"

	"github.com/cilium/hubble-ui/backend/pkg/ring_buffer"
)

// RateCounter is safe for concurrent use: polls of one channel count and
// read it from several goroutines.
type RateCounter struct {
	mx     sync.Mutex
	quants *ring_buffer.RingBuffer[int64]
}

func New() *RateCounter {
	return &RateCounter{
		quants: ring_buffer.New[int64](100),
	}
}

func (rc *RateCounter) Count() {
	rc.mx.Lock()
	defer rc.mx.Unlock()

	rc.quants.Push(time.Now().UnixNano())
}

func (rc *RateCounter) Rate() float64 {
	rc.mx.Lock()
	defer rc.mx.Unlock()

	now := time.Now().UnixNano()
	counter := float64(rc.quants.Size())

	if counter < 2 {
		return 0.0
	}

	first := rc.quants.GetFirst()
	timeNanos := float64(now - *first)

	return counter / timeNanos * 1e9
}

func (rc *RateCounter) LastCount() *time.Time {
	rc.mx.Lock()
	defer rc.mx.Unlock()

	last := rc.quants.GetLast()
	if last == nil {
		return nil
	}

	t := time.Unix(0, *last)
	return &t
}
