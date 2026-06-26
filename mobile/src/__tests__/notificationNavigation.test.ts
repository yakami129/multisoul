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

  it('passes project context through task notification routes', () => {
    expect(
      getNotificationNavTarget({
        type: 'task_completed',
        resource_id: 'agent-1',
        resource_name: 'Codex Runtime',
        conversation_id: 'conv-1',
        endpoint_id: 'endpoint-1',
        project_id: 'project-1',
      }),
    ).toBe(
      '/chat/conv-1?endpoint_id=endpoint-1&agent_id=agent-1&agent_name=Codex%20Runtime&project_id=project-1',
    );
  });

  it('opens ask-question push notifications on the pending decision', () => {
    expect(
      getNotificationNavTarget({
        type: 'ask_question',
        resourceId: 'agent-1',
        convId: 'conv-1',
        endpointId: 'endpoint-1',
        projectId: 'project-1',
        inbox_id: 'ask-1',
      }),
    ).toBe(
      '/chat/conv-1?endpoint_id=endpoint-1&agent_id=agent-1&project_id=project-1&focus_ask_id=ask-1',
    );
  });
});
