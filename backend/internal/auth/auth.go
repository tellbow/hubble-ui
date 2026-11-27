// Package auth checks who sends a request: an OIDC ID token, put into the
// Authorization header by a proxy in front (oauth2-proxy), is verified here
// rather than trusted, so that a request that bypasses the proxy gets nothing.
package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

type Config struct {
	IssuerURL string
	ClientID  string

	UsernameClaim string
	GroupsClaim   string

	// Prefixes keep names from the identity provider apart from Kubernetes'
	// own, as the API server's --oidc-*-prefix flags do: a group "system:masters"
	// from the provider must not become the real one.
	UsernamePrefix string
	GroupsPrefix   string
}

// Principal is a user the identity provider vouched for, named as
// Kubernetes RBAC names them.
type Principal struct {
	// issuer and subject together, which never change for one user
	Subject string
	User    string
	Groups  []string
}

// OwnerKey makes a Principal own the streams it opens.
func (p *Principal) OwnerKey() string {
	return p.Subject
}

type Verifier struct {
	cfg Config
	v   *oidc.IDTokenVerifier
}

// NewVerifier fetches the provider's discovery document and signing keys.
func NewVerifier(ctx context.Context, cfg Config) (*Verifier, error) {
	provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery for %q: %w", cfg.IssuerURL, err)
	}

	return &Verifier{cfg: cfg, v: provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})}, nil
}

// NewVerifierWithKeys checks signatures against fixed keys (tests).
func NewVerifierWithKeys(cfg Config, keys oidc.KeySet, algs []string) *Verifier {
	return &Verifier{cfg: cfg, v: oidc.NewVerifier(cfg.IssuerURL, keys, &oidc.Config{
		ClientID:             cfg.ClientID,
		SupportedSigningAlgs: algs,
	})}
}

// Verify checks the token's signature, issuer, audience and expiry, and
// reads the user and groups from it.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Principal, error) {
	tok, err := v.v.Verify(ctx, raw)
	if err != nil {
		return nil, err
	}

	var claims map[string]any
	if err := tok.Claims(&claims); err != nil {
		return nil, err
	}

	name, _ := claims[v.cfg.UsernameClaim].(string)
	if name == "" {
		return nil, fmt.Errorf("token has no %q claim", v.cfg.UsernameClaim)
	}

	// As the API server does: an address the provider has not verified
	// could belong to anyone.
	if v.cfg.UsernameClaim == "email" {
		if verified, _ := claims["email_verified"].(bool); !verified {
			return nil, errors.New("token's email is not verified")
		}
	}

	user, ok := v.prefixed(v.cfg.UsernamePrefix, name)
	if !ok {
		return nil, fmt.Errorf("user %q is reserved by Kubernetes", name)
	}

	p := &Principal{Subject: tok.Issuer + "#" + tok.Subject, User: user}
	for _, g := range groupsOf(claims[v.cfg.GroupsClaim]) {
		if g, ok := v.prefixed(v.cfg.GroupsPrefix, g); ok {
			p.Groups = append(p.Groups, g)
		}
	}

	return p, nil
}

func (v *Verifier) prefixed(prefix, name string) (string, bool) {
	name = prefix + name
	return name, !strings.HasPrefix(name, "system:")
}

// groupsOf takes a list of names or, as some providers send one, a single name.
func groupsOf(claim any) []string {
	switch c := claim.(type) {
	case string:
		return []string{c}
	case []any:
		gs := make([]string, 0, len(c))
		for _, g := range c {
			if s, ok := g.(string); ok && s != "" {
				gs = append(gs, s)
			}
		}

		return gs
	}

	return nil
}

type principalKey struct{}

// PrincipalFrom returns who sent the request, if Middleware checked it.
func PrincipalFrom(ctx context.Context) (*Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(*Principal)
	return p, ok
}

// WithPrincipal marks a request as coming from p.
func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// Middleware lets through requests with a valid token only. Each poll
// carries the token, so a stream ends once the session does.
func (v *Verifier) Middleware(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The session cookie goes along with requests other sites make;
		// browsers say when a request comes from one.
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "cross-site request", http.StatusForbidden)
			return
		}

		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || raw == "" {
			http.Error(w, "not signed in", http.StatusUnauthorized)
			return
		}

		p, err := v.Verify(r.Context(), raw)
		if err != nil {
			log.Info("rejecting a request's token", "error", err)
			http.Error(w, "not signed in", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}
