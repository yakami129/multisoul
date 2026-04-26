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
            <ArrowLeft size={20} color="#20C20E" />
          </TouchableOpacity>
          <Text style={s.navTitle}>AGENT</Text>
          <View style={{ width: 20 }} />
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#20C20E" />
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
            <ArrowLeft size={20} color="#20C20E" />
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
          <ArrowLeft size={20} color="#20C20E" />
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
              <Zap size={12} color="#0F6B0F" />
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
            placeholderTextColor="#2D8B2D"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
          />
          <TouchableOpacity
            style={[s.invokeBtn, (!message.trim() || invoking) && s.invokeBtnDisabled]}
            onPress={handleInvoke}
            disabled={!message.trim() || invoking}
          >
            {invoking ? (
              <ActivityIndicator size="small" color="#040D04" />
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
  root: { flex: 1, backgroundColor: '#040D04' },
  nav: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  navTitle: { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 2 },
  errorTitle: { fontFamily: 'Anton', fontSize: 20, color: '#FFB000' },
  backBtn: {
    borderWidth: 1,
    borderColor: '#20C20E',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 2,
  },
  backBtnText: { fontFamily: 'Inter', fontSize: 12, color: '#20C20E', letterSpacing: 1.5 },
  scroll: { padding: 16, gap: 12 },
  headerCard: {
    backgroundColor: '#061206',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 2,
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Anton', fontSize: 18, color: '#20C20E' },
  headerInfo: { flex: 1, gap: 6 },
  agentName: { fontFamily: 'Anton', fontSize: 18, color: '#20C20E' },
  runtimeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    backgroundColor: '#0A1A0A',
  },
  runtimeText: { fontFamily: 'Inter', fontSize: 10, color: '#2D8B2D', letterSpacing: 0.8 },
  section: {
    backgroundColor: '#061206',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontFamily: 'Anton', fontSize: 13, color: '#20C20E', letterSpacing: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
    letterSpacing: 1.5,
    paddingTop: 2,
  },
  rowValue: { fontFamily: 'Geist', fontSize: 13, color: '#20C20E', flex: 1, textAlign: 'right' },
  rowValueMono: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#147A16',
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
  divider: { height: 1, backgroundColor: '#0F2B0F' },
  messageInput: {
    backgroundColor: '#0A1A0A',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    padding: 12,
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  invokeBtn: {
    height: 44,
    backgroundColor: '#20C20E',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invokeBtnDisabled: { opacity: 0.4 },
  invokeBtnText: { fontFamily: 'Anton', fontSize: 14, color: '#040D04', letterSpacing: 1 },
  chatBtn: {
    height: 44,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#20C20E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBtnText: { fontFamily: 'Anton', fontSize: 14, color: '#20C20E', letterSpacing: 1 },
});
