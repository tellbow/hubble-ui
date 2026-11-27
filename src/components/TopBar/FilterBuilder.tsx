import { Button, MenuItem, PopoverNext } from '@blueprintjs/core';
import { ItemPredicate, ItemRenderer, MultiSelect, Select } from '@blueprintjs/select';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { FilterDirection, FilterEntry, FilterKind } from '~/domain/filtering';
import { fields, Suggestion } from '~/domain/filtering/fields';
import { usePopover } from '~/ui/hooks/usePopover';

import css from './FlowsFilterInput.scss';

export interface Props {
  filters: FilterEntry[];
  onChange?: (filters: FilterEntry[]) => void;
  tags: React.ReactNode;
  suggestions?: () => Map<FilterKind, Suggestion[]>;
}

// One row of the builder: a field, a side, is or is not, and values (OR).
interface Row {
  id: number;
  kind: FilterKind;
  direction: FilterDirection;
  negative: boolean;
  value: string;
}

let nextId = 1;

const newRow = (r: Omit<Row, 'id'>): Row => ({ ...r, id: nextId++ });

// A row is the code mode's text for it, so both modes parse the same way.
const rowText = (r: Row) => {
  const dir = r.direction === FilterDirection.Either ? '' : `${r.direction}-`;
  const value = r.value.replace(/\s*,\s*/g, ',').trim();
  return `${r.negative ? '!' : ''}${dir}${r.kind}:${value}`;
};

const rowsOf = (entries: FilterEntry[]): Row[] => {
  const rows: Row[] = [];
  entries.forEach(e => {
    const same = rows.find(
      r =>
        fields[e.kind].multi &&
        r.kind === e.kind &&
        r.direction === e.direction &&
        r.negative === e.negative,
    );
    if (same) same.value += `,${e.value}`;
    else
      rows.push(
        newRow({ kind: e.kind, direction: e.direction, negative: e.negative, value: e.value }),
      );
  });
  return rows;
};

const build = (rows: Row[]) => {
  const entries: FilterEntry[] = [];
  const errors = new Map<number, string>();
  rows
    .filter(r => r.value.trim())
    .forEach(r => {
      const parsed = FilterEntry.parseInput(rowText(r));
      if (parsed.error) errors.set(r.id, parsed.error);
      else entries.push(...parsed.entries);
    });
  return { entries, errors };
};

const key = (entries: FilterEntry[]) => entries.map(e => e.toString()).join(' ');

const values = (r: Row) =>
  r.value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

interface Choice<T> {
  value: T;
  text: string;
  label?: string;
}

const kindChoices: Choice<FilterKind>[] = Object.values(FilterKind).map(k => ({
  value: k,
  text: k,
  label: fields[k].example.slice(fields[k].example.indexOf(`${k}:`) + k.length + 1),
}));
const sideChoices: Choice<FilterDirection>[] = [
  { value: FilterDirection.Either, text: 'either side' },
  { value: FilterDirection.From, text: 'source' },
  { value: FilterDirection.To, text: 'destination' },
];
const opChoices: Choice<boolean>[] = [
  { value: false, text: 'is' },
  { value: true, text: 'is not' },
];

// Nested menus render inside the builder's popover and keep their clicks, so
// picking from them does not close the builder.
const inside = {
  usePortal: false,
  captureDismiss: true,
  minimal: true,
  placement: 'bottom-start' as const,
};

const item = (
  key: string,
  text: string,
  label: string | undefined,
  { handleClick, modifiers, ref }: Parameters<ItemRenderer<unknown>>[1],
) =>
  modifiers.matchesPredicate ? (
    <MenuItem
      key={key}
      ref={ref}
      text={text}
      label={label}
      active={modifiers.active}
      onClick={handleClick}
      roleStructure="listoption"
    />
  ) : null;

const has = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase());

function Pick<T>(props: {
  label: string;
  choices: Choice<T>[];
  value: T;
  disabled?: boolean;
  filterable?: boolean;
  onPick: (v: T) => void;
}) {
  const current = props.choices.find(c => c.value === props.value)!;
  const predicate: ItemPredicate<Choice<T>> = (q, c) => has(c.text, q);

  return (
    <Select<Choice<T>>
      items={props.choices}
      itemRenderer={(c, p) => item(String(c.value), c.text, c.label, p)}
      itemPredicate={predicate}
      filterable={props.filterable ?? false}
      activeItem={current}
      disabled={props.disabled}
      popoverProps={inside}
      onItemSelect={c => props.onPick(c.value)}
    >
      <Button
        aria-label={props.label}
        text={current.text}
        endIcon="caret-down"
        disabled={props.disabled}
        className={css.builderPick}
      />
    </Select>
  );
}

