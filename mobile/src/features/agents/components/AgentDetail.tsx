import { ArrowLeft, Zap } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Agent } from '@/types';
import { InvokeModal } from './InvokeModal';

interface Props {
  agent: Agent | undefined;
  isLoading: boolean;
  isError: boolean;
  onBack: () => void;
  onInvoke: (message: string) => Promise<string>;
  onChat: () => void;
}

export function AgentDetail({ agent, isLoading, isError, onBack, onInvoke, onChat }: Props) {
  const insets = useSafeAreaInsets();
  const [invoking, setInvoking] = useState(false);
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [message, setMessage] = useState('');

  const handleInvoke = async () => {
    if (!message.trim()) return;
    setInvoking(true);
    setInvokeError(null);
    try {
      const conv_id = await onInvoke(message.trim());
      setInvokeResult(`Conversation started: ${conv_id}`);
      setMessage('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setInvokeError(err?.response?.data?.error ?? err?.message ?? 'Unknown error');
      setInvokeResult(null);
    } finally {
      setInvoking(false);
      setModalVisible(true);
    }
  };

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.nav}>
          <TouchableOpacity onPress={onBack}>
            <ArrowLeft size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.navTitle}>AGENT</Text>
          <View style={{ width: 20 }} />
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={s.loadingText}>LOADING…</Text>
        </View>
      </View>
    );
  }

  if (isError || !agent) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.nav}>
          <TouchableOpacity onPress={onBack}>
            <ArrowLeft size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.navTitle}>AGENT</Text>
          <View style={{ width: 20 }} />
        </View>
        <View style={s.centered}>
          <Text style={s.errorTitle}>FAILED TO LOAD</Text>
          <TouchableOpacity style={s.backBtn} onPress={onBack}>
            <Text style={s.backBtnText}>GO BACK</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Nav */}
      <View style={s.nav}>
        <TouchableOpacity onPress={onBack}>
          <ArrowLeft size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={s.navTitle}>AGENT</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Agent name + runtime */}
        <View style={s.headerCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{agent.name.slice(0, 2).toUpperCase()}</Text>
          </View>
          <View style={s.headerInfo}>
            <Text style={s.agentName}>{agent.name.toUpperCase()}</Text>
            <View style={s.runtimeBadge}>
              <Text style={s.runtimeText}>{agent.runtime.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Details */}
        <View style={s.section}>
          <View style={s.row}>
            <Text style={s.rowLabel}>ENDPOINT</Text>
            <Text style={s.rowValue}>{agent.endpoint_label}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>PROJECT</Text>
            <View style={s.projectRow}>
              <Zap size={12} color="#555555" />
              <Text style={s.rowValueMono} numberOfLines={2}>
                {agent.project_path}
              </Text>
            </View>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>ID</Text>
            <Text style={s.rowValueMono} numberOfLines={1}>
              {agent.id}
            </Text>
          </View>
        </View>

        {/* Invoke */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>INVOKE</Text>
          <TextInput
            style={s.messageInput}
            placeholder="Enter a task for the agent…"
            placeholderTextColor="#555555"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
          />
          <TouchableOpacity
            style={[s.invokeBtn, (!message.trim() || invoking) && s.invokeBtnDisabled]}
            onPress={() => {
              void handleInvoke();
            }}
            disabled={!message.trim() || invoking}
          >
            {invoking ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={s.invokeBtnText}>INVOKE</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Chat */}
        <TouchableOpacity style={s.chatBtn} onPress={onChat}>
          <Text style={s.chatBtnText}>OPEN CHAT</Text>
        </TouchableOpacity>
      </ScrollView>

      <InvokeModal
        visible={modalVisible}
        result={invokeResult}
        error={invokeError}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
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
  navTitle: { fontFamily: 'Inter', fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 2 },
  errorTitle: { fontFamily: 'Inter', fontSize: 20, fontWeight: '700', color: '#FF4444' },
  backBtn: {
    borderWidth: 1,
    borderColor: '#FF6B35',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backBtnText: { fontFamily: 'Inter', fontSize: 12, color: '#FF6B35', letterSpacing: 1.5 },
  scroll: { padding: 16, gap: 12 },
  headerCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Inter', fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  headerInfo: { flex: 1, gap: 6 },
  agentName: { fontFamily: 'Inter', fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  runtimeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#0D0D0D',
  },
  runtimeText: { fontFamily: 'Inter', fontSize: 10, color: '#888888', letterSpacing: 0.8 },
  section: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 1,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#666666',
    letterSpacing: 1.5,
    paddingTop: 2,
  },
  rowValue: { fontFamily: 'Inter', fontSize: 13, color: '#DDDDDD', flex: 1, textAlign: 'right' },
  rowValueMono: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#888888',
    flex: 1,
    textAlign: 'right',
  },
  projectRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    justifyContent: 'flex-end',
  },
  divider: { height: 1, backgroundColor: '#1E1E1E' },
  messageInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    padding: 12,
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#FFFFFF',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  invokeBtn: {
    height: 44,
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invokeBtnDisabled: { opacity: 0.4 },
  invokeBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  chatBtn: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FF6B35' },
});
