import { observer } from 'mobx-react';
import React, { useCallback, useEffect, useState } from 'react';

import { DragPanel } from '~/components/DragPanel';
import { FlowsTable, TickerEvents, DEFAULT_TS_UPDATE_DELAY, Column } from '~/components/FlowsTable';
import type { Props as FlowsTableProps, OnFlowsDiffCount } from '~/components/FlowsTable';

import { FlowsTableSidebar } from '~/components/FlowsTable/Sidebar';
import type { Props as SidebarProps } from '~/components/FlowsTable/Sidebar';
import {
  LoadingOverlay,
  getProps as getLoadingOverlayProps,
} from '~/components/Misc/LoadingOverlay';

import { DataMode, TransferState } from '~/domain/interactions';
import type { Flow } from '~/domain/flows';
import { downloadFlows } from '~/domain/flows/export';
import { usePanelResize } from './hooks/usePanelResize';
import type { ResizeProps } from './hooks/usePanelResize';

import css from './styles.scss';

export { DEFAULT_TS_UPDATE_DELAY, TickerEvents };
export type { OnFlowsDiffCount };

interface PanelProps {
  namespace: string | null;
  transferState: TransferState;
  flowsWaitTimeout: boolean;
  flowsTableVisibleColumns: Set<Column>;
  onPanelResize?: (resizeProps: ResizeProps) => void;
  onStreamStop?: () => void;
  onFlowsTableColumnToggle?: (_: Column) => void;
}

type TableProps = Omit<FlowsTableProps, 'visibleColumns'>;

export type Props = PanelProps &
  TableProps & {
    onCloseSidebar: SidebarProps['onClose'];
    onSidebarVerdictClick: SidebarProps['onVerdictClick'];
    onSidebarTCPFlagClick: SidebarProps['onTcpFlagClick'];
    onSidebarLabelClick: SidebarProps['onLabelClick'];
    onSidebarPodClick: SidebarProps['onPodClick'];
    onSidebarIdentityClick: SidebarProps['onIdentityClick'];
    onSidebarIpClick: SidebarProps['onIpClick'];
    onSidebarDnsClick: SidebarProps['onDnsClick'];
    onSidebarFilterClick: SidebarProps['onFilterClick'];
    filters: SidebarProps['filters'];
  };

export const DetailsPanel = observer(function DetailsPanel(props: Props) {
  const panelResize = usePanelResize();
  // While paused the table keeps the flows it had; the map stays live.
  const [pausedFlows, setPausedFlows] = useState<Flow[] | null>(null);
  const flows = pausedFlows ?? props.flows;
  const { filters } = props;
  const filtersKey = [
    props.namespace,
    filters.since,
    filters.httpStatus,
    [...(filters.verdicts ?? [])].join(),
    filters.filters?.map(String).join(),
  ].join('|');

  // New filters mean new flows: pausing must not hide them.
  useEffect(() => setPausedFlows(null), [filtersKey]);

  const onStreamStop = useCallback(() => {
    props.onStreamStop?.();
  }, [props.onStreamStop]);

  useEffect(() => {
    props.onPanelResize?.(panelResize.props);
  }, [props.onPanelResize, panelResize.props]);

  const dataMode = props.transferState.dataMode;
  const tableLoaded = flows.length > 0 && dataMode === DataMode.CiliumStreaming;
  const loadingOverlay = getLoadingOverlayProps(
    props.flowsWaitTimeout,
    dataMode,
    props.namespace,
    props.filters.isNarrowed,
  );

  return (
    <div className={css.panel} ref={panelResize.ref} style={panelResize.style}>
      <div className={css.dragPanel}>
        <DragPanel
          flowsTableVisibleColumns={props.flowsTableVisibleColumns}
          onToggleFlowsTableColumn={props.onFlowsTableColumnToggle}
          onResize={panelResize.onResize}
          onStreamStop={onStreamStop}
          isPaused={pausedFlows != null}
          onTogglePause={() => setPausedFlows(p => (p ? null : props.flows.slice()))}
          onExport={format => downloadFlows(flows, props.namespace, format)}
        />
      </div>

      <div className={css.tableWrapper}>
        {tableLoaded ? (
          <FlowsTable
            flows={flows}
            visibleColumns={props.flowsTableVisibleColumns}
            selectedFlow={props.selectedFlow}
            onSelectFlow={props.onSelectFlow}
            onFlowsDiffCount={props.onFlowsDiffCount}
          />
        ) : (
          <LoadingOverlay
            text={loadingOverlay.text.flowsTable}
            isSpinnerHidden={loadingOverlay.isSpinnerHidden}
            spinnerIntent={loadingOverlay.spinnerIntent}
          />
        )}
      </div>

      {props.selectedFlow && (
        <FlowsTableSidebar
          flow={props.selectedFlow}
          filters={props.filters}
          onClose={props.onCloseSidebar}
          onVerdictClick={props.onSidebarVerdictClick}
          onTcpFlagClick={props.onSidebarTCPFlagClick}
          onLabelClick={props.onSidebarLabelClick}
          onPodClick={props.onSidebarPodClick}
          onIdentityClick={props.onSidebarIdentityClick}
          onIpClick={props.onSidebarIpClick}
          onDnsClick={props.onSidebarDnsClick}
          onFilterClick={props.onSidebarFilterClick}
        />
      )}
    </div>
  );
});

export { ResizeProps };
