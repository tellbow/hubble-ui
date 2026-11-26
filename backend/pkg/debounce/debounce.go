package debounce

import (
	"time"
)

type Debounce struct {
	ticker *time.Timer
	delay  time.Duration
}

func New(delay time.Duration) *Debounce {
	return &Debounce{
		ticker: nil,
		delay:  delay,
	}
}

func (d *Debounce) Touch() {
	d.ensureTicker()

	if !d.ticker.Stop() {
		select {
		case <-d.ticker.C:
		default:
		}
	}

	d.ticker.Reset(d.delay)
}

func (d *Debounce) Triggered() <-chan time.Time {
	d.ensureTicker()
	return d.ticker.C
}

func (d *Debounce) Stop() {
	if d.ticker == nil {
		return
	}

	d.ticker.Stop()
}

// ensureTicker makes a stopped timer: the debounce stays idle until the first
// Touch, so Triggered never fires for a stream that had nothing to send.
func (d *Debounce) ensureTicker() {
	if d.ticker != nil {
		return
	}

	d.ticker = time.NewTimer(d.delay)
	d.ticker.Stop()
}
