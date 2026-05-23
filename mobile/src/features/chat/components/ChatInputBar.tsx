import { ArrowUp, ImagePlus, Mic, Square, Terminal, X } from 'lucide-react-native';
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
  onPickImage: () => void;
  onOpenCommands: () => void;
  disabled: boolean;
  isAgentRunning: boolean;
  onStop: () => void;
  placeholder?: string;
  pendingImages: PendingImage[];
  onRemoveImage: (index: number) => void;
}

export default function ChatInputBar({
  value,
  onChangeText,
  onSend,
  onPickImage,
  onOpenCommands,
  disabled,
  isAgentRunning,
  onStop,
  placeholder = 'Message Grok...',
  pendingImages,
  onRemoveImage,
}: Props) {
  const hasText = value.trim().length > 0;
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
          placeholderTextColor="#333333"
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          maxLength={4096}
          returnKeyType="default"
          scrollEnabled
        />
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
        ) : hasText ? (
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
        ) : (
          <TouchableOpacity
            testID="mic-btn"
            accessibilityLabel="Voice input (coming soon)"
            accessibilityRole="button"
            onPress={handleVoicePress}
            style={s.actionBtn}
          >
            <Mic size={17} color="#666666" />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.toolbar}>
        <View style={s.toolbarLeft}>
          <TouchableOpacity
            testID="attach-btn"
            accessibilityLabel="Attach image"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onPickImage}
            disabled={disabled}
            style={[s.toolBtn, disabled && s.toolBtnDisabled]}
          >
            <ImagePlus size={22} color={disabled ? '#555555' : '#888888'} />
          </TouchableOpacity>

          <TouchableOpacity
            testID="command-btn"
            accessibilityLabel="Open commands"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onOpenCommands}
            disabled={disabled}
            style={[s.commandPill, disabled && s.toolBtnDisabled]}
          >
            <Terminal size={14} color={disabled ? '#555555' : '#FF6B35'} />
            <Text style={[s.commandPillText, disabled && s.disabledText]}>Commands</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.charCount}>{charCount}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    padding: 12,
    paddingHorizontal: 14,
    gap: 8,
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
    minHeight: 40,
    maxHeight: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 24,
    maxHeight: 98,
    padding: 0,
    margin: 0,
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  toolBtnDisabled: { opacity: 0.4 },
  commandPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B3588',
    backgroundColor: '#1A1A1A',
  },
  commandPillText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#FF6B35',
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
