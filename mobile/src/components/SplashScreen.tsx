import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// ─── Glyph pools ──────────────────────────────────────────────────────────────

const HEX = '0123456789ABCDEF';
const BRAILLE =
  '⠿⠾⣿⣾⢿⡿⣻⢻⡻⠻⣽⢽⡽⠽⣺⢺⡺⠺⣹⢹⡹⠹⣸⢸⡸⢰⡰⠰⣯⢯⡯⣮⢮⡮';
const BLOCKS = '░▒▓█▄▀■□▪';

const pick = (s: string) => s[Math.floor(Math.random() * s.length)];

// Sparse static — most cells empty, with occasional glyph for a "signal noise" feel
function noiseLine(source: string): string {
  return [...source]
    .map((ch) => {
      if (ch === ' ' || ch === '⠀') return ch;
      const r = Math.random();
      if (r < 0.55) return '⠀';
      if (r < 0.85) return pick(BRAILLE);
      if (r < 0.97) return pick(HEX);
      return pick(BLOCKS);
    })
    .join('');
}

// Partial decode — rate% correct chars, rest are random braille (signal-lock effect)
function partialDecode(source: string, rate: number): string {
  return [...source]
    .map((ch) => {
      if (ch === ' ' || ch === '⠀') return ch;
      return Math.random() < rate ? ch : pick(BRAILLE);
    })
    .join('');
}

function randomHexAddr(): string {
  let a = '';
  for (let i = 0; i < 8; i++) a += pick(HEX);
  return `0x${a.slice(0, 4)}_${a.slice(4)}`;
}

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

// ─── Boot lines (Pip-Boy / RobCo TermLink flavor) ─────────────────────────────

const BOOT_LINES = [
  '[0.001] ROBCO TERMLINK ░ RIT V2.1.5 KERNEL UP',
  '[0.014] VAULT-TEC BIOS 7.04 // KRN 0xA77F4C',
  '[0.029] MMAP 0x4F0C_A300 → 0x4F0F_FFFF  [ OK ]',
  '[0.041] HOLOTAPE MOUNT /dev/vault/0...... OK',
  '──────────────────────────────────────────',
  '[0.082] daemon: agent-registry  ▓▓▓▓▓▓▓▓ UP',
  '[0.108] daemon: cipher.aes-gcm  ▓▓▓▓▓▓▓▓ UP',
  '[0.137] daemon: auth.handshake  ░ RETRY 1/3',
  '[0.149] daemon: auth.handshake  ░ PID 1337 UP',
  '[0.187] ICE-BREAKER  CHL 0x4FA7 ░░░░░░░ ACK',
  '[0.214] BIO-ID SCAN  ▓▓▓▓▓▓▓▓░░ MATCH 99.7%',
  '[0.246] G.E.C.K. INTEGRITY ░ CRC 0xC0DECAFE',
  '──────────────────────────────────────────',
  '[0.301] NEURAL UPLINK ESTABLISHED ░ CRC OK',
  '[0.318] >>> WELCOME, DWELLER 111',
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
}

type Phase = 'scan' | 'brand' | 'boot' | 'progress' | 'ready' | 'exit';
type RowState = 'pending' | 'active' | 'decoded';

const SCAN_TICK_MS = 30;
const NOISE_INTERVAL_MS = 180;

