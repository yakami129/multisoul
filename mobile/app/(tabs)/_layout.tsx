import { Tabs } from 'expo-router';
import { Activity, LayoutGrid, Settings } from 'lucide-react-native';

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
    fontSize: 11,
    marginTop: 2,
  },
  tabBarItemStyle: {
    paddingTop: 4,
    paddingBottom: 6,
  },
};

function ProjectsIcon({ color }: { color: string }) {
  return <LayoutGrid size={22} color={color} />;
}
function ActivityIcon({ color }: { color: string }) {
  return <Activity size={22} color={color} />;
}
function SettingsIcon({ color }: { color: string }) {
  return <Settings size={22} color={color} />;
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
