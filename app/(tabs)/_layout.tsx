import { Tabs } from 'expo-router';
import { Icon } from '@/components/Icon';

const ACTIVE = '#B6A7FF';
const INACTIVE = '#777487';

export default function MainTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#11111A',
          borderTopColor: '#272633',
          borderTopWidth: 1,
          height: 74,
          paddingTop: 9,
          paddingBottom: 14,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Build',
          tabBarIcon: ({ color, size, focused }) => <Icon name={focused ? 'view-dashboard' : 'view-dashboard-outline'} size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size, focused }) => <Icon name={focused ? 'history' : 'history'} size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => <Icon name={focused ? 'cog' : 'cog-outline'} size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
