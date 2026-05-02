import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Text, View } from 'react-native';
import {
  ART_MD,
  ART_SM,
  BOOT_LINES,
  NOISE_INTERVAL_MS,
  SCAN_TICK_MS,
  noiseLine,
  partialDecode,
  randomHexAddr,
} from './splashScreenData';
import { splashScreenStyles as s } from './splashScreenStyles';

interface Props {
  onComplete: () => void;
}

type Phase = 'scan' | 'brand' | 'boot' | 'progress' | 'ready' | 'exit';
type RowState = 'pending' | 'active' | 'decoded';

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
  const [bootLine, setBootLine] = useState(0);
  const [bootChar, setBootChar] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [hexAddr, setHexAddr] = useState(() => randomHexAddr());
  const [progressPct, setProgressPct] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const bootBoxOpacity = useRef(new Animated.Value(0)).current;

  const scanRowRef = useRef(0);
  const scanTickRef = useRef(0);

  const getRowState = useCallback(
    (i: number, current: number): RowState => {
      if (phase !== 'scan') return 'decoded';
      if (i < current) return 'decoded';
      if (i === current && current < art.length) return 'active';
      return 'pending';
    },
    [phase, art.length],
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
        Animated.timing(headerCursorOpacity, {
          toValue: 0.1,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(headerCursorOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
      ]),
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
      ]),
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

  // Boot panel fade-in (box appears first, then typing begins)
  useEffect(() => {
    if (phase === 'scan' || phase === 'brand') return;
    Animated.timing(bootBoxOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [phase, bootBoxOpacity]);

  // Cursor blink — runs whenever the boot panel is visible
  useEffect(() => {
    if (phase === 'scan' || phase === 'brand') return;
    const id = setInterval(() => setCursorOn((v) => !v), 480);
    return () => clearInterval(id);
  }, [phase]);

  // Typewriter — char-by-char, holds box at full reserved height
  useEffect(() => {
    if (phase !== 'boot') return;
    let line = 0;
    let char = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    const startDelay = setTimeout(() => {
      interval = setInterval(() => {
        if (line >= BOOT_LINES.length) {
          if (interval) clearInterval(interval);
          interval = null;
          setShowProgress(true);
          setPhase('progress');
          return;
        }
        const text = BOOT_LINES[line];
        const next = Math.min(char + 6, text.length);
        setBootLine(line);
        setBootChar(next);
        if (next >= text.length) {
          line += 1;
          char = 0;
        } else {
          char = next;
        }
      }, 22);
    }, 320);
    return () => {
      clearTimeout(startDelay);
      if (interval) clearInterval(interval);
    };
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
        { iterations: 4 },
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
      <Text style={s.cornerTL} allowFontScaling={false}>
        ┌{' ─'.repeat(6)}
      </Text>
      <Text style={s.cornerTR} allowFontScaling={false}>
        {'─ '.repeat(6)}┐
      </Text>
      <Text style={s.cornerBL} allowFontScaling={false}>
        └{' ─'.repeat(6)}
      </Text>
      <Text style={s.cornerBR} allowFontScaling={false}>
        {'─ '.repeat(6)}┘
      </Text>

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

      {/* Boot log — panel renders at full reserved height first, then types in */}
      {phase !== 'scan' && phase !== 'brand' && (
        <Animated.View style={[s.bootWrap, { opacity: bootBoxOpacity }]}>
          <Text style={s.bootHeading} allowFontScaling={false}>
            ░░ SYS.LOG STREAM 0xA77F4C PID 0001 ░░
          </Text>
          {BOOT_LINES.map((line, i) => {
            const hasUp = / UP$/.test(line) || line.includes('[ OK ]') || line.endsWith(' OK');
            const hasAck = line.includes(' ACK') || line.includes('MATCH');
            const hasRetry = line.includes('RETRY') || line.includes('FAIL');
            const hasHero = line.includes('>>>');
            const hasHex = line.includes('0x');

            const isTyped = i < bootLine;
            const isTyping = i === bootLine && phase === 'boot';
            const displayed = isTyped ? line : isTyping ? line.slice(0, bootChar) : '';
            const showCursor = isTyping;

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
                {displayed || ' '}
                {showCursor && <Text style={s.cursor}>{cursorOn ? '█' : ' '}</Text>}
              </Text>
            );
          })}
        </Animated.View>
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
