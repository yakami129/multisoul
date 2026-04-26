import React, { useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useEndpointStore } from '@/store/endpointStore';
import { EndpointList } from '@/features/settings/components/EndpointList';
import { AddEndpointModal } from '@/features/settings/components/AddEndpointModal';

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
          <Plus size={20} color="#20C20E" />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.sectionLabel}>ENDPOINTS</Text>
        <EndpointList endpoints={endpoints} onRemove={removeEndpoint} />
      </ScrollView>

      <AddEndpointModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onAdd={(label, base_url, token) => addEndpoint({ label, base_url, token })}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#040D04' },
  nav:          { height: 52, backgroundColor: '#061206', flexDirection: 'row',
                  alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  navTitle:     { fontFamily: 'Anton', fontSize: 16, color: '#20C20E', letterSpacing: 2 },
  scroll:       { flex: 1 },
  content:      { padding: 16, gap: 12 },
  sectionLabel: { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 2 },
});
