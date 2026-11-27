import parseUrl from 'url-parse';

import * as flowpb from '~backend/proto/flow/flow_pb';

import type { Flow } from '~/domain/flows';
import { CiliumEventSubTypesCodes } from '~/domain/cilium';
import { TCPFlagName, TrafficDirection, Verdict, Workload } from '~/domain/hubble';

import type { FilterEntry } from './filter-entry';
import { Direction, Kind } from './kinds';

// The side of a flow a field is read from: its source or its destination.
export type Side = 'from' | 'to';

// What one filter field means, once: how it is sent to hubble-relay and how
// the browser checks flows it already has. `matches` follows Cilium's own
// filter (pkg/hubble/filters) so that both agree; the golden test in
// __tests__/fields.test.ts and backend/domain/filters checks that they do.
export interface FieldSpec {
  // `from-`/`to-` apply; without one, either side matches.
  directional: boolean;
  // A comma separates values (OR); off where a comma belongs to the value.
  multi: boolean;
  example: string;
  validate?: (value: string) => string | null;
  toProto: (ff: flowpb.FlowFilter, side: Side | null, e: FilterEntry, ns: string | null) => void;
  matches: (f: Flow, side: Side | null, e: FilterEntry, ns: string | null) => boolean;
}

const src = (side: Side | null) => side !== 'to';

const yesNo: Record<string, boolean> = { yes: true, no: false, true: true, false: false };
const directions: Record<string, TrafficDirection> = {
  ingress: TrafficDirection.Ingress,
  egress: TrafficDirection.Egress,
};

// Cilium's trace events (monitor type 4); their sub type says where the
// packet went: to-endpoint, to-proxy, from-network, ...
const traceType = 4;
const traceSubTypes = new Map<string, number>(
  Object.entries(CiliumEventSubTypesCodes).map(([code, name]) => [name, Number(code)]),
);

// Drop reasons as Hubble names them (POLICY_DENIED), written policy-denied.
export const dropReasonName = (code: number) =>
  flowpb.DropReason[code]?.toLowerCase().replace(/_/g, '-') ?? null;
const dropReasonCode = (name: string): number | undefined => {
  const code = (flowpb.DropReason as unknown as Record<string, number>)[
    name.toUpperCase().replace(/-/g, '_')
  ];
  return typeof code === 'number' ? code : undefined;
};

const oneOf = (names: string[]) => (v: string) =>
  names.includes(v.toLowerCase()) ? null : `use one of ${names.join(', ')}`;

const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const ipToBigInt = (ip: string): [bigint, number] | null => {
  const v4 = ip.match(ipv4);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some(p => p > 255)) return null;
    return [parts.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n), 32];
  }

  if (!/^[0-9a-f:]+$/i.test(ip) || ip.split('::').length > 2) return null;
  const [head, tail = ''] = ip.split('::');
  const hs = head ? head.split(':') : [];
  const ts = tail ? tail.split(':') : [];
  const missing = 8 - hs.length - ts.length;
  if (missing < 0 || (!ip.includes('::') && missing !== 0)) return null;

  const groups = [...hs, ...Array(missing).fill('0'), ...ts];
  if (groups.some(g => g.length === 0 || g.length > 4)) return null;
  return [groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n), 128];
};

// An exact address or a CIDR prefix, as Cilium's IP filter takes them.
const validateIp = (v: string): string | null => {
  const [addr, bits, extra] = v.split('/');
  const parsed = ipToBigInt(addr);
  if (parsed == null || extra != null) return `"${v}" is no IP address or CIDR`;
  if (bits != null && !(/^\d+$/.test(bits) && +bits <= parsed[1])) return `bad prefix in "${v}"`;
  return null;
};

const ipMatches = (ip: string | null, filter: string): boolean => {
  if (!ip) return false;
  if (!filter.includes('/')) return ip === filter;

  const [addr, bits] = filter.split('/');
  const net = ipToBigInt(addr);
  const got = ipToBigInt(ip);
  if (net == null || got == null || net[1] !== got[1]) return false;

  const shift = BigInt(net[1] - +bits);
  return net[0] >> shift === got[0] >> shift;
};

// Cilium's FQDN pattern: `*` stands for any run of [-.0-9a-z].
const fqdnPattern = (pattern: string): string | null => {
  const p = pattern.trim().replace(/\.$/, '').toLowerCase();
  if (!p || p.endsWith('.') || /[^-.*0-9_a-z]/.test(p)) return null;
  return p.replace(/\./g, '\\.').replace(/\*/g, '[-.0-9a-z]*');
};

