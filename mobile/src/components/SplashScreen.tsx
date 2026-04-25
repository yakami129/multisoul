import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// ─── ASCII art ────────────────────────────────────────────────────────────────

const ART_SM = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⡶⠶⠶⢶⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠘⠛⠛⠛⠛⢻⡿⠁⣠⣤⣤⣄⠈⢿⡟⠛⠛⠛⠛⠃⠀⠀⠀⠀',
  '⠶⠶⠶⠶⠶⠶⠶⠶⠶⢾⡁⠀⣿⣿⣿⣿⠀⢨⡷⠶⠶⠶⠶⠶⠶⠶⠶⠶',
  '⠀⠀⠀⠀⢤⣴⣶⣶⣶⣾⣷⡀⠙⠛⠛⠋⢀⣾⣷⣶⣶⣶⣦⡤⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⠷⠶⠶⠾⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
];

const ART_MD = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⡿⣷⣤⡾⠟⠻⠿⠛⠉⠻⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣿⣇⣀⣠⠷⢶⣄⣠⣤⡀⠀⠈⠻⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⡏⠉⠀⢀⡤⠈⠉⠙⢷⣄⣀⣀⠻⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⡟⣽⡿⠆⢠⡟⠀⢀⡀⠀⠈⠁⠈⣹⠀⢿⡆⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⡿⠀⠉⢡⡴⠋⠀⢺⣿⠙⠂⠀⢠⣿⡉⢀⣾⠃⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣧⣦⠀⠸⠷⠀⠀⠘⠋⠀⠀⠀⣸⣿⣿⣾⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⡟⠻⣝⡓⠶⠤⠤⣿⡄⠀⠀⠈⠛⢽⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⡀⠸⠿⠓⠒⠋⠛⠁⠀⠀⣀⣀⣼⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⢀⣤⣶⠶⢶⣤⣤⣄⠀⠀⠀⠀⠀⠀⠀⣠⣴⡾⠟⠛⢳⣾⣿⣄⡀⠀⠀⠀⢀⣠⣴⣿⡛⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⣸⡟⠻⠷⠶⣦⣤⣽⣿⡇⠀⠀⠀⠀⢀⣼⠟⠁⠀⠀⠀⠘⠳⣤⠙⢿⣶⣂⣀⣽⢿⣩⠿⠙⢿⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⣰⣿⣄⣀⣀⠀⠀⣿⠃⣿⡇⠀⠀⠀⠀⣾⠏⠀⠀⠀⠀⠀⠀⢠⡿⠀⠀⠀⠀⣴⠟⠋⠀⠀⠀⠀⠈⠻⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⣸⠟⣻⠁⠀⢹⣿⣿⣷⢾⣿⡆⠀⠀⠀⠀⣿⠀⠀⢠⡄⠀⠀⠀⣾⠁⠀⠀⠀⢰⠏⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣧⡀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⢸⡟⢠⡇⠀⠀⣾⡇⢙⣿⠟⠋⠀⠀⠀⠀⠀⣿⣀⡀⢸⡇⠀⠀⢠⡇⠀⠀⠀⠀⣼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣷⡄⠀⠀⠀⠀⠀⠀',
  '⢀⣿⠃⡾⠁⠀⢰⣿⠁⣽⡿⠿⣦⣤⣶⢶⣶⣾⣯⡉⠙⠟⣷⠀⠀⣾⠁⠀⠀⠀⢀⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⡆⠀⠀⠀⠀⠀',
  '⢸⣷⣠⠇⠀⠀⣾⠏⢀⣿⠻⠶⣶⡟⢀⡏⢰⠏⣿⢿⣄⡀⢸⡆⠀⡟⠀⠀⠀⠀⢸⡇⠀⠀⠀⠀⠀⠘⢷⣦⡀⠀⠀⠀⠀⠈⣿⡄⠀⠀⠀⠀',
  '⢀⣾⢿⣤⣀⣼⡿⣦⣼⠇⠀⠀⠘⢿⣭⢡⣼⡀⢻⣦⣄⣉⣛⠛⠿⠧⣄⣀⡀⠀⠸⣇⣀⣀⣀⣀⣀⣠⡿⠉⠻⣦⡀⠀⠀⠀⢸⣿⠀⠀⠀⠀',
  '⢸⣏⠀⠀⠉⠙⢣⣿⠀⠀⠀⠀⠀⠀⠛⠛⠛⠛⠛⠛⠛⠋⢻⣿⠳⠦⢤⣄⣉⡙⠲⠦⠤⣀⣀⠀⠀⣾⠇⠀⠀⠹⣷⡀⠀⠀⠀⢻⡄⠀⠀⠀',
  '⠈⠛⠻⠷⣶⣤⣾⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡟⠀⠀⠀⠈⠉⠙⠓⠶⢦⣤⣉⡙⠒⠻⣶⣤⣤⣀⣽⣷⣤⣤⠶⠻⣧⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡾⠛⠓⠶⠦⣤⣤⣤⣤⣤⣤⣤⠼⠿⠛⣿⣶⣤⣭⣝⡙⢺⡆⠀⠀⠀⣿⡀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⡿⠁⠀⠀⠀⠀⠀⠀⡀⠀⠀⠀⠀⠀⠀⠀⠘⣿⡄⠈⠹⣿⠛⣡⠄⣀⣴⣟⡻⣷⡀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⡟⠀⠀⠀⠀⠀⠀⠀⠀⢻⡀⠀⠀⠀⠀⠀⠀⠀⠘⣷⡀⠀⠙⠛⠛⠛⠛⠋⠛⠛⠋⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡿⠀⠀⠀⠀⠀⠀⠀⢀⣴⡟⢿⣄⠀⠀⠀⠀⠀⠀⠀⢹⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠇⠀⠀⠀⠀⠀⠀⢠⡾⠋⠀⠈⢻⣆⠀⠀⠀⠀⠀⠀⠀⢹⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠀⠀⠀⠀⠀⠀⢠⡿⠁⠀⠀⠀⠀⠻⣧⠀⠀⠀⠀⠀⠀⠘⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠀⠀⠀⠀⠀⠀⣸⡇⠀⠀⠀⠀⠀⠀⢻⣧⠀⠀⠀⠀⠀⠀⢿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⡄⠀⠀⠀⠀⠀⣿⠁⠀⠀⠀⠀⠀⠀⠀⢻⣧⠀⠀⠀⠀⠀⢸⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣧⠀⠀⠀⠀⣀⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣧⠀⠀⠀⠀⠸⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⡶⠛⠛⢒⣿⣯⣭⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠻⣷⠖⠒⠒⠛⢿⡄⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠶⠾⠿⠛⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⢷⣤⣀⣴⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
];

