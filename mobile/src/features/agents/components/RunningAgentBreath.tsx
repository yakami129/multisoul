import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

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

  useEffect(() => {
    if (!enabled || reducedMotion) {
      breath.stopAnimation();
      breath.setValue(0);
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
    breathLoop.start();

    return () => {
      breathLoop.stop();
    };
  }, [breath, enabled, reducedMotion]);

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

  const washOpacity = breathingStyle(breath, [0, 0.58, 1], [0.08, 0.16, 0.1]);
  const frameOpacity = breathingStyle(breath, [0, 1], [0.18, 0.3]);

  return (
    <View pointerEvents="none" style={s.root} testID="running-agent-breath">
      <Animated.View
        testID="running-agent-liquid-wash"
        style={[
          s.liquidWash,
          {
            backgroundColor: accentColor,
            opacity: washOpacity,
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
  liquidFrame: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderWidth: 1,
    borderRadius: 13,
  },
  liquidWash: {
    position: 'absolute',
    top: -4,
    right: -4,
    bottom: -4,
    left: -4,
    borderRadius: 18,
  },
});
