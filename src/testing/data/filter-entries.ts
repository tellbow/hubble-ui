import { FilterEntry } from '~/domain/filtering';
import { ReservedLabel } from '~/domain/labels';

export const filterEntries = {
  fromLabelRegular: FilterEntry.parse(`from-label:k8s:k8s-app=regular-service`),
  toLabelRegular: FilterEntry.parse(`to-label:k8s:k8s-app=regular-service`),
  eitherLabelRegular: FilterEntry.parse(`label:k8s:k8s-app=regular-service`),
  toDnsGoogle: FilterEntry.parse(`to-fqdn:www.google.com`),
  fromDnsGoogle: FilterEntry.parse(`from-fqdn:www.google.com`),
  eitherDnsGoogle: FilterEntry.parse(`fqdn:www.google.com`),
  toDnsTwitterApi: FilterEntry.parse(`to-fqdn:api.twitter.com`),
  fromDnsTwitterApi: FilterEntry.parse(`from-fqdn:api.twitter.com`),
  eitherDnsTwitterApi: FilterEntry.parse(`fqdn:api.twitter.com`),
  fromIpRandom: FilterEntry.parse(`from-ip:153.82.167.250`),
  toIpRandom: FilterEntry.parse(`to-ip:153.82.167.250`),
  eitherIpRandom: FilterEntry.parse(`ip:153.82.167.250`),
  fromLabelWorld: FilterEntry.parse(`from-label:${ReservedLabel.World}`),
  toLabelWorld: FilterEntry.parse(`to-label:${ReservedLabel.World}`),
  eitherLabelWorld: FilterEntry.parse(`label:${ReservedLabel.World}`),
  fromPodCrawler: FilterEntry.parse(`from-pod:crawler-864b5f8656-np5jj`),
  toPodCrawler: FilterEntry.parse(`to-pod:crawler-864b5f8656-np5jj`),
  eitherPodCrawler: FilterEntry.parse(`pod:crawler-864b5f8656-np5jj`),
  fromRegularWorkload: FilterEntry.parse(`from-workload:StatefulSets:regular`),
  toRegularWorkload: FilterEntry.parse(`to-workload:StatefulSets:regular`),
  eitherRegularWorkload: FilterEntry.parse(`workload:StatefulSets:regular`),
};
