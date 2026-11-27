import * as flowpb from '~backend/proto/flow/flow_pb';

import { Flow } from '~/domain/flows';
import { sankeyOf } from '~/domain/flows/sankey';
import { hubbleFlowFromPb } from '~/domain/helpers/flows';

const flow = (o: {
  from: [string, string];
  to: [string, string] | { ip: string; name: string };
  port: number;
  verdict: flowpb.Verdict;
  reply?: boolean;
}) =>
  new Flow(
    hubbleFlowFromPb(
      flowpb.Flow.create({
        verdict: o.verdict,
        isReply: o.reply == null ? undefined : { value: o.reply },
        source: flowpb.Endpoint.create({
          namespace: o.from[0],
          podName: `${o.from[1]}-1`,
          labels: [`k8s:app=${o.from[1]}`],
        }),
        destination: Array.isArray(o.to)
          ? flowpb.Endpoint.create({
              namespace: o.to[0],
              podName: `${o.to[1]}-1`,
              labels: [`k8s:app=${o.to[1]}`],
            })
          : flowpb.Endpoint.create({ labels: ['reserved:world'] }),
        destinationNames: Array.isArray(o.to) ? [] : [o.to.name],
        iP: flowpb.IP.create({ destination: Array.isArray(o.to) ? '10.0.0.2' : o.to.ip }),
        l4: flowpb.Layer4.create({
          protocol: { oneofKind: 'tCP', tCP: flowpb.TCP.create({ destinationPort: o.port }) },
        }),
      }),
    ),
  );

const { FORWARDED: ok, DROPPED: drop } = flowpb.Verdict;

test('flows become source, port and destination, split by verdict', () => {
  const { nodes, links } = sankeyOf(
    [
      flow({ from: ['shop', 'frontend'], to: ['shop', 'cart'], port: 8080, verdict: ok }),
      flow({ from: ['shop', 'frontend'], to: ['shop', 'cart'], port: 8080, verdict: ok }),
      flow({
        from: ['shop', 'frontend'],
        to: ['shop', 'cart'],
        port: 8080,
        verdict: ok,
        reply: true,
      }),
      flow({ from: ['shop', 'frontend'], to: ['demo', 'api'], port: 80, verdict: drop }),
      flow({
        from: ['shop', 'cart'],
        to: { ip: '1.1.1.1', name: 'one.one' },
        port: 443,
        verdict: ok,
      }),
    ],
    'shop',
  );

  expect(nodes.map(n => [n.name, n.count, n.filter]).sort()).toEqual(
    [
      ['frontend', 3, 'from-label:app=frontend'],
      ['8080/TCP', 2, 'to-port:8080'],
      ['cart', 2, 'to-label:app=cart'],
      ['cart', 1, 'from-label:app=cart'],
      ['80/TCP', 1, 'to-port:80'],
      ['demo/api', 1, 'to-label:app=api'],
      ['443/TCP', 1, 'to-port:443'],
      ['one.one', 1, 'to-fqdn:one.one'],
    ].sort(),
  );
  expect(links.find(l => l.to === '2:demo/api')).toMatchObject({ verdict: 'dropped', count: 1 });
});
