package cors

import (
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/cilium/hubble-ui/backend/pkg/set"
)

type CORSServer struct {
	wrapped http.Handler
	opts    Options
}

type Options struct {
	Origin string
}

func WrapHandler(h http.Handler, opts Options) *CORSServer {
	srv := CORSServer{
		wrapped: h,
		opts:    opts,
	}

	return &srv
}

func (cs *CORSServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cs.WriteControlHeaders(w, r)
	cs.wrapped.ServeHTTP(w, r)
}

func (cs *CORSServer) HandlePreflight(w http.ResponseWriter, r *http.Request) {
	cs.WriteControlHeaders(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (cs *CORSServer) WriteControlHeaders(w http.ResponseWriter, r *http.Request) {
	origin := cs.getOrigin(w, r)
	if origin == "" {
		return
	}

	header := w.Header()
	header.Set("Access-Control-Allow-Origin", origin)
	header.Add("Vary", "Origin")
	header.Set("Access-Control-Allow-Methods", cs.getAllowMethods(w, r))
	header.Set("Access-Control-Allow-Credentials", "true")

	allowHeaders := cs.getAllowHeaders(w, r)
	if len(allowHeaders) > 0 {
		header.Set("Access-Control-Allow-Headers", allowHeaders)
	}
}

func (cs *CORSServer) getAllowMethods(w http.ResponseWriter, r *http.Request) string {
	requested := r.Header.Get("Access-Control-Request-Method")
	s := cs.makeSetFromHeaderValues(requested)

	// NOTE: Response headers seem to be prefilled by httprouter with that
	allowHeader := w.Header().Get("Allow")
	s.CopyFrom(cs.makeSetFromHeaderValues(allowHeader))

	s.Add("OPTIONS")
	return s.Join(",")
}

func (cs *CORSServer) getAllowHeaders(_ http.ResponseWriter, r *http.Request) string {
	requested := r.Header.Get("Access-Control-Request-Headers")

	s := cs.makeSetFromHeaderValues(requested)
	s.Add("content-type", "content-length")

	return s.Join(",")
}

func (cs *CORSServer) getOrigin(_ http.ResponseWriter, r *http.Request) string {
	if len(cs.opts.Origin) > 0 {
		return cs.opts.Origin
	}

	// NOTE: CORS is for a frontend dev server on this machine. Echoing any
	// origin would let every website read the cluster's flows.
	requesterOrigin := r.Header.Get("Origin")
	if u, err := url.Parse(requesterOrigin); err == nil && isLoopback(u.Hostname()) {
		return requesterOrigin
	}

	return ""
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}

	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (cs *CORSServer) makeSetFromHeaderValues(v string) set.Set[string] {
	s := set.Set[string]{}

	for _, p := range strings.Split(v, ",") {
		p = strings.TrimSpace(p)
		if len(p) == 0 {
			continue
		}

		s.Add(p)
	}

	return s
}
