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
  overlay:      { flex: 1, backgroundColor: 'rgba(4,13,4,0.85)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: '#061206', borderTopLeftRadius: 2, borderTopRightRadius: 2,
                  borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
                  borderColor: '#0F2B0F', maxHeight: '60%' },
  header:       { height: 52, justifyContent: 'center', paddingHorizontal: 16,
                  borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  title:        { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  body:         { maxHeight: 240 },
  errorText:    { fontFamily: 'Geist', fontSize: 13, color: '#FFB000', lineHeight: 20 },
  resultText:   { fontFamily: 'Geist Mono', fontSize: 12, color: '#20C20E', lineHeight: 18 },
  footer:       { padding: 16, borderTopWidth: 1, borderTopColor: '#0F2B0F' },
  closeBtn:     { height: 44, backgroundColor: '#0F2B0F', borderRadius: 2,
                  alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontFamily: 'Anton', fontSize: 14, color: '#20C20E', letterSpacing: 1 },
});
