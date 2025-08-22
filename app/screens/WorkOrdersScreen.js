// File: app/screens/WorkOrdersScreen.js

import React, { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import moment from 'moment';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../constants/api';

const STATUS_OPTIONS = [
  'Needs to be Scheduled',
  'Scheduled',
  'Waiting for Approval',
  'Waiting on Parts',
  'Completed',
];

export default function WorkOrdersScreen() {
  const router = useRouter();

  const [workOrders, setWorkOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [topFilterOpen, setTopFilterOpen] = useState(false);
  const [openPickers, setOpenPickers] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

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

  // Initial load
  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  // Refresh every time the screen becomes active
  useFocusEffect(
    useCallback(() => {
      fetchWorkOrders();
    }, [fetchWorkOrders])
  );

  // Re-apply filter whenever list or selected status changes
  useEffect(() => {
    let filtered = workOrders;

    if (selectedStatus === 'Today') {
      const today = moment().format('YYYY-MM-DD');
      filtered = workOrders.filter(
        o =>
          o.scheduledDate &&
          moment(o.scheduledDate).format('YYYY-MM-DD') === today
      );
    } else if (selectedStatus !== 'All') {
      filtered = workOrders.filter(o => o.status === selectedStatus);
    }

    setFilteredOrders(filtered);
  }, [workOrders, selectedStatus]);

  const applyFilter = (value) => {
    setSelectedStatus(value);
    setTopFilterOpen(false);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchWorkOrders();
  };

  const handleUpdateStatus = async (id, newStatus) => {
    // Optimistic update
    const prev = workOrders;
    const next = prev.map(o => (o.id === id ? { ...o, status: newStatus } : o));
    setWorkOrders(next);

    try {
      await api.put(`/work-orders/${id}`, { status: newStatus });
    } catch (err) {
      console.error('Error updating status:', err);
      setWorkOrders(prev); // rollback
      Alert.alert(
        'Error',
        err?.response?.data?.error || 'Failed to update status.'
      );
    } finally {
      // Re-apply current filter to reflect any changes
      setSelectedStatus((s) => s); // noop but triggers effect if needed
    }
  };

  const openInGoogleMaps = async (query) => {
    const q = encodeURIComponent(query || '');
    // Prefer Google Maps app on iOS; if not installed, fallback to web
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

  const renderOrderItem = ({ item }) => {
    const isPickerOpen = !!openPickers[item.id];

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          WO/PO #: {item.poNumber || 'N/A'}
        </Text>
        <Text style={styles.cardText}>Customer: {item.customer}</Text>

        <TouchableOpacity onPress={() => openInGoogleMaps(item.siteLocation)}>
          <Text style={styles.linkText}>
            Site Location: {item.siteLocation}
          </Text>
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
              {STATUS_OPTIONS.map(s => (
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

  const renderTopFilter = topFilterOpen ? (
    <Picker
      mode={Platform.OS === 'ios' ? 'dialog' : 'dropdown'}
      style={styles.topFilterPicker}
      selectedValue={selectedStatus}
      onValueChange={applyFilter}
    >
      {['All', 'Today', ...STATUS_OPTIONS].map(v => (
        <Picker.Item key={v} label={v} value={v} />
      ))}
    </Picker>
  ) : (
    <TouchableOpacity
      style={[styles.topFilterWrap, styles.pickerToggle]}
      onPress={() => setTopFilterOpen(true)}
    >
      <Text style={styles.topFilterText}>
        {selectedStatus} ▾
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Work Orders Dashboard</Text>

      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Filter:</Text>
        {renderTopFilter}
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={item => item.id.toString()}
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
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    padding: 16,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2B2D42',
    textAlign: 'center',
    marginBottom: 12,
  },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'visible',
    zIndex: 10,
    elevation: 10,
  },
  filterLabel: {
    fontSize: 16,
    color: '#3D5A80',
    marginRight: 8,
  },
  topFilterWrap: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#17a2b8',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  topFilterText: {
    fontSize: 16,
    color: '#17a2b8',
  },
  topFilterPicker: {
    width: 280,
    marginLeft: -30,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
    elevation: 20,
  },

  list: {
    paddingBottom: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 16,
    marginBottom: 12,
    overflow: 'visible',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2B2D42',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: '#2B2D42',
    marginBottom: 4,
  },
  linkText: {
    color: '#17a2b8',
    textDecorationLine: 'underline',
    marginBottom: 4,
  },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    overflow: 'visible',
    zIndex: 10,
    elevation: 10,
  },
  viewButton: {
    backgroundColor: '#17a2b8',
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  viewButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },

  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    color: '#2B2D42',
    marginRight: 6,
  },
  changeLink: {
    color: '#17a2b8',
  },

  pickerToggle: {
    zIndex: 20,
    elevation: 20,
  },
  picker: {
    width: 280,
    marginLeft: -30,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
    elevation: 20,
  },
  pickerItem: {
    fontSize: 16,
  },

  center: {
    alignItems: 'center',
    marginTop: 24,
  },
  noData: {
    fontStyle: 'italic',
    color: '#8D99AE',
  },
});
