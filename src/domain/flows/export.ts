import { Flow as PbFlow } from '~backend/proto/flow/flow_pb';

import { Verdict, type Flow } from './index';

// Flows as `hubble observe -o jsonpb` prints them, oldest first, so that
// `hubble observe --input-file` reads the file back.
export const flowsToJsonLines = (flows: Flow[]): string => {
  return [...flows]
    .sort((a, b) => a.compare(b))
    .filter(f => f.pb != null)
    .map(f => JSON.stringify({ flow: PbFlow.toJson(f.pb!, { useProtoFieldName: true }) }) + '\n')
    .join('');
};

const l7Text = (f: Flow): string => {
  const l7 = f.l7;
  if (l7 == null) return '';
  if (l7.dns != null) return 'DNS';
  if (l7.kafka != null) return 'Kafka';
  if (l7.http == null) return '';

  return `${l7.http.method} ${l7.http.code || ''} ${l7.http.url}`.replace(/ +/g, ' ');
};

const csvColumns: [string, (f: Flow) => unknown][] = [
  [
    'time',
    f => (f.millisecondsTimestamp == null ? '' : new Date(f.millisecondsTimestamp).toISOString()),
  ],
  ['verdict', f => f.verdictLabel],
  ['drop_reason', f => (f.verdict === Verdict.Dropped ? f.dropReason : '')],
  ['denied_by', f => [...f.egressDeniedBy, ...f.ingressDeniedBy].join(' ')],
  ['source_namespace', f => f.sourceNamespace],
  ['source_identity', f => f.sourceIdentityName],
  ['source_pod', f => f.sourcePodName],
  ['source_ip', f => f.sourceIp],
  ['destination_namespace', f => f.destinationNamespace],
  ['destination_identity', f => f.destinationIdentityName],
  ['destination_dns', f => f.destinationDns],
  ['destination_pod', f => f.destinationPodName],
  ['destination_ip', f => f.destinationIp],
  ['destination_port', f => f.destinationPort],
  ['protocol', f => f.protocolStr],
  ['l7', l7Text],
  ['traffic_direction', f => f.trafficDirectionLabel],
  ['encrypted', f => (f.isEncrypted ? 'yes' : 'no')],
  ['tcp_flags', f => f.joinedTcpFlags],
];

// RFC 4180: quote a field that holds a comma, quote or line break. A leading
// = + - @ is prefixed with ' so a spreadsheet does not run it as a formula.
const csvField = (v: unknown): string => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The flows as a table, oldest first, one row per flow.
export const flowsToCsv = (flows: Flow[]): string => {
  const rows = [...flows]
    .sort((a, b) => a.compare(b))
    .map(f => csvColumns.map(([, get]) => csvField(get(f))).join(','));

  return [csvColumns.map(([name]) => name).join(','), ...rows].join('\r\n') + '\r\n';
};

export type ExportFormat = 'json' | 'csv';

export const downloadFlows = (flows: Flow[], namespace: string | null, format: ExportFormat) => {
  const blob =
    format === 'csv'
      ? new Blob([flowsToCsv(flows)], { type: 'text/csv' })
      : new Blob([flowsToJsonLines(flows)], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const a = document.createElement('a');
  a.href = url;
  a.download = `hubble-flows-${namespace || 'all-namespaces'}-${stamp}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
};
