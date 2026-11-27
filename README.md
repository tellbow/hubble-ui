<h1 align="center">Hubble UI</h1>
<p align="center">
  Hubble UI is an open-source user interface for <a href="https://github.com/cilium/hubble">Cilium Hubble</a>.
</p>

This is tellbow's fork of [cilium/hubble-ui](https://github.com/cilium/hubble-ui),
maintained on its own: it builds, tests and publishes its images here, and takes
fixes from upstream as backports (see [Upstream](#-upstream)).

## ✨ What this fork adds

**Finding flows**

- A filter language with the flags of `hubble observe`, checked as you type
  and kept in the URL: `from-pod:frontend to-port:443 !label:app=db`
  ([Filtering flows](#filtering-flows)).
- A **Builder** mode that edits the same filters as rows, suggesting the values
  seen on screen.
- Click a value in the flow details (verdict, encrypted, direction, event type,
  port, pod, label, IP, DNS, …) to add or remove a filter for it.
- A **Sankey** view of who talks to whom on which port, next to the service map.

**Seeing more**

- A welcome screen that lists namespaces by their traffic; "All namespaces"
  with a box per namespace.
- The policies that allowed or denied a flow, its encryption status, and why a
  red arrow drops (click it for the dropped flows).
- One world card per identity, titled by its label.
- A time range, pause, CSV and Hubble JSON export, dark mode, phone-width layouts.

**Holding up**

- Streams that no longer get stuck, lose messages or leak, found by fault
  injection; the UI reopens them after a backend restart.
- Errors reach the screen: a filter Cilium rejects is reported once instead of
  reconnecting forever.
- Limits on open streams and request size; CORS from loopback only.

**Sharing it**

- Optional login through your OpenID Connect provider, with each user seeing
  only the namespaces Kubernetes RBAC grants them
  ([Login and access per namespace](#login-and-access-per-namespace)).
- Playwright tests in a real browser, and the filters golden-tested against
  Cilium's own filter code.

|               Filter builder                |           Sankey view            |                         Flow details                          |
| :-----------------------------------------: | :------------------------------: | :-----------------------------------------------------------: |
| ![Filter builder](promo/filter-builder.png) | ![Sankey view](promo/sankey.png) | ![Flow details with clickable values](promo/flow-details.png) |

## 🚀 Installation

Hubble UI is installed as part of Hubble. Please see the Hubble [Getting Started Guide](https://docs.cilium.io/en/stable/gettingstarted/hubble/#deploy-cilium-and-hubble) for instructions.

To run this fork's images, point Cilium's Helm chart at them:

```yaml
hubble:
  ui:
    enabled: true
    frontend:
      image:
        override: ghcr.io/tellbow/hubble-ui:<tag>
    backend:
      image:
        override: ghcr.io/tellbow/hubble-ui-backend:<tag>
```

Every push to `main` also publishes `ghcr.io/tellbow/hubble-ui-ci` and
`ghcr.io/tellbow/hubble-ui-backend-ci`, tagged `latest` and with the commit SHA.

### Compatibility

The namespace overview on the welcome screen asks hubble-relay for its newest
10,000 flows once per page load (page loads within 30 s share one answer). It
asks only for four fields of each flow with `GetFlowsRequest.field_mask`, which
Cilium 1.16 added. A relay from Cilium 1.15 or older ignores the mask and sends
whole flows: the counts stay right, but each answer is far larger (about 1–2 KB
per flow instead of under 100 bytes).

### Filtering flows

The filter input takes the flags of `hubble observe`, written `field:value`
and separated by spaces:

```
from-pod:frontend to-port:443,8443 !to-fqdn:*.example.com http-method:POST
```

- `from-` / `to-` pick the source or destination; without one, either matches.
- Different fields must all match (AND); comma-separated values of one field
  are alternatives (OR); `!` leaves out what matches.
- Fields: `label`, `pod` (`namespace/name`), `workload` (`Kind:name`),
  `identity`, `ip` (address or CIDR), `fqdn` (`*` wildcards), `port`,
  `protocol`, `http-method`, `http-path` (regular expression), `node-name`,
  `tcp-flags`, `encrypted` (`yes`/`no`), `traffic-direction`
  (`ingress`/`egress`), `event-type` (`to-proxy`, `to-endpoint`, …),
  `drop-reason` (`policy-denied`, …).

The filters are kept in the URL (`?filter=…`), so a link shows the same view.
**Builder** mode edits the same filters as rows of field, operator and values,
suggesting the values seen on screen. In the flow details, a value such as
Encrypted, Traffic direction or Destination port toggles a filter for it.

Hubble leaves the pod name out of some flows (packets delivered after the L7
proxy), so a `pod:` filter misses them; `label:app=…` catches them.

### Sankey view

Next to the service map, **Sankey** shows the requests as bands from source
through port to destination, as wide as their flow count and coloured by
verdict. Click a name to filter for it, Alt-click to filter it out.

### Login and access per namespace

Off by default. When it is on, everyone signs in with your OpenID Connect
provider and sees the flows of only the namespaces Kubernetes RBAC grants them:

- [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) runs next to
  the UI, handles the login and passes the user's ID token on to the backend.
- The backend checks that token itself (signature, issuer, audience, expiry,
  `email_verified`). It refuses requests without one, so a pod that bypasses
  oauth2-proxy and reaches the backend directly gets no flows.
- For each namespace it asks the API server (a SubjectAccessReview) whether the
  user or one of their groups may `get` the resource `flows` in the group
  `ui.hubble.tellbow.io` there. No such resource exists; it is a name for RBAC
  to grant. A ClusterRoleBinding grants every namespace and the whole cluster.
- Answers are cached for a minute, so a removed binding takes effect within a
  minute. If the API server fails, access is denied.
- A flow between one of the user's namespaces and another shows the other end
  as one card, **other-namespace**, without its pod, labels, IP, DNS names or
  namespace. Policies from other namespaces, and cluster-wide ones, show as
  `hidden`. Flows that do not touch the user's namespaces are dropped. The
  flow rate and node count at the top still count the whole cluster.
- A stream answers only the user who opened it, and one user can hold at most
  32 of them.

Users and groups reach RBAC as `oidc:<email>` and `oidc:<group>`, like the API
server's own `--oidc-username-prefix`, so a provider's group named
`system:masters` is not Kubernetes' own.

| Backend variable            | Default  | Meaning                                       |
| --------------------------- | -------- | --------------------------------------------- |
| `AUTH_ENABLED`              | `false`  | Require a login                               |
| `AUTH_OIDC_ISSUER_URL`      |          | Your provider's issuer, as in its ID tokens   |
| `AUTH_OIDC_CLIENT_ID`       |          | The client oauth2-proxy logs in as (audience) |
| `AUTH_OIDC_USERNAME_CLAIM`  | `email`  | Claim that names the user                     |
| `AUTH_OIDC_GROUPS_CLAIM`    | `groups` | Claim that lists the user's groups            |
| `AUTH_OIDC_USERNAME_PREFIX` | `oidc:`  | Put before the user's name for RBAC           |
| `AUTH_OIDC_GROUPS_PREFIX`   | `oidc:`  | Put before each group for RBAC                |

RBAC: the backend's service account may create SubjectAccessReviews, and a
team sees its namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: hubble-ui-subjectaccessreviews }
rules:
  - apiGroups: [authorization.k8s.io]
    resources: [subjectaccessreviews]
    verbs: [create]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: hubble-ui-subjectaccessreviews }
roleRef:
  { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: hubble-ui-subjectaccessreviews }
subjects: [{ kind: ServiceAccount, name: hubble-ui, namespace: kube-system }]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: hubble-ui-flows-viewer }
rules:
  - apiGroups: [ui.hubble.tellbow.io]
    resources: [flows]
    verbs: [get]
---
# The shop team sees the shop namespace. A ClusterRoleBinding instead shows everything.
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: hubble-ui-flows, namespace: shop }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: hubble-ui-flows-viewer }
subjects: [{ apiGroup: rbac.authorization.k8s.io, kind: Group, name: 'oidc:shop-devs' }]
```

oauth2-proxy runs as a sidecar of the `hubble-ui` Deployment, and the Service
points at it. Cilium's Helm chart has no option for a sidecar, so patch the
Deployment (with Kustomize or a post-renderer), for example:

```yaml
spec:
  template:
    spec:
      containers:
        - name: backend
          env:
            - { name: AUTH_ENABLED, value: 'true' }
            - { name: AUTH_OIDC_ISSUER_URL, value: https://idp.example.com }
            - { name: AUTH_OIDC_CLIENT_ID, value: hubble-ui }
        - name: oauth2-proxy
          image: quay.io/oauth2-proxy/oauth2-proxy:v7.15.6
          args:
            - --provider=oidc
            - --oidc-issuer-url=https://idp.example.com
            - --client-id=hubble-ui
            - --scope=openid email profile groups
            - --code-challenge-method=S256
            - --redirect-url=https://hubble.example.com/oauth2/callback
            - --email-domain=*
            - --http-address=0.0.0.0:4180
            - --upstream=http://127.0.0.1:8081
            # The backend checks the ID token itself.
            - --pass-authorization-header=true
            # Answer the API with 401 rather than a login redirect, so the UI says so.
            - --api-route=^/api/
            - --cookie-name=__Host-hubble-ui
            - --cookie-secure=true
            - --cookie-samesite=lax
            # Renew the ID token before it expires (needs a refresh token).
            - --cookie-refresh=5m
          env:
            - name: OAUTH2_PROXY_CLIENT_SECRET
              valueFrom: { secretKeyRef: { name: hubble-ui-oidc, key: client-secret } }
            - name: OAUTH2_PROXY_COOKIE_SECRET
              valueFrom: { secretKeyRef: { name: hubble-ui-oidc, key: cookie-secret } }
          ports: [{ name: oauth2-proxy, containerPort: 4180 }]
```

Set the `hubble-ui` Service's `targetPort` to `4180`. With
`hubble.ui.baseUrl` (say `/hubble/`), also set
`--proxy-prefix=/hubble/oauth2`, `--api-route=^/hubble/api/` and the
`--redirect-url` to `…/hubble/oauth2/callback`. The top bar then shows
who is signed in and a **Sign out** button. It ends the oauth2-proxy session;
to end the provider's session too, so the next visit asks for a password
again, add `--backend-logout-url` with your provider's logout endpoint, for example
`https://idp.example.com/logout?id_token_hint={id_token}` (oauth2-proxy fills
in `{id_token}`). Do not add
`--skip-auth-route` or `--skip-auth-regex`: anything they let through reaches
the UI without a login.

Then lock down hubble-relay. It answers anyone who reaches it with every flow
in the cluster, so a pod in a tenant's namespace could ask it directly. Let
only the UI in:

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: { name: hubble-relay-from-ui-only, namespace: kube-system }
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: hubble-relay }
  ingress:
    - fromEndpoints:
        - matchLabels:
            { app.kubernetes.io/name: hubble-ui, k8s:io.kubernetes.pod.namespace: kube-system }
```

Add any other in-cluster clients of the relay. The `hubble` CLI through
`kubectl port-forward` still works: a port-forward connects inside the pod,
past the policy, and needs RBAC for `pods/portforward` in `kube-system`. Keep
`hubble.tls.enabled` on, so the agents answer only the relay.

## 🌐 Why Hubble UI?

Troubleshooting microservices application connectivity is a challenging task. Simply looking at `kubectl get pods` does not indicate dependencies between each service, external APIs, or databases.

Hubble UI enables zero-effort automatic discovery of the service dependency graph for Kubernetes Clusters at L3/L4 and even L7, allowing user-friendly visualization and filtering of those dataflows as a Service Map.

See [Hubble Getting Started Guide](https://docs.cilium.io/en/stable/gettingstarted/hubble/#deploy-cilium-and-hubble) for details.

![Service Map](promo/servicemap.png)

## 🌏 Releases

Push a tag `vX.Y.Z` (or `vX.Y.Z-rcN`). The [Image Release Build](.github/workflows/images-releases.yaml)
workflow builds both images for amd64 and arm64 and pushes them to
`ghcr.io/tellbow/hubble-ui` and `ghcr.io/tellbow/hubble-ui-backend` with the
repository's `GITHUB_TOKEN`; no other account or secret is involved.

## 🧪 Tests

```sh
npm test                                    # frontend unit tests (jest)
(cd backend && go test -mod=vendor ./...)   # backend unit tests
npx playwright install chromium             # once
npm run test:e2e                            # Playwright, in a real browser
```

The Playwright tests need no cluster: they start the backend in its e2e mode,
which serves the flows of `e2e/fixtures/demo`, and the production build behind
`e2e/serve.mjs`, which proxies `/api` as nginx does.

## 🔁 Upstream

The fork keeps upstream's layout and the Go module path
`github.com/cilium/hubble-ui/backend` on purpose, so that upstream commits apply
without rewriting imports. To backport one:

```sh
git remote add upstream https://github.com/cilium/hubble-ui.git  # once
git fetch upstream
git switch -c backport/<topic> main
git cherry-pick -x <upstream-sha>   # -x records the upstream commit in the message
```

Open a pull request against `main` as for any change.

## ⚖️ License

[Apache License, Version 2.0](LICENSE)
