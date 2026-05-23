import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { splashScreenStyles as s } from './splashScreenStyles';

interface Props {
  onComplete: () => void;
}

function lensPlaneStyle(value: Animated.Value, distance: number) {
  return {
    opacity: value.interpolate({
      inputRange: [0, 0.28, 1],
      outputRange: [0, 0.58, 1],
    }),
    transform: [
      { rotate: '-18deg' },
      {
        translateX: value.interpolate({
          inputRange: [0, 1],
          outputRange: [-distance, 0],
        }),
      },
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [24, 0],
        }),
      },
    ],
  };
}

export function SplashScreen({ onComplete }: Props) {
  const rootOpacity = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const lensA = useRef(new Animated.Value(0)).current;
  const lensB = useRef(new Animated.Value(0)).current;
  const lensC = useRef(new Animated.Value(0)).current;
  const chip = useRef(new Animated.Value(0)).current;
  const copy = useRef(new Animated.Value(0)).current;
  const ready = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    const lensIn = (value: Animated.Value, delay: number) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 760,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    const animation = Animated.sequence([
      Animated.timing(rootOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.parallel([
        lensIn(lensA, 0),
        lensIn(lensB, 90),
        lensIn(lensC, 180),
        Animated.spring(chip, {
          toValue: 1,
          damping: 14,
          mass: 0.85,
          stiffness: 145,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(copy, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ready, {
          toValue: 1,
          duration: 360,
          delay: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(560),
      Animated.timing(exitOpacity, {
        toValue: 0,
        duration: 380,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished && !cancelled) {
        onComplete();
      }
    });

    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [chip, copy, exitOpacity, lensA, lensB, lensC, onComplete, ready, rootOpacity]);

  const chipScale = chip.interpolate({
    inputRange: [0, 1],
    outputRange: [0.78, 1],
  });
  const chipRotate = chip.interpolate({
    inputRange: [0, 1],
    outputRange: ['-8deg', '0deg'],
  });
  const copyTranslateY = copy.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });
  const readyScale = ready.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1],
  });

  return (
    <Animated.View
      style={[
        s.root,
        {
          opacity: Animated.multiply(rootOpacity, exitOpacity),
        },
      ]}
    >
      <View style={s.lensField} pointerEvents="none">
        <Animated.View style={[s.lensPlane, s.lensPlaneA, lensPlaneStyle(lensA, 320)]} />
        <Animated.View style={[s.lensPlane, s.lensPlaneB, lensPlaneStyle(lensB, 260)]} />
        <Animated.View style={[s.lensPlane, s.lensPlaneC, lensPlaneStyle(lensC, 220)]} />
      </View>

      <View style={s.lockup}>
        <Animated.View
          style={[
            s.chip,
            {
              opacity: chip,
              transform: [{ scale: chipScale }, { rotate: chipRotate }],
            },
          ]}
        >
          <Text style={s.chipText} allowFontScaling={false}>
            MS
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            s.copy,
            {
              opacity: copy,
              transform: [{ translateY: copyTranslateY }],
            },
          ]}
        >
          <Text style={s.eyebrow} allowFontScaling={false}>
            PERSONAL AI CONSOLE
          </Text>
          <Text style={s.title} allowFontScaling={false}>
            MULTISOUL
          </Text>

          <Animated.View
            style={[
              s.readyPill,
              {
                opacity: ready,
                transform: [{ scale: readyScale }],
              },
            ]}
          >
            <Text style={s.readyText} allowFontScaling={false}>
              READY
            </Text>
          </Animated.View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
