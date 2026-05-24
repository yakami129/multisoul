import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  clearDiagnosticsEntries,
  getDiagnosticsLogText,
  hydrateDiagnosticsLog,
} from '@/services/diagnosticsLog';
import { type Endpoint } from '@/types';

const MAX_LOG_LINES = 500;
const DEFAULT_TAIL = 200;
const DEFAULT_LEVEL = 'trace';

interface ReleaseLogsModalProps {
  visible: boolean;
  endpoints: Endpoint[];
  onClose: () => void;
}

function buildLogsWsUrl(endpoint: Endpoint): string {
  const wsBase = endpoint.base_url.replace(/^https/, 'wss').replace(/^http/, 'ws');
  const token = encodeURIComponent(endpoint.token);
  return `${wsBase}/ws/logs?token=${token}&tail=${DEFAULT_TAIL}&level=${DEFAULT_LEVEL}`;
}

function linesFromText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export function ReleaseLogsModal({ visible, endpoints, onClose }: ReleaseLogsModalProps) {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [iosLines, setIosLines] = useState<string[]>([]);
  const [msctlLines, setMsctlLines] = useState<string[]>([]);
  const [status, setStatus] = useState('Select an endpoint to start live logs.');
  const socketRef = useRef<WebSocket | null>(null);
  const streamHadErrorRef = useRef(false);

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId],
  );

  const refreshIosLogs = useCallback(async () => {
    await hydrateDiagnosticsLog();
    setIosLines(linesFromText(getDiagnosticsLogText()));
  }, []);

  useEffect(() => {
    if (!visible) {
      setSelectedEndpointId(null);
      setMsctlLines([]);
      setStatus('Select an endpoint to start live logs.');
      return;
    }
    void refreshIosLogs();
  }, [refreshIosLogs, visible]);

  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setMsctlLines([]);

    if (!visible || !selectedEndpoint) return;

    const ws = new WebSocket(buildLogsWsUrl(selectedEndpoint));
    socketRef.current = ws;
    streamHadErrorRef.current = false;
    setStatus(`Connecting to ${selectedEndpoint.label}...`);

    ws.onopen = () => {
      setStatus(`Live: ${selectedEndpoint.label}`);
    };
    ws.onmessage = (event) => {
      const line = String(event.data);
      setMsctlLines((prev) => [...prev, line].slice(-MAX_LOG_LINES));
    };
    ws.onerror = () => {
      streamHadErrorRef.current = true;
      setStatus(`Could not stream logs from ${selectedEndpoint.label}.`);
    };
    ws.onclose = (event) => {
      if (socketRef.current === ws && !streamHadErrorRef.current) {
        const code =
          typeof event.code === 'number' && event.code !== 1000 ? ` (${event.code})` : '';
        setStatus(`Log stream closed${code}.`);
      }
    };

    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      if (socketRef.current === ws) {
        socketRef.current = null;
      }
    };
  }, [selectedEndpoint, visible]);

  const combinedLines = useMemo(
    () => [...iosLines, ...msctlLines].slice(-MAX_LOG_LINES),
    [iosLines, msctlLines],
  );
  const logText = combinedLines.length > 0 ? combinedLines.join('\n') : 'No diagnostics yet.';

  const copyLogs = async () => {
    await Clipboard.setStringAsync(logText);
    Alert.alert('Copied', 'Release logs copied.');
  };

  const clearIosLogs = async () => {
    await clearDiagnosticsEntries();
    await refreshIosLogs();
    Alert.alert('Cleared', 'iOS diagnostics logs cleared.');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Release logs</Text>
            <Text style={s.subtitle}>{status}</Text>
          </View>
          <TouchableOpacity testID="release-logs-close-btn" onPress={onClose} style={s.closeButton}>
            <Text style={s.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionLabel}>ENDPOINT</Text>
        <View style={s.endpointList}>
          {endpoints.length === 0 ? (
            <Text style={s.emptyText}>No endpoints configured.</Text>
          ) : (
            endpoints.map((endpoint) => {
              const selected = endpoint.id === selectedEndpointId;
              return (
                <TouchableOpacity
                  key={endpoint.id}
                  testID={`release-logs-endpoint-${endpoint.id}`}
                  onPress={() => setSelectedEndpointId(endpoint.id)}
                  style={[s.endpointButton, selected && s.endpointButtonSelected]}
                >
                  <Text style={[s.endpointText, selected && s.endpointTextSelected]}>
                    {endpoint.label}
                  </Text>
                  <Text style={s.endpointUrl}>{endpoint.base_url}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={s.actionRow}>
          <TouchableOpacity
            testID="release-logs-copy-btn"
            style={s.primaryButton}
            onPress={() => void copyLogs()}
          >
            <Text style={s.primaryButtonText}>Copy logs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="release-logs-clear-btn"
            style={s.secondaryButton}
            onPress={() => void clearIosLogs()}
          >
            <Text style={s.secondaryButtonText}>Clear iOS</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.logBox} contentContainerStyle={s.logContent}>
          <Text testID="release-logs-text" selectable style={s.logText}>
            {logText}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D', padding: 16, gap: 12 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
    paddingBottom: 12,
  },
  title: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { marginTop: 4, fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  closeButton: { paddingHorizontal: 12, paddingVertical: 8 },
  closeText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#FF6B35' },
  sectionLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    letterSpacing: 1.5,
  },
  endpointList: { gap: 8 },
  endpointButton: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  endpointButtonSelected: { backgroundColor: '#1F2A1F', borderColor: '#4CAF50' },
  endpointText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '700', color: '#DDDDDD' },
  endpointTextSelected: { color: '#FFFFFF' },
  endpointUrl: { marginTop: 3, fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  emptyText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryButton: {
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  secondaryButton: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#DDDDDD' },
  logBox: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  logContent: { padding: 10 },
  logText: { fontFamily: 'Inter', fontSize: 12, lineHeight: 17, color: '#DDDDDD' },
});
