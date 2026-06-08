import { ArrowUp, ChevronDown, Plus, Square, X } from 'lucide-react-native';
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import VoiceInputButton from './VoiceInputButton';
import { appendVoiceTranscript } from '../utils/voiceInputText';

interface PendingImage {
  localUri: string;
  fileId: string | null;
  status: 'uploading' | 'uploaded' | 'failed';
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
  isAgentRunning: boolean;
  onStop: () => void;
  placeholder?: string;
  pendingImages: PendingImage[];
  onRemoveImage: (index: number) => void;
  modelLabel: string;
  modelDisabled: boolean;
  onOpenModelSelector: () => void;
  onOpenComposerSheet: () => void;
}

export default function ChatInputBar({
  value,
  onChangeText,
  onSend,
  disabled,
  isAgentRunning,
  onStop,
  placeholder = 'Message Grok...',
  pendingImages,
  onRemoveImage,
  modelLabel,
  modelDisabled,
  onOpenModelSelector,
  onOpenComposerSheet,
}: Props) {
  const hasText = value.trim().length > 0;
  const hasUploadedImage = pendingImages.some((img) => img.status === 'uploaded' && img.fileId);
  const canSend = hasText || hasUploadedImage;
  const handleVoiceTranscript = React.useCallback(
    (transcript: string) => {
      onChangeText(appendVoiceTranscript(value, transcript));
    },
    [onChangeText, value],
  );
  const charCount = `${value.length} / 4096`;
  const shouldShowCounter = value.length > 0;
  const actionDisabled = disabled && !isAgentRunning;
  const voiceDisabled = disabled || isAgentRunning;

  return (
    <View testID="composer-card" style={s.card}>
      {pendingImages.length > 0 && (
        <ScrollView
          testID="img-preview-row"
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.imgStrip}
          contentContainerStyle={s.imgStripContent}
        >
          {pendingImages.map((img, idx) => (
            <View key={`${img.localUri}-${idx}`} style={s.thumbWrapper}>
              <Image source={{ uri: img.localUri }} style={s.thumb} />
              {img.status === 'uploading' && (
                <View style={s.thumbOverlay}>
                  <Text style={s.thumbOverlayText}>...</Text>
                </View>
              )}
              {img.status === 'failed' && (
                <View style={[s.thumbOverlay, s.thumbFailed]}>
                  <Text style={s.thumbOverlayText}>!</Text>
                </View>
              )}
              <Pressable
                testID={`remove-img-${idx}`}
                style={s.removeBadge}
                onPress={() => onRemoveImage(idx)}
                accessibilityLabel="Remove image"
                accessibilityRole="button"
              >
                <X size={8} color={brandColors.white} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={s.textRow}>
        <TextInput
          testID="message-input"
          style={s.input}
          placeholder={placeholder}
          placeholderTextColor={brandColors.textDisabled}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          maxLength={4096}
          returnKeyType="default"
          scrollEnabled
        />
      </View>

      <View style={s.toolbar}>
        <View testID="composer-toolbar-left" style={s.toolbarLeft}>
          <TouchableOpacity
            testID="composer-plus-btn"
            accessibilityLabel="Add to message"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onOpenComposerSheet}
            disabled={disabled}
            style={[s.hitControl, disabled && s.toolBtnDisabled]}
          >
            <View testID="composer-plus-shell" style={s.roundControl}>
              <Plus size={15} color={disabled ? brandColors.textMuted : brandColors.ink} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            testID="composer-model-chip"
            accessibilityLabel="Switch model"
            accessibilityRole="button"
            accessibilityState={{ disabled: modelDisabled }}
            onPress={onOpenModelSelector}
            disabled={modelDisabled}
            style={[s.modelChipHit, modelDisabled && s.toolBtnDisabled]}
          >
            <View testID="composer-model-shell" style={s.modelChip}>
              <Text style={[s.modelChipText, modelDisabled && s.disabledText]} numberOfLines={1}>
                {modelLabel}
              </Text>
              <ChevronDown
                size={10}
                color={modelDisabled ? brandColors.textMuted : brandColors.ink}
              />
            </View>
          </TouchableOpacity>
        </View>

        <View testID="composer-toolbar-right" style={s.toolbarRight}>
          {shouldShowCounter ? <Text style={s.charCount}>{charCount}</Text> : null}
          <VoiceInputButton disabled={voiceDisabled} onTranscript={handleVoiceTranscript} />
          {isAgentRunning ? (
            <TouchableOpacity
              testID="stop-btn"
              accessibilityLabel="Stop conversation"
              accessibilityRole="button"
              onPress={onStop}
              style={[s.actionBtn, s.stopBtn]}
            >
              <Square size={12} color={brandColors.error} />
            </TouchableOpacity>
          ) : canSend ? (
            <TouchableOpacity
              testID="send-btn"
              accessibilityLabel="Send message"
              accessibilityRole="button"
              accessibilityState={{ disabled: actionDisabled }}
              onPress={onSend}
              disabled={actionDisabled}
              style={[s.actionBtn, s.sendBtn, actionDisabled && s.toolBtnDisabled]}
            >
              <ArrowUp size={15} color={brandColors.white} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: brandRgba.white88,
    minHeight: 112,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: brandColors.silver,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  imgStrip: {
    maxHeight: 68,
  },
  imgStripContent: {
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbWrapper: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: brandColors.silver,
  },
  thumb: {
    width: 52,
    height: 52,
  },
  thumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: brandRgba.ink72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFailed: {
    backgroundColor: brandColors.error,
  },
  thumbOverlayText: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '700',
    color: brandColors.white,
  },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: brandRgba.ink72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textRow: {
    minHeight: 36,
    maxHeight: 108,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 88,
    padding: 0,
    margin: 0,
    fontFamily: 'Inter',
    fontSize: 15,
    color: brandColors.ink,
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },
  hitControl: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolBtnDisabled: { opacity: 0.4 },
  roundControl: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: brandRgba.ink08,
    borderWidth: 1,
    borderColor: brandColors.silver,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelChipHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  modelChip: {
    maxWidth: 132,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.ink08,
  },
  modelChipText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: brandColors.ink,
    maxWidth: 106,
  },
  disabledText: { color: brandColors.textMuted },
  charCount: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.textMuted,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: brandColors.ink },
  stopBtn: { backgroundColor: brandRgba.ink08, borderWidth: 1, borderColor: brandColors.error },
});
