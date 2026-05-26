import { ChevronLeft, ChevronRight, ImagePlus, Search, Terminal, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { COMMANDS } from '../commands';

export type ComposerSheetMode = 'actions' | 'commands';

interface Props {
  visible: boolean;
  mode: ComposerSheetMode;
  onModeChange: (mode: ComposerSheetMode) => void;
  onPickImage: () => void;
  onSelect: (command: string) => void;
  onDismiss: () => void;
}

export default function CommandPopup({
  visible,
  mode,
  onModeChange,
  onPickImage,
  onSelect,
  onDismiss,
}: Props) {
  const [query, setQuery] = useState('');
  const sheetProgress = useRef(new Animated.Value(1)).current;
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (!visible) return undefined;

    sheetProgress.setValue(1);
    const animation = Animated.timing(sheetProgress, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [sheetProgress, visible]);

  if (!visible) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = COMMANDS.filter(
    (cmd) =>
      cmd.command.includes(normalizedQuery) ||
      cmd.label.toLowerCase().includes(normalizedQuery) ||
      cmd.description.toLowerCase().includes(normalizedQuery),
  );

  function handleCommandSelect(command: string) {
    setQuery('');
    onSelect(command);
  }

  const translateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(windowHeight, 480)],
  });
  const backdropOpacity = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  function renderActionMode() {
    return (
      <>
        <View style={s.header}>
          <View style={s.titleBlock}>
            <Text style={s.title}>Add to message</Text>
            <Text style={s.subtitle}>Choose what to attach or insert.</Text>
          </View>
          <TouchableOpacity
            testID="composer-sheet-close"
            accessibilityLabel="Close message actions"
            accessibilityRole="button"
            style={s.closeButton}
            onPress={onDismiss}
          >
            <X size={16} color="#DDDDDD" />
          </TouchableOpacity>
        </View>

        <View style={s.actionList}>
          <TouchableOpacity
            testID="composer-action-upload"
            accessibilityLabel="Upload Image"
            accessibilityRole="button"
            style={s.actionRow}
            onPress={onPickImage}
          >
            <View style={s.actionIcon}>
              <ImagePlus size={18} color="#FF6B35" />
            </View>
            <View style={s.actionCopy}>
              <Text style={s.actionTitle}>Upload Image</Text>
              <Text style={s.actionSubtitle}>Attach an image to the next message</Text>
            </View>
            <ChevronRight size={18} color="#555555" />
          </TouchableOpacity>

          <TouchableOpacity
            testID="composer-action-commands"
            accessibilityLabel="Commands"
            accessibilityRole="button"
            style={s.actionRow}
            onPress={() => onModeChange('commands')}
          >
            <View style={s.actionIcon}>
              <Terminal size={18} color="#FF6B35" />
            </View>
            <View style={s.actionCopy}>
              <Text style={s.actionTitle}>Commands</Text>
              <Text style={s.actionSubtitle}>Insert a slash command</Text>
            </View>
            <ChevronRight size={18} color="#555555" />
          </TouchableOpacity>
        </View>
      </>
    );
  }

  function renderCommandMode() {
    return (
      <>
        <View style={s.header}>
          <TouchableOpacity
            testID="composer-sheet-back"
            accessibilityLabel="Back to message actions"
            accessibilityRole="button"
            style={s.closeButton}
            onPress={() => onModeChange('actions')}
          >
            <ChevronLeft size={18} color="#DDDDDD" />
          </TouchableOpacity>
          <View style={s.commandTitleBlock}>
            <Text style={s.title}>Commands</Text>
            <Text style={s.subtitle}>Search and insert a command.</Text>
          </View>
          <TouchableOpacity
            testID="composer-sheet-close"
            accessibilityLabel="Close commands"
            accessibilityRole="button"
            style={s.closeButton}
            onPress={onDismiss}
          >
            <X size={16} color="#DDDDDD" />
          </TouchableOpacity>
        </View>

        <View style={s.filterRow}>
          <Search size={16} color="#666666" />
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
                onPress={() => handleCommandSelect(cmd.command)}
                activeOpacity={0.72}
              >
                <View testID={`command-badge-${cmd.id}`} style={s.commandBadge}>
                  <Text style={s.itemCommand}>{cmd.command}</Text>
                </View>
                <Text style={s.itemDesc}>{cmd.description}</Text>
                <View testID={`command-chevron-${cmd.id}`} style={s.chevron}>
                  <ChevronRight size={14} color="#555555" />
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </>
    );
  }

  return (
    <View testID="composer-sheet-root" style={s.wrapper} pointerEvents="box-none">
      <Pressable testID="composer-sheet-backdrop" style={s.backdropHitArea} onPress={onDismiss}>
        <Animated.View
          pointerEvents="none"
          style={[s.backdropVisual, { opacity: backdropOpacity }]}
        />
      </Pressable>
      <Animated.View style={[s.panel, { transform: [{ translateY }] }]}>
        <View testID="composer-sheet-grabber" style={s.grabber} />
        {mode === 'actions' ? renderActionMode() : renderCommandMode()}
      </Animated.View>
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
    zIndex: 30,
    elevation: 30,
    justifyContent: 'flex-end',
  },
  backdropHitArea: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropVisual: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panel: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 34,
    gap: 14,
    maxHeight: '72%',
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#333333',
    marginBottom: 2,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: { flex: 1, gap: 3 },
  commandTitleBlock: { flex: 1, gap: 3, alignItems: 'center' },
  title: {
    fontFamily: 'Inter',
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionList: {
    gap: 8,
  },
  actionRow: {
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333333',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: { flex: 1, gap: 2 },
  actionTitle: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionSubtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333333',
    paddingHorizontal: 14,
    minHeight: 44,
  },
  filterInput: {
    flex: 1,
    padding: 0,
    margin: 0,
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#FFFFFF',
  },
  list: { maxHeight: 276 },
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
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  commandBadge: {
    borderRadius: 8,
    backgroundColor: '#252525',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  itemCommand: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '700',
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
