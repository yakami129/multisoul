import { Check, X } from 'lucide-react-native';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type EndpointFilterOption } from './projectUi';

function projectCountLabel(count: number) {
  return count === 1 ? '1 project' : `${count} projects`;
}

export function ProjectEndpointFilterSheet({
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
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable
          accessibilityLabel="Close endpoint filter"
          accessibilityRole="button"
          onPress={onClose}
          style={s.scrim}
          testID="project-endpoint-filter-scrim"
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
                  accessibilityLabel={`${option.label}, ${projectCountLabel(option.count)}`}
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
                    <Text style={s.optionMeta}>{projectCountLabel(option.count)}</Text>
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

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: brandRgba.ink72,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: brandColors.cream,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: brandRgba.ink18,
    marginBottom: 14,
  },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: brandTypography.display,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    color: brandColors.ink,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandRgba.ink08,
  },
  optionGroup: {
    marginTop: 10,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white88,
  },
  optionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
  },
  optionDivider: { borderTopWidth: 1, borderTopColor: brandRgba.silver78 },
  optionCopy: { flex: 1, minWidth: 0 },
  optionTitle: {
    fontFamily: brandTypography.body,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: brandColors.ink,
  },
  optionMeta: {
    marginTop: 2,
    fontFamily: brandTypography.body,
    fontSize: 12,
    lineHeight: 16,
    color: brandColors.textSoft,
  },
  checkSlot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandRgba.ink08,
  },
  checkSlotSelected: { backgroundColor: brandColors.lime },
});