export const FilterBuilder = (props: Props) => {
  const popover = usePopover();
  const [rows, setRows] = useState(() => rowsOf(props.filters));
  // The filters this builder sent last: others come from elsewhere (a card
  // click, the code mode) and replace the rows.
  const sent = useRef(key(props.filters));

  useEffect(() => {
    const k = key(props.filters);
    if (k === sent.current) return;
    sent.current = k;
    setRows(rowsOf(props.filters));
  }, [props.filters]);

  const { errors } = build(rows);
  const suggestions = useMemo(
    () => (popover.isOpen ? props.suggestions?.() : null) ?? new Map<FilterKind, Suggestion[]>(),
    [popover.isOpen],
  );

  const update = (next: Row[]) => {
    setRows(next);
    const { entries } = build(next);
    const k = key(entries);
    if (k === sent.current) return;
    sent.current = k;
    props.onChange?.(entries);
  };

  const change = (row: Row, patch: Partial<Row>) =>
    update(rows.map(r => (r === row ? { ...r, ...patch } : r)));

  const content = (
    <div className={css.builder}>
      {rows.map(r => {
        const spec = fields[r.kind];
        const error = errors.get(r.id);
        const picked = values(r);
        const offered = (suggestions.get(r.kind) ?? []).filter(s => !picked.includes(s.value));
        const setValues = (vs: string[]) => change(r, { value: vs.join(',') });
        const addValue = (v: string) =>
          setValues(spec.multi ? [...picked, ...v.split(',').map(x => x.trim())] : [v.trim()]);
        const apps = new Set(
          picked.map(v => (suggestions.get(r.kind) ?? []).find(s => s.value === v)?.app),
        );
        const app = r.kind === FilterKind.Pod && apps.size === 1 ? [...apps][0] : undefined;

        return (
          <div key={r.id} className={css.builderRow}>
            <Pick
              label="Field"
              filterable
              choices={kindChoices}
              value={r.kind}
              onPick={kind => {
                const direction = fields[kind].directional ? r.direction : FilterDirection.Either;
                change(r, { kind, direction, value: '' });
              }}
            />
            <Pick
              label="Side"
              choices={sideChoices}
              value={r.direction}
              disabled={!spec.directional}
              onPick={direction => change(r, { direction })}
            />
            <Pick
              label="Operator"
              choices={opChoices}
              value={r.negative}
              onPick={negative => change(r, { negative })}
            />
            <MultiSelect<Suggestion>
              className={css.builderValue}
              fill
              items={offered}
              selectedItems={picked.map(value => ({ value, count: 0 }))}
              itemsEqual="value"
              resetOnSelect
              popoverProps={inside}
              placeholder={picked.length ? '' : spec.example.slice(spec.example.indexOf(':') + 1)}
              tagRenderer={s => s.value}
              tagInputProps={{
                intent: error ? 'danger' : 'none',
                inputProps: { 'aria-label': 'Value' },
                tagProps: { minimal: true },
              }}
              itemPredicate={(q, s) => has(s.value, q)}
              itemRenderer={(s, p) =>
                item(s.value, s.value, s.count > 0 ? String(s.count) : undefined, p)
              }
              createNewItemFromQuery={q => ({ value: q.trim(), count: 0 })}
              createNewItemRenderer={(q, active, handleClick) => (
                <MenuItem
                  key="new"
                  icon="add"
                  text={`Use "${q}"`}
                  active={active}
                  onClick={handleClick}
                  roleStructure="listoption"
                />
              )}
              noResults={<MenuItem disabled text="Not seen on screen: type a value" />}
              onItemSelect={s => addValue(s.value)}
              onRemove={s => setValues(picked.filter(v => v !== s.value))}
            />
            <Button
              variant="minimal"
              icon="cross"
              aria-label="Remove filter"
              onClick={() => update(rows.filter(x => x !== r))}
            />
            {error && <div className={css.builderError}>{error}</div>}
            {app && (
              <div className={css.builderNote}>
                Hubble leaves the pod name out of traffic after the L7 proxy, so a pod filter misses
                it.
                <Button
                  size="small"
                  variant="minimal"
                  intent="primary"
                  text={`Filter by label ${app} instead`}
                  onClick={() => change(r, { kind: FilterKind.Label, value: app })}
                />
              </div>
            )}
          </div>
        );
      })}
      <div className={css.builderFooter}>
        <Button
          size="small"
          icon="add"
          text="Add filter"
          onClick={() =>
            update([
              ...rows,
              newRow({
                kind: FilterKind.Pod,
                direction: FilterDirection.Either,
                negative: false,
                value: '',
              }),
            ])
          }
        />
        <span className={css.builderHint}>Several values: any of them. Several rows: all.</span>
      </div>
    </div>
  );

  return (
    <PopoverNext {...popover.props} placement="bottom-start" content={content}>
      <Button
        fill
        alignText="start"
        className={css.builderTarget}
        endIcon="caret-down"
        onClick={popover.toggle}
        text={
          props.filters.length > 0 ? (
            props.tags
          ) : (
            <span className={css.builderPlaceholder}>Add filters…</span>
          )
        }
      />
    </PopoverNext>
  );
};
