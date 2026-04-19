import { ArrowLeft } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Agent } from '@/types';
import { InvokeModal } from './InvokeModal';

interface Props {
  agent: Agent | undefined;
  isLoading: boolean;
  isError: boolean;
  onBack: () => void;
  onInvoke: () => Promise<string>;
  onChat: () => void;
}

export function AgentDetail({ agent, isLoading, isError, onBack, onInvoke, onChat }: Props) {
  const insets = useSafeAreaInsets();
  const [invoking, setInvoking] = useState(false);
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleInvoke = async () => {
    setInvoking(true);
    setInvokeError(null);
    try {
      const result = await onInvoke();
      setInvokeResult(result);
    } catch (e: any) {
      setInvokeError(e?.response?.data?.error ?? e?.message ?? 'Unknown error');
      setInvokeResult(null);
    } finally {
      setInvoking(false);
      setModalVisible(true);
    }
  };

  if (isLoading) {
    return (
      <View
        testID="loading-indicator"
        className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900"
      >
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (isError || !agent) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Text className="text-lg font-semibold text-danger mb-3">Failed to load agent.</Text>
        <Pressable onPress={onBack}>
          <Text className="text-primary text-base">Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable onPress={onBack} className="flex-row items-center gap-1 mb-4">
          <ArrowLeft size={18} color="#007AFF" />
          <Text className="text-primary text-base">Back</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          {agent.name}
        </Text>
        <Badge status={agent.status} />
        <Card className="mt-4 gap-3">
          <View>
            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Endpoint
            </Text>
            <Text className="text-sm text-slate-700 dark:text-slate-300">{agent.endpoint}</Text>
          </View>
          {agent.description ? (
            <View>
              <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Description
              </Text>
              <Text className="text-sm text-slate-700 dark:text-slate-300">{agent.description}</Text>
            </View>
          ) : null}
          <View>
            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              ID
            </Text>
            <Text className="text-sm text-slate-700 dark:text-slate-300">{agent.id}</Text>
          </View>
        </Card>
        <View className="mt-6 gap-3">
          {invoking ? (
            <View className="rounded-xl py-4 items-center bg-primary opacity-50">
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <Button label="Invoke" onPress={handleInvoke} />
          )}
          <Button label="Chat" onPress={onChat} />
        </View>
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
