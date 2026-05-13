import { ArrowUp, ImagePlus, Mic, Square, Terminal } from 'lucide-react-native';
import React from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  placeholder = 'Message Grok...',
}: Props) {
  const hasText = value.trim().length > 0;
  const handleVoicePress = () => Alert.alert('语音功能即将上线，敬请期待');
  const charCount = `${value.length} / 4096`;
  const actionDisabled = disabled && !isAgentRunning;

  return (
    <View style={s.container}>
      <View testID="input-surface" style={[s.inputSurface, disabled && s.inputRowDisabled]}>
        <View style={s.inputRow}>
          <View style={s.slashBadge}>
            <Text style={s.slashText}>/</Text>
          </View>
          <TextInput
            testID="message-input"
            style={s.input}
            placeholder={placeholder}
            placeholderTextColor="#555555"
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
      </View>

      <View testID="toolbar-divider" style={s.divider} />

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
            testID="voice-btn"
            accessibilityLabel="Voice input (coming soon)"
            accessibilityRole="button"
            onPress={handleVoicePress}
            style={s.toolBtn}
          >
            <Mic size={22} color="#555555" />
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
  container: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  inputSurface: {
    backgroundColor: '#252525',
    borderRadius: 14,
  },
  inputRow: {
    minHeight: 54,
    maxHeight: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 10,
  },
  inputRowDisabled: { opacity: 0.4 },
  slashBadge: {
    paddingRight: 4,
    alignSelf: 'flex-start',
    minHeight: 34,
    justifyContent: 'center',
  },
  slashText: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '600',
    color: '#FF6B35',
  },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 98,
    padding: 0,
    margin: 0,
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  divider: {
    height: 1,
    backgroundColor: '#252525',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
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
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: '#FF6B35' },
  stopBtn: { backgroundColor: '#252525', borderWidth: 1, borderColor: '#FF4444' },
});
