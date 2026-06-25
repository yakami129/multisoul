import { X } from 'lucide-react-native';
import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { brandColors, brandRgba } from '@/theme/brandRefresh';

export interface UserImageAttachment {
  seq: number;
  fileId?: string;
  imageUri?: string;
}

interface Props {
  attachments: UserImageAttachment[];
}

function attachmentKey(attachment: UserImageAttachment) {
  return `${attachment.seq}:${attachment.fileId ?? attachment.imageUri ?? ''}`;
}

async function probeFailedImageUri(imageUri: string, fileId: string | undefined, seq: number) {
  try {
    const res = await fetch(imageUri, { method: 'GET' });
    recordDiagnosticsEvent('warn', 'chat.image.probe', 'image url probe completed', {
      file_id: fileId,
      seq,
      status: res.status,
      ok: res.ok,
      content_type: res.headers.get('content-type'),
      content_length: res.headers.get('content-length'),
    });
  } catch (error: unknown) {
    recordDiagnosticsEvent('error', 'chat.image.probe', 'image url probe failed', {
      file_id: fileId,
      seq,
      error,
    });
  }
}

export function UserImageAttachments({ attachments }: Props) {
  const [preview, setPreview] = React.useState<UserImageAttachment | null>(null);
  const [failedKeys, setFailedKeys] = React.useState<Set<string>>(() => new Set());
  const signature = React.useMemo(() => attachments.map(attachmentKey).join('|'), [attachments]);
  const isMulti = attachments.length > 1;

  React.useEffect(() => {
    setFailedKeys(new Set());
    setPreview(null);
  }, [signature]);

  const markImageLoadFailed = React.useCallback((attachment: UserImageAttachment) => {
    recordDiagnosticsEvent('warn', 'chat.image', 'image load failed', {
      file_id: attachment.fileId,
      uri: attachment.imageUri,
      seq: attachment.seq,
    });
    if (attachment.imageUri) {
      void probeFailedImageUri(attachment.imageUri, attachment.fileId, attachment.seq);
    }
    const key = attachmentKey(attachment);
    setFailedKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const hasPreviewableImage = attachments.some(
    (attachment) => attachment.imageUri && !failedKeys.has(attachmentKey(attachment)),
  );

  return (
    <>
      {preview?.imageUri ? (
        <Modal
          testID="fullscreen-modal"
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPreview(null)}
        >
          <View style={s.modalOverlay}>
            <Pressable
              testID="fullscreen-close-btn"
              style={s.fullscreenClose}
              onPress={() => setPreview(null)}
            >
              <X size={18} color={brandColors.white} />
            </Pressable>
            <Image
              source={{ uri: preview.imageUri }}
              style={s.previewImage}
              resizeMode="contain"
              onError={() => {
                markImageLoadFailed(preview);
                setPreview(null);
              }}
            />
            <Text style={s.previewFilename}>{preview.fileId ?? 'Image'}</Text>
          </View>
        </Modal>
      ) : null}
      <View testID={isMulti ? 'user-image-grid' : undefined} style={isMulti ? s.grid : null}>
        {attachments.map((attachment) => {
          const failed = failedKeys.has(attachmentKey(attachment));
          const canPreview = attachment.imageUri && !failed;
          const label = failed ? 'Image unavailable' : '📎 Image';
          if (!canPreview) {
            return (
              <View
                key={attachmentKey(attachment)}
                testID="user-image-placeholder"
                style={isMulti ? s.placeholderBox : null}
              >
                <Text style={s.attachmentPlaceholder}>{label}</Text>
              </View>
            );
          }
          return (
            <Pressable
              key={attachmentKey(attachment)}
              testID="user-image-thumb"
              onPress={() => setPreview(attachment)}
            >
              <Image
                testID="user-image"
                source={{ uri: attachment.imageUri }}
                style={isMulti ? s.gridImage : s.thumbImage}
                resizeMode="cover"
                onError={() => markImageLoadFailed(attachment)}
              />
            </Pressable>
          );
        })}
      </View>
      {hasPreviewableImage ? <Text style={s.enlargeHint}>Tap to enlarge →</Text> : null}
    </>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    maxWidth: 276,
    marginBottom: 4,
  },
  thumbImage: { width: 120, height: 120, borderRadius: 8, marginBottom: 4 },
  gridImage: { width: 132, height: 132, borderRadius: 8 },
  placeholderBox: {
    width: 132,
    height: 132,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white70,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  attachmentPlaceholder: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.ink,
    marginBottom: 4,
  },
  enlargeHint: { fontFamily: 'Inter', fontSize: 10, color: brandColors.textSoft, marginTop: 4 },
  fullscreenClose: {
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
  previewFilename: { fontFamily: 'Inter', fontSize: 11, color: brandColors.silver, marginTop: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: brandRgba.ink72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: { width: '100%', height: '80%' },
});
