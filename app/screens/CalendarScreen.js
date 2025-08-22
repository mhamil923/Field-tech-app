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
          marks[dayLocal].dots = [...(marks[dayLocal].dots || []), { color: '#50CEBB' }];
        }
      }
    });

    // Always highlight the selected day
    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: '#3D5A80',
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
      <Text style={[styles.orderText, { color: '#50CEBB' }]}>
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
          backgroundColor: '#F1F5F9',
          calendarBackground: '#F1F5F9',
          textSectionTitleColor: '#2B2D42',
          dayTextColor: '#2B2D42',
          todayTextColor: '#98C379',
          selectedDayBackgroundColor: '#3D5A80',
          selectedDayTextColor: '#FFFFFF',
          dotColor: '#50CEBB',
          arrowColor: '#2B2D42',
          monthTextColor: '#2B2D42',
          textDisabledColor: '#C1C1C1',
          textDayFontSize: 16,
          textMonthFontSize: 20,
          textDayHeaderFontSize: 14,
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3D5A80" />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  screenHeader: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: '#2B2D42',
    marginVertical: 16,
  },
  calendar: {
    marginHorizontal: 12,
    borderRadius: 8,
    elevation: 2,
    paddingBottom: 8,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3D5A80',
    marginTop: 12,
    marginHorizontal: 16,
  },
  listContainer: { paddingHorizontal: 16, paddingVertical: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
    marginHorizontal: 16,
    shadowColor: '#00000020',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  orderTitle: { fontSize: 16, fontWeight: '600', color: '#2B2D42', marginBottom: 4 },
  orderText: { fontSize: 14, color: '#2B2D42' },
  noData: { fontStyle: 'italic', color: '#8D99AE', marginTop: 32, textAlign: 'center' },
});
