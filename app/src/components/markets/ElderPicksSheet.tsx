/**
 * "The Elder speaks" — the personalized, provenance-backed picks surface.
 *
 * Replaces the inline block that shoved the market list. It lives behind a single ElderAvatar
 * button in the Markets header (a live count + pulse when the Elder has fresh plays), and opens a
 * bottom sheet styled as a small trading desk: hero odds %, an odds bar, the risk toggle, a
 * provenance stamp (the % traces to the live TxLINE demargined book), and a jump-to-market CTA.
 *
 * Makes the submission claim visible where users actually trade: reads the market (provenance),
 * shapes to risk (the toggle + real deterministic sizing), presents the play (per-language question).
 */
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing, FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles, ShieldCheck, X, ArrowUpRight } from 'lucide-react-native';
import { ILOWA_COLORS } from '../../theme/colors';
import { contrastOn } from '../../theme/liquid-metal';
import { SP, RAD, STATE } from '../../theme/tokens';
import { ElderAvatar } from '../ElderAvatar';
import { RegionalCloth } from '../RegionalCloth';
import { PwaSheet } from '../PwaSheet';
import { fetchElderPicks, type RiskProfile, type ElderPick } from '../../lib/markets/elder';

const RISKS: { key: RiskProfile; label: string }[] = [
  { key: 'careful', label: 'Careful' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'bold', label: 'Bold' },
];

export interface PickCard { fixtureId: number; home: string; away: string; startTime: number; pick: ElderPick }

/** Shared state for the button badge + the sheet: fetches the shaped picks, re-fetches on risk. */
export function useElderPicks(lang = 'en', stakeUsdc = 10) {
  const [risk, setRisk] = useState<RiskProfile>('balanced');
  const [fixtures, setFixtures] = useState<PickCard[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r: RiskProfile) => {
    setLoading(true);
    const res = await fetchElderPicks({ risk: r, stake: stakeUsdc, lang, limit: 6 });
    const cards: PickCard[] = (res?.fixtures ?? [])
      .map((f) => ({ fixtureId: f.fixtureId, home: f.home, away: f.away, startTime: f.startTime, pick: f.shapedForYou?.[0] }))
      .filter((c): c is PickCard => !!c.pick);
    setFixtures(cards);
    setLoading(false);
  }, [stakeUsdc, lang]);

  useEffect(() => { load(risk); }, [risk, load]);

  return { risk, setRisk, cards: fixtures ?? [], loading, hasLoaded: fixtures !== null, count: (fixtures ?? []).length };
}

// ---------- header button ----------
export const ElderPicksButton = memo(function ElderPicksButton(
  { elder, accent, count, onPress }: { elder: any; accent: string; count: number; onPress: () => void },
) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (count > 0) pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    else pulse.value = 0;
  }, [count]);
  const ring = useAnimatedStyle(() => ({ opacity: (1 - pulse.value) * 0.5, transform: [{ scale: 1 + pulse.value * 0.6 }] }));

  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.btnWrap} accessibilityRole="button" accessibilityLabel="The Elder's picks for you">
      {count > 0 && <Animated.View pointerEvents="none" style={[styles.pulseRing, { borderColor: accent }, ring]} />}
      <View style={[styles.btnRing, { borderColor: count > 0 ? accent : 'rgba(255,255,255,0.14)' }]}>
        {elder ? <ElderAvatar elder={elder} size={30} showGlow={count > 0} /> : <Sparkles size={18} color={accent} />}
      </View>
      {count > 0 && (
        <View style={[styles.badge, { backgroundColor: accent }]}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
});

// ---------- pick trading card ----------
function OddsBar({ p, accent }: { p: number; accent: string }) {
  return (
    <View style={styles.oddsTrack}>
      <View style={[styles.oddsFill, { width: `${Math.round(p * 100)}%`, backgroundColor: accent }]} />
    </View>
  );
}

