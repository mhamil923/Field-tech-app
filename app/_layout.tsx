// File: app/_layout.tsx
import React, { useRef, useMemo } from 'react';
import { Text, StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import * as Linking from 'expo-linking'; // if you ever want external links

function Header() {
  const router = useRouter();
  const pathname = (usePathname() || '').replace(/\/+$/, '') || '/';

  // 1) Robust nav lock to stop double navigations
  const isNavigatingRef = useRef(false);
  const lastNavTsRef = useRef(0);
  const NAV_COOLDOWN_MS = 500;

  const withNavLock = (fn: () => void) => () => {
    const now = Date.now();
    if (isNavigatingRef.current || now - lastNavTsRef.current < NAV_COOLDOWN_MS) return;
    isNavigatingRef.current = true;
    lastNavTsRef.current = now;
    try {
      fn();
    } finally {
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, NAV_COOLDOWN_MS);
    }
  };

  // Helper: internal navigation only (prevents external/deeplink spawning)
  const go = (path: string) =>
    withNavLock(() => {
      const target = path.replace(/\/+$/, '') || '/';
      // 2) Ignore if already on the same section
      if (pathname === target || pathname.startsWith(target + '/')) return;
      router.replace(target);
    });

  const logout = withNavLock(async () => {
    try {
      await AsyncStorage.removeItem('jwt');
    } catch {}
    router.replace('/screens/LoginScreen');
  });

  // If you truly want to open an external web calendar instead of an in-app screen:
  // const openExternal = withNavLock(() => {
  //   const url = 'https://main.d2c3mwinxmekdi.amplifyapp.com/calendar';
  //   Linking.openURL(url);
  // });

  // 3) Ensure these paths actually exist in your app folder structure
  const TABS: Array<{ label: string; path?: string; onPress?: () => void }> = [
    { label: 'Home',        path: '/' }, // usually app/index.tsx
    { label: 'Work Orders', path: '/screens/WorkOrdersScreen' },
    { label: 'History',     path: '/screens/HistoryScreen' },
    // Use an in-app screen for Calendar to keep it seamless:
    { label: 'Calendar',    path: '/screens/CalendarScreen' }, // <-- make sure this exists
    // If you prefer the external web calendar, replace the above with:
    // { label: 'Calendar',    onPress: openExternal },
    { label: 'Logout',      onPress: logout },
  ];

  const tabs = useMemo(() => TABS, []); // stable identity

  const Tab = ({
    label,
    path,
    onPress,
  }: {
    label: string;
    path?: string;
    onPress?: () => void;
  }) => {
    const active = path ? (pathname === path || pathname.startsWith(path + '/')) : false;
    const press = onPress ?? (path ? go(path) : undefined);

    return (
      <TouchableOpacity
        onPress={active ? undefined : press}
        disabled={active}
        activeOpacity={0.8}
        style={[styles.tab, active && styles.tabActive]}
      >
        <Text style={[styles.navText, active && styles.navTextActive]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.headerSafe}>
      <View style={styles.header}>
        <View style={styles.tabsRow}>
          {tabs.map((t) => (
            <Tab key={t.label} {...t} />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={styles.wrapper}>
      <Stack
        screenOptions={{
          header: () => <Header />,
          headerShown: true,
          contentStyle: { backgroundColor: '#F1F5F9' },
          // On Android, this helps avoid visual flicker while replacing:
          animation: Platform.OS === 'android' ? 'fade' : 'default',
        }}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  headerSafe: {
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    width: '100%',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabActive: {
    backgroundColor: '#17a2b8',
    borderColor: '#17a2b8',
  },
  navText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  navTextActive: {
    color: '#FFFFFF',
  },
});
