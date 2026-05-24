import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { uploadImage } from '@/features/chat/services/chatService';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';

export interface PendingImage {
  localUri: string;
  fileId: string | null;
  status: 'uploading' | 'uploaded' | 'failed';
}

interface EndpointForUpload {
  base_url: string;
  token: string;
}

interface Options {
  endpoint: EndpointForUpload | undefined;
  endpoint_id: string | undefined;
  imageMapRef: React.MutableRefObject<Map<string, string>>;
}

export function usePendingImageUploads({ endpoint, endpoint_id, imageMapRef }: Options) {
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([]);

  const pickImage = React.useCallback(async () => {
    if (pendingImages.length >= 5) {
      Alert.alert('最多选择 5 张图片');
      return;
    }
    const { status: permStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permStatus !== 'granted') {
      Alert.alert('需要权限', '请在设置中开启相册/相机权限', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const compressed = await ImageManipulator.manipulateAsync(result.assets[0].uri, [], {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const localUri = compressed.uri;
    setPendingImages((prev) => [...prev, { localUri, fileId: null, status: 'uploading' }]);
    if (!endpoint) return;
    try {
      const res = await uploadImage(endpoint.base_url, endpoint.token, localUri);
      imageMapRef.current.set(res.file_id, localUri);
      setPendingImages((prev) =>
        prev.map((img) =>
          img.localUri === localUri && img.status === 'uploading'
            ? { ...img, fileId: res.file_id, status: 'uploaded' }
            : img,
        ),
      );
    } catch (error: unknown) {
      recordDiagnosticsEvent('error', 'chat.image', 'image upload failed', {
        endpoint_id,
        error,
      });
      setPendingImages((prev) =>
        prev.map((img) =>
          img.localUri === localUri && img.status === 'uploading'
            ? { ...img, status: 'failed' }
            : img,
        ),
      );
    }
  }, [endpoint, endpoint_id, imageMapRef, pendingImages.length]);

  const removePendingImage = React.useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearPendingImages = React.useCallback(() => {
    setPendingImages([]);
  }, []);

  return { pendingImages, pickImage, removePendingImage, clearPendingImages };
}
