import { policyNames } from '~/domain/helpers/flows';

describe('policyNames', () => {
  test('names namespaced and clusterwide policies', () => {
    expect(
      policyNames([
        { name: 'allow-web', namespace: 'shop', labels: [] },
        { name: 'allow-dns', namespace: '', labels: [] },
      ]),
    ).toEqual(['shop/allow-web', 'allow-dns']);
  });

  test("names the agent's own policies after where they come from", () => {
    expect(
      policyNames([
        {
          name: '',
          namespace: '',
          labels: ['reserved:io.cilium.policy.derived-from=allow-localhost-ingress'],
        },
        { name: '', namespace: '', labels: ['k8s:other=x'] },
      ]),
    ).toEqual(['<cilium-internal>/allow-localhost-ingress', '<cilium-internal>/unknown']);
  });

  test('no policies', () => {
    expect(policyNames(undefined)).toEqual([]);
  });
});
