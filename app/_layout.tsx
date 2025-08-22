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
          <TouchableOpacity style={styles.tab} onPress={() => router.push('/calendar')}>
            <Text style={styles.navText}>Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* this is where your screens will render */}
        <Slot />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // fill the background with light grey like the web CRM
  wrapper: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  container: {
    flex: 1,
  },

  // navbar container
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#17a2b8',  // accent teal
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  // each tab
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // tab text
  navText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // logout button container
  logoutBtn: {
    backgroundColor: '#dc3545',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // logout text
  logoutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
