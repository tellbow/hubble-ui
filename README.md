<h1 align="center">Hubble UI</h1>
<p align="center">
  Hubble UI is an open-source user interface for <a href="https://github.com/cilium/hubble">Cilium Hubble</a>.
</p>

This is tellbow's fork of [cilium/hubble-ui](https://github.com/cilium/hubble-ui),
maintained on its own: it builds, tests and publishes its images here, and takes
fixes from upstream as backports (see [Upstream](#-upstream)).

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

Every push to `master` also publishes `ghcr.io/tellbow/hubble-ui-ci` and
`ghcr.io/tellbow/hubble-ui-backend-ci`, tagged `latest` and with the commit SHA.

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

## 🔁 Upstream

The fork keeps upstream's layout and the Go module path
`github.com/cilium/hubble-ui/backend` on purpose, so that upstream commits apply
without rewriting imports. To backport one:

```sh
git remote add upstream https://github.com/cilium/hubble-ui.git  # once
git fetch upstream
git switch -c backport/<topic> master
git cherry-pick -x <upstream-sha>   # -x records the upstream commit in the message
```

Open a pull request against `master` as for any change.

## ⚖️ License

[Apache License, Version 2.0](LICENSE)
