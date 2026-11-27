import React, { useCallback, useEffect, useState, useRef } from 'react';
import { observer } from 'mobx-react';
import * as mobx from 'mobx';

import { TopBar } from '~/components/TopBar';
import { DetailsPanel, ResizeProps as DetailsResizeProps } from '~/components/DetailsPanel';

import { Map } from '~/components/Map';
import { FlowsSankey } from '~/components/FlowsSankey';
import { SegmentedControl } from '@blueprintjs/core';
import {
  getProps as getLoadingOverlayProps,
  LoadingOverlay,
} from '~/components/Misc/LoadingOverlay';
import { ServiceMapCard } from '~/components/ServiceMapCard';
import { CardProps } from '~/components/Card';
import { ServiceMapArrowsRenderer } from '~/components/ServiceMapArrowRenderer';
import { WelcomeScreen } from './WelcomeScreen';

import { Verdict, TCPFlagName, PodSelector } from '~/domain/hubble';
import { ServiceCard } from '~/domain/service-map';
import { KV, Labels } from '~/domain/labels';
import { FilterEntry, FilterDirection } from '~/domain/filtering';
import { valueSuggestions } from '~/domain/filtering/fields';

import { useApplication } from '~/application';

import { sizes } from '~/ui/vars';
import { useFlowsTableColumns } from './hooks/useColumns';
import css from './styles.scss';

type View = 'map' | 'sankey';
const viewKey = 'hubble-ui-view';

const savedView = (): View => {
  try {
    return localStorage.getItem(viewKey) === 'sankey' ? 'sankey' : 'map';
  } catch {
    return 'map';
  }
};

