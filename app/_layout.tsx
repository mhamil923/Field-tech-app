// File: app/_layout.tsx
import React, { useRef } from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

function Header() {
  const router = useRouter();
  const pathname = usePathname();

  // Prevent rapid double taps from queuing multiple replaces
  const isNavigatingRef = useRef(false);
  const withNavLock = (fn: () => void) => () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    try { fn(); } finally {
      // small delay to avoid immediate re-entry on very fast taps
      setTimeout(() => { isNavigatingRef.current = false; }, 250);
    }
  };

  const go = (path: string) =>
    withNavLock(() => {
      if (pathname !== path) {
        router.replace(path);
      }
    });

  const logout = withNavLock(async () => {
    try { await AsyncStorage.removeItem('jwt'); } catch {}
    router.replace('/screens/LoginScreen');
  });

  const TABS: Array<{ label: string; path?: string; onPress?: () => void }> = [
    { label: 'Home',        path: '/' },
    { label: 'Work Orders', path: '/screens/WorkOrdersScreen' },
    { label: 'History',     path: '/screens/HistoryScreen' },
    { label: 'Calendar',    path: '/calendar' },
    { label: 'Logout',      onPress: logout },
  ];

  const Tab = ({ label, path, onPress }: { label: string; path?: string; onPress?: () => void }) => {
    const active = path ? pathname === path : false;
    const press = onPress ?? (path ? go(path) : undefined);

    return (
      <TouchableOpacity
        onPress={press}
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
          {TABS.map((t) => (
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
  // Fixed top bar with evenly spaced tabs
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
    marginHorizontal: 4,     // small gutter between tabs
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
