import { Image, Link, MessageSquare, X } from 'lucide-react-native';
import React from 'react';
import {
  Alert,
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
import { AttachmentEditorRow } from './AttachmentEditorRow';
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
    JSON.stringify(attachments) !== JSON.stringify(initialValue?.attachments ?? []);

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

  const addAttachment = (kind: SpecIdeaAttachment['kind']) => {
    setAttachments((current) => [
      ...current,
      {
        id: `${kind}-${Date.now()}`,
        kind,
        title: kind === 'link' ? 'Link' : kind === 'log' ? 'Log snippet' : 'Screenshot',
        createdAt: Date.now(),
      },
    ]);
  };

  const updateAttachment = (id: string, patch: Partial<SpecIdeaAttachment>) => {
    setAttachments((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
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
                icon={<Link size={16} color={brandColors.ink} />}
                label="Add Link"
                onPress={() => addAttachment('link')}
              />
              <AttachmentButton
                icon={<MessageSquare size={16} color={brandColors.ink} />}
                label="Add Log Snippet"
                onPress={() => addAttachment('log')}
              />
              <AttachmentButton
                icon={<Image size={16} color={brandColors.ink} />}
                label="Add Screenshot"
                onPress={() => addAttachment('image')}
              />
              {attachments.map((attachment) => (
                <AttachmentEditorRow
                  key={attachment.id}
                  attachment={attachment}
                  onUpdate={updateAttachment}
                  onRemove={removeAttachment}
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
  targetRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12 },
  targetBody: { flex: 1, minWidth: 0 },
  targetTitle: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.ink },
  targetSubtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  chooseText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.coral },
});