const validateFqdn = (v: string) =>
  fqdnPattern(v) == null ? `"${v}" is no DNS name pattern` : null;

const fqdnMatches = (names: string[], pattern: string): boolean => {
  const re = fqdnPattern(pattern);
  if (re == null) return false;
  const rx = new RegExp(`^(?:${re})$`);
  return names.some(n => rx.test(n));
};

const anyFqdn = '(?:[-0-9_a-z]+(?:\\.[-0-9_a-z]+)*)';

// Cilium's node name pattern: `[cluster/]node`, each part an FQDN pattern.
const nodePattern = (pattern: string): RegExp | null => {
  const parts = pattern.split('/');
  if (!pattern || parts.length > 2) return null;

  const [cluster, node] = parts.length === 2 ? parts : ['', parts[0]];
  const c = cluster ? fqdnPattern(cluster) : anyFqdn;
  const n = node ? fqdnPattern(node) : anyFqdn;
  if (c == null || n == null) return null;
  return new RegExp(`^(?:${c}/${n})$`);
};

const validateRegexp = (v: string): string | null => {
  try {
    new RegExp(v);
    return null;
  } catch (err) {
    return `bad regular expression: ${(err as Error).message}`;
  }
};

// Cilium sends `pod` as `[namespace]/prefix`: no slash would mean "default".
const podFilter = (e: FilterEntry, ns: string | null): string =>
  `${e.podNamespace ?? ns ?? ''}/${e.query}`;

export const workloadMatches = (list: Workload[], w: Workload): boolean =>
  list.some(x => (!w.name || w.name === x.name) && (!w.kind || w.kind === x.kind));

export const protocols = ['tcp', 'udp', 'icmp', 'icmpv4', 'icmpv6', 'dns', 'http'];

// NOTE: protobuf-ts mangles the uppercase proto field names (FIN, SYN, ...)
const tcpFlagFields: Record<TCPFlagName, keyof flowpb.TCPFlags> = {
  fin: 'fIN',
  syn: 'sYN',
  rst: 'rST',
  psh: 'pSH',
  ack: 'aCK',
  urg: 'uRG',
  ece: 'eCE',
  cwr: 'cWR',
  ns: 'nS',
};

// `[source:]key[=value]`, the part of a Cilium label selector the browser
// checks; a key without a source matches any source, as in Cilium.
const labelSelector = /^(?:([\w.-]+):)?([\w./-]+)(?:=([\w.-]*))?$/;

const validateLabel = (v: string): string | null =>
  labelSelector.test(v) ? null : `use key=value, e.g. app=api (no other selectors yet)`;

const labelMatches = (labels: string[] | undefined, selector: string): boolean => {
  const m = selector.match(labelSelector);
  if (m == null) return false;

  const [, source, key, value] = m;
  return (labels ?? []).some(l => {
    const lm = l.match(/^(?:([^:=]+):)?([^=]+)(?:=(.*))?$/);
    if (lm == null) return false;

    const [, lsource = '', lkey, lvalue = ''] = lm;
    return (
      (!source || source === 'any' || source === lsource) &&
      key === lkey &&
      (value == null || value === lvalue)
    );
  });
};

