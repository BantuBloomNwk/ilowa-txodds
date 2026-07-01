/**
 * TxODDS TxLINE World Cup data feed (devnet hackathon tier).
 *
 * PROVEN LIVE 2026-06-28: on-chain subscribe to Service Level 1 (free, no TxL) on
 * devnet program 6pW64gN…, then activate an API token at txline-dev.txodds.com
 * (NOT oracle-dev.txodds.com — dead — and NOT txline.txodds.com — that's mainnet).
 * Data uses two headers: Authorization: Bearer <guest jwt> and X-Api-Token: <token>.
 * World Cup competitionId = 72. See docs/specs/txodds-worldcup-runbook.md.
 *
 * Falls back to a small simulated set when no token is configured or the API is
 * down, so the demo path never breaks (the contest allows simulated data).
 */
// Read env via a DYNAMIC key so Next.js/webpack can't inline it at build. A
// literal `process.env.TXODDS_API_TOKEN` gets replaced with the build-time value
// (empty, since Fly secrets aren't in the build's .env), even inside a function.
// `process.env[key]` with a variable key stays a true runtime lookup of the
// machine env (which does have the Fly secret).
const readEnv = (k: string) => process.env[k] || '';
const base = () => readEnv('TXODDS_API_BASE') || 'https://txline-dev.txodds.com';
// Devnet World Cup data token. Supplied at runtime via TXODDS_API_TOKEN (fly.toml
// [env] on the deployed machine). When it's absent the feed serves SIM_FIXTURES,
// so local dev works with no secret. Activate/rotate via the activation script.
const apiToken = () => readEnv('TXODDS_API_TOKEN');
export const WC_COMPETITION_ID = 72;

export interface Fixture {
  fixtureId: number;
  competition: string;
  competitionId: number;
  home: string;
  away: string;
  startTime: number; // ms epoch
  homeIsP1: boolean;
}

const SIM_FIXTURES: Fixture[] = [
  { fixtureId: 90000001, competition: 'World Cup (sim)', competitionId: WC_COMPETITION_ID, home: 'Nigeria', away: 'Argentina', startTime: Date.now() + 3 * 3600_000, homeIsP1: true },
  { fixtureId: 90000002, competition: 'World Cup (sim)', competitionId: WC_COMPETITION_ID, home: 'Brazil', away: 'Morocco', startTime: Date.now() + 6 * 3600_000, homeIsP1: true },
];

async function guestJwt(): Promise<string> {
  const r = await fetch(`${base()}/auth/guest/start`, { method: 'POST' });
  if (!r.ok) throw new Error(`guest auth ${r.status}`);
  return (await r.json()).token;
}
function authHeaders(jwt: string) {
  return { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken() };
}

function normalizeFixture(f: any): Fixture {
  const p1Home = !!f.Participant1IsHome;
  return {
    fixtureId: Number(f.FixtureId),
    competition: String(f.Competition ?? 'World Cup'),
    competitionId: Number(f.CompetitionId ?? WC_COMPETITION_ID),
    home: p1Home ? f.Participant1 : f.Participant2,
    away: p1Home ? f.Participant2 : f.Participant1,
    startTime: Number(f.StartTime),
    homeIsP1: p1Home,
  };
}

/** Live World Cup fixtures, or the sim set when the feed is unavailable. */
export async function worldCupFixtures(): Promise<{ live: boolean; fixtures: Fixture[]; reason?: string }> {
  if (!apiToken()) return { live: false, fixtures: SIM_FIXTURES, reason: 'no TXODDS_API_TOKEN' };
  try {
    const jwt = await guestJwt();
    const r = await fetch(`${base()}/api/fixtures/snapshot?competitionId=${WC_COMPETITION_ID}`, { headers: authHeaders(jwt), cache: 'no-store' });
    if (!r.ok) { const body = (await r.text()).slice(0, 200); console.warn('[txodds] fixtures HTTP', r.status, body); return { live: false, fixtures: SIM_FIXTURES, reason: `fixtures HTTP ${r.status}: ${body}` }; }
    const raw = await r.json();
    const fixtures = Array.isArray(raw) ? raw.map(normalizeFixture).filter((x) => Number.isFinite(x.fixtureId)) : [];
    return fixtures.length ? { live: true, fixtures } : { live: false, fixtures: SIM_FIXTURES, reason: 'feed returned no fixtures' };
  } catch (e: any) {
    console.warn('[txodds] fixtures error', e?.message || e);
    return { live: false, fixtures: SIM_FIXTURES, reason: `error: ${e?.message || e}` };
  }
}

/** Authenticated GET against the TxLINE feed (guest jwt + api token). Shared by the
 *  settlement layer so the auth lives in one place. */
export async function txGet(path: string): Promise<Response> {
  const jwt = await guestJwt();
  return fetch(`${base()}${path}`, { headers: authHeaders(jwt), cache: 'no-store' });
}
export const hasToken = () => !!apiToken();

/** Raw scores snapshot for a fixture (event stream the program settles against). */
export async function scoresSnapshot(fixtureId: number): Promise<{ live: boolean; events: any[] }> {
  if (!apiToken()) return { live: false, events: [] };
  try {
    const jwt = await guestJwt();
    const r = await fetch(`${base()}/api/scores/snapshot/${fixtureId}`, { headers: authHeaders(jwt), cache: 'no-store' });
    if (!r.ok) return { live: false, events: [] };
    const events = await r.json();
    return { live: true, events: Array.isArray(events) ? events : [] };
  } catch {
    return { live: false, events: [] };
  }
}
