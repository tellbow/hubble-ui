import { Button, Classes, MenuItem, SegmentedControl } from '@blueprintjs/core';
import { ItemRenderer, MultiSelect } from '@blueprintjs/select';
import React, { useCallback, useRef, useState } from 'react';

import { FilterBuilder } from './FilterBuilder';
import { TagDirection } from './TagDirection';

import { FilterEntry, FilterKind } from '~/domain/filtering';
import { fields, Suggestion } from '~/domain/filtering/fields';
import { Labels } from '~/domain/labels';

import css from './FlowsFilterInput.scss';

interface Props {
  filters: FilterEntry[];
  onChange?: (filters: FilterEntry[]) => void;
  suggestions?: () => Map<FilterKind, Suggestion[]>;
}

type Mode = 'builder' | 'code';
const modeKey = 'hubble-ui-filter-mode';

const savedMode = (): Mode => {
  try {
    return localStorage.getItem(modeKey) === 'builder' ? 'builder' : 'code';
  } catch {
    return 'code';
  }
};

// Like Grafana's query editors: a builder of field, operator and value, and
// the query as text. Both edit the same filters.
export const FlowsFilterInput = (props: Props) => {
  const [mode, setMode] = useState<Mode>(savedMode);

  const onModeChange = (m: string) => {
    setMode(m as Mode);
    try {
      localStorage.setItem(modeKey, m);
    } catch {
      // the mode is only a convenience
    }
  };

  return (
    <div className={css.container}>
      <SegmentedControl
        small
        className={css.mode}
        value={mode}
        onValueChange={onModeChange}
        options={[
          { label: 'Builder', value: 'builder' },
          { label: 'Code', value: 'code' },
        ]}
      />
      {mode === 'builder' ? (
        <FilterBuilder
          filters={props.filters}
          onChange={props.onChange}
          suggestions={props.suggestions}
          tags={<span className={css.builderTags}>{props.filters.map(tagRenderer)}</span>}
        />
      ) : (
        <FilterCode filters={props.filters} onChange={props.onChange} />
      )}
    </div>
  );
};

const FilterCode = (props: Props) => {
  const [userInput, setUserInput] = useState<string>('');
  // MultiSelect selects created items one by one: gather them into one change.
  const added = useRef<FilterEntry[] | null>(null);

  const onClear = useCallback(() => {
    props.onChange?.([]);
  }, [props.onChange]);

  const createNewItemRenderer = useCallback(
    (query: string, active: boolean, handleClick: React.MouseEventHandler<HTMLElement>) => {
      const { entries, error } = FilterEntry.parseInput(query);
      if (error != null) {
        return <MenuItem disabled multiline intent="danger" icon="error" text={error} />;
      }

      return (
        <MenuItem
          onClick={handleClick}
          active={active}
          icon="add"
          text={entries.map(e => e.toString()).join('  ')}
          label="Enter"
        />
      );
    },
    [],
  );

  const createNewItemFromQuery = (query: string) => {
    const { entries, error } = FilterEntry.parseInput(query);
    return error == null ? entries : (undefined as unknown as FilterEntry[]);
  };

  // prettier-ignore
  const onItemSelect = useCallback((item: FilterEntry | null) => {
    if (!item) return;

    if (added.current == null) {
      added.current = [];
      queueMicrotask(() => {
        const [all] = FilterEntry.combine(props.filters, added.current);
        added.current = null;
        props.onChange?.(all);
      });
    }

    added.current.push(item);
    setUserInput('');
  }, [props.filters, props.onChange]);

  // prettier-ignore
  const handleTagDelete = useCallback((val: React.ReactNode, idx: number) => {
    props.onChange?.(
      props.filters.filter((_: FilterEntry, i: number) => i !== idx),
    );
  }, [props.filters, props.onChange]);

  const rightElement = props.filters.length ? (
    <Button minimal icon="cross" onClick={onClear} />
  ) : undefined;

  return (
    <MultiSelect
      initialContent={null}
      className={css.code}
      query={userInput}
      selectedItems={props.filters}
      onQueryChange={setUserInput}
      onItemSelect={onItemSelect}
      createNewItemFromQuery={createNewItemFromQuery}
      createNewItemRenderer={createNewItemRenderer}
      itemRenderer={itemRenderer}
      tagRenderer={tagRenderer}
      itemPredicate={useCallback(() => false, [])}
      items={[]}
      popoverProps={{
        minimal: true,
        usePortal: true,
        openOnTargetFocus: false,
      }}
      resetOnSelect={true}
      openOnKeyDown={true}
      noResults={<MenuItem disabled={true} text="No results." />}
      tagInputProps={{
        onRemove: handleTagDelete,
        tagProps: { minimal: true },
        rightElement: rightElement,
        className: Classes.INPUT,
        // Spaces belong to the query: they separate filters.
        separator: false,
        placeholder: 'Filter flows, e.g. pod:frontend to-port:443 !label:app=db',
      }}
    />
  );
};

const itemRenderer: ItemRenderer<FilterEntry | null> = () => {
  return null;
};

export function tagRenderer(item: FilterEntry | null) {
  if (!item) return null;

  const query = item.kind === FilterKind.Label ? Labels.normalizeKey(item.query) : item.query;

  return (
    <div className={css.tag} key={item.toString()}>
      {fields[item.kind].directional && <TagDirection direction={item.direction} />}
      <span className={css.body}>
        {item.negative && <span className={css.negative}>!</span>}
        <span className={css.kind}>{item.kind}</span>
        <span className={css.separator}>:</span>
        <span className={css.query}>{query}</span>
        {item.meta && <span className={css.meta}>{item.isPod ? `${item.meta}/` : item.meta}</span>}
      </span>
    </div>
  );
}
