import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { getEndpointClient } from '@/api/endpointClient';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (label: string, base_url: string, token: string) => void;
}

export function AddEndpointModal({ visible, onClose, onAdd }: Props) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'err'>('idle');

  const reset = () => { setLabel(''); setUrl(''); setToken(''); setStatus('idle'); };

  const handleAdd = async () => {
    if (!label.trim() || !url.trim() || !token.trim()) return;
    setStatus('checking');
    try {
      const client = getEndpointClient(url.trim(), token.trim());
      await client.get('/api/v1/healthz');
      onAdd(label.trim(), url.trim(), token.trim());
      reset();
      onClose();
    } catch {
      setStatus('err');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.heading}>ADD ENDPOINT</Text>

          <Text style={s.fieldLabel}>LABEL</Text>
          <TextInput
            style={s.input} value={label} onChangeText={setLabel}
            placeholder="Home Server" placeholderTextColor="#2D8B2D"
            autoCapitalize="none"
          />

          <Text style={s.fieldLabel}>URL</Text>
          <TextInput
            style={s.input} value={url}
            onChangeText={(v) => { setUrl(v); setStatus('idle'); }}
            placeholder="http://192.168.1.x:3000" placeholderTextColor="#2D8B2D"
            autoCapitalize="none" keyboardType="url"
          />

          <Text style={s.fieldLabel}>TOKEN</Text>
          <TextInput
            style={s.input} value={token}
            onChangeText={(v) => { setToken(v); setStatus('idle'); }}
            placeholder="ms_v2_..." placeholderTextColor="#2D8B2D"
            autoCapitalize="none" secureTextEntry
          />

          {status === 'err' && (
            <Text style={s.errText}>CANNOT REACH ENDPOINT — CHECK URL AND TOKEN</Text>
          )}

          <View style={s.actions}>
            <TouchableOpacity style={s.btnSecondary} onPress={() => { reset(); onClose(); }}>
              <Text style={s.btnSecondaryText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btnPrimary} onPress={handleAdd}
              disabled={status === 'checking'}
            >
              {status === 'checking'
                ? <ActivityIndicator size="small" color="#040D04" />
                : <Text style={s.btnPrimaryText}>CONNECT</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: 'rgba(4,13,4,0.92)',
                      alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:             { width: '100%', backgroundColor: '#061206',
                      borderWidth: 1, borderColor: '#0F2B0F', borderRadius: 2,
                      padding: 20, gap: 8 },
  heading:          { fontFamily: 'Anton', fontSize: 16, color: '#20C20E',
                      letterSpacing: 2, marginBottom: 4 },
  fieldLabel:       { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 1 },
  input:            { height: 40, backgroundColor: '#0A1A0A', borderWidth: 1,
                      borderColor: '#0F2B0F', borderRadius: 2, paddingHorizontal: 12,
                      fontFamily: 'Geist', fontSize: 14, color: '#20C20E' },
  errText:          { fontFamily: 'Inter', fontSize: 11, color: '#FF4444', letterSpacing: 0.5 },
  actions:          { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnPrimary:       { flex: 1, height: 40, backgroundColor: '#20C20E',
                      alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  btnPrimaryText:   { fontFamily: 'Anton', fontSize: 13, color: '#040D04', letterSpacing: 1 },
  btnSecondary:     { flex: 1, height: 40, borderWidth: 1, borderColor: '#0F2B0F',
                      alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  btnSecondaryText: { fontFamily: 'Anton', fontSize: 13, color: '#2D8B2D', letterSpacing: 1 },
});
