/**
 * URL Security, SSRF Protection, Tracker Stripping, and Tag-Safe HTML Truncation Utilities
 */

const EXACT_TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'oly_enc_id',
  'oly_anon_id',
  'rb_clickid',
  's_kwcid',
  'mkt_tok',
  '_ga',
  '_gl',
  'yclid',
]);

export function isTrackingParamName(paramName: string): boolean {
  const lower = paramName.trim().toLowerCase();
  if (!lower) return false;
  if (lower.startsWith('utm_')) return true;
  return EXACT_TRACKING_PARAMS.has(lower);
}

/**
 * Strips known tracking query parameters and fingerprinting tokens from a URL.
 */
export function stripTrackingParams(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().replace(/&amp;/gi, '&');
  if (!trimmed || !trimmed.includes('?')) return trimmed;

  const isProtocolRelative = trimmed.startsWith('//');
  const isAbsolute = /^https?:\/\//i.test(trimmed) || isProtocolRelative;

  try {
    const parsed = isAbsolute
      ? new URL(isProtocolRelative ? `https:${trimmed}` : trimmed)
      : new URL(trimmed, 'https://www.thedailystar.net');

    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (isTrackingParamName(key)) {
        keysToDelete.push(key);
      }
    });

    if (keysToDelete.length === 0) {
      return trimmed;
    }

    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }

    if (isAbsolute) {
      const result = parsed.toString();
      // Preserve no trailing slash when original URL had no path slash before '?'
      const beforeQuery = trimmed.split('?')[0];
      if (
        parsed.pathname === '/' &&
        !beforeQuery.endsWith('/') &&
        !parsed.search &&
        !parsed.hash
      ) {
        return result.replace(/\/$/, '');
      }
      return result;
    }

    const relPath = trimmed.startsWith('/')
      ? parsed.pathname
      : parsed.pathname.replace(/^\//, '');
    return `${relPath}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

const KNOWN_TRACKER_PATTERNS: RegExp[] = [
  /feeds\.feedburner\.com\/~(?:r|ff)\//i,
  /(?:^|\.|\/)substack\.com\/o\//i,
  /list-manage\.com\/track\//i,
  /(?:^|\.|\/)doubleclick\.net(?:\/|$)/i,
  /(?:^|\.|\/)google-analytics\.com(?:\/|$)/i,
  /(?:^|\.|\/)googletagmanager\.com(?:\/|$)/i,
  /(?:^|\.|\/)googlesyndication\.com(?:\/|$)/i,
  /(?:^|\.|\/)adservice\.google\./i,
  /(?:^|\.|\/)pixel\.wp\.com(?:\/|$)/i,
  /(?:^|\.|\/)stats\.wp\.com(?:\/|$)/i,
  /(?:^|\.|\/)convertkit-mail\.com(?:\/|$)/i,
  /(?:^|\.|\/)convertkit-mail\d*\.com(?:\/|$)/i,
  /(?:^|\.|\/)facebook\.com\/tr(?:\/|\?|$)/i,
  /(?:^|\.|\/)connect\.facebook\.net(?:\/|$)/i,
  /(?:^|\.|\/)scorecardresearch\.com(?:\/|$)/i,
  /(?:^|\.|\/)quantserve\.com(?:\/|$)/i,
  /(?:^|\.|\/)amazon-adsystem\.com(?:\/|$)/i,
  /(?:^|\.|\/)outbrain\.com(?:\/|$)/i,
  /(?:^|\.|\/)taboola\.com(?:\/|$)/i,
  /(?:^|\.|\/)chartbeat\.(?:net|com)(?:\/|$)/i,
  /(?:^|\.|\/)parsely\.com(?:\/|$)/i,
  /(?:^|\.|\/)hotjar\.com(?:\/|$)/i,
  /(?:^|\.|\/)clarity\.ms(?:\/|$)/i,
  /(?:^|\.|\/)criteo\.com(?:\/|$)/i,
  /(?:^|\.|\/)demdex\.net(?:\/|$)/i,
  /(?:^|\.|\/)omtrdc\.net(?:\/|$)/i,
];

/**
 * Returns true if the URL points to a known tracking pixel, analytics beacon, or ad tracker host.
 */
export function isTrackerUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  for (const pattern of KNOWN_TRACKER_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

const MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.bd',
  'org.bd',
  'net.bd',
  'gov.bd',
  'edu.bd',
  'com.au',
  'co.in',
  'co.jp',
]);

export function getRegistrableDomain(hostname: string): string {
  const clean = hostname.trim().replace(/^www\./i, '').replace(/\.$/, '').toLowerCase();
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${lastTwo}`;
  }
  return lastTwo;
}

