package hubble_client

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"time"

	"github.com/cilium/cilium/api/v1/flow"
	"github.com/cilium/cilium/api/v1/observer"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/cilium/hubble-ui/backend/internal/flow_stream"
	"github.com/cilium/hubble-ui/backend/internal/statuschecker"
)

func (c *GRPCHubbleClient) FlowStream() flow_stream.FlowStreamInterface {
	// NOTE: Notice that we are not running GetFlowsHandle here. It is very
	// NOTE: important to pass c.Channels() inside, as it used to request and
	// NOTE: obtain connections (initially + after reconnections).
	getFlowsHandle, err := flow_stream.New(
		c.log.With(slog.String("component", "FlowStream")),
		c.ConnectionPool(),
		c.callPropsProvider,
	)

	if err != nil {
		c.log.Error("Failed to build FlowStream handle, panic", "error", err)
		panic(err.Error())
	}

	return getFlowsHandle
}

func (c *GRPCHubbleClient) ServerStatus(
	ctx context.Context,
) (*observer.ServerStatusResponse, error) {
	conn, err := c.GetStableConnection(ctx)
	if err != nil {
		return nil, err
	}

	obClient := observer.NewObserverClient(conn)
	return obClient.ServerStatus(ctx, &observer.ServerStatusRequest{}, c.callPropsProvider.CallOptions(ctx)...)
}

// RecentFlows returns relay's newest n flows, not followed, with only the
// fields the namespace overview counts.
func (c *GRPCHubbleClient) RecentFlows(ctx context.Context, n uint64) ([]*flow.Flow, error) {
	conn, err := c.GetStableConnection(ctx)
	if err != nil {
		return nil, err
	}

	req := &observer.GetFlowsRequest{
		Number:    n,
		Whitelist: []*flow.FlowFilter{{Reply: []bool{false}}},
		FieldMask: &fieldmaskpb.FieldMask{
			Paths: []string{"time", "verdict", "source.namespace", "destination.namespace"},
		},
	}

	stream, err := observer.NewObserverClient(conn).
		GetFlows(ctx, req, c.callPropsProvider.CallOptions(ctx)...)
	if err != nil {
		return nil, err
	}

	flows := make([]*flow.Flow, 0, n)
	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return flows, nil
		}

		if err != nil {
			return nil, err
		}

		if f := resp.GetFlow(); f != nil {
			flows = append(flows, f)
		}
	}
}

func (c *GRPCHubbleClient) HubbleNodes(
	ctx context.Context,
) (*observer.GetNodesResponse, error) {
	conn, err := c.GetStableConnection(ctx)
	if err != nil {
		return nil, err
	}

	obClient := observer.NewObserverClient(conn)
	return obClient.GetNodes(ctx, &observer.GetNodesRequest{}, c.callPropsProvider.CallOptions(ctx)...)
}

type StatusCheckerOptions struct {
	Delay time.Duration
	Log   *slog.Logger
}

func (c *GRPCHubbleClient) ServerStatusChecker(opts StatusCheckerOptions) (
	statuschecker.ServerStatusCheckerInterface, error,
) {
	statusChecker, err := statuschecker.New(
		opts.Log.With(slog.String("component", "StatusChecker")),
		opts.Delay,
		c.ConnectionPool(),
		c.callPropsProvider,
	)

	if err != nil {
		return nil, err
	}

	return statusChecker, nil
}
