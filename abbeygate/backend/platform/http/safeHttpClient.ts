import dns from 'node:dns/promises';
import net from 'node:net';

const blockedHosts = new Set(['localhost', '127.0.0.1', '::1']);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return false;
}

async function assertAllowedDestination(target: string): Promise<void> {
  const parsed = new URL(target);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS webhook destinations are allowed');
  }
  const host = String(parsed.hostname || '').toLowerCase();
  if (blockedHosts.has(host)) {
    throw new Error(`Blocked destination host: ${host}`);
  }
  const resolved = await dns.lookup(host, { all: true });
  if (!resolved.length) throw new Error('Destination host resolution failed');
  for (const entry of resolved) {
    if (isBlockedIp(entry.address)) {
      throw new Error(`Blocked destination IP: ${entry.address}`);
    }
  }
}

export async function safePostJson(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<Response> {
  await assertAllowedDestination(url);
  return fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
}