const FIRST_PARTY_PUBLISHER_CDN_MAP: Record<string, string[]> = {
  'bbc.com': ['bbci.co.uk', 'bbc.co.uk'],
  'bbc.co.uk': ['bbci.co.uk', 'bbc.com'],
  'bbci.co.uk': ['bbc.co.uk', 'bbc.com'],
  'theguardian.com': ['guim.co.uk', 'guardianapis.com'],
  'prothomalo.com': ['gumlet.io'],
  'dw.com': ['dw.de'],
};

/**
 * Determines whether a media asset URL (<img src>, <video>, <audio>) is safe to load.
 * Always blocks known tracker hosts. When blockThirdParty is true (default ON),
 * only allows local assets or media hosted on the publisher's own domain (or first-party CDN).
 */
export function isAllowedPublisherMediaUrl(
  mediaUrl: string,
  publisherOrFeedUrl?: string,
  blockThirdParty = true
): boolean {
  if (!mediaUrl || typeof mediaUrl !== 'string') return false;
  const trimmed = mediaUrl.trim();
  if (!trimmed) return false;
  if (isTrackerUrl(trimmed)) return false;

  // Local assets or safe inline SVG/image data URLs
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (/^data:image\/(?:svg\+xml|png|jpeg|jpg|webp);/i.test(trimmed)) return true;

  let parsedMedia: URL;
  try {
    parsedMedia = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
  } catch {
    return false;
  }

  if (parsedMedia.protocol !== 'https:' && parsedMedia.protocol !== 'http:') {
    return false;
  }
  if (isDisallowedHostname(parsedMedia.hostname)) {
    return false;
  }

  if (!blockThirdParty) {
    return true;
  }

  if (!publisherOrFeedUrl || publisherOrFeedUrl.startsWith('/')) {
    return false;
  }

  let parsedPublisher: URL;
  try {
    parsedPublisher = new URL(
      /^https?:\/\//i.test(publisherOrFeedUrl)
        ? publisherOrFeedUrl
        : `https://${publisherOrFeedUrl}`
    );
  } catch {
    return false;
  }

  const mediaHost = parsedMedia.hostname.toLowerCase();
  const pubHost = parsedPublisher.hostname.toLowerCase();
  if (mediaHost === pubHost || mediaHost.endsWith(`.${pubHost}`) || pubHost.endsWith(`.${mediaHost}`)) {
    return true;
  }

  const mediaBase = getRegistrableDomain(mediaHost);
  const pubBase = getRegistrableDomain(pubHost);
  if (mediaBase && pubBase && mediaBase === pubBase) {
    return true;
  }

  const allowedCdns = FIRST_PARTY_PUBLISHER_CDN_MAP[pubBase] || [];
  if (allowedCdns.includes(mediaBase)) {
    return true;
  }

  return false;
}

/**
 * Wraps a validated external URL in a user-configured stateless CORS/privacy relay URL if provided.
 */
export function buildStatelessRelayUrl(targetUrl: string, relayBaseUrl?: string): string {
  const safeTarget = validateSafeExternalUrl(stripTrackingParams(targetUrl)).href;
  const cleanRelay = (relayBaseUrl || '').trim();
  if (!cleanRelay) return safeTarget;

  try {
    const parsedRelay = new URL(cleanRelay);
    if (parsedRelay.protocol !== 'https:' && parsedRelay.protocol !== 'http:') {
      return safeTarget;
    }
    if (cleanRelay.includes('{url}')) {
      return cleanRelay.replace('{url}', encodeURIComponent(safeTarget));
    }
    if (cleanRelay.includes('url=')) {
      return `${cleanRelay}${encodeURIComponent(safeTarget)}`;
    }
    parsedRelay.searchParams.set('url', safeTarget);
    return parsedRelay.toString();
  } catch {
    return safeTarget;
  }
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return true;
  const nums = parts.map((p) => {
    if (!/^\d+$/.test(p)) return NaN;
    return Number(p);
  });
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b, c] = nums;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private network)
  if (a === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private network)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.168.0.0/16 (Private network)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (Multicast) and 240.0.0.0/4 (Reserved / Broadcast)
  if (a >= 224) return true;

  return false;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  if (!rawIp) return true;
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').toLowerCase();

  // Check IPv4
  if (ip.includes('.') && !ip.includes(':')) {
    return isPrivateOrReservedIpv4(ip);
  }

  // Check IPv6
  if (ip.includes(':')) {
    // Strip zone index if present (e.g. fe80::1%lo0)
    const cleanV6 = ip.split('%')[0];
    if (cleanV6 === '::1' || cleanV6 === '::' || cleanV6 === '0:0:0:0:0:0:0:1' || cleanV6 === '0:0:0:0:0:0:0:0') {
      return true;
    }

    // IPv4-mapped IPv6 dotted quad (e.g. ::ffff:127.0.0.1)
    const v4MappedMatch = cleanV6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedMatch) {
      return isPrivateOrReservedIpv4(v4MappedMatch[1]);
    }

    // IPv4-mapped IPv6 hex pair (e.g. ::ffff:7f00:1)
    const v4HexMatch = cleanV6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (v4HexMatch) {
      const hi = parseInt(v4HexMatch[1], 16);
      const lo = parseInt(v4HexMatch[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrReservedIpv4(dotted);
    }

    // Unique local addresses fc00::/7 (fc00..fdff)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleanV6)) return true;
    // Link-local addresses fe80::/10 (fe80..febf)
    if (/^fe[89ab][0-9a-f]:/i.test(cleanV6)) return true;
    // Multicast ff00::/8
    if (/^ff[0-9a-f]{2}:/i.test(cleanV6)) return true;
    // Documentation 2001:db8::/32
    if (/^2001:0?db8:/i.test(cleanV6)) return true;

    return false;
  }

  return true;
}

