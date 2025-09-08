// File: app/_layout.tsx
import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Slot, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Layout() {
  const router = useRouter();

  const handleLogout = async () => {
    await AsyncStorage.removeItem('jwt');
    router.replace('/screens/LoginScreen');
  };

  return (
    <GestureHandlerRootView style={styles.wrapper}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.tab} onPress={() => router.push('/')}>
            <Text style={styles.navText}>Home</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.tab} onPress={() => router.push('/workorders')}>
            <Text style={styles.navText}>Work Orders</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.tab} onPress={() => router.push('/screens/HistoryScreen')}>
            <Text style={styles.navText}>History</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.tab} onPress={() => router.push('/calendar')}>
            <Text style={styles.navText}>Calendar</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <Slot />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
  },
  navText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  logoutBtn: {
    marginLeft: 'auto',
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
