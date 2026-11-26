import { Spinner, Intent } from '@blueprintjs/core';
import React, { memo } from 'react';

import css from './LoadingOverlay.scss';
import { DataMode } from '~/domain/interactions';

export interface Props {
  text: string;
  height?: string | number;
  spinnerSize?: number;
  spinnerIntent?: Intent;
  isSpinnerHidden?: boolean;
}

export const LoadingOverlay = memo<Props>(function LoadingOverlay(props) {
  const { height = '100%' } = props;
  const style = { height };

  return (
    <div className={css.wrapper} style={style}>
      {!props.isSpinnerHidden && (
        <Spinner size={props.spinnerSize ?? 68} intent={props.spinnerIntent ?? 'primary'} />
      )}
      <div className={css.label}>{props.text}</div>
    </div>
  );
});

export interface GetProps {
  text: {
    map: string;
    flowsTable: string;
  };

  isSpinnerHidden: boolean;
  spinnerIntent: Intent;
}

export const getProps = (
  flowsWaitTimeout: boolean,
  dataMode: DataMode,
  namespace?: string | null,
  filtered = false,
): GetProps => {
  const spinnerIntent = flowsWaitTimeout ? Intent.NONE : Intent.SUCCESS;
  // NOTE: '' is "All namespaces"
  const where =
    namespace === '' ? 'any namespace' : namespace ? `namespace ${namespace}` : 'this namespace';

  let flowsTable = 'No flows found for specified time range.';
  let map = 'No data found to render a service map';
  if (dataMode === DataMode.CiliumStreaming && !flowsWaitTimeout) {
    flowsTable = map = 'Waiting for flows…';
  } else if (dataMode === DataMode.CiliumStreaming) {
    map = filtered ? 'No flows match the current filters.' : `No traffic seen in ${where}.`;
    flowsTable =
      `${map} Hubble shows the traffic of pods in the namespace: check that they are running ` +
      `and sending traffic${filtered ? ', or clear the filters' : ''}. New flows appear here as they arrive.`;
  } else if (dataMode === DataMode.Disabled) {
    flowsTable = map = 'Data fetching is disabled';
  }

  const text = { flowsTable, map };
  const isSpinnerHidden = dataMode !== DataMode.CiliumStreaming || flowsWaitTimeout;

  return { text, isSpinnerHidden, spinnerIntent };
};
