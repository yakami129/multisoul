import { useFocusEffect } from 'expo-router';
import {
  // Bell,
  // CheckCircle2,
  ChevronRight,
  Globe,
  // KeyRound,
  Plus,
  QrCode,
  // ShieldCheck,
  // Sparkles,
  // Trash2,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, ScrollView, /* Switch, */ Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddEndpointModal } from '@/features/settings/components/AddEndpointModal';
import { EndpointList } from '@/features/settings/components/EndpointList';
import { s } from '@/features/settings/components/settingsScreenStyles';
import { countOnlineEndpoints } from '@/features/settings/services/endpointLiveness';
import { pingAllEndpoints } from '@/features/settings/services/endpointService';
import { useEndpointStore } from '@/store/endpointStore';
import { useLanguageStore } from '@/store/languageStore';
import { brandAssets, brandColors /* , brandRgba */ } from '@/theme/brandRefresh';

// Mock UI helpers — restore when preferences/security are backed by real settings.
// function StaticToggleRow({
//   title,
//   subtitle,
//   color,
//   icon,
//   value,
//   divided,
// }: {
//   title: string;
//   subtitle: string;
//   color: string;
//   icon: React.ReactNode;
//   value: boolean;
//   divided?: boolean;
// }) {
//   return (
//     <View style={[s.row, divided && s.divider, s.disabledRow]}>
//       <View style={[s.iconCircle, { backgroundColor: color }]}>{icon}</View>
//       <View style={s.rowCopy}>
//         <Text style={s.rowTitle} numberOfLines={1}>
//           {title}
//         </Text>
//         <Text style={s.rowSubtitle} numberOfLines={2}>
//           {subtitle}
//         </Text>
//       </View>
//       <Switch
//         disabled
//         value={value}
//         trackColor={{ false: brandRgba.ink18, true: color }}
//         thumbColor={brandColors.white}
//       />
//     </View>
//   );
// }
//
// function StaticLinkRow({
//   title,
//   subtitle,
//   color,
//   icon,
//   destructive,
//   divided,
// }: {
//   title: string;
//   subtitle: string;
//   color: string;
//   icon: React.ReactNode;
//   destructive?: boolean;
//   divided?: boolean;
// }) {
//   return (
//     <View style={[s.row, divided && s.divider, s.disabledRow]}>
//       <View style={[s.iconCircle, { backgroundColor: color }]}>{icon}</View>
//       <View style={s.rowCopy}>
//         <Text style={s.rowTitle} numberOfLines={1}>
//           {title}
//         </Text>
//         <Text style={[s.rowSubtitle, destructive && s.destructiveSubtitle]} numberOfLines={2}>
//           {subtitle}
//         </Text>
//       </View>
//       <ChevronRight size={18} color={brandColors.textSoft} />
//     </View>
//   );
// }

export default function SettingsScreen() {
  const { t } = useTranslation();
  const endpoints = useEndpointStore((state) => state.endpoints);
  const addEndpoint = useEndpointStore((state) => state.addEndpoint);
  const removeEndpoint = useEndpointStore((state) => state.removeEndpoint);
  const { language, setLanguage } = useLanguageStore();
  const [modalVisible, setModalVisible] = useState(false);
  const onlineCount = countOnlineEndpoints(endpoints);
  const offlineCount = endpoints.length - onlineCount;
  const machineLabel = endpoints.length === 1 ? t('settings.machine') : t('settings.machines');

  useFocusEffect(
    useCallback(() => {
      void pingAllEndpoints();
    }, []),
  );

  const openAddEndpoint = () => setModalVisible(true);

  const handleLanguagePress = () => {
    Alert.alert(t('settings.language'), undefined, [
      {
        text: t('settings.languageEnglish'),
        onPress: () => {
          void setLanguage('en');
        },
      },
      {
        text: t('settings.languageChinese'),
        onPress: () => {
          void setLanguage('zh');
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.nav}>
          <Text style={s.navTitle}>{t('settings.title')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('settings.addEndpoint')}
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
            <Text style={s.heroTitle}>{t('settings.commandConsole')}</Text>
            <Text style={s.heroMeta}>
              {endpoints.length} {machineLabel} · {onlineCount} {t('settings.online')} ·{' '}
              {offlineCount} {t('settings.offline')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('settings.scanQR')}
              onPress={openAddEndpoint}
              style={s.scanButton}
            >
              <QrCode size={20} color={brandColors.white} />
              <Text style={s.scanText}>{t('settings.scanQR')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>{t('settings.endpoints')}</Text>
          <View style={s.manageWrap} accessibilityElementsHidden>
            <Text style={s.manageText}>{t('settings.manage')}</Text>
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

        {/* Mock preferences — hidden until backed by real settings */}
        {/* <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>{t('settings.preferences')}</Text>
        </View> */}
        <View style={s.sectionCard}>
          {/* <StaticToggleRow
            title={t('settings.decisionNotifications')}
            subtitle={t('settings.decisionNotificationsSubtitle')}
            color={brandColors.lime}
            icon={<Bell size={20} color={brandColors.ink} />}
            value
            divided
          />
          <StaticToggleRow
            title={t('settings.taskCompletion')}
            subtitle={t('settings.taskCompletionSubtitle')}
            color={brandColors.coral}
            icon={<CheckCircle2 size={20} color={brandColors.ink} />}
            value
            divided
          />
          <StaticToggleRow
            title={t('settings.askBeforeWrite')}
            subtitle={t('settings.askBeforeWriteSubtitle')}
            color={brandColors.cyan}
            icon={<Sparkles size={20} color={brandColors.ink} />}
            value
            divided
          /> */}
          <TouchableOpacity
            style={s.row}
            onPress={handleLanguagePress}
            accessibilityRole="button"
            accessibilityLabel={t('settings.language')}
          >
            <View style={[s.iconCircle, { backgroundColor: brandColors.cyan }]}>
              <Globe size={20} color={brandColors.ink} />
            </View>
            <View style={s.rowCopy}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {t('settings.language')}
              </Text>
              <Text style={s.rowSubtitle} numberOfLines={1}>
                {language === 'zh' ? t('settings.languageChinese') : t('settings.languageEnglish')}
              </Text>
            </View>
            <ChevronRight size={18} color={brandColors.textSoft} />
          </TouchableOpacity>
        </View>

        {/* Mock security — hidden until backed by real settings */}
        {/* <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>{t('settings.security')}</Text>
        </View>
        <View style={s.sectionCard}>
          <StaticLinkRow
            title={t('settings.bearerToken')}
            subtitle={t('settings.bearerTokenSubtitle')}
            color={brandRgba.ink08}
            icon={<KeyRound size={20} color={brandColors.ink} />}
            divided
          />
          <StaticToggleRow
            title={t('settings.localData')}
            subtitle={t('settings.localDataSubtitle')}
            color={brandRgba.ink08}
            icon={<ShieldCheck size={20} color={brandColors.ink} />}
            value
            divided
          />
          <StaticLinkRow
            title={t('settings.deleteEndpoint')}
            subtitle={t('settings.deleteEndpointSubtitle')}
            color={brandRgba.coralSoft}
            icon={<Trash2 size={20} color={brandColors.coral} />}
            destructive
          />
        </View> */}
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
