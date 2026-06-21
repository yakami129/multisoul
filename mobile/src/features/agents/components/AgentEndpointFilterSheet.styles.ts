import { StyleSheet } from 'react-native';
import { brandColors, brandRgba, brandShadow, brandTypography } from '@/theme/brandRefresh';

export const endpointSheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  scrimVisual: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: brandRgba.ink72,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: brandColors.cream,
    paddingHorizontal: 16,
    paddingTop: 9,
    ...brandShadow,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: brandRgba.ink18,
    marginBottom: 13,
  },
  header: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontFamily: brandTypography.display,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    color: brandColors.ink,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: brandRgba.white88,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: brandColors.silver,
  },
  optionGroup: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
  },
  optionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
  },
  optionDivider: {
    borderTopWidth: 1,
    borderTopColor: brandColors.silver,
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontFamily: 'Inter',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    color: brandColors.ink,
  },
  optionMeta: {
    marginTop: 2,
    fontFamily: 'Inter',
    fontSize: 12,
    lineHeight: 16,
    color: brandColors.textSoft,
  },
  checkSlot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSlotSelected: {
    backgroundColor: brandColors.lime,
  },
});
