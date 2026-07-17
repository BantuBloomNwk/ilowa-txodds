/**
 * Secure API Client
 *
 * All external API calls route through the VPS proxy server.
 * No API keys are stored client-side, the server holds them.
 *
 * Client → VPS Proxy (rate-limited, key-injected) → External API
 */

const VPS_URL = process.env.EXPO_PUBLIC_VPS_API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export function getVpsUrl(): string {
  return VPS_URL;
}

/**
 * True when the configured VPS URL is something we can actually reach
 * from the current origin. On the production PWA there is no VPS, the
 * default `http://localhost:3000` would just trigger CSP violations and
 * noisy console errors. Treat that as "not configured" and have callers
 * short-circuit. Native (no `window`) always proceeds; localhost dev
 * pages calling localhost APIs also proceed.
 */
export function isVpsConfigured(): boolean {
  if (!VPS_URL) return false;
  if (typeof window === 'undefined' || !window.location?.origin) return true;
  const here = window.location.origin;
  const vpsIsLocal =
    VPS_URL.startsWith('http://localhost') ||
    VPS_URL.startsWith('http://127.') ||
    VPS_URL.startsWith('http://0.0.0.0');
  const hereIsLocal =
    here.startsWith('http://localhost') ||
    here.startsWith('http://127.') ||
    here.startsWith('http://0.0.0.0');
  return !vpsIsLocal || hereIsLocal;
}

// ── Service availability cache ────────────────────────────────
// Fetched once from /api/services/status, refreshed every 5 min.

interface ServiceStatus {
  cohere: boolean;
  glm5: boolean;
  lelapa: boolean;
  gladia: boolean;
  pinata: boolean;
  tapestry: boolean;
  livepeer: boolean;
}

let _status: ServiceStatus | null = null;
let _statusFetchedAt = 0;
let _statusPromise: Promise<ServiceStatus> | null = null;
const STATUS_TTL = 5 * 60_000; // 5 minutes

async function fetchServiceStatus(): Promise<ServiceStatus> {
  // Skip the network call entirely when the VPS isn't reachable from
  // this origin, otherwise the production PWA fires a CSP violation
  // for every /api/services/status request on first paint.
  if (!isVpsConfigured()) {
    _statusFetchedAt = Date.now();
    _status = {
      cohere: false, glm5: false, lelapa: false,
      gladia: false, pinata: false, tapestry: false, livepeer: false,
    };
    return _status;
  }
  try {
    const res = await fetch(`${VPS_URL}/api/services/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    _status = data as ServiceStatus;
    _statusFetchedAt = Date.now();
    return _status;
  } catch (err: any) {
    console.warn('[API Client] Service status fetch failed:', err?.message);
    // VPS unreachable, mark all services as unavailable so callers
    // don't attempt requests that will fail with confusing errors.
    return {
      cohere: false, glm5: false, lelapa: false,
      gladia: false, pinata: false, tapestry: false, livepeer: false,
    };
  }
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  if (_status && Date.now() - _statusFetchedAt < STATUS_TTL) {
    return _status;
  }
  // Deduplicate concurrent calls
  if (!_statusPromise) {
    _statusPromise = fetchServiceStatus().finally(() => { _statusPromise = null; });
  }
  return _statusPromise;
}

export async function isServiceAvailable(service: keyof ServiceStatus): Promise<boolean> {
  const status = await getServiceStatus();
  return status[service] ?? false;
}

// Synchronous check using cached value (for hot paths like isAyaAvailable)
export function isServiceAvailableSync(service: keyof ServiceStatus): boolean {
  if (!_status) return false; // safe default until first fetch completes
  return _status[service] ?? false;
}

// Kick off initial fetch at module load time
getServiceStatus().catch(() => {});
