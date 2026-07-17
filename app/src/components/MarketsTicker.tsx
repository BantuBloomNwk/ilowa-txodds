// StockTwits-style live ticker tape under the Markets header. A carved liquid-metal
// strip scrolling right-to-left with live prices + 24h change (green up / red down)
// and an ALL/Crypto/Stocks/Forex toggle + pause. Crypto = Binance coins + crypto-
// equities; Stocks + Forex stream from our Yahoo proxy. Each class is sorted
// gainers→losers so the strongest movers lead; ALL is the blended cross-asset tape.
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, type LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing, cancelAnimation } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Pause, Play, ChevronUp, ChevronDown } from 'lucide-react-native';
import { ILOWA_COLORS } from '../theme/colors';
import { chromeStops, contrastOnSurface } from '../theme/liquid-metal';
import { fetchCryptoTicker, fetchClassTicker, type Ticker } from '../lib/markets/crypto';

const GREEN = '#2BD17E';
const RED = '#F0455B';
const METAL = ['#2A2E37', '#15171C', '#22262F'] as const;
const MODES = ['all', 'crypto', 'stocks', 'forex'] as const;
type Mode = typeof MODES[number];

const fmtP = (n: number, fx = false) => {
  if (fx) return n >= 100 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(4);
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 5 : 2 });
};

