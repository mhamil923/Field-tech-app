// File: app/screens/WorkOrdersScreen.js

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
} from 'react-native';
import moment from 'moment';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../constants/api';

const STATUSES = [
  'Needs to be Scheduled',
  'Scheduled',
  'Waiting for Approval',
  'Waiting on Parts',
  'Parts In',
  'Completed',
];

export default function WorkOrdersScreen() {
  const router = useRouter();

  const [me, setMe] = useState(null); // { id, username, role }
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [openPickers, setOpenPickers] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

  // ---------- load current user (for Jeff-only button)
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/auth/me');
        setMe(r.data || null);
      } catch {
        // not fatal if /auth/me fails; UI just won't show Jeff button
      }
    })();
  }, []);

  const fetchWorkOrders = useCallback(async () => {
    try {
      const res = await api.get('/work-orders');
      const data = Array.isArray(res.data) ? res.data : [];
      setWorkOrders(data);
    } catch (err) {
      console.error('Error fetching work orders:', err);
      if (err?.response?.status === 401) {
        Alert.alert('Session expired', 'Please log in again.', [
          { text: 'OK', onPress: () => router.replace('/screens/LoginScreen') },
        ]);
      } else {
        Alert.alert('Error', 'Failed to fetch work orders.');
      }
    } finally {
      setLoadingFirst(false);
      setRefreshing(false);
    }
  }, [router]);

  // Initial load + on focus refresh
  useEffect(() => { fetchWorkOrders(); }, [fetchWorkOrders]);
  useFocusEffect(useCallback(() => { fetchWorkOrders(); }, [fetchWorkOrders]));

  // ---------- counts
  const counts = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map(s => [s, 0]));
    let today = 0;
    for (const o of workOrders) {
      if (o?.status && map[o.status] !== undefined) map[o.status] += 1;
      if (o?.scheduledDate && moment(o.scheduledDate).isSame(moment(), 'day')) today += 1;
    }
    return {
      byStatus: map,
      all: workOrders.length,
      today,
    };
  }, [workOrders]);

  // ---------- filtered list
  const filteredOrders = useMemo(() => {
    if (selectedStatus === 'All') return workOrders;
    if (selectedStatus === 'Today') {
      const todayStr = moment().format('YYYY-MM-DD');
      return workOrders.filter(
        o => o.scheduledDate && moment(o.scheduledDate).format('YYYY-MM-DD') === todayStr
      );
    }
    return workOrders.filter(o => o.status === selectedStatus);
  }, [workOrders, selectedStatus]);

  // ---------- actions
  const onRefresh = () => {
    setRefreshing(true);
    fetchWorkOrders();
  };

  const handleUpdateStatus = async (id, newStatus) => {
    const prev = workOrders;
    const next = prev.map(o => (o.id === id ? { ...o, status: newStatus } : o));
    setWorkOrders(next);
    try {
      await api.put(`/work-orders/${id}`, { status: newStatus });
    } catch (err) {
      console.error('Error updating status:', err);
      setWorkOrders(prev);
      Alert.alert('Error', err?.response?.data?.error || 'Failed to update status.');
    }
  };

  const openInGoogleMaps = async (query) => {
    const q = encodeURIComponent(query || '');
    const gmScheme = `comgooglemaps://?q=${q}`;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
    try {
      const supportsGm = await Linking.canOpenURL(gmScheme);
      if (supportsGm) return Linking.openURL(gmScheme);
      return Linking.openURL(webUrl);
    } catch {
      Alert.alert('Error', 'Failed to open map.');
    }
  };

  // ---------- top chips
  const TopChip = ({ label, active, onPress, count }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
      <View style={[styles.badge, active && styles.badgeActive]}>
        <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
          {count}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderChips = () => {
    const chips = [
      { key: 'All', label: 'All', count: counts.all },
      { key: 'Today', label: 'Today', count: counts.today },
      ...STATUSES.map(s => ({ key: s, label: s, count: counts.byStatus[s] || 0 })),
    ];
    return (
      <View style={styles.chipsWrap}>
        {chips.map(c => (
          <TopChip
            key={c.key}
            label={c.label}
            count={c.count}
            active={selectedStatus === c.key}
            onPress={() => setSelectedStatus(c.key)}
          />
        ))}
      </View>
    );
  };

  // ---------- list item
  const renderOrderItem = ({ item }) => {
    const isPickerOpen = !!openPickers[item.id];
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>WO/PO #: {item.poNumber || 'N/A'}</Text>
        <Text style={styles.cardText}>Customer: {item.customer}</Text>

        <TouchableOpacity onPress={() => openInGoogleMaps(item.siteLocation)}>
          <Text style={styles.linkText}>Site Location: {item.siteLocation}</Text>
        </TouchableOpacity>

        <Text style={styles.cardText}>
          Problem: {item.problemDescription}
        </Text>
        <Text style={styles.cardText}>
          Scheduled:{' '}
          {item.scheduledDate
            ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm')
            : 'Not Scheduled'}
        </Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.viewButton}
            onPress={() => router.push(`/screens/ViewWorkOrder?id=${item.id}`)}
          >
            <Text style={styles.viewButtonText}>View Details</Text>
          </TouchableOpacity>

          {isPickerOpen ? (
            <Picker
              mode={Platform.OS === 'ios' ? 'dialog' : 'dropdown'}
              style={styles.picker}
              itemStyle={styles.pickerItem}
              selectedValue={item.status}
              onValueChange={(v) => {
                handleUpdateStatus(item.id, v);
                setOpenPickers(p => ({ ...p, [item.id]: false }));
              }}
            >
              {STATUSES.map(s => (
                <Picker.Item key={s} label={s} value={s} />
              ))}
            </Picker>
          ) : (
            <TouchableOpacity
              style={[styles.statusWrap, styles.pickerToggle]}
              onPress={() => setOpenPickers(p => ({ ...p, [item.id]: true }))}
            >
              <Text style={styles.statusText}>{item.status}</Text>
              <Text style={styles.changeLink}>Change ▾</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header row with Jeff-only Add button */}
      <View style={styles.headerRow}>
        <Text style={styles.header}>Work Orders</Text>
        {me?.username === 'Jeff' && (
          <TouchableOpacity
            onPress={() => router.push('/screens/AddWorkOrder')}
            style={styles.addBtn}
          >
            <Text style={styles.addBtnText}>+ Add Work Order</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Status chips */}
      <ScrollView
        horizontal={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
      >
        {renderChips()}
      </ScrollView>

      <FlatList
        data={filteredOrders}
        keyExtractor={item => String(item.id)}
        renderItem={renderOrderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !loadingFirst ? (
            <View style={styles.center}>
              <Text style={styles.noData}>No work orders to display.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9', padding: 16 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2B2D42',
  },
  addBtn: {
    backgroundColor: '#17a2b8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addBtnText: { color: '#fff', fontWeight: '700' },

  chipsScroll: { paddingVertical: 6 },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#17a2b8',
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  chipActive: {
    backgroundColor: '#17a2b8',
    borderColor: '#17a2b8',
  },
  chipText: { color: '#17a2b8', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  badge: {
    marginLeft: 8,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#17a2b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  badgeActive: {
    backgroundColor: '#0f6a79',
    borderColor: '#0f6a79',
  },
  badgeText: { color: '#17a2b8', fontSize: 12, fontWeight: '700' },
  badgeTextActive: { color: '#fff' },

  list: { paddingBottom: 16, paddingTop: 8 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#2B2D42', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#2B2D42', marginBottom: 4 },
  linkText: { color: '#17a2b8', textDecorationLine: 'underline', marginBottom: 4 },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  viewButton: {
    backgroundColor: '#17a2b8',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  viewButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },

  statusWrap: { flexDirection: 'row', alignItems: 'center' },
  statusText: { fontSize: 14, color: '#2B2D42', marginRight: 6 },
  changeLink: { color: '#17a2b8' },

  pickerToggle: { zIndex: 20, elevation: 20 },
  picker: {
    width: 260,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
    elevation: 20,
  },
  pickerItem: { fontSize: 16 },

  center: { alignItems: 'center', marginTop: 24 },
  noData: { fontStyle: 'italic', color: '#8D99AE' },
});
