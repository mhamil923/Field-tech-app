// File: app/screens/EditWorkOrder.js

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Picker } from '@react-native-picker/picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import api from '../../constants/api';

const STATUS_OPTIONS = [
  'Needs to be Scheduled',
  'Scheduled',
  'Waiting for Approval',
  'Waiting on Parts',
  'Completed',
];

export default function EditWorkOrder() {
  const navigation = useNavigation();
  const route = useRoute();
  const { id } = route.params || {};

  const [workOrder, setWorkOrder] = useState(null);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchWorkOrder = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/work-orders/${id}`);
      setWorkOrder(data);
    } catch (error) {
      console.error('Error fetching work order:', error);
      const msg =
        error?.response?.data?.error ||
        (error?.response?.status === 403
          ? 'You are not allowed to edit this work order.'
          : 'Could not fetch work order details.');
      Alert.alert('Error', msg, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    }
  }, [id, navigation]);

  useEffect(() => {
    fetchWorkOrder();
  }, [fetchWorkOrder]);

  const pickPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const file = res.assets ? res.assets[0] : res;
      setSelectedPdf(file);
      Alert.alert('PDF selected', file.name || 'workorder.pdf');
    } catch (e) {
      console.warn('PDF picker error:', e);
      Alert.alert('Error', 'Failed to pick a PDF.');
    }
  };

  const handleUpdate = async () => {
    if (!workOrder) return;

    // Build multipart form payload expected by /work-orders/:id/edit
    const form = new FormData();
    form.append('poNumber', workOrder.poNumber || '');
    form.append('customer', workOrder.customer || '');
    form.append('siteLocation', workOrder.siteLocation || '');
    form.append('billingAddress', workOrder.billingAddress || '');
    form.append('problemDescription', workOrder.problemDescription || '');
    form.append('status', workOrder.status || 'Needs to be Scheduled');

    if (selectedPdf?.uri) {
      form.append('pdfFile', {
        uri: selectedPdf.uri,
        name: selectedPdf.name || 'workorder.pdf',
        type: selectedPdf.mimeType || 'application/pdf',
      });
    }

    try {
      setSaving(true);
      await api.put(`/work-orders/${id}/edit`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // NOTE: api instance already adds Authorization header
      });
      Alert.alert('Success', 'Work order updated successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error('Error updating work order:', error);
      const msg =
        error?.response?.data?.error ||
        (error?.response?.status === 403
          ? 'You are not allowed to edit this work order.'
          : 'Failed to update work order.');
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  if (!workOrder) {
    return (
      <View style={styles.center}>
        <Text>Loading work order details...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.header}>Edit Work Order</Text>

      <Text style={styles.label}>WO/PO #</Text>
      <TextInput
        style={styles.input}
        value={workOrder.poNumber || ''}
        onChangeText={(text) => setWorkOrder((p) => ({ ...p, poNumber: text }))}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Customer</Text>
      <TextInput
        style={styles.input}
        value={workOrder.customer || ''}
        onChangeText={(text) => setWorkOrder((p) => ({ ...p, customer: text }))}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Site Location</Text>
      <TextInput
        style={styles.input}
        value={workOrder.siteLocation || ''}
        onChangeText={(text) => setWorkOrder((p) => ({ ...p, siteLocation: text }))}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Billing Address</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        value={workOrder.billingAddress || ''}
        onChangeText={(text) => setWorkOrder((p) => ({ ...p, billingAddress: text }))}
        placeholder={'Company / Name\nStreet\nCity, ST ZIP'}
      />

      <Text style={styles.label}>Problem Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        value={workOrder.problemDescription || ''}
        onChangeText={(text) =>
          setWorkOrder((p) => ({ ...p, problemDescription: text }))
        }
      />

      <Text style={styles.label}>Status</Text>
      <View style={styles.pickerWrap}>
        <Picker
          selectedValue={workOrder.status || 'Needs to be Scheduled'}
          onValueChange={(val) =>
            setWorkOrder((p) => ({ ...p, status: val }))
          }
          mode={Platform.OS === 'ios' ? 'dialog' : 'dropdown'}
          style={styles.picker}
          itemStyle={styles.pickerItem}
        >
          {STATUS_OPTIONS.map((s) => (
            <Picker.Item key={s} label={s} value={s} />
          ))}
        </Picker>
      </View>

      {/* PDF replacement */}
      <TouchableOpacity style={styles.secondaryButton} onPress={pickPdf}>
        <Text style={styles.secondaryButtonText}>
          {selectedPdf ? 'Change Selected PDF' : 'Replace PDF'}
        </Text>
      </TouchableOpacity>
      {selectedPdf?.name ? (
        <Text style={styles.fileHint}>Selected: {selectedPdf.name}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, saving && { opacity: 0.6 }]}
        onPress={handleUpdate}
        disabled={saving}
      >
        <Text style={styles.primaryButtonText}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backButtonText}>Cancel</Text>
      </TouchableOpacity>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },

  label: { fontWeight: 'bold', marginTop: 8, color: '#2B2D42' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    backgroundColor: '#fff',
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  pickerWrap: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    marginTop: 4,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  picker: {
    width: '100%',
  },
  pickerItem: {
    fontSize: 16,
  },

  primaryButton: {
    backgroundColor: '#28a745',
    padding: 12,
    borderRadius: 6,
    marginTop: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: 'bold' },

  secondaryButton: {
    backgroundColor: '#17a2b8',
    padding: 10,
    borderRadius: 6,
    marginTop: 12,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#fff', fontWeight: '600' },

  fileHint: { marginTop: 6, color: '#3D5A80' },

  backButton: {
    backgroundColor: '#6c757d',
    padding: 12,
    borderRadius: 6,
    marginTop: 12,
    alignItems: 'center',
  },
  backButtonText: { color: '#fff', fontWeight: 'bold' },
});
