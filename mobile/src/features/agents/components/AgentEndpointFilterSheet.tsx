import { Check, X } from 'lucide-react-native';
import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors } from '@/theme/brandRefresh';
import type { EndpointFilterOption } from '../utils/endpointFilterUtils';
import { endpointSheetStyles as s } from './AgentEndpointFilterSheet.styles';

function agentCountLabel(count: number) {
  return count === 1 ? '1 agent' : `${count} agents`;
}

export function AgentEndpointFilterSheet({
  visible,
  options,
  selectedEndpointId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: EndpointFilterOption[];
  selectedEndpointId: string;
  onSelect: (endpointId: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable
          accessibilityLabel="Close endpoint filter"
          accessibilityRole="button"
          onPress={onClose}
          style={s.scrim}
        />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>Filter by Machine</Text>
            <TouchableOpacity
              accessibilityLabel="Close endpoint filter"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={s.closeButton}
            >
              <X size={18} color={brandColors.ink} />
            </TouchableOpacity>
          </View>
          <View style={s.optionGroup}>
            {options.map((option, index) => {
              const selected = option.id === selectedEndpointId;
              return (
                <TouchableOpacity
                  accessibilityLabel={`${option.label}, ${agentCountLabel(option.count)}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => onSelect(option.id)}
                  style={[s.optionRow, index > 0 && s.optionDivider]}
                >
                  <View style={s.optionCopy}>
                    <Text style={s.optionTitle} numberOfLines={1} ellipsizeMode="tail">
                      {option.label}
                    </Text>
                    <Text style={s.optionMeta}>{agentCountLabel(option.count)}</Text>
                  </View>
                  <View style={[s.checkSlot, selected && s.checkSlotSelected]}>
                    {selected ? <Check size={15} color={brandColors.ink} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
