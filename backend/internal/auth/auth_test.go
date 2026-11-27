package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	jose "github.com/go-jose/go-jose/v4"
)

const issuer = "https://idp.example"

var cfg = Config{
	IssuerURL:      issuer,
	ClientID:       "hubble-ui",
	UsernameClaim:  "email",
	GroupsClaim:    "groups",
	UsernamePrefix: "oidc:",
	GroupsPrefix:   "oidc:",
}

func newKey(t *testing.T) *rsa.PrivateKey {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	return k
}

func sign(t *testing.T, k *rsa.PrivateKey, claims map[string]any) string {
	s, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: k}, nil)
	if err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}

	jws, err := s.Sign(body)
	if err != nil {
		t.Fatal(err)
	}

	tok, err := jws.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}

	return tok
}

func claims(change func(map[string]any)) map[string]any {
	c := map[string]any{
		"iss":            issuer,
		"aud":            "hubble-ui",
		"sub":            "u-1",
		"exp":            time.Now().Add(time.Hour).Unix(),
		"iat":            time.Now().Unix(),
		"email":          "ann@example.com",
		"email_verified": true,
		"groups":         []string{"shop-devs", "system:masters"},
	}
	if change != nil {
		change(c)
	}

	return c
}

func TestVerify(t *testing.T) {
	key := newKey(t)
	v := NewVerifierWithKeys(cfg, &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&key.PublicKey}}, nil)

	p, err := v.Verify(t.Context(), sign(t, key, claims(nil)))
	if err != nil {
		t.Fatal(err)
	}

	if p.User != "oidc:ann@example.com" || p.Subject != issuer+"#u-1" {
		t.Errorf("got %+v", p)
	}

	// The provider's "system:masters" is not Kubernetes' own.
	if !slices.Equal(p.Groups, []string{"oidc:shop-devs", "oidc:system:masters"}) {
		t.Errorf("groups %v", p.Groups)
	}

	refused := map[string]string{
		"other key":           sign(t, newKey(t), claims(nil)),
		"expired":             sign(t, key, claims(func(c map[string]any) { c["exp"] = time.Now().Add(-time.Minute).Unix() })),
		"other audience":      sign(t, key, claims(func(c map[string]any) { c["aud"] = "grafana" })),
		"other issuer":        sign(t, key, claims(func(c map[string]any) { c["iss"] = "https://evil.example" })),
		"unverified email":    sign(t, key, claims(func(c map[string]any) { c["email_verified"] = false })),
		"no email_verified":   sign(t, key, claims(func(c map[string]any) { delete(c, "email_verified") })),
		"no username":         sign(t, key, claims(func(c map[string]any) { delete(c, "email") })),
		"unsigned (alg=none)": unsigned(claims(nil)),
		"garbage":             "a.b.c",
	}
	for name, tok := range refused {
		if p, err := v.Verify(t.Context(), tok); err == nil {
			t.Errorf("%s: accepted as %+v", name, p)
		}
	}
}

func unsigned(c map[string]any) string {
	enc := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}

		return base64.RawURLEncoding.EncodeToString(b)
	}

	return enc(map[string]string{"alg": "none", "typ": "JWT"}) + "." + enc(c) + "."
}

// Without a prefix, a provider's group named like one of Kubernetes' own is dropped.
func TestVerifyDropsReservedNamesWithoutPrefix(t *testing.T) {
	key := newKey(t)
	c := cfg
	c.UsernamePrefix, c.GroupsPrefix = "", ""
	v := NewVerifierWithKeys(c, &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&key.PublicKey}}, nil)

	p, err := v.Verify(t.Context(), sign(t, key, claims(nil)))
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(p.Groups, []string{"shop-devs"}) {
		t.Errorf("groups %v", p.Groups)
	}

	if _, err := v.Verify(t.Context(), sign(t, key, claims(func(c map[string]any) {
		c["email"] = "system:admin"
	}))); err == nil {
		t.Error("a user named system:admin was accepted")
	}
}

func TestMiddleware(t *testing.T) {
	key := newKey(t)
	v := NewVerifierWithKeys(cfg, &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&key.PublicKey}}, nil)
	h := v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := PrincipalFrom(r.Context())
		_, _ = io.WriteString(w, p.User)
	}), slog.New(slog.DiscardHandler))

	call := func(header map[string]string) (int, string) {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/x", nil)
		for k, v := range header {
			req.Header.Set(k, v)
		}

		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}

	good := "Bearer " + sign(t, key, claims(nil))
	if code, body := call(map[string]string{"Authorization": good}); code != http.StatusOK || body != "oidc:ann@example.com" {
		t.Errorf("valid token: %d %q", code, body)
	}

	if code, _ := call(nil); code != http.StatusUnauthorized {
		t.Errorf("no token: %d", code)
	}

	if code, _ := call(map[string]string{"Authorization": "Basic " + good[7:]}); code != http.StatusUnauthorized {
		t.Errorf("not a bearer token: %d", code)
	}

	if code, _ := call(map[string]string{"Authorization": good, "Sec-Fetch-Site": "cross-site"}); code != http.StatusForbidden {
		t.Errorf("cross-site: %d", code)
	}
}
