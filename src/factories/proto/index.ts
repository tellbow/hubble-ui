import * as uipb from '~backend/proto/ui/ui_pb';
import * as flowpb from '~backend/proto/flow/flow_pb';
import { Timestamp } from '~backend/proto/google/protobuf/timestamp_pb';

import { EventParams, EventParamsSet } from '~/api/general/event-stream';

import { ReservedLabel, SpecialLabel } from '~/domain/labels';
import { Filters, TimeRanges } from '~/domain/filtering';
import { entriesToProto } from '~/domain/filtering/fields';
import { CiliumEventTypes } from '~/domain/cilium';
import * as helpers from '~/domain/helpers';

export class ProtoFactory {
  public static getEventsRequestFromFilters(
    f: Filters,
    ep: EventParams = EventParamsSet.EventStream,
  ): uipb.GetEventsRequest {
    const req = uipb.GetEventsRequest.create({
      eventTypes: [],
    });

    if (ep.flows) {
      req.eventTypes.push(uipb.EventType.FLOWS);
    }

    const sinceMs = f.since ? TimeRanges[f.since] : undefined;
    if (sinceMs != null) {
      req.since = Timestamp.fromDate(new Date(Date.now() - sinceMs));
    }

    if (ep.flow) {
      req.eventTypes.push(uipb.EventType.FLOW);
    }

    if (ep.namespaces) {
      req.eventTypes.push(uipb.EventType.K8S_NAMESPACE_STATE);
    }

    if (ep.services) {
      req.eventTypes.push(uipb.EventType.SERVICE_STATE);
    }

    if (ep.serviceLinks) {
      req.eventTypes.push(uipb.EventType.SERVICE_LINK_STATE);
    }

    if (ep.status) {
      req.eventTypes.push(uipb.EventType.STATUS);
    }

    const [wlFlowFilters, blFlowFilters] = ProtoFactory.flowFiltersFromFilters(f);

    const wlFilters = wlFlowFilters.map(ProtoFactory.eventFilterFromFlowFilter);
    const blFilters = blFlowFilters.map(ProtoFactory.eventFilterFromFlowFilter);

    req.whitelist = wlFilters;
    req.blacklist = blFilters;

    return req;
  }

  public static flowFiltersFromFilters(
    filters: Filters,
  ): [flowpb.FlowFilter[], flowpb.FlowFilter[]] {
    const [wlFilters, blEntryFilters] = entriesToProto(
      filters.filters ?? [],
      filters.namespace || null,
      () => ProtoFactory.baseWhitelistFilter(filters),
    );

    return [wlFilters, [...ProtoFactory.blacklistFlowFilters(filters), ...blEntryFilters]];
  }

  public static blacklistFlowFilters(filters?: Filters): flowpb.FlowFilter[] {
    const blFilters: flowpb.FlowFilter[] = [];

    const blSrcLabelsFilter = flowpb.FlowFilter.create();
    const blDstLabelsFilter = flowpb.FlowFilter.create();
    blFilters.push(blSrcLabelsFilter, blDstLabelsFilter);

    blSrcLabelsFilter.sourceLabel.push(ReservedLabel.Unknown);
    blDstLabelsFilter.destinationLabel.push(ReservedLabel.Unknown);

    if (filters?.skipHost) {
      blSrcLabelsFilter.sourceLabel.push(ReservedLabel.Host);
      blDstLabelsFilter.destinationLabel.push(ReservedLabel.Host);
    }

    if (filters?.skipKubeDns) {
      blSrcLabelsFilter.sourceLabel.push(SpecialLabel.KubeDNS);

      const blDstKubeDns = flowpb.FlowFilter.create();
      // TODO: consider this line to remove, as if service is Unmanaged, flows to
      // TOOD: 53 port will be allowed; don't forget to fix `filter-flow.ts` too
      blDstKubeDns.destinationLabel.push(SpecialLabel.KubeDNS);
      blDstKubeDns.destinationPort.push('53');
      blFilters.push(blDstKubeDns);
    }

    if (filters?.skipRemoteNode) {
      blSrcLabelsFilter.sourceLabel.push(ReservedLabel.RemoteNode);
      blDstLabelsFilter.destinationLabel.push(ReservedLabel.RemoteNode);
    }

    if (filters?.skipPrometheusApp) {
      blSrcLabelsFilter.sourceLabel.push(SpecialLabel.PrometheusApp);
      blDstLabelsFilter.destinationLabel.push(SpecialLabel.PrometheusApp);
    }

    // filter out intermediate dns requests
    const blSrcLocalDnsFilter = flowpb.FlowFilter.create();
    const blDstLocalDnsFilter = flowpb.FlowFilter.create();
    blSrcLocalDnsFilter.sourceFqdn.push('*.cluster.local*');
    blDstLocalDnsFilter.destinationFqdn.push('*.cluster.local*');
    blFilters.push(blSrcLocalDnsFilter, blDstLocalDnsFilter);

    return blFilters;
  }

  public static baseWhitelistFilter(filters?: Filters): flowpb.FlowFilter {
    const wlFilter = flowpb.FlowFilter.create();

    const eventTypes: CiliumEventTypes[] = [];
    if (filters?.httpStatus) {
      // Filter by http status code allows only l7 event type
      eventTypes.push(CiliumEventTypes.L7);
      wlFilter.httpStatusCode.push(filters.httpStatus);
    }

    eventTypes.forEach(eventTypeNumber => {
      wlFilter.eventType.push(flowpb.EventTypeFilter.create({ type: eventTypeNumber }));
    });

    filters?.verdicts?.forEach(verdict => {
      wlFilter.verdict.push(helpers.verdict.verdictToPb(verdict));
    });

    // TODO: code for handling tcp flags should be here

    wlFilter.reply.push(false);
    return wlFilter;
  }

  public static eventFilterFromFlowFilter(ff: flowpb.FlowFilter): uipb.EventFilter {
    const filter = uipb.EventFilter.create({
      filter: {
        oneofKind: 'flowFilter',
        flowFilter: ff,
      },
    });

    return filter;
  }

  public static eventsFiltersFromFilters(
    filters: Filters,
  ): [uipb.EventFilter[], uipb.EventFilter[]] {
    const [wlFlowFilters, blFlowFilters] = ProtoFactory.flowFiltersFromFilters(filters);

    const wlFilters = wlFlowFilters.map(ProtoFactory.eventFilterFromFlowFilter);
    const blFilters = blFlowFilters.map(ProtoFactory.eventFilterFromFlowFilter);

    return [wlFilters, blFilters];
  }

  public static eventFiltersFromFlowFilter(flowFilter: flowpb.FlowFilter): uipb.EventFilter {
    const filter = uipb.EventFilter.create();
    filter.filter = {
      oneofKind: 'flowFilter',
      flowFilter,
    };

    return filter;
  }
}
