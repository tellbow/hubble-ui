import { appLabel } from '~/domain/filtering/fields';
import { Flow, Verdict } from '~/domain/flows';

// Three columns: who sends, to which port, and who receives.
export interface SankeyNode {
  id: string;
  column: 0 | 1 | 2;
  name: string;
  count: number;
  // the filter (code mode text) that keeps this node's flows, if one can
  filter: string | null;
}

export type SankeyVerdict = 'forwarded' | 'dropped' | 'other';

export interface SankeyLink {
  from: string;
  to: string;
  verdict: SankeyVerdict;
  count: number;
}

const top = 12;

const verdictOf = (v: Verdict): SankeyVerdict =>
  v === Verdict.Forwarded ? 'forwarded' : v === Verdict.Dropped ? 'dropped' : 'other';

const endpoint = (f: Flow, side: 'from' | 'to', ns: string | null) => {
  const src = side === 'from';
  const labels = (src ? f.ref.source : f.ref.destination)?.labels ?? [];
  const epNs = src ? f.sourceNamespace : f.destinationNamespace;
  const dns = src ? f.sourceDns : f.destinationDns;
  const ip = src ? f.sourceIp : f.destinationIp;
  const app = labels.map(l => appLabel.exec(l)?.[1]).find(Boolean);
  // Outside the cluster, the DNS name or address says more than "world".
  const outside = labels.some(l => l.startsWith('reserved:world'));
  const identity = src ? f.sourceIdentityName : f.destinationIdentityName;
  const name = (outside ? (dns ?? ip) : identity) ?? identity ?? dns ?? ip ?? 'unknown';

  return {
    name: epNs && ns && epNs !== ns ? `${epNs}/${name}` : name,
    filter: app
      ? `${side}-label:${app}`
      : dns
        ? `${side}-fqdn:${dns}`
        : ip
          ? `${side}-ip:${ip}`
          : null,
  };
};

const portOf = (f: Flow) => {
  const proto = f.protocolStr ?? 'other';
  const port = f.destinationPort;
  if (port) return { name: `${port}/${proto}`, filter: `to-port:${port}` };

  const p = proto.toLowerCase();
  return {
    name: proto,
    filter: ['icmpv4', 'icmpv6', 'udp', 'tcp'].includes(p) ? `protocol:${p}` : null,
  };
};

// Requests only: a reply would count a connection twice, backwards.
export const sankeyOf = (flows: Flow[], ns: string | null) => {
  const nodes = new Map<string, SankeyNode>();
  const links = new Map<string, SankeyLink>();

  const picks = flows
    .filter(f => !f.isReply)
    .map(
      f =>
        [endpoint(f, 'from', ns), portOf(f), endpoint(f, 'to', ns), verdictOf(f.verdict)] as const,
    );

  // The busiest nodes of each column; the rest share one "other" node.
  const kept = [0, 1, 2].map(c => {
    const counts = new Map<string, number>();
    picks.forEach(p => {
      const n = p[c] as { name: string };
      counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    });
    return new Set(
      [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([n]) => n),
    );
  });

  const node = (column: 0 | 1 | 2, n: { name: string; filter: string | null }) => {
    const other = !kept[column].has(n.name);
    const id = `${column}:${other ? '' : n.name}`;
    const it = nodes.get(id) ?? {
      id,
      column,
      name: other ? 'other' : n.name,
      count: 0,
      filter: other ? null : n.filter,
    };
    it.count += 1;
    nodes.set(id, it);
    return id;
  };

  const link = (from: string, to: string, verdict: SankeyVerdict) => {
    const key = `${from}>${to}>${verdict}`;
    const it = links.get(key) ?? { from, to, verdict, count: 0 };
    it.count += 1;
    links.set(key, it);
  };

  picks.forEach(([src, port, dst, verdict]) => {
    const a = node(0, src);
    const b = node(1, port);
    const c = node(2, dst);
    link(a, b, verdict);
    link(b, c, verdict);
  });

  return { nodes: [...nodes.values()], links: [...links.values()] };
};
