// Package authz decides which namespaces' flows a user may see, by asking
// Kubernetes RBAC: a RoleBinding to `get` the resource `flows` in the group
// `ui.hubble.tellbow.io` lets its subjects see that namespace, a
// ClusterRoleBinding every namespace and the whole cluster.
package authz

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/cilium/hubble-ui/backend/internal/auth"
)

const (
	Group    = "ui.hubble.tellbow.io"
	Resource = "flows"
	Verb     = "get"

	// A revoked binding stops showing flows after at most allowedFor.
	allowedFor = time.Minute
	// While the API server fails, deny, and ask again only after a while.
	failedFor = 5 * time.Second
	// Expired answers are swept once the cache holds this many.
	sweepAt = 10000
)

// Review asks the API server whether a SubjectAccessReview is allowed.
type Review func(context.Context, *authorizationv1.SubjectAccessReview) (bool, error)

// Namespaces lists the cluster's namespaces.
type Namespaces func(context.Context) ([]string, error)

type Authorizer struct {
	log        *slog.Logger
	review     Review
	namespaces Namespaces
	now        func() time.Time

	mu    sync.Mutex
	cache map[string]answer
}

type answer struct {
	allowed bool
	until   time.Time
}

func New(log *slog.Logger, review Review, namespaces Namespaces) *Authorizer {
	return &Authorizer{log: log, review: review, namespaces: namespaces, now: time.Now, cache: map[string]answer{}}
}

// KubernetesReview asks the API server; it needs `create` on
// subjectaccessreviews, not the right to impersonate anyone.
func KubernetesReview(k kubernetes.Interface) Review {
	return func(ctx context.Context, sar *authorizationv1.SubjectAccessReview) (bool, error) {
		res, err := k.AuthorizationV1().SubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
		if err != nil {
			return false, err
		}

		return res.Status.Allowed, nil
	}
}

// KubernetesNamespaces lists namespaces from the API server.
func KubernetesNamespaces(k kubernetes.Interface) Namespaces {
	return func(ctx context.Context) ([]string, error) {
		list, err := k.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, err
		}

		names := make([]string, 0, len(list.Items))
		for _, ns := range list.Items {
			names = append(names, ns.Name)
		}

		return names, nil
	}
}

// allowed says whether p may see namespace ns, or, for "", every namespace.
func (a *Authorizer) allowed(ctx context.Context, p *auth.Principal, ns string) bool {
	key := p.Subject + "\x00" + p.User + "\x00" + strings.Join(p.Groups, "\x00") + "\x00\x00" + ns
	now := a.now()

	a.mu.Lock()
	ans, ok := a.cache[key]
	a.mu.Unlock()
	if ok && now.Before(ans.until) {
		return ans.allowed
	}

	allowed, err := a.review(ctx, &authorizationv1.SubjectAccessReview{
		Spec: authorizationv1.SubjectAccessReviewSpec{
			User:   p.User,
			Groups: p.Groups,
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Namespace: ns,
				Verb:      Verb,
				Group:     Group,
				Resource:  Resource,
			},
		},
	})

	ans = answer{allowed: allowed && err == nil, until: now.Add(allowedFor)}
	if err != nil {
		a.log.Error("SubjectAccessReview failed, denying", "user", p.User, "namespace", ns, "error", err)
		ans.until = now.Add(failedFor)
	}

	a.mu.Lock()
	if len(a.cache) >= sweepAt {
		for k, v := range a.cache {
			if !now.Before(v.until) {
				delete(a.cache, k)
			}
		}
	}
	a.cache[key] = ans
	a.mu.Unlock()

	return ans.allowed
}

// Scope is what one request may see.
type Scope struct {
	ctx context.Context
	a   *Authorizer
	p   *auth.Principal
}

// Everything is the scope without a login configured.
var Everything = &Scope{}

// For returns p's scope; the requests it answers run under ctx.
func (a *Authorizer) For(ctx context.Context, p *auth.Principal) *Scope {
	return &Scope{ctx: ctx, a: a, p: p}
}

// All says whether the scope covers the whole cluster.
func (s *Scope) All() bool {
	return s.p == nil || s.a.allowed(s.ctx, s.p, "")
}

// Namespace says whether the scope covers namespace ns.
func (s *Scope) Namespace(ns string) bool {
	return s.All() || (ns != "" && s.a.allowed(s.ctx, s.p, ns))
}

// Namespaces lists the namespaces the scope covers, for a scope that does
// not cover everything.
func (s *Scope) Namespaces() ([]string, error) {
	all, err := s.a.namespaces(s.ctx)
	if err != nil {
		return nil, err
	}

	var mine []string
	for _, ns := range all {
		if s.Namespace(ns) {
			mine = append(mine, ns)
		}
	}

	return mine, nil
}

// User names who the scope is for, for logs.
func (s *Scope) User() string {
	if s.p == nil {
		return ""
	}

	return s.p.User
}