const POOL = '⠿⠾⣿⣾⢿⡿⣻⢻⡻⠻⣽⢽⡽⠽⣺⢺⡺⠺⣹⢹⡹⠹⣸⢸⡸⢰⡰⠰⣯⢯⡯⣮⢮⡮░▒▓█▄▀■□▪';

const BOOT_LINES = [
  'VAULT-TEC INDUSTRIES  ─  MULTISOUL v1.0.0',
  'ROBCO CERTIFIED OPERATING SYSTEM 7',
  '──────────────────────────────────────────',
  'INITIALIZING AGENT REGISTRY...      [ OK ]',
  'ENCRYPTION MODULE (AES-256-GCM)...  [ OK ]',
  'AUTHENTICATION SERVICE...           [ OK ]',
  'DATABASE CONNECTION POOL...         [ OK ]',
  '──────────────────────────────────────────',
];

function scrambleLine(source: string): string {
  return [...source]
    .map((ch) => (ch === ' ' || ch === '⠀' ? ch : POOL[Math.floor(Math.random() * POOL.length)]))
    .join('');
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
}

type Phase = 'scan' | 'brand' | 'boot' | 'progress' | 'ready' | 'exit';

export function SplashScreen({ onComplete }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const art = screenWidth >= 340 ? ART_MD : ART_SM;

  const rootOpacity = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandOffsetX = useRef(new Animated.Value(0)).current;
  const readyOpacity = useRef(new Animated.Value(0)).current;

  const [rows, setRows] = useState<(string | null)[]>(() => art.map(() => null));
  const [activeRow, setActiveRow] = useState(-1);
  const [phase, setPhase] = useState<Phase>('scan');
  const [bootCount, setBootCount] = useState(0);
  const [showProgress, setShowProgress] = useState(false);

  const scanRowRef = useRef(0);
  const scrambleTickRef = useRef(0);
  const SCRAMBLE_TICKS = 3;

  const glitchBrand = useCallback(() => {
    const glitchOffsets = [8, -6, 4, -3, 0];
    let i = 0;
    const fire = () => {
      if (i >= glitchOffsets.length) return;
      brandOffsetX.setValue(glitchOffsets[i]);
      i++;
      setTimeout(fire, 60);
    };
    Animated.timing(brandOpacity, { toValue: 1, duration: 80, useNativeDriver: true }).start(fire);
  }, [brandOpacity, brandOffsetX]);

  useEffect(() => {
    Animated.timing(rootOpacity, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();

    let interval: ReturnType<typeof setInterval> | null = null;
    const startDelay = setTimeout(() => {
      interval = setInterval(() => {
        const row = scanRowRef.current;
        const tick = scrambleTickRef.current;

        if (row >= art.length) {
          if (interval) clearInterval(interval);
          interval = null;
          setActiveRow(-1);
          setPhase('brand');
          return;
        }

        if (tick < SCRAMBLE_TICKS) {
          setRows((prev) => {
            const next = [...prev];
            next[row] = scrambleLine(art[row]);
            return next;
          });
          setActiveRow(row);
          scrambleTickRef.current += 1;
        } else {
          setRows((prev) => {
            const next = [...prev];
            next[row] = art[row];
            return next;
          });
          scanRowRef.current += 1;
          scrambleTickRef.current = 0;
        }
      }, 32);
    }, 200);

    return () => {
      clearTimeout(startDelay);
      if (interval) clearInterval(interval);
    };
  }, [art, rootOpacity]);

  useEffect(() => {
    if (phase !== 'brand') return;
    glitchBrand();
    const t = setTimeout(() => setPhase('boot'), 500);
    return () => clearTimeout(t);
  }, [phase, glitchBrand]);

  useEffect(() => {
    if (phase !== 'boot') return;
    let idx = 0;
    const t = setInterval(() => {
      idx += 1;
      setBootCount(idx);
      if (idx >= BOOT_LINES.length) {
        clearInterval(t);
        setShowProgress(true);
        setPhase('progress');
      }
    }, 70);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'progress') return;
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: false,
    }).start(() => setPhase('ready'));
  }, [phase, progressAnim]);

  useEffect(() => {
    if (phase !== 'ready') return;
    Animated.sequence([
      Animated.timing(readyOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(readyOpacity, { toValue: 0.15, duration: 280, useNativeDriver: true }),
          Animated.timing(readyOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        ]),
        { iterations: 4 }
      ),
    ]).start(() => setPhase('exit'));
  }, [phase, readyOpacity]);

  useEffect(() => {
    if (phase !== 'exit') return;
    Animated.timing(exitOpacity, {
      toValue: 0,
      duration: 450,
      useNativeDriver: true,
    }).start(() => onComplete());
  }, [phase, exitOpacity, onComplete]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View style={[s.root, { opacity: Animated.multiply(rootOpacity, exitOpacity) }]}>
      <Text style={s.corner} allowFontScaling={false}>
        ┌{' ─'.repeat(6)}
      </Text>
      <Text style={[s.corner, s.cornerTR]} allowFontScaling={false}>
        {'─ '.repeat(6)}┐
      </Text>
      <Text style={[s.corner, s.cornerBL]} allowFontScaling={false}>
        └{' ─'.repeat(6)}
      </Text>
      <Text style={[s.corner, s.cornerBR]} allowFontScaling={false}>
        {'─ '.repeat(6)}┘
      </Text>

      <View style={s.artWrap}>
        {rows.map((row, i) => {
          if (row === null) {
            return (
              <Text key={i} style={s.artHidden} allowFontScaling={false}>
                {' '}
              </Text>
            );
          }
          const isBeam = i === activeRow;
          return (
            <Text key={i} style={[s.artLine, isBeam && s.artBeam]} allowFontScaling={false}>
              {row}
            </Text>
          );
        })}
      </View>

      {phase !== 'scan' && (
        <Animated.View
          style={[
            s.brandWrap,
            { opacity: brandOpacity, transform: [{ translateX: brandOffsetX }] },
          ]}
        >
          <Text style={s.brandTitle} allowFontScaling={false}>
            MULTISOUL
          </Text>
          <Text style={s.brandSub} allowFontScaling={false}>
            AGENT REGISTRY PLATFORM
          </Text>
        </Animated.View>
      )}

      {bootCount > 0 && (
        <View style={s.bootWrap}>
          {BOOT_LINES.slice(0, bootCount).map((line, i) => (
            <Text
              key={i}
              style={[
                s.bootLine,
                line.startsWith('─') && s.bootDivider,
                (line.startsWith('VAULT') || line.startsWith('ROBCO')) && s.bootHeader,
                line.includes('[ OK ]') && s.bootOk,
              ]}
              allowFontScaling={false}
            >
              {line}
            </Text>
          ))}
          {bootCount < BOOT_LINES.length && (
            <Text style={s.cursor} allowFontScaling={false}>
              █
            </Text>
          )}
        </View>
      )}

      {showProgress && (
        <View style={s.progressWrap}>
          <View style={s.progressTrack}>
            <Animated.View style={[s.progressFill, { width: progressWidth }]} />
            <Animated.View style={[s.progressGlow, { width: progressWidth }]} />
          </View>
          <Text style={s.progressLabel} allowFontScaling={false}>
            LOADING SYSTEM
          </Text>
        </View>
      )}

      <Animated.Text style={[s.readyText, { opacity: readyOpacity }]} allowFontScaling={false}>
        *** SYSTEM READY ***
      </Animated.Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040D04',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  corner: {
    position: 'absolute',
    top: 52,
    left: 10,
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#0F2B0F',
  },
  cornerTR: { top: 52, left: undefined, right: 10 },
  cornerBL: { top: undefined, bottom: 52, left: 10 },
  cornerBR: { top: undefined, bottom: 52, left: undefined, right: 10 },
  artWrap: {
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  artLine: {
    fontFamily: 'Geist Mono',
    fontSize: 8,
    color: '#20C20E',
    lineHeight: 10,
    letterSpacing: 0,
  },
  artBeam: {
    color: '#AFFFAF',
    textShadowColor: '#33FF3399',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  artHidden: {
    fontFamily: 'Geist Mono',
    fontSize: 8,
    lineHeight: 10,
    color: 'transparent',
  },
  brandWrap: {
    alignItems: 'center',
    marginBottom: 18,
    gap: 4,
  },
  brandTitle: {
    fontFamily: 'Anton',
    fontSize: 38,
    color: '#33FF33',
    letterSpacing: 7,
    textShadowColor: '#20C20E99',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  brandSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
    letterSpacing: 3.5,
  },
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
  bootLine: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#147A16',
    lineHeight: 15,
  },
  bootDivider: { color: '#0F2B0F' },
  bootHeader: { color: '#2D8B2D' },
  bootOk: { color: '#20C20E' },
  cursor: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    color: '#33FF33',
    lineHeight: 15,
  },
  progressWrap: {
    width: '100%',
    gap: 5,
    alignItems: 'center',
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
  progressLabel: {
    fontFamily: 'Inter',
    fontSize: 9,
    color: '#0F6B0F',
    letterSpacing: 2.5,
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
