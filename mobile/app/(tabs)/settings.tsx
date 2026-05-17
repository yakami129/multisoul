import * as Clipboard from 'expo-clipboard';
import { Plus } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { AddEndpointModal } from '@/features/settings/components/AddEndpointModal';
import { EndpointList } from '@/features/settings/components/EndpointList';
import {
  clearDiagnosticsEntries,
  getDiagnosticsLogText,
  hydrateDiagnosticsLog,
} from '@/services/diagnosticsLog';
import { useEndpointStore } from '@/store/endpointStore';

export default function SettingsScreen() {
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addEndpoint = useEndpointStore((s) => s.addEndpoint);
  const removeEndpoint = useEndpointStore((s) => s.removeEndpoint);
  const [modalVisible, setModalVisible] = useState(false);
  const [diagnosticsText, setDiagnosticsText] = useState('No diagnostics yet.');

  const refreshDiagnostics = useCallback(async () => {
    await hydrateDiagnosticsLog();
    const text = getDiagnosticsLogText();
    setDiagnosticsText(text.length > 0 ? text : 'No diagnostics yet.');
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const copyDiagnostics = async () => {
    await hydrateDiagnosticsLog();
    const text = getDiagnosticsLogText();
    await Clipboard.setStringAsync(text.length > 0 ? text : 'No diagnostics yet.');
    Alert.alert('Copied', 'Diagnostics logs copied.');
  };

  const clearDiagnostics = async () => {
    await clearDiagnosticsEntries();
    await refreshDiagnostics();
    Alert.alert('Cleared', 'Diagnostics logs cleared.');
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.nav}>
        <Text style={s.navTitle}>SETTINGS</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)}>
          <Plus size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.sectionLabel}>ENDPOINTS</Text>
        <EndpointList
          endpoints={endpoints}
          onRemove={(id) => {
            void removeEndpoint(id);
          }}
        />
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionLabel}>DIAGNOSTICS</Text>
          <TouchableOpacity
            testID="diagnostics-refresh-btn"
            onPress={() => void refreshDiagnostics()}
          >
            <Text style={s.linkButton}>Refresh</Text>
          </TouchableOpacity>
        </View>
        <View style={s.diagnosticsCard}>
          <Text style={s.diagnosticsTitle}>Release logs</Text>
          <Text style={s.diagnosticsHint}>
            Copy this when image rendering or requests fail in TestFlight.
          </Text>
          <View style={s.actionRow}>
            <TouchableOpacity
              testID="diagnostics-copy-btn"
              style={s.primaryButton}
              onPress={() => void copyDiagnostics()}
            >
              <Text style={s.primaryButtonText}>Copy logs</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="diagnostics-clear-btn"
              style={s.secondaryButton}
              onPress={() => void clearDiagnostics()}
            >
              <Text style={s.secondaryButtonText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <Text testID="diagnostics-log-text" selectable style={s.diagnosticsText}>
            {diagnosticsText}
          </Text>
        </View>
      </ScrollView>

      <AddEndpointModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onAdd={(label, base_url, token) => {
          void addEndpoint({ label, base_url, token });
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  nav: {
    height: 52,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  navTitle: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  sectionHeaderRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    letterSpacing: 1.5,
  },
  linkButton: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FF6B35' },
  diagnosticsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  diagnosticsTitle: { fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  diagnosticsHint: { fontFamily: 'Inter', fontSize: 13, color: '#888888', lineHeight: 18 },
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
  diagnosticsText: {
    minHeight: 96,
    maxHeight: 240,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#111111',
    color: '#DDDDDD',
    fontFamily: 'Inter',
    fontSize: 12,
    lineHeight: 17,
  },
});
