import { AlertTriangle, Image as ImageIcon, X } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type SpecIdeaAttachment } from './specUiModels';

interface AttachmentRowProps {
  attachment: SpecIdeaAttachment;
  onRemove: () => void;
  onRetry: () => void;
}

export function AttachmentRow({ attachment, onRemove, onRetry }: AttachmentRowProps) {
  const isImage = attachment.kind === 'image';
  const statusIcon = getStatusIcon(attachment.status);
  const showRetry = attachment.status === 'error';

  return (
    <View style={s.attachmentRow}>
      <View style={s.attachmentContent}>
        {isImage && attachment.uri ? (
          <Image source={{ uri: attachment.uri }} style={s.attachmentThumbnail} />
        ) : (
          <View style={s.attachmentIconPlaceholder}>
            <ImageIcon size={20} color={brandColors.textMuted} />
          </View>
        )}
        <View style={s.attachmentInfo}>
          <Text style={s.attachmentTitle} numberOfLines={1}>
            {attachment.title ?? attachment.kind}
          </Text>
          <Text style={s.attachmentKind}>
            {attachment.status === 'error' ? attachment.errorMessage : attachment.kind}
          </Text>
        </View>
        {statusIcon}
        {showRetry && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Retry upload"
            onPress={onRetry}
            style={s.retryButton}
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Remove attachment"
        onPress={onRemove}
        style={s.removeButton}
      >
        <X size={16} color={brandColors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

interface AttachmentButtonProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}

export function AttachmentButton({ icon, label, onPress }: AttachmentButtonProps) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.attachmentButton}>
      {icon}
      <Text style={s.attachmentButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function getStatusIcon(status?: SpecIdeaAttachment['status']) {
  switch (status) {
    case 'uploading':
      return <ActivityIndicator size="small" color={brandColors.ink} />;
    case 'error':
      return <AlertTriangle size={16} color={brandColors.error} />;
    case 'done':
      return null;
    default:
      return null;
  }
}

const s = StyleSheet.create({
  attachmentButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    backgroundColor: brandRgba.ink08,
    paddingHorizontal: 12,
  },
  attachmentButtonText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '700',
    color: brandColors.ink,
  },
  attachmentRow: {
    minHeight: 64,
    borderTopWidth: 1,
    borderTopColor: brandColors.silver,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  attachmentContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attachmentThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: brandColors.silver,
  },
  attachmentIconPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: brandRgba.ink08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentInfo: {
    flex: 1,
    minWidth: 0,
  },
  attachmentTitle: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '700',
    color: brandColors.ink,
  },
  attachmentKind: {
    marginTop: 2,
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.textMuted,
  },
  removeButton: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: brandColors.coral,
  },
  retryText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '700',
    color: brandColors.white,
  },
});
