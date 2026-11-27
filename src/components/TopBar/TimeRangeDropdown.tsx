import { Icon, Menu, MenuDivider, MenuItem, PopoverNext } from '@blueprintjs/core';
import React, { memo } from 'react';
import classnames from 'classnames';

import { usePopover } from '~/ui/hooks/usePopover';

import { FilterIcon } from './FilterIcon';

import css from './styles.scss';

export interface Props {
  since: string | null;
  onSelect?: (since: string | null) => void;
}

// Keys are the ones of `TimeRanges`; null is everything relay still buffers.
// Like `hubble observe --since`: a start point, then new flows keep coming.
const options: [string | null, string][] = [
  [null, 'All buffered'],
  ['5m', 'Since 5 min ago'],
  ['15m', 'Since 15 min ago'],
  ['1h', 'Since 1 h ago'],
  ['6h', 'Since 6 h ago'],
];

export const TimeRangeDropdown = memo<Props>(function TimeRangeDropdown(props) {
  const popover = usePopover();
  const label = options.find(([since]) => since === props.since)?.[1] ?? options[0][1];

  const content = (
    <Menu>
      {options.map(([since, title]) => (
        <MenuItem
          key={String(since)}
          active={props.since === since}
          text={title}
          onClick={() => props.onSelect?.(since)}
        />
      ))}
      <MenuDivider />
      <li className={css.timeRangeHint}>
        Each node keeps only its newest flows, often a few minutes&apos; worth: older ones may be
        gone.
      </li>
    </Menu>
  );

  return (
    <PopoverNext {...popover.props} content={content}>
      <FilterIcon
        icon={<Icon icon="time" size={12} />}
        text={label}
        onClick={popover.toggle}
        className={classnames({ [css.visualFilterEnabled]: props.since != null })}
      />
    </PopoverNext>
  );
});
