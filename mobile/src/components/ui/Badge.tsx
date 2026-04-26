import React from 'react';
import { Text, View } from 'react-native';
import { type AgentStatus } from '../../types';

const VARIANT_CLASSES: Record<AgentStatus, string> = {
  active: 'bg-success',
  error: 'bg-danger',
  inactive: 'bg-muted',
};

interface BadgeProps {
  status: AgentStatus;
}

export function Badge({ status }: BadgeProps) {
  return (
    <View className={`px-2 py-0.5 rounded-full self-start ${VARIANT_CLASSES[status]}`}>
      <Text className="text-white text-xs font-bold uppercase">{status}</Text>
    </View>
  );
}
