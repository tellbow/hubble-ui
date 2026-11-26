package apiserver

import (
	"log/slog"
	"time"

	"github.com/cilium/hubble-ui/backend/internal/api_helpers"
	"github.com/cilium/hubble-ui/backend/internal/apiserver/notifications"
	"github.com/cilium/hubble-ui/backend/internal/apiserver/req_context"
	cp "github.com/cilium/hubble-ui/backend/internal/customprotocol"
	"github.com/cilium/hubble-ui/backend/internal/data_stash"
	"github.com/cilium/hubble-ui/backend/internal/hubble_client"
	"github.com/cilium/hubble-ui/backend/internal/ns_watcher"
	"github.com/cilium/hubble-ui/backend/internal/statuschecker"
	"github.com/cilium/hubble-ui/backend/pkg/debounce"
	dchannel "github.com/cilium/hubble-ui/backend/pkg/dynamic_channel"
	"github.com/cilium/hubble-ui/backend/proto/ui"
)

func (srv *APIServer) ControlStream(
	ch *cp.Channel, rctx *req_context.Context,
) error {
	log, ctx := rctx.Log, ch.Context()

	nsWatcher, err := srv.clients.NSWatcher(ctx, ns_watcher.NSWatcherOptions{
		Log: log.With(slog.String("component", "ControlStream.NSWatcher")),
	})
	if err != nil {
		return err
	}

	notifs := notifications.NewNotificationsState()
	isRelayColdStart := true

	relayClient := srv.clients.RelayClient()
	connSub := relayClient.ConnStatusChannel()
	defer connSub.Drop()

	relayConnChannel, channelReader := dchannel.AsOutputChannel(connSub.Datum)
	go channelReader(ctx)

	statusOpts := hubble_client.StatusCheckerOptions{
		Delay: 5 * time.Second,
		Log:   log,
	}
	statusChecker, err := relayClient.ServerStatusChecker(statusOpts)
	if err != nil {
		return err
	}

	go statusChecker.Run(ctx)
	defer func() { statusChecker.Stop() }()

	// Set while a failed status checker waits to be replaced.
	var restartStatus <-chan time.Time

	go nsWatcher.Run(ctx)
	defer nsWatcher.Stop()

	dataStash := data_stash.New()
	nsDebounce := debounce.New(100 * time.Millisecond)

F:
	for {
		select {
		case <-ch.Shutdown():
			log.Info("control stream is shutting down")
			break F
		case <-ch.Closed():
			log.Info("channel is closed in control stream")
			break F
		case <-ctx.Done():
			break F
		case evt := <-nsWatcher.NSEvents():
			dataStash.PushNamespaceEvent(evt)
			log.Debug("pushing ns event")
			nsDebounce.Touch()
		case <-nsDebounce.Triggered():
			nss := dataStash.FlushNamespaces()
			nsResponse := responseFromNSEvents(nss)
			log.Debug("namespaces debounce triggered", "response", nsResponse, "len(nss)", len(nss))

			if err := ch.SendProto(nsResponse); err != nil {
				log.Error("failed to send NSWatcher response", "error", err)

				return err
			}
		case err := <-nsWatcher.Errors():
			// The informer retries by itself; the stream goes on.
			log.Error("ns watcher error", "error", err)
		case fullStatus := <-statusChecker.Statuses():
			evt := serverStatusResponse(fullStatus)

			if err := ch.SendProto(evt); err != nil {
				log.Error("failed to send server status notification", "error", err)
				return err
			}
		case err := <-statusChecker.Errors():
			// The relay's status is a notification: losing it must not end
			// the namespaces' stream, which the frontend opens only once.
			log.Error("status checker error, restarting it", "error", err)
			statusChecker.Stop()
			restartStatus = time.After(statusOpts.Delay)
		case <-restartStatus:
			restartStatus = nil
			if statusChecker, err = relayClient.ServerStatusChecker(statusOpts); err != nil {
				return err
			}

			go statusChecker.Run(ctx)
		case st := <-relayConnChannel:
			switch {
			case st.IsConnected():
				isRelayColdStart = false
				evt := notifs.ConnectedToRelay()
				if evt == nil {
					break
				}

				if err := ch.SendProto(evt.AsControlResponse()); err != nil {
					log.Error("failed to send relay state change notification",
						"state", "ConnectedToRelay",
						"error", err)

					return err
				}

			case st.IsConnecting():
				if isRelayColdStart {
					break
				}

				evt := notifs.ReconnectingToRelay()
				if evt == nil {
					break
				}

				// NOTE: We are here if someone is reconnecting to hubble-relay
				if err := ch.SendProto(evt.AsControlResponse()); err != nil {
					log.Error("failed to send relay state change notification",
						"state", "ReconnectingToRelay",
						"error", err)

					return err
				}

			}
		}
	}

	log.Info("control stream is stopped")
	return nil
}

func responseFromNSEvents(
	nsEvents []*ns_watcher.NSEvent,
) *ui.GetControlStreamResponse {
	nsStateChanges := make([]*ui.NamespaceState, len(nsEvents))

	for i, nsEvent := range nsEvents {
		nsStateChanges[i] = &ui.NamespaceState{
			Namespace: nsEvent.IntoDescriptor().IntoProto(),
			Type:      api_helpers.StateChangeFromEventKind(nsEvent.Event),
		}
	}

	return &ui.GetControlStreamResponse{
		Event: &ui.GetControlStreamResponse_Namespaces{
			Namespaces: &ui.GetControlStreamResponse_NamespaceStates{
				Namespaces: nsStateChanges,
			},
		},
	}
}

func serverStatusResponse(
	fullStatus *statuschecker.FullStatus,
) *ui.GetControlStreamResponse {
	return &ui.GetControlStreamResponse{
		Event: &ui.GetControlStreamResponse_Notification{
			Notification: api_helpers.ServerStatusNotification(fullStatus),
		},
	}
}
