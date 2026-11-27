import * as flowpb from '~backend/proto/flow/flow_pb';
import { Timestamp } from '~backend/proto/google/protobuf/timestamp_pb';

import { Flow } from '~/domain/flows';
import { flowsToCsv, flowsToJsonLines } from '~/domain/flows/export';
import { hubbleFlowFromPb } from '~/domain/helpers/flows';

const flowAt = (seconds: number, uuid: string): Flow => {
  const pb = flowpb.Flow.create({
    uuid,
    time: Timestamp.create({ seconds: BigInt(seconds), nanos: 0 }),
    verdict: flowpb.Verdict.DROPPED,
    dropReasonDesc: flowpb.DropReason.POLICY_DENIED,
  });

  const flow = new Flow(hubbleFlowFromPb(pb));
  flow.pb = pb;

  return flow;
};

describe('flowsToJsonLines', () => {
  test('writes one jsonpb GetFlowsResponse per line, oldest first', () => {
    const lines = flowsToJsonLines([flowAt(20, 'new'), flowAt(10, 'old')])
      .trimEnd()
      .split('\n');

    expect(lines.map(l => JSON.parse(l).flow.uuid)).toEqual(['old', 'new']);
    expect(JSON.parse(lines[0]).flow).toMatchObject({
      verdict: 'DROPPED',
      drop_reason_desc: 'POLICY_DENIED',
      time: '1970-01-01T00:00:10Z',
    });
  });

  test('skips flows that did not come from relay', () => {
    const flow = flowAt(10, 'x');
    flow.pb = undefined;

    expect(flowsToJsonLines([flow])).toBe('');
  });
});

describe('flowsToCsv', () => {
  test('writes a header and one row per flow, oldest first', () => {
    const [header, ...rows] = flowsToCsv([flowAt(20, 'new'), flowAt(10, 'old')])
      .trimEnd()
      .split('\r\n');

    expect(header.split(',').slice(0, 3)).toEqual(['time', 'verdict', 'drop_reason']);
    expect(rows).toHaveLength(2);
    expect(rows[0].split(',').slice(0, 2)).toEqual(['1970-01-01T00:00:10.000Z', 'dropped']);
  });

  test('quotes commas and quotes, and defuses spreadsheet formulas', () => {
    const flow = flowAt(10, 'x');
    flow.pb!.destinationNames = ['=cmd|calc', 'a,"b"'];
    const withNames = new Flow(hubbleFlowFromPb(flow.pb!));

    expect(withNames.destinationDns).toBe('=cmd|calc');
    expect(flowsToCsv([withNames])).toContain(",'=cmd|calc,");
  });
});
