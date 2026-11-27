package authz

import (
	"strings"

	"github.com/cilium/cilium/api/v1/flow"
	"google.golang.org/protobuf/proto"
)

// HiddenName stands for every endpoint in a namespace the user may not see:
// one card, so that neither its pods nor its namespace's name show.
const HiddenName = "other-namespace"

const namespaceLabel = "k8s:io.kubernetes.pod.namespace="

// Flow returns f as the scope may see it: nil when neither end is in one of
// its namespaces, else with the end in another namespace hidden.
func (s *Scope) Flow(f *flow.Flow) *flow.Flow {
	if s.All() {
		return f
	}

	src, dst := NamespaceOf(f.GetSource()), NamespaceOf(f.GetDestination())
	srcOK, dstOK := s.Namespace(src), s.Namespace(dst)
	if !srcOK && !dstOK {
		return nil
	}

	f = proto.Clone(f).(*flow.Flow)
	hideSrc, hideDst := src != "" && !srcOK, dst != "" && !dstOK

	// shortcut: fields are cleared by name; a field a newer Cilium adds that
	// names the other end shows until it is added here.
	if hideSrc || hideDst {
		f.Ethernet, f.Tunnel, f.Extensions = nil, nil, nil
		f.Summary, f.PolicyLog = "", nil //nolint:staticcheck // deprecated, still sent by older agents
		f.SocketCookie, f.CgroupId = 0, 0
	}

	if hideSrc {
		f.Source, f.SourceNames, f.SourceService = hidden(), nil, nil
		if ip := f.GetIP(); ip != nil {
			ip.Source, ip.SourceXlated = "", ""
		}
	}

	if hideDst {
		f.Destination, f.DestinationNames, f.DestinationService = hidden(), nil, nil
		if ip := f.GetIP(); ip != nil {
			ip.Destination = ""
		}
	}

	f.EgressAllowedBy = s.policies(f.GetEgressAllowedBy())
	f.IngressAllowedBy = s.policies(f.GetIngressAllowedBy())
	f.EgressDeniedBy = s.policies(f.GetEgressDeniedBy())
	f.IngressDeniedBy = s.policies(f.GetIngressDeniedBy())

	return f
}

// FlowFilters selects, at hubble-relay, the flows with an end in one of
// namespaces: by pod, and by label for flows past the L7 proxy. Hubble ORs the
// filters, and the values within one.
func FlowFilters(namespaces []string) []*flow.FlowFilter {
	pods := make([]string, 0, len(namespaces))
	labels := make([]string, 0, len(namespaces))
	for _, ns := range namespaces {
		pods = append(pods, ns+"/")
		labels = append(labels, namespaceLabel+ns)
	}

	return []*flow.FlowFilter{
		{SourcePod: pods},
		{DestinationPod: pods},
		{SourceLabel: labels},
		{DestinationLabel: labels},
	}
}

// NamespaceOf is an endpoint's namespace. Flows past the L7 proxy carry no
// pod name or namespace, only the identity's labels.
func NamespaceOf(ep *flow.Endpoint) string {
	if ns := ep.GetNamespace(); ns != "" {
		return ns
	}

	for _, l := range ep.GetLabels() {
		if ns, ok := strings.CutPrefix(l, namespaceLabel); ok {
			return ns
		}
	}

	return ""
}

func hidden() *flow.Endpoint {
	return &flow.Endpoint{Workloads: []*flow.Workload{{Kind: "Namespace", Name: HiddenName}}}
}

// policies keeps the names of policies in the scope's namespaces; cluster-wide
// ones and other namespaces' show that a policy decided, not which.
func (s *Scope) policies(ps []*flow.Policy) []*flow.Policy {
	for i, p := range ps {
		if p.GetNamespace() == "" || !s.Namespace(p.GetNamespace()) {
			ps[i] = &flow.Policy{Kind: p.GetKind(), Name: "hidden"}
		}
	}

	return ps
}
