import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, useWindowDimensions, View } from 'react-native';
import { splashScreenStyles as s } from './splashScreenStyles';

interface Props {
  onComplete: () => void;
}

function lensPlaneStyle(value: Animated.Value, screenWidth: number) {
  return {
    opacity: value.interpolate({
      inputRange: [0, 0.38, 1, 2],
      outputRange: [0, 0.58, 1, 1],
    }),
    transform: [
      { rotate: '-18deg' },
      {
        translateX: value.interpolate({
          inputRange: [0, 1, 2],
          outputRange: [-screenWidth * 1.07, 0, screenWidth * 0.47],
        }),
      },
    ],
  };
}

function revealStyle(value: Animated.Value) {
  return {
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };
}

export function SplashScreen({ onComplete }: Props) {
  const { height, width } = useWindowDimensions();
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const lensA = useRef(new Animated.Value(0)).current;
  const lensB = useRef(new Animated.Value(0)).current;
  const lensC = useRef(new Animated.Value(0)).current;
  const chip = useRef(new Animated.Value(0)).current;
  const chipBreath = useRef(new Animated.Value(0)).current;
  const eyebrow = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const ready = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    const lensToCenter = (value: Animated.Value, delay: number) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 700,
        delay,
        easing: Easing.out(Easing.poly(3)),
        useNativeDriver: true,
      });

    const lensSweep = (value: Animated.Value) =>
      Animated.timing(value, {
        toValue: 2,
        duration: 700,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });

    const reveal = (value: Animated.Value) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.poly(3)),
        useNativeDriver: true,
      });

    const animation = Animated.sequence([
      Animated.parallel([
        lensToCenter(lensA, 0),
        lensToCenter(lensB, 80),
        lensToCenter(lensC, 160),
      ]),
      Animated.parallel([
        lensSweep(lensA),
        lensSweep(lensB),
        lensSweep(lensC),
        Animated.sequence([
          Animated.delay(100),
          Animated.timing(chip, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(300),
          Animated.stagger(80, [reveal(eyebrow), reveal(title), reveal(ready)]),
        ]),
        Animated.sequence([
          Animated.delay(800),
          Animated.timing(chipBreath, {
            toValue: 1,
            duration: 340,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(chipBreath, {
            toValue: 0,
            duration: 340,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(exitOpacity, {
        toValue: 0,
        duration: 280,
        easing: Easing.in(Easing.poly(3)),
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
  }, [chip, chipBreath, eyebrow, exitOpacity, lensA, lensB, lensC, onComplete, ready, title]);

  const chipScale = chip.interpolate({
    inputRange: [0, 1],
    outputRange: [0.78, 1],
  });
  const chipRotate = chip.interpolate({
    inputRange: [0, 1],
    outputRange: ['-8deg', '0deg'],
  });
  const chipBreathScale = chipBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.96],
  });
  const stripeTopA = height * 0.225;
  const stripeTopB = height * 0.377;
  const stripeTopC = height * 0.528;

  return (
    <Animated.View style={[s.root, { opacity: exitOpacity }]}>
      <View style={s.lensField} pointerEvents="none">
        <Animated.View style={[s.lensPlane, { top: stripeTopA }, lensPlaneStyle(lensA, width)]} />
        <Animated.View style={[s.lensPlane, { top: stripeTopB }, lensPlaneStyle(lensB, width)]} />
        <Animated.View style={[s.lensPlane, { top: stripeTopC }, lensPlaneStyle(lensC, width)]} />
      </View>

      <View style={s.lockup}>
        <Animated.View
          style={[
            s.chip,
            {
              opacity: chip,
              transform: [{ scale: chipScale }, { rotate: chipRotate }, { scale: chipBreathScale }],
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
              opacity: exitOpacity,
            },
          ]}
        >
          <Animated.Text style={[s.eyebrow, revealStyle(eyebrow)]} allowFontScaling={false}>
            PERSONAL AI CONSOLE
          </Animated.Text>
          <Animated.Text style={[s.title, revealStyle(title)]} allowFontScaling={false}>
            MULTISOUL
          </Animated.Text>

          <Animated.View style={[s.readyPill, revealStyle(ready)]}>
            <Text style={s.readyText} allowFontScaling={false}>
              READY
            </Text>
          </Animated.View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
