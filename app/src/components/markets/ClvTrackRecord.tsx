/**
 * "Provable edge" — the Elder's verifiable CLV track record (docs/specs/provable-clv-elder.md).
 *
 * Answers the fair critique of any prediction agent: it's cute until it beats the closing line. The
 * Elder commits its implied probability on-chain BEFORE each market closes, anchored to a finalized
 * slot so it can't be backdated. After settlement, anyone recomputes the closing-line value (CLV) and
 * calibration (Brier) from public data — reproducible, not marketed. This surface shows that record:
 * the aggregate, every committed pick vs its closing line and outcome, wins AND losses.
 *
 * Lives behind a header button next to the Elder's picks; opens a bottom sheet in the same trading
 * language. Reads the public ledger at /api/txodds/clv/ledger.
 */
import { useState, useEffect, useCallback, memo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldCheck, X, ArrowRight, Terminal, Check } from 'lucide-react-native';
import { ILOWA_COLORS } from '../../theme/colors';
import { SP, RAD, STATE } from '../../theme/tokens';
import { RegionalCloth } from '../RegionalCloth';
import { PwaSheet } from '../PwaSheet';
import { fetchClvLedger, type ClvLedger, type ClvRecord, type ClvRow } from '../../lib/markets/elder';

const KIND_LABEL: Record<string, string> = {
  home_win: 'Home win', away_win: 'Away win',
  over_1_5: 'Over 1.5', over_2_5: 'Over 2.5', over_3_5: 'Over 3.5', under_2_5: 'Under 2.5',
  corners_over_8_5: 'Over 8.5 corners', corners_over_10_5: 'Over 10.5 corners',
  yellows_over_3_5: 'Over 3.5 yellows', red_card: 'A red card',
};
const label = (k: string) => KIND_LABEL[k] || k;
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const pts = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`);

/** Fetch the ledger + a settled count for the header badge. Re-fetch on demand. */
export function useClvLedger() {
  const [ledger, setLedger] = useState<ClvLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setLedger(await fetchClvLedger());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const record = ledger?.records?.[0] ?? null;
  const settled = record?.n ?? 0;
  return { ledger, record, rows: ledger?.rows ?? [], settled, loading, hasLoaded: ledger !== null, reload: load };
}

// ---------- header button ----------
export const ClvRecordButton = memo(function ClvRecordButton(
  { accent, settled, onPress }: { accent: string; settled: number; onPress: () => void },
) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.btn} accessibilityRole="button" accessibilityLabel="The Elder's provable track record">
      <ShieldCheck size={19} color={settled > 0 ? accent : ILOWA_COLORS.textSecondary} />
      {settled > 0 && (
        <View style={[styles.badge, { backgroundColor: accent }]}>
          <Text style={styles.badgeText}>{settled}</Text>
        </View>
      )}
    </Pressable>
  );
});

// ---------- one committed pick ----------
const RecordRow = memo(function RecordRow({ row }: { row: ClvRow }) {
  const settled = row.settled_outcome != null;
  const pendingClose = row.close_line == null;
  const outcome = row.settled_outcome;
  const clvUp = (row.clv ?? 0) >= 0;
  const status = !row.eligible
    ? { text: 'INELIGIBLE', c: STATE.error }
    : !settled
      ? (pendingClose ? { text: 'AWAITING CLOSE', c: STATE.pending } : { text: 'AWAITING SETTLE', c: STATE.pending })
      : outcome ? { text: 'YES', c: STATE.success } : { text: 'NO', c: STATE.error };
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowKind} numberOfLines={1}>{label(row.kind)}</Text>
        <View style={[styles.pill, { backgroundColor: status.c.bg, borderColor: status.c.border }]}>
          <Text style={[styles.pillText, { color: status.c.text }]}>{status.text}</Text>
        </View>
      </View>
      <View style={styles.rowLine}>
        <View style={styles.lineCol}><Text style={styles.lineLabel}>COMMITTED</Text><Text style={styles.lineVal}>{pct(row.p_implied)}</Text></View>
        <ArrowRight size={13} color={ILOWA_COLORS.textMuted} />
        <View style={styles.lineCol}><Text style={styles.lineLabel}>CLOSE</Text><Text style={styles.lineVal}>{pct(row.close_line)}</Text></View>
        {row.clv != null && (
          <View style={[styles.clvChip, { backgroundColor: (clvUp ? STATE.success : STATE.error).bg }]}>
            <Text style={[styles.clvChipText, { color: (clvUp ? STATE.success : STATE.error).text }]}>{pts(row.clv)} pts</Text>
          </View>
        )}
      </View>
      {row.eligible && (
        <View style={styles.beforeClose}>
          <Check size={11} color={STATE.info.text} />
          <Text style={styles.beforeCloseText}>Committed before close{row.committed_slot != null ? ` · slot ${row.committed_slot}` : ''}</Text>
        </View>
      )}
    </Animated.View>
  );
});

// ---------- sheet ----------
export function ClvTrackRecordSheet(
  { visible, onClose, accent, region, state }:
  { visible: boolean; onClose: () => void; accent: string; region: any; state: ReturnType<typeof useClvLedger> },
) {
  const { record, rows, loading, hasLoaded } = state;
  const hasData = (record?.n ?? 0) > 0;
  const clvUp = (record?.meanClv ?? 0) >= 0;
  const clvColor = record?.meanClv == null ? ILOWA_COLORS.textPrimary : (clvUp ? STATE.success.text : STATE.error.text);

  return (
    <PwaSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <RegionalCloth regionKey={region ?? 'westAfrica'} primaryColor={accent} />
        </View>
        <LinearGradient colors={[`${accent}22`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.sheetGlow} pointerEvents="none" />
        <View style={styles.handle} />

        <View style={styles.head}>
          <View style={[styles.headIcon, { borderColor: accent }]}><ShieldCheck size={22} color={accent} /></View>
          <View style={{ flex: 1 }}>
            <View style={styles.headTitleRow}>
              <Text style={styles.headTitle}>Provable edge</Text>
              <View style={styles.verifyPill}><Text style={styles.verifyText}>VERIFIABLE</Text></View>
            </View>
            <Text style={styles.headSub}>Committed before close. Recomputed from the chain.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.close}><X size={20} color={ILOWA_COLORS.textSecondary} /></Pressable>
        </View>

        {/* aggregate */}
        <View style={styles.heroCard}>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroLabel}>CLV</Text>
              <Text style={[styles.heroVal, { color: clvColor }]}>{hasData ? `${pts(record!.meanClv)}` : '—'}</Text>
              <Text style={styles.heroUnit}>pts vs close</Text>
            </View>
            <View style={styles.heroDiv} />
            <View style={styles.heroStat}>
              <Text style={styles.heroLabel}>BRIER</Text>
              <Text style={styles.heroVal}>{hasData && record!.brier != null ? record!.brier.toFixed(3) : '—'}</Text>
              <Text style={styles.heroUnit}>calibration</Text>
            </View>
            <View style={styles.heroDiv} />
            <View style={styles.heroStat}>
              <Text style={styles.heroLabel}>SETTLED</Text>
              <Text style={styles.heroVal}>{record?.n ?? 0}</Text>
              <Text style={styles.heroUnit}>picks</Text>
            </View>
          </View>
          <Text style={styles.claim}>
            Every pick commits the Elder's probability on-chain before kickoff, anchored to a finalized slot so it can't be backdated. After settlement, anyone recomputes these numbers from public data.
          </Text>
          <View style={styles.verifyChip}>
            <Terminal size={13} color={STATE.info.text} />
            <Text style={styles.verifyChipText}>node scripts/verify-clv.mjs</Text>
          </View>
          <Text style={styles.verifyCaption}>Reproduce the numbers yourself.</Text>
        </View>

        {loading && !hasLoaded ? (
          <ActivityIndicator color={accent} style={{ marginVertical: SP[10] }} />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <ShieldCheck size={26} color={accent} style={{ opacity: 0.8 }} />
            <Text style={styles.emptyTitle}>The record is opening</Text>
            <Text style={styles.emptyBody}>No picks have settled yet. Each one commits the Elder's number before the market closes, then anyone can check whether it beat the line.</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: SP[3], paddingBottom: SP[2] }}>
            {rows.map((r) => <RecordRow key={`${r.market_pubkey}-${r.elder_version}`} row={r} />)}
          </ScrollView>
        )}

        <Text style={styles.footer}>Wins and losses. Nothing curated.</Text>
    </PwaSheet>
  );
}

const HAIR = 'rgba(255,255,255,0.08)';
const styles = StyleSheet.create({
  // button
  btn: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: -1, minWidth: 15, height: 15, borderRadius: 7.5, paddingHorizontal: 3.5, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#0E1014' },
  badgeText: { fontFamily: 'Sora', fontSize: 8.5, fontWeight: '800', color: ILOWA_COLORS.deepBlack },

  // sheet frame (matches ElderPicksSheet)
  sheet: { backgroundColor: '#0B0D12', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: HAIR, paddingHorizontal: SP[5], paddingTop: SP[3], paddingBottom: SP[8], overflow: 'hidden' },
  sheetGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 180 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: SP[4] },

  head: { flexDirection: 'row', alignItems: 'center', gap: SP[3], marginBottom: SP[4] },
  headIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SP[2] },
  headTitle: { fontFamily: 'Sora', fontSize: 20, fontWeight: '600', letterSpacing: -0.25, color: ILOWA_COLORS.textPrimary },
  verifyPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RAD.xs, backgroundColor: STATE.info.bg, borderWidth: 1, borderColor: STATE.info.border },
  verifyText: { fontFamily: 'Sora', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: STATE.info.text },
  headSub: { fontFamily: 'Inter', fontSize: 12.5, color: ILOWA_COLORS.textSecondary, marginTop: 2 },
  close: { padding: 4 },

  // hero aggregate card
  heroCard: { backgroundColor: 'rgba(26,31,46,0.85)', borderRadius: RAD.md, borderWidth: 1, borderColor: HAIR, padding: SP[4], marginBottom: SP[4] },
  heroStats: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroLabel: { fontFamily: 'Sora', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: ILOWA_COLORS.textMuted },
  heroVal: { fontFamily: 'Sora', fontSize: 26, fontWeight: '800', letterSpacing: -1, color: ILOWA_COLORS.textPrimary, marginTop: 2 },
  heroUnit: { fontFamily: 'Inter', fontSize: 10, color: ILOWA_COLORS.textMuted, marginTop: 1 },
  heroDiv: { width: 1, height: 38, backgroundColor: HAIR },
  claim: { fontFamily: 'Inter', fontSize: 12.5, lineHeight: 18, color: ILOWA_COLORS.textSecondary, marginTop: SP[4] },
  verifyChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: SP[3], paddingHorizontal: 10, paddingVertical: 6, borderRadius: RAD.sm, backgroundColor: STATE.info.bg, borderWidth: 1, borderColor: STATE.info.border },
  verifyChipText: { fontFamily: 'monospace', fontSize: 11.5, color: STATE.info.text },
  verifyCaption: { fontFamily: 'Inter', fontSize: 10.5, color: ILOWA_COLORS.textMuted, marginTop: 5 },

  // record rows
  row: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RAD.sm, borderWidth: 1, borderColor: HAIR, padding: SP[3] },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP[2] },
  rowKind: { flex: 1, fontFamily: 'Sora', fontSize: 14, fontWeight: '600', color: ILOWA_COLORS.textPrimary },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RAD.xs, borderWidth: 1 },
  pillText: { fontFamily: 'Sora', fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: SP[3], marginTop: SP[3] },
  lineCol: { alignItems: 'flex-start' },
  lineLabel: { fontFamily: 'Sora', fontSize: 8.5, fontWeight: '700', letterSpacing: 0.6, color: ILOWA_COLORS.textMuted },
  lineVal: { fontFamily: 'Sora', fontSize: 17, fontWeight: '700', color: ILOWA_COLORS.textPrimary },
  clvChip: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 5, borderRadius: RAD.xs },
  clvChipText: { fontFamily: 'Sora', fontSize: 12, fontWeight: '800' },
  beforeClose: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: SP[3], paddingTop: SP[2], borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  beforeCloseText: { fontFamily: 'Inter', fontSize: 10.5, color: ILOWA_COLORS.textMuted },

  // empty + footer
  empty: { alignItems: 'center', gap: SP[2], paddingVertical: SP[8], paddingHorizontal: SP[6] },
  emptyTitle: { fontFamily: 'Sora', fontSize: 16, fontWeight: '600', color: ILOWA_COLORS.textPrimary },
  emptyBody: { fontFamily: 'Inter', fontSize: 13, lineHeight: 19, color: ILOWA_COLORS.textSecondary, textAlign: 'center' },
  footer: { fontFamily: 'Inter', fontSize: 11, color: ILOWA_COLORS.textMuted, textAlign: 'center', marginTop: SP[4] },
});
