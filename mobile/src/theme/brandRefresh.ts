import type { ImageSourcePropType, ViewStyle } from 'react-native';
import iconActivity from '../../assets/brand-refresh/icon-activity.png';
import iconAgent from '../../assets/brand-refresh/icon-agent.png';
import iconChat from '../../assets/brand-refresh/icon-chat.png';
import iconDecisionAlert from '../../assets/brand-refresh/icon-decision-alert.png';
import iconSettings from '../../assets/brand-refresh/icon-settings.png';
import iconToolCall from '../../assets/brand-refresh/icon-tool-call.png';
import mascotAppIconBadge from '../../assets/brand-refresh/mascot-app-icon-badge.png';
import mascotDecisionPointing from '../../assets/brand-refresh/mascot-decision-pointing.png';
import mascotLaptopWorking from '../../assets/brand-refresh/mascot-laptop-working.png';
import mascotPhoneStanding from '../../assets/brand-refresh/mascot-phone-standing.png';

export const brandColors = {
  cream: '#F6F3EC',
  ink: '#0D0D0D',
  cyan: '#00E5FF',
  coral: '#FF5A3C',
  lime: '#C6FF00',
  sage: '#B7C9AE',
  silver: '#E6E6E8',
  white: '#FFFFFF',
  textSoft: '#555555',
  textMuted: '#888888',
  textDisabled: '#666666',
  line: '#E6E6E8',
  darkPanel: '#1A1A1A',
  darkLine: '#2A2A2A',
  error: '#FF4444',
  legacyAction: '#FF6B35',
  successCompat: '#4CAF50',

  // Activity Screen palette — sourced from 03-activity-page.html prototype
  // These are distinct from the global brand signals above.
  activityOrange: '#FF5B32',      // --orange: attention ticon + card strip
  activityCyan: '#15BFE5',        // --cyan: running ticon + card strip
  activityLime: '#B7D52A',        // --lime: done ticon border + card strip
  activityDoneIcon: '#9DC325',    // .ticon.done fill (slightly darker than lime)
  activityBannerYellow: '#EAFF36',// decision banner primary bg
  activityBannerBorder: '#A0C420',// decision banner ring
  activityAlarmBorder: '#ADD01F', // alarm circle thick ring
  activityAlarmBg: '#FFFDF3',     // alarm circle inner bg
  activityTiconBg: '#FFFDF9',     // ticon outer cream shell
  activityTagOrangeBg: '#FDE8DF', // attention tag background
  activityTagOrangeText: '#DF441F',// attention tag label
  activityTagGreenBg: '#ECF6D9',  // done tag background
  activityTagGreenText: '#5D8D20',// done tag label
  activityTagBlueBg: '#D9F5FF',   // running tag background
  activityTagBlueText: '#1188BD', // running tag label
  activitySegActive: '#D8F6FF',   // segment pill active bg (flat approx of #d8f6ff→#97dbff gradient)
  activityAgentText: '#45464A',   // agent/bot name under card title
  activitySubText: '#2F2F2F',     // sub-panel message body text
  activitySubtitleText: '#8A8986',// header subtitle / item count
} as const;

export const brandRgba = {
  cyanWash: 'rgba(0, 229, 255, 0.24)',
  cyanSoft: 'rgba(0, 229, 255, 0.14)',
  limeSoft: 'rgba(198, 255, 0, 0.18)',
  coralSoft: 'rgba(255, 90, 60, 0.12)',
  sageSoft: 'rgba(183, 201, 174, 0.20)',
  white70: 'rgba(255, 255, 255, 0.70)',
  white88: 'rgba(255, 255, 255, 0.88)',
  ink08: 'rgba(13, 13, 13, 0.08)',
  ink12: 'rgba(13, 13, 13, 0.12)',
  ink18: 'rgba(13, 13, 13, 0.18)',
  ink72: 'rgba(13, 13, 13, 0.72)',
  silver55: 'rgba(230, 230, 232, 0.55)',
  silver78: 'rgba(230, 230, 232, 0.78)',
} as const;

export const brandTypography = {
  display: 'Space Grotesk',
  body: 'Inter',
  mono: 'SF Mono',
} as const;

export const brandShadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOpacity: 0.12,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
};

export const strongBrandShadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOpacity: 0.18,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 5,
};

export const brandAssets: Record<
  | 'iconActivity'
  | 'iconAgent'
  | 'iconChat'
  | 'iconDecisionAlert'
  | 'iconSettings'
  | 'iconToolCall'
  | 'mascotAppIconBadge'
  | 'mascotDecisionPointing'
  | 'mascotLaptopWorking'
  | 'mascotPhoneStanding',
  ImageSourcePropType
> = {
  iconActivity,
  iconAgent,
  iconChat,
  iconDecisionAlert,
  iconSettings,
  iconToolCall,
  mascotAppIconBadge,
  mascotDecisionPointing,
  mascotLaptopWorking,
  mascotPhoneStanding,
};
