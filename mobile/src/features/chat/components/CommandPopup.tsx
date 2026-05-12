import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COMMANDS } from '../commands';

interface Props {
  visible: boolean;
  onSelect: (command: string) => void;
  onDismiss: () => void;
}

export default function CommandPopup({ visible, onSelect, onDismiss }: Props) {
  const [query, setQuery] = useState('');

  if (!visible) return null;

  const filtered = COMMANDS.filter(
    (cmd) => cmd.command.includes(query.toLowerCase()) || cmd.description.includes(query),
  );

  return (
    <View style={s.wrapper} pointerEvents="box-none">
      {/* Backdrop — dismiss on tap */}
      <Pressable testID="command-popup-backdrop" style={s.backdrop} onPress={onDismiss} />

      {/* Panel */}
      <View style={s.panel}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>命令</Text>
        </View>

        {/* Filter row */}
        <View style={s.filterRow}>
          <TextInput
            testID="command-search-input"
            style={s.filterInput}
            placeholder="搜索命令..."
            placeholderTextColor="#666666"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {/* Command list */}
        <ScrollView
          style={s.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {filtered.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>无匹配命令</Text>
            </View>
          ) : (
            filtered.map((cmd) => (
              <TouchableOpacity
                key={cmd.id}
                testID={`command-item-${cmd.id}`}
                style={s.item}
                onPress={() => {
                  setQuery('');
                  onSelect(cmd.command);
                }}
                activeOpacity={0.7}
              >
                <Text style={s.itemCommand}>{cmd.command}</Text>
                <Text style={s.itemDesc}>{cmd.description}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  panel: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 8,
    maxHeight: 360,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 1,
  },
  filterRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#252525',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    justifyContent: 'center',
  },
  filterInput: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#FFFFFF',
  },
  list: { maxHeight: 260 },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#666666',
  },
  item: {
    height: 52,
    paddingHorizontal: 16,
    justifyContent: 'center',
    gap: 2,
  },
  itemCommand: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  itemDesc: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
});
