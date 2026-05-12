import { ImageIcon, Mic, Send, Slash, Square } from 'lucide-react-native';
import React from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

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
  placeholder = 'Message...',
}: Props) {
  const hasText = value.trim().length > 0;
  const handleVoicePress = () => Alert.alert('语音功能即将上线，敬请期待');

  return (
    <View style={s.container}>
      {/* Input row */}
      <View style={[s.inputRow, disabled && s.inputRowDisabled]}>
        <TextInput
          testID="message-input"
          style={s.input}
          placeholder={placeholder}
          placeholderTextColor="#555555"
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          returnKeyType="default"
          scrollEnabled
        />
      </View>

      {/* Toolbar row */}
      <View style={s.toolbar}>
        {/* Attach image */}
        <TouchableOpacity
          testID="attach-btn"
          accessibilityLabel="Attach image"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          onPress={onPickImage}
          disabled={disabled}
          style={[s.toolBtn, disabled && s.toolBtnDisabled]}
        >
          <ImageIcon size={22} color={disabled ? '#555555' : '#888888'} />
        </TouchableOpacity>

        {/* Command */}
        <TouchableOpacity
          testID="command-btn"
          accessibilityLabel="Open commands"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          onPress={onOpenCommands}
          disabled={disabled}
          style={[s.toolBtn, disabled && s.toolBtnDisabled]}
        >
          <Slash size={22} color={disabled ? '#555555' : '#888888'} />
        </TouchableOpacity>

        {/* Voice (placeholder) */}
        <TouchableOpacity
          testID="voice-btn"
          accessibilityLabel="Voice input (coming soon)"
          accessibilityRole="button"
          onPress={handleVoicePress}
          style={s.toolBtn}
        >
          <Mic size={22} color="#555555" />
        </TouchableOpacity>

        <View style={s.spacer} />

        {/* Send / Stop / Mic */}
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
            onPress={onSend}
            style={[s.actionBtn, s.sendBtn]}
          >
            <Send size={16} color="#0D0D0D" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            testID="mic-btn"
            accessibilityLabel="Voice input (coming soon)"
            accessibilityRole="button"
            onPress={handleVoicePress}
            style={[s.actionBtn, s.micBtn]}
          >
            <Mic size={16} color="#555555" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  inputRow: {
    minHeight: 44,
    maxHeight: 120,
  },
  inputRowDisabled: { opacity: 0.4 },
  input: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    gap: 4,
  },
  toolBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  toolBtnDisabled: { opacity: 0.4 },
  spacer: { flex: 1 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: '#FF6B35' },
  stopBtn: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#FF4444' },
  micBtn: { backgroundColor: '#1A1A1A' },
});
