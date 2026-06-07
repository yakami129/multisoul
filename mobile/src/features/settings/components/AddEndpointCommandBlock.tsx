import { Copy } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { brandColors } from '@/theme/brandRefresh';
import { addEndpointModalStyles as s } from './addEndpointModalStyles';
import type { SetupCommand } from './addEndpointModalTypes';

type Props = {
  command: SetupCommand;
  copiedId: string | null;
  onCopy: (command: SetupCommand) => Promise<void>;
  compact?: boolean;
};

export function AddEndpointCommandBlock({ command, copiedId, onCopy, compact = false }: Props) {
  const copied = copiedId === command.id;

  return (
    <View style={[s.commandBlock, compact && s.commandBlockCompact]}>
      <View style={s.commandHeader}>
        <Text style={[s.commandTitle, compact && s.commandTitleAccent]} numberOfLines={1}>
          {command.title}
        </Text>
        <TouchableOpacity
          accessibilityLabel={`Copy ${command.title} command`}
          accessibilityRole="button"
          onPress={() => {
            void onCopy(command);
          }}
          style={s.copyButton}
        >
          {copied ? (
            <Text style={s.copiedText}>COPIED</Text>
          ) : (
            <Copy size={13} color={brandColors.textMuted} />
          )}
        </TouchableOpacity>
      </View>
      <Text style={s.commandText}>{command.command}</Text>
    </View>
  );
}
