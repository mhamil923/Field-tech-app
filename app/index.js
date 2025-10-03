// File: app/index.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE_URL from '../constants/API_BASE_URL';

export default function HomeScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [todayOrderIds, setTodayOrderIds] = useState([]);

  // key shared with WorkOrdersScreen
  const todayKey = `woOrder:${moment().format('YYYY-MM-DD')}`;

  const loadTodayOrder = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(todayKey);
      setTodayOrderIds(raw ? JSON.parse(raw) : []);
    } catch {
      setTodayOrderIds([]);
    }
  }, [todayKey]);

  const fetchOrders = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('jwt');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const { data } = await axios.get(`${API_BASE_URL}/work-orders`, { headers });
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching work orders:', error);
      if (error.response?.status === 401) {
        router.push('/screens/LoginScreen');
      }
    }
  }, [router]);

  // Initial load
  useEffect(() => {
    fetchOrders();
    loadTodayOrder();
  }, [fetchOrders, loadTodayOrder]);

  // Refresh when returning to Home (picks up re-ordered Today list)
  useFocusEffect(
    useCallback(() => {
      fetchOrders();
      loadTodayOrder();
    }, [fetchOrders, loadTodayOrder])
  );

  // Helpers
  const getLatestNote = (item) => {
    try {
      let arr = [];
      if (Array.isArray(item?.notes)) arr = item.notes;
      else if (typeof item?.notes === 'string') {
        try { arr = JSON.parse(item.notes); } catch { arr = []; }
      }
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        return tb - ta;
      });
      const n = sorted[0] || {};
      const time = n?.createdAt ? moment(n.createdAt).format('YYYY-MM-DD HH:mm') : '';
      const by = n?.by ? ` • ${n.by}` : '';
      const text = String(n?.text || '').trim().replace(/\s+/g, ' ');
      return { time, by, text };
    } catch {
      return null;
    }
  };

  const orderBySavedIds = (list, idOrder) => {
    if (!idOrder?.length) return list;
    const map = new Map(list.map(o => [String(o?.id ?? ''), o]));
    const ordered = [];
    for (const id of idOrder) {
      if (map.has(id)) {
        ordered.push(map.get(id));
        map.delete(id);
      }
    }
    return [...ordered, ...Array.from(map.values())];
  };

  // Time windows
  const startOfToday = moment().startOf('day');
  const endOfToday = moment().endOf('day');
  const endOf7Days = moment().add(7, 'days').endOf('day');

  // Today (agenda) — then apply saved drag order
  const agendaOrders = useMemo(() => {
    const todays = orders.filter((o) => {
      if (!o?.scheduledDate) return false;
      const d = moment(o.scheduledDate);
      return d.isValid() && d.isBetween(startOfToday, endOfToday, null, '[]');
    });
    return orderBySavedIds(todays, todayOrderIds);
  }, [orders, todayOrderIds, startOfToday, endOfToday]);

  // Upcoming: next 7 days (tomorrow .. +7)
  const upcomingOrders = useMemo(() => {
    return orders
      .filter((o) => {
        if (!o?.scheduledDate) return false;
        const d = moment(o.scheduledDate);
        return d.isValid() && d.isAfter(endOfToday) && d.isSameOrBefore(endOf7Days);
      })
      .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
  }, [orders, endOfToday, endOf7Days]);

  // Helper to show WO # cleanly
  const woNumber = (o) => (o?.workOrderNumber ? String(o.workOrderNumber) : '—');

  const renderCard = (order) => {
    const latest = getLatestNote(order);
    return (
      <View key={order.id} style={styles.card}>
        {/* Title: show WORK ORDER number */}
        <Text style={styles.cardTitle}>WO #: {woNumber(order)}</Text>

        {/* Basic details */}
        <Text style={styles.cardText}>Customer: {order.customer ?? '—'}</Text>
        <Text style={styles.cardText}>Site: {order.siteLocation ?? '—'}</Text>
        <Text style={styles.cardText}>Problem: {order.problemDescription ?? '—'}</Text>
        {order.scheduledDate && (
          <Text style={styles.cardText}>
            Scheduled: {moment(order.scheduledDate).format('YYYY-MM-DD HH:mm')}
          </Text>
        )}

        {/* Layout to mirror WorkOrdersScreen: note under info (left) + button on right */}
        <View style={styles.actionsRow}>
          <View style={styles.leftCol}>
            {latest ? (
              <View style={styles.latestNoteBox}>
                <Text style={styles.latestNoteMeta} numberOfLines={1}>
                  {latest.time}{latest.by}
                </Text>
                <Text style={styles.latestNoteText} numberOfLines={3}>
                  {latest.text}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.rightCol}>
            <TouchableOpacity
              style={styles.viewButton}
              onPress={() => router.push(`/screens/ViewWorkOrder?id=${order.id}`)}
            >
              <Text style={styles.viewButtonText}>View Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Welcome to the CRM Dashboard</Text>

      {/* Agenda for Today (ordered like the Today tab) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Agenda for Today ({startOfToday.format('YYYY-MM-DD')})
        </Text>
        {agendaOrders.length ? (
          agendaOrders.map(renderCard)
        ) : (
          <Text style={styles.noData}>No work orders scheduled for today.</Text>
        )}
      </View>

      {/* Upcoming Work Orders - only next 7 days */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming Work Orders (next 7 days)</Text>
        {upcomingOrders.length ? (
          upcomingOrders.map(renderCard)
        ) : (
          <Text style={styles.noData}>No work orders in the next 7 days.</Text>
        )}
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
    padding: 16,
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
    fontSize: 18,
  },
  cardText: {
    fontSize: 14,
    marginBottom: 4,
    color: '#2B2D42',
  },

  // layout to match WorkOrdersScreen
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  leftCol: {
    flex: 1,
    paddingRight: 10,
  },
  rightCol: {
    flexShrink: 1,
    alignItems: 'flex-end',
    maxWidth: '60%',
  },

  latestNoteBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  latestNoteMeta: { fontSize: 11, color: '#64748B', marginBottom: 4 },
  latestNoteText: { fontSize: 13, color: '#0F172A' },

  viewButton: {
    backgroundColor: '#17a2b8',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-end',
  },
  viewButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },

  noData: {
    fontStyle: 'italic',
    color: '#8D99AE',
  },
});
