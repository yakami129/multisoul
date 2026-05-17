import AsyncStorage from '@react-native-async-storage/async-storage';

export type DiagnosticsLevel = 'info' | 'warn' | 'error';

export interface DiagnosticsEntry {
  ts: string;
  level: DiagnosticsLevel;
  scope: string;
  message: string;
  meta?: string;
}

const STORAGE_KEY = 'multisoul.diagnostics.v1';
const MAX_ENTRIES = 200;

let entries: DiagnosticsEntry[] = [];
let hydration: Promise<void> | null = null;

function redactSensitive(input: string): string {
  return input;
}

function stringifyMeta(meta: unknown): string | undefined {
  if (meta === undefined) return undefined;
  if (meta instanceof Error) {
    return redactSensitive(`${meta.name}: ${meta.message}`);
  }
  try {
    return redactSensitive(JSON.stringify(meta));
  } catch {
    return redactSensitive(String(meta));
  }
}

function normalizeEntries(value: unknown): DiagnosticsEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is DiagnosticsEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<DiagnosticsEntry>;
      return (
        typeof candidate.ts === 'string' &&
        (candidate.level === 'info' || candidate.level === 'warn' || candidate.level === 'error') &&
        typeof candidate.scope === 'string' &&
        typeof candidate.message === 'string'
      );
    })
    .slice(-MAX_ENTRIES);
}

async function persistEntries() {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function hydrateDiagnosticsLog(): Promise<void> {
  if (hydration) return hydration;
  hydration = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      entries = normalizeEntries([...normalizeEntries(JSON.parse(raw)), ...entries]);
    })
    .catch(() => {
      entries = [];
    });
  return hydration;
}

export function recordDiagnosticsEvent(
  level: DiagnosticsLevel,
  scope: string,
  message: string,
  meta?: unknown,
) {
  entries = [
    ...entries,
    {
      ts: new Date().toISOString(),
      level,
      scope,
      message: redactSensitive(message),
      meta: stringifyMeta(meta),
    },
  ].slice(-MAX_ENTRIES);

  void persistEntries();
}

export function getDiagnosticsEntries(): DiagnosticsEntry[] {
  return entries;
}

export function getDiagnosticsLogText(): string {
  return entries
    .map((entry) => {
      const meta = entry.meta ? ` ${entry.meta}` : '';
      return `${entry.ts} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${meta}`;
    })
    .join('\n');
}

export async function clearDiagnosticsEntries(): Promise<void> {
  entries = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export const diagnosticsLogLimits = {
  maxEntries: MAX_ENTRIES,
};
