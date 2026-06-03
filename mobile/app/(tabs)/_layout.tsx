import { Tabs } from 'expo-router';
import { Activity, FileText, Workflow } from 'lucide-react-native';
import React, { useState } from 'react';
import { Image, type ImageSourcePropType, View } from 'react-native';
import { ReleaseLogsModal } from '@/features/settings/components/ReleaseLogsModal';
import { useEndpointStore } from '@/store/endpointStore';
import { brandAssets, brandColors, brandRgba } from '@/theme/brandRefresh';

export const TAB_BAR_HEIGHT = 62;
export const TAB_BAR_SAFE_AREA_BOTTOM = 34;
const FOCUSED_TAB_ICON_SIZE = 48;
const IDLE_TAB_ICON_SIZE = 28;

export const tabScreenOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: brandColors.ink,
    borderTopWidth: 0,
    borderTopColor: brandColors.ink,
    height: TAB_BAR_HEIGHT + TAB_BAR_SAFE_AREA_BOTTOM,
    position: 'absolute' as const,
    bottom: 16,
    left: 28,
    right: 28,
    borderRadius: 36,
    paddingBottom: 10,
    paddingTop: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  tabBarActiveTintColor: brandColors.white,
  tabBarInactiveTintColor: brandRgba.white70,
  tabBarShowLabel: true,
  tabBarLabelPosition: 'below-icon' as const,
  tabBarLabelStyle: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 3,
  },
  tabBarItemStyle: {
    paddingTop: 0,
    paddingBottom: 0,
  },
};

function BrandedTabIcon({ source, focused }: { source: ImageSourcePropType; focused: boolean }) {
  return (
    <View
      style={{
        width: focused ? FOCUSED_TAB_ICON_SIZE : IDLE_TAB_ICON_SIZE,
        height: focused ? FOCUSED_TAB_ICON_SIZE : IDLE_TAB_ICON_SIZE,
        borderRadius: focused ? FOCUSED_TAB_ICON_SIZE / 2 : IDLE_TAB_ICON_SIZE / 2,
        backgroundColor: focused ? brandRgba.cyanWash : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Image source={source} style={{ width: focused ? 34 : 25, height: focused ? 34 : 25 }} />
    </View>
  );
}

function AgentsIcon({ focused }: { color: string; focused: boolean }) {
  return <BrandedTabIcon source={brandAssets.iconAgent} focused={focused} />;
}
function SpecsIcon({ color }: { color: string }) {
  return <FileText size={24} color={color} />;
}
function ActivityIcon({ color, focused }: { color: string; focused: boolean }) {
  return focused ? (
    <BrandedTabIcon source={brandAssets.iconActivity} focused />
  ) : (
    <Activity size={24} color={color} />
  );
}
function WorkflowsIcon({ color }: { color: string }) {
  return <Workflow size={24} color={color} />;
}
function SettingsIcon({ focused }: { color: string; focused: boolean }) {
  return <BrandedTabIcon source={brandAssets.iconSettings} focused={focused} />;
}

export default function TabLayout() {
  const endpoints = useEndpointStore((s) => s.endpoints);
  const [releaseLogsVisible, setReleaseLogsVisible] = useState(false);

  return (
    <>
      <Tabs screenOptions={tabScreenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Agents',
            tabBarIcon: AgentsIcon,
          }}
        />
        <Tabs.Screen
          name="specs"
          options={{
            title: 'Specs',
            tabBarIcon: SpecsIcon,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: 'Activity',
            tabBarIcon: ActivityIcon,
          }}
        />
        <Tabs.Screen
          name="workflows"
          options={{
            title: 'Workflows',
            tabBarIcon: WorkflowsIcon,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: SettingsIcon,
          }}
          listeners={{
            tabLongPress: () => setReleaseLogsVisible(true),
          }}
        />
      </Tabs>
      <ReleaseLogsModal
        visible={releaseLogsVisible}
        endpoints={endpoints}
        onClose={() => setReleaseLogsVisible(false)}
      />
    </>
  );
}