export const fields: Record<Kind, FieldSpec> = {
  [Kind.Label]: {
    directional: true,
    // A comma in a label selector means AND, not OR.
    multi: false,
    example: 'label:app=api',
    validate: validateLabel,
    toProto: (ff, side, e) => (src(side) ? ff.sourceLabel : ff.destinationLabel).push(e.query),
    matches: (f, side, e) =>
      labelMatches(src(side) ? f.ref.source?.labels : f.ref.destination?.labels, e.query),
  },
  [Kind.Pod]: {
    directional: true,
    multi: true,
    example: 'pod:frontend',
    toProto: (ff, side, e, ns) =>
      (src(side) ? ff.sourcePod : ff.destinationPod).push(podFilter(e, ns)),
    matches: (f, side, e, ns) => {
      const [podNs, pod] = src(side)
        ? [f.sourceNamespace, f.sourcePodName]
        : [f.destinationNamespace, f.destinationPodName];
      const wantNs = e.podNamespace ?? ns ?? '';
      if (!podNs && !pod) return false;
      return (pod ?? '').startsWith(e.query) && (!wantNs || wantNs === podNs);
    },
  },
  [Kind.Workload]: {
    directional: true,
    multi: true,
    example: 'workload:Deployment:api',
    toProto: (ff, side, e) =>
      (src(side) ? ff.sourceWorkload : ff.destinationWorkload).push(
        flowpb.Workload.create(e.asWorkload()),
      ),
    matches: (f, side, e) =>
      workloadMatches(src(side) ? f.sourceWorkloads : f.destinationWorkloads, e.asWorkload()),
  },
  [Kind.Identity]: {
    directional: true,
    multi: true,
    example: 'identity:42',
    validate: v => (/^\d+$/.test(v) ? null : `"${v}" is no identity number`),
    toProto: (ff, side, e) =>
      (src(side) ? ff.sourceIdentity : ff.destinationIdentity).push(+e.query),
    matches: (f, side, e) =>
      src(side) ? f.senderHasIdentity(e.query) : f.receiverHasIdentity(e.query),
  },
  [Kind.Ip]: {
    directional: true,
    multi: true,
    example: 'ip:10.0.0.0/8',
    validate: validateIp,
    toProto: (ff, side, e) => (src(side) ? ff.sourceIp : ff.destinationIp).push(e.query),
    matches: (f, side, e) => ipMatches(src(side) ? f.sourceIp : f.destinationIp, e.query),
  },
  [Kind.Dns]: {
    directional: true,
    multi: true,
    example: 'fqdn:*.example.com',
    validate: validateFqdn,
    toProto: (ff, side, e) => (src(side) ? ff.sourceFqdn : ff.destinationFqdn).push(e.query),
    matches: (f, side, e) =>
      fqdnMatches(src(side) ? f.ref.sourceNamesList : f.ref.destinationNamesList, e.query),
  },
  [Kind.Port]: {
    directional: true,
    multi: true,
    example: 'to-port:443',
    validate: v => (/^\d+$/.test(v) && +v <= 65535 ? null : `"${v}" is no port`),
    toProto: (ff, side, e) => (src(side) ? ff.sourcePort : ff.destinationPort).push(e.query),
    matches: (f, side, e) => (src(side) ? f.sourcePort : f.destinationPort) === +e.query,
  },
  [Kind.Protocol]: {
    directional: false,
    multi: true,
    example: 'protocol:udp',
    validate: v =>
      protocols.includes(v.toLowerCase()) ? null : `use one of ${protocols.join(', ')}`,
    toProto: (ff, _, e) => ff.protocol.push(e.query.toLowerCase()),
    matches: (f, _, e) => {
      const l4 = f.ref.l4;
      const l7 = f.ref.l7;
      switch (e.query.toLowerCase()) {
        case 'tcp':
          return l4?.tcp != null;
        case 'udp':
          return l4?.udp != null;
        case 'icmp':
          return l4?.icmpv4 != null || l4?.icmpv6 != null;
        case 'icmpv4':
          return l4?.icmpv4 != null;
        case 'icmpv6':
          return l4?.icmpv6 != null;
        case 'dns':
          return l7?.dns != null;
        case 'http':
          return l7?.http != null;
      }
      return false;
    },
  },
  [Kind.HttpMethod]: {
    directional: false,
    multi: true,
    example: 'http-method:POST',
    validate: v => (/^[A-Za-z]+$/.test(v) ? null : `"${v}" is no HTTP method`),
    toProto: (ff, _, e) => ff.httpMethod.push(e.query),
    matches: (f, _, e) => f.ref.l7?.http?.method.toLowerCase() === e.query.toLowerCase(),
  },
  [Kind.HttpPath]: {
    directional: false,
    multi: false,
    example: 'http-path:^/api/',
    validate: validateRegexp,
    toProto: (ff, _, e) => ff.httpPath.push(e.query),
    matches: (f, _, e) => {
      const url = f.ref.l7?.http?.url;
      return url != null && new RegExp(e.query).test(parseUrl(url).pathname);
    },
  },
  [Kind.Encrypted]: {
    directional: false,
    multi: false,
    example: 'encrypted:no',
    validate: v => (v.toLowerCase() in yesNo ? null : 'use yes or no'),
    toProto: (ff, _, e) => ff.encrypted.push(yesNo[e.query.toLowerCase()]),
    matches: (f, _, e) => f.isEncrypted === yesNo[e.query.toLowerCase()],
  },
  [Kind.TrafficDirection]: {
    directional: false,
    multi: true,
    example: 'traffic-direction:ingress',
    validate: oneOf(Object.keys(directions)),
    // the UI's TrafficDirection has Hubble's numbers
    toProto: (ff, _, e) =>
      ff.trafficDirection.push(
        directions[e.query.toLowerCase()] as number as flowpb.TrafficDirection,
      ),
    matches: (f, _, e) => f.trafficDirection === directions[e.query.toLowerCase()],
  },
  [Kind.EventType]: {
    directional: false,
    multi: true,
    example: 'event-type:to-proxy',
    validate: oneOf([...traceSubTypes.keys()]),
    toProto: (ff, _, e) =>
      ff.eventType.push(
        flowpb.EventTypeFilter.create({
          type: traceType,
          matchSubType: true,
          subType: traceSubTypes.get(e.query.toLowerCase()),
        }),
      ),
    matches: (f, _, e) =>
      f.ref.eventType?.type === traceType &&
      f.ref.eventType.subType === traceSubTypes.get(e.query.toLowerCase()),
  },
  [Kind.DropReason]: {
    directional: false,
    multi: true,
    example: 'drop-reason:policy-denied',
    validate: v =>
      dropReasonCode(v) == null ? `"${v}" is no drop reason, e.g. policy-denied` : null,
    toProto: (ff, _, e) => ff.dropReasonDesc.push(dropReasonCode(e.query)!),
    matches: (f, _, e) =>
      f.verdict === Verdict.Dropped && f.ref.dropReason === dropReasonCode(e.query),
  },
  [Kind.Node]: {
    directional: false,
    multi: true,
    example: 'node-name:worker-*',
    validate: v => (nodePattern(v) == null ? `"${v}" is no node name pattern` : null),
    toProto: (ff, _, e) => ff.nodeName.push(e.query),
    matches: (f, _, e) => {
      const node = f.ref.nodeName;
      if (!node) return false;
      // Cilium puts a name without a cluster into the cluster "default".
      return nodePattern(e.query)?.test(node.includes('/') ? node : `default/${node}`) ?? false;
    },
  },
  [Kind.TCPFlag]: {
    directional: false,
    multi: true,
    example: 'tcp-flags:syn',
    validate: v => (v.toLowerCase() in tcpFlagFields ? null : `"${v}" is no TCP flag`),
    toProto: (ff, _, e) => {
      const flags = flowpb.TCPFlags.create();
      flags[tcpFlagFields[e.query.toLowerCase() as TCPFlagName]] = true;
      ff.tcpFlags.push(flags);
    },
    matches: (f, _, e) => f.hasTCPFlag(e.query.toLowerCase() as TCPFlagName),
  },
};

