import {
  Bell,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Image, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddEndpointModal } from '@/features/settings/components/AddEndpointModal';
import { EndpointList } from '@/features/settings/components/EndpointList';
import { s } from '@/features/settings/components/settingsScreenStyles';
import { useEndpointStore } from '@/store/endpointStore';
import { brandAssets, brandColors, brandRgba } from '@/theme/brandRefresh';

function endpointOnline(lastSeenAt: number | null) {
  return lastSeenAt !== null && Date.now() - lastSeenAt < 60_000;
}

function StaticToggleRow({
  title,
  subtitle,
  color,
  icon,
  value,
  divided,
}: {
  title: string;
  subtitle: string;
  color: string;
  icon: React.ReactNode;
  value: boolean;
  divided?: boolean;
}) {
  return (
    <View style={[s.row, divided && s.divider, s.disabledRow]}>
      <View style={[s.iconCircle, { backgroundColor: color }]}>{icon}</View>
      <View style={s.rowCopy}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={s.rowSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Switch
        disabled
        value={value}
        trackColor={{ false: brandRgba.ink18, true: color }}
        thumbColor={brandColors.white}
      />
    </View>
  );
}

function StaticLinkRow({
  title,
  subtitle,
  color,
  icon,
  destructive,
  divided,
}: {
  title: string;
  subtitle: string;
  color: string;
  icon: React.ReactNode;
  destructive?: boolean;
  divided?: boolean;
}) {
  return (
    <View style={[s.row, divided && s.divider, s.disabledRow]}>
      <View style={[s.iconCircle, { backgroundColor: color }]}>{icon}</View>
      <View style={s.rowCopy}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[s.rowSubtitle, destructive && s.destructiveSubtitle]} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight size={18} color={brandColors.textSoft} />
    </View>
  );
}

export default function SettingsScreen() {
  const endpoints = useEndpointStore((state) => state.endpoints);
  const addEndpoint = useEndpointStore((state) => state.addEndpoint);
  const removeEndpoint = useEndpointStore((state) => state.removeEndpoint);
  const [modalVisible, setModalVisible] = useState(false);
  const onlineCount = endpoints.filter((endpoint) => endpointOnline(endpoint.last_seen_at)).length;
  const machineLabel = endpoints.length === 1 ? 'machine' : 'machines';

  const openAddEndpoint = () => setModalVisible(true);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.nav}>
          <Text style={s.navTitle}>Settings</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Add endpoint"
            onPress={openAddEndpoint}
            style={s.addButton}
          >
            <Plus size={20} color={brandColors.ink} />
          </TouchableOpacity>
        </View>

        <View style={s.hero}>
          <Image
            source={brandAssets.mascotPhoneStanding}
            style={s.heroMascot}
            resizeMode="contain"
          />
          <View style={s.heroContent}>
            <Text style={s.heroTitle}>Command Console</Text>
            <Text style={s.heroMeta}>
              {endpoints.length} {machineLabel} · {onlineCount} live · push ready
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Scan setup QR"
              onPress={openAddEndpoint}
              style={s.scanButton}
            >
              <QrCode size={20} color={brandColors.white} />
              <Text style={s.scanText}>Scan setup QR</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>Endpoints</Text>
          <View style={s.manageWrap} accessibilityElementsHidden>
            <Text style={s.manageText}>Manage</Text>
            <ChevronRight size={16} color={brandColors.textSoft} />
          </View>
        </View>
        <EndpointList
          endpoints={endpoints}
          onAddEndpoint={openAddEndpoint}
          onRemove={(id) => {
            void removeEndpoint(id);
          }}
        />

        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>Preferences</Text>
        </View>
        <View style={s.sectionCard}>
          <StaticToggleRow
            title="Decision notifications"
            subtitle="Get notified when a decision is needed"
            color={brandColors.lime}
            icon={<Bell size={20} color={brandColors.ink} />}
            value
            divided
          />
          <StaticToggleRow
            title="Task completion alerts"
            subtitle="Notify me when tasks complete"
            color={brandColors.coral}
            icon={<CheckCircle2 size={20} color={brandColors.ink} />}
            value
            divided
          />
          <StaticToggleRow
            title="Ask before tool write"
            subtitle="Confirm before writing files or running commands"
            color={brandColors.cyan}
            icon={<Sparkles size={20} color={brandColors.ink} />}
            value
          />
        </View>

        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>Security</Text>
        </View>
        <View style={s.sectionCard}>
          <StaticLinkRow
            title="Bearer token"
            subtitle="Manage API access token"
            color={brandRgba.ink08}
            icon={<KeyRound size={20} color={brandColors.ink} />}
            divided
          />
          <StaticToggleRow
            title="Local data only"
            subtitle="All data stays on your machines"
            color={brandRgba.ink08}
            icon={<ShieldCheck size={20} color={brandColors.ink} />}
            value
            divided
          />
          <StaticLinkRow
            title="Delete endpoint"
            subtitle="Remove an endpoint and revoke access"
            color={brandRgba.coralSoft}
            icon={<Trash2 size={20} color={brandColors.coral} />}
            destructive
          />
        </View>
      </ScrollView>

      <AddEndpointModal
        visible={modalVisible}
        initialTab="qr"
        onClose={() => setModalVisible(false)}
        onAdd={(label, base_url, token) => {
          void addEndpoint({ label, base_url, token });
        }}
      />
    </SafeAreaView>
  );
}