export function MarketsTicker({ accent }: { accent: string }) {
  const [items, setItems] = useState<Ticker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>('all');
  const [paused, setPaused] = useState(false);
  const [setW, setSetW] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    const pull = async () => {
      let next: Ticker[] = [];
      if (mode === 'crypto') {
        const [coins, sol, cstk] = await Promise.all([
          fetchCryptoTicker(), fetchClassTicker('solana'), fetchClassTicker('cryptostocks'),
        ]);
        next = [...coins, ...sol, ...cstk];
      } else if (mode === 'all') {
        const [coins, sol, cstk, stk, fx] = await Promise.all([
          fetchCryptoTicker(), fetchClassTicker('solana'), fetchClassTicker('cryptostocks'),
          fetchClassTicker('stocks'), fetchClassTicker('forex'),
        ]);
        next = [...coins, ...sol, ...cstk, ...stk, ...fx];
      } else if (mode === 'stocks') {
        next = await fetchClassTicker('stocks');
      } else if (mode === 'forex') {
        next = await fetchClassTicker('forex');
      }
      // Dedupe by symbol (Binance majors win over the SPL listing of the same coin),
      // then lead with the biggest movers — gain or loss — keeping classes mixed.
      const seen = new Set<string>();
      next = next.filter((t) => { const k = t.symbol.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      next.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
      if (live) { setItems(next); setLoaded(true); }
    };
    pull();
    const id = setInterval(pull, 12000);
    return () => { live = false; clearInterval(id); };
  }, [mode]);

  useEffect(() => {
    // Pause freezes x where it is (no reset); unpause RESUMES from there — finish the
    // partial scroll to -setW, snap back instantly (seamless thanks to the duplicated
    // set), then loop. So it never jumps backward when you pause/unpause.
    if (paused || setW < 10 || items.length === 0) { cancelAnimation(x); return; }
    const full = setW * 26;
    // Switching to a class with fewer items (Stocks/Forex) shrinks setW, so a
    // leftover x.value from a wider set (ALL/Crypto) can sit BELOW the new -setW —
    // which makes the first segment animate rightward (the "wrong way" the founder
    // saw). Clamp the start into [-setW, 0] so the tape always scrolls right→left.
    if (x.value > 0 || x.value < -setW) x.value = 0;
    const cur = x.value;
    const remaining = full * ((setW + cur) / setW);
    x.value = withSequence(
      withTiming(-setW, { duration: remaining, easing: Easing.linear }),
      withTiming(0, { duration: 0 }),
      withRepeat(withTiming(-setW, { duration: full, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(x);
  }, [paused, setW, items.length, x]);

  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const cycle = () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

  const renderSet = (prefix: string, onLayout?: (e: LayoutChangeEvent) => void) => (
    <View style={styles.row} onLayout={onLayout}>
      {items.length === 0 ? (
        <Text style={styles.coming}>
          {!loaded ? (mode === 'all' ? 'Loading markets' : 'Loading prices') : 'Markets unavailable, retrying'}
        </Text>
      ) : items.map((t) => {
        const up = t.changePct >= 0;
        return (
          <View key={prefix + t.symbol} style={styles.item}>
            <Text style={styles.sym}>{t.symbol}</Text>
            <Text style={styles.px}>{t.pre ?? '$'}{fmtP(t.price, t.pre === '')}</Text>
            {up ? <ChevronUp size={12} color={GREEN} /> : <ChevronDown size={12} color={RED} />}
            <Text style={[styles.chg, { color: up ? GREEN : RED }]}>{Math.abs(t.changePct).toFixed(2)}%</Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.bar}>
      <LinearGradient colors={METAL} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.topHi} />
      <View style={styles.bottomLo} />
      <View style={styles.marqueeWrap}>
        <Animated.View style={[styles.marquee, aStyle]}>
          {renderSet('a-', (e) => setSetW(e.nativeEvent.layout.width))}
          {renderSet('b-')}
        </Animated.View>
      </View>
      {/* Left tunnel mouth: figures slide out of shadow into a lit rim, never bleeding under the hue */}
      <View style={styles.leftMouth} pointerEvents="none">
        <LinearGradient colors={['rgba(0,0,0,0.62)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={[styles.leftRim, { backgroundColor: `${accent}55` }]} pointerEvents="none" />
      {/* Left: fixed-width liquid-metal mode pill in an opaque metal housing (figures pass behind, hidden) */}
      <View style={styles.leftCtrl}>
        <LinearGradient colors={METAL} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <LinearGradient colors={[`${accent}24`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.housingTop} pointerEvents="none" />
        <Pressable onPress={cycle} style={styles.modeChip} hitSlop={6}>
          <LinearGradient {...chromeStops(accent)} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={styles.chipGloss} />
          <Text style={[styles.modeTxt, { color: contrastOnSurface(accent) }]} numberOfLines={1}>{mode.toUpperCase()}</Text>
        </Pressable>
      </View>
      {/* Right tunnel mouth (mirror) */}
      <View style={styles.rightMouth} pointerEvents="none">
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.62)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={[styles.rightRim, { backgroundColor: `${accent}55` }]} pointerEvents="none" />
      {/* Right: pause in the matching metal housing */}
      <View style={styles.rightCtrl}>
        <LinearGradient colors={METAL} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.housingTop} pointerEvents="none" />
        <Pressable onPress={() => setPaused((p) => !p)} style={styles.pauseBtn} hitSlop={8}>
          {paused ? <Play size={13} color={ILOWA_COLORS.textSecondary} /> : <Pause size={13} color={ILOWA_COLORS.textSecondary} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 36, borderRadius: 10, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', justifyContent: 'center' },
  topHi: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' },
  bottomLo: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  marqueeWrap: { flex: 1, overflow: 'hidden', justifyContent: 'center' },
  marquee: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 22 },
  sym: { fontFamily: 'Geist-Bold', fontSize: 12, color: '#D7DAE1' },
  px: { fontFamily: 'Geist-Medium', fontSize: 12, color: ILOWA_COLORS.textSecondary },
  chg: { fontFamily: 'Geist-SemiBold', fontSize: 11.5 },
  coming: { fontFamily: 'Geist-Medium', fontSize: 12, color: ILOWA_COLORS.textMuted, paddingVertical: 6 },
  leftCtrl: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 86, flexDirection: 'row', alignItems: 'center', paddingLeft: 11, overflow: 'hidden' },
  rightCtrl: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 52, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  housingTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.14)' },
  // Tunnel mouths: a short shadow just outside each housing so figures fade into the dark before vanishing.
  leftMouth: { position: 'absolute', left: 86, width: 30, top: 0, bottom: 0 },
  rightMouth: { position: 'absolute', right: 52, width: 30, top: 0, bottom: 0 },
  // Lit rim at the cut edge of each housing — the bright lip of the tunnel.
  leftRim: { position: 'absolute', left: 86, width: 1.5, top: 4, bottom: 4, borderRadius: 1 },
  rightRim: { position: 'absolute', right: 52, width: 1.5, top: 4, bottom: 4, borderRadius: 1 },
  modeChip: { width: 60, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  chipGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: 9, backgroundColor: 'rgba(255,255,255,0.16)' },
  modeTxt: { fontFamily: 'Geist-Bold', fontSize: 10.5, letterSpacing: 0.5 },
  pauseBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
});
