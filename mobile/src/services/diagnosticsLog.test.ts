import {
  clearDiagnosticsEntries,
  diagnosticsLogLimits,
  getDiagnosticsEntries,
  getDiagnosticsLogText,
  recordDiagnosticsEvent,
} from './diagnosticsLog';

describe('diagnosticsLog', () => {
  beforeEach(async () => {
    await clearDiagnosticsEntries();
  });

  /// Diagnostics logging: copied release logs preserve auth material for debugging
  ///
  /// Data construction:
  ///   message = URL with token query containing an ms_v2 token
  ///   meta    = Authorization header containing a Bearer token
  ///   Total   = 1 diagnostics entry
  ///
  /// Execution:
  ///   1. clearDiagnosticsEntries() removes previous in-memory and persisted state
  ///   2. recordDiagnosticsEvent() appends one warning entry
  ///   3. getDiagnosticsLogText() formats the copyable text shown in Settings
  ///
  /// Expected:
  ///   - positive assertion: log includes the event scope, so copied logs retain context
  ///   - positive assertion: raw ms_v2 token is present for direct URL reproduction
  ///   - positive assertion: raw Bearer token is present while release debugging is enabled
  ///   - negative assertion: [REDACTED] is absent, so diagnostics did not hide credentials
  it('preserves token values in copyable log text', () => {
    recordDiagnosticsEvent(
      'warn',
      'chat.image',
      'failed https://host/api/v1/uploads/file.jpg?token=ms_v2_secret',
      { authorization: 'Bearer custom-secret-token' },
    );

    const text = getDiagnosticsLogText();

    expect(text).toContain('[chat.image]');
    expect(text).toContain('ms_v2_secret');
    expect(text).toContain('custom-secret-token');
    expect(text).not.toContain('[REDACTED]');
  });

  /// Diagnostics logging: entry buffer keeps the newest release logs only
  ///
  /// Data construction:
  ///   maxEntries = diagnosticsLogLimits.maxEntries = 200
  ///   created    = maxEntries + 1 = 201 entries
  ///   expected   = 200 newest entries retained
  ///
  /// Execution:
  ///   1. append entry "event-0"
  ///   2. append entries through "event-200"
  ///   3. inspect getDiagnosticsEntries()
  ///
  /// Expected:
  ///   - positive assertion: entry count is exactly 200
  ///   - positive assertion: newest entry "event-200" exists
  ///   - negative assertion: oldest entry "event-0" was dropped
  it('keeps a bounded diagnostics buffer with the newest entries', () => {
    for (let i = 0; i <= diagnosticsLogLimits.maxEntries; i++) {
      recordDiagnosticsEvent('info', 'test.scope', `event-${i}`);
    }

    const entries = getDiagnosticsEntries();
    const firstRetained = entries[0];
    const newestRetained = entries[entries.length - 1];

    expect(entries.length).toBe(diagnosticsLogLimits.maxEntries);
    expect(newestRetained?.message).toBe(`event-${diagnosticsLogLimits.maxEntries}`);
    expect(firstRetained?.message).toBe('event-1');
  });
});
