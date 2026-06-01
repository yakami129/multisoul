import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const STATUS_GREEN = '#4CAF50';

interface Props {
  enabled: boolean;
  reducedMotion: boolean;
  accentColor: string;
}

function breathingStyle(value: Animated.Value, input: number[], output: number[]) {
  return value.interpolate({ inputRange: input, outputRange: output });
}

export function RunningAgentBreath({ enabled, reducedMotion, accentColor }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled || reducedMotion) {
      breath.stopAnimation();
      drift.stopAnimation();
      breath.setValue(0);
      drift.setValue(0);
      return;
    }

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    breathLoop.start();
    driftLoop.start();

    return () => {
      breathLoop.stop();
      driftLoop.stop();
    };
  }, [breath, drift, enabled, reducedMotion]);

  if (!enabled) {
    return null;
  }

  if (reducedMotion) {
    return (
      <View pointerEvents="none" style={s.root} testID="running-agent-breath">
        <View
          testID="running-agent-breath-static"
          style={[s.staticFrame, { borderColor: accentColor }]}
        />
      </View>
    );
  }

  const bandOpacity = breathingStyle(breath, [0, 0.58, 1], [0.1, 0.24, 0.14]);
  const bandScaleX = breathingStyle(breath, [0, 1], [0.88, 1.04]);
  const bandDriftX = breathingStyle(drift, [0, 1], [-16, 10]);
  const warmOpacity = breathingStyle(breath, [0, 0.5, 1], [0.08, 0.18, 0.1]);
  const warmScale = breathingStyle(breath, [0, 1], [0.92, 1.12]);
  const statusOpacity = breathingStyle(breath, [0, 0.62, 1], [0.08, 0.2, 0.11]);
  const statusScale = breathingStyle(breath, [0, 1], [0.9, 1.14]);
  const frameOpacity = breathingStyle(breath, [0, 1], [0.22, 0.42]);

  return (
    <View pointerEvents="none" style={s.root} testID="running-agent-breath">
      <Animated.View
        testID="running-agent-liquid-band"
        style={[
          s.liquidBand,
          {
            backgroundColor: accentColor,
            opacity: bandOpacity,
            transform: [{ translateX: bandDriftX }, { scaleX: bandScaleX }],
          },
        ]}
      />
      <Animated.View
        testID="running-agent-liquid-warm-pool"
        style={[
          s.warmPool,
          {
            backgroundColor: accentColor,
            opacity: warmOpacity,
            transform: [{ translateX: bandDriftX }, { scale: warmScale }],
          },
        ]}
      />
      <Animated.View
        testID="running-agent-liquid-status-pool"
        style={[
          s.statusPool,
          {
            backgroundColor: STATUS_GREEN,
            opacity: statusOpacity,
            transform: [{ scale: statusScale }],
          },
        ]}
      />
      <Animated.View
        testID="running-agent-liquid-frame"
        style={[s.liquidFrame, { borderColor: accentColor, opacity: frameOpacity }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 14,
    overflow: 'hidden',
  },
  staticFrame: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderWidth: 1,
    borderRadius: 13,
    opacity: 0.72,
  },
  liquidBand: {
    position: 'absolute',
    top: 8,
    right: -26,
    left: 44,
    height: 56,
    borderRadius: 28,
  },
  liquidFrame: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderWidth: 1,
    borderRadius: 13,
  },
  warmPool: {
    position: 'absolute',
    left: 28,
    top: 15,
    width: 64,
    height: 42,
    borderRadius: 21,
  },
  statusPool: {
    position: 'absolute',
    right: 24,
    top: 26,
    width: 36,
    height: 18,
    borderRadius: 9,
  },
});
