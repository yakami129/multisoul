import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useSettingsStore } from '@/store/settingsStore';

export function SettingsForm() {
  const insets = useSafeAreaInsets();
  const { settings, save } = useSettingsStore();
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({ serverUrl: serverUrl.trim(), apiKey: apiKey.trim() });
      Alert.alert('Saved', 'Settings saved successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
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
        className="flex-1 bg-slate-50 dark:bg-slate-900"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-3xl font-bold text-slate-900 dark:text-slate-100 px-4 pt-4 pb-6">
          Settings
        </Text>
        <Card className="mx-4">
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
          <Button label="Save" onPress={handleSave} loading={saving} loadingLabel="Saving..." />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
