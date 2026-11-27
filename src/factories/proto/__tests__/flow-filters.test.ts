import * as flowpb from '~backend/proto/flow/flow_pb';

import { Filters, FilterEntry } from '~/domain/filtering';
import { ProtoFactory } from '~/factories/proto';

// The set fields of each filter: what hubble-relay is asked for.
const fields = (fs: flowpb.FlowFilter[]) =>
  fs.map(f =>
    Object.fromEntries(
      Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : !!v)),
    ),
  );

const build = (namespace: string, entries: string[] = []) => {
  const filters = Filters.fromObject({
    namespace,
    filters: entries.flatMap(e => FilterEntry.parseMany(e)),
  });
  const [wl, bl] = ProtoFactory.flowFiltersFromFilters(filters);
  return { wl: fields(wl), bl: fields(bl) };
};

const baseBlacklist = [
  { sourceLabel: ['reserved:unknown'] },
  { destinationLabel: ['reserved:unknown'] },
  { sourceFqdn: ['*.cluster.local*'] },
  { destinationFqdn: ['*.cluster.local*'] },
];

describe('ProtoFactory.flowFiltersFromFilters', () => {
  test('a namespace: flows from or to it', () => {
    expect(build('team-a')).toEqual({
      wl: [
        { sourcePod: ['team-a/'], reply: [false] },
        { destinationPod: ['team-a/'], reply: [false] },
      ],
      bl: baseBlacklist,
    });
  });

  test('all namespaces: no namespace restriction', () => {
    expect(build('')).toEqual({ wl: [{ reply: [false] }], bl: baseBlacklist });
  });

  test('a pod: its flows within the namespace', () => {
    expect(build('team-a', ['pod:frontend']).wl).toEqual([
      { sourcePod: ['team-a/frontend'], reply: [false] },
      { sourcePod: ['team-a/'], destinationPod: ['team-a/frontend'], reply: [false] },
      { sourcePod: ['team-a/frontend'], destinationPod: ['team-a/'], reply: [false] },
      { destinationPod: ['team-a/frontend'], reply: [false] },
    ]);
  });

  test('a pod of another namespace: only its flows into this one', () => {
    expect(build('team-a', ['from-pod:team-b/web']).wl).toEqual([
      { sourcePod: ['team-b/web'], destinationPod: ['team-a/'], reply: [false] },
    ]);
  });

  test('different fields: all of them (one filter)', () => {
    expect(build('', ['from-pod:web', 'to-port:443', 'protocol:tcp']).wl).toEqual([
      { sourcePod: ['/web'], destinationPort: ['443'], protocol: ['tcp'], reply: [false] },
    ]);
  });

  test('values of one field: any of them', () => {
    expect(build('', ['to-port:80,443']).wl).toEqual([
      { destinationPort: ['80', '443'], reply: [false] },
    ]);
  });

  test('a field without a side: source or destination', () => {
    expect(build('', ['port:53', 'http-method:GET']).wl).toEqual([
      { sourcePort: ['53'], httpMethod: ['GET'], reply: [false] },
      { destinationPort: ['53'], httpMethod: ['GET'], reply: [false] },
    ]);
  });

  test('a hidden destination IP excludes that destination', () => {
    expect(build('', ['!from-ip:10.0.0.1', '!to-ip:10.0.0.2']).bl).toEqual([
      ...baseBlacklist,
      { sourceIp: ['10.0.0.1'] },
      { destinationIp: ['10.0.0.2'] },
    ]);
  });

  test('a hidden pod in all namespaces: that pod name in any namespace', () => {
    expect(build('', ['!pod=frontend']).bl).toEqual([
      ...baseBlacklist,
      { sourcePod: ['/frontend'] },
      { destinationPod: ['/frontend'] },
    ]);
  });

  test('a negative directed filter only excludes that direction', () => {
    const { wl, bl } = build('team-a', ['!to-identity:42']);
    expect(wl).toEqual(build('team-a').wl);
    expect(bl).toEqual([...baseBlacklist, { destinationIdentity: [42] }]);
  });
});
