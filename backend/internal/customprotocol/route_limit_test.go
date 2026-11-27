package customprotocol

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	protobuf "google.golang.org/protobuf/proto"

	"github.com/cilium/hubble-ui/backend/internal/customprotocol/channel"
	"github.com/cilium/hubble-ui/backend/internal/customprotocol/router"
	"github.com/cilium/hubble-ui/backend/internal/customprotocol/utils"
	cppb "github.com/cilium/hubble-ui/backend/proto/customprotocol"
)

// Opening streams without end must not open relay streams without end.
func TestRouteRefusesChannelsOverTheCap(t *testing.T) {
	r, err := router.Builder().
		WithBaseContext(t.Context()).
		WithLogger(slog.New(slog.DiscardHandler)).
		WithChannelIdBytesNumber(8).
		WithTraceIdBytesNumber(8).
		WithRouteResumePollTimeout(time.Millisecond).
		WithClientPollDelays(50*time.Millisecond, 250*time.Millisecond).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	r.Route("blocking").Stream(func(ch *channel.Channel) error {
		<-ch.Closed()
		return nil
	})

	open := func() (int, string) {
		body, _ := protobuf.Marshal(&cppb.Message{Meta: &cppb.Meta{RouteName: "blocking"}, Body: &cppb.Body{}})
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/", bytes.NewReader(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		msg, err := utils.ParseMessageFromProtoBytes(w.Body.Bytes())
		if err != nil {
			t.Fatalf("answer is no message: %v", err)
		}
		if err := errors.Join(msg.Errors()...); err != nil {
			return w.Code, err.Error()
		}
		return w.Code, ""
	}

	for i := range 512 {
		if code, errs := open(); code != http.StatusOK || errs != "" {
			t.Fatalf("channel %d: HTTP %d %q", i, code, errs)
		}
	}
	code, errs := open()
	if code != http.StatusServiceUnavailable || !strings.Contains(errs, "too many open streams") {
		t.Fatalf("channel 513: HTTP %d %q, want 503 with an error", code, errs)
	}
}

func TestRouterRefusesHugeBodies(t *testing.T) {
	r, err := router.Builder().
		WithBaseContext(t.Context()).
		WithLogger(slog.New(slog.DiscardHandler)).
		WithChannelIdBytesNumber(8).
		WithTraceIdBytesNumber(8).
		WithRouteResumePollTimeout(time.Millisecond).
		WithClientPollDelays(50*time.Millisecond, 250*time.Millisecond).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	// A valid message, so only its size can make it fail.
	body, _ := protobuf.Marshal(&cppb.Message{Meta: &cppb.Meta{RouteName: "none"}, Body: &cppb.Body{Content: make([]byte, 2<<20)}})
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("2 MB body: HTTP %d, want 400", w.Code)
	}
}

type owner string

func (o owner) OwnerKey() string { return string(o) }

// With a login, a stream answers only the user who opened it, and one user
// cannot take every stream from the others.
func TestRouteKeepsStreamsToTheirOwner(t *testing.T) {
	r, err := router.Builder().
		WithBaseContext(t.Context()).
		WithLogger(slog.New(slog.DiscardHandler)).
		WithChannelIdBytesNumber(8).
		WithTraceIdBytesNumber(8).
		WithRouteResumePollTimeout(time.Millisecond).
		WithClientPollDelays(50*time.Millisecond, 250*time.Millisecond).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	r.Route("blocking").Stream(func(ch *channel.Channel) error {
		<-ch.Closed()
		return nil
	})

	poll := func(who owner, channelId string) (int, string) {
		body, _ := protobuf.Marshal(&cppb.Message{
			Meta: &cppb.Meta{RouteName: "blocking", ChannelId: channelId},
			Body: &cppb.Body{},
		})
		ctx := channel.WithOwner(t.Context(), who)
		req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/", bytes.NewReader(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		msg, err := utils.ParseMessageFromProtoBytes(w.Body.Bytes())
		if err != nil {
			t.Fatalf("answer is no message: %v", err)
		}
		return w.Code, msg.ChannelId()
	}

	code, ann := poll("ann", "")
	if code != http.StatusOK || ann == "" {
		t.Fatalf("ann opens a stream: HTTP %d, channel %q", code, ann)
	}

	if code, _ := poll("bob", ann); code != http.StatusForbidden {
		t.Errorf("bob polls ann's stream: HTTP %d, want 403", code)
	}

	if code, _ := poll("ann", ann); code != http.StatusOK {
		t.Errorf("ann polls her stream again: HTTP %d", code)
	}

	for i := 1; i < 32; i++ {
		if code, _ := poll("ann", ""); code != http.StatusOK {
			t.Fatalf("ann's stream %d: HTTP %d", i+1, code)
		}
	}

	if code, _ := poll("ann", ""); code != http.StatusServiceUnavailable {
		t.Errorf("ann's 33rd stream: HTTP %d, want 503", code)
	}

	if code, _ := poll("bob", ""); code != http.StatusOK {
		t.Errorf("bob opens a stream while ann holds 32: HTTP %d", code)
	}
}