export function SplashScreen({ onComplete }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const art = screenWidth >= 340 ? ART_MD : ART_SM;

  const rootOpacity = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const readyOpacity = useRef(new Animated.Value(0)).current;
  const beamOpacity = useRef(new Animated.Value(0.4)).current;
  const headerCursorOpacity = useRef(new Animated.Value(1)).current;

  const [rows, setRows] = useState<string[]>(() => art.map((line) => noiseLine(line)));
  const [scanRow, setScanRow] = useState(0);
  const [phase, setPhase] = useState<Phase>('scan');
  const [bootCount, setBootCount] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [hexAddr, setHexAddr] = useState(() => randomHexAddr());
  const [progressPct, setProgressPct] = useState(0);

  const scanRowRef = useRef(0);
  const scanTickRef = useRef(0);

  const getRowState = useCallback(
    (i: number, current: number): RowState => {
      if (phase !== 'scan') return 'decoded';
      if (i < current) return 'decoded';
      if (i === current && current < art.length) return 'active';
      return 'pending';
    },
    [phase, art.length]
  );

  // Root fade-in
  useEffect(() => {
    Animated.timing(rootOpacity, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [rootOpacity]);

  // Header cursor blink
  useEffect(() => {
    if (phase !== 'scan') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(headerCursorOpacity, { toValue: 0.1, duration: 320, useNativeDriver: true }),
        Animated.timing(headerCursorOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, headerCursorOpacity]);

  // Scan-beam glow pulse
  useEffect(() => {
    if (phase !== 'scan') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beamOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.timing(beamOpacity, { toValue: 0.5, duration: 380, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, beamOpacity]);

  // ── Scan loop: row-by-row decode + background noise ───────────────────────
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let noiseInterval: ReturnType<typeof setInterval> | null = null;

    const startDelay = setTimeout(() => {
      // Background noise on pending rows (re-noise random pending rows for live signal feel)
      noiseInterval = setInterval(() => {
        const start = scanRowRef.current + 1;
        const remaining = art.length - start;
        if (remaining <= 0) return;
        const count = Math.min(2, remaining);
        const targets: number[] = [];
        for (let k = 0; k < count; k++) {
          targets.push(start + Math.floor(Math.random() * remaining));
        }
        setRows((prev) => {
          const next = [...prev];
          for (const i of targets) next[i] = noiseLine(art[i]);
          return next;
        });
      }, NOISE_INTERVAL_MS);

      // Sequential row decode
      interval = setInterval(() => {
        const row = scanRowRef.current;
        const tick = scanTickRef.current;

        if (row >= art.length) {
          if (interval) clearInterval(interval);
          if (noiseInterval) clearInterval(noiseInterval);
          interval = null;
          noiseInterval = null;
          setPhase('brand');
          return;
        }

        // Live hex address rotation (terminal "ticking" feel)
        setHexAddr(randomHexAddr());

        if (tick === 0) {
          setRows((prev) => {
            const next = [...prev];
            next[row] = partialDecode(art[row], 0.4);
            return next;
          });
          setScanRow(row);
          scanTickRef.current = 1;
        } else if (tick === 1) {
          setRows((prev) => {
            const next = [...prev];
            next[row] = partialDecode(art[row], 0.75);
            return next;
          });
          scanTickRef.current = 2;
        } else {
          setRows((prev) => {
            const next = [...prev];
            next[row] = art[row];
            return next;
          });
          scanRowRef.current = row + 1;
          setScanRow(row + 1);
          scanTickRef.current = 0;
        }
      }, SCAN_TICK_MS);
    }, 200);

    return () => {
      clearTimeout(startDelay);
      if (interval) clearInterval(interval);
      if (noiseInterval) clearInterval(noiseInterval);
    };
  }, [art]);

  useEffect(() => {
    if (phase !== 'brand') return;
    Animated.timing(brandOpacity, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => setPhase('boot'), 620);
    return () => clearTimeout(t);
  }, [phase, brandOpacity]);

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
    }, 65);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'progress') return;
    progressAnim.setValue(0);
    const id = progressAnim.addListener(({ value }) => {
      setProgressPct(Math.floor(value * 100));
    });
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 900,
      useNativeDriver: false,
    }).start(() => {
      progressAnim.removeListener(id);
      setProgressPct(100);
      setPhase('ready');
    });
    return () => progressAnim.removeListener(id);
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

  // Live decryption telemetry
  const decodePct = Math.min(100, Math.floor((scanRow / art.length) * 100));
  const total = art.length;
  const beamRow = phase === 'scan' && scanRow < total ? scanRow : -1;

  const padPct = (n: number) => String(n).padStart(3, ' ');
  const hexRow = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

  return (
    <Animated.View style={[s.root, { opacity: Animated.multiply(rootOpacity, exitOpacity) }]}>
      {/* Corners */}
      <Text style={s.cornerTL} allowFontScaling={false}>┌{' ─'.repeat(6)}</Text>
      <Text style={s.cornerTR} allowFontScaling={false}>{'─ '.repeat(6)}┐</Text>
      <Text style={s.cornerBL} allowFontScaling={false}>└{' ─'.repeat(6)}</Text>
      <Text style={s.cornerBR} allowFontScaling={false}>{'─ '.repeat(6)}┘</Text>

      {/* Stamps */}
      <Text style={s.stampTL} allowFontScaling={false}>
        VAULT 111 // ROBCO TERMLINK
      </Text>
      <Text style={s.stampTR} allowFontScaling={false}>
        [ CLASSIFIED ]
      </Text>

      {/* Decryption telemetry header */}
      {phase === 'scan' && (
        <View style={s.scanHeader}>
          <View style={s.scanHeaderRow}>
            <Animated.Text
              style={[s.scanHeaderCursor, { opacity: headerCursorOpacity }]}
              allowFontScaling={false}
            >
              ▶
            </Animated.Text>
            <Text style={s.scanHeaderText} allowFontScaling={false}>
              {`DECRYPT  ${hexAddr}  ░  ${hexRow(scanRow)}/${hexRow(total)}  ░  ${padPct(decodePct)}%`}
            </Text>
          </View>
        </View>
      )}

      {/* ASCII art with row-state coloring + scan-beam arrow */}
      <View style={s.artWrap}>
        {rows.map((row, i) => {
          const state = getRowState(i, scanRow);
          const style = [
            s.artLine,
            state === 'pending' && s.artPending,
            state === 'active' && s.artActive,
            state === 'decoded' && s.artDecoded,
          ];
          return (
            <Text key={i} style={style} allowFontScaling={false}>
              {row}
            </Text>
          );
        })}
        {beamRow >= 0 && (
          <Animated.Text
            style={[s.beamArrow, { top: beamRow * 10, opacity: beamOpacity }]}
            allowFontScaling={false}
          >
            ▶
          </Animated.Text>
        )}
      </View>

      {/* Authentication footer (only during scan) */}
      {phase === 'scan' && (
        <Text style={s.footerStamp} allowFontScaling={false}>
          // VAULT-TEC INDUSTRIES ─ AUTHENTICATED
        </Text>
      )}

      {/* Brand */}
      {phase !== 'scan' && (
        <Animated.View style={[s.brandWrap, { opacity: brandOpacity }]}>
          <Text style={s.brandEyebrow} allowFontScaling={false}>
            VAULT-TEC ░ AGENT NETWORK
          </Text>
          <Text style={s.brandTitle} allowFontScaling={false}>
            MULTISOUL
          </Text>
          <Text style={s.brandSub} allowFontScaling={false}>
            AGENT REGISTRY PLATFORM
          </Text>
        </Animated.View>
      )}

      {/* Boot log */}
      {bootCount > 0 && (
        <View style={s.bootWrap}>
          <Text style={s.bootHeading} allowFontScaling={false}>
            ░░ SYS.LOG  STREAM 0xA77F4C  PID 0001 ░░
          </Text>
          {BOOT_LINES.slice(0, bootCount).map((line, i) => {
            const hasUp = / UP$/.test(line) || line.includes('[ OK ]') || line.endsWith(' OK');
            const hasAck = line.includes(' ACK') || line.includes('MATCH');
            const hasRetry = line.includes('RETRY') || line.includes('FAIL');
            const hasHero = line.includes('>>>');
            const hasHex = line.includes('0x');
            return (
              <Text
                key={i}
                style={[
                  s.bootLine,
                  line.startsWith('─') && s.bootDivider,
                  hasHex && s.bootHex,
                  (hasUp || hasAck) && s.bootOk,
                  hasRetry && s.bootWarn,
                  line.startsWith('[0.001]') && s.bootHeaderLine,
                  line.startsWith('[0.301]') && s.bootOk,
                  hasHero && s.bootHero,
                ]}
                allowFontScaling={false}
              >
                {line}
              </Text>
            );
          })}
          {bootCount < BOOT_LINES.length && (
            <Text style={s.cursor} allowFontScaling={false}>█</Text>
          )}
        </View>
      )}

      {/* Progress bar with live percentage */}
      {showProgress && (
        <View style={s.progressWrap}>
          <View style={s.progressTrack}>
            <Animated.View style={[s.progressFill, { width: progressWidth }]} />
            <Animated.View style={[s.progressGlow, { width: progressWidth }]} />
          </View>
          <View style={s.progressMeta}>
            <Text style={s.progressLabel} allowFontScaling={false}>
              LOADING SYSTEM
            </Text>
            <Text style={s.progressPct} allowFontScaling={false}>
              {`${progressPct}%`}
            </Text>
          </View>
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
