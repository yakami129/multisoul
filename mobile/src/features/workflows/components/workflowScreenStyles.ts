import { StyleSheet } from 'react-native';

export const workflowScreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: 'Inter',
    fontSize: 34,
    fontWeight: '700',
    color: '#FFFFFF',
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
    color: '#888888',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#555555',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  row: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
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
    color: '#FFFFFF',
    marginBottom: 2,
  },
  rowMeta: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
  // Form styles
  formRoot: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  formTitle: {
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  formCancel: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#888888',
  },
  formSave: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '600',
    color: '#FF6B35',
  },
  formSaveDisabled: {
    color: '#555555',
  },
  formContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  fieldLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
    marginBottom: 6,
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#FFFFFF',
  },
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
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
    backgroundColor: '#FF6B35',
  },
  segmentText: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#888888',
  },
  segmentTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  agentRow: {
    backgroundColor: '#1A1A1A',
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
    borderColor: '#FF6B35',
  },
  agentName: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#FFFFFF',
  },
  agentEndpoint: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#888888',
  },
});
