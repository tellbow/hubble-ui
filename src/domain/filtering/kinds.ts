// The fields a filter entry can name; the value is what the user types,
// as `hubble observe` names the flag (`--from-pod` is `from-pod:`).
export enum Kind {
  Label = 'label',
  Ip = 'ip',
  Dns = 'fqdn',
  Identity = 'identity',
  Workload = 'workload',
  TCPFlag = 'tcp-flags',
  Pod = 'pod',
  Port = 'port',
  Protocol = 'protocol',
  HttpMethod = 'http-method',
  HttpPath = 'http-path',
  Node = 'node-name',
  Encrypted = 'encrypted',
  TrafficDirection = 'traffic-direction',
  EventType = 'event-type',
  DropReason = 'drop-reason',
}

export enum Direction {
  From = 'from',
  To = 'to',
  Either = 'either',
}
