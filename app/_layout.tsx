// File: app/_layout.tsx
import React, { useRef, useMemo } from 'react';
import { Text, StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CRM } from '@/constants/Colors';

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

  // 3) Ensure these paths actually exist in your app folder structure
  const TABS: Array<{ label: string; path?: string; onPress?: () => void }> = [
    { label: 'Home',        path: '/' },
    { label: 'Work Orders', path: '/screens/WorkOrdersScreen' },
    { label: 'POs',         path: '/screens/PurchaseOrdersScreen' },
    { label: 'History',     path: '/screens/HistoryScreen' },
    { label: 'Calendar',    path: '/screens/CalendarScreen' },
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
    const isLogout = label === 'Logout';
    const press = onPress ?? (path ? go(path) : undefined);

    return (
      <TouchableOpacity
        onPress={active ? undefined : press}
        disabled={active}
        activeOpacity={0.7}
        style={[
          styles.tab,
          !isLogout && styles.tabFlex,
          active && styles.tabActive,
          isLogout && styles.tabLogout,
        ]}
      >
        <Text
          style={[
            styles.navText,
            active && styles.navTextActive,
            isLogout && styles.navTextLogout,
          ]}
          numberOfLines={1}
        >
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
          contentStyle: { backgroundColor: CRM.pageBackground },
          animation: Platform.OS === 'android' ? 'fade' : 'default',
        }}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: CRM.pageBackground,
  },
  headerSafe: {
    backgroundColor: CRM.pageBackground,
  },
  header: {
    backgroundColor: CRM.pageBackground,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    width: '100%',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  tabFlex: {
    flex: 1,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(13, 110, 253, 0.08)',
  },
  tabLogout: {
    marginLeft: 'auto',
    backgroundColor: CRM.logoutRed,
    borderRadius: 8,
  },
  navText: {
    color: CRM.navInactive,
    fontWeight: '600',
    fontSize: 15,
  },
  navTextActive: {
    color: CRM.navActiveBlue,
    fontWeight: '700',
  },
  navTextLogout: {
    color: CRM.white,
    fontWeight: '600',
  },
});
