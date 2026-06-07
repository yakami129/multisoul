import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, Info, Terminal, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEndpointClient } from '@/api/endpointClient';
import { brandColors } from '@/theme/brandRefresh';
import { AddEndpointHelpSheet } from './AddEndpointHelpSheet';
import { addEndpointModalStyles as s } from './addEndpointModalStyles';
import type { ManualStatus, ScanStatus, Tab } from './addEndpointModalTypes';
import { getEndpointLabel, parsePairConnection } from './addEndpointModalUtils';

export { parsePairConnection } from './addEndpointModalUtils';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (label: string, base_url: string, token: string) => void;
  initialTab?: 'manual' | 'qr';
}

export function AddEndpointModal({ visible, onClose, onAdd, initialTab = 'qr' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [manualStatus, setManualStatus] = useState<ManualStatus>('idle');
  const [manualUrl, setManualUrl] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [scanned, setScanned] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanInFlightRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setTab(initialTab);
  }, [initialTab, visible]);

  useEffect(() => {
    if (!visible || tab !== 'qr') return;
    if (!permission?.granted) void requestPermission();
  }, [permission?.granted, requestPermission, tab, visible]);

  useEffect(() => {
    if (!copiedId) return undefined;
    const timeout = setTimeout(() => setCopiedId(null), 1200);
    return () => clearTimeout(timeout);
  }, [copiedId]);

  const reset = () => {
    scanInFlightRef.current = false;
    setTab(initialTab);
    setStatus('idle');
    setManualStatus('idle');
    setManualUrl('');
    setManualToken('');
    setScanned(false);
    setHelpVisible(false);
    setCopiedId(null);
  };

  const handleCopyCommand = async (command: { id: string; command: string }) => {
    await Clipboard.setStringAsync(command.command);
    setCopiedId(command.id);
  };

  const handleAdd = async (
    overrideUrl: string,
    overrideToken: string,
    source: 'qr' | 'manual' = 'qr',
  ) => {
    const finalUrl = overrideUrl.trim();
    const finalToken = overrideToken.trim();
    if (!finalUrl || !finalToken) return;
    const endpointLabel = getEndpointLabel(finalUrl);
    if (source === 'manual') {
      setManualStatus('checking');
    } else {
      setStatus('checking');
    }
    try {
      const client = getEndpointClient(finalUrl, finalToken);
      await client.get('/api/v1/healthz');
      onAdd(endpointLabel, finalUrl, finalToken);
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
      try {
        console.warn('[AddEndpoint] Testing fetch to:', `${finalUrl}/api/v1/healthz`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${finalUrl}/api/v1/healthz`, {
          headers: { Authorization: `Bearer ${finalToken}` },
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        console.warn('[AddEndpoint] fetch status:', res.status);
        const body = await res.text();
        console.warn('[AddEndpoint] fetch body:', body);
        if (res.ok) {
          onAdd(endpointLabel, finalUrl, finalToken);
          reset();
          onClose();
          return;
        }
      } catch (e2: unknown) {
        const err2 = e2 as { message?: string; name?: string };
        console.error('[AddEndpoint] fetch also failed:', err2?.message, err2?.name);
      }
      try {
        const pub = await fetch('https://httpbin.org/get');
        console.warn('[AddEndpoint] public HTTPS works:', pub.status);
      } catch (e3: unknown) {
        const err3 = e3 as { message?: string };
        console.error('[AddEndpoint] public HTTPS also failed:', err3?.message);
      }
      scanInFlightRef.current = false;
      setScanned(false);
      if (source === 'manual') {
        setManualStatus('connection_err');
      } else {
        setStatus('connection_err');
      }
    }
  };

  const handleManualConnect = () => {
    void handleAdd(manualUrl, manualToken, 'manual');
  };

  const handlePasteConnectionString = async () => {
    const text = await Clipboard.getStringAsync();
    const parsed = parsePairConnection(text);
    if (!parsed) {
      setManualStatus('invalid_paste');
      return;
    }
    setManualUrl(parsed.url);
    setManualToken(parsed.token);
    setManualStatus('idle');
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanInFlightRef.current || scanned) return;
    scanInFlightRef.current = true;
    setScanned(true);
    const pair = parsePairConnection(data);
    if (!pair) {
      scanInFlightRef.current = false;
      setStatus('invalid_qr');
      return;
    }
    void handleAdd(pair.url, pair.token, 'qr');
  };

  const renderModeTabs = () => (
    <View style={s.scanHeader}>
      <View style={s.modeTabs}>
        <TouchableOpacity
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'qr' }}
          accessibilityLabel="Scan QR"
          style={[s.modeTab, tab === 'qr' && s.modeTabActive]}
          onPress={() => {
            setTab('qr');
            setManualStatus('idle');
          }}
        >
          <Text style={[s.modeTabText, tab === 'qr' && s.modeTabTextActive]} numberOfLines={1}>
            SCAN QR
          </Text>
          {tab === 'qr' ? (
            <TouchableOpacity
              accessibilityLabel="Show setup commands"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setHelpVisible(true)}
              style={s.fullHelpButton}
            >
              <Info size={13} color={brandColors.white} />
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'manual' }}
          accessibilityLabel="Enter manually"
          style={[s.modeTab, tab === 'manual' && s.modeTabActive]}
          onPress={() => {
            setTab('manual');
            setStatus('idle');
            setScanned(false);
            scanInFlightRef.current = false;
          }}
        >
          <Text style={[s.modeTabText, tab === 'manual' && s.modeTabTextActive]} numberOfLines={1}>
            MANUAL
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderQrScanner = () => (
    <>
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
      {status === 'invalid_qr' && <Text style={s.errText}>INVALID QR CODE</Text>}
      {status === 'connection_err' && <Text style={s.errText}>CANNOT REACH ENDPOINT</Text>}
    </>
  );

  const manualConnectDisabled =
    manualStatus === 'checking' || !manualUrl.trim() || !manualToken.trim();

  const renderManualEntry = () => (
    <View style={s.manualCard}>
      <Text style={s.manualCardSubtitle}>
        Paste the connection string from msctl, or type the service address and token.
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Paste connection string"
        style={s.pasteLink}
        onPress={() => {
          void handlePasteConnectionString();
        }}
      >
        <Text style={s.pasteLinkText}>Paste connection string</Text>
      </TouchableOpacity>
      <Text style={s.fieldLabel}>Service address</Text>
      <TextInput
        style={s.textInput}
        value={manualUrl}
        onChangeText={(value) => {
          setManualUrl(value);
          if (manualStatus !== 'idle') setManualStatus('idle');
        }}
        placeholder="https://your-machine.example.com:8765"
        placeholderTextColor={brandColors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Service address"
      />
      <Text style={s.fieldLabel}>Token</Text>
      <TextInput
        style={s.textInput}
        value={manualToken}
        onChangeText={(value) => {
          setManualToken(value);
          if (manualStatus !== 'idle') setManualStatus('idle');
        }}
        placeholder="ms_v2_..."
        placeholderTextColor={brandColors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        accessibilityLabel="Token"
      />
      {manualStatus === 'invalid_paste' && (
        <Text style={s.manualErrText}>INVALID CONNECTION STRING</Text>
      )}
      {manualStatus === 'connection_err' && (
        <Text style={s.manualErrText}>CANNOT REACH ENDPOINT</Text>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Connect endpoint"
        style={[s.connectButton, manualConnectDisabled && s.connectButtonDisabled]}
        disabled={manualConnectDisabled}
        onPress={handleManualConnect}
      >
        {manualStatus === 'checking' ? (
          <ActivityIndicator size="small" color={brandColors.white} />
        ) : (
          <Text style={s.connectButtonText}>Connect</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderFullScreenQrContent = () => (
    <>
      <View style={s.qrCard}>
        <Text style={s.qrCardTitle} numberOfLines={1}>
          Scan setup QR
        </Text>
        <Text style={s.qrCardSubtitle}>
          Open msctl on your machine and scan the generated code.
        </Text>
        <View style={s.fullScannerBox}>{renderQrScanner()}</View>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open setup commands hint"
        style={s.commandHint}
        onPress={() => setHelpVisible(true)}
      >
        <Terminal size={16} color={brandColors.coral} />
        <Text style={s.commandHintText} numberOfLines={2}>
          Need commands? Tap the help icon next to SCAN QR.
        </Text>
      </TouchableOpacity>
    </>
  );

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.fullScreen}>
        <View style={s.fullNav}>
          <TouchableOpacity
            style={s.backButton}
            onPress={() => {
              reset();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to Agents"
          >
            <ChevronLeft size={18} color={brandColors.ink} />
            <Text style={s.backText} numberOfLines={1}>
              Agents
            </Text>
          </TouchableOpacity>
          <Text style={s.fullNavTitle} numberOfLines={1}>
            Add Endpoint
          </Text>
          <View style={s.navSpacer} />
        </View>
        <ScrollView
          style={s.fullScroll}
          contentContainerStyle={s.fullContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.titleRow}>
            <Text style={s.fullTitle} numberOfLines={2}>
              Connect a machine
            </Text>
            <TouchableOpacity
              accessibilityLabel="Close Add Endpoint"
              accessibilityRole="button"
              style={s.contentCloseButton}
              onPress={() => {
                reset();
                onClose();
              }}
            >
              <X size={18} color={brandColors.ink} />
            </TouchableOpacity>
          </View>
          <Text style={s.fullSubtitle} numberOfLines={3}>
            {tab === 'qr'
              ? 'Scan the QR code from msctl daemon quickstart.'
              : 'Enter the service address and token from msctl daemon quickstart.'}
          </Text>
          {renderModeTabs()}
          {tab === 'qr' ? renderFullScreenQrContent() : renderManualEntry()}
        </ScrollView>
        <AddEndpointHelpSheet
          visible={helpVisible}
          copiedId={copiedId}
          onClose={() => setHelpVisible(false)}
          onCopy={handleCopyCommand}
        />
      </SafeAreaView>
    </Modal>
  );
}
