package cors

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOnlyLoopbackOriginsAreAllowed(t *testing.T) {
	cs := WrapHandler(http.NotFoundHandler(), Options{})
	for origin, allowed := range map[string]bool{
		"http://localhost:8080": true,
		"http://127.0.0.1:8080": true,
		"http://[::1]:8080":     true,
		"https://evil.example":  false,
		"http://localhost.evil": false,
		"":                      false,
	} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/", nil)
		req.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		cs.WriteControlHeaders(w, req)
		if got := w.Header().Get("Access-Control-Allow-Origin"); (got == origin && origin != "") != allowed {
			t.Errorf("origin %q: Allow-Origin %q, allowed=%v", origin, got, allowed)
		}
	}
}
