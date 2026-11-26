import React from 'react';
import { Spinner } from '@blueprintjs/core';
import { observer } from 'mobx-react';

import { NamespaceActivity, NamespaceDescriptor } from '~/domain/namespaces';
import { NamespaceSelectorDropdown } from '../TopBar/NamespaceSelectorDropdown';
import { clickable } from '~/ui/a11y';

import css from './WelcomeScreen.scss';
import hubbleLogo from '~/assets/images/hubble-logo.png';

export interface Props {
  namespaces: NamespaceDescriptor[];
  activity?: NamespaceActivity | null;
  onNamespaceChange: (namespace: NamespaceDescriptor) => void;
}

export const WelcomeScreen = observer(function WelcomeScreen(props: Props) {
  const someNamespacesLoaded = props.namespaces.length > 0;

  return (
    <div className={css.wrapper}>
      <div className={css.content}>
        <img src={hubbleLogo} className={css.logo} alt="Hubble" />
        <h1 className={css.title}>Welcome!</h1>
        <p className={css.description}>To begin select one of the namespaces:</p>
        {someNamespacesLoaded ? (
          <NamespaceSelectorDropdown
            namespaces={props.namespaces}
            activity={props.activity}
            currentNamespace={null}
            onChange={props.onNamespaceChange}
          />
        ) : (
          <div className={css.spinnerWrapper}>
            <Spinner size={48} intent="primary" />
          </div>
        )}
        {props.activity && someNamespacesLoaded && (
          <Overview
            activity={props.activity}
            namespaces={props.namespaces}
            onNamespaceChange={props.onNamespaceChange}
          />
        )}
      </div>
    </div>
  );
});

// The namespaces with traffic, busiest first: where to look.
const Overview = function Overview(props: Props & { activity: NamespaceActivity }) {
  const { activity } = props;
  const rows = props.namespaces
    .filter(ns => activity.byNamespace.has(ns.namespace))
    .map(ns => ({ ns, ...activity.byNamespace.get(ns.namespace)! }))
    .sort((a, b) => b.flows - a.flows);
  const quiet = props.namespaces.length - rows.length;

  return (
    <div className={css.overview}>
      <table className={css.activity}>
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Flows</th>
            <th>Dropped</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.ns.namespace} {...clickable(() => props.onNamespaceChange(row.ns))}>
              <td>{row.ns.namespace}</td>
              <td>{row.flows}</td>
              <td className={row.dropped > 0 ? css.dropped : undefined}>{row.dropped}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.note}>
        {rows.length === 0 ? 'No namespace has traffic' : 'Counted'} in the cluster&apos;s{' '}
        {activity.counted} newest flows.
        {quiet > 0 && ` ${quiet} namespace${quiet === 1 ? ' has' : 's have'} no traffic in them.`}
      </p>
    </div>
  );
};
