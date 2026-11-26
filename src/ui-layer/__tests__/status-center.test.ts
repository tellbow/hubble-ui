import { CustomError } from '~/api/customprotocol-core/errors';
import { StatusCenter } from '~/ui-layer/status-center';
import { Component, Intent } from '~/ui/status-center';

describe('StatusCenter messages', () => {
  test('spells the server error title correctly and retains error details', () => {
    const center = new StatusCenter({ maxNotifications: 10 });
    const error = new CustomError(0, 13, 'connection failed');

    center.pushControlStreamError(error);

    expect(center.list[0].title).toBe('Server error occurred');
    expect(center.list[0].details).toBe(error.toString());
    expect(center.list[0].component).toBe(Component.HubbleUI);
    expect(center.list[0].intent).toBe(Intent.Critical);
  });

  test('shows a server error repeated by a retrying stream once', () => {
    const center = new StatusCenter({ maxNotifications: 10 });
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const err = () => new CustomError(1, 3, 'invalid IP address "foo" in filter');
      center.pushControlStreamErrors([err()]);
      center.pushStreamsReconnecting();
      center.pushControlStreamErrors([err()]);

      const errors = center.list.filter(e => e.title === 'Server error occurred');
      expect(errors).toHaveLength(1);
    } finally {
      debug.mockRestore();
    }
  });

  test('closes the namespace quote and uses the correct verb when observed', () => {
    const center = new StatusCenter({ maxNotifications: 10 });
    const log = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      center.pushNamespaceIsNotObserved('team-a');
      center.pushNamespaceIsObserved({ namespace: 'team-a', relay: true });

      expect(center.list[0].title).toBe('Namespace "team-a" has appeared');
      expect(center.list[0].details).toBe('Hubble UI is capturing the namespace activity');
      expect(center.list[0].intent).toBe(Intent.Info);
    } finally {
      log.mockRestore();
    }
  });
});
