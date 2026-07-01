// Verifiable-resolution receipt for a World Cup market settled by TxLINE.
// Before kickoff it tells the trader HOW the market resolves (on-chain proof, no
// admin); after the match it shows the proven outcome + a link to the on-chain
// resolve transaction. This is the trust story made visible.
import { View, Text, StyleSheet, Pressable, Linking, Platform } from 'react-native';
import { ShieldCheck, Radio } from 'lucide-react-native';
import { ILOWA_COLORS } from '../../theme/colors';
import type { TxlineBinding } from '../../lib/markets/manifest';

const GREEN = '#2BD17E', RED = '#F0455B';
const CARVE: any = Platform.OS === 'web'
  ? { boxShadow: 'inset 0 1px 2.5px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04)' } : {};

export function TxlineReceipt({ binding, accent }: { binding: TxlineBinding; accent: string }) {
  const match = binding.home && binding.away ? `${binding.home} vs ${binding.away}` : 'this match';
  const resolved = binding.status === 'resolved';
  const yesWon = binding.resolved_outcome === true;
  const c = resolved ? (yesWon ? GREEN : RED) : accent;

  const openTx = () => {
    if (binding.resolve_sig) Linking.openURL(`https://explorer.solana.com/tx/${binding.resolve_sig}?cluster=devnet`);
  };

  return (
    <View style={[styles.wrap, { borderColor: `${c}55` }, CARVE]}>
      <View style={styles.head}>
        {resolved ? <ShieldCheck size={15} color={c} /> : <Radio size={15} color={c} />}
        <Text style={[styles.tag, { color: c }]}>{resolved ? 'SETTLED BY TXLINE' : 'SETTLES VIA TXLINE'}</Text>
      </View>

      {resolved ? (
        <>
          <Text style={styles.line}>
            {binding.description || match} resolved <Text style={{ color: c, fontFamily: 'Sora-SemiBold' }}>{yesWon ? 'YES' : 'NO'}</Text>, proven on-chain from the match result.
          </Text>
          {binding.resolve_sig ? (
            <Pressable onPress={openTx} hitSlop={6}>
              <Text style={[styles.link, { color: accent }]}>View the on-chain proof ↗</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text style={styles.line}>
          When {match} ends, an on-chain TxLINE proof resolves this market automatically. No oracle, no admin, no one can change the result.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 12, padding: 11, gap: 6, backgroundColor: 'rgba(0,0,0,0.22)', marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { fontFamily: 'Inter-Bold', fontSize: 10, letterSpacing: 1.1 },
  line: { fontFamily: 'Inter', fontSize: 12.5, lineHeight: 18, color: ILOWA_COLORS.textSecondary },
  link: { fontFamily: 'Sora-SemiBold', fontSize: 12.5, marginTop: 1 },
});
