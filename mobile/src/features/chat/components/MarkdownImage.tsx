import { X } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';

interface Props {
  src: string;
  alt: string;
  serverUrl: string;
  token: string;
}

function resolveSource(
  src: string,
  serverUrl: string,
  apiKey: string,
): { uri: string; cache: 'force-cache' } | null {
  if (src.startsWith('https://') || src.startsWith('http://')) {
    return { uri: src, cache: 'force-cache' };
  }
  if (src.startsWith('/')) {
    const base = serverUrl.replace(/\/$/, '');
    return {
      uri: `${base}/api/v1/files?path=${encodeURIComponent(src)}&token=${encodeURIComponent(apiKey)}`,
      cache: 'force-cache',
    };
  }
  return null;
}

async function probeMarkdownImageUri(uri: string, src: string, alt: string, token: string) {
  try {
    const res = await fetch(uri, { method: 'GET' });
    recordDiagnosticsEvent('warn', 'chat.markdown_image', 'markdown image probe completed', {
      src,
      alt,
      uri,
      debug_token: token,
      status: res.status,
      ok: res.ok,
      content_type: res.headers.get('content-type'),
      content_length: res.headers.get('content-length'),
    });
  } catch (error: unknown) {
    recordDiagnosticsEvent('error', 'chat.markdown_image', 'markdown image probe failed', {
      src,
      alt,
      uri,
      debug_token: token,
      error,
    });
  }
}

export function MarkdownImage({ src, alt, serverUrl, token }: Props) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(true);
  const [fullscreenLoading, setFullscreenLoading] = useState(false);

  const source = resolveSource(src, serverUrl, token);
  const markImageLoadFailed = React.useCallback(() => {
    recordDiagnosticsEvent('warn', 'chat.markdown_image', 'markdown image load failed', {
      src,
      alt,
      uri: source?.uri,
      debug_token: token,
    });
    if (source?.uri) void probeMarkdownImageUri(source.uri, src, alt, token);
    setThumbLoading(false);
    setFullscreenLoading(false);
    setHasError(true);
  }, [alt, source?.uri, src, token]);

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
        presentationStyle="overFullScreen"
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
            onLoadStart={() => setFullscreenLoading(true)}
            onLoadEnd={() => setFullscreenLoading(false)}
            onError={markImageLoadFailed}
            testID="markdown-image-fullscreen"
          />
          {fullscreenLoading ? (
            <View style={s.fullscreenLoadingOverlay} testID="markdown-image-fullscreen-loading">
              <ActivityIndicator color="#FF6B35" />
              <Text style={s.loadingText}>Loading image...</Text>
            </View>
          ) : null}
          <Text style={s.altText}>{alt}</Text>
        </View>
      </Modal>

      <Pressable
        testID="markdown-image-thumb-press"
        style={s.thumbnailFrame}
        onPress={() => {
          setFullscreenLoading(true);
          setPreviewVisible(true);
        }}
      >
        <Image
          source={source}
          style={s.thumbnail}
          resizeMode="contain"
          onLoadStart={() => setThumbLoading(true)}
          onLoadEnd={() => setThumbLoading(false)}
          onError={markImageLoadFailed}
          testID="markdown-image-thumb"
        />
        {thumbLoading ? (
          <View style={s.loadingOverlay} testID="markdown-image-loading">
            <ActivityIndicator color="#FF6B35" />
            <Text style={s.loadingText}>Loading image...</Text>
          </View>
        ) : null}
      </Pressable>
    </>
  );
}

const s = StyleSheet.create({
  thumbnailFrame: {
    width: 240,
    maxWidth: '100%',
    height: 200,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: 240,
    maxWidth: '100%',
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
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fullscreenLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
  altText: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#888888',
    position: 'absolute',
    bottom: 36,
    marginTop: 12,
  },
});
