import fs from 'node:fs';
import path from 'node:path';

import * as flowpb from '~backend/proto/flow/flow_pb';

import { FilterEntry } from '~/domain/filtering';
import { entriesToProto, flowMatchesEntries, valueSuggestions } from '~/domain/filtering/fields';
import { FilterKind } from '~/domain/filtering';
import { Flow } from '~/domain/flows';
import { hubbleFlowFromPb } from '~/domain/helpers/flows';

// The browser checks flows it has with `flowMatchesEntries`; hubble-relay
// checks new ones with the FlowFilters of `entriesToProto`. The cases below
// write what the browser decides to a golden file, and
// backend/internal/filtercheck runs Cilium's own filter code on the same
// FlowFilters and flows: both must agree. After changing a case or a field,
// run `UPDATE_GOLDEN=1 npx jest fields.test` and then the Go test.
const golden = path.resolve(
  __dirname,
  '../../../../backend/internal/filtercheck/testdata/ui-filters.json',
);

const ep = (ns: string, pod: string, identity: number, labels: string[], workload?: string) =>
  flowpb.Endpoint.create({
    namespace: ns,
    podName: pod,
    identity,
    labels,
    workloads: workload
      ? [flowpb.Workload.create({ kind: workload.split(':')[0], name: workload.split(':')[1] })]
      : [],
  });

const flows: Record<string, flowpb.Flow> = {
  httpGet: flowpb.Flow.create({
    nodeName: 'kind/worker-1',
    verdict: flowpb.Verdict.FORWARDED,
    trafficDirection: flowpb.TrafficDirection.EGRESS,
    eventType: flowpb.CiliumEventType.create({ type: 4, subType: 1 }),
    source: ep('shop', 'frontend-7d9f', 1001, ['k8s:app=frontend'], 'Deployment:frontend'),
    destination: ep('shop', 'cart-5c4b', 1002, ['k8s:app=cart'], 'Deployment:cart'),
    iP: flowpb.IP.create({ source: '10.244.1.5', destination: '10.244.2.9', encrypted: true }),
    l4: flowpb.Layer4.create({
      protocol: {
        oneofKind: 'tCP',
        tCP: flowpb.TCP.create({
          sourcePort: 41000,
          destinationPort: 8080,
          flags: flowpb.TCPFlags.create({ sYN: true }),
        }),
      },
    }),
    l7: flowpb.Layer7.create({
      record: {
        oneofKind: 'http',
        http: flowpb.HTTP.create({ method: 'GET', url: 'http://cart:8080/api/items?x=1' }),
      },
    }),
  }),
  toWorld: flowpb.Flow.create({
    nodeName: 'worker-2',
    verdict: flowpb.Verdict.DROPPED,
    dropReasonDesc: flowpb.DropReason.POLICY_DENIED,
    trafficDirection: flowpb.TrafficDirection.EGRESS,
    eventType: flowpb.CiliumEventType.create({ type: 1, subType: 133 }),
    source: ep('demo', 'client-1', 2001, ['k8s:app=client']),
    destination: ep('', '', 2, ['reserved:world']),
    iP: flowpb.IP.create({ source: '10.244.3.4', destination: '104.16.132.229' }),
    destinationNames: ['www.cloudflare.com'],
    l4: flowpb.Layer4.create({
      protocol: {
        oneofKind: 'tCP',
        tCP: flowpb.TCP.create({ sourcePort: 52000, destinationPort: 443 }),
      },
    }),
  }),
  dnsQuery: flowpb.Flow.create({
    nodeName: 'kind/worker-1',
    verdict: flowpb.Verdict.FORWARDED,
    trafficDirection: flowpb.TrafficDirection.INGRESS,
    eventType: flowpb.CiliumEventType.create({ type: 4, subType: 0 }),
    source: ep('demo', 'client-1', 2001, ['k8s:app=client']),
    destination: ep(
      'kube-system',
      'coredns-abc',
      3001,
      ['k8s:k8s-app=kube-dns'],
      'Deployment:coredns',
    ),
    iP: flowpb.IP.create({ source: 'fd00::3', destination: 'fd00::a' }),
    l4: flowpb.Layer4.create({
      protocol: {
        oneofKind: 'uDP',
        uDP: flowpb.UDP.create({ sourcePort: 33000, destinationPort: 53 }),
      },
    }),
    l7: flowpb.Layer7.create({
      record: { oneofKind: 'dns', dns: flowpb.DNS.create({ query: 'cart.shop.svc.' }) },
    }),
  }),
  ping: flowpb.Flow.create({
    nodeName: 'kind/control-plane',
    source: ep('shop', 'cart-5c4b', 1002, ['k8s:app=cart']),
    destination: ep('demo', 'client-1', 2001, ['k8s:app=client']),
    iP: flowpb.IP.create({ source: '10.244.2.9', destination: '10.244.3.4' }),
    l4: flowpb.Layer4.create({
      protocol: { oneofKind: 'iCMPv4', iCMPv4: flowpb.ICMPv4.create({ type: 8 }) },
    }),
  }),
};

