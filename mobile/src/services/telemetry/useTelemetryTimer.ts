import { useEffect, useRef } from 'react';
import { TelemetryService } from './TelemetryService';
import { type TelemetryEventType } from './TelemetryService';

type TimerEventType = 'module_load' | 'route_load';

function computeLevel(durationMs: number, eventType: TimerEventType): 'info' | 'warn' | 'error' {
  if (eventType === 'route_load') {
    if (durationMs > 3000) return 'error';
    if (durationMs > 1000) return 'warn';
    return 'info';
  }
  // module_load
  if (durationMs > 2000) return 'error';
  if (durationMs > 800) return 'warn';
  return 'info';
}

export function useTelemetryTimer(
  moduleName: string,
  eventType: TimerEventType = 'module_load',
): void {
  // Capture start time on the very first render (before the effect runs).
  const startRef = useRef<number | null>(null);
  if (startRef.current === null) {
    startRef.current = performance.now();
  }

  // Capture args in refs so the one-shot effect can read them without
  // listing them as deps (which would cause re-fires on re-renders).
  const moduleNameRef = useRef(moduleName);
  const eventTypeRef = useRef(eventType);

  useEffect(() => {
    const start = startRef.current ?? performance.now();
    const durationMs = performance.now() - start;
    const et = eventTypeRef.current;
    const mn = moduleNameRef.current;
    const level = computeLevel(durationMs, et);

    const dataKey = et === 'route_load' ? 'route' : 'module';
    const data: Record<string, unknown> = {
      [dataKey]: mn,
      duration_ms: durationMs,
    };
    if (level !== 'info') {
      data.threshold_exceeded = level;
    }

    try {
      TelemetryService.getInstance().track({
        event_type: et as TelemetryEventType,
        level,
        data,
      });
    } catch {
      // Never break component render
    }
    // startRef, moduleNameRef, eventTypeRef are stable refs — intentional empty deps.
    // This effect must run exactly once after the first render.
  }, [startRef, moduleNameRef, eventTypeRef]);
}
