import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { X } from 'lucide-react-native';
import React from 'react';
import {
  Alert,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type SpecIdeaAttachment } from './specUiModels';

interface Props {
  attachment: SpecIdeaAttachment;
  onUpdate: (id: string, patch: Partial<SpecIdeaAttachment>) => void;
  onRemove: (id: string) => void;
}

export function AttachmentEditorRow({ attachment, onUpdate, onRemove }: Props) {
  const handlePasteUrl = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) onUpdate(attachment.id, { uri: text });
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow photo library access in Settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Settings', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const compressed = await ImageManipulator.manipulateAsync(result.assets[0].uri, [], {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    onUpdate(attachment.id, { uri: compressed.uri });
  };

  const kindLabel =
    attachment.kind === 'link' ? 'Link' : attachment.kind === 'log' ? 'Log Snippet' : 'Screenshot';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.kindLabel}>{kindLabel}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Remove attachment"
          onPress={() => onRemove(attachment.id)}
          style={s.removeButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={14} color={brandColors.textMuted} />
        </TouchableOpacity>
      </View>

      {attachment.kind === 'link' && (
        <View style={s.inputRow}>
          <TextInput
            accessibilityLabel="Link URL"
            value={attachment.uri ?? ''}
            onChangeText={(text) => onUpdate(attachment.id, { uri: text })}
            placeholder="https://..."
            placeholderTextColor={brandColors.textMuted}
            style={[s.input, s.flex]}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void handlePasteUrl()}
            style={s.pasteButton}
          >
            <Text style={s.pasteText}>Paste</Text>
          </TouchableOpacity>
        </View>
      )}

      {attachment.kind === 'log' && (
        <TextInput
          accessibilityLabel="Log snippet"
          value={attachment.text ?? ''}
          onChangeText={(text) => onUpdate(attachment.id, { text })}
          multiline
          textAlignVertical="top"
          placeholder="Paste log snippet or error output..."
          placeholderTextColor={brandColors.textMuted}
          style={[s.input, s.logInput]}
        />
      )}

      {attachment.kind === 'image' && (
        <View style={s.imageRow}>
          {attachment.uri ? (
            <>
              <Image
                source={{ uri: attachment.uri }}
                style={s.thumbnail}
                accessibilityLabel="Attachment thumbnail"
              />
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => void handlePickImage()}
                style={s.pasteButton}
              >
                <Text style={s.pasteText}>Change</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => void handlePickImage()}
              style={s.pickButton}
            >
              <Text style={s.pickText}>Pick Image</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: brandColors.silver,
    paddingTop: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kindLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.textSoft,
  },
  removeButton: {
    padding: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flex: { flex: 1 },
  input: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: brandRgba.ink08,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.ink,
  },
  logInput: {
    minHeight: 80,
    lineHeight: 18,
  },
  pasteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: brandRgba.ink08,
  },
  pasteText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '700',
    color: brandColors.coral,
  },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumbnail: {
    width: 100,
    height: 80,
    borderRadius: 8,
  },
  pickButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: brandRgba.ink08,
  },
  pickText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '700',
    color: brandColors.coral,
  },
});
