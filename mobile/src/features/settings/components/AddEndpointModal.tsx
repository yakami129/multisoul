import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { getEndpointClient } from '@/api/endpointClient';

type Tab = 'manual' | 'qr';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (label: string, base_url: string, token: string) => void;
}

export function AddEndpointModal({ visible, onClose, onAdd }: Props) {
  const [tab, setTab] = useState<Tab>('manual');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'err'>('idle');
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const reset = () => {
    setLabel('');
    setUrl('');
    setToken('');
    setStatus('idle');
    setScanned(false);
    setTab('manual');
  };

  const handleAdd = async (overrideUrl?: string, overrideToken?: string) => {
    const finalUrl = (overrideUrl ?? url).trim();
    const finalToken = (overrideToken ?? token).trim();
    if (!label.trim() || !finalUrl || !finalToken) return;
    setStatus('checking');
    try {
      const client = getEndpointClient(finalUrl, finalToken);
      await client.get('/api/v1/healthz');
      onAdd(label.trim(), finalUrl, finalToken);
      reset();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string; response?: { status?: number } };
      console.error(
        '[AddEndpoint] healthz failed:',
        JSON.stringify({
          message: err?.message,
          code: err?.code,
          status: err?.response?.status,
          url: finalUrl,
        }),
      );
      // Debug: test DNS + connectivity step by step
      try {
        console.warn('[AddEndpoint] Testing fetch to:', `${finalUrl}/api/v1/healthz`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${finalUrl}/api/v1/healthz`, {
          headers: { Authorization: `Bearer ${finalToken}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        console.warn('[AddEndpoint] fetch status:', res.status);
        const body = await res.text();
        console.warn('[AddEndpoint] fetch body:', body);
        if (res.ok) {
          onAdd(label.trim(), finalUrl, finalToken);
          reset();
          onClose();
          return;
        }
      } catch (e2: unknown) {
        const err2 = e2 as { message?: string; name?: string };
        console.error('[AddEndpoint] fetch also failed:', err2?.message, err2?.name);
      }
      // Debug: try a known public HTTPS endpoint to rule out general networking issue
      try {
        const pub = await fetch('https://httpbin.org/get');
        console.warn('[AddEndpoint] public HTTPS works:', pub.status);
      } catch (e3: unknown) {
        const err3 = e3 as { message?: string };
        console.error('[AddEndpoint] public HTTPS also failed:', err3?.message);
      }
      setStatus('err');
    }
  };

  // Parse multisoul://pair?url=...&token=...
  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    try {
      const parsed = new URL(data);
      if (parsed.protocol !== 'multisoul:') {
        setStatus('err');
        return;
      }
      const scannedUrl = parsed.searchParams.get('url') ?? '';
      const scannedToken = parsed.searchParams.get('token') ?? '';
      setUrl(scannedUrl);
      setToken(scannedToken);
      setTab('manual'); // switch to manual tab to show filled fields + label input
    } catch {
      setStatus('err');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.heading}>ADD ENDPOINT</Text>

          {/* Tab switcher */}
          <View style={s.tabs}>
            <TouchableOpacity
              style={[s.tab, tab === 'manual' && s.tabActive]}
              onPress={() => setTab('manual')}
            >
              <Text style={[s.tabText, tab === 'manual' && s.tabTextActive]}>MANUAL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tab, tab === 'qr' && s.tabActive]}
              onPress={() => {
                setScanned(false);
                setStatus('idle');
                if (!permission?.granted) void requestPermission();
                setTab('qr');
              }}
            >
              <Text style={[s.tabText, tab === 'qr' && s.tabTextActive]}>SCAN QR</Text>
            </TouchableOpacity>
          </View>

          {tab === 'manual' ? (
            <>
              <Text style={s.fieldLabel}>LABEL</Text>
              <TextInput
                style={s.input}
                value={label}
                onChangeText={setLabel}
                placeholder="Home Server"
                placeholderTextColor="#555555"
                autoCapitalize="none"
              />
              <Text style={s.fieldLabel}>URL</Text>
              <TextInput
                style={s.input}
                value={url}
                onChangeText={(v) => {
                  setUrl(v);
                  setStatus('idle');
                }}
                placeholder="http://192.168.1.x:8765"
                placeholderTextColor="#555555"
                autoCapitalize="none"
                keyboardType="url"
              />
              <Text style={s.fieldLabel}>TOKEN</Text>
              <TextInput
                style={s.input}
                value={token}
                onChangeText={(v) => {
                  setToken(v);
                  setStatus('idle');
                }}
                placeholder="ms_v2_..."
                placeholderTextColor="#555555"
                autoCapitalize="none"
                secureTextEntry
              />
              {status === 'err' && (
                <Text style={s.errText}>CANNOT REACH ENDPOINT — CHECK URL AND TOKEN</Text>
              )}
              <View style={s.actions}>
                <TouchableOpacity
                  style={s.btnSecondary}
                  onPress={() => {
                    reset();
                    onClose();
                  }}
                >
                  <Text style={s.btnSecondaryText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.btnPrimary}
                  onPress={() => {
                    void handleAdd();
                  }}
                  disabled={status === 'checking'}
                >
                  {status === 'checking' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={s.btnPrimaryText}>CONNECT</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={s.cameraWrap}>
              {permission?.granted ? (
                <CameraView
                  style={s.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                />
              ) : (
                <TouchableOpacity
                  style={s.permBtn}
                  onPress={() => {
                    void requestPermission();
                  }}
                >
                  <Text style={s.permText}>TAP TO ALLOW CAMERA</Text>
                </TouchableOpacity>
              )}
              {status === 'err' && <Text style={s.errText}>INVALID QR CODE</Text>}
              <TouchableOpacity
                style={s.btnSecondary}
                onPress={() => {
                  reset();
                  onClose();
                }}
              >
                <Text style={s.btnSecondaryText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  heading: {
    fontFamily: 'Inter',
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tab: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#252525',
  },
  tabActive: { backgroundColor: '#FF6B35' },
  tabText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  tabTextActive: { color: '#FFFFFF', fontWeight: '600' },
  fieldLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 0.5,
  },
  input: {
    height: 44,
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingHorizontal: 14,
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#FFFFFF',
  },
  errText: { fontFamily: 'Inter', fontSize: 12, color: '#FF4444' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnPrimary: {
    flex: 1,
    height: 44,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  btnPrimaryText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  btnSecondary: {
    flex: 1,
    height: 44,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  btnSecondaryText: { fontFamily: 'Inter', fontSize: 15, color: '#888888' },
  cameraWrap: { gap: 10 },
  camera: { width: '100%', height: 220, borderRadius: 10 },
  permBtn: {
    height: 220,
    backgroundColor: '#252525',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
});
