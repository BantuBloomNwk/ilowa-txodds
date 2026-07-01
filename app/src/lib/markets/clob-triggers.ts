/**
 * Stop / take-profit triggers for CLOB markets — device-local.
 *
 * Manifest (like every CLOB) has no native resting stop order, and a server
 * keeper can't place an order for a user without their signature (non-custodial).
 * So a trigger fires CLIENT-SIDE: while the market panel is open, the app polls
 * the book mid and, when the trigger price is crossed, submits a marketable IOC
 * sell of the user's YES. Because firing happens on the open device, the trigger
 * naturally lives on that device (AsyncStorage), not a shared server.
 *
 * MVP scope: protects a long YES position -> a fired trigger SELLS YES.
 *  - stop:        sell when mid <= triggerPrice (price falling)   [evalTrigger]
 *  - takeProfit:  sell when mid >= triggerPrice (price rising)    [evalTrigger]
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TriggerKind = 'stop' | 'takeProfit';
export interface Trigger {
  id: string;
  market: string;        // manifest market pubkey (base58)
  owner: string;         // wallet pubkey (base58)
  kind: TriggerKind;
  triggerPrice: number;  // probability 0..1
  size: number;          // YES tokens to sell when fired
  createdAt: number;
}

const KEY = 'clob:triggers:v1';

async function readAll(): Promise<Trigger[]> {
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Trigger[]) : []; }
  catch { return []; }
}
async function writeAll(all: Trigger[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(all)); } catch { /* best-effort */ }
}

/** Active triggers for a given market + owner. */
export async function listTriggers(market: string, owner: string): Promise<Trigger[]> {
  return (await readAll()).filter((t) => t.market === market && t.owner === owner);
}

/** Persist a new trigger; returns the stored record (with id). */
export async function addTrigger(t: Omit<Trigger, 'id' | 'createdAt'>): Promise<Trigger> {
  const all = await readAll();
  const rec: Trigger = { ...t, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() };
  all.push(rec);
  await writeAll(all);
  return rec;
}

/** Remove a trigger (cancelled, or after it fired). */
export async function removeTrigger(id: string): Promise<void> {
  await writeAll((await readAll()).filter((t) => t.id !== id));
}
