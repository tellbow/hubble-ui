import React, { useCallback, memo } from 'react';
import { ItemRenderer, ItemPredicate, Select } from '@blueprintjs/select';
import { Button, MenuItem } from '@blueprintjs/core';

import { NamespaceActivity, NamespaceDescriptor } from '~/domain/namespaces';
import { usePopover } from '~/ui/hooks/usePopover';

import css from './styles.scss';

const ALL_NAMESPACES: NamespaceDescriptor = { namespace: '', relay: false };

// Namespaces carry their recent flow count; those without traffic are dimmed.
const itemRenderer = (activity?: NamespaceActivity | null): ItemRenderer<NamespaceDescriptor> =>
  function renderItem(ns, itemProps) {
    const { handleClick, modifiers } = itemProps;

    if (!modifiers.matchesPredicate) {
      return null;
    }

    if (ns.namespace === '') {
      return (
        <React.Fragment key="__all__">
          <MenuItem onClick={handleClick} text="All namespaces" />
          <li className="bp6-menu-divider" role="separator" />
        </React.Fragment>
      );
    }

    const counts = activity?.byNamespace.get(ns.namespace);

    return (
      <MenuItem
        key={ns.namespace}
        onClick={handleClick}
        text={ns.namespace}
        label={
          counts ? `${counts.flows}${counts.dropped ? ` · ${counts.dropped} dropped` : ''}` : ''
        }
        className={activity && !counts ? css.quietNamespace : undefined}
      />
    );
  };

const filterItem: ItemPredicate<NamespaceDescriptor> = (query, ns, idx, exactMatch) => {
  if (ns.namespace === '') return 'all namespaces'.includes(query.toLowerCase());

  const value = ns.namespace;
  const normalizedTitle = value.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (exactMatch) {
    return normalizedTitle === normalizedQuery;
  } else {
    return value.indexOf(normalizedQuery) >= 0;
  }
};

export interface Props {
  namespaces: NamespaceDescriptor[];
  currentNamespace?: NamespaceDescriptor | null;
  activity?: NamespaceActivity | null;
  onChange?: (ns: NamespaceDescriptor) => void;
}

export const NamespaceSelectorDropdown = memo<Props>(function NamespaceSelectorDropdown(props) {
  const { namespaces, currentNamespace } = props;

  const popover = usePopover();

  // prettier-ignore
  const onChange = useCallback(
    (ns: NamespaceDescriptor) => props.onChange?.(ns),
    [props.onChange]
  );

  const btnIcon = (
    <img src="icons/misc/namespace-icon.svg" className={css.namespacesDropdownButtonIcon} alt="" />
  );

  const dropdownText =
    currentNamespace == null
      ? 'Choose namespace'
      : currentNamespace.namespace === ''
        ? 'All namespaces'
        : currentNamespace.namespace;

  const items = [ALL_NAMESPACES, ...(namespaces || [])];

  return (
    <Select<NamespaceDescriptor>
      resetOnQuery
      resetOnClose
      resetOnSelect
      itemPredicate={filterItem}
      itemRenderer={itemRenderer(props.activity)}
      items={items}
      noResults={<MenuItem disabled={true} text="No matches" />}
      onItemSelect={onChange}
      popoverProps={popover.props}
      inputProps={{ placeholder: 'Filter namespaces…' }}
    >
      <Button
        rightIcon="caret-down"
        icon={btnIcon}
        text={dropdownText}
        onClick={popover.toggle}
        className={css.namespacesDropdownButton}
        alignText="left"
      />
    </Select>
  );
});
