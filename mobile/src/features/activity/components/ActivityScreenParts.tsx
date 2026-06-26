import { AlarmClock, Bot, Check, ChevronRight, Clock, X } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { brandColors } from '@/theme/brandRefresh';
import { formatRelativeTime, tagStyle, type ActivityItem } from './activityItem';
import { activityScreenStyles as s } from './activityScreenStyles';

function toneIconProps(item: ActivityItem): {
  fill: string;
  border: string;
  content: React.ReactNode;
} {
  if (item.section === 'running') {
    return {
      fill: brandColors.activityCyan,
      border: brandColors.activityCyan,
      content: <Clock size={9} color={brandColors.white} />,
    };
  }
  if (item.tone === 'failed') {
    return {
      fill: brandColors.error,
      border: brandColors.error,
      content: <X size={9} color={brandColors.white} />,
    };
  }
  if (item.section === 'done') {
    return {
      fill: brandColors.activityDoneIcon,
      border: brandColors.activityLime,
      content: <Check size={9} color={brandColors.white} />,
    };
  }
  return {
    fill: brandColors.activityOrange,
    border: brandColors.activityOrange,
    content: <Text style={s.timelineIconText}>!</Text>,
  };
}

export function PartialFailureBanner({
  failedEndpointLabels,
  onRetry,
}: {
  failedEndpointLabels: string[];
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (failedEndpointLabels.length === 0) return null;
  return (
    <View style={s.partialFailure}>
      <Text style={s.partialFailureText}>
        {t('activity.partialFailed', { labels: failedEndpointLabels.join(', ') })}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry failed endpoints"
      >
        <Text style={s.partialFailureRetry}>{t('activity.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function DecisionBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const { t } = useTranslation();
  const bannerText =
    count === 1
      ? t('activity.decisionBannerSingular', { count })
      : t('activity.decisionBannerPlural', { count });
  return (
    <TouchableOpacity
      style={s.decisionBanner}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={bannerText}
    >
      <View style={s.alarmCircle}>
        <AlarmClock size={18} color={brandColors.ink} />
      </View>
      <View style={s.bannerCopy}>
        <Text style={s.bannerTitle}>{bannerText}</Text>
        <Text style={s.bannerSub}>Your input is needed to keep things moving.</Text>
      </View>
      <View style={s.reviewPill}>
        <Text style={s.reviewPillText}>Review</Text>
        <ChevronRight size={12} color={brandColors.white} />
      </View>
    </TouchableOpacity>
  );
}

export function ActivityRow({
  item,
  isFirst,
  isLast,
  onOpenItem,
  onDeleteItem,
  openSwipeableRef,
  swipeableRefs,
}: {
  item: ActivityItem;
  isFirst: boolean;
  isLast: boolean;
  onOpenItem: (item: ActivityItem) => void;
  onDeleteItem?: (item: ActivityItem) => void;
  openSwipeableRef: React.MutableRefObject<Swipeable | null>;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable>>;
}) {
  const icon = toneIconProps(item);
  const tag = tagStyle(item);
  const isUnreadDone = item.section === 'done' && item.readAt == null;
  const contextName = item.workflowName
    ? `${item.projectName} · ${item.workflowName}`
    : item.projectName;
  const displayName =
    item.resourceName && item.resourceName !== item.projectName
      ? `${contextName} · ${item.resourceName}`
      : contextName;
  const subBg = item.section === 'done' ? 'rgba(250,255,239,0.88)' : 'rgba(255,252,247,0.78)';

  const renderDeleteAction = () => (
    <TouchableOpacity
      style={s.deleteAction}
      onPress={() => onDeleteItem?.(item)}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${item.title}`}
    >
      <Text style={s.deleteText}>DELETE</Text>
    </TouchableOpacity>
  );

  return (
    <View style={s.timelineRow}>
      <View style={s.timelineCol}>
        {!isFirst && <View style={s.timelineLineTop} />}
        <View style={[s.timelineIconOuter, { borderColor: icon.border }]}>
          <View style={[s.timelineIconFill, { backgroundColor: icon.fill }]}>{icon.content}</View>
        </View>
        {!isLast && <View style={s.timelineLineBottom} />}
      </View>

      <View style={s.cardWrapper}>
        <Swipeable
          ref={(ref) => {
            if (ref) swipeableRefs.current.set(item.id, ref);
            else swipeableRefs.current.delete(item.id);
          }}
          onSwipeableOpen={() => {
            if (openSwipeableRef.current) openSwipeableRef.current.close();
            openSwipeableRef.current = swipeableRefs.current.get(item.id) ?? null;
          }}
          renderRightActions={renderDeleteAction}
          overshootRight={false}
        >
          <TouchableOpacity
            onPress={() => onOpenItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            activeOpacity={0.85}
          >
            <View style={[s.card, { marginBottom: isLast ? 0 : 10 }]}>
              <View style={[s.cardStrip, { backgroundColor: icon.border }]} />
              <View style={s.cardInner}>
                <View style={s.cardHeader}>
                  <Text
                    style={[s.cardTitle, isUnreadDone && { fontWeight: '800' }]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <View style={s.cardMeta}>
                    <Text style={s.cardTime}>{formatRelativeTime(item.timestamp)}</Text>
                    <View style={[s.tagBadge, { backgroundColor: tag.bg }]}>
                      <Text style={[s.tagText, { color: tag.color }]} numberOfLines={1}>
                        {item.statusLabel}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={s.cardAgent}>
                  <Bot size={10} color="#45464a" />
                  <Text style={s.cardAgentName} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>

                {!!item.subtitle && (
                  <View style={[s.subPanel, { backgroundColor: subBg }]}>
                    <View style={s.subPanelInner}>
                      <Text style={s.subPanelText} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                      {item.section === 'attention' && (
                        <TouchableOpacity
                          style={s.subReviewBtn}
                          onPress={() => onOpenItem(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`Review ${item.title}`}
                        >
                          <Text style={s.subReviewText}>Review</Text>
                          <ChevronRight size={10} color={brandColors.ink} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </Swipeable>
      </View>
    </View>
  );
}
