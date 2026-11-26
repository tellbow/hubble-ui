package labels

import (
	"strings"
)

type ReservedLabel string
type SpecialLabel string

const (
	ReservedLabelHost          ReservedLabel = "reserved:host"
	ReservedLabelWorld         ReservedLabel = "reserved:world"
	ReservedLabelWorldIPv4     ReservedLabel = "reserved:world-ipv4"
	ReservedLabelWorldIPv6     ReservedLabel = "reserved:world-ipv6"
	ReservedLabelHealth        ReservedLabel = "reserved:health"
	ReservedLabelInit          ReservedLabel = "reserved:init"
	ReservedLabelRemoteNode    ReservedLabel = "reserved:remote-node"
	ReservedLabelUnmanaged     ReservedLabel = "reserved:unmanaged"
	ReservedLabelUnknown       ReservedLabel = "reserved:unknown"
	ReservedLabelKubeAPIServer ReservedLabel = "reserved:kube-apiserver"

	SpecialLabelKubeDNS    SpecialLabel = "k8s:k8s-app=kube-dns"
	SpecialLabelPrometheus SpecialLabel = "k8s:app=prometheus"
)

var (
	prefixes = []string{"k8s:", "io.kubernetes.pod.", "app.kubernetes.io/"}
	appKeys  = []string{"app", "name", "functionName", "k8s-app"}
)

type LabelProps struct {
	IsHost          bool
	IsWorld         bool
	IsRemoteNode    bool
	IsKubeDNS       bool
	IsKubeAPIServer bool
	IsInit          bool
	IsHealth        bool
	IsPrometheus    bool
	AppName         *string
}

func Props(labels []string) *LabelProps {
	props := new(LabelProps)

	for _, lbl := range labels {
		k, v := LabelAsKeyValue(lbl, true)

		props.IsHost = props.IsHost || k == string(ReservedLabelHost)
		// Dual-stack clusters label world traffic world-ipv4 / world-ipv6.
		props.IsWorld = props.IsWorld || k == string(ReservedLabelWorld) ||
			k == string(ReservedLabelWorldIPv4) || k == string(ReservedLabelWorldIPv6)
		props.IsInit = props.IsInit || k == string(ReservedLabelInit)
		props.IsHealth = props.IsHealth || k == string(ReservedLabelHealth)
		props.IsRemoteNode = props.IsRemoteNode || k == string(
			ReservedLabelRemoteNode,
		)
		props.IsKubeDNS = props.IsKubeDNS || lbl == string(SpecialLabelKubeDNS)
		props.IsPrometheus = props.IsPrometheus || lbl == string(
			SpecialLabelPrometheus,
		)
		props.IsKubeAPIServer = props.IsKubeAPIServer || k == string(
			ReservedLabelKubeAPIServer,
		)

		if props.AppName != nil {
			continue
		}

		props.AppName = appNameFromKV(k, v)
	}

	return props
}

func LabelAsKeyValue(lbl string, normalize bool) (string, string) {
	parts := strings.SplitN(lbl, "=", 2)
	n := len(parts)

	k, v := "", ""
	if n >= 1 {
		k = parts[0]
	}

	if n == 2 {
		v = parts[1]
	}

	if normalize {
		k = NormalizeKey(k)
	}

	return k, v
}

func NormalizeKey(labelKey string) string {
	for _, prefix := range prefixes {
		labelKey = strings.ReplaceAll(labelKey, prefix, "")
	}

	return labelKey
}

func appNameFromKV(k, v string) *string {
	for _, appKey := range appKeys {
		if k == appKey {
			return &v
		}
	}

	return nil
}
