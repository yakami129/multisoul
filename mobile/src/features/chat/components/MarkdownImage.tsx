import { X } from 'lucide-react-native';
import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore } from '@/store/settingsStore';

interface Props {
  src: string;
  alt: string;
}

function resolveSource(src: string, serverUrl: string, apiKey: string): { uri: string } | null {
  if (src.startsWith('https://') || src.startsWith('http://')) {
    return { uri: src };
  }
  if (src.startsWith('/')) {
    return {
      uri: `${serverUrl}/api/v1/files?path=${encodeURIComponent(src)}&token=${encodeURIComponent(apiKey)}`,
    };
  }
  return null;
}

export function MarkdownImage({ src, alt }: Props) {
  const { serverUrl, apiKey } = useSettingsStore((s) => s.settings);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [hasError, setHasError] = useState(false);

  const source = resolveSource(src, serverUrl, apiKey);

  if (!source) {
    return (
      <View style={s.placeholder} testID="markdown-image-placeholder">
        <Text style={s.placeholderText}>Image unavailable</Text>
      </View>
    );
  }

  if (hasError) {
    return (
      <View style={s.placeholder} testID="markdown-image-error">
        <Text style={s.placeholderText}>Image unavailable</Text>
      </View>
    );
  }

  return (
    <>
      <Modal
        testID="markdown-image-modal"
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={s.modalOverlay}>
          <Pressable
            testID="markdown-image-close-btn"
            style={s.closeButton}
            onPress={() => setPreviewVisible(false)}
          >
            <X size={18} color="#FFFFFF" />
          </Pressable>
          <Image
            source={source}
            style={s.fullscreenImage}
            resizeMode="contain"
            testID="markdown-image-fullscreen"
          />
          <Text style={s.altText}>{alt}</Text>
        </View>
      </Modal>

      <Pressable testID="markdown-image-thumb-press" onPress={() => setPreviewVisible(true)}>
        <Image
          source={source}
          style={s.thumbnail}
          resizeMode="contain"
          onError={() => setHasError(true)}
          testID="markdown-image-thumb"
        />
      </Pressable>
    </>
  );
}

const s = StyleSheet.create({
  thumbnail: {
    width: '100%',
    height: 200,
  },
  placeholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  fullscreenImage: {
    width: '100%',
    height: '80%',
  },
  altText: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#888888',
    marginTop: 12,
  },
});
