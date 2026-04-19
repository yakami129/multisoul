import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '../../../src/api';
import { fetchAgent } from '../../../src/features/agents/services/agentService';
import { ChatScreen } from '../../../src/features/chat/components/ChatScreen';
import { useChatSocket } from '../../../src/features/chat/hooks/useChatSocket';
import { useSettingsStore } from '../../../src/store/settingsStore';

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { serverUrl, apiKey } = useSettingsStore((s) => s.settings);
  const client = getApiClient();

  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => fetchAgent(client, id!),
    enabled: !!id,
  });

  const { messages, status, send } = useChatSocket({
    agentId: id!,
    serverUrl,
    apiKey,
  });

  return (
    <ChatScreen
      agentName={agent?.name ?? 'Agent'}
      messages={messages}
      status={status}
      onSend={send}
      onBack={() => router.back()}
    />
  );
}
