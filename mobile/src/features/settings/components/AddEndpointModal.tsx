import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, Copy, Info, Terminal, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEndpointClient } from '@/api/endpointClient';
import { brandColors } from '@/theme/brandRefresh';
import { addEndpointModalStyles as s } from './addEndpointModalStyles';

type SetupCommand = {
  id: string;
  title: string;
  command: string;
};
type ScanStatus = 'idle' | 'checking' | 'invalid_qr' | 'connection_err';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (label: string, base_url: string, token: string) => void;
  initialTab?: 'manual' | 'qr';
}

const SETUP_COMMANDS: SetupCommand[] = [
  { id: 'install', title: '1. Install msctl', command: 'npm install -g @yakami129/msctl' },
  {
    id: 'service',
    title: '2. Start service',
    command: 'msctl daemon quickstart --token test --port 8765 --tailnet true',
  },
  {
    id: 'codex',
    title: 'Codex',
    command: 'cd /path/to/project\nmsctl agent codex',
  },
  {
    id: 'claude',
    title: 'Claude Code',
    command: 'cd /path/to/project\nmsctl agent claude-code',
  },
  {
    id: 'cursor',
    title: 'Cursor Agent CLI',
    command: 'cd /path/to/project\nmsctl agent cursor-cli',
  },
];
const LOCAL_TEST_ENDPOINT = {
  label: '127.0.0.1',
  url: 'http://127.0.0.1:8765',
  token: 'test',
};

