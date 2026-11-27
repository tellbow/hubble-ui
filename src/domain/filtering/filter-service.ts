import { Service, ServiceCard } from '~/domain/service-map';
import { Labels } from '~/domain/labels';

import { Filters } from './filters';
import { FilterEntry } from './filter-entry';
import { workloadMatches } from './fields';

export const filterService = (svc: ServiceCard, filters: Filters): boolean => {
  if (filters.skipHost && svc.isHost) return false;
  if (filters.skipRemoteNode && svc.isRemoteNode) return false;
  if (filters.skipPrometheusApp && svc.isPrometheusApp) return false;
  return true;
};

export const filterServiceByEntry = (service: Service, e: FilterEntry): boolean => {
  let pass = true;
  if (e.isIdentity) pass = service.identity.toString() === e.query;

  if (e.isLabel) {
    pass = !!Labels.findKVByString(service.labels, e.query);
  }

  if (e.isDNS) {
    const query = e.query.toLowerCase();
    pass = service.dnsNames.some(name => name.toLowerCase() === query) || service.id === e.query;
  }

  if (e.isWorkload) {
    pass = workloadMatches(service.workloads, e.asWorkload());
  }

  return e.negative ? e.negative !== pass : pass;
};
