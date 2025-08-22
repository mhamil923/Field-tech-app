// File: constants/api.js
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE_URL from './API_BASE_URL';

/**
 * Axios instance pointed at your EB backend.
 * NOTE: If your EB is HTTP (not HTTPS), remember:
 *  - iOS: add ATS exceptions in Info.plist for your EB host
 *  - Android: set android:usesCleartextTraffic="true" or host allowlist
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { Accept: 'application/json' },
});

// Attach JWT from storage to every request
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('jwt');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Optional: auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err?.response?.status === 401) {
      try { await AsyncStorage.removeItem('jwt'); } catch {}
    }
    throw err;
  }
);

/**
 * Build a URL for files stored via your backend.
 * - For S3-backed uploads, your server redirects /files?key=uploads/... to a presigned URL.
 * - For local disk, it serves the file directly.
 *
 * @param {string} key e.g. "uploads/1699999999999-abcd12.jpg" or "uploads/xxx.pdf"
 * @returns {string|null}
 */
export function fileUrl(key) {
  if (!key) return null;
  // If backend ever returns absolute URLs already, just pass through:
  if (/^https?:\/\//i.test(key)) return key;

  // Prefer the file resolver so this works for both S3 and local
  if (String(key).startsWith('uploads/')) {
    return `${API_BASE_URL}/files?key=${encodeURIComponent(key)}`;
  }

  // Fallback (rare): treat as relative path on the API host
  return `${API_BASE_URL}/${key.replace(/^\//, '')}`;
}

/**
 * Upload one or more photos to a work order.
 * Server route: PUT /work-orders/:id/edit
 * Field name must be "photoFile" (server accepts multiple).
 *
 * @param {number|string} workOrderId
 * @param {Array<{ uri:string, name?:string, type?:string }>} assets
 *        Use ImagePicker/MediaLibrary assets. Provide .type if you can.
 */
export async function uploadPhotos(workOrderId, assets = []) {
  const form = new FormData();

  assets.forEach((asset, idx) => {
    if (!asset?.uri) return;
    const name =
      asset.name ||
      `photo-${Date.now()}-${idx}.${(asset.uri.split('.').pop() || 'jpg')}`;
    const type = asset.type || guessMimeFromName(name) || 'image/jpeg';

    form.append('photoFile', {
      uri: asset.uri,
      name,
      type,
    });
  });

  // IMPORTANT: for React Native + axios + FormData, do NOT set the boundary yourself.
  return api.put(`/work-orders/${workOrderId}/edit`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * Simple mime guesser for common image types.
 * (Avoids pulling in extra deps.)
 */
function guessMimeFromName(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return null;
}

export default api;
