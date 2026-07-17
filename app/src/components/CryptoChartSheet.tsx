// Interactive price chart, opened from a crypto card. Real Binance candle closes
// drawn as a line, with proper trading timeframes (1m..1W), scrub-to-read crosshair,
// a Price / Mkt Cap toggle, live polling, and green/red by the period's move.
// OHLC candles are a planned second view behind a toggle.
import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Dimensions, type GestureResponderEvent } from 'react-native';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { ILOWA_COLORS } from '../theme/colors';
import { PwaSheet } from './PwaSheet';
import { fetchKlines, type CryptoPrice, type Candle } from '../lib/markets/crypto';

const GREEN = '#2BD17E';
const RED = '#F0455B';
const HAIR = 'rgba(255,255,255,0.08)';
// label = the time RANGE shown; interval + count are chosen to cover exactly that
// range (so "1W" = the last 7 days, not weekly candles over years).
const TFS: [string, string, number][] = [
  ['1H', '1m', 60], ['1D', '15m', 96], ['1W', '1h', 168], ['1M', '4h', 180], ['1Y', '1d', 365], ['All', '1w', 260],
];

function fmtUsd(n: number): string {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 5 : 2 });
}
function fmtTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function CryptoChartSheet({ coin, onClose }: { coin: CryptoPrice | null; onClose: () => void }) {
  const [tf, setTf] = useState(1); // index into TFS, default 1D (user can change)
  const [mode, setMode] = useState<'price' | 'mcap'>('price');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!coin) return;
    let live = true;
    const interval = TFS[tf][1], limit = TFS[tf][2];
    const pull = async () => {
      const k = await fetchKlines(coin.symbol, interval, limit, coin.id);
      if (live && k.length) setCandles(k);
      if (live) setLoading(false);
    };
    setLoading(true); setCandles([]); setScrub(null);
    pull();
    pollRef.current = setInterval(pull, 12000);
    return () => { live = false; if (pollRef.current) clearInterval(pollRef.current); };
  }, [coin, tf]);

  if (!coin) return null;
  const series = mode === 'mcap' && coin.supply > 0 ? candles.map((k) => k.c * coin.supply) : candles.map((k) => k.c);
  const n = series.length;
  const up = n > 1 ? series[n - 1] >= series[0] : coin.change24h >= 0;
  const color = up ? GREEN : RED;
  const W = Math.min(Dimensions.get('window').width, 460) - 56;
  const H = 180;

  let path = '', lo = 0, hi = 0, scrubX = 0, scrubY = 0;
  if (n > 1) {
    lo = Math.min(...series); hi = Math.max(...series);
    const range = (hi - lo) || 1;
    path = series.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - ((v - lo) / range) * H).toFixed(1)}`).join(' ');
    if (scrub != null) {
      const i = Math.max(0, Math.min(n - 1, scrub));
      scrubX = (i / (n - 1)) * W;
      scrubY = H - ((series[i] - lo) / range) * H;
    }
  }
  const periodChange = n > 1 ? ((series[n - 1] - series[0]) / (series[0] || 1)) * 100 : coin.change24h;
  const shownVal = scrub != null && n > 0 ? series[Math.max(0, Math.min(n - 1, scrub))] : (n > 0 ? series[n - 1] : (mode === 'mcap' ? coin.price * coin.supply : coin.price));
  const shownTime = scrub != null && n > 0 ? fmtTime(candles[Math.max(0, Math.min(n - 1, scrub))].t) : null;

  const onMove = (e: GestureResponderEvent) => {
    if (n < 2) return;
    const x = e.nativeEvent.locationX;
    setScrub(Math.max(0, Math.min(n - 1, Math.round((x / W) * (n - 1)))));
  };

  return (
    <PwaSheet onClose={onClose} sheetStyle={styles.sheet} backdropColor="rgba(4,5,8,0.7)">
        <View style={styles.handle} />
        <View style={styles.head}>
          {coin.image ? <Image source={{ uri: coin.image }} style={styles.logo} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{coin.name}</Text>
            <Text style={styles.price}>
              {fmtUsd(shownVal)}{' '}
              <Text style={{ color }}>{periodChange >= 0 ? '+' : ''}{periodChange.toFixed(2)}%</Text>
            </Text>
            {shownTime ? <Text style={styles.scrubTime}>{shownTime}</Text> : null}
          </View>
          <Pressable onPress={onClose} style={styles.close}><X size={20} color={ILOWA_COLORS.textSecondary} /></Pressable>
        </View>

        <View style={styles.toggleRow}>
          {(['price', 'mcap'] as const).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.toggle, { backgroundColor: mode === m ? `${color}1A` : 'transparent', borderColor: mode === m ? color : HAIR }]}>
              <Text style={[styles.toggleTxt, { color: mode === m ? color : ILOWA_COLORS.textSecondary }]}>{m === 'price' ? 'Price' : 'Mkt Cap'}</Text>
            </Pressable>
          ))}
        </View>

        <View
          style={[styles.chartBox, { height: H }]}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onMove}
          onResponderMove={onMove}
          onResponderRelease={() => setScrub(null)}
        >
          {loading ? <ActivityIndicator color={color} />
            : n < 2 ? <Text style={styles.noData}>No chart data right now.</Text>
                : (
                  <Svg width={W} height={H}>
                    <Polyline points={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                    {scrub != null && (
                      <>
                        <Line x1={scrubX} y1={0} x2={scrubX} y2={H} stroke="rgba(255,255,255,0.25)" strokeWidth={0.75} />
                        <Circle cx={scrubX} cy={scrubY} r={4} fill={color} />
                      </>
                    )}
                  </Svg>
                )}
        </View>
        {n > 1 && <Text style={styles.range}>{fmtUsd(lo)} low · {fmtUsd(hi)} high · drag to read</Text>}

        <View style={styles.tfRow}>
          {TFS.map(([label], i) => (
            <Pressable key={label} onPress={() => setTf(i)} style={[styles.tf, { borderColor: tf === i ? color : HAIR, backgroundColor: tf === i ? `${color}1A` : 'transparent' }]}>
              <Text style={[styles.tfTxt, { color: tf === i ? color : ILOWA_COLORS.textSecondary }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
    </PwaSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#0C0E12', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: HAIR, padding: 20, paddingBottom: 30 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  logo: { width: 34, height: 34, borderRadius: 17 },
  name: { fontFamily: 'Geist-Bold', fontSize: 16, color: '#D7DAE1' },
  price: { fontFamily: 'Geist-SemiBold', fontSize: 15, color: '#D7DAE1', marginTop: 2 },
  scrubTime: { fontFamily: 'Inter', fontSize: 10.5, color: ILOWA_COLORS.textMuted, marginTop: 2 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggle: { borderWidth: 1, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 14 },
  toggleTxt: { fontFamily: 'Sora-SemiBold', fontSize: 12 },
  chartBox: { alignItems: 'center', justifyContent: 'center' },
  noData: { fontFamily: 'Inter', fontSize: 12.5, color: ILOWA_COLORS.textMuted },
  range: { fontFamily: 'Inter', fontSize: 11, color: ILOWA_COLORS.textMuted, textAlign: 'center', marginTop: 8 },
  tfRow: { flexDirection: 'row', gap: 6, marginTop: 16, justifyContent: 'center' },
  tf: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  tfTxt: { fontFamily: 'Sora-SemiBold', fontSize: 12.5 },
});
