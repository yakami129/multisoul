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
          backgroundColor: '#061206',
          borderTopColor: '#0F2B0F',
          borderTopWidth: 1,
          height: 83,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#33FF33',
        tabBarInactiveTintColor: '#2D8B2D',
        tabBarLabelStyle: {
          fontFamily: 'Inter',
          fontSize: 10,
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
