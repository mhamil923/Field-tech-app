// File: app/screens/AddWorkOrder.js
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import api, { getMe } from '../../constants/api';

export default function AddWorkOrder() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);

  // Form fields
  const [poNumber, setPoNumber] = useState('');
  const [customer, setCustomer] = useState('');
  const [siteLocation, setSiteLocation] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [status, setStatus] = useState('Parts In'); // default as requested

  // Attachments
  const [photoUri, setPhotoUri] = useState(null);
  const [pdfUri, setPdfUri] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getMe();
        setMe(u);
      } catch {
        setMe(null);
      }
    })();
  }, []);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      return Alert.alert('Permission needed', 'Photos access is required.');
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (res.canceled) return;
    const originalUri = res.assets[0].uri;

    try {
      const manip = await ImageManipulator.manipulateAsync(
        originalUri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhotoUri(manip.uri);
    } catch {
      setPhotoUri(originalUri);
    }
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false });
    if (res.canceled || !res.assets?.length) return;
    setPdfUri(res.assets[0].uri);
  };

  const submit = async () => {
    if (me?.username !== 'Jeff') return Alert.alert('Not allowed', 'Only Jeff can add work orders from the app.');
    if (!customer || !billingAddress || !problemDescription) {
      return Alert.alert('Missing', 'Customer, Billing Address, and Problem are required.');
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('poNumber', poNumber);
      form.append('customer', customer);
      form.append('siteLocation', siteLocation);
      form.append('billingAddress', billingAddress);
      form.append('problemDescription', problemDescription);
      form.append('status', status); // default "Parts In"

      if (photoUri) {
        form.append('photoFile', { uri: photoUri, name: `photo-${Date.now()}.jpg`, type: 'image/jpeg' });
      }
      if (pdfUri) {
        form.append('pdfFile', { uri: pdfUri, name: `workorder-${Date.now()}.pdf`, type: 'application/pdf' });
      }

      await api.post('/work-orders', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      Alert.alert('Success', 'Work order created.');
      router.back();
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to create work order.');
    } finally {
      setBusy(false);
    }
  };

  if (me && me.username !== 'Jeff') {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#ef4444', fontWeight: '700' }}>You are not authorized to add work orders.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.title}>Add Work Order</Text>

      <LabeledInput label="PO / WO Number" value={poNumber} onChangeText={setPoNumber} />
      <LabeledInput required label="Customer" value={customer} onChangeText={setCustomer} />
      <LabeledInput label="Site Location" value={siteLocation} onChangeText={setSiteLocation} />
      <LabeledInput required label="Billing Address" value={billingAddress} onChangeText={setBillingAddress} multiline />
      <LabeledInput required label="Problem Description" value={problemDescription} onChangeText={setProblemDescription} multiline />

      <LabeledInput label="Status (default Parts In)" value={status} onChangeText={setStatus} />

      <View style={styles.row}>
        <TouchableOpacity onPress={pickPhoto} style={[styles.btn, { backgroundColor: '#0ea5e9' }]}>
          <Text style={styles.btnText}>{photoUri ? 'Change Photo' : 'Attach Photo'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={pickPdf} style={[styles.btn, { backgroundColor: '#6b7280' }]}>
          <Text style={styles.btnText}>{pdfUri ? 'Change PDF' : 'Attach PDF'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity disabled={busy} onPress={submit} style={[styles.submit, busy && { opacity: 0.6 }]}>
        <Text style={styles.submitText}>{busy ? 'Saving…' : 'Create Work Order'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function LabeledInput({ label, required, multiline, ...props }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>
        {label} {required ? <Text style={{ color: '#ef4444' }}>*</Text> : null}
      </Text>
      <TextInput
        style={[styles.input, multiline && { height: 100, textAlignVertical: 'top' }]}
        placeholder={label}
        multiline={!!multiline}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, backgroundColor: '#F1F5F9', paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', textAlign: 'center', marginBottom: 12 },
  label: { color: '#334155', marginBottom: 6, fontWeight: '700' },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800' },
  submit: { marginTop: 16, backgroundColor: '#0f766e', padding: 14, borderRadius: 10, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
});
