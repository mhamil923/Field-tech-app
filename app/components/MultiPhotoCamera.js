// File: app/components/MultiPhotoCamera.js
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  Dimensions,
  ActivityIndicator,
  Alert,
  FlatList,
  Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function MultiPhotoCamera({ visible, onClose, onUpload, workOrderId }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const [facing, setFacing] = useState('back');
  const [flash, setFlash] = useState('off');
  const [showReview, setShowReview] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [captureFlash, setCaptureFlash] = useState(false);
  const cameraRef = useRef(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

  // Request permission on mount
  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission();
    }
  }, [visible]);

  // Reset state when opening camera
  useEffect(() => {
    if (visible) {
      setCapturedPhotos([]);
      setShowReview(false);
      setSelectedPhotoIndex(0);
    }
  }, [visible]);

  // Flash animation when photo is captured
  const triggerCaptureFlash = () => {
    setCaptureFlash(true);
    Animated.sequence([
      Animated.timing(flashAnim, {
        toValue: 1,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(flashAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => setCaptureFlash(false));
  };

  // Capture photo
  const capturePhoto = async () => {
    if (cameraRef.current) {
      try {
        triggerCaptureFlash();
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: false,
          exif: true,
          skipProcessing: true,
        });

        const newPhoto = {
          id: Date.now().toString(),
          uri: photo.uri,
          timestamp: new Date().toISOString(),
          width: photo.width,
          height: photo.height,
        };

        setCapturedPhotos(prev => [...prev, newPhoto]);
      } catch (error) {
        console.error('Error capturing photo:', error);
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
      }
    }
  };

  // Delete photo
  const deletePhoto = (photoId) => {
    Alert.alert(
      'Delete Photo',
      'Are you sure you want to delete this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setCapturedPhotos(prev => prev.filter(p => p.id !== photoId));
            if (selectedPhotoIndex >= capturedPhotos.length - 1) {
              setSelectedPhotoIndex(Math.max(0, capturedPhotos.length - 2));
            }
          },
        },
      ]
    );
  };

  // Toggle camera facing
  const toggleFacing = () => {
    setFacing(prev => (prev === 'back' ? 'front' : 'back'));
  };

  // Cycle flash mode
  const cycleFlash = () => {
    setFlash(prev => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
  };

  // Get flash icon
  const getFlashIcon = () => {
    if (flash === 'on') return 'flash';
    if (flash === 'auto') return 'flash-outline';
    return 'flash-off';
  };

  // Format timestamp
  const formatTimestamp = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Handle done - go to review
  const handleDone = () => {
    if (capturedPhotos.length === 0) {
      onClose();
    } else {
      setShowReview(true);
    }
  };

  // Handle upload all photos
  const handleUploadAll = async () => {
    if (capturedPhotos.length === 0) return;

    setUploading(true);
    try {
      await onUpload(capturedPhotos);
      setCapturedPhotos([]);
      setShowReview(false);
      onClose();
    } catch (error) {
      console.error('Error uploading photos:', error);
      Alert.alert('Upload Error', 'Failed to upload photos. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Handle close
  const handleClose = () => {
    if (capturedPhotos.length > 0) {
      Alert.alert(
        'Discard Photos?',
        `You have ${capturedPhotos.length} photo(s) that haven't been uploaded. Discard them?`,
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              setCapturedPhotos([]);
              setShowReview(false);
              onClose();
            },
          },
        ]
      );
    } else {
      onClose();
    }
  };

  // Go back to camera from review
  const handleBackToCamera = () => {
    setShowReview(false);
  };

  // Permission not granted
  if (!permission?.granted) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color="#86868b" />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            Please grant camera permission to take photos.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // Review Screen
  if (showReview) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.reviewContainer}>
          {/* Header */}
          <View style={styles.reviewHeader}>
            <TouchableOpacity onPress={handleBackToCamera} style={styles.headerButton}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
              <Text style={styles.headerButtonText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.reviewTitle}>Review Photos</Text>
            <TouchableOpacity
              onPress={handleUploadAll}
              style={[styles.uploadButton, uploading && styles.uploadButtonDisabled]}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={18} color="#fff" />
                  <Text style={styles.uploadButtonText}>Upload All</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Main Photo Preview */}
          <View style={styles.mainPreviewContainer}>
            {capturedPhotos.length > 0 && (
              <FlatList
                data={capturedPhotos}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                  setSelectedPhotoIndex(index);
                }}
                renderItem={({ item }) => (
                  <View style={styles.mainPreviewItem}>
                    <Image source={{ uri: item.uri }} style={styles.mainPreviewImage} />
                    <Text style={styles.photoTimestamp}>
                      Taken: {formatTimestamp(item.timestamp)}
                    </Text>
                  </View>
                )}
                keyExtractor={(item) => item.id}
              />
            )}
          </View>

          {/* Pagination Dots */}
          <View style={styles.paginationContainer}>
            {capturedPhotos.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.paginationDot,
                  index === selectedPhotoIndex && styles.paginationDotActive,
                ]}
              />
            ))}
          </View>

          {/* Photo Count */}
          <Text style={styles.photoCount}>
            {capturedPhotos.length} photo{capturedPhotos.length !== 1 ? 's' : ''} ready to upload
          </Text>

          {/* Action Buttons */}
          <View style={styles.reviewActions}>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => deletePhoto(capturedPhotos[selectedPhotoIndex]?.id)}
              disabled={capturedPhotos.length === 0}
            >
              <Ionicons name="trash-outline" size={22} color="#ff453a" />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.addMoreButton} onPress={handleBackToCamera}>
              <Ionicons name="camera" size={22} color="#0a84ff" />
              <Text style={styles.addMoreButtonText}>Add More</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Camera Screen
  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        {/* Camera View */}
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          flash={flash}
        >
          {/* Capture Flash Overlay */}
          {captureFlash && (
            <Animated.View
              style={[
                styles.captureFlashOverlay,
                { opacity: flashAnim },
              ]}
            />
          )}

          {/* Top Controls */}
          <View style={styles.topControls}>
            <TouchableOpacity onPress={handleClose} style={styles.controlButton}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>

            <View style={styles.topRightControls}>
              <TouchableOpacity onPress={cycleFlash} style={styles.controlButton}>
                <Ionicons name={getFlashIcon()} size={24} color="#fff" />
                {flash === 'auto' && <Text style={styles.flashAutoText}>A</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={toggleFacing} style={styles.controlButton}>
                <Ionicons name="camera-reverse" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Bottom Section */}
          <View style={styles.bottomSection}>
            {/* Thumbnail Strip */}
            {capturedPhotos.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbnailStrip}
                contentContainerStyle={styles.thumbnailStripContent}
              >
                {capturedPhotos.map((photo, index) => (
                  <TouchableOpacity
                    key={photo.id}
                    onPress={() => {
                      setSelectedPhotoIndex(index);
                      setShowReview(true);
                    }}
                    style={styles.thumbnailContainer}
                  >
                    <Image source={{ uri: photo.uri }} style={styles.thumbnail} />
                    <View style={styles.thumbnailBadge}>
                      <Text style={styles.thumbnailBadgeText}>{index + 1}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Capture Controls */}
            <View style={styles.captureControls}>
              <View style={styles.photoCountContainer}>
                {capturedPhotos.length > 0 && (
                  <Text style={styles.photoCountText}>
                    {capturedPhotos.length} photo{capturedPhotos.length !== 1 ? 's' : ''}
                  </Text>
                )}
              </View>

              {/* Capture Button */}
              <TouchableOpacity onPress={capturePhoto} style={styles.captureButton}>
                <View style={styles.captureButtonInner} />
              </TouchableOpacity>

              {/* Done Button */}
              <TouchableOpacity onPress={handleDone} style={styles.doneButton}>
                <Text style={styles.doneButtonText}>
                  {capturedPhotos.length > 0 ? 'Done' : 'Cancel'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </CameraView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },

  // Permission Screen
  permissionContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 20,
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 16,
    color: '#86868b',
    textAlign: 'center',
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: '#0a84ff',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#0a84ff',
  },

  // Top Controls
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  topRightControls: {
    flexDirection: 'row',
    gap: 16,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flashAutoText: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },

  // Bottom Section
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },

  // Thumbnail Strip
  thumbnailStrip: {
    maxHeight: 80,
    marginBottom: 16,
  },
  thumbnailStripContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  thumbnailContainer: {
    position: 'relative',
    marginRight: 8,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  thumbnailBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#0a84ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },

  // Capture Controls
  captureControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  photoCountContainer: {
    flex: 1,
  },
  photoCountText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  doneButton: {
    flex: 1,
    alignItems: 'flex-end',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0a84ff',
  },

  // Capture Flash
  captureFlashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
  },

  // Review Screen
  reviewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerButtonText: {
    fontSize: 16,
    color: '#fff',
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0a84ff',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  uploadButtonDisabled: {
    opacity: 0.6,
  },
  uploadButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },

  // Main Preview
  mainPreviewContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  mainPreviewItem: {
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  mainPreviewImage: {
    width: SCREEN_WIDTH - 32,
    height: SCREEN_HEIGHT * 0.5,
    borderRadius: 16,
    resizeMode: 'contain',
  },
  photoTimestamp: {
    marginTop: 16,
    fontSize: 14,
    color: '#86868b',
  },

  // Pagination
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  paginationDotActive: {
    backgroundColor: '#fff',
  },

  // Photo Count
  photoCount: {
    textAlign: 'center',
    fontSize: 14,
    color: '#86868b',
    marginBottom: 16,
  },

  // Review Actions
  reviewActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 40,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  deleteButtonText: {
    fontSize: 16,
    color: '#ff453a',
  },
  addMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  addMoreButtonText: {
    fontSize: 16,
    color: '#0a84ff',
  },
});
