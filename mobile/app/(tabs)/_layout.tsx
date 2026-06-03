import { Tabs } from 'expo-router';
import { Activity, FileText, LayoutGrid, Settings, Workflow } from 'lucide-react-native';
import React, { useState } from 'react';
import { ReleaseLogsModal } from '@/features/settings/components/ReleaseLogsModal';
import { useEndpointStore } from '@/store/endpointStore';

export const TAB_BAR_HEIGHT = 62;
export const TAB_BAR_SAFE_AREA_BOTTOM = 34;

export const tabScreenOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: '#161616',
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
    height: TAB_BAR_HEIGHT + TAB_BAR_SAFE_AREA_BOTTOM,
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: TAB_BAR_SAFE_AREA_BOTTOM,
  },
  tabBarActiveTintColor: '#FF6B35',
  tabBarInactiveTintColor: '#555555',
  tabBarShowLabel: true,
  tabBarLabelPosition: 'below-icon' as const,
  tabBarLabelStyle: {
    fontFamily: 'Inter',
    fontSize: 10,
    marginTop: 2,
  },
  tabBarItemStyle: {
    paddingTop: 4,
    paddingBottom: 6,
  },
};

function AgentsIcon({ color }: { color: string }) {
  return <LayoutGrid size={22} color={color} />;
}
function SpecsIcon({ color }: { color: string }) {
  return <FileText size={22} color={color} />;
}
function ActivityIcon({ color }: { color: string }) {
  return <Activity size={22} color={color} />;
}
function WorkflowsIcon({ color }: { color: string }) {
  return <Workflow size={22} color={color} />;
}
function SettingsIcon({ color }: { color: string }) {
  return <Settings size={22} color={color} />;
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
