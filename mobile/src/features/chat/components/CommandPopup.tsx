import { ChevronRight, Search, Terminal } from 'lucide-react-native';
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
      <Pressable testID="command-popup-backdrop" style={s.backdrop} onPress={onDismiss} />

      <View style={s.panel}>
        <View style={s.header}>
          <Terminal size={16} color="#FF6B35" />
          <Text style={s.headerTitle}>Commands</Text>
          <View style={s.headerSpacer} />
          <Text style={s.headerHint}>ESC to close</Text>
        </View>

        <View style={s.filterRow}>
          <Search size={16} color="#555555" />
          <TextInput
            testID="command-search-input"
            style={s.filterInput}
            accessibilityLabel="Search commands"
            placeholder="Search commands..."
            placeholderTextColor="#666666"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

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
                <View testID={`command-badge-${cmd.id}`} style={s.commandBadge}>
                  <Text style={s.itemCommand}>{cmd.command}</Text>
                </View>
                <Text style={s.itemDesc}>{cmd.description}</Text>
                <View testID={`command-chevron-${cmd.id}`} style={s.chevron}>
                  <ChevronRight size={14} color="#333333" />
                </View>
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
    padding: 16,
    gap: 12,
    maxHeight: 360,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerSpacer: {
    flex: 1,
  },
  headerHint: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#252525',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 42,
  },
  filterInput: {
    flex: 1,
    padding: 0,
    margin: 0,
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
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  commandBadge: {
    borderRadius: 6,
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  itemCommand: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: '#FF6B35',
  },
  itemDesc: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
  },
  chevron: {
    marginRight: 2,
  },
});
