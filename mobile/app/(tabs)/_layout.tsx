import { Tabs } from 'expo-router';
import { Zap, MessageCircle, Inbox, Settings } from 'lucide-react-native';

function AgentsIcon({ color }: { color: string }) {
  return <Zap size={24} color={color} />;
}
function ChatIcon({ color }: { color: string }) {
  return <MessageCircle size={24} color={color} />;
}
function InboxIcon({ color }: { color: string }) {
  return <Inbox size={24} color={color} />;
}
function SettingsIcon({ color }: { color: string }) {
  return <Settings size={24} color={color} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1A1A1A',
          borderTopWidth: 0,
          height: 62,
          marginHorizontal: 20,
          marginBottom: 34,
          borderRadius: 36,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        },
        tabBarActiveTintColor: '#FF6B35',
        tabBarInactiveTintColor: '#555555',
        tabBarLabelStyle: {
          fontFamily: 'Inter',
          fontSize: 11,
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Agents',
          tabBarIcon: AgentsIcon,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ChatIcon,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: InboxIcon,
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
