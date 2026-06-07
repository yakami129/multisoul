import * as ImagePicker from 'expo-image-picker';
import { AlertTriangle, Image as ImageIcon, X } from 'lucide-react-native';
import React from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { deriveIdeaTitle, type SpecIdeaAttachment, type SpecTarget } from './specUiModels';

export interface IdeaEditorValue {
  title: string;
  body: string;
  attachments: SpecIdeaAttachment[];
  target?: SpecTarget;
}

interface Props {
  visible: boolean;
  initialValue?: Partial<IdeaEditorValue>;
  target?: SpecTarget;
  attachmentPreset?: SpecIdeaAttachment['kind'];
  children?: React.ReactNode;
  onChooseTarget: () => void;
  onClose: () => void;
  onSave: (value: IdeaEditorValue) => void;
}

export function IdeaEditorSheet({
  visible,
  initialValue,
  target,
  attachmentPreset,
  children,
  onChooseTarget,
  onClose,
  onSave,
}: Props) {
  const [title, setTitle] = React.useState(initialValue?.title ?? '');
  const [body, setBody] = React.useState(initialValue?.body ?? '');
  const [attachments, setAttachments] = React.useState<SpecIdeaAttachment[]>(
    initialValue?.attachments ?? [],
  );
  const dirty =
    title !== (initialValue?.title ?? '') ||
    body !== (initialValue?.body ?? '') ||
    attachments.length !== (initialValue?.attachments ?? []).length;

  React.useEffect(() => {
    if (!visible || !attachmentPreset) return;
    setAttachments((current) => {
      if (
        current.some((item) => item.kind === attachmentPreset && item.title === 'New attachment')
      ) {
        return current;
      }
      return [
        ...current,
        {
          id: `${attachmentPreset}-${Date.now()}`,
          kind: attachmentPreset,
          title: 'New attachment',
          createdAt: Date.now(),
        },
      ];
    });
  }, [attachmentPreset, visible]);

  const handleClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert('Close Idea', 'Save this draft before closing?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
      { text: 'Save Draft', onPress: () => handleSave() },
    ]);
  };

  const handleSave = () => {
    const nextBody = body.trim();
    const nextTitle = deriveIdeaTitle(title, nextBody);
    onSave({ title: nextTitle, body: nextBody, attachments, target });
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant photo library access to add images.');
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Choose from Library', 'Take Photo'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            void launchImagePicker();
          } else if (buttonIndex === 2) {
            void launchCamera();
          }
        },
      );
    } else {
      await launchImagePicker();
    }
  };

  const launchImagePicker = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      addImageAttachment(result.assets[0].uri);
    }
  };

  const launchCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant camera access to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      addImageAttachment(result.assets[0].uri);
    }
  };

  const addImageAttachment = (uri: string) => {
    const newAttachment: SpecIdeaAttachment = {
      id: `image-${Date.now()}`,
      kind: 'image',
      title: 'Image',
      uri,
      status: 'pending',
      createdAt: Date.now(),
    };
    setAttachments((current) => [...current, newAttachment]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((att) => att.id !== id));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={s.modalRoot}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.root}
        >
          <View style={s.toolbar}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={handleClose}
              style={s.toolbarButton}
            >
              <X size={18} color={brandColors.ink} />
              <Text style={s.toolbarText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.toolbarTitle}>{initialValue ? 'Edit Idea' : 'New Idea'}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={handleSave} style={s.doneButton}>
              <Text style={s.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <View style={s.group}>
              <Text style={s.label}>Title, optional</Text>
              <TextInput
                accessibilityLabel="Idea title"
                value={title}
                onChangeText={setTitle}
                placeholder="Auto-derived from the first line"
                placeholderTextColor={brandColors.textMuted}
                style={s.input}
              />
              <Text style={s.label}>Body</Text>
              <TextInput
                accessibilityLabel="Idea body"
                value={body}
                onChangeText={setBody}
                multiline
                textAlignVertical="top"
                placeholder="Capture the rough idea, bug, link, or context..."
                placeholderTextColor={brandColors.textMuted}
                style={[s.input, s.bodyInput]}
              />
            </View>

            <View style={s.group}>
              <Text style={s.sectionTitle}>Attachments</Text>
              <AttachmentButton
                icon={<ImageIcon size={16} color={brandColors.ink} />}
                label="Add Image"
                onPress={() => {
                  void pickImage();
                }}
              />
              {attachments.map((attachment) => (
                <AttachmentRow
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </View>

            <View style={s.group}>
              <Text style={s.sectionTitle}>Target</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onChooseTarget}
                style={s.targetRow}
              >
                <View style={s.targetBody}>
                  <Text style={s.targetTitle}>Project & Agent</Text>
                  <Text style={s.targetSubtitle} numberOfLines={1}>
                    {target ? `${target.repoPath} · ${target.agentName}` : 'Choose'}
                  </Text>
                </View>
                <Text style={s.chooseText}>{target ? 'Change' : 'Choose'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        {children}
      </View>
    </Modal>
  );
}

function AttachmentButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.attachmentButton}>
      {icon}
      <Text style={s.attachmentButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function AttachmentRow({
  attachment,
  onRemove,
}: {
  attachment: SpecIdeaAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.kind === 'image';
  const statusIcon = getStatusIcon(attachment.status);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onRemove}
      style={s.attachmentRow}
      activeOpacity={0.7}
    >
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
          <Text style={s.attachmentKind}>{attachment.kind}</Text>
        </View>
        {statusIcon}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Remove attachment"
        onPress={onRemove}
        style={s.removeButton}
      >
        <X size={16} color={brandColors.textMuted} />
      </TouchableOpacity>
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
  modalRoot: { flex: 1, backgroundColor: brandColors.cream },
  root: { flex: 1, backgroundColor: brandColors.cream },
  toolbar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: brandColors.silver,
  },
  toolbarButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolbarText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: brandColors.ink },
  toolbarTitle: {
    fontFamily: brandTypography.display,
    fontSize: 18,
    fontWeight: '700',
    color: brandColors.ink,
  },
  doneButton: {
    minHeight: 44,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: brandColors.ink,
  },
  doneText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.white },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  group: {
    borderRadius: 14,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    padding: 14,
    gap: 10,
  },
  label: { fontFamily: 'Inter', fontSize: 12, fontWeight: '800', color: brandColors.textSoft },
  sectionTitle: { fontFamily: 'Inter', fontSize: 12, fontWeight: '800', color: brandColors.ink },
  input: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: brandRgba.ink08,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter',
    fontSize: 14,
    color: brandColors.ink,
  },
  bodyInput: { minHeight: 130, lineHeight: 20 },
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
  targetRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12 },
  targetBody: { flex: 1, minWidth: 0 },
  targetTitle: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.ink },
  targetSubtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  chooseText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.coral },
});
