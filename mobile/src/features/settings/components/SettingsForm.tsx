import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { Settings } from '@/features/settings/services/settingsService';
import { pollTunnelUrl } from '@/features/settings/services/tunnelService';
import { useSettingsStore } from '@/store/settingsStore';

export function SettingsForm() {
  const insets = useSafeAreaInsets();
  const { settings, save } = useSettingsStore();

  const [mode, setMode] = useState<'auto' | 'custom'>(settings.connectionMode);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [relayToken, setRelayToken] = useState(settings.relayToken);
  const [saving, setSaving] = useState(false);

  // Keep a ref to the active poll so we can cancel it on unmount or re-press
  const activePollRef = useRef<{ abort: () => void } | null>(null);

  useEffect(() => {
    return () => {
      activePollRef.current?.abort();
    };
  }, []);

  const handleSave = async () => {
    // Cancel any in-flight poll before starting a new one
    activePollRef.current?.abort();
    activePollRef.current = null;

    setSaving(true);
    try {
      let resolvedServerUrl = serverUrl.trim();
      let resolvedApiKey = apiKey.trim();

      if (mode === 'auto') {
        if (!relayToken.trim()) {
          Alert.alert('Missing Token', 'Please enter your msctl Bearer token.');
          return;
        }
        // Important fix: validate relay worker URL is configured before polling
        if (settings.relayWorkerUrl.includes('PLACEHOLDER')) {
          Alert.alert(
            'Not Configured',
            'Relay worker URL is not configured. Please contact support or use Custom Server mode.',
          );
          return;
        }
        const poll = pollTunnelUrl(settings.relayWorkerUrl, relayToken.trim());
        activePollRef.current = poll;
        resolvedServerUrl = await poll.promise;
        activePollRef.current = null;
        resolvedApiKey = relayToken.trim();
      }

      const updated: Settings = {
        ...settings,
        connectionMode: mode,
        serverUrl: resolvedServerUrl,
        apiKey: resolvedApiKey,
        relayToken: relayToken.trim(),
      };
      await save(updated);
      Alert.alert(
        'Connected',
        mode === 'auto' ? `Tunnel: ${resolvedServerUrl}` : 'Settings saved.',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg !== 'Tunnel poll cancelled') {
        Alert.alert('Connection Failed', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        className="flex-1 bg-[#0D0D0D]"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[22px] leading-[26px] font-bold text-white px-4 pt-3 pb-4">
          Settings
        </Text>

        {/* Connection mode toggle */}
        <Card className="mx-4 mb-3">
          <Text className="text-[#888888] text-[10px] mb-2">CONNECTION MODE</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setMode('auto')}
              className={`flex-1 py-2.5 rounded-[20px] items-center ${
                mode === 'auto' ? 'bg-[#FF6B35]' : 'bg-[#1A1A1A]'
              }`}
            >
              <Text
                className={`text-[13px] font-semibold ${mode === 'auto' ? 'text-white' : 'text-[#888888]'}`}
              >
                Auto Tunnel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('custom')}
              className={`flex-1 py-2.5 rounded-[20px] items-center ${
                mode === 'custom' ? 'bg-[#FF6B35]' : 'bg-[#1A1A1A]'
              }`}
            >
              <Text
                className={`text-[13px] font-semibold ${mode === 'custom' ? 'text-white' : 'text-[#888888]'}`}
              >
                Custom Server
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Auto Tunnel mode */}
        {mode === 'auto' && (
          <Card className="mx-4 mb-3">
            <Text className="text-[#888888] text-[12px] leading-[16px] mb-2">
              Run `msctl serve --relay` on your Mac, then paste the Bearer token below.
            </Text>
            <Input
              label="Bearer Token"
              value={relayToken}
              onChangeText={setRelayToken}
              placeholder="ms_v2_..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </Card>
        )}

        {/* Custom Server mode */}
        {mode === 'custom' && (
          <Card className="mx-4 mb-3">
            <Input
              label="Server URL"
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://localhost:8080"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Input
              label="API Key"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="ms_..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </Card>
        )}

        <View className="mx-4">
          <Button
            label="Save"
            onPress={() => {
              void handleSave();
            }}
            loading={saving}
            loadingLabel={mode === 'auto' ? 'Connecting...' : 'Saving...'}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
