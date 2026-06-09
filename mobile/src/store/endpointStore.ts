import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { getDb } from '@/db';
import { normalizeEndpointBaseUrl } from '@/features/settings/services/endpointLiveness';
import { type Endpoint } from '@/types';

interface EndpointState {
  endpoints: Endpoint[];
  load: () => Promise<void>;
  addEndpoint: (input: { label: string; base_url: string; token: string }) => Promise<void>;
  removeEndpoint: (id: string) => Promise<void>;
  updateLastSeen: (id: string, ts: number) => Promise<void>;
  batchUpdateLastSeen: (ids: string[], ts: number) => Promise<void>;
}

const TOKEN_KEY = (id: string) => `endpoint_token_${id}`;
const pendingEndpointBaseUrls = new Set<string>();

export const useEndpointStore = create<EndpointState>((set, get) => ({
  endpoints: [],

  load: async () => {
    const db = getDb();
    const rows = await db.getAllAsync<{
      id: string;
      label: string;
      base_url: string;
      last_seen_at: number | null;
    }>('SELECT id, label, base_url, last_seen_at FROM endpoints ORDER BY rowid ASC');
    const endpoints: Endpoint[] = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        token: (await AsyncStorage.getItem(TOKEN_KEY(r.id))) ?? '',
      })),
    );
    set({ endpoints });
  },

  addEndpoint: async ({ label, base_url, token }) => {
    const normalizedBaseUrl = normalizeEndpointBaseUrl(base_url);
    const hasExistingEndpoint = useEndpointStore
      .getState()
      .endpoints.some(
        (endpoint) => normalizeEndpointBaseUrl(endpoint.base_url) === normalizedBaseUrl,
      );
    if (hasExistingEndpoint || pendingEndpointBaseUrls.has(normalizedBaseUrl)) return;
    pendingEndpointBaseUrls.add(normalizedBaseUrl);
    const db = getDb();
    try {
      const id = uuidv4();
      await db.runAsync(
        'INSERT INTO endpoints (id, label, base_url, last_seen_at) VALUES (?,?,?,NULL)',
        [id, label, normalizedBaseUrl],
      );
      await AsyncStorage.setItem(TOKEN_KEY(id), token);
      const ep: Endpoint = { id, label, base_url: normalizedBaseUrl, token, last_seen_at: null };
      set((s) => ({ endpoints: [...s.endpoints, ep] }));
      await get().updateLastSeen(id, Date.now());
    } finally {
      pendingEndpointBaseUrls.delete(normalizedBaseUrl);
    }
  },

  removeEndpoint: async (id) => {
    const db = getDb();
    await db.runAsync('DELETE FROM endpoints WHERE id = ?', [id]);
    await AsyncStorage.removeItem(TOKEN_KEY(id));
    set((s) => ({ endpoints: s.endpoints.filter((e) => e.id !== id) }));
  },

  updateLastSeen: async (id, ts) => {
    const db = getDb();
    await db.runAsync('UPDATE endpoints SET last_seen_at = ? WHERE id = ?', [ts, id]);
    set((s) => ({
      endpoints: s.endpoints.map((e) => (e.id === id ? { ...e, last_seen_at: ts } : e)),
    }));
  },

  batchUpdateLastSeen: async (ids, ts) => {
    if (ids.length === 0) return;
    const db = getDb();
    const idSet = new Set(ids);
    await Promise.all(
      ids.map((id) => db.runAsync('UPDATE endpoints SET last_seen_at = ? WHERE id = ?', [ts, id])),
    );
    set((s) => ({
      endpoints: s.endpoints.map((e) => (idSet.has(e.id) ? { ...e, last_seen_at: ts } : e)),
    }));
  },
}));
