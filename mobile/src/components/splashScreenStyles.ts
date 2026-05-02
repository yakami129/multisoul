import { StyleSheet } from 'react-native';

export const splashScreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040D04',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },

  // Corners
  cornerTL: {
    position: 'absolute',
    top: 52,
    left: 10,
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#0F2B0F',
  },
  cornerTR: {
    position: 'absolute',
    top: 52,
    right: 10,
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#0F2B0F',
  },
  cornerBL: {
    position: 'absolute',
    bottom: 52,
    left: 10,
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#0F2B0F',
  },
  cornerBR: {
    position: 'absolute',
    bottom: 52,
    right: 10,
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#0F2B0F',
  },

  stampTL: {
    position: 'absolute',
    top: 70,
    left: 18,
    fontFamily: 'Geist Mono',
    fontSize: 9,
    color: '#0F6B0F',
    letterSpacing: 1.2,
  },
  stampTR: {
    position: 'absolute',
    top: 70,
    right: 18,
    fontFamily: 'Geist Mono',
    fontSize: 9,
    color: '#33FF33',
    letterSpacing: 1.5,
  },

  // Scan telemetry header
  scanHeader: {
    width: '100%',
    paddingVertical: 5,
    marginBottom: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#0F2B0F',
  },
  scanHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  scanHeaderCursor: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#33FF33',
  },
  scanHeaderText: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#2D8B2D',
    letterSpacing: 1.2,
  },

  // ASCII art
  artWrap: {
    alignItems: 'flex-start',
    marginBottom: 14,
    position: 'relative',
  },
  artLine: {
    fontFamily: 'Geist Mono',
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 0,
  },
  artPending: { color: '#0F4D0F' },
  artActive: {
    color: '#AFFFAF',
    textShadowColor: '#33FF33AA',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  artDecoded: { color: '#20C20E' },
  beamArrow: {
    position: 'absolute',
    left: -14,
    fontFamily: 'Geist Mono',
    fontSize: 8,
    lineHeight: 10,
    color: '#33FF33',
    textShadowColor: '#33FF33CC',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },

  footerStamp: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    color: '#0F6B0F',
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  // Brand
  brandWrap: {
    alignItems: 'center',
    marginBottom: 18,
    gap: 4,
  },
  brandEyebrow: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#0F6B0F',
    letterSpacing: 4,
    marginBottom: 2,
  },
  brandTitle: {
    fontFamily: 'Anton',
    fontSize: 38,
    color: '#20C20E',
    letterSpacing: 7,
    opacity: 0.85,
  },
  brandSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#147A16',
    letterSpacing: 3.5,
  },

  // Boot
  bootWrap: {
    width: '100%',
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    borderRadius: 2,
    padding: 10,
    gap: 1,
    marginBottom: 10,
  },
  bootHeading: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    color: '#0F6B0F',
    letterSpacing: 2,
    marginBottom: 4,
    textAlign: 'center',
  },
  bootLine: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#147A16',
    lineHeight: 15,
  },
  bootDivider: { color: '#0F2B0F' },
  bootHeaderLine: { color: '#33FF33' },
  bootOk: { color: '#20C20E' },
  bootHex: { color: '#2D8B2D' },
  bootWarn: { color: '#147A16', opacity: 0.65 },
  bootHero: {
    color: '#AFFFAF',
    textShadowColor: '#33FF3399',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  cursor: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#33FF33',
    lineHeight: 15,
  },

  // Progress
  progressWrap: {
    width: '100%',
    gap: 5,
    alignItems: 'stretch',
    marginBottom: 12,
  },
  progressTrack: {
    width: '100%',
    height: 3,
    backgroundColor: '#061206',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#20C20E',
  },
  progressGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#33FF33',
    opacity: 0.4,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontFamily: 'Inter',
    fontSize: 9,
    color: '#0F6B0F',
    letterSpacing: 2.5,
  },
  progressPct: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#33FF33',
    letterSpacing: 1,
  },

  readyText: {
    fontFamily: 'Anton',
    fontSize: 15,
    color: '#33FF33',
    letterSpacing: 3,
    textShadowColor: '#20C20E99',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
});
