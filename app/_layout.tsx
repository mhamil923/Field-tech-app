// File: app/_layout.tsx
import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View, ScrollView } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

function Header() {
  const router = useRouter();
  const pathname = usePathname();

  const go = (path: string) => () => {
    if (pathname !== path) router.push(path);
  };

  const Tab = ({ label, path }: { label: string; path: string }) => {
    const active = pathname === path;
    return (
      <TouchableOpacity onPress={go(path)} style={[styles.tab, active && styles.tabActive]}>
        <Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('jwt');
    } catch {}
    router.replace('/screens/LoginScreen');
  };

  return (
    <SafeAreaView edges={['top']} style={styles.headerSafe}>
      <View style={styles.header}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.headerContent}
        >
          <Tab label="Home" path="/" />
          <Tab label="Work Orders" path="/screens/WorkOrdersScreen" />
          <Tab label="History" path="/screens/HistoryScreen" />
          <Tab label="Calendar" path="/calendar" />
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </ScrollView>
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
          contentStyle: { backgroundColor: '#F1F5F9' },
          headerShown: true,
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
    // subtle shadow
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  headerContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 6,
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
  logoutBtn: {
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#EF4444',
  },
  logoutText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