export const ServiceMapApp = observer(function ServiceMapApp() {
  const [view, setView] = useState<View>(savedView);
  const onViewChange = (v: string) => {
    setView(v as View);
    try {
      localStorage.setItem(viewKey, v);
    } catch {
      // the view is only a convenience
    }
  };

  const { store, ui, dataLayer } = useApplication();

  const onFlowsDiffCount = useRef<((diff: number) => void) | null>(null);
  const [mapVisibleHeight, setMapVisibleHeight] = useState<number | null>(null);
  const [mapWasDragged, setMapWasDragged] = useState(false);
  const flowsTableColumns = useFlowsTableColumns();
  const [flowsWaitTimeout, setFlowsWaitTimeout] = useState<boolean>(false);

  useEffect(() => {
    if (!store.namespaces.current) return;
    setFlowsWaitTimeout(false);

    const stop = setTimeout(() => {
      setFlowsWaitTimeout(true);
    }, 5000);

    return () => clearTimeout(stop);
  }, [store.namespaces.current]);

  useEffect(() => {
    return dataLayer.serviceMap
      .onFlowsDiffCount((diff, frame) => {
        if (store.currentFrame !== frame) return;

        onFlowsDiffCount.current?.(diff);
      })
      .disposer()
      .asFunction();
  }, [store.currentFrame]);

  useEffect(() => {
    setMapWasDragged(false);
  }, [store.filters]);

  const onCardSelect = useCallback((srvc: ServiceCard) => {
    ui.serviceMap.onCardSelect(srvc);
  }, []);

  const onCloseFlowsTableSidebar = useCallback(() => {
    store.controls.selectTableFlow(null);
  }, []);

  const onPanelResize = useCallback((resizeProps: DetailsResizeProps) => {
    const vh = resizeProps.panelTopInPixels - sizes.topBarHeight;
    setMapVisibleHeight(vh);
  }, []);

  const onMapDrag = useCallback((val: boolean) => {
    setMapWasDragged(val);
  }, []);

  const onSidebarVerdictClick = useCallback((v: Verdict | null) => {
    ui.controls.toggleVerdict(v);
  }, []);

  // A click in the flow details adds its filter, or removes it when it is on.
  const toggleFilter = (entry: FilterEntry) => {
    const on = store.controls.flowFilters.some(f => f.toString() === entry.toString());
    const [next] = FilterEntry.combine(
      store.controls.flowFilters,
      on ? [] : [entry],
      on ? [entry] : [],
    );
    ui.controls.setFlowFilters(next);
  };

  const onSidebarTCPFlagClick = useCallback((flag?: TCPFlagName, dir?: FilterDirection) => {
    if (flag && dir) toggleFilter(FilterEntry.newTCPFlag(flag).setDirection(dir));
  }, []);

  const onSidebarLabelClick = useCallback((label?: KV, dir?: FilterDirection) => {
    if (label && dir) toggleFilter(FilterEntry.newLabel(Labels.concatKV(label)).setDirection(dir));
  }, []);

  const onSidebarPodClick = useCallback((podSelector?: PodSelector, dir?: FilterDirection) => {
    if (podSelector && dir) toggleFilter(FilterEntry.newPodSelector(podSelector).setDirection(dir));
  }, []);

  const onSidebarIdentityClick = useCallback((identity?: string, dir?: FilterDirection) => {
    if (identity != null && dir) toggleFilter(FilterEntry.newIdentity(identity).setDirection(dir));
  }, []);

  const onSidebarIpClick = useCallback((ip?: string, dir?: FilterDirection) => {
    if (ip != null && dir) toggleFilter(FilterEntry.newIP(ip).setDirection(dir));
  }, []);

  const onSidebarDnsClick = useCallback((dns?: string) => {
    if (dns != null) toggleFilter(FilterEntry.newDNS(dns).setDirection(FilterDirection.Either));
  }, []);

  const onSidebarFilterClick = useCallback((text: string) => {
    FilterEntry.parseMany(text).forEach(toggleFilter);
  }, []);

  const cardRenderer = mobx.action((props: CardProps<ServiceCard>) => {
    const l7endpoints = store.currentFrame.interactions.l7endpoints;

    return (
      <ServiceMapCard
        {...props}
        key={props.card.id}
        active={ui.serviceMap.isCardActive(props.card)}
        isUnsizedMode={props.isUnsizedMode}
        collector={ui.serviceMap.collector}
        currentNamespace={store.namespaces.current?.namespace}
        className={props.className}
        l7endpoints={l7endpoints.forReceiver(props.card.id)}
        maxHttpEndpointsVisible={5}
        isClusterMeshed={store.currentFrame.services.isClusterMeshed}
        onHeaderClick={onCardSelect}
      />
    );
  });

  const loadingOverlay = getLoadingOverlayProps(
    flowsWaitTimeout,
    dataLayer.transferState.dataMode,
    store.namespaces.current?.namespace,
    store.filters.isNarrowed,
  );

  const RenderedTopBar = (
    <TopBar
      transferState={dataLayer.transferState}
      status={dataLayer.transferState.deploymentStatus || undefined}
      namespaces={store.availableNamespaces}
      namespaceActivity={store.namespaces.activity}
      currentNamespace={store.currentNamespace}
      onNamespaceChange={ns => ui.controls.namespaceChanged(ns?.namespace)}
      selectedVerdict={store.controls.activeVerdict}
      onVerdictChange={v => ui.controls.toggleVerdict(v)}
      selectedHttpStatus={store.controls.httpStatus}
      onHttpStatusChange={store.controls.setHttpStatus}
      since={store.controls.since}
      onSinceChange={since => ui.controls.setSince(since)}
      flowFilters={store.controls.flowFilters}
      onChangeFlowFilters={ff => ui.controls.setFlowFilters(ff)}
      flowFilterSuggestions={() =>
        valueSuggestions(
          store.currentFrame.interactions.flows,
          store.currentNamespace?.namespace || null,
        )
      }
      showHost={ui.controls.isHostShown}
      onShowHostToggle={() => ui.controls.toggleShowHost()}
      showKubeDns={store.controls.showKubeDns}
      onShowKubeDnsToggle={() => ui.controls.toggleShowKubeDNS()}
      showRemoteNode={store.controls.showRemoteNode}
      onShowRemoteNodeToggle={() => ui.controls.toggleShowRemoteNode()}
      showPrometheusApp={store.controls.showPrometheusApp}
      onShowPrometheusAppToggle={() => ui.controls.toggleShowPrometheusApp()}
    />
  );

  if (!store.currentNamespace) {
    return (
      <div className={css.app}>
        {RenderedTopBar}
        <WelcomeScreen
          namespaces={store.availableNamespaces}
          activity={store.namespaces.activity}
          onNamespaceChange={ns => ui.controls.namespaceChanged(ns?.namespace)}
        />
      </div>
    );
  }

  return (
    <div className={css.app}>
      {RenderedTopBar}

      <div
        className={css.map}
        onClick={e => {
          const target = (e.target as Element).closest('[data-drops-to]');
          const cardId = target?.getAttribute('data-drops-to');
          if (cardId) ui.serviceMap.showDropsTo(cardId);
        }}
      >
        <SegmentedControl
          small
          className={css.viewSwitch}
          value={view}
          onValueChange={onViewChange}
          options={[
            { label: 'Map', value: 'map', icon: 'graph' },
            { label: 'Sankey', value: 'sankey', icon: 'flow-branch' },
          ]}
        />
        {view === 'sankey' ? (
          <FlowsSankey
            flows={store.currentFrame.interactions.flows}
            namespace={store.currentNamespace?.namespace || null}
            onFilter={text => {
              const added = FilterEntry.parseMany(text);
              const [next, changed] = FilterEntry.combine(store.controls.flowFilters, added);
              if (changed) ui.controls.setFlowFilters(next);
            }}
          />
        ) : store.currentFrame.services.cardsList.length > 0 ? (
          <Map
            namespaceBBoxes={ui.serviceMap.placement.namespaceBBoxes}
            placement={ui.serviceMap.placement}
            arrows={ui.serviceMap.arrows}
            arrowsRenderer={ServiceMapArrowsRenderer}
            cards={store.currentFrame.services.cardsList}
            cardRenderer={cardRenderer}
            visibleHeight={mapVisibleHeight ?? 0}
            wasDragged={mapWasDragged}
            onMapDrag={onMapDrag}
            onCardMutated={() => ui.serviceMap.cardsMutationsObserved()}
          />
        ) : (
          <LoadingOverlay
            height={mapVisibleHeight ?? '50%'}
            text={loadingOverlay.text.map}
            spinnerIntent={loadingOverlay.spinnerIntent}
            isSpinnerHidden={loadingOverlay.isSpinnerHidden}
          />
        )}
      </div>

      <DetailsPanel
        namespace={store.namespaces.current?.namespace ?? null}
        transferState={dataLayer.transferState}
        flowsWaitTimeout={flowsWaitTimeout}
        flows={store.currentFrame.interactions.flows}
        flowsTableVisibleColumns={flowsTableColumns.visible}
        filters={store.filters}
        selectedFlow={store.controls.selectedTableFlow}
        onSelectFlow={store.controls.selectTableFlow}
        onCloseSidebar={onCloseFlowsTableSidebar}
        onSidebarVerdictClick={onSidebarVerdictClick}
        onSidebarTCPFlagClick={onSidebarTCPFlagClick}
        onSidebarLabelClick={onSidebarLabelClick}
        onSidebarPodClick={onSidebarPodClick}
        onSidebarIdentityClick={onSidebarIdentityClick}
        onSidebarIpClick={onSidebarIpClick}
        onSidebarDnsClick={onSidebarDnsClick}
        onSidebarFilterClick={onSidebarFilterClick}
        onPanelResize={onPanelResize}
        onFlowsDiffCount={onFlowsDiffCount}
        onFlowsTableColumnToggle={flowsTableColumns.toggle}
      />
    </div>
  );
});
