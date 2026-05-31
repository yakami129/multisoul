import { Plus } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddEndpointModal } from '@/features/settings/components/AddEndpointModal';
import { EndpointList } from '@/features/settings/components/EndpointList';
import { useEndpointStore } from '@/store/endpointStore';

export default function SettingsScreen() {
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addEndpoint = useEndpointStore((s) => s.addEndpoint);
  const removeEndpoint = useEndpointStore((s) => s.removeEndpoint);
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.nav}>
        <Text style={s.navTitle}>SETTINGS</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)}>
          <Plus size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.sectionLabel}>ENDPOINTS</Text>
        <EndpointList
          endpoints={endpoints}
          onRemove={(id) => {
            void removeEndpoint(id);
          }}
        />
      </ScrollView>

      <AddEndpointModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onAdd={(label, base_url, token) => {
          void addEndpoint({ label, base_url, token });
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  nav: {
    height: 52,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  navTitle: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  sectionLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    letterSpacing: 1.5,
  },
});
