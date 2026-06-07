import { X } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { brandColors } from '@/theme/brandRefresh';
import { AddEndpointCommandBlock } from './AddEndpointCommandBlock';
import { addEndpointModalStyles as s } from './addEndpointModalStyles';
import { SETUP_COMMANDS, type SetupCommand } from './addEndpointModalTypes';

type Props = {
  visible: boolean;
  copiedId: string | null;
  onClose: () => void;
  onCopy: (command: SetupCommand) => Promise<void>;
};

export function AddEndpointHelpSheet({ visible, copiedId, onClose, onCopy }: Props) {
  if (!visible) return null;

  return (
    <View style={s.helpOverlay}>
      <TouchableOpacity
        accessibilityLabel="Close setup commands"
        style={s.helpScrim}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={s.helpSheet}>
        <View style={s.sheetHandle} />
        <View style={s.sheetHeader}>
          <View style={s.sheetTitleBlock}>
            <Text style={s.sheetTitle} numberOfLines={1}>
              Set up local agent
            </Text>
            <Text style={s.sheetSubtitle}>
              Run these commands on the machine you want to connect.
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Close setup commands"
            accessibilityRole="button"
            style={s.sheetCloseButton}
            onPress={onClose}
          >
            <X size={16} color={brandColors.ink} />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={s.commandsScroll}
          contentContainerStyle={s.commandsContent}
          showsVerticalScrollIndicator={false}
        >
          <AddEndpointCommandBlock
            command={SETUP_COMMANDS[0]}
            copiedId={copiedId}
            onCopy={onCopy}
          />
          <AddEndpointCommandBlock
            command={SETUP_COMMANDS[1]}
            copiedId={copiedId}
            onCopy={onCopy}
          />
          <Text style={s.registerTitle}>3. Register an Agent</Text>
          {SETUP_COMMANDS.slice(2).map((command) => (
            <AddEndpointCommandBlock
              key={command.id}
              command={command}
              copiedId={copiedId}
              onCopy={onCopy}
              compact
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
