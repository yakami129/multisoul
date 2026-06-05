import { X } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { brandColors, brandRgba } from '@/theme/brandRefresh';

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
): { uri: string; cache?: 'force-cache' } | null {
  if (src.startsWith('https://') || src.startsWith('http://')) {
    return { uri: src };
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

function redactImageUriForLog(uri: string | undefined) {
  return uri?.replace(/([?&]token=)[^&\s"',)]+/gi, '$1[REDACTED]');
}

async function probeMarkdownImageUri(uri: string, src: string, alt: string) {
  try {
    const res = await fetch(uri, { method: 'GET' });
    recordDiagnosticsEvent('warn', 'chat.markdown_image', 'markdown image probe completed', {
      src: redactImageUriForLog(src),
      alt,
      uri: redactImageUriForLog(uri),
      status: res.status,
      ok: res.ok,
      content_type: res.headers.get('content-type'),
      content_length: res.headers.get('content-length'),
    });
  } catch (error: unknown) {
    recordDiagnosticsEvent('error', 'chat.markdown_image', 'markdown image probe failed', {
      src: redactImageUriForLog(src),
      alt,
      uri: redactImageUriForLog(uri),
      error,
    });
  }
}

export function MarkdownImage({ src, alt, serverUrl, token }: Props) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(true);
  const [fullscreenLoading, setFullscreenLoading] = useState(false);
  const probedUrisRef = React.useRef<Set<string>>(new Set());
  const thumbPrefetchLoadedRef = React.useRef(false);

  const source = resolveSource(src, serverUrl, token);

  React.useEffect(() => {
    probedUrisRef.current.clear();
    setThumbError(false);
    setFullscreenError(false);
    thumbPrefetchLoadedRef.current = false;
    setThumbLoading(true);
    setFullscreenLoading(false);
  }, [source?.uri]);

  React.useEffect(() => {
    if (!source?.uri) return undefined;
    const prefetchFn = Image.prefetch;
    if (typeof prefetchFn !== 'function') return undefined;
    let cancelled = false;
    void Promise.resolve(prefetchFn(source.uri))
      .then((loaded) => {
        if (!cancelled && loaded) {
          thumbPrefetchLoadedRef.current = true;
          setThumbLoading(false);
        }
      })
      .catch(() => {
        // Keep the Image component as the source of truth for failures; prefetch
        // is only a fallback for cache/load paths that miss onLoadEnd.
      });
    return () => {
      cancelled = true;
    };
  }, [source?.uri]);

  const recordImageLoadFailed = React.useCallback(
    (surface: 'thumbnail' | 'fullscreen') => {
      recordDiagnosticsEvent('warn', 'chat.markdown_image', 'markdown image load failed', {
        src: redactImageUriForLog(src),
        alt,
        surface,
        uri: redactImageUriForLog(source?.uri),
      });
      if (source?.uri && !probedUrisRef.current.has(source.uri)) {
        probedUrisRef.current.add(source.uri);
        void probeMarkdownImageUri(source.uri, src, alt);
      }
    },
    [alt, source?.uri, src],
  );

  const markThumbnailLoadFailed = React.useCallback(() => {
    recordImageLoadFailed('thumbnail');
    thumbPrefetchLoadedRef.current = false;
    setThumbLoading(false);
    setThumbError(true);
  }, [recordImageLoadFailed]);

  const markThumbnailLoadStarted = React.useCallback(() => {
    if (!thumbPrefetchLoadedRef.current) setThumbLoading(true);
  }, []);

  const markThumbnailLoaded = React.useCallback(() => {
    thumbPrefetchLoadedRef.current = true;
    setThumbLoading(false);
  }, []);

  const markFullscreenLoadStarted = React.useCallback(() => {
    setFullscreenLoading(true);
  }, []);

  const markFullscreenLoaded = React.useCallback(() => {
    setFullscreenLoading(false);
  }, []);

  const markFullscreenLoadFailed = React.useCallback(() => {
    recordImageLoadFailed('fullscreen');
    setFullscreenLoading(false);
    setFullscreenError(true);
  }, [recordImageLoadFailed]);

  if (!source) {
    return (
      <View style={s.placeholder} testID="markdown-image-placeholder">
        <Text style={s.placeholderText}>Image unavailable</Text>
      </View>
    );
  }

  if (thumbError) {
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
            onPress={() => {
              setPreviewVisible(false);
              setFullscreenError(false);
              setFullscreenLoading(false);
            }}
          >
            <X size={18} color={brandColors.white} />
          </Pressable>
          {fullscreenError ? (
            <View style={s.fullscreenError} testID="markdown-image-fullscreen-error">
              <Text style={s.placeholderText}>Image unavailable</Text>
            </View>
          ) : (
            <Image
              source={source}
              style={s.fullscreenImage}
              resizeMode="contain"
              onLoadStart={markFullscreenLoadStarted}
              onLoad={markFullscreenLoaded}
              onLoadEnd={markFullscreenLoaded}
              onError={markFullscreenLoadFailed}
              testID="markdown-image-fullscreen"
            />
          )}
          {fullscreenLoading ? (
            <View style={s.fullscreenLoadingOverlay} testID="markdown-image-fullscreen-loading">
              <ActivityIndicator color={brandColors.coral} />
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
          setFullscreenError(false);
          setFullscreenLoading(true);
          setPreviewVisible(true);
        }}
      >
        <Image
          source={source}
          style={s.thumbnail}
          resizeMode="contain"
          onLoadStart={markThumbnailLoadStarted}
          onLoad={markThumbnailLoaded}
          onLoadEnd={markThumbnailLoaded}
          onError={markThumbnailLoadFailed}
          testID="markdown-image-thumb"
        />
        {thumbLoading ? (
          <View style={s.loadingOverlay} testID="markdown-image-loading">
            <ActivityIndicator color={brandColors.coral} />
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
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white70,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: 240,
    maxWidth: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: brandRgba.white70,
    borderWidth: 1,
    borderColor: brandColors.silver,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: brandRgba.ink72,
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
    backgroundColor: brandColors.darkPanel,
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
    backgroundColor: brandRgba.white88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fullscreenLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: brandRgba.ink72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fullscreenError: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textMuted,
  },
  altText: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.silver,
    position: 'absolute',
    bottom: 36,
    marginTop: 12,
  },
});