export function AddEndpointModal({ visible, onClose, onAdd }: Props) {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [scanned, setScanned] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanInFlightRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    if (!permission?.granted) void requestPermission();
  }, [permission?.granted, requestPermission, visible]);

  useEffect(() => {
    if (!copiedId) return undefined;
    const timeout = setTimeout(() => setCopiedId(null), 1200);
    return () => clearTimeout(timeout);
  }, [copiedId]);

  const reset = () => {
    scanInFlightRef.current = false;
    setStatus('idle');
    setScanned(false);
    setHelpVisible(false);
    setCopiedId(null);
  };

  const handleCopyCommand = async (command: SetupCommand) => {
    await Clipboard.setStringAsync(command.command);
    setCopiedId(command.id);
  };

  const handleAdd = async (overrideUrl: string, overrideToken: string) => {
    const finalUrl = overrideUrl.trim();
    const finalToken = overrideToken.trim();
    if (!finalUrl || !finalToken) return;
    const endpointLabel = getEndpointLabel(finalUrl);
    setStatus('checking');
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
      // Debug: test DNS + connectivity step by step
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
      // Debug: try a known public HTTPS endpoint to rule out general networking issue
      try {
        const pub = await fetch('https://httpbin.org/get');
        console.warn('[AddEndpoint] public HTTPS works:', pub.status);
      } catch (e3: unknown) {
        const err3 = e3 as { message?: string };
        console.error('[AddEndpoint] public HTTPS also failed:', err3?.message);
      }
      scanInFlightRef.current = false;
      setScanned(false);
      setStatus('connection_err');
    }
  };

  // Parse multisoul://pair?url=...&token=...
  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanInFlightRef.current || scanned) return;
    scanInFlightRef.current = true;
    setScanned(true);
    try {
      const parsed = new URL(data);
      if (parsed.protocol !== 'multisoul:') {
        scanInFlightRef.current = false;
        setStatus('invalid_qr');
        return;
      }
      const scannedUrl = parsed.searchParams.get('url') ?? '';
      const scannedToken = parsed.searchParams.get('token') ?? '';
      if (!scannedUrl || !scannedToken) {
        scanInFlightRef.current = false;
        setStatus('invalid_qr');
        return;
      }
      void handleAdd(scannedUrl, scannedToken);
    } catch {
      scanInFlightRef.current = false;
      setStatus('invalid_qr');
    }
  };

  const renderScanHeader = () => (
    <View style={s.scanHeader}>
      <View style={s.scanBadge}>
        <Text style={s.scanBadgeText} numberOfLines={1}>
          SCAN QR
        </Text>
        <TouchableOpacity
          accessibilityLabel="Show setup commands"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setHelpVisible(true)}
          style={s.fullHelpButton}
        >
          <Info size={13} color={brandColors.white} />
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
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Add local test endpoint"
        disabled={status === 'checking'}
        style={[s.localTestButton, status === 'checking' && s.localTestButtonDisabled]}
        onPress={() => {
          void handleAdd(LOCAL_TEST_ENDPOINT.url, LOCAL_TEST_ENDPOINT.token);
        }}
      >
        <Terminal size={16} color={brandColors.ink} />
        <View style={s.localTestCopy}>
          <Text style={s.localTestTitle} numberOfLines={1}>
            Add local test endpoint
          </Text>
          <Text style={s.localTestUrl} numberOfLines={1}>
            {LOCAL_TEST_ENDPOINT.url}
          </Text>
        </View>
      </TouchableOpacity>
    </>
  );

  const renderHelpSheet = () =>
    helpVisible ? (
      <View style={s.helpOverlay}>
        <TouchableOpacity
          accessibilityLabel="Close setup commands"
          style={s.helpScrim}
          activeOpacity={1}
          onPress={() => setHelpVisible(false)}
        />
        <View style={s.helpSheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View style={s.sheetTitleBlock}>
              <Text style={s.sheetTitle} numberOfLines={1}>
                Set up local agent
              </Text>
              <Text style={s.sheetSubtitle}>
                Run these commands on the machine you want to connect.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close setup commands"
              accessibilityRole="button"
              style={s.sheetCloseButton}
              onPress={() => setHelpVisible(false)}
            >
              <X size={16} color={brandColors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={s.commandsScroll}
            contentContainerStyle={s.commandsContent}
            showsVerticalScrollIndicator={false}
          >
            <CommandBlock
              command={SETUP_COMMANDS[0]}
              copiedId={copiedId}
              onCopy={handleCopyCommand}
            />
            <CommandBlock
              command={SETUP_COMMANDS[1]}
              copiedId={copiedId}
              onCopy={handleCopyCommand}
            />
            <Text style={s.registerTitle}>3. Register an Agent</Text>
            {SETUP_COMMANDS.slice(2).map((command) => (
              <CommandBlock
                key={command.id}
                command={command}
                copiedId={copiedId}
                onCopy={handleCopyCommand}
                compact
              />
            ))}
          </ScrollView>
        </View>
      </View>
    ) : null;

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
          <Text style={s.fullSubtitle} numberOfLines={2}>
            Scan the QR code from msctl quickstart.
          </Text>
          {renderScanHeader()}
          {renderFullScreenQrContent()}
        </ScrollView>
        {renderHelpSheet()}
      </SafeAreaView>
    </Modal>
  );
}

function getEndpointLabel(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname) return hostname;
  } catch {
    const withoutScheme = baseUrl.replace(/^[a-z]+:\/\//i, '');
    const host = withoutScheme.split(/[/:?#]/)[0];
    if (host) return host;
  }
  return baseUrl;
}

function CommandBlock({
  command,
  copiedId,
  onCopy,
  compact = false,
}: {
  command: SetupCommand;
  copiedId: string | null;
  onCopy: (command: SetupCommand) => Promise<void>;
  compact?: boolean;
}) {
  const copied = copiedId === command.id;

  return (
    <View style={[s.commandBlock, compact && s.commandBlockCompact]}>
      <View style={s.commandHeader}>
        <Text style={[s.commandTitle, compact && s.commandTitleAccent]} numberOfLines={1}>
          {command.title}
        </Text>
        <TouchableOpacity
          accessibilityLabel={`Copy ${command.title} command`}
          accessibilityRole="button"
          onPress={() => {
            void onCopy(command);
          }}
          style={s.copyButton}
        >
          {copied ? (
            <Text style={s.copiedText}>COPIED</Text>
          ) : (
            <Copy size={13} color={brandColors.textMuted} />
          )}
        </TouchableOpacity>
      </View>
      <Text style={s.commandText}>{command.command}</Text>
    </View>
  );
}
