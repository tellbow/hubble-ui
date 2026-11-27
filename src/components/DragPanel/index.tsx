import React, { memo } from 'react';
import { Button, Menu, MenuItem, PopoverNext } from '@blueprintjs/core';
import { animated } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';

import {
  FlowsTableColumnsSelector,
  Props as FlowsTableColumnsSelectorProps,
} from '~/components/FlowsTable/ColumnsSelector';

import type { ExportFormat } from '~/domain/flows/export';
import { usePopover } from '~/ui/hooks/usePopover';

import css from './styles.scss';

export interface Props {
  flowsTableVisibleColumns: FlowsTableColumnsSelectorProps['visibleColumns'];
  onToggleFlowsTableColumn: FlowsTableColumnsSelectorProps['onToggleColumn'];
  onResize?: (dy: number) => void;
  onStreamStop?: () => void;
  isPaused?: boolean;
  onTogglePause?: () => void;
  onExport?: (format: ExportFormat) => void;
}

export const Component = function DragPanelComponent(props: Props) {
  const exportMenu = usePopover();
  const bind = useDrag(e => {
    const dy = (e as any).delta[1];
    props.onResize && props.onResize(dy);
  });

  return (
    <animated.div {...bind()} className={css.dragPanel}>
      <div className={css.left}>
        <FlowsTableColumnsSelector
          visibleColumns={props.flowsTableVisibleColumns}
          onToggleColumn={props.onToggleFlowsTableColumn}
        />
      </div>
      <div className={css.center} />
      <div className={css.right}>
        <Button
          variant="minimal"
          size="small"
          icon={props.isPaused ? 'play' : 'pause'}
          text={props.isPaused ? 'Resume' : 'Pause'}
          title={props.isPaused ? 'Show new flows again' : 'Stop the table from updating'}
          onClick={props.onTogglePause}
        />
        <PopoverNext
          {...exportMenu.props}
          placement="bottom-end"
          content={
            <Menu>
              <MenuItem
                text="Hubble JSON"
                label="all fields"
                onClick={() => props.onExport?.('json')}
              />
              <MenuItem
                text="CSV"
                label="for spreadsheets"
                onClick={() => props.onExport?.('csv')}
              />
            </Menu>
          }
        >
          <Button
            variant="minimal"
            size="small"
            icon="download"
            endIcon="chevron-down"
            text="Export"
            title="Download the flows in the table"
            onClick={exportMenu.toggle}
          />
        </PopoverNext>
      </div>
    </animated.div>
  );
};

export const DragPanel = memo<Props>(Component);
DragPanel.displayName = 'DragPanelMemoized';
