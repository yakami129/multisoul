import { StyleSheet } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: brandColors.cream },
  nav: {
    height: 56,
    backgroundColor: brandColors.cream,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: brandColors.silver,
  },
  navTitle: { fontFamily: 'Inter', fontSize: 17, fontWeight: '800', color: brandColors.ink },
  navCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: brandRgba.white88,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: brandColors.ink,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 20 },
  olderMessagesLoading: {
    height: 40,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  workedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  workedText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.textSoft,
  },
  workedExpandedItems: {
    gap: 20,
    marginTop: 16,
  },
  inputArea: {
    backgroundColor: brandColors.cream,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
  },
  safeArea: { height: 0, backgroundColor: brandColors.cream },
});
