package apiserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/julienschmidt/httprouter"

	"github.com/cilium/hubble-ui/backend/internal/api_clients"
	"github.com/cilium/hubble-ui/backend/internal/apiserver/cors"
	"github.com/cilium/hubble-ui/backend/internal/auth"
	"github.com/cilium/hubble-ui/backend/internal/authz"
	"github.com/cilium/hubble-ui/backend/internal/config"
	"github.com/cilium/hubble-ui/backend/internal/customprotocol/channel"
	"github.com/cilium/hubble-ui/backend/internal/customprotocol/router"
)

type APIServer struct {
	log *slog.Logger
	cfg *config.Config

	port              int
	rootRoute         string
	baseContext       context.Context
	clients           api_clients.APIClientsInterface
	handlerMiddleware HttpHandlerMiddleware

	instance *http.Server
	router   *router.Router

	activity activityCache

	// Both nil without a login configured.
	verifier   *auth.Verifier
	authorizer *authz.Authorizer
}

// Access turns on the login: every request needs a token verifier accepts,
// and sees what authorizer grants.
type Access struct {
	Verifier   *auth.Verifier
	Authorizer *authz.Authorizer
}

type HttpHandlerMiddleware = func(http.Handler) http.Handler

func New(
	//nolint:contextcheck
	bctx context.Context,
	log *slog.Logger,
	cfg *config.Config,
	port int,
	rootRoute string,
	clients api_clients.APIClientsInterface,
	handlerMiddleware HttpHandlerMiddleware,
	access *Access,
) (*APIServer, error) {
	if log == nil {
		return nil, nerr("log is nil")
	}

	if cfg == nil {
		return nil, nerr("cfg is nil")
	}

	if port == 0 {
		return nil, nerr("port cannot be equal to 0")
	}

	if len(rootRoute) == 0 {
		return nil, nerr("rootRoute is empty")
	}

	if clients == nil {
		return nil, nerr("clients is nil")
	}

	if bctx == nil {
		log.Warn("bctx is nil, default background context will be used")
		bctx = context.Background()
	}

	srv := &APIServer{
		log:               log,
		cfg:               cfg,
		port:              port,
		rootRoute:         rootRoute,
		baseContext:       bctx,
		clients:           clients,
		handlerMiddleware: handlerMiddleware,
	}

	if access != nil {
		if access.Verifier == nil || access.Authorizer == nil {
			return nil, nerr("access needs both a verifier and an authorizer")
		}

		srv.verifier, srv.authorizer = access.Verifier, access.Authorizer
	}

	if err := srv.prepareRoutes(); err != nil {
		return nil, err
	}

	return srv, nil
}

func (srv *APIServer) Listen() error {
	port := srv.port
	addr := fmt.Sprintf("0.0.0.0:%d", port)
	rootRoute := srv.rootRoute + "/:RouteName"

	mux := httprouter.New()
	mux.Handler(http.MethodPost, rootRoute, srv.router)

	var handler http.Handler = mux
	if srv.verifier != nil {
		// The principal owns the streams it opens: no one else may poll them.
		owned := handler
		handler = srv.verifier.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, _ := auth.PrincipalFrom(r.Context())
			owned.ServeHTTP(w, r.WithContext(channel.WithOwner(r.Context(), p)))
		}), srv.log)
	}

	if srv.cfg.CORSEnabled {
		corsServer := cors.WrapHandler(handler, cors.Options{})

		mux.GlobalOPTIONS = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			corsServer.HandlePreflight(w, r)
		})

		handler = corsServer
	}

	if srv.handlerMiddleware != nil {
		handler = srv.handlerMiddleware(handler)
	}

	srv.instance = &http.Server{
		Addr:    addr,
		Handler: handler,
		BaseContext: func(net.Listener) context.Context {
			return srv.baseContext
		},
		ReadHeaderTimeout: 5 * time.Second,
	}

	srv.log.Info("running ListenAndServe", "port", port, "apipath", srv.rootRoute)

	if err := srv.instance.ListenAndServe(); err != nil {
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}

		return err
	}

	return nil
}

func (srv *APIServer) Shutdown() error {
	if srv.instance == nil {
		return nil
	}

	return srv.instance.Shutdown(srv.baseContext)
}

func nerr(reason string) error {
	return fmt.Errorf("failed to create APIServer: %s", reason)
}

// scope is what the user who opened ch may see.
func (srv *APIServer) scope(ch *channel.Channel) (*authz.Scope, error) {
	if srv.authorizer == nil {
		return authz.Everything, nil
	}

	p, ok := ch.Owner().(*auth.Principal)
	if !ok || p == nil {
		return nil, errors.New("a stream without a signed-in user")
	}

	return srv.authorizer.For(ch.Context(), p), nil
}
