// File: app/index.js

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import axios from 'axios';
import moment from 'moment';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE_URL from '../constants/API_BASE_URL';

export default function HomeScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('jwt');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const { data } = await axios.get(
          `${API_BASE_URL}/work-orders`,
          { headers }
        );
        setOrders(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching work orders:', error);
        if (error.response?.status === 401) {
          router.push('/screens/LoginScreen');
        }
      }
    })();
  }, []);

  const todayStr = moment().format('YYYY-MM-DD');

  const agendaOrders = orders.filter(
    o =>
      o.scheduledDate &&
      moment(o.scheduledDate).format('YYYY-MM-DD') === todayStr
  );

  const upcomingOrders = orders.filter(
    o =>
      o.scheduledDate &&
      moment(o.scheduledDate).isAfter(todayStr)
  );

  const renderCard = order => (
    <TouchableOpacity
      key={order.id}
      style={styles.card}
      onPress={() => router.push(`/screens/ViewWorkOrder?id=${order.id}`)}
    >
      <Text style={styles.cardTitle}>PO#: {order.poNumber}</Text>
      <Text style={styles.cardText}>Customer: {order.customer}</Text>
      <Text style={styles.cardText}>Site: {order.siteLocation}</Text>
      <Text style={styles.cardText}>Problem: {order.problemDescription}</Text>
      {order.scheduledDate && (
        <Text style={styles.cardText}>
          Scheduled: {moment(order.scheduledDate).format('YYYY-MM-DD')}
        </Text>
      )}
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Welcome to the CRM Dashboard</Text>

      {/* Agenda for Today */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Agenda for Today ({todayStr})
        </Text>
        {agendaOrders.length
          ? agendaOrders.map(renderCard)
          : <Text style={styles.noData}>No work orders scheduled for today.</Text>}
      </View>

      {/* Upcoming Work Orders */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming Work Orders</Text>
        {upcomingOrders.length
          ? upcomingOrders.map(renderCard)
          : <Text style={styles.noData}>No upcoming work orders.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F1F5F9',
    padding: 16,
    flexGrow: 1,
  },
  header: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
    color: '#2B2D42',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    color: '#3D5A80',
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    // iOS shadow
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    // Android elevation
    elevation: 2,
  },
  cardTitle: {
    fontWeight: '700',
    marginBottom: 6,
    color: '#2B2D42',
  },
  cardText: {
    fontSize: 14,
    marginBottom: 2,
    color: '#2B2D42',
  },
  noData: {
    fontStyle: 'italic',
    color: '#8D99AE',
  },
});
