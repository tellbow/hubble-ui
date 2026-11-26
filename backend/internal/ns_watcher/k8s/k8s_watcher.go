package k8s

import (
	"context"
	"log/slog"
	"sync"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"

	"github.com/cilium/hubble-ui/backend/domain/events"
	"github.com/cilium/hubble-ui/backend/internal/ns_watcher/common"
)

type Watcher struct {
	log *slog.Logger
	k8s kubernetes.Interface

	nsEvents chan *common.NSEvent
	errors   chan error
	stop     chan struct{}
	stopOnce sync.Once
}

func New(log *slog.Logger, k8s kubernetes.Interface) *Watcher {
	w := new(Watcher)
	w.log = log
	w.nsEvents = make(chan *common.NSEvent)
	w.errors = make(chan error)
	w.stop = make(chan struct{})
	w.stopOnce = sync.Once{}
	w.k8s = k8s

	return w
}

func NewDumb() *Watcher {
	return new(Watcher)
}

func (w *Watcher) handlers(ctx context.Context) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj any) {
			w.handleNSAddition(ctx, obj)
		},
		UpdateFunc: func(_, obj any) {
			if obj.(*v1.Namespace).Status.Phase == v1.NamespaceTerminating {
				w.handleNSDeletion(ctx, obj)
				return
			}

			w.handleNSUpdate(ctx, obj)
		},
		DeleteFunc: func(obj any) {
			// A namespace deleted while the watch was down comes from the relist.
			if gone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				obj = gone.Obj
			}

			if _, ok := obj.(*v1.Namespace); ok {
				w.handleNSDeletion(ctx, obj)
			}
		},
	}
}

func (w *Watcher) handleNSAddition(ctx context.Context, obj interface{}) {
	e := common.EventFromNSObject(events.Added, obj)
	w.sendNSEvent(ctx, e)
}

func (w *Watcher) handleNSUpdate(ctx context.Context, upd interface{}) {
	// Before deletion, ns updated to Terminating phase
	if upd.(*v1.Namespace).Status.Phase != v1.NamespaceActive {
		return
	}

	e := common.EventFromNSObject(events.Modified, upd)
	w.sendNSEvent(ctx, e)
}

func (w *Watcher) handleNSDeletion(ctx context.Context, obj interface{}) {
	e := common.EventFromNSObject(events.Deleted, obj)
	w.sendNSEvent(ctx, e)
}

func (w *Watcher) Run(ctx context.Context) {
	restClient := w.k8s.CoreV1().RESTClient()
	nsWatcher := cache.NewListWatchFromClient(
		restClient,
		"namespaces",
		v1.NamespaceAll,
		fields.Everything(),
	)

	// The informer keeps the namespaces it has seen, so a relist after a
	// watch error reports the ones deleted meanwhile. List and watch errors
	// are logged and retried by the reflector; they don't end the stream.
	_, controller := cache.NewInformerWithOptions(cache.InformerOptions{
		ListerWatcher: nsWatcher,
		ObjectType:    &v1.Namespace{},
		Handler:       w.handlers(ctx),
	})

	w.log.Info("watcher is running")
	controller.Run(w.stop)
}

func (w *Watcher) Stop() {
	w.stopOnce.Do(func() {
		if w.stop == nil {
			return
		}

		close(w.stop)
	})

	w.log.Info("watcher is stopped")
}

// Errors never yields: the reflector retries list and watch errors itself.
func (w *Watcher) Errors() chan error {
	return w.errors
}

func (w *Watcher) NSEvents() chan *common.NSEvent {
	return w.nsEvents
}

func (w *Watcher) sendNSEvent(ctx context.Context, nse *common.NSEvent) {
	select {
	case <-ctx.Done():
	case <-w.stop:
	case w.NSEvents() <- nse:
	}
}
