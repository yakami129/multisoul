import { Zap } from 'lucide-react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Agent } from '@/types';

interface Props {
  agent: Agent;
  onPress: () => void;
  index: number;
}

export function AgentCard({ agent, onPress }: Props) {
  return (
    <View>
      <Pressable onPress={onPress} className="mx-4 my-1.5 active:opacity-70">
        <Card>
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <Zap size={16} color="#007AFF" />
              <Text
                className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1"
                numberOfLines={1}
              >
                {agent.name}
              </Text>
            </View>
            <Badge status={agent.status} />
          </View>
          <Text className="text-xs text-slate-400 mb-1" numberOfLines={1}>
            {agent.endpoint}
          </Text>
          {agent.description ? (
            <Text className="text-sm text-slate-500 dark:text-slate-400" numberOfLines={2}>
              {agent.description}
            </Text>
          ) : null}
        </Card>
      </Pressable>
    </View>
  );
}
