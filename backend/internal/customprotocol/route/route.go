package route

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/cilium/hubble-ui/backend/internal/customprotocol/channel"
	"github.com/cilium/hubble-ui/backend/internal/customprotocol/message"
	"github.com/cilium/hubble-ui/backend/internal/customprotocol/timings"
)

type RouteKind string

// maxChannels caps the open channels of a route: every service map channel
// holds a hubble-relay stream, and anyone who reaches the UI can open them.
// With a login, one user may hold maxChannelsPerOwner of them, so that they
// cannot take all of them from the others (a tab holds one per route).
const (
	maxChannels         = 512
	maxChannelsPerOwner = 32
)

var (
	ErrTooManyChannels = errors.New("too many open streams, try again later")
	ErrNotOwner        = errors.New("this stream was opened by someone else")
)

// NOTE: There is no further division if stream is uni- or bidirectional
const (
	OneshotKind RouteKind = "oneshot"
	StreamKind  RouteKind = "stream"
)

type RouteHandler func(*channel.Channel) error
type RouteMiddleware func(*channel.Channel, *message.Message) (bool, error)

type Route struct {
	log         *slog.Logger
	kind        RouteKind
	name        string
	baseContext context.Context

	timings  *timings.RouterTimings
	channels *channel.Channels

	middlewares []channel.ChannelMiddleware
	handler     RouteHandler
}

func (r *Route) Poll(ctx context.Context, msg *message.Message) (
	*message.Message, error,
) {
	resume := r.resumeOneshot
	if r.isStream() {
		resume = r.resumeStream
	}

	resp, err := resume(ctx, msg)
	if errors.Is(err, ErrTooManyChannels) || errors.Is(err, ErrNotOwner) {
		code := http.StatusServiceUnavailable
		if errors.Is(err, ErrNotOwner) {
			code = http.StatusForbidden
		}

		r.log.Warn("refusing a channel", "error", err, "owner", channel.OwnerKey(channel.OwnerFrom(ctx)))

		return message.Builder().
			WithChannelId(msg.ChannelId()).
			WithTraceId(msg.TraceId()).
			WithRouteName(r.name).
			WithTerminated(true).
			WithNotReady(true).
			WithEmpty(true).
			WithError(err).
			WithStatusCode(code).
			Build()
	}

	return resp, err
}

// NOTE: In theory we can have all the cases how stream is working:
// * It sends outgoing messages but doesn't read incoming ones
// * It reads incoming messages but doesn't send anything back
// * It both reads incoming and sends outgoing messages
func (r *Route) resumeStream(
	ctx context.Context, msg *message.Message,
) (*message.Message, error) {
	ch, isNew, err := r.getChannel(ctx, msg)

	if err != nil {
		return nil, err
	}

	if err := ch.RunMiddlewares(msg.SetAsOpening(isNew)); err != nil {
		return nil, err
	}

	// NOTE: All other incoming messages are preserved
	if err = ch.EnqueueIncomingNonblock(msg); err != nil {
		// NOTE: ErrChannelClosed is critical only when route handler wants to use
		// closed channel
		if !errors.Is(err, channel.ErrChannelClosed) {
			return nil, err
		}
	}

	if isNew {
		go ch.AwaitHandler(channel.ChannelHandler(r.handler))
	}

	return r.pollChannel(ch, msg)
}

func (r *Route) resumeOneshot(
	ctx context.Context, msg *message.Message,
) (*message.Message, error) {
	ch, isNew, err := r.getChannel(ctx, msg)
	if err != nil {
		return nil, err
	}

	if err := ch.RunMiddlewares(msg.SetAsOpening(isNew)); err != nil {
		return nil, err
	}

	// NOTE: Only the first message is preserved
	if isNew {
		if err := ch.EnqueueIncomingNonblock(msg); err != nil {
			if !errors.Is(err, channel.ErrChannelClosed) {
				return nil, err
			}
		}

		go ch.AwaitHandler(channel.ChannelHandler(r.handler))
	}

	return r.pollChannel(ch, msg)
}