// [namespace, what the user typed]
const cases: [string, string][] = [
  ['', 'pod:frontend'],
  ['shop', 'pod:frontend'],
  ['', 'to-pod:shop/cart'],
  ['demo', 'from-pod:shop/'],
  ['', 'from-label:app=client'],
  ['', '!label:app=cart'],
  ['', 'to-port:443,53'],
  ['', 'port:41000'],
  ['', 'to-port:8080 protocol:tcp'],
  ['', 'protocol:udp,icmp'],
  ['', 'protocol:http'],
  ['', 'protocol:dns'],
  ['', 'http-method:get'],
  ['', 'http-path:^/api/'],
  ['', 'to-ip:104.16.0.0/13'],
  ['', 'ip:fd00::/64'],
  ['', 'from-ip:10.244.1.5'],
  ['', 'to-fqdn:*.cloudflare.com'],
  ['', 'fqdn:WWW.cloudflare.com.'],
  ['', 'node-name:worker-*'],
  ['', 'node-name:kind/worker-1'],
  ['', 'workload:Deployment:cart'],
  ['', 'from-workload:frontend'],
  ['', 'identity:2'],
  ['', 'tcp-flags:syn'],
  ['demo', 'from-pod:client to-port:443'],
  ['demo', '!to-port:53'],
  ['shop', '!pod:frontend'],
  ['', 'encrypted:yes'],
  ['', '!encrypted:no'],
  ['', 'encrypted:no'],
  ['', 'traffic-direction:ingress'],
  ['', 'traffic-direction:egress,ingress'],
  ['', 'event-type:to-proxy'],
  ['', 'event-type:to-endpoint,to-proxy'],
  ['', 'drop-reason:policy-denied'],
  ['', '!drop-reason:policy-denied'],
  ['', 'pod:client !to-fqdn:*.cloudflare.com'],
  ['shop', 'from-pod:cart to-pod:demo/client'],
];

const browserSays = (ns: string, f: Flow, entries: FilterEntry[]) => {
  const inNs = !ns || f.sourceNamespace === ns || f.destinationNamespace === ns;
  return inNs && flowMatchesEntries(f, entries, ns || null);
};

const json = (m: flowpb.FlowFilter) => flowpb.FlowFilter.toJson(m, { useProtoFieldName: true });

const build = () =>
  cases.map(([ns, input]) => {
    const { entries, error } = FilterEntry.parseInput(input);
    expect(error).toBeNull();

    const [whitelist, blacklist] = entriesToProto(entries, ns || null, () =>
      flowpb.FlowFilter.create(),
    );

    return {
      name: `${ns || '*'} | ${input}`,
      whitelist: whitelist.map(json),
      blacklist: blacklist.map(json),
      expected: Object.fromEntries(
        Object.entries(flows).map(([name, pb]) => [
          name,
          browserSays(ns, new Flow(hubbleFlowFromPb(pb)), entries),
        ]),
      ),
    };
  });

describe('filter fields', () => {
  test('the golden file holds what the browser decides', () => {
    const doc = {
      flows: Object.fromEntries(
        Object.entries(flows).map(([n, f]) => [
          n,
          flowpb.Flow.toJson(f, { useProtoFieldName: true }),
        ]),
      ),
      cases: build(),
    };

    if (process.env.UPDATE_GOLDEN) {
      fs.writeFileSync(golden, JSON.stringify(doc, null, 2) + '\n');
    }

    expect(JSON.parse(fs.readFileSync(golden, 'utf8'))).toEqual(doc);
  });

  test('every case matches some flow and misses another', () => {
    build().forEach(c => {
      const results = Object.values(c.expected);
      expect([c.name, results.includes(true)]).toEqual([c.name, true]);
      expect([c.name, results.includes(false)]).toEqual([c.name, true]);
    });
  });

  test('input errors say what is wrong', () => {
    expect(FilterEntry.parseInput('to-port:99999').error).toBe('port: "99999" is no port');
    expect(FilterEntry.parseInput('to-protocol:tcp').error).toBe(
      'protocol has no from- or to- side',
    );
    expect(FilterEntry.parseInput('colour:red').error).toMatch(/^Unknown field "colour"/);
    expect(FilterEntry.parseInput('frontend').error).toMatch(/use field:value/);
    expect(FilterEntry.parseInput('ip:10.0.0.0/33').error).toBe('ip: bad prefix in "10.0.0.0/33"');
  });

  test('an entry reads back as typed', () => {
    const input = '!from-pod:shop/web to-port:443 workload:Deployment:api label:k8s:app=x';
    const { entries } = FilterEntry.parseInput(input);
    expect(entries.map(e => e.toString()).join(' ')).toBe(input);
  });

  test('pods are offered with their app label, most seen first', () => {
    const shown = [flows.httpGet, flows.httpGet, flows.ping].map(
      f => new Flow(hubbleFlowFromPb(f)),
    );
    expect(valueSuggestions(shown, 'shop').get(FilterKind.Pod)).toEqual([
      { value: 'cart-5c4b', count: 3, app: 'app=cart' },
      { value: 'frontend-7d9f', count: 2, app: 'app=frontend' },
      { value: 'demo/client-1', count: 1, app: 'app=client' },
    ]);
  });
});
