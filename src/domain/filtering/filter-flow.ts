import { Flow } from '~/domain/flows';
import { FilterEntry } from './filter-entry';
import { entryMatches, flowMatchesEntries } from './fields';

import { Filters } from '~/domain/filtering';

export const filterFlow = (flow: Flow, filters: Filters): boolean => {
  if (filters.namespace != null) {
    if (
      flow.sourceNamespace !== filters.namespace &&
      flow.destinationNamespace !== filters.namespace
    )
      return false;
  }

  if ((filters.verdicts?.size ?? 0) > 0) {
    if (!filters.verdicts?.has(flow.verdict)) return false;
  }

  if (!!filters.skipHost) {
    if (flow.sourceLabelProps.isHost || flow.destinationLabelProps.isHost) {
      return false;
    }
  }

  if (!!filters.skipRemoteNode) {
    const sourceIsRemoteNode = flow.sourceLabelProps.isRemoteNode;
    const destIsRemoteNode = flow.destinationLabelProps.isRemoteNode;

    if (sourceIsRemoteNode || destIsRemoteNode) return false;
  }

  // NOTE: destination port 53 and apporpriate destination label are exactly
  // NOTE: how GetFlowsRequest is built now
  if (!!filters.skipKubeDns) {
    if (
      flow.sourcePort === 53 ||
      (flow.destinationPort === 53 && flow.destinationLabelProps.isKubeDNS)
    )
      return false;
  }

  if (filters.httpStatus != null) {
    if (flow.httpStatus == null) return false;

    const httpStatus = parseInt(filters.httpStatus);
    const lastChar = filters.httpStatus.slice(-1);
    const rangeSign = ['+', '-'].includes(lastChar) ? lastChar : undefined;

    if (!rangeSign && flow.httpStatus !== httpStatus) return false;
    if (rangeSign === '+' && flow.httpStatus < httpStatus) return false;
    if (rangeSign === '-' && flow.httpStatus > httpStatus) return false;
  }

  return flowMatchesEntries(flow, filters.filters ?? [], filters.namespace ?? null);
};

export const filterFlowByEntry = (flow: Flow, filter: FilterEntry, ns: string | null = null) =>
  filter.negative !== entryMatches(flow, filter, ns);