const TradingCard = memo(function TradingCard(
  { card, accent, onTrade, onVerify }:
  { card: PickCard; accent: string; onTrade?: (fixtureId: number, kind: string) => void; onVerify?: () => void },
) {
  const { pick } = card;
  const pctNum = pick.impliedYes != null ? Math.round(pick.impliedYes * 100) : null;
  return (
    <Animated.View entering={FadeIn.duration(260)} style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.match} numberOfLines={1}>{card.home} <Text style={styles.vs}>v</Text> {card.away}</Text>
        <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
      </View>
      <View style={styles.qRow}>
        <Text style={styles.q} numberOfLines={2}>{pick.question}</Text>
        {pctNum != null && <Text style={[styles.pct, { color: accent }]}>{pctNum}<Text style={styles.pctSign}>%</Text></Text>}
      </View>
      {pick.impliedYes != null && <OddsBar p={pick.impliedYes} accent={accent} />}
      <Text style={styles.fit} numberOfLines={2}>{pick.fit || pick.analysis}</Text>
      <View style={styles.statStrip}>
        <View style={styles.stat}><Text style={styles.statLabel}>STAKE</Text><Text style={styles.statVal}>{pick.suggestedStakeUsdc}</Text><Text style={styles.statUnit}>USDC</Text></View>
        <View style={styles.statDiv} />
        <View style={styles.stat}><Text style={styles.statLabel}>RETURN</Text><Text style={[styles.statVal, { color: STATE.success.text }]}>+{pick.potentialProfitUsdc}</Text></View>
        <Pressable style={[styles.trade, { borderColor: accent }]} onPress={() => onTrade?.(card.fixtureId, pick.kind)}>
          <Text style={[styles.tradeText, { color: accent }]}>Trade</Text>
          <ArrowUpRight size={14} color={accent} />
        </Pressable>
      </View>
      {pick.source && (
        <Pressable style={styles.prov} onPress={onVerify} hitSlop={6} disabled={!onVerify}>
          <ShieldCheck size={12} color={STATE.info.text} />
          <Text style={styles.provText} numberOfLines={1}>
            {pick.source.book === 'elder-independent-model-v1'
              ? `${pctNum != null ? `${pctNum}% ` : ''}from the Elder's own model, fit on match history, not a market echo. Tap to verify.`
              : `${pctNum != null ? `${pctNum}% ` : ''}from the live ${pick.source.book} book. Tap to verify.`}
          </Text>
          {onVerify && <ArrowUpRight size={11} color={STATE.info.text} />}
        </Pressable>
      )}
    </Animated.View>
  );
});

