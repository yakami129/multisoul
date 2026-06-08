import { Mic, Square, X } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface Props {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
}

export default function VoiceInputButton({ disabled, onTranscript }: Props) {
  const { cancelVoiceInput, isAvailable, startVoiceInput, status, stopVoiceInput } = useVoiceInput({
    disabled,
    onTranscript,
  });
  const isDisabled = disabled || !isAvailable;

  const handleStartPress = () => {
    void startVoiceInput();
  };

  if (status === 'recording') {
    return (
      <View testID="voice-recording-controls" style={s.recordingControls}>
        <TouchableOpacity
          testID="voice-stop-btn"
          accessibilityLabel="Stop voice input"
          accessibilityRole="button"
          onPress={stopVoiceInput}
          style={s.hitControl}
        >
          <View testID="voice-stop-shell" style={[s.roundControl, s.recordingShell]}>
            <Square size={12} color={brandColors.error} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          testID="voice-cancel-btn"
          accessibilityLabel="Cancel voice input"
          accessibilityRole="button"
          onPress={cancelVoiceInput}
          style={s.hitControl}
        >
          <View testID="voice-cancel-shell" style={s.roundControl}>
            <X size={14} color={brandColors.ink} />
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'transcribing' || status === 'requesting_permission') {
    return (
      <TouchableOpacity
        testID="mic-btn"
        accessibilityLabel="Transcribing voice input"
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        disabled
        style={[s.hitControl, s.toolBtnDisabled]}
      >
        <View testID="mic-shell" style={s.roundControl}>
          <ActivityIndicator size="small" color={brandColors.ink} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      testID="mic-btn"
      accessibilityLabel="Voice input"
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={handleStartPress}
      disabled={isDisabled}
      style={[s.hitControl, isDisabled && s.toolBtnDisabled]}
    >
      <View testID="mic-shell" style={s.roundControl}>
        <Mic size={15} color={isDisabled ? brandColors.textMuted : brandColors.ink} />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
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
  recordingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recordingShell: {
    borderColor: brandColors.error,
  },
});
