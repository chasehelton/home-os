import dns from 'node:dns/promises';
import net from 'node:net';

export class FetchSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchSafetyError';
  }
}

/**
 * Reject anything that resolves to a private, loopback, link-local, or
 * reserved address. Belt-and-braces SSRF guard: run before the fetch,
 * and also check after redirects.
 */
export async function assertPublicUrl(urlString: string): Promise<void> {
  const url = new URL(urlString);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchSafetyError(`unsupported protocol: ${url.protocol}`);
  }
  const hostname = url.hostname;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new FetchSafetyError(`private IP: ${hostname}`);
    return;
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new FetchSafetyError(`dns lookup failed: ${hostname}`);
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new FetchSafetyError(`host resolves to private IP: ${hostname} -> ${a.address}`);
    }
  }
}

function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) return isPrivateIpv6(ip);
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // unique-local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — extract and check the v4 portion
    return isPrivateIpv4(lower.slice(7));
  }
  return false;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  accept?: string;
  userAgent?: string;
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  contentType: string | null;
  finalUrl: string;
}

/**
 * Fetches a URL with SSRF guard, size limit, timeout, manual redirect handling
 * (so we can re-check each hop against the SSRF allow rules).
 */
export async function safeFetch(
  initialUrl: string,
  opts: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(currentUrl);
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        accept: opts.accept ?? '*/*',
        'user-agent': opts.userAgent ?? 'home-os/0.1 (+https://github.com/chasehelton/home-os)',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new FetchSafetyError(`redirect without location (${res.status})`);
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    if (!res.ok) {
      throw new FetchSafetyError(`http ${res.status}`);
    }
    const bytes = await readCapped(res, opts.maxBytes);
    return {
      bytes,
      contentType: res.headers.get('content-type'),
      finalUrl: currentUrl,
    };
  }
  throw new FetchSafetyError('too many redirects');
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > cap) throw new FetchSafetyError(`response exceeds ${cap} bytes`);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new FetchSafetyError(`response exceeds ${cap} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
