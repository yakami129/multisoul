import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Activity, MessageCircle, Settings } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, type ImageSourcePropType, View } from 'react-native';
import { ReleaseLogsModal } from '@/features/settings/components/ReleaseLogsModal';
import { useEndpointStore } from '@/store/endpointStore';
import { brandAssets, brandColors, brandRgba } from '@/theme/brandRefresh';

export const TAB_BAR_HEIGHT = 58;
export const TAB_BAR_SAFE_AREA_BOTTOM = 16;
export const TAB_BAR_SHOW_ACTIVE_LABEL = false;
const TAB_BAR_HORIZONTAL_INSET = 30;
const TAB_BAR_PADDING = 6;
const ACTIVE_ICON_TRAY_BACKGROUND = '#A9DDF8';
export const TAB_ITEM_FLEX = 1;
export const TAB_ITEM_GAP = 30;
const TAB_ITEM_MIN_WIDTH = 52;
export const ACTIVE_ICON_TRAY_SIZE = 46;
export const ACTIVE_ICON_IMAGE_SIZE = 24;
export const INACTIVE_ICON_SIZE = 20;

type BrandAssetKey = keyof typeof brandAssets;
type TabRouteName = keyof typeof TAB_ROUTE_ICON_KEYS;

export const TAB_ROUTE_ICON_KEYS = {
  index: 'iconAgent',
  specs: 'iconChat',
  activity: 'iconActivity',
  settings: 'iconSettings',
} as const satisfies Record<string, BrandAssetKey>;

type TabRoute = BottomTabBarProps['state']['routes'][number];
type TabDescriptor = BottomTabBarProps['descriptors'][string];
type FloatingTabBarProps = BottomTabBarProps;

export const tabScreenOptions = {
  headerShown: false,
  freezeOnBlur: true,
  tabBarStyle: {
    backgroundColor: brandColors.ink,
    borderTopWidth: 0,
    borderTopColor: brandColors.ink,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    height: TAB_BAR_HEIGHT,
    position: 'absolute' as const,
    bottom: TAB_BAR_SAFE_AREA_BOTTOM,
    left: TAB_BAR_HORIZONTAL_INSET,
    right: TAB_BAR_HORIZONTAL_INSET,
    borderRadius: TAB_BAR_HEIGHT / 2,
    paddingHorizontal: TAB_BAR_PADDING,
    paddingBottom: 0,
    paddingTop: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 10,
  },
  tabBarActiveTintColor: brandColors.cyan,
  tabBarInactiveTintColor: brandRgba.white70,
  tabBarShowLabel: true,
  tabBarLabelPosition: 'below-icon' as const,
  tabBarLabelStyle: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600' as const,
  },
};

function getTabLabel(descriptor: TabDescriptor, routeName: string) {
  const label = descriptor.options.tabBarLabel ?? descriptor.options.title ?? routeName;
  return typeof label === 'string' ? label : (descriptor.options.title ?? routeName);
}

function getTabIcon(routeName: string): ImageSourcePropType | undefined {
  const iconKey = TAB_ROUTE_ICON_KEYS[routeName as TabRouteName];
  return iconKey ? brandAssets[iconKey] : undefined;
}

function TabLineIcon({ routeName, focused }: { routeName: string; focused: boolean }) {
  const color = focused ? brandColors.ink : brandRgba.white88;
  const props = { color, size: INACTIVE_ICON_SIZE, strokeWidth: 2.25 };

  if (routeName === 'specs') return <MessageCircle {...props} />;
  if (routeName === 'activity') return <Activity {...props} />;
  if (routeName === 'settings') return <Settings {...props} />;

  const icon = getTabIcon(routeName);
  return icon ? <Image source={icon} style={styles.inactiveIcon} /> : null;
}

function isVisibleTab(route: TabRoute) {
  return route.name in TAB_ROUTE_ICON_KEYS;
}

function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const activeRouteKey = state.routes[state.index]?.key;
  const visibleRoutes = state.routes.filter(isVisibleTab);

  return (
    <View testID="tab-bar" style={[tabScreenOptions.tabBarStyle, styles.tabBar]}>
      {visibleRoutes.map((route) => {
        const descriptor = descriptors[route.key];
        const focused = route.key === activeRouteKey;
        const label = getTabLabel(descriptor, route.name);

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            testID={`tab-${route.name}`}
            onLongPress={onLongPress}
            onPress={onPress}
            style={[styles.tabButton, focused ? styles.activeTabButton : styles.inactiveTabButton]}
          >
            {focused ? (
              <View testID={`bottom-tab-${route.name}-active-column`} style={styles.activeContent}>
                <View style={styles.activeIconTray}>
                  {route.name === 'index' ? (
                    <Image source={brandAssets.iconAgent} style={styles.activeIcon} />
                  ) : (
                    <TabLineIcon routeName={route.name} focused />
                  )}
                </View>
                {TAB_BAR_SHOW_ACTIVE_LABEL ? (
                  <Text
                    numberOfLines={1}
                    testID={`bottom-tab-${route.name}-active-label`}
                    style={styles.activeLabel}
                  >
                    {label}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View
                testID={`bottom-tab-${route.name}-inactive-column`}
                style={styles.inactiveContent}
              >
                <TabLineIcon routeName={route.name} focused={focused} />
                <Text numberOfLines={1} style={styles.inactiveLabel}>
                  {label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const [releaseLogsVisible, setReleaseLogsVisible] = useState(false);

  return (
    <>
      <Tabs tabBar={FloatingTabBar} screenOptions={tabScreenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.projects'),
          }}
        />
        <Tabs.Screen
          name="specs"
          options={{
            title: t('tabs.specs'),
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: t('tabs.activity'),
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
            title: t('tabs.settings'),
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

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: TAB_ITEM_GAP,
  },
  tabButton: {
    height: TAB_BAR_HEIGHT - TAB_BAR_PADDING * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabButton: {
    flex: TAB_ITEM_FLEX,
    minWidth: TAB_ITEM_MIN_WIDTH,
  },
  inactiveTabButton: {
    flex: TAB_ITEM_FLEX,
    minWidth: TAB_ITEM_MIN_WIDTH,
  },
  activeContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  inactiveContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  activeIconTray: {
    width: ACTIVE_ICON_TRAY_SIZE,
    height: ACTIVE_ICON_TRAY_SIZE,
    borderRadius: ACTIVE_ICON_TRAY_SIZE / 2,
    backgroundColor: ACTIVE_ICON_TRAY_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeIcon: {
    width: ACTIVE_ICON_IMAGE_SIZE,
    height: ACTIVE_ICON_IMAGE_SIZE,
    resizeMode: 'contain',
  },
  inactiveIcon: {
    width: INACTIVE_ICON_SIZE,
    height: INACTIVE_ICON_SIZE,
    resizeMode: 'contain',
    opacity: 0.88,
  },
  activeLabel: {
    color: brandColors.cyan,
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '700',
  },
  inactiveLabel: {
    color: brandRgba.white70,
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '500',
  },
});
