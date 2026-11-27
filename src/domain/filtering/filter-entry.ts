import _ from 'lodash';

import { PodSelector, Workload } from '~/domain/hubble';

import { fields } from './fields';
import { Direction, Kind } from './kinds';

export { Direction, Kind };

export interface Params {
  kind: Kind;
  direction: Direction;
  query: string;
  meta?: string;
  negative?: boolean;
}

// TODO: write tests for parsing / serializing
export class FilterEntry {
  public kind: Kind;
  public direction: Direction;
  public query: string;
  public meta?: string;
  public negative: boolean;

  // Entries in the URL or the filter input: tokens apart by spaces.
  public static parseMany(src: any): FilterEntry[] {
    if (!src || !_.isString(src)) return [];

    return FilterEntry.parseInput(src).entries;
  }

  // `[!][from-|to-]field:value[,value…]`, the flags of `hubble observe`:
  // `from-pod:x` is `--from-pod x`. A bare `key=value` is a label.
  public static parseInput(input: string): { entries: FilterEntry[]; error: string | null } {
    const entries: FilterEntry[] = [];
    let error: string | null = null;

    input
      .split(/\s+/)
      .filter(Boolean)
      .forEach(token => {
        const parsed = FilterEntry.parseToken(token);
        if (typeof parsed === 'string') error ??= parsed;
        else entries.push(...parsed);
      });

    return { entries, error };
  }

  public static parse(token: string): FilterEntry | null {
    const parsed = FilterEntry.parseToken(token.trim());
    return typeof parsed === 'string' ? null : (parsed[0] ?? null);
  }

  // The entries of one token, or why it is not one.
  private static parseToken(token: string): FilterEntry[] | string {
    const negative = token.startsWith('!');
    const body = negative ? token.slice(1) : token;

    const colon = body.indexOf(':');
    let key = colon === -1 ? '' : body.slice(0, colon);
    let value = colon === -1 ? body : body.slice(colon + 1);

    let direction = Direction.Either;
    if (key.startsWith('from-')) [direction, key] = [Direction.From, key.slice(5)];
    else if (key.startsWith('to-')) [direction, key] = [Direction.To, key.slice(3)];

    let kind = FilterEntry.parseKind(key);

    // `ip=1.1.1.1`, `dns=x`: how the old input was typed.
    const eq = body.indexOf('=');
    const oldKind =
      eq === -1 ? null : FilterEntry.parseKind(body.slice(0, eq).replace(/^dns$/, 'fqdn'));
    if (kind == null && oldKind != null) [kind, value] = [oldKind, body.slice(eq + 1)];

    if (kind == null) {
      // `app=api` or `k8s:app=api`: a label, as the old input took them.
      if (!body.includes('=')) {
        const known = Object.values(fields)
          .map(f => f.example)
          .join(', ');
        return colon === -1
          ? `"${token}": use field:value, e.g. ${known}`
          : `Unknown field "${key}". Fields: ${Object.values(Kind).join(', ')}`;
      }
      [kind, direction, value] = [Kind.Label, Direction.Either, body];
    }

    const spec = fields[kind];
    if (!spec.directional && direction !== Direction.Either) {
      return `${kind} has no from- or to- side`;
    }

    const values = (spec.multi ? value.split(',') : [value]).filter(Boolean);
    if (values.length === 0) return `${kind}: value missing, e.g. ${spec.example}`;

    for (const v of values) {
      const err = spec.validate?.(v);
      if (err) return `${kind}: ${err}`;
    }

    return values.map(v => {
      const [query, meta] = FilterEntry.parseRest(kind, v);
      return new FilterEntry({ kind, direction, query, meta, negative });
    });
  }

  public static parseDirection(s: string): Direction | null {
    if (Object.values(Direction).includes(s as any)) return s as Direction;

    return null;
  }

  public static parseKind(kind: string): Kind | null {
    if (Object.values(Kind).includes(kind as any)) return kind as Kind;

    return null;
  }

  // NOTE: This function combines base with include/exclude
  // returning only unique entries
  public static combine(
    base: Iterable<FilterEntry> | null | undefined,
    include: FilterEntry[] | null | undefined = [],
    exclude: FilterEntry[] | null | undefined = [],
  ): [FilterEntry[], boolean] {
    const excludeHashes = new Set((exclude || []).map(f => f.toString()));
    const result: FilterEntry[] = [];
    let isChanged = false;

    for (const fe of base || []) {
      const key = fe.toString();
      if (excludeHashes.has(key)) {
        isChanged = true;
        continue;
      }

      result.push(fe);

      // NOTE: This will prevent duplicates
      excludeHashes.add(key);
    }

    for (const fe of include || []) {
      const key = fe.toString();
      if (excludeHashes.has(key)) continue;

      result.push(fe);
      excludeHashes.add(key);
      isChanged = true;
    }

    return [result, isChanged];
  }

  public static unique(base: Iterable<FilterEntry> | null | undefined): FilterEntry[] {
    const [result] = FilterEntry.combine(base);
    return result;
  }

  public static newTCPFlag(flag: string): FilterEntry {
    return new FilterEntry({
      kind: Kind.TCPFlag,
      query: flag,
      direction: Direction.Either,
      meta: '',
    });
  }

  public static newLabel(label: string): FilterEntry {
    return new FilterEntry({
      kind: Kind.Label,
      query: label,
      direction: Direction.Either,
      meta: '',
    });
  }