export function isDisallowedHostname(rawHost: string): boolean {
  if (!rawHost) return true;
  const host = rawHost.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.lan') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data'
  ) {
    return true;
  }

  // Reject single-label hostnames without a TLD (e.g., http://redis:6379 or http://db/)
  if (!host.includes('.') && !host.includes(':')) {
    return true;
  }

  // Reject integer, hex, or octal IP encodings (e.g. 2130706433, 0x7f000001, 0177.0.0.1)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }
  const parts = host.split('.');
  if (parts.every((p) => /^\d+$/.test(p) || /^0x[0-9a-f]+$/i.test(p))) {
    // If any octet starts with 0 and has more than 1 digit (octal/hex encoding), block
    if (parts.some((p) => (p.length > 1 && p.startsWith('0')) || p.startsWith('0x'))) {
      return true;
    }
    return isPrivateOrReservedIpv4(host);
  }

  if (host.includes(':')) {
    return isPrivateOrReservedIp(host);
  }

  return false;
}

export function validateSafeExternalUrl(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid or empty URL');
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    throw new Error('URL exceeds maximum length');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Malformed URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are permitted');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URL are not permitted');
  }

  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    throw new Error(`Port ${parsed.port} is not permitted`);
  }

  if (isDisallowedHostname(parsed.hostname)) {
    throw new Error('Target host is restricted or private');
  }

  return parsed;
}

export function checkSafeExternalUrl(rawUrl: string): {
  ok: boolean;
  url?: URL;
  reason?: string;
} {
  try {
    const url = validateSafeExternalUrl(rawUrl);
    return { ok: true, url };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Unsafe URL' };
  }
}

/**
 * Truncates HTML safely without cutting in the middle of an HTML tag or leaving broken markup.
 */
export function truncateHtmlSafely(html: string, maxChars: number): string {
  if (!html || html.length <= maxChars) return html;

  const slice = html.slice(0, maxChars);

  // Prefer cutting cleanly right after a closing block tag
  const closingBlockRegex = /<\/(?:p|blockquote|h2|h3|h4|figure|div|li|ul|ol)>/gi;
  let lastBlockEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = closingBlockRegex.exec(slice)) !== null) {
    lastBlockEnd = match.index + match[0].length;
  }

  let safeSlice: string;
  if (lastBlockEnd >= Math.floor(maxChars * 0.5)) {
    safeSlice = slice.slice(0, lastBlockEnd);
  } else {
    // Otherwise ensure we never cut inside an open `<...>` tag or HTML entity `&...;`
    const lastOpenBracket = slice.lastIndexOf('<');
    const lastCloseBracket = slice.lastIndexOf('>');
    safeSlice =
      lastOpenBracket > lastCloseBracket ? slice.slice(0, lastOpenBracket) : slice;

    const lastAmp = safeSlice.lastIndexOf('&');
    const lastSemi = safeSlice.lastIndexOf(';');
    if (lastAmp > lastSemi && safeSlice.length - lastAmp < 12) {
      safeSlice = safeSlice.slice(0, lastAmp);
    }
  }

  // Close any open paragraph/block/container tags in reverse order
  const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);
  const openStack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z0-9]+)\b[^>]*>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(safeSlice)) !== null) {
    const fullTag = tagMatch[0];
    const tagName = tagMatch[1].toLowerCase();
    if (voidTags.has(tagName) || fullTag.endsWith('/>')) continue;
    if (fullTag.startsWith('</')) {
      const idx = openStack.lastIndexOf(tagName);
      if (idx !== -1) openStack.splice(idx, 1);
    } else {
      openStack.push(tagName);
    }
  }

  while (openStack.length > 0) {
    const tag = openStack.pop()!;
    safeSlice += `</${tag}>`;
  }

  return safeSlice;
}
