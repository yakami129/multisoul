import { StyleSheet } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';

export const workflowScreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: brandColors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: brandTypography.display,
    fontSize: 48,
    fontWeight: '900',
    color: brandColors.ink,
  },
  addButton: {
    padding: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: 'Inter',
    fontSize: 16,
    color: brandColors.textSoft,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.textMuted,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 126,
  },
  row: {
    backgroundColor: brandRgba.white88,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: brandColors.silver,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowInfo: {
    flex: 1,
    marginRight: 12,
  },
  rowName: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '600',
    color: brandColors.ink,
    marginBottom: 2,
  },
  rowMeta: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textSoft,
  },
  // Form styles
  formRoot: {
    flex: 1,
    backgroundColor: brandColors.cream,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  formTitle: {
    fontFamily: brandTypography.display,
    fontSize: 24,
    fontWeight: '900',
    color: brandColors.ink,
  },
  formCancel: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: brandColors.textSoft,
  },
  formSave: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '600',
    color: brandColors.coral,
  },
  formSaveDisabled: {
    color: brandColors.textMuted,
  },
  formContent: {
    paddingHorizontal: 16,
    paddingBottom: 126,
  },
  fieldLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textSoft,
    marginBottom: 6,
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: brandRgba.white88,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter',
    fontSize: 15,
    color: brandColors.ink,
  },
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: brandRgba.white88,
    borderRadius: 12,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  segmentItemActive: {
    backgroundColor: brandColors.ink,
  },
  segmentText: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: brandColors.textSoft,
  },
  segmentTextActive: {
    color: brandColors.white,
    fontWeight: '600',
  },
  agentRow: {
    backgroundColor: brandRgba.white88,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agentRowSelected: {
    borderWidth: 1,
    borderColor: brandColors.coral,
  },
  agentName: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: brandColors.ink,
  },
  agentEndpoint: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textSoft,
  },
});
