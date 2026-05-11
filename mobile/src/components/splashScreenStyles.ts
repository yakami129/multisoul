import { StyleSheet } from 'react-native';

export const splashScreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },

  // Corners
  cornerTL: {
    position: 'absolute',
    top: 52,
    left: 10,
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },
  cornerTR: {
    position: 'absolute',
    top: 52,
    right: 10,
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },
  cornerBL: {
    position: 'absolute',
    bottom: 52,
    left: 10,
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },
  cornerBR: {
    position: 'absolute',
    bottom: 52,
    right: 10,
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },

  stampTL: {
    position: 'absolute',
    top: 70,
    left: 18,
    fontFamily: 'Inter',
    fontSize: 9,
    color: '#555555',
    letterSpacing: 1.2,
  },
  stampTR: {
    position: 'absolute',
    top: 70,
    right: 18,
    fontFamily: 'Inter',
    fontSize: 9,
    color: '#FF6B35',
    letterSpacing: 1.5,
  },

  // Scan telemetry header
  scanHeader: {
    width: '100%',
    paddingVertical: 5,
    marginBottom: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1E1E1E',
  },
  scanHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  scanHeaderCursor: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#FF6B35',
  },
  scanHeaderText: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#888888',
    letterSpacing: 1.2,
  },

  // ASCII art
  artWrap: {
    alignItems: 'flex-start',
    marginBottom: 14,
    position: 'relative',
  },
  artLine: {
    fontFamily: 'Inter',
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 0,
  },
  artPending: { color: '#333333' },
  artActive: {
    color: '#FFFFFF',
    textShadowColor: '#FF6B3588',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  artDecoded: { color: '#888888' },
  beamArrow: {
    position: 'absolute',
    left: -14,
    fontFamily: 'Inter',
    fontSize: 8,
    lineHeight: 10,
    color: '#FF6B35',
    textShadowColor: '#FF6B35CC',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },

  footerStamp: {
    fontFamily: 'Inter',
    fontSize: 9,
    color: '#555555',
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
    color: '#666666',
    letterSpacing: 4,
    marginBottom: 2,
  },
  brandTitle: {
    fontFamily: 'Anton',
    fontSize: 38,
    color: '#FFFFFF',
    letterSpacing: 7,
    opacity: 0.85,
  },
  brandSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#888888',
    letterSpacing: 3.5,
  },

  // Boot
  bootWrap: {
    width: '100%',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#1E1E1E',
    borderRadius: 8,
    padding: 10,
    gap: 1,
    marginBottom: 10,
  },
  bootHeading: {
    fontFamily: 'Inter',
    fontSize: 9,
    color: '#555555',
    letterSpacing: 2,
    marginBottom: 4,
    textAlign: 'center',
  },
  bootLine: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#666666',
    lineHeight: 15,
  },
  bootDivider: { color: '#1E1E1E' },
  bootHeaderLine: { color: '#FF6B35' },
  bootOk: { color: '#4CAF50' },
  bootHex: { color: '#888888' },
  bootWarn: { color: '#888888', opacity: 0.65 },
  bootHero: {
    color: '#FFFFFF',
    textShadowColor: '#FF6B3599',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  cursor: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#FF6B35',
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
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#1E1E1E',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#FF6B35',
  },
  progressGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#FF8C42',
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
    color: '#555555',
    letterSpacing: 2.5,
  },
  progressPct: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#FF6B35',
    letterSpacing: 1,
  },

  readyText: {
    fontFamily: 'Anton',
    fontSize: 15,
    color: '#FF6B35',
    letterSpacing: 3,
    textShadowColor: '#FF6B3599',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
});
