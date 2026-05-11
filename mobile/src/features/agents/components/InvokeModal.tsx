import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  visible: boolean;
  result: string | null;
  error: string | null;
  onClose: () => void;
}

export function InvokeModal({ visible, result, error, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>INVOKE RESULT</Text>
          </View>
          <ScrollView style={s.body} contentContainerStyle={{ padding: 16 }}>
            {error ? (
              <Text style={s.errorText}>{error}</Text>
            ) : (
              <Text style={s.resultText}>{result}</Text>
            )}
          </ScrollView>
          <View style={s.footer}>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  header: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  title: { fontFamily: 'Inter', fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  body: { maxHeight: 240 },
  errorText: { fontFamily: 'Inter', fontSize: 13, color: '#FF4444', lineHeight: 20 },
  resultText: { fontFamily: 'Inter', fontSize: 12, color: '#DDDDDD', lineHeight: 18 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  closeBtn: {
    height: 44,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
