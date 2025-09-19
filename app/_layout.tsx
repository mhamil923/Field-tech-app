// File: app/_layout.tsx
import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

function Header() {
  const router = useRouter();
  const pathname = usePathname();

  const go = (path: string) => async () => {
    if (pathname !== path) {
      // Use replace so we don't stack multiple copies of the same tab
      router.replace(path);
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem('jwt');
    } catch {}
    router.replace('/screens/LoginScreen');
  };

  const Tab = ({
    label,
    path,
    onPress,
  }: {
    label: string;
    path?: string;
    onPress?: () => void;
  }) => {
    const active = path ? pathname === path : false;
    const press = onPress || (path ? go(path) : undefined);

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
        {/* Evenly spaced tab row, no scroll */}
        <View style={styles.tabsRow}>
          <Tab label="Home" path="/" />
          <Tab label="Work Orders" path="/screens/WorkOrdersScreen" />
          <Tab label="History" path="/screens/HistoryScreen" />
          <Tab label="Calendar" path="/calendar" />
          <Tab label="Logout" onPress={logout} />
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

  // Fixed top bar with 5 evenly spaced tabs, no horizontal scroll
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },

  tab: {
    flex: 1,                 // each tab gets equal width
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
