// File: app/screens/CalendarScreen.js

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import moment from 'moment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../constants/api';

export default function CalendarScreen() {
  const router = useRouter();

  const [workOrders, setWorkOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(moment().format('YYYY-MM-DD'));
  const [markedDates, setMarkedDates] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  // On focus: ensure JWT exists; if so fetch
  useFocusEffect(
    useCallback(() => {
      const checkAuthAndFetch = async () => {
        const token = await AsyncStorage.getItem('jwt');
        if (!token) {
          router.replace('/screens/LoginScreen');
          return;
        }
        fetchWorkOrders();
      };
      checkAuthAndFetch();
    }, [router])
  );

  // Build calendar marks when data/selection changes
  useEffect(() => {
    const marks = {};
    workOrders.forEach((order) => {
      if (order.scheduledDate) {
        const dayLocal = moment(order.scheduledDate).local().format('YYYY-MM-DD');
        if (!marks[dayLocal]) marks[dayLocal] = { dots: [] };
        // react-native-calendars shows up to 3 dots nicely
        if ((marks[dayLocal].dots || []).length < 3) {
          marks[dayLocal].dots = [...(marks[dayLocal].dots || []), { color: '#0d6efd' }];
        }
      }
    });

    // Always highlight the selected day
    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: '#0d6efd',
    };
    setMarkedDates(marks);
  }, [workOrders, selectedDate]);

  const fetchWorkOrders = async () => {
    try {
      const { data } = await api.get('/work-orders');
      setWorkOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err?.response?.status === 401) {
        await AsyncStorage.removeItem('jwt');
        router.replace('/screens/LoginScreen');
        return;
      }
      console.error('Error fetching work orders:', err);
      Alert.alert('Error', 'Failed to fetch work orders.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchWorkOrders();
    setRefreshing(false);
  };

  const onDayPress = (day) => {
    setSelectedDate(day.dateString);
  };

  const ordersForSelectedDate = useMemo(() => {
    const list = workOrders.filter(
      (o) =>
        o.scheduledDate &&
        moment(o.scheduledDate).local().format('YYYY-MM-DD') === selectedDate
    );
    return list.sort(
      (a, b) =>
        moment(a.scheduledDate).local().valueOf() -
        moment(b.scheduledDate).local().valueOf()
    );
  }, [workOrders, selectedDate]);

  const renderOrderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.orderCard}
      onPress={() => router.push(`/screens/ViewWorkOrder?id=${item.id}`)}
    >
      <Text style={styles.orderTitle}>PO#: {item.poNumber || 'N/A'}</Text>
      <Text style={styles.orderText}>Customer: {item.customer}</Text>
      <Text style={styles.orderText}>Site: {item.siteLocation}</Text>
      <Text style={styles.orderText}>Problem: {item.problemDescription}</Text>
      <Text style={[styles.orderText, { color: '#0d6efd', fontWeight: '700' }]}>
        {item.scheduledDate
          ? moment(item.scheduledDate).local().format('HH:mm')
          : 'Not Scheduled'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.screenHeader}>Work Order Calendar</Text>

      <Calendar
        onDayPress={onDayPress}
        markedDates={markedDates}
        markingType="multi-dot"
        theme={{
          backgroundColor: '#ffffff',
          calendarBackground: '#ffffff',
          textSectionTitleColor: '#0f172a',
          dayTextColor: '#0f172a',
          todayTextColor: '#0d6efd',
          selectedDayBackgroundColor: '#0d6efd',
          selectedDayTextColor: '#ffffff',
          dotColor: '#0d6efd',
          arrowColor: '#0f172a',
          monthTextColor: '#0f172a',
          textDisabledColor: '#cbd5e1',
          textDayFontSize: 16,
          textMonthFontSize: 20,
          textDayHeaderFontSize: 14,
          textDayFontWeight: '500',
          textMonthFontWeight: '800',
          textDayHeaderFontWeight: '700',
        }}
        style={styles.calendar}
      />

      <Text style={styles.sectionHeader}>
        Work Orders on {moment(selectedDate).format('LL')}
      </Text>

      <FlatList
        data={ordersForSelectedDate}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrderItem}
        contentContainerStyle={
          ordersForSelectedDate.length ? styles.listContainer : styles.emptyContainer
        }
        ListEmptyComponent={
          <Text style={styles.noData}>No work orders scheduled on this day.</Text>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0d6efd" />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  screenHeader: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginVertical: 16,
  },
  calendar: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f7',
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 16,
    marginBottom: 4,
    marginHorizontal: 16,
  },
  listContainer: { paddingHorizontal: 0, paddingVertical: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  orderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginVertical: 6,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  orderTitle: { fontSize: 15, fontWeight: '900', color: '#0f172a', marginBottom: 4 },
  orderText: { fontSize: 13, color: '#0f172a' },
  noData: { fontStyle: 'italic', color: '#0f172a', marginTop: 32, textAlign: 'center' },
});
