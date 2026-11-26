package channel

import (
	"context"
	"testing"
	"time"

	"github.com/cilium/hubble-ui/backend/internal/customprotocol/timings"
)

func newTestChannel(t *testing.T) *Channel {
	t.Helper()
	rt, err := timings.RouterTimingsBuilder{}.
		WithMinClientPollDelay(200 * time.Millisecond).
		WithMaxClientPollDelay(5 * time.Second).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	ct, err := rt.ChannelTimings()
	if err != nil {
		t.Fatal(err)
	}
	ch, err := Builder().WithId("c").WithShutdownContext(context.Background()).WithTimings(ct).Build()
	if err != nil {
		t.Fatal(err)
	}
	return ch
}

func body(t *testing.T, ch *Channel, lastDatumId string) (string, string) {
	t.Helper()
	b, err := ch.DequeueOutgoingAcked(lastDatumId, 0)
	if err != nil {
		t.Fatal(err)
	}
	if b == nil {
		return "", ""
	}
	m, err := b.WithTraceId("t").WithRouteName("r").Build()
	if err != nil {
		t.Fatal(err)
	}
	return string(m.BodyBytes()), m.LastDatumId()
}

// A poll whose answer never reached the client is followed by one naming the
// same last message: it must get the lost answer again, not the next one.
func TestDequeueOutgoingAckedResendsLostAnswer(t *testing.T) {
	ch := newTestChannel(t)
	_ = ch.SendNonblock([]byte("a"))
	_ = ch.SendNonblock([]byte("b"))

	got, id := body(t, ch, "0")
	if got != "a" || id != "1" {
		t.Fatalf("first poll: %q id %q, want \"a\" id \"1\"", got, id)
	}
	// The answer is lost; the client retries with what it had.
	if got, id = body(t, ch, "0"); got != "a" || id != "1" {
		t.Fatalf("retried poll: %q id %q, want \"a\" again", got, id)
	}
	if got, id = body(t, ch, "1"); got != "b" || id != "2" {
		t.Fatalf("next poll: %q id %q, want \"b\" id \"2\"", got, id)
	}
	if got, _ = body(t, ch, "2"); got != "" {
		t.Fatalf("poll after the last message: %q, want nothing", got)
	}
}

// Clients that don't acknowledge get each message once.
func TestDequeueOutgoingAckedWithoutAcks(t *testing.T) {
	ch := newTestChannel(t)
	_ = ch.SendNonblock([]byte("a"))
	_ = ch.SendNonblock([]byte("b"))

	for _, want := range []string{"a", "b", ""} {
		if got, id := body(t, ch, ""); got != want || id != "" {
			t.Fatalf("got %q id %q, want %q without id", got, id, want)
		}
	}
}
