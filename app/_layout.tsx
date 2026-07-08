// File: app/_layout.tsx
import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CRM } from '@/constants/Colors';
import api from '../constants/api';

type MeType = { id?: number; username?: string; name?: string; role?: string };

// Session-level cache for the current user. The header used to fetch /auth/me on
// every navigation (dep [pathname]); this fetches it once per session instead.
// Only a successful lookup is cached — a missing token short-circuits to null with
// NO network call and NO caching, so the logged-out -> logged-in transition (and
// logout) naturally trigger a fresh fetch without refetching on every tab switch.
let meCache: MeType | null = null;
let meLoaded = false; // true only once a real user has been cached
let meInFlight: Promise<MeType | null> | null = null;

async function loadMe(): Promise<MeType | null> {
  if (meLoaded) return meCache;
  if (meInFlight) return meInFlight;
  meInFlight = (async () => {
    try {
      const token = await AsyncStorage.getItem('jwt');
      if (!token) return null; // logged out: no network, don't cache
      const res = await api.get('/auth/me');
      meCache = res?.data || null;
      meLoaded = !!meCache; // cache only a real result
      return meCache;
    } catch {
      return null; // error (e.g. offline): don't cache, allow a later retry
    } finally {
      meInFlight = null;
    }
  })();
  return meInFlight;
}

function clearMeCache() {
  meCache = null;
  meLoaded = false;
  meInFlight = null;
}

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
    clearMeCache(); // force a fresh /auth/me on next login
    setMe(null);
    router.replace('/screens/LoginScreen');
  });

  // Identify the logged-in user so we can show role-specific tabs (e.g. Overview for Jeff).
  // Seed from the session cache so an already-loaded user shows instantly on remount.
  const [me, setMe] = useState<MeType | null>(meCache);

  // Fetch once per session (dep []). loadMe() dedupes/caches, so navigating between
  // tabs — which remounts this header — does not hit /auth/me again.
  useEffect(() => {
    let cancelled = false;
    loadMe().then((m) => {
      if (!cancelled) setMe(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isJeff =
    !!me &&
    (String(me.username || '').toLowerCase() === 'jeff' ||
      String(me.name || '').toLowerCase() === 'jeff');

  // 3) Ensure these paths actually exist in your app folder structure
  const tabs = useMemo(() => {
    const TABS: Array<{ label: string; path?: string; onPress?: () => void }> = [
      { label: 'Home',        path: '/' },
      { label: 'Work Orders', path: '/screens/WorkOrdersScreen' },
      { label: 'POs',         path: '/screens/PurchaseOrdersScreen' },
      { label: 'History',     path: '/screens/HistoryScreen' },
      { label: 'Calendar',    path: '/screens/CalendarScreen' },
    ];
    if (isJeff) {
      TABS.push({ label: 'Overview', path: '/screens/OverviewScreen' });
    }
    TABS.push({ label: 'Logout', onPress: logout });
    return TABS;
  }, [isJeff, logout]);

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
