package apiserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	pb_flow "github.com/cilium/cilium/api/v1/flow"
	"github.com/cilium/cilium/pkg/hubble/filters"
	"github.com/cilium/hubble-ui/backend/proto/ui"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/cilium/hubble-ui/backend/domain/cache"
	"github.com/cilium/hubble-ui/backend/domain/flow"
	"github.com/cilium/hubble-ui/backend/domain/link"
	"github.com/cilium/hubble-ui/backend/domain/service"
	"github.com/cilium/hubble-ui/backend/pkg/data_throttler"
	grpc_errors "github.com/cilium/hubble-ui/backend/pkg/grpc_utils/errors"

	"github.com/cilium/hubble-ui/backend/internal/api_helpers"
	"github.com/cilium/hubble-ui/backend/internal/apiserver/req_context"
	cp "github.com/cilium/hubble-ui/backend/internal/customprotocol"
	"github.com/cilium/hubble-ui/backend/internal/flow_stream"
	"github.com/cilium/hubble-ui/backend/internal/hubble_client"
	"github.com/cilium/hubble-ui/backend/internal/msg"
	"github.com/cilium/hubble-ui/backend/internal/statuschecker"
)

func (srv *APIServer) ServiceMapStream(
	ch *cp.Channel, rctx *req_context.Context,
) error {
	log, ctx := rctx.Log, rctx.Context()

	firstMsg, err := ch.ReceiveNonblock()
	if err != nil {
		return err
	}

	req := new(ui.GetEventsRequest)
	if err := firstMsg.DeserializeProtoBody(req); err != nil {
		return err
	}

	log.Info("GetEventsRequest parsed", "req", req)

	if len(req.GetEventTypes()) == 0 {
		log.Info("Requested events are empty, terminating...")
		return ch.TerminateStatus(http.StatusBadRequest)
	}

	// hubble-relay only logs a filter its nodes reject and ends the stream as
	// if no flows were left, so the UI would reconnect forever without saying
	// why. Cilium's own check, run here first, gives the error.
	if err := checkFilters(ctx, log, req); err != nil {
		log.Warn("rejecting invalid flow filters", "error", err)
		return err
	}

	relayClient := srv.clients.RelayClient()

	eventsRequested := api_helpers.GetFlagsWhichEventsRequested(req.GetEventTypes())
	dcache := cache.New()

	// NOTE: just flush buffered flows each 500ms
	flows, err := data_throttler.New[*pb_flow.Flow](50*time.Millisecond, 500)
	if err != nil {
		return err
	}
	defer flows.Stop()

	var flowStream flow_stream.FlowStreamInterface
	if eventsRequested.FlowsRequired() {
		flowStream = relayClient.FlowStream()

		go flowStream.Run(ctx, flow_stream.ExtractFlowsRequest(req))
		defer flowStream.Stop()
	} else {
		flowStream = flow_stream.NewDumb()
	}

	var statusChecker statuschecker.ServerStatusCheckerInterface
	statusChecker = statuschecker.NewDumb()
	if eventsRequested.Status {
		statusChecker, err = relayClient.ServerStatusChecker(hubble_client.StatusCheckerOptions{
			Delay: 5 * time.Second,
			Log:   log,
		})

		if err != nil {
			log.Error(msg.HubbleStatusCriticalError, "error", err)
			return err
		}

		go statusChecker.Run(ctx)
		defer statusChecker.Stop()
	}

	flushFlows := func() error {
		// NOTE: take links and services from flow
		wflows := flow.Wrap(flows.Flush())
		var svcs []cache.Result[*service.Service]
		var links []cache.Result[*link.Link]

		if eventsRequested.Services {
			svcs = dcache.UpsertServicesFromFlows(wflows)
		}

		if eventsRequested.ServiceLinks {
			links = dcache.UpsertLinksFromFlows(wflows)
		}

		resp := api_helpers.EventResponseFromEverything(
			wflows,
			links,
			svcs,
		)

		return ch.SendProto(resp)
	}

F:
	for {
		select {
		case <-ctx.Done():
			break F
		case <-ch.Closed():
			break F
		case <-ch.Shutdown():
			break F
		case err := <-flowStream.Errors():
			log.Warn("error from FlowStream", "error", err)
			if !grpc_errors.IsRecoverable(err) {
				log.Error("error from FlowStream is unrecoverable", "error", err)

				return err
			}
		case <-flowStream.Stopped():
			return errors.New("FlowStream has been stopped")
		case err := <-statusChecker.Errors():
			if !grpc_errors.IsRecoverable(err) {
				log.Error("hubble status checker: unrecoverable error", "error", err)

				return err
			}

			log.Error("hubble status checker: failed to connect to hubble-relay", "error", err)
		case <-flows.Ticker():
			if err := flushFlows(); err != nil {
				return err
			}
		case pbFlow := <-flowStream.Flows():
			if isAdded := flows.Push(pbFlow); isAdded {
				break
			}

			err := flushFlows()
			if err != nil {
				return err
			}

			flows.Push(pbFlow)
		case fullStatus := <-statusChecker.Statuses():
			statusEvent := api_helpers.EventResponseFromServerStatus(fullStatus)

			if err := ch.SendProto(statusEvent); err != nil {
				log.Error("failed to send hubble status update", "error", err)
				return err
			}
		}
	}

	log.Info("stream is closed")
	return nil
}

func checkFilters(ctx context.Context, log *slog.Logger, req *ui.GetEventsRequest) error {
	fr := flow_stream.ExtractFlowsRequest(req)
	for _, ff := range [][]*pb_flow.FlowFilter{fr.GetWhitelist(), fr.GetBlacklist()} {
		if _, err := filters.BuildFilterList(ctx, ff, filters.DefaultFilters(log)); err != nil {
			return status.Error(codes.InvalidArgument, err.Error())
		}
	}

	return nil
}
