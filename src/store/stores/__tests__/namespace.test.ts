import { StateChange } from '~/domain/misc';
import { NamespaceStore } from '~/store/stores/namespace';

describe('NamespaceStore.applyChange', () => {
  test('a deleted namespace leaves the list', () => {
    const s = new NamespaceStore();
    s.applyChange({ namespace: 'shop', relay: true }, StateChange.Added);
    s.applyChange({ namespace: 'gone', relay: true }, StateChange.Added);
    s.applyChange({ namespace: 'gone', relay: true }, StateChange.Deleted);

    expect(s.relayNamespaces.map(ns => ns.namespace)).toEqual(['shop']);
  });

  test('a namespace created again comes back', () => {
    const s = new NamespaceStore();
    s.applyChange({ namespace: 'again', relay: true }, StateChange.Added);
    s.applyChange({ namespace: 'again', relay: true }, StateChange.Deleted);
    s.applyChange({ namespace: 'again', relay: true }, StateChange.Added);

    expect(s.relayNamespaces.map(ns => ns.namespace)).toEqual(['again']);
  });
});
