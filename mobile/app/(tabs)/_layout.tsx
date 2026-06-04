import { Tabs } from 'expo-router';
import { Activity, FileText } from 'lucide-react-native';
import React, { useState } from 'react';
import { Image, type ImageSourcePropType, View } from 'react-native';
import { ReleaseLogsModal } from '@/features/settings/components/ReleaseLogsModal';
import { useEndpointStore } from '@/store/endpointStore';
import { brandAssets, brandColors, brandRgba } from '@/theme/brandRefresh';

export const TAB_BAR_HEIGHT = 50;
export const TAB_BAR_SAFE_AREA_BOTTOM = 28;
const TAB_ICON_SLOT_SIZE = 34;
const FOCUSED_TAB_ICON_SIZE = 31;
const IDLE_TAB_ICON_SIZE = 24;

export const tabScreenOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: brandColors.ink,
    borderTopWidth: 0,
    borderTopColor: brandColors.ink,
    height: TAB_BAR_HEIGHT + TAB_BAR_SAFE_AREA_BOTTOM,
    position: 'absolute' as const,
    bottom: 10,
    left: 20,
    right: 20,
    borderRadius: 30,
    paddingHorizontal: 14,
    paddingBottom: TAB_BAR_SAFE_AREA_BOTTOM,
    paddingTop: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  tabBarActiveTintColor: brandColors.white,
  tabBarInactiveTintColor: brandRgba.white70,
  tabBarShowLabel: true,
  tabBarLabelPosition: 'below-icon' as const,
  tabBarLabelStyle: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 1,
  },
  tabBarIconStyle: {
    width: TAB_ICON_SLOT_SIZE,
    height: TAB_ICON_SLOT_SIZE,
    marginTop: 0,
  },
  tabBarItemStyle: {
    height: TAB_BAR_HEIGHT,
    paddingTop: 0,
    paddingBottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};

function BrandedTabIcon({ source, focused }: { source: ImageSourcePropType; focused: boolean }) {
  const traySize = focused ? FOCUSED_TAB_ICON_SIZE : IDLE_TAB_ICON_SIZE;
  const imageSize = focused ? 23 : 20;

  return (
    <View
      style={{
        width: TAB_ICON_SLOT_SIZE,
        height: TAB_ICON_SLOT_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: traySize,
          height: traySize,
          borderRadius: traySize / 2,
          backgroundColor: focused ? brandRgba.cyanWash : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Image source={source} style={{ width: imageSize, height: imageSize }} />
      </View>
    </View>
  );
}

function LucideTabIcon({ children, focused }: { children: React.ReactNode; focused: boolean }) {
  return (
    <View
      style={{
        width: TAB_ICON_SLOT_SIZE,
        height: TAB_ICON_SLOT_SIZE,
        borderRadius: TAB_ICON_SLOT_SIZE / 2,
        backgroundColor: focused ? brandRgba.cyanWash : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

function AgentsIcon({ focused }: { color: string; focused: boolean }) {
  return <BrandedTabIcon source={brandAssets.iconAgent} focused={focused} />;
}
function SpecsIcon({ color, focused }: { color: string; focused: boolean }) {
  return (
    <LucideTabIcon focused={focused}>
      <FileText size={20} color={color} />
    </LucideTabIcon>
  );
}
function ActivityIcon({ color, focused }: { color: string; focused: boolean }) {
  return focused ? (
    <BrandedTabIcon source={brandAssets.iconActivity} focused />
  ) : (
    <LucideTabIcon focused={focused}>
      <Activity size={20} color={color} />
    </LucideTabIcon>
  );
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
            href: null,
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