  public static newPod(podName: string): FilterEntry {
    return new FilterEntry({
      kind: Kind.Pod,
      query: podName,
      direction: Direction.Either,
      meta: '',
    });
  }

  public static newPodSelector(ps: PodSelector): FilterEntry {
    return FilterEntry.newPod(ps.pod).setMeta(ps.namespace || '');
  }

  public static newIdentity(identity: string): FilterEntry {
    return new FilterEntry({
      kind: Kind.Identity,
      query: identity,
      direction: Direction.Either,
      meta: '',
    });
  }

  public static newDNS(dns: string): FilterEntry {
    return new FilterEntry({
      kind: Kind.Dns,
      query: dns,
      direction: Direction.Either,
      meta: '',
    });
  }

  public static newIP(ip: string): FilterEntry {
    return new FilterEntry({
      kind: Kind.Ip,
      query: ip,
      direction: Direction.Either,
      meta: '',
    });
  }

  public static newWorkload(wl: Workload): FilterEntry {
    return new FilterEntry({
      kind: Kind.Workload,
      query: wl.name,
      direction: Direction.Either,
      meta: wl.kind,
    });
  }

  private static parseWorkloadQueryAndMeta(value: string): [string, string | undefined] {
    let sep = ':';
    let parts = value.split(sep);

    if (parts.length < 2) {
      sep = '/';
      parts = value.split(sep);
    }

    if (parts.length < 2) return [value, void 0];

    const kind = parts[0];
    const name = parts.slice(1).join(sep);

    // NOTE: Name is a query (visible part of filter in search line)
    return [name, kind];
  }

  private static parseRest(kind: Kind, rest: string): [string, string | undefined] {
    switch (kind) {
      case Kind.Workload:
        return FilterEntry.parseWorkloadQueryAndMeta(rest);
      case Kind.Pod: {
        const slash = rest.indexOf('/');
        return slash === -1 ? [rest, void 0] : [rest.slice(slash + 1), rest.slice(0, slash)];
      }
      default:
        return [rest, void 0];
    }
  }

  constructor({ kind, direction, query, meta, negative }: Params) {
    this.kind = kind;
    this.query = query;
    this.direction = direction;
    this.meta = meta;
    this.negative = negative || false;
  }

  public setMeta(meta: string): FilterEntry {
    const fe = this.clone();
    fe.meta = meta;

    return fe;
  }

  public setQuery(q: string): FilterEntry {
    this.query = q;

    return this;
  }

  public setDirection(dir: Direction): FilterEntry {
    const fe = this.clone();
    fe.direction = dir;

    return fe;
  }

  public setKind(kind: Kind): FilterEntry {
    this.kind = kind;

    return this;
  }

  public toString(): string {
    const dir = this.direction === Direction.Either ? '' : `${this.direction}-`;
    return `${this.negative ? '!' : ''}${dir}${this.kind}:${this.value}`;
  }

  // The value as typed: a pod or workload with its namespace or kind.
  public get value(): string {
    if (this.isWorkload && this.meta) return `${this.meta}:${this.query}`;
    if (this.isPod && this.meta) return `${this.meta}/${this.query}`;
    return this.query;
  }

  // An empty kind or name matches any, as in Cilium's workload filter.
  public asWorkload(): Workload {
    return { kind: this.meta ?? '', name: this.query };
  }

  public clone(): FilterEntry {
    return new FilterEntry({
      kind: this.kind,
      direction: this.direction,
      query: this.query,
      meta: this.meta,
      negative: this.negative,
    });
  }

  public equals(rhs: FilterEntry): boolean {
    return (
      this.kind === rhs.kind &&
      this.direction === rhs.direction &&
      this.query === rhs.query &&
      this.negative === rhs.negative
    );
  }

  public get isDNS(): boolean {
    return this.kind === Kind.Dns;
  }

  public get isIdentity(): boolean {
    return this.kind === Kind.Identity;
  }

  public get isLabel(): boolean {
    return this.kind === Kind.Label;
  }

  public get isIp(): boolean {
    return this.kind === Kind.Ip;
  }

  public get isTCPFlag(): boolean {
    return this.kind === Kind.TCPFlag;
  }

  public get isPod(): boolean {
    return this.kind === Kind.Pod;
  }

  public get isWorkload(): boolean {
    return this.kind === Kind.Workload;
  }

  public get fromRequired(): boolean {
    return [Direction.Either, Direction.From].includes(this.direction);
  }

  public get toRequired(): boolean {
    return [Direction.Either, Direction.To].includes(this.direction);
  }

  public get bothRequired(): boolean {
    return this.direction === Direction.Either;
  }

  public get isFrom(): boolean {
    return this.direction === Direction.From;
  }

  public get isTo(): boolean {
    return this.direction === Direction.To;
  }

  public get isBoth(): boolean {
    return this.bothRequired;
  }

  public get isNegative(): boolean {
    return this.negative;
  }

  public get labelKeyValue(): [string, string] {
    const [key, ...rest] = this.query.split('=');

    return [key, rest.join('=')];
  }

  public get hasMeta(): boolean {
    return this.meta != null && this.meta.length > 0;
  }

  public get podNamespace(): string | null {
    return this.hasMeta ? this.meta! : null;
  }
}