// ---------- sheet ----------
export function ElderPicksSheet(
  { visible, onClose, elder, accent, region, state, onTrade, onVerify }:
  { visible: boolean; onClose: () => void; elder: any; accent: string; region: any;
    state: ReturnType<typeof useElderPicks>; onTrade?: (fixtureId: number, kind: string) => void; onVerify?: () => void },
) {
  const { risk, setRisk, cards, loading, hasLoaded } = state;
  const elderName = elder?.name || 'The Elder';
  return (
    <PwaSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <RegionalCloth regionKey={region ?? 'westAfrica'} primaryColor={accent} />
        </View>
        <LinearGradient colors={[`${accent}22`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.sheetGlow} pointerEvents="none" />
        <View style={styles.handle} />

        <View style={styles.head}>
          {elder ? <ElderAvatar elder={elder} size={44} showGlow /> : <Sparkles size={22} color={accent} />}
          <View style={{ flex: 1 }}>
            <View style={styles.headTitleRow}>
              <Text style={styles.headTitle}>{elderName} speaks</Text>
              <View style={styles.txlinePill}><View style={[styles.liveDot, { backgroundColor: STATE.info.text }]} /><Text style={styles.txlineText}>TXLINE</Text></View>
            </View>
            <Text style={styles.headSub}>Plays shaped to your risk, from the live market.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.close}><X size={20} color={ILOWA_COLORS.textSecondary} /></Pressable>
        </View>

        <View style={styles.segment}>
          {RISKS.map((r) => {
            const on = r.key === risk;
            return (
              <Pressable key={r.key} onPress={() => setRisk(r.key)} style={styles.segItem}>
                {on && <View style={[StyleSheet.absoluteFill, { borderRadius: RAD.sm, backgroundColor: accent }]} />}
                <Text style={[styles.segText, on && { color: contrastOn(accent), fontWeight: '700' }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading && !hasLoaded ? (
          <ActivityIndicator color={accent} style={{ marginVertical: SP[10] }} />
        ) : cards.length === 0 ? (
          <View style={styles.empty}>
            <Sparkles size={26} color={accent} style={{ opacity: 0.8 }} />
            <Text style={styles.emptyTitle}>The board is quiet</Text>
            <Text style={styles.emptyBody}>No plays are priced yet. {elderName} will shape them as the odds come in near kickoff.</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: SP[3], paddingBottom: SP[2] }}>
            {cards.map((c) => <TradingCard key={`${c.fixtureId}-${c.pick.kind}`} card={c} accent={accent} onTrade={onTrade} onVerify={onVerify} />)}
          </ScrollView>
        )}

        <Text style={styles.footer}>Same honest odds. Your risk, your call.</Text>
    </PwaSheet>
  );
}

const HAIR = 'rgba(255,255,255,0.08)';
const styles = StyleSheet.create({
  // button
  btnWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 1.5 },
  btnRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { position: 'absolute', top: -1, right: -1, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#0E1014' },
  badgeText: { fontFamily: 'Sora', fontSize: 9, fontWeight: '800', color: ILOWA_COLORS.deepBlack },

  // sheet frame
  sheet: { backgroundColor: '#0B0D12', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: HAIR, paddingHorizontal: SP[5], paddingTop: SP[3], paddingBottom: SP[8], overflow: 'hidden' },
  sheetGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 180 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: SP[4] },

  head: { flexDirection: 'row', alignItems: 'center', gap: SP[3], marginBottom: SP[4] },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SP[2] },
  headTitle: { fontFamily: 'Sora', fontSize: 20, fontWeight: '600', letterSpacing: -0.25, color: ILOWA_COLORS.textPrimary },
  txlinePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: RAD.xs, backgroundColor: STATE.info.bg, borderWidth: 1, borderColor: STATE.info.border },
  txlineText: { fontFamily: 'Sora', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: STATE.info.text },
  headSub: { fontFamily: 'Inter', fontSize: 12.5, color: ILOWA_COLORS.textSecondary, marginTop: 2 },
  close: { padding: 4 },

  // segmented risk control
  segment: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: RAD.md, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: HAIR, marginBottom: SP[4] },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: RAD.sm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  segText: { fontFamily: 'Sora', fontSize: 13, fontWeight: '600', color: ILOWA_COLORS.textMuted },

  // trading card
  card: { backgroundColor: 'rgba(26,31,46,0.85)', borderRadius: RAD.md, borderWidth: 1, borderColor: HAIR, padding: SP[4] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[2] },
  match: { fontFamily: 'Sora', fontSize: 12, fontWeight: '600', color: ILOWA_COLORS.textSecondary, letterSpacing: 0.2, flex: 1 },
  vs: { color: ILOWA_COLORS.textMuted, fontWeight: '400' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: STATE.success.text },
  liveText: { fontFamily: 'Sora', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: ILOWA_COLORS.textMuted },
  qRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP[3] },
  q: { flex: 1, fontFamily: 'Sora', fontSize: 16, fontWeight: '600', lineHeight: 22, color: ILOWA_COLORS.textPrimary },
  pct: { fontFamily: 'Sora', fontSize: 30, fontWeight: '800', letterSpacing: -1, lineHeight: 32 },
  pctSign: { fontSize: 16, fontWeight: '700' },
  oddsTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: SP[3], overflow: 'hidden' },
  oddsFill: { height: 4, borderRadius: 2 },
  fit: { fontFamily: 'Inter', fontSize: 13, lineHeight: 19, color: ILOWA_COLORS.textSecondary, marginTop: SP[3] },
  statStrip: { flexDirection: 'row', alignItems: 'center', gap: SP[3], marginTop: SP[4] },
  stat: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statLabel: { fontFamily: 'Sora', fontSize: 9, fontWeight: '700', letterSpacing: 0.6, color: ILOWA_COLORS.textMuted },
  statVal: { fontFamily: 'Sora', fontSize: 16, fontWeight: '700', color: ILOWA_COLORS.textPrimary },
  statUnit: { fontFamily: 'Inter', fontSize: 10, color: ILOWA_COLORS.textMuted },
  statDiv: { width: 1, height: 18, backgroundColor: HAIR },
  trade: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 7, borderRadius: RAD.sm, borderWidth: 1 },
  tradeText: { fontFamily: 'Sora', fontSize: 13, fontWeight: '700' },
  prov: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP[3], paddingTop: SP[3], borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  provText: { flex: 1, fontFamily: 'Inter', fontSize: 11, color: ILOWA_COLORS.textMuted },

  // empty + footer
  empty: { alignItems: 'center', gap: SP[2], paddingVertical: SP[9], paddingHorizontal: SP[6] },
  emptyTitle: { fontFamily: 'Sora', fontSize: 16, fontWeight: '600', color: ILOWA_COLORS.textPrimary },
  emptyBody: { fontFamily: 'Inter', fontSize: 13, lineHeight: 19, color: ILOWA_COLORS.textSecondary, textAlign: 'center' },
  footer: { fontFamily: 'Inter', fontSize: 11, color: ILOWA_COLORS.textMuted, textAlign: 'center', marginTop: SP[4] },
});
