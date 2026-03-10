const DEFAULT_DEV_SOCKET = `http://${window.location.hostname}:3001`;

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.trim() ||
  (import.meta.env.PROD ? undefined : DEFAULT_DEV_SOCKET);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeOrigin(origin) {
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

export function isLoopbackHost(hostname = window.location.hostname) {
  return LOOPBACK_HOSTS.has(String(hostname).toLowerCase());
}

export function buildPadUrl(origin, sessionId) {
  return `${normalizeOrigin(origin)}/pad/${sessionId}`;
}

// Resolve an origin suitable for sharing with phone devices in dev mode.
export async function resolveShareOrigin() {
  const explicitOrigin = import.meta.env.VITE_SHARE_ORIGIN?.trim();
  if (explicitOrigin) {
    return normalizeOrigin(explicitOrigin);
  }

  if (import.meta.env.PROD || !isLoopbackHost()) {
    return window.location.origin;
  }

  const frontendPort = window.location.port ? `:${window.location.port}` : '';
  const socketBase = SOCKET_URL || DEFAULT_DEV_SOCKET;

  try {
    const res = await fetch(`${socketBase}/api/network-info`, { cache: 'no-store' });
    if (!res.ok) {
      return window.location.origin;
    }

    const payload = await res.json();
    const lanHost = Array.isArray(payload.addresses) ? payload.addresses[0] : '';
    if (!lanHost) {
      return window.location.origin;
    }

    return `${window.location.protocol}//${lanHost}${frontendPort}`;
  } catch {
    return window.location.origin;
  }
}