const sidesOf = (e: FilterEntry): (Side | null)[] => {
  if (!fields[e.kind].directional) return [null];
  if (e.direction === Direction.From) return ['from'];
  if (e.direction === Direction.To) return ['to'];
  return ['from', 'to'];
};

// Whether the flow has what the entry asks for, its `!` aside.
export const entryMatches = (f: Flow, e: FilterEntry, ns: string | null): boolean =>
  sidesOf(e).some(side => fields[e.kind].matches(f, side, e, ns));

// Entries of one field and direction are alternatives (OR); groups must all
// match (AND). This is how one hubble FlowFilter reads its fields.
export const positiveGroups = (entries: FilterEntry[]): FilterEntry[][] => {
  const groups = new Map<string, FilterEntry[]>();
  entries
    .filter(e => !e.negative)
    .forEach(e => {
      const key = `${e.kind}|${e.direction}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    });

  return [...groups.values()];
};

export const flowMatchesEntries = (f: Flow, entries: FilterEntry[], ns: string | null) =>
  positiveGroups(entries).every(g => g.some(e => entryMatches(f, e, ns))) &&
  !entries.some(e => e.negative && entryMatches(f, e, ns));

// The hubble FlowFilters for the entries: OR'd whitelist filters (each one
// AND's its fields) and blacklist filters, one per side of each `!` entry.
export const entriesToProto = (
  entries: FilterEntry[],
  ns: string | null,
  base: () => flowpb.FlowFilter,
): [flowpb.FlowFilter[], flowpb.FlowFilter[]] => {
  // A group without a side is "source or destination": one filter for each.
  // shortcut: 2^n filters for n such groups, fine for a few chips; a CEL
  // expression would avoid it once relay's CEL support is required.
  type Pick = [FilterEntry[], Side | null];
  let variants: Pick[][] = [[]];
  positiveGroups(entries).forEach(g => {
    variants = variants.flatMap(v => sidesOf(g[0]).map(side => [...v, [g, side] as Pick]));
  });

  const whitelist: flowpb.FlowFilter[] = [];
  const scopes: (Side | null)[] = ns ? ['from', 'to'] : [null];
  scopes.forEach(scope => {
    variants.forEach(v => {
      const ff = base();
      v.forEach(([g, side]) => g.forEach(e => fields[e.kind].toProto(ff, side, e, ns)));

      // The namespace's own pods on the scope's side, narrowed by pod filters.
      if (scope != null) {
        const pods = scope === 'from' ? ff.sourcePod : ff.destinationPod;
        const inNs = pods.length === 0 ? [`${ns}/`] : pods.filter(p => p.startsWith(`${ns}/`));
        if (inNs.length === 0) return;

        if (scope === 'from') ff.sourcePod = inNs;
        else ff.destinationPod = inNs;
      }

      whitelist.push(ff);
    });
  });

  const blacklist: flowpb.FlowFilter[] = [];
  entries
    .filter(e => e.negative)
    .forEach(e =>
      sidesOf(e).forEach(side => {
        const ff = flowpb.FlowFilter.create();
        fields[e.kind].toProto(ff, side, e, ns);
        blacklist.push(ff);
      }),
    );

  return [whitelist, blacklist];
};

const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface Suggestion {
  value: string;
  // flows on screen with this value; 0 for a fixed value not seen
  count: number;
  // a pod's app label: Hubble leaves the pod name out of some flows (those
  // after the L7 proxy) but always gives the identity's labels
  app?: string;
}

export const appLabel = /^(?:k8s:)?((?:app|k8s-app|app\.kubernetes\.io\/name)=.+)$/;

// Values to offer for each field, most seen first: those of the flows on
// screen, then the fixed sets. A value is written as the filter takes it.
export const valueSuggestions = (flows: Flow[], ns: string | null): Map<Kind, Suggestion[]> => {
  const counts = new Map<Kind, Map<string, number>>(Object.values(Kind).map(k => [k, new Map()]));
  const apps = new Map<string, string>();
  const add = (kind: Kind, v: unknown, n = 1) => {
    if (v == null || v === '') return;
    const m = counts.get(kind)!;
    m.set(String(v), (m.get(String(v)) ?? 0) + n);
  };

  protocols.forEach(p => add(Kind.Protocol, p, 0));
  httpMethods.forEach(m => add(Kind.HttpMethod, m, 0));
  Object.keys(tcpFlagFields).forEach(f => add(Kind.TCPFlag, f, 0));

  // shortcut: the newest 2000 flows, enough to name what is on screen.
  flows.slice(0, 2000).forEach(f => {
    [f.ref.source, f.ref.destination].forEach(ep => {
      if (ep == null) return;

      ep.labels.forEach(l => add(Kind.Label, l.replace(/^k8s:/, '')));
      if (ep.podName) {
        const pod = ep.namespace === ns ? ep.podName : `${ep.namespace}/${ep.podName}`;
        add(Kind.Pod, pod);
        const app = ep.labels.map(l => appLabel.exec(l)?.[1]).find(Boolean);
        if (app) apps.set(pod, app);
      }
      ep.workloads.forEach(w => add(Kind.Workload, `${w.kind}:${w.name}`));
      add(Kind.Identity, ep.identity || null);
    });

    add(Kind.Ip, f.sourceIp);
    add(Kind.Ip, f.destinationIp);
    [...f.ref.sourceNamesList, ...f.ref.destinationNamesList].forEach(n => add(Kind.Dns, n));
    add(Kind.Port, f.destinationPort);
    add(Kind.Node, f.ref.nodeName);
    add(Kind.Encrypted, f.isEncrypted ? 'yes' : 'no');
    add(
      Kind.TrafficDirection,
      f.trafficDirection === TrafficDirection.Ingress
        ? 'ingress'
        : f.trafficDirection === TrafficDirection.Egress
          ? 'egress'
          : null,
    );
    if (f.ref.eventType?.type === traceType) add(Kind.EventType, f.ciliumEventSubTypeLabel);
    if (f.verdict === Verdict.Dropped) add(Kind.DropReason, dropReasonName(f.ref.dropReason ?? 0));

    const url = f.ref.l7?.http?.url;
    if (url) add(Kind.HttpPath, parseUrl(url).pathname);
  });

  return new Map(
    [...counts].map(([k, m]) => [
      k,
      [...m]
        .map(([value, count]) => ({ value, count, app: apps.get(value) }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, 200),
    ]),
  );
};