func (r *Route) pollChannel(
	ch *channel.Channel,
	msg *message.Message,
) (*message.Message, error) {
	var (
		respptr               *message.MessageBuilder
		err                   error
		outgoingExists        bool
		handlerWannaTerminate bool
	)

	if msg.IsTerminated() {
		r.log.Debug("client sent terminating message", msg.LogAttrs()...)

		ch.Close()
		r.dropChannel(ch)

		return ch.ResponseBuilder().
			WithTraceId(msg.TraceId()).
			WithRouteName(r.name).
			WithTerminated(true).
			WithStatusCode(http.StatusOK).
			Build()
	}

	respptr, err = ch.DequeueOutgoingAcked(msg.LastDatumId(), r.timings.RouteResumePollTimeout)

	outgoingExists = respptr != nil
	handlerWannaTerminate = respptr != nil && respptr.IsTerminated()

	isTerminated, handlerErr := ch.TerminationStatus()
	if respptr == nil {
		b := ch.ResponseBuilder()
		respptr = &b
	}

	terminatedFlag := isTerminated || handlerWannaTerminate
	// NOTE: If termination error occurred, let user poll outgoing message first
	// and that error in the second poll request
	isEmpty := ch.HasNoOutgoingMessages() && handlerErr == nil

	logAttrs := []any{
		"isTerminated", terminatedFlag,
		"handlerWannaTerminate", handlerWannaTerminate,
		"handlerErr", handlerErr,
		"isEmpty", isEmpty,
		"outgoingExists", outgoingExists,
		"respptr.IsNotReady", respptr.IsPoll(),
	}

	cookies := ch.PopPriorityData()

	resp := respptr.
		WithTraceId(msg.TraceId()).
		WithChannelId(ch.Id).
		WithTerminated(terminatedFlag).
		WithRouteName(r.name).
		WithNotReady(respptr.IsPoll() || !outgoingExists).
		WithStatusCodePtr(respptr.StatusCode()).
		WithEmpty(isEmpty).
		WithResponseCookies(cookies)

		// NOTE: Termination error will only be sent if there is no produced msg
	if handlerErr != nil && !outgoingExists {
		if !errors.Is(handlerErr, channel.ErrChannelClosed) {
			// NOTE: Since the error is about to be sent, mark channel as empty
			resp = resp.WithError(handlerErr).WithEmpty(true)
			logAttrs = append(logAttrs, "resp.isEmpty", true)
		}
	}

	switch {
	case errors.Is(err, context.Canceled):
		r.log.Debug("context cancelled", append(logAttrs, "error", err)...)
		return nil, context.Canceled
	case errors.Is(err, context.DeadlineExceeded):
		resp = resp.WithNotReady(true)
	case errors.Is(err, channel.ErrChannelClosed):
		resp = resp.WithTerminated(true)
	case err != nil:
		resp = resp.WithNotReady(true).WithTerminated(true).WithError(err)
	}

	logAttrs = append(logAttrs,
		"resp.isNotReady", resp.IsPoll(),
		"resp.isTerminated", resp.IsTerminated(),
		"resp.Errors", resp.Errors(),
		"size-of-resp.ResponseCookies", len(cookies))

	respMsg, err := resp.WithPollDelay(ch.GetClientPollDelay(outgoingExists)).Build()
	if respMsg != nil && respMsg.IsTerminated() && respMsg.IsEmpty() {
		r.log.Debug("closing and dropping channel", logAttrs...)

		ch.Close()
		r.dropChannel(ch)
	}

	// NOTE: Every incoming message participates in incrementing incoming rate
	// counter. This call does the same job but for outgoings rate counter.
	if respMsg.IsPoll() {
		ch.CountOutgoing()
	}

	return respMsg, err
}

// NOTE: This is a main method that maps message to corresponding Channel
// TODO: Make channels map thread safe
func (r *Route) getChannel(ctx context.Context, msg *message.Message) (
	*channel.Channel, bool, error,
) {
	r.channels.Lock()
	defer r.channels.Unlock()

	owner := channel.OwnerFrom(ctx)
	key := channel.OwnerKey(owner)

	cid := msg.ChannelId()
	existing, ok := r.channels.GetByIdUnsafe(cid)
	if ok {
		if channel.OwnerKey(existing.Owner()) != key {
			return nil, false, ErrNotOwner
		}

		return existing, false, nil
	}

	if r.channels.SizeUnsafe() >= maxChannels {
		return nil, false, ErrTooManyChannels
	}

	if key != "" && r.channels.CountOwnedUnsafe(key) >= maxChannelsPerOwner {
		return nil, false, ErrTooManyChannels
	}

	chTimings, err := r.timings.ChannelTimings()
	if err != nil {
		return nil, false, err
	}

	newch, err := channel.Builder().
		WithId(cid).
		WithShutdownContext(r.baseContext). //nolint:contextcheck // a stream outlives the request that opens it
		WithTimings(chTimings).
		WithMiddlewares(r.cloneMiddlewares()).
		WithOwner(owner).
		Build()

	if err != nil {
		return nil, false, err
	}

	r.channels.SetByIdUnsafe(newch)
	return newch, true, nil
}

func (r *Route) cloneMiddlewares() []channel.ChannelMiddleware {
	mws := make([]channel.ChannelMiddleware, 0, len(r.middlewares))

	for _, mw := range r.middlewares {
		mws = append(mws, mw.Clone())
	}

	return mws
}

func (r *Route) dropChannel(ch *channel.Channel) {
	r.channels.Drop(ch)
}

func (r *Route) Middlewares(mws []channel.ChannelMiddleware) *Route {
	r.middlewares = mws
	return r
}

func (r *Route) Oneshot(h RouteHandler) *Route {
	r.kind = OneshotKind
	r.handler = h

	return r
}

func (r *Route) Stream(h RouteHandler) *Route {
	r.kind = StreamKind
	r.handler = h

	return r
}

func (r *Route) CloseAndDropStaleChannels(past time.Duration) uint {
	return r.channels.CloseAndDropStale(past)
}

func (r *Route) isStream() bool {
	return r.kind == StreamKind
}
