// File: app/screens/PurchaseOrdersScreen.js
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Modal, RefreshControl, Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import moment from 'moment';
import { useRouter } from 'expo-router';
import api, { fileUrl } from '../../constants/api';

const norm = (v) => (v ?? '').toString().trim();

// Matches web CRM PurchaseOrders.js supplier list
const SUPPLIERS = ['All Suppliers', 'Chicago Tempered', 'CRL', 'Oldcastle', 'Casco'];

// Helper to check if status is "Waiting on Parts" (case-insensitive)
const isWaitingOnParts = (status) => {
  const s = (status || '').toLowerCase();
  return (s.includes('waiting') && s.includes('parts')) || s === 'waiting on parts';
};

export default function PurchaseOrdersScreen() {
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('All Suppliers');
  const [pdfModal, setPdfModal] = useState({ visible: false, url: '', poNumber: '' });

  const [results, setResults] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch purchase orders AND work orders with "Waiting on Parts" status
  // This matches the web CRM PurchaseOrders.js logic
  const fetchPOs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: 'on-order' };
      if (supplierFilter && supplierFilter !== 'All Suppliers') {
        params.supplier = supplierFilter;
      }

      // Fetch both endpoints in parallel (like web CRM does)
      const [poResponse, woResponse] = await Promise.all([
        api.get('/purchase-orders', { params }),
        api.get('/work-orders'),
      ]);

      const poList = Array.isArray(poResponse.data) ? poResponse.data : [];
      const woList = Array.isArray(woResponse.data) ? woResponse.data : [];

      // Find work orders with "Waiting on Parts" status
      const waitingWOs = woList.filter((wo) => isWaitingOnParts(wo.status));

      // Create a set of work order IDs that already have PO data
      const poWorkOrderIds = new Set(poList.map((po) => po.workOrderId || po.id));

      // Create synthetic rows for "Waiting on Parts" work orders without PO data
      const syntheticRows = waitingWOs
        .filter((wo) => !poWorkOrderIds.has(wo.id))
        .map((wo) => ({
          id: wo.id,
          workOrderId: wo.id,
          workOrderNumber: wo.workOrderNumber || '',
          poNumber: wo.poNumber || '',
          supplier: wo.poSupplier || '',
          customer: wo.customer || '',
          siteLocation: wo.siteLocation || '',
          siteAddress: wo.siteAddress || '',
          poPdfPath: wo.poPdfPath || '',
          createdAt: wo.createdAt || null,
          poPickedUp: false,
          poStatus: 'On Order',
          workOrderStatus: wo.status || 'Waiting on Parts',
          __synthetic: true,
        }));

      // Merge PO list with synthetic rows
      const combined = [...poList, ...syntheticRows];

      // Filter to only show "Waiting on Parts" work orders (like web CRM)
      const waitingOnly = combined.filter((item) => {
        const woId = item.workOrderId || item.id;
        const hasWaitingStatus = waitingWOs.some((wo) => wo.id === woId);
        const itemIsWaiting = isWaitingOnParts(item.workOrderStatus || item.status);
        return hasWaitingStatus || itemIsWaiting;
      });

      // Apply supplier filter
      let filtered = waitingOnly;
      if (supplierFilter && supplierFilter !== 'All Suppliers') {
        filtered = filtered.filter(
          (o) => (o.supplier || '').toLowerCase() === supplierFilter.toLowerCase()
        );
      }

      // Client-side text search across PO#, Customer, Site, WO#, Supplier
      const q = norm(query).toLowerCase();
      if (q) {
        filtered = filtered.filter((o) => {
          const po = (o.poNumber || '').toString().toLowerCase();
          const customer = (o.customer || '').toString().toLowerCase();
          const site = (o.siteLocation || '').toString().toLowerCase();
          const wo = (o.workOrderNumber || '').toString().toLowerCase();
          const supplier = (o.supplier || '').toString().toLowerCase();
          return (
            po.includes(q) ||
            customer.includes(q) ||
            site.includes(q) ||
            wo.includes(q) ||
            supplier.includes(q)
          );
        });
      }

      setResults(filtered);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Could not fetch purchase orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, supplierFilter]);

  useEffect(() => { fetchPOs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = () => {
    setRefreshing(true);
    fetchPOs();
  };

  const clearFilters = () => {
    setQuery('');
    setSupplierFilter('All Suppliers');
    setTimeout(() => fetchPOs(), 0);
  };

  // ----- actions -----
  const openPdf = (poPdfPath, poNumber) => {
    const url = fileUrl(poPdfPath);
    if (!url) {
      Alert.alert('No PDF', 'No PO PDF is attached to this work order.');
      return;
    }
    setPdfModal({ visible: true, url, poNumber: norm(poNumber) || 'N/A' });
  };

  const markPickedUp = async (item) => {
    const woId = item.workOrderId || item.id;
    const isSynthetic = item.__synthetic === true;

    Alert.alert(
      'Mark Picked Up',
      `Mark ${norm(item.poNumber) ? `PO ${norm(item.poNumber)}` : 'this work order'} as picked up?\n\nThis will change the status to "Needs to be Scheduled".`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Picked Up',
          onPress: async () => {
            try {
              // For synthetic rows (no PO record), just update work order status
              // For regular PO rows, also mark PO as picked up
              if (!isSynthetic) {
                try {
                  await api.put(`/purchase-orders/${item.id}/mark-picked-up`);
                } catch {
                  // PO endpoint might not exist, continue with status update
                }
              }

              // Update work order status to "Needs to be Scheduled"
              const form = new FormData();
              form.append('status', 'Needs to be Scheduled');
              await api.put(`/work-orders/${woId}/edit`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });

              Alert.alert('Done', 'Parts marked as picked up. Work order moved to "Needs to be Scheduled".');
              fetchPOs();
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'Could not update work order status.');
            }
          },
        },
      ]
    );
  };

  const viewWorkOrder = (item) => {
    const woId = item.workOrderId || item.id;
    router.push(`/screens/ViewWorkOrder?id=${woId}`);
  };

  // ----- render -----
  const renderItem = ({ item }) => {
    const woStatus = item.workOrderStatus || item.status || '';
    const showWaitingBadge = isWaitingOnParts(woStatus);

    return (
      <View style={styles.card}>
        {/* Supplier + Status badge */}
        <View style={styles.cardHeader}>
          <Text style={styles.supplier} numberOfLines={1}>
            {norm(item.supplier) || 'No Supplier'}
          </Text>
          <View style={[styles.badge, showWaitingBadge ? styles.badgeOrange : styles.badgeBlue]}>
            <Text style={[styles.badgeText, showWaitingBadge ? styles.badgeTextOrange : styles.badgeTextBlue]}>
              {showWaitingBadge ? 'Waiting on Parts' : 'On Order'}
            </Text>
          </View>
        </View>

        <Text style={styles.line}>PO #: {norm(item.poNumber) || 'N/A'}</Text>
        <Text style={styles.line}>WO #: {norm(item.workOrderNumber) || 'N/A'}</Text>
        <Text style={styles.line}>Customer: {norm(item.customer) || '—'}</Text>
        <Text style={styles.line}>Site: {norm(item.siteLocation) || '—'}</Text>
        <Text style={styles.line}>
          Created: {item.createdAt ? moment(item.createdAt).format('YYYY-MM-DD') : '—'}
        </Text>

        {/* Action buttons */}
        <View style={styles.actions}>
          {item.poPdfPath ? (
            <TouchableOpacity style={[styles.btn, styles.pdfBtn, styles.actionFlex]} onPress={() => openPdf(item.poPdfPath, item.poNumber)}>
              <Text style={styles.pdfBtnText}>View PDF</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={[styles.btn, styles.pickupBtn, styles.actionFlex]} onPress={() => markPickedUp(item)}>
            <Text style={styles.pickupBtnText}>Mark Picked Up</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.viewBtn, styles.actionFlex]} onPress={() => viewWorkOrder(item)}>
            <Text style={styles.viewBtnText}>View Work Order</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>Purchase Orders</Text>

      <View style={styles.filters}>
        {/* Search input */}
        <TextInput
          placeholder="Search PO #, Customer, Site, WO #, Supplier"
          value={query}
          onChangeText={setQuery}
          style={styles.input}
          autoCapitalize="none"
        />

        {/* Supplier filter chips */}
        <View style={styles.chipRow}>
          {SUPPLIERS.map((sup) => {
            const active = supplierFilter === sup;
            return (
              <TouchableOpacity
                key={sup}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSupplierFilter(sup)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{sup}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Search / Clear buttons */}
        <View style={styles.filterButtons}>
          <TouchableOpacity
            style={[styles.btn, styles.searchBtn]}
            onPress={() => fetchPOs()}
            disabled={loading}
          >
            <Text style={styles.searchBtnText}>{loading ? 'Searching…' : 'Search'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.clearFilterBtn]}
            onPress={clearFilters}
            disabled={loading}
          >
            <Text style={styles.clearFilterBtnText}>Clear</Text>
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
          !loading ? <Text style={styles.empty}>No purchase orders found.</Text> : null
        }
      />

      {/* In-app PDF viewer modal */}
      <Modal
        visible={pdfModal.visible}
        animationType="slide"
        onRequestClose={() => setPdfModal({ visible: false, url: '', poNumber: '' })}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>PO #{pdfModal.poNumber}</Text>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setPdfModal({ visible: false, url: '', poNumber: '' })}
            >
              <Text style={styles.modalCloseText}>X</Text>
            </TouchableOpacity>
          </View>
          {pdfModal.url ? (
            <WebView
              source={{ uri: pdfModal.url }}
              style={styles.webview}
              startInLoadingState
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f5f9', padding: 16 },
  header: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 10 },

  filters: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    color: '#0f172a',
    fontSize: 14,
  },

  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(13,110,253,0.22)',
    backgroundColor: 'rgba(13,110,253,0.06)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipActive: {
    backgroundColor: '#0d6efd',
    borderColor: '#0d6efd',
  },
  chipText: { color: '#0d6efd', fontWeight: '700', fontSize: 12 },
  chipTextActive: { color: '#ffffff' },

  filterButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },

  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
  searchBtn: {
    backgroundColor: '#0d6efd',
    flex: 1,
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  clearFilterBtn: {
    backgroundColor: '#f8fafc',
    flexBasis: 110,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clearFilterBtnText: { color: '#0f172a', fontWeight: '700' },

  // ----- Cards -----
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  supplier: { fontSize: 15, fontWeight: '900', color: '#0f172a', flex: 1, marginRight: 8 },
  line: { color: '#0f172a', fontSize: 14, marginBottom: 4 },

  // Status badges
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  badgeBlue: {
    backgroundColor: 'rgba(13,110,253,0.1)',
  },
  badgeOrange: {
    backgroundColor: 'rgba(234,88,12,0.1)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextBlue: {
    color: '#0d6efd',
  },
  badgeTextOrange: {
    color: '#ea580c',
  },

  // Action buttons
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionFlex: {
    flex: 1,
  },
  pdfBtn: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pdfBtnText: { color: '#0f172a', fontWeight: '700' },
  pickupBtn: {
    backgroundColor: '#16a34a',
    shadowColor: 'rgba(22,163,74,1)',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  pickupBtnText: { color: '#fff', fontWeight: '700' },
  viewBtn: {
    backgroundColor: '#0d6efd',
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  viewBtnText: { color: '#fff', fontWeight: '700' },

  empty: { textAlign: 'center', color: '#0f172a', marginTop: 16, fontStyle: 'italic' },

  // PDF viewer modal
  modalSafe: { flex: 1, backgroundColor: '#f1f5f9' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f1f5f9',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', flex: 1, marginRight: 12 },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  webview: { flex: 1 },
});
