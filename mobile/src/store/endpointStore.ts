import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { getDb } from '@/db';
import { type Endpoint } from '@/types';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

interface EndpointState {
  endpoints: Endpoint[];
  load: () => Promise<void>;
  addEndpoint: (input: { label: string; base_url: string; token: string }) => Promise<void>;
  removeEndpoint: (id: string) => Promise<void>;
  updateLastSeen: (id: string, ts: number) => Promise<void>;
}

const TOKEN_KEY = (id: string) => `endpoint_token_${id}`;

export const useEndpointStore = create<EndpointState>((set) => ({
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
    const db = getDb();
    const id = uuidv4();
    await db.runAsync(
      'INSERT INTO endpoints (id, label, base_url, last_seen_at) VALUES (?,?,?,NULL)',
      [id, label, base_url],
    );
    await AsyncStorage.setItem(TOKEN_KEY(id), token);
    const ep: Endpoint = { id, label, base_url, token, last_seen_at: null };
    set((s) => ({ endpoints: [...s.endpoints, ep] }));
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
}));
