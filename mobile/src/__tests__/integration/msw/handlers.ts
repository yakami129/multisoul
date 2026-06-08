/**
 * MSW-compatible handler definitions for integration tests.
 * These define the mock HTTP responses for all API endpoints.
 *
 * NOTE: MSW v2's setupServer uses ESM which is incompatible with Jest/CJS in React Native.
 * These handler payloads are used directly by jest.mock in integration tests.
 */
import { type Agent, type Conversation, type WsMessage } from '../../../types';

export const MOCK_AGENT_ID = 'aaaaaaaa-0001-0001-0001-aaaaaaaaaaaa';
export const MOCK_CONV_ID = 'bbbbbbbb-0002-0002-0002-bbbbbbbbbbbb';
export const MOCK_TOKEN_ID = 'cccccccc-0003-0003-0003-cccccccccccc';

export const mockAgent: Omit<Agent, 'endpoint_id' | 'endpoint_label'> = {
  id: MOCK_AGENT_ID,
  name: 'test-agent',
  project_path: '/tmp/test-project',
  runtime: 'claude-code',
  created_at: 1700000000000,
};

export const mockConversation: Conversation = {
  id: MOCK_CONV_ID,
  agent_id: MOCK_AGENT_ID,
  title: 'Test Conversation',
  created_at: 1700000001000,
  last_message_at: 1700000001000,
  status: 'idle',
  model_id: null,
  endpoint_id: 'ep-1',
  agent_name: 'test-agent',
  first_user_message: undefined,
  last_ai_reply: undefined,
};

export const mockMessage: WsMessage = {
  type: 'message',
  seq: 1,
  role: 'user_text',
  payload: { text: 'hello' },
  created_at: 1700000002000,
  answered: undefined,
};

export const mockPushTokenRow = {
  id: MOCK_TOKEN_ID,
  expo_push_token: 'ExponentPushToken[test]',
  device_label: 'iPhone Test',
  endpoint_id: null,
  registered_at: 1700000003000,
};
