/**
 * CLOB order panel for a market that has a Manifest order book (discovered via
 * clob_markets). Shows the live book mid (= implied probability), lets the user
 * place a limit order to buy/sell the YES outcome token (priced in collateral),
 * and shows their YES/NO position. Order tx is built server-side and signed by
 * the wallet (placeOrderViaServer); the book is read server-side (readManifestBook).
 *
 * Web-only inset "carved" treatment matches the Markets surface.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { ILOWA_COLORS } from '../../theme/colors';
import { globalAlert } from '../IlowaAlert';
import { placeOrderViaServer, buyNoViaServer, settleMarket, readManifestBook, readOpenOrders, readSeatBalance, cancelOrderViaServer, withdrawAllViaServer, armServerTrigger, listServerTriggers, revokeServerTrigger, fetchTxlineBinding, type Book, type OpenOrder, type ServerTrigger, type TxlineBinding } from '../../lib/markets/manifest';
import { WSOL_MINT } from '../../lib/solana/manifest-writer';
import { TxlineReceipt } from './TxlineReceipt';
import { getOutcomeBalances } from '../../lib/markets/clob';
import { listTriggers, addTrigger, removeTrigger, type Trigger, type TriggerKind } from '../../lib/markets/clob-triggers';
import type { ClobMarket } from '../../lib/markets/clob-discovery';

const HAIR = 'rgba(255,255,255,0.08)';
const FIELD_BG = 'rgba(0,0,0,0.22)';
const CARVE: any = Platform.OS === 'web'
  ? { boxShadow: 'inset 0 1px 2.5px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.045)' } : {};
const GREEN = '#2BD17E', RED = '#F0455B';
const OWNER = (process.env.EXPO_PUBLIC_OWNER_WALLET || '').trim();
// Wallets allowed to crank on-demand settlement in-app (owner + explicit demo/test
// wallets). Settlement itself is permissionless; this only gates the button's visibility.
const SETTLE_WALLETS = new Set(
  [OWNER, ...(process.env.EXPO_PUBLIC_SETTLE_WALLETS || '').split(',')].map((s) => s.trim()).filter(Boolean),
);

type Side = 'buyYes' | 'buyNo' | 'sellYes';

export function ClobPanel({ clob, wallet, accent }: { clob: ClobMarket; wallet: any; accent: string }) {
  const [book, setBook] = useState<Book | null>(null);
  const [pos, setPos] = useState<{ yes: number; no: number } | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [side, setSide] = useState<Side>('buyYes');
  const [pricePct, setPricePct] = useState('');   // probability %, 1..99
  const [size, setSize] = useState('');           // YES tokens
  const [otype, setOtype] = useState<'limit' | 'ioc'>('limit'); // Limit vs Market(IOC)
  const [placing, setPlacing] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null); // clientOrderId being cancelled
  const [seat, setSeat] = useState<{ yes: number; quote: number }>({ yes: 0, quote: 0 }); // withdrawable exchange balance
  const [withdrawing, setWithdrawing] = useState(false);
  // stop / take-profit (device-local triggers, fired client-side while open)
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [showTrig, setShowTrig] = useState(false);
  const [trigKind, setTrigKind] = useState<TriggerKind>('stop');
  const [trigPrice, setTrigPrice] = useState('');
  const [trigSize, setTrigSize] = useState('');
  const firingRef = useRef<Set<string>>(new Set()); // trigger ids mid-fire (no double-fire)
  const failedRef = useRef<Set<string>>(new Set()); // triggers that failed — don't auto-retry/loop
  // set-and-forget triggers that fire via the server keeper even while away
  const [awayMode, setAwayMode] = useState(false);
  const [arming, setArming] = useState(false);
  const [serverTrigs, setServerTrigs] = useState<ServerTrigger[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [txline, setTxline] = useState<TxlineBinding | null>(null); // WC TxLINE settlement binding, if any
  const [settling, setSettling] = useState(false); // owner-only: crank on-demand settlement (demo)

  // Validate the on-chain addresses once; a malformed mapping must not crash the
  // whole market card. Bail to a quiet fallback instead.
  const keys = useMemo(() => {
    try {
      return { manifest: new PublicKey(clob.manifest_market), yesMint: new PublicKey(clob.yes_mint), noMint: new PublicKey(clob.no_mint) };
    } catch { return null; }
  }, [clob.manifest_market, clob.yes_mint, clob.no_mint]);
  const manifest = keys?.manifest;

  const refresh = useCallback(async () => {
    if (!manifest || !keys) return;
    const b = await readManifestBook(manifest).catch(() => null);
    setBook(b);
    if (wallet?.publicKey) {
      const owner = wallet.publicKey instanceof PublicKey ? wallet.publicKey : new PublicKey(wallet.publicKey);
      // A filled buy credits YES to the Manifest seat, NOT the wallet ATA — so the
      // real position = wallet-ATA YES + seat YES. Read both.
      const [bal, seatBal] = await Promise.all([
        getOutcomeBalances(owner, keys.yesMint, keys.noMint).catch(() => null),
        readSeatBalance(manifest, owner).catch(() => ({ yes: 0, quote: 0 })),
      ]);
      const ataYes = bal ? bal.yes : 0, ataNo = bal ? bal.no : 0;
      setSeat(seatBal);
      setPos({ yes: ataYes + seatBal.yes, no: ataNo });
      setOrders(await readOpenOrders(manifest, owner).catch(() => []));
      setTriggers(await listTriggers(manifest.toBase58(), owner.toBase58()).catch(() => []));
      setServerTrigs(await listServerTriggers(manifest, owner).catch(() => []));
    } else {
      setOrders([]); setTriggers([]); setServerTrigs([]);
    }
  }, [keys, manifest, wallet?.publicKey]);

  useEffect(() => { refresh(); }, [refresh]);
  // TxLINE settlement binding for this market (World Cup), if any. Drives the receipt.
  useEffect(() => { fetchTxlineBinding(clob.market_pubkey).then(setTxline).catch(() => {}); }, [clob.market_pubkey]);
  // poll the book while open so triggers can fire and the ladder stays live
  useEffect(() => {
    const id = setInterval(() => { refresh(); }, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const midPct = book?.mid != null ? Math.round(book.mid * 100) : null;
  const bestBid = book?.bids?.length ? book.bids[0].price : null;
  // What buying NO costs per share ≈ 1 − (price you sell the paired YES into).
  const noPct = bestBid != null ? Math.round((1 - bestBid) * 100) : (midPct != null ? 100 - midPct : null);

  // Tap a book level to load it into the ticket: an ask → buy YES at it, a bid → sell YES into it.
  const quickFill = (price: number, sd: 'buyYes' | 'sellYes') => { setSide(sd); setPricePct(String(Math.round(price * 100))); };

  const place = async () => {
    if (!manifest) return;
    const s = parseFloat(size);
    if (!isFinite(s) || s <= 0) return globalAlert('Set a size', `Enter how many ${side === 'buyNo' ? 'NO' : 'YES'} shares to trade.`);
    if (!wallet?.publicKey || !wallet?.connected) return globalAlert('Wallet', 'Connect your wallet first.');
    setPlacing(true);
    try {
      const owner = wallet.publicKey instanceof PublicKey ? wallet.publicKey : new PublicKey(wallet.publicKey);

      // ── Buy NO: split collateral into YES+NO, market-sell the YES. One signature. ──
      if (side === 'buyNo') {
        if (bestBid == null) { globalAlert('No liquidity yet', 'There are no bids to take the No side into. Try again once the book has buyers.'); return; }
        const sig = await buyNoViaServer(wallet, { market: manifest, collateralMint: WSOL_MINT, size: s, sellPrice: bestBid });
        setSize('');
        globalAlert('Bought NO', `You hold ${s} NO at about ${noPct}%. If NO wins it redeems 1:1 for collateral. Any change from selling the paired Yes sits in your balance to withdraw.`);
        setTimeout(refresh, 1500);
        return sig;
      }

      // ── Buy YES / Sell YES on the book ──
      const p = parseFloat(pricePct);
      if (!isFinite(p) || p <= 0 || p >= 100) return globalAlert('Set a price', 'Enter a YES price between 1 and 99%.');
      const isBid = side === 'buyYes';
      const beforeOrders = orders.length, beforeYes = seat.yes, beforeQuote = seat.quote;
      const sig = await placeOrderViaServer(wallet, { market: manifest, isBid, price: p / 100, sizeBaseTokens: s, orderType: otype });
      setSize(''); setPricePct('');
      // Honest feedback: confirm the order actually rested or filled rather than
      // always saying "placed" — a too-small / too-far order can no-op on Manifest.
      const [newOrders, newSeat] = await Promise.all([
        readOpenOrders(manifest, owner).catch(() => []),
        readSeatBalance(manifest, owner).catch(() => ({ yes: beforeYes, quote: beforeQuote })),
      ]);
      const rested = newOrders.length > beforeOrders;
      const filled = isBid ? newSeat.yes > beforeYes + 1e-9 : newSeat.quote > beforeQuote + 1e-9;
      if (rested || filled) {
        globalAlert('Order placed', filled ? `Filled ${s} YES at ~${p}%.` : `Resting: ${isBid ? 'buy' : 'sell'} ${s} YES at ${p}%.`);
      } else {
        globalAlert('Order didn’t rest', 'Your funds are safe in your balance. The order didn’t post: try a price nearer the current odds, or a larger size.');
      }
      setTimeout(refresh, 1200);
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      // The on-chain "custom program error: 0x1" / "insufficient funds" on a buy is
      // almost always not enough SOL to cover the collateral + the wrap. Say so plainly.
      if (/0x1\b|insufficient/i.test(msg) && side !== 'sellYes') {
        globalAlert('Not enough SOL', `This ${side === 'buyNo' ? 'No' : 'Yes'} buy needs collateral plus a little for fees. Top up your wallet and try again.`);
      } else {
        globalAlert('Order failed', msg || 'Could not place the order.');
      }
    } finally { setPlacing(false); }
  };

  const cancel = async (o: OpenOrder) => {
    if (!manifest || !wallet?.publicKey) return;
    setCancelId(o.clientOrderId);
    try {
      await cancelOrderViaServer(wallet, manifest, [o.clientOrderId]);
      setOrders((prev) => prev.filter((x) => x.clientOrderId !== o.clientOrderId)); // optimistic
      setTimeout(refresh, 1500);
    } catch (e: any) {
      globalAlert('Cancel failed', e?.message || 'Could not cancel the order.');
    } finally { setCancelId(null); }
  };

  // Pull the full exchange-seat balance (filled YES + deposited collateral) back to the wallet.
  const withdraw = async () => {
    if (!manifest || !wallet?.publicKey) return;
    setWithdrawing(true);
    try {
      await withdrawAllViaServer(wallet, manifest);
      globalAlert('Withdrawn', 'Your YES and collateral were returned to your wallet.');
      setTimeout(refresh, 1500);
    } catch (e: any) {
      globalAlert('Withdraw failed', e?.message || 'Could not withdraw.');
    } finally { setWithdrawing(false); }
  };

  // Owner-only demo control: crank on-demand settlement of this bound market. The
  // proof (not the click) decides the outcome — anyone can call this; in production
  // a cron keeper does it automatically the moment the match is rooted.
  const me = wallet?.publicKey ? (wallet.publicKey instanceof PublicKey ? wallet.publicKey.toBase58() : String(wallet.publicKey)) : null;
  const canSettle = !!me && SETTLE_WALLETS.has(me);
  const settle = async () => {
    setSettling(true);
    try {
      const r = await settleMarket(clob.market_pubkey);
      if (r.ok || r.alreadyResolved) {
        globalAlert('Settled from TxLINE proof', `Outcome: ${r.outcome ? 'YES' : 'NO'}. The market resolved on-chain from the match’s Merkle proof, no admin key involved.`);
        fetchTxlineBinding(clob.market_pubkey).then(setTxline).catch(() => {});
        setTimeout(refresh, 1500);
      } else if (r.pending) {
        globalAlert('Match not final yet', 'TxLINE doesn’t have a rooted final result for this fixture yet. Try again once it’s settled upstream.');
      } else {
        globalAlert('Could not settle', r.error || 'Settlement failed.');
      }
    } catch (e: any) {
      globalAlert('Could not settle', e?.message || 'Settlement failed.');
    } finally { setSettling(false); }
  };

  // fire a trigger: marketable IOC sell of YES at the current mid, then drop it
  const fireTrigger = useCallback(async (t: Trigger, mid: number) => {
    if (firingRef.current.has(t.id) || failedRef.current.has(t.id) || !manifest || !wallet?.connected) return;
    // A trigger sells YES you hold. Don't fire (and don't loop) without enough YES.
    const heldYes = pos?.yes ?? 0;
    if (heldYes < t.size) {
      failedRef.current.add(t.id);
      globalAlert(heldYes <= 0 ? 'Trigger needs YES to sell' : 'Trigger size too large',
        heldYes <= 0 ? `It would sell ${t.size} YES but you hold none. Buy YES, then re-arm it.`
                     : `It would sell ${t.size} YES but you hold ${heldYes.toFixed(2)}. Re-arm with a smaller size.`);
      return;
    }
    // Sell into the best bid so the IOC actually fills — a sell at the mid won't
    // fill when bids sit below it.
    const fillPx = book?.bids?.length ? book.bids[0].price : mid;
    firingRef.current.add(t.id);
    try {
      await placeOrderViaServer(wallet, { market: manifest, isBid: false, price: fillPx, sizeBaseTokens: t.size, orderType: 'ioc' });
      await removeTrigger(t.id);
      setTriggers((prev) => prev.filter((x) => x.id !== t.id));
      globalAlert(t.kind === 'stop' ? 'Stop-loss triggered' : 'Take-profit triggered', `Sold ${t.size} YES at ${Math.round(fillPx * 100)}%.`);
      setTimeout(refresh, 1500);
    } catch (e: any) {
      failedRef.current.add(t.id); // stop the auto-retry loop; user can remove + re-arm
      globalAlert('Trigger could not fire', `${e?.message || 'Order failed'}. Auto-retry is paused — remove and re-arm it after fixing.`);
    } finally { firingRef.current.delete(t.id); }
  }, [manifest, wallet, refresh, pos, book]);

  // monitor: when the book mid crosses a trigger, fire it (while the panel is open)
  useEffect(() => {
    const mid = book?.mid;
    if (mid == null || !wallet?.publicKey || triggers.length === 0) return;
    for (const t of triggers) {
      const crossed = t.kind === 'stop' ? mid <= t.triggerPrice : mid >= t.triggerPrice;
      if (crossed) fireTrigger(t, mid);
    }
  }, [book?.mid, triggers, wallet?.publicKey, fireTrigger]);

  const addTrig = async () => {
    if (!manifest || !wallet?.publicKey) return globalAlert('Wallet', 'Connect your wallet first.');
    const p = parseFloat(trigPrice), s = parseFloat(trigSize);
    if (!isFinite(p) || p <= 0 || p >= 100) return globalAlert('Set a trigger price', 'Enter a price between 1 and 99%.');
    if (!isFinite(s) || s <= 0) return globalAlert('Set a size', 'Enter how many YES tokens to sell when it fires.');
    // A trigger protects a YES position you already hold — and must sit on the
    // correct side of the current price, or it fires the instant you set it.
    const held = pos?.yes ?? 0;
    if (held <= 0) return globalAlert('Buy YES first', `A ${trigKind === 'stop' ? 'stop-loss' : 'take-profit'} sells YES you hold — you have none yet.`);
    if (held < s) return globalAlert('Size too large', `You hold ${held.toFixed(2)} YES. Set the sell size to ${held.toFixed(2)} or less.`);
    const mid = book?.mid;
    if (mid != null) {
      if (trigKind === 'stop' && p / 100 >= mid) return globalAlert('Stop sits below the price', `YES is at ${Math.round(mid * 100)}%. A stop-loss fires when it falls — set it below ${Math.round(mid * 100)}%.`);
      if (trigKind === 'takeProfit' && p / 100 <= mid) return globalAlert('Take-profit sits above the price', `YES is at ${Math.round(mid * 100)}%. A take-profit fires when it rises — set it above ${Math.round(mid * 100)}%.`);
    }
    const owner = wallet.publicKey instanceof PublicKey ? wallet.publicKey : new PublicKey(wallet.publicKey);
    const rec = await addTrigger({ market: manifest.toBase58(), owner: owner.toBase58(), kind: trigKind, triggerPrice: p / 100, size: s });
    setTriggers((prev) => [...prev, rec]);
    setTrigPrice(''); setTrigSize('');
  };
  const cancelTrig = async (id: string) => {
    await removeTrigger(id);
    setTriggers((prev) => prev.filter((x) => x.id !== id));
  };

  // Validate a trigger the same way for both device + away modes (protects a YES
  // position you hold, on the correct side of the current price).
  const validateTrig = (p: number, s: number): string | null => {
    if (!isFinite(p) || p <= 0 || p >= 100) return 'Enter a trigger price between 1 and 99%.';
    if (!isFinite(s) || s <= 0) return 'Enter how many YES tokens to sell when it fires.';
    const held = pos?.yes ?? 0;
    if (held <= 0) return `A ${trigKind === 'stop' ? 'stop-loss' : 'take-profit'} sells YES you hold. You have none yet.`;
    if (held < s) return `You hold ${held.toFixed(2)} YES. Set the sell size to ${held.toFixed(2)} or less.`;
    const mid = book?.mid;
    if (mid != null) {
      if (trigKind === 'stop' && p / 100 >= mid) return `YES is at ${Math.round(mid * 100)}%. A stop-loss fires when it falls, so set it below ${Math.round(mid * 100)}%.`;
      if (trigKind === 'takeProfit' && p / 100 <= mid) return `YES is at ${Math.round(mid * 100)}%. A take-profit fires when it rises, so set it above ${Math.round(mid * 100)}%.`;
    }
    return null;
  };

  // Arm a trigger that fires through the server keeper even while Ilowa is closed.
  const armAway = async () => {
    if (!manifest || !wallet?.publicKey) return globalAlert('Wallet', 'Connect your wallet first.');
    const p = parseFloat(trigPrice), s = parseFloat(trigSize);
    const err = validateTrig(p, s);
    if (err) return globalAlert('Check the trigger', err);
    setArming(true);
    try {
      await armServerTrigger(wallet, { market: manifest, scalarMarketId: (clob as any).scalar_market_id ?? null, kind: trigKind, triggerPrice: p / 100, size: s });
      setTrigPrice(''); setTrigSize('');
      globalAlert('Armed to fire while away',
        `It sells ${s} YES when YES ${trigKind === 'stop' ? 'falls to' : 'rises to'} ${Math.round(p)}%, even with Ilowa closed. You signed the exact order once; it can do nothing else.`);
      setTimeout(refresh, 1800);
    } catch (e: any) {
      globalAlert('Could not arm', e?.message || 'Failed to arm the trigger.');
    } finally { setArming(false); }
  };

  const revokeAway = async (t: ServerTrigger) => {
    if (!wallet?.publicKey) return;
    setRevokingId(t.id);
    try {
      const owner = wallet.publicKey instanceof PublicKey ? wallet.publicKey : new PublicKey(wallet.publicKey);
      await revokeServerTrigger(t.id, owner);
      setServerTrigs((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e: any) {
      globalAlert('Could not cancel', e?.message || 'Failed to cancel.');
    } finally { setRevokingId(null); }
  };

  const awayActive = serverTrigs.filter((t) => t.status === 'armed' || t.status === 'firing');

  const fieldStyle = (active: boolean) => [styles.field, { borderColor: active ? accent : HAIR }, CARVE];

  if (!keys || !manifest) return null; // malformed mapping — don't break the card

  return (
    <View style={styles.wrap}>
      {/* TxLINE settlement receipt (World Cup markets) */}
      {txline ? <TxlineReceipt binding={txline} accent={accent} /> : null}
      {/* Owner-only: settle this bound market on-demand from the TxLINE proof (demo). */}
      {canSettle && txline && txline.status !== 'resolved' ? (
        <Pressable onPress={settle} disabled={settling} style={[styles.settleBtn, { borderColor: accent, backgroundColor: `${accent}14` }]}>
          {settling ? <ActivityIndicator size="small" color={accent} />
            : <Text style={[styles.settleTxt, { color: accent }]}>Settle from TxLINE proof</Text>}
        </Pressable>
      ) : null}
      {/* live price — both sides of the binary */}
      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>ORDER BOOK</Text>
        <Text style={[styles.priceVal, { color: accent }]}>
          {midPct != null ? `${midPct}% YES · ${100 - midPct}% NO` : 'No orders yet'}
        </Text>
      </View>
      {/* depth ladder: top 3 asks (sell side) over top 3 bids (buy side) */}
      {book && (book.bids.length > 0 || book.asks.length > 0) ? (
        <View style={styles.ladder}>
          {[...book.asks].sort((a, b) => a.price - b.price).slice(0, 3).reverse().map((o, i) => (
            <Pressable key={`a${i}`} onPress={() => quickFill(o.price, 'buyYes')} style={styles.ladderRow}>
              <Text style={[styles.ladderPx, { color: RED }]}>{Math.round(o.price * 100)}%</Text>
              <Text style={styles.ladderSz}>{o.size}</Text>
            </Pressable>
          ))}
          <View style={styles.ladderMid} />
          {[...book.bids].sort((a, b) => b.price - a.price).slice(0, 3).map((o, i) => (
            <Pressable key={`b${i}`} onPress={() => quickFill(o.price, 'sellYes')} style={styles.ladderRow}>
              <Text style={[styles.ladderPx, { color: GREEN }]}>{Math.round(o.price * 100)}%</Text>
              <Text style={styles.ladderSz}>{o.size}</Text>
            </Pressable>
          ))}
          <Text style={styles.ladderHint}>Tap any price to load it into your order</Text>
        </View>
      ) : null}

      {/* side: pick your outcome. Buy YES / Buy NO take the two sides of the binary;
          Sell YES exits a YES position. */}
      <View style={styles.sideRow}>
        {([['buyYes', `Buy YES${midPct != null ? ` ${midPct}%` : ''}`, GREEN], ['buyNo', `Buy NO${noPct != null ? ` ${noPct}%` : ''}`, RED], ['sellYes', 'Sell YES', ILOWA_COLORS.textSecondary]] as const).map(([sd, label, c]) => {
          const on = side === sd;
          return (
            <Pressable key={sd} onPress={() => setSide(sd)} style={[styles.sideBtn, { borderColor: on ? c : HAIR, backgroundColor: on ? `${c}22` : FIELD_BG }, CARVE]}>
              <Text style={[styles.sideTxt, { color: on ? c : ILOWA_COLORS.textSecondary }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* order type: only meaningful for the YES book (Buy NO is always a market fill). */}
      {side !== 'buyNo' ? (
        <View style={styles.sideRow}>
          {([['limit', 'Limit'], ['ioc', 'Market']] as const).map(([k, label]) => {
            const on = otype === k;
            return (
              <Pressable key={k} onPress={() => setOtype(k)} style={[styles.typeBtn, { borderColor: on ? accent : HAIR, backgroundColor: on ? `${accent}1A` : FIELD_BG }, CARVE]}>
                <Text style={[styles.typeTxt, { color: on ? accent : ILOWA_COLORS.textMuted }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* price (YES book only) + size */}
      <View style={styles.inputsRow}>
        {side !== 'buyNo' ? (
          <View style={fieldStyle(!!pricePct)}>
            <TextInput
              style={[styles.input, { color: pricePct ? accent : ILOWA_COLORS.textPrimary }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null]}
              value={pricePct} onChangeText={setPricePct} keyboardType="decimal-pad" placeholder="price" placeholderTextColor={ILOWA_COLORS.textMuted}
            />
            <Text style={styles.unit}>%</Text>
          </View>
        ) : null}
        <View style={fieldStyle(!!size)}>
          <TextInput
            style={[styles.input, { color: size ? accent : ILOWA_COLORS.textPrimary }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null]}
            value={size} onChangeText={setSize} keyboardType="decimal-pad" placeholder="size" placeholderTextColor={ILOWA_COLORS.textMuted}
          />
          <Text style={styles.unit}>{side === 'buyNo' ? 'NO' : 'YES'}</Text>
        </View>
      </View>

      {/* place */}
      <Pressable onPress={place} disabled={placing} style={[styles.placeBtn, { backgroundColor: (side === 'buyYes' ? GREEN : side === 'buyNo' ? RED : '#8892a0') + (placing ? '55' : '') }]}>
        {placing ? <ActivityIndicator size="small" color="#06120B" />
          : <Text style={styles.placeTxt}>{side === 'buyYes' ? 'Buy YES' : side === 'buyNo' ? 'Buy NO' : 'Sell YES'}</Text>}
      </Pressable>

      {/* position */}
      {pos && (pos.yes > 0 || pos.no > 0) ? (
        <Text style={styles.pos}>You hold {pos.yes.toFixed(2)} YES · {pos.no.toFixed(2)} NO</Text>
      ) : null}

      {/* Pull filled YES + deposited collateral back to the wallet. */}
      {seat.yes > 0.000001 || seat.quote > 0.000001 ? (
        <Pressable onPress={withdraw} disabled={withdrawing} style={[styles.withdrawBtn, { borderColor: accent }]}>
          {withdrawing ? <ActivityIndicator size="small" color={accent} />
            : <Text style={[styles.withdrawTxt, { color: accent }]}>
                Withdraw {[seat.yes > 0 ? `${seat.yes.toFixed(2)} YES` : '', seat.quote > 0 ? `${seat.quote.toFixed(3)} collateral` : ''].filter(Boolean).join(' · ')} to wallet
              </Text>}
        </Pressable>
      ) : null}

      {/* your open orders — tap ✕ to cancel */}
      {orders.length > 0 ? (
        <View style={styles.orders}>
          <Text style={styles.ordersLabel}>YOUR OPEN ORDERS</Text>
          {orders.map((o) => {
            const c = o.isBid ? GREEN : RED;
            const busy = cancelId === o.clientOrderId;
            return (
              <View key={o.clientOrderId} style={[styles.orderRow, CARVE]}>
                <Text style={[styles.orderSide, { color: c }]}>{o.isBid ? 'BUY' : 'SELL'}</Text>
                <Text style={styles.orderTxt}>{o.size} YES @ {Math.round(o.price * 100)}%</Text>
                <Pressable onPress={() => cancel(o)} disabled={busy} hitSlop={8} style={styles.cancelBtn}>
                  {busy ? <ActivityIndicator size="small" color={ILOWA_COLORS.textMuted} />
                    : <Text style={styles.cancelX}>✕</Text>}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* stop / take-profit */}
      <Pressable onPress={() => setShowTrig((v) => !v)} style={styles.trigHead}>
        <Text style={styles.trigHeadTxt}>Stop / take-profit{triggers.length + awayActive.length > 0 ? ` · ${triggers.length + awayActive.length} active` : ''}</Text>
        <Text style={styles.trigChev}>{showTrig ? '–' : '+'}</Text>
      </Pressable>
      {showTrig ? (
        <View style={styles.trigBody}>
          {/* fire mode: while away (keeper) vs this device only */}
          <View style={styles.sideRow}>
            {([['device', 'This device'], ['away', 'Fires while away']] as const).map(([k, label]) => {
              const on = (k === 'away') === awayMode;
              return (
                <Pressable key={k} onPress={() => setAwayMode(k === 'away')} style={[styles.typeBtn, { borderColor: on ? accent : HAIR, backgroundColor: on ? `${accent}1A` : FIELD_BG }, CARVE]}>
                  <Text style={[styles.typeTxt, { color: on ? accent : ILOWA_COLORS.textMuted }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.sideRow}>
            {([['stop', 'Stop-loss'], ['takeProfit', 'Take-profit']] as const).map(([k, label]) => {
              const on = trigKind === k;
              return (
                <Pressable key={k} onPress={() => setTrigKind(k)} style={[styles.typeBtn, { borderColor: on ? accent : HAIR, backgroundColor: on ? `${accent}1A` : FIELD_BG }, CARVE]}>
                  <Text style={[styles.typeTxt, { color: on ? accent : ILOWA_COLORS.textMuted }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.inputsRow}>
            <View style={fieldStyle(!!trigPrice)}>
              <TextInput
                style={[styles.input, { color: trigPrice ? accent : ILOWA_COLORS.textPrimary }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null]}
                value={trigPrice} onChangeText={setTrigPrice} keyboardType="decimal-pad"
                placeholder={trigKind === 'stop' ? 'if YES falls to' : 'if YES rises to'} placeholderTextColor={ILOWA_COLORS.textMuted}
              />
              <Text style={styles.unit}>%</Text>
            </View>
            <View style={fieldStyle(!!trigSize)}>
              <TextInput
                style={[styles.input, { color: trigSize ? accent : ILOWA_COLORS.textPrimary }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null]}
                value={trigSize} onChangeText={setTrigSize} keyboardType="decimal-pad" placeholder="amount" placeholderTextColor={ILOWA_COLORS.textMuted}
              />
              <Text style={styles.unit}>YES</Text>
            </View>
          </View>
          {/* quick-fill the SELL AMOUNT as a % of what you hold (it's a token amount, not a %). */}
          {(pos?.yes ?? 0) > 0 ? (
            <View style={styles.pctRow}>
              {([['25%', 0.25], ['50%', 0.5], ['Max', 1]] as const).map(([label, frac]) => (
                <Pressable key={label} onPress={() => setTrigSize(String(+(((pos?.yes ?? 0)) * frac).toFixed(4)))} style={[styles.pctChip, CARVE]}>
                  <Text style={styles.pctTxt}>{label}</Text>
                </Pressable>
              ))}
              <Text style={styles.pctHint}>of your {(pos?.yes ?? 0).toFixed(2)} YES</Text>
            </View>
          ) : null}
          <Pressable onPress={awayMode ? armAway : addTrig} disabled={arming} style={[styles.trigSet, { borderColor: accent }]}>
            {arming ? <ActivityIndicator size="small" color={accent} />
              : <Text style={[styles.trigSetTxt, { color: accent }]}>{awayMode ? 'Arm to fire while away' : 'Set device trigger'}</Text>}
          </Pressable>

          {/* device-local triggers (fire only while this screen is open) */}
          {triggers.map((t) => (
            <View key={t.id} style={[styles.orderRow, CARVE]}>
              <Text style={[styles.orderSide, { color: t.kind === 'stop' ? RED : GREEN, width: 64 }]}>{t.kind === 'stop' ? 'STOP' : 'TAKE-PFT'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderTxt}>sell {t.size} YES {t.kind === 'stop' ? '≤' : '≥'} {Math.round(t.triggerPrice * 100)}%</Text>
                <Text style={styles.awayTag}>This device only</Text>
              </View>
              <Pressable onPress={() => cancelTrig(t.id)} hitSlop={8} style={styles.cancelBtn}><Text style={styles.cancelX}>✕</Text></Pressable>
            </View>
          ))}

          {/* server-keeper triggers (fire even while Ilowa is closed) */}
          {serverTrigs.filter((t) => t.status !== 'revoked').map((t) => {
            const active = t.status === 'armed' || t.status === 'firing';
            const label = active ? 'Armed · fires while away'
              : t.status === 'fired' ? 'Fired' : t.status === 'failed' ? 'Did not fire' : t.status;
            return (
              <View key={t.id} style={[styles.orderRow, CARVE]}>
                <Text style={[styles.orderSide, { color: t.kind === 'stop' ? RED : GREEN, width: 64 }]}>{t.kind === 'stop' ? 'STOP' : 'TAKE-PFT'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderTxt}>sell {t.size} YES {t.kind === 'stop' ? '≤' : '≥'} {Math.round(t.trigger_price * 100)}%</Text>
                  <Text style={[styles.awayTag, { color: active ? accent : ILOWA_COLORS.textMuted }]}>{label}</Text>
                </View>
                {active ? (
                  <Pressable onPress={() => revokeAway(t)} disabled={revokingId === t.id} hitSlop={8} style={styles.cancelBtn}>
                    {revokingId === t.id ? <ActivityIndicator size="small" color={RED} /> : <Text style={styles.cancelX}>✕</Text>}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <Text style={styles.note}>{awayMode
            ? 'You sign the exact sell once. Ilowa’s keeper relays it when the price crosses, even with the app closed, and can do nothing else. A small nonce rent (~0.0015 SOL) is refunded when you cancel.'
            : 'Device triggers fire a market sell only while Ilowa is open on this screen.'}</Text>
        </View>
      ) : null}

      <Text style={styles.note}>Limit order on Manifest. The mid price is the live odds.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 9 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceLabel: { fontFamily: 'Inter', fontSize: 10, letterSpacing: 1.2, color: ILOWA_COLORS.textMuted },
  priceVal: { fontFamily: 'Sora-Bold', fontSize: 16 },
  depth: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: ILOWA_COLORS.textSecondary, marginTop: -4 },
  ladder: { gap: 2, paddingVertical: 4 },
  ladderRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  ladderPx: { fontFamily: 'Geist-SemiBold', fontSize: 11.5 },
  ladderSz: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: ILOWA_COLORS.textMuted },
  ladderMid: { height: 1, backgroundColor: HAIR, marginVertical: 3 },
  ladderHint: { fontFamily: 'Inter', fontSize: 10, color: ILOWA_COLORS.textMuted, textAlign: 'center', marginTop: 6, opacity: 0.8 },
  sideRow: { flexDirection: 'row', gap: 9 },
  sideBtn: { flex: 1, borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: 'center' },
  typeBtn: { flex: 1, borderWidth: 1, borderRadius: 9, paddingVertical: 8, alignItems: 'center' },
  typeTxt: { fontFamily: 'Inter-Medium', fontSize: 12 },
  sideTxt: { fontFamily: 'Sora-SemiBold', fontSize: 13.5 },
  inputsRow: { flexDirection: 'row', gap: 9 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: FIELD_BG },
  input: { flex: 1, fontFamily: 'Geist-SemiBold', fontSize: 14, paddingVertical: 2 },
  unit: { fontFamily: 'Inter-Medium', fontSize: 12, color: ILOWA_COLORS.textMuted },
  placeBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  placeTxt: { fontFamily: 'Sora-SemiBold', fontSize: 14, color: '#06120B' },
  pos: { fontFamily: 'Geist-SemiBold', fontSize: 12, color: ILOWA_COLORS.textSecondary, textAlign: 'center' },
  settleBtn: { borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: 'center', marginBottom: 2 },
  settleTxt: { fontFamily: 'Sora-SemiBold', fontSize: 13 },
  withdrawBtn: { borderWidth: 1, borderRadius: 11, paddingVertical: 10, alignItems: 'center', marginTop: 2 },
  withdrawTxt: { fontFamily: 'Sora-SemiBold', fontSize: 12.5 },
  orders: { gap: 5, marginTop: 2 },
  ordersLabel: { fontFamily: 'Inter', fontSize: 10, letterSpacing: 1.2, color: ILOWA_COLORS.textMuted },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: FIELD_BG },
  orderSide: { fontFamily: 'Sora-Bold', fontSize: 10.5, letterSpacing: 0.5, width: 32 },
  orderTxt: { flex: 1, fontFamily: 'Geist-Medium', fontSize: 12.5, color: ILOWA_COLORS.textSecondary },
  cancelBtn: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(240,69,91,0.14)' },
  cancelX: { fontFamily: 'Sora-Bold', fontSize: 12, color: RED, lineHeight: 14 },
  trigHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  trigHeadTxt: { fontFamily: 'Sora-SemiBold', fontSize: 12.5, color: ILOWA_COLORS.textSecondary },
  trigChev: { fontFamily: 'Sora-Bold', fontSize: 16, color: ILOWA_COLORS.textMuted, width: 18, textAlign: 'center' },
  trigBody: { gap: 9, marginTop: 2 },
  trigSet: { borderWidth: 1, borderRadius: 11, paddingVertical: 10, alignItems: 'center' },
  awayTag: { fontFamily: 'Inter-Medium', fontSize: 10, color: ILOWA_COLORS.textMuted, marginTop: 1 },
  pctRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -3 },
  pctChip: { borderWidth: 1, borderColor: HAIR, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 11, backgroundColor: FIELD_BG },
  pctTxt: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: ILOWA_COLORS.textSecondary },
  pctHint: { fontFamily: 'Inter', fontSize: 10.5, color: ILOWA_COLORS.textMuted, marginLeft: 2 },
  trigSetTxt: { fontFamily: 'Sora-SemiBold', fontSize: 13 },
  note: { fontFamily: 'Inter', fontSize: 11, lineHeight: 15, color: ILOWA_COLORS.textMuted, textAlign: 'center' },
});
