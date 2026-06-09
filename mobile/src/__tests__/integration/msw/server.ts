/**
 * Integration test server abstraction.
 * Uses jest interceptors to mock HTTP responses for integration tests.
 * MSW v2's setupServer requires ESM which is incompatible with Jest/CJS in React Native.
 * This module provides the same lifecycle API (listen/resetHandlers/close) with jest mocks.
 */

import { handlers } from './handlers';

type HandlerEntry = {
  method: string;
  urlPattern: string;
  handler: (req: Request) => Response | Promise<Response>;
};

// Parse handler definitions from the handlers array
// The server lifecycle is managed by jest.mock at the axios level.

export const server = {
  listen: (_opts?: { onUnhandledRequest?: string }) => {
    // no-op: mocking done at jest.mock level
  },
  resetHandlers: (..._overrides: HandlerEntry[]) => {
    // no-op: each test file sets up its own mocks
  },
  close: () => {
    // no-op
  },
  // Expose handlers for test files that need to inspect them
  handlers,
};
