import { ArrowUp, ChevronDown, Mic, Plus, Square, X } from 'lucide-react-native';
import React from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

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
  const handleVoicePress = () => Alert.alert('语音功能即将上线，敬请期待');
  const charCount = `${value.length} / 4096`;
  const actionDisabled = disabled && !isAgentRunning;

  return (
    <View style={s.card}>
      {pendingImages.length > 0 && (
        <ScrollView
          testID="img-preview-row"
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.imgStrip}
          contentContainerStyle={s.imgStripContent}
        >
          {pendingImages.map((img, idx) => (
            <View key={img.localUri} style={s.thumbWrapper}>
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
                <X size={8} color="#FFFFFF" />
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
          placeholderTextColor="#666666"
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
        <View style={s.toolbarLeft}>
          <TouchableOpacity
            testID="composer-plus-btn"
            accessibilityLabel="Add to message"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onOpenComposerSheet}
            disabled={disabled}
            style={[s.hitControl, disabled && s.toolBtnDisabled]}
          >
            <View style={s.roundControl}>
              <Plus size={18} color={disabled ? '#555555' : '#888888'} />
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
            <View style={s.modelChip}>
              <Text style={[s.modelChipText, modelDisabled && s.disabledText]} numberOfLines={1}>
                {modelLabel}
              </Text>
              <ChevronDown size={12} color={modelDisabled ? '#555555' : '#888888'} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            testID="mic-btn"
            accessibilityLabel="Voice input (coming soon)"
            accessibilityRole="button"
            onPress={handleVoicePress}
            style={s.hitControl}
          >
            <View style={s.roundControl}>
              <Mic size={18} color="#888888" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={s.toolbarRight}>
          <Text style={s.charCount}>{charCount}</Text>
          {isAgentRunning ? (
            <TouchableOpacity
              testID="stop-btn"
              accessibilityLabel="Stop conversation"
              accessibilityRole="button"
              onPress={onStop}
              style={[s.actionBtn, s.stopBtn]}
            >
              <Square size={14} color="#FF4444" />
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
              <ArrowUp size={18} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#333333',
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 16,
    shadowColor: '#FF6B3588',
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
    borderColor: '#2A2A2A',
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
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFailed: {
    backgroundColor: '#FF4444',
  },
  thumbOverlayText: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textRow: {
    minHeight: 28,
    maxHeight: 120,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 28,
    maxHeight: 98,
    padding: 0,
    margin: 0,
    fontFamily: 'Inter',
    fontSize: 17,
    color: '#FFFFFF',
    lineHeight: 22,
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
    gap: 2,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelChipHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  modelChip: {
    maxWidth: 130,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#1A1A1A',
  },
  modelChipText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#888888',
    maxWidth: 104,
  },
  disabledText: { color: '#555555' },
  charCount: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: '#FF6B35' },
  stopBtn: { backgroundColor: '#252525', borderWidth: 1, borderColor: '#FF4444' },
});
