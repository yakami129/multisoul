import { getNotificationNavTarget } from '../services/notificationNavigation';

describe('notification navigation target', () => {
  it('opens existing conversations in the canonical chat detail route', () => {
    expect(
      getNotificationNavTarget({
        type: 'task_completed',
        agentId: 'agent-1',
        convId: 'conv-1',
        endpointId: 'endpoint-1',
      }),
    ).toBe('/chat/conv-1?endpoint_id=endpoint-1&agent_id=agent-1');
  });
});
