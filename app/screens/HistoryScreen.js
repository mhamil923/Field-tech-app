// File: app/screens/HistoryScreen.js
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Linking, Platform, RefreshControl, Alert
} from 'react-native';
import moment from 'moment';
import { useRouter } from 'expo-router';
import api from '../../constants/api';

export default function HistoryScreen() {
  const router = useRouter();

  const [customer, setCustomer] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [siteLocation, setSiteLocation] = useState('');

  const [results, setResults] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/work-orders/search', {
        params: { customer, poNumber, siteLocation },
      });
      setResults(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      Alert.alert('Search Error', 'Could not fetch results.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customer, poNumber, siteLocation]);

  // initial load (empty params returns all)
  useEffect(() => { runSearch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = () => {
    setRefreshing(true);
    runSearch();
  };

  const clearFilters = () => {
    setCustomer('');
    setPoNumber('');
    setSiteLocation('');
    setTimeout(runSearch, 0);
  };

  const openInGoogleMaps = async (loc) => {
    if (!loc) return;
    const q = encodeURIComponent(loc);
    const app = Platform.select({
      ios: `comgooglemaps://?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    });
    const web = `https://www.google.com/maps/search/?api=1&query=${q}`;
    try {
      const can = await Linking.canOpenURL(app);
      await Linking.openURL(can ? app : web);
    } catch {}
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.title}>WO/PO #: {item.poNumber || 'N/A'}</Text>
      <Text style={styles.line}>Customer: {item.customer || '—'}</Text>
      <Text style={styles.line}>
        Site: <Text style={styles.link} onPress={() => openInGoogleMaps(item.siteLocation)}>
          {item.siteLocation || '—'}
        </Text>
      </Text>
      <Text style={styles.line}>Problem: {item.problemDescription || '—'}</Text>
      <Text style={styles.line}>Status: {item.status || '—'}</Text>
      <Text style={styles.line}>
        Scheduled:{' '}
        {item.scheduledDate
          ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm')
          : 'Not Scheduled'}
      </Text>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.button, styles.viewBtn]}
          onPress={() => router.push(`/screens/ViewWorkOrder?id=${item.id}`)}
        >
          <Text style={styles.viewBtnText}>View Details</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>History Report</Text>

      <View style={styles.filters}>
        <TextInput
          placeholder="Customer name"
          value={customer}
          onChangeText={setCustomer}
          style={styles.input}
          autoCapitalize="words"
        />
        <TextInput
          placeholder="PO/WO #"
          value={poNumber}
          onChangeText={setPoNumber}
          style={styles.input}
          autoCapitalize="characters"
        />
        <TextInput
          placeholder="Site location"
          value={siteLocation}
          onChangeText={setSiteLocation}
          style={styles.input}
          autoCapitalize="words"
        />

        <View style={styles.filterButtons}>
          <TouchableOpacity style={[styles.button, styles.searchBtn]} onPress={runSearch} disabled={loading}>
            <Text style={styles.searchBtnText}>{loading ? 'Searching…' : 'Search'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.clearBtn]} onPress={clearFilters} disabled={loading}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>No results.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5F9', padding: 16 },
  header: { fontSize: 22, fontWeight: '700', color: '#2B2D42', marginBottom: 10 },

  filters: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  filterButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },

  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 6, alignItems: 'center' },
  searchBtn: { backgroundColor: '#17a2b8', flex: 1 },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  clearBtn: { backgroundColor: '#e5e7eb', flexBasis: 110 },
  clearBtnText: { color: '#111827', fontWeight: '700' },

  card: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  title: { fontSize: 16, fontWeight: '700', color: '#2B2D42', marginBottom: 6 },
  line: { color: '#2B2D42', marginBottom: 4 },
  link: { color: '#17a2b8', textDecorationLine: 'underline' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  viewBtn: { backgroundColor: '#17a2b8' },
  viewBtnText: { color: '#fff', fontWeight: '700' },

  empty: { textAlign: 'center', color: '#8D99AE', marginTop: 16, fontStyle: 'italic' },
});
