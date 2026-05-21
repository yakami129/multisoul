import { Tabs } from 'expo-router';
import { Inbox, Layers, Settings } from 'lucide-react-native';

export const TAB_BAR_HEIGHT = 62;
export const TAB_BAR_SAFE_AREA_BOTTOM = 34;

export const tabScreenOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: '#1A1A1A',
    borderTopWidth: 0,
    height: TAB_BAR_HEIGHT + TAB_BAR_SAFE_AREA_BOTTOM,
    borderRadius: 36,
    position: 'absolute' as const,
    bottom: 0,
    left: 20,
    right: 20,
    paddingBottom: TAB_BAR_SAFE_AREA_BOTTOM,
  },
  tabBarActiveTintColor: '#FF6B35',
  tabBarInactiveTintColor: '#555555',
  tabBarShowLabel: true,
  tabBarLabelPosition: 'below-icon' as const,
  tabBarLabelStyle: {
    fontFamily: 'Inter',
    fontSize: 11,
    marginTop: 2,
  },
  tabBarItemStyle: {
    paddingTop: 8,
    paddingBottom: 6,
  },
};

function ProjectsIcon({ color }: { color: string }) {
  return <Layers size={24} color={color} />;
}
function ActivityIcon({ color }: { color: string }) {
  return <Inbox size={24} color={color} />;
}
function SettingsIcon({ color }: { color: string }) {
  return <Settings size={24} color={color} />;
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Projects',
          tabBarIcon: ProjectsIcon,
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
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: SettingsIcon,
        }}
      />
    </Tabs>
  );
}
