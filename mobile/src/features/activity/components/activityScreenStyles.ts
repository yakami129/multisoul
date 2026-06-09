import { StyleSheet } from 'react-native';
import { brandColors, brandRgba, brandShadow, brandTypography } from '@/theme/brandRefresh';

export const activityScreenStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandColors.cream },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  titleGroup: { gap: 2 },
  titleWithSpark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    fontFamily: brandTypography.display,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: brandColors.ink,
  },
  sparkIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: brandColors.activityLime,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  titleSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.activitySubtitleText,
    fontWeight: '400',
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    alignItems: 'center',
    justifyContent: 'center',
    ...brandShadow,
  },

  // ── Segment control ──────────────────────────────────────────────────────────
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: brandRgba.white88,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: brandColors.silver,
    paddingHorizontal: 5,
    paddingVertical: 4,
    gap: 0,
    ...brandShadow,
  },
  segDivider: { width: 1, height: 22, backgroundColor: 'rgba(0,0,0,0.10)', marginHorizontal: 1 },
  segItem: {
    flex: 1,
    minHeight: 34,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 3,
  },
  // Segment active: soft blue (#d8f6ff) matching prototype gradient
  segItemActive: { backgroundColor: brandColors.activitySegActive },
  segItemText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: brandColors.textMuted,
  },
  segItemTextActive: { fontWeight: '700', color: brandColors.ink },
  segDot: { width: 7, height: 7, borderRadius: 4 },
  tabUnreadDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: brandColors.activityOrange,
  },

  // ── Decision banner ─────────────────────────────────────────────────────────
  // Prototype: linear-gradient(#eaff36→#e8ff3c→#d9f635), border #a0c420
  decisionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: brandColors.activityBannerYellow,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: brandColors.activityBannerBorder,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 12,
    gap: 10,
    shadowColor: 'rgba(86,97,0,0.13)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 17,
    elevation: 3,
  },
  // Prototype alarm circle: border 7px solid #add01f, bg #fffdf3
  alarmCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 4,
    borderColor: brandColors.activityAlarmBorder,
    backgroundColor: brandColors.activityAlarmBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerCopy: { flex: 1, gap: 3 },
  bannerTitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '800',
    color: brandColors.ink,
    lineHeight: 18,
  },
  bannerSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.activitySubText,
    lineHeight: 15,
  },
  reviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: brandColors.ink,
    flexShrink: 0,
  },
  reviewPillText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.white,
  },

  // ── Timeline ─────────────────────────────────────────────────────────────────
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  timelineCol: { width: 32, alignItems: 'center', paddingTop: 0 },
  timelineLineTop: { width: 2, height: 0, backgroundColor: 'rgba(0,0,0,0.12)' },
  timelineLineBottom: { flex: 1, width: 2, backgroundColor: 'rgba(0,0,0,0.12)', minHeight: 10 },
  // Outer shell: cream bg (#fffdf9) + 2px accent border
  timelineIconOuter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandColors.activityTiconBg,
    flexShrink: 0,
  },
  // Inner disc: solid fill (prototype ticon::before inset:6px)
  timelineIconFill: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineIconText: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '800',
    color: brandColors.white,
  },

  // ── Card ──────────────────────────────────────────────────────────────────────
  cardWrapper: { flex: 1 },
  // Prototype: border rgba(22,20,18,0.12), borderRadius 20, gradient bg
  card: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(22,20,18,0.12)',
    backgroundColor: brandRgba.white88,
    overflow: 'hidden',
    ...brandShadow,
  },
  cardStrip: { width: 7, flexShrink: 0 },
  cardInner: { flex: 1, padding: 11, paddingLeft: 11, gap: 5, minHeight: 72 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: {
    flex: 1,
    flexShrink: 1,
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '700',
    color: brandColors.ink,
    lineHeight: 18,
  },
  cardAgent: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  // Prototype .agent { color: #45464a }
  cardAgentName: { fontFamily: 'Inter', fontSize: 11, color: brandColors.activityAgentText },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 1 },
  cardTime: { fontFamily: 'Inter', fontSize: 10, color: brandColors.textMuted },

  // Tag badges — from prototype: .tag=orange, .tag.green=done, .tag.blue=running
  tagBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  tagText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '500' },

  // ── Sub-panel ─────────────────────────────────────────────────────────────────
  // Prototype .tool-panel / .message-panel: rgba(255,252,247,0.78), border rgba(40,36,28,0.13)
  subPanel: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(40,36,28,0.13)',
    overflow: 'hidden',
  },
  subPanelInner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  // Prototype .message-panel span { color: #2f2f2f }
  subPanelText: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.activitySubText,
    lineHeight: 16,
  },
  subReviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: brandColors.white,
  },
  subReviewText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: brandColors.ink },

  // ── Done sub-filter ──────────────────────────────────────────────────────────
  doneHeader: { gap: 8 },
  doneSegment: {
    flexDirection: 'row',
    backgroundColor: brandRgba.white70,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: brandColors.silver,
    padding: 3,
  },
  doneSegmentItem: {
    flex: 1,
    minHeight: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneSegmentItemActive: { backgroundColor: brandColors.ink },
  doneSegmentText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: brandColors.textSoft,
  },
  doneSegmentTextActive: { color: brandColors.white },
  markReadText: {
    alignSelf: 'flex-end',
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.activityOrange,
  },

  // ── List ────────────────────────────────────────────────────────────────────
  list: {},
  content: { paddingHorizontal: 14, paddingBottom: 126, gap: 0 },

  // ── Load more ────────────────────────────────────────────────────────────────
  loadMoreFooter: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 6 },
  loadMoreText: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textMuted },
  loadMoreRetryText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.activityOrange,
  },

  // ── Swipe delete ─────────────────────────────────────────────────────────────
  deleteAction: {
    width: 72,
    backgroundColor: brandColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: brandColors.error,
    borderRadius: 14,
    marginLeft: 5,
  },
  deleteText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: brandColors.error },

  // ── Partial failure ─────────────────────────────────────────────────────────
  partialFailure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: brandRgba.white88,
    borderRadius: 8,
    padding: 10,
  },
  partialFailureText: { flex: 1, fontFamily: 'Inter', fontSize: 11, color: brandColors.ink },
  partialFailureRetry: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '700',
    color: brandColors.activityOrange,
  },

  // ── Empty states ─────────────────────────────────────────────────────────────
  emptyBody: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 80,
  },
  emptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: brandRgba.white88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontFamily: brandTypography.display,
    fontSize: 20,
    fontWeight: '700',
    color: brandColors.ink,
  },
  emptyDesc: {
    marginTop: 6,
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.textSoft,
    textAlign: 'center',
    lineHeight: 18,
  },
  retryButton: {
    marginTop: 14,
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: brandColors.ink,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: brandColors.white },
  emptySectionText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.textSoft,
    paddingVertical: 14,
  },
});
