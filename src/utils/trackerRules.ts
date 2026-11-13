/**
 * Tracker Rules and URL Parameter Stripping Utilities
 */

export const TRACKING_PARAMS = new Set<string>([
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
  'yclid',
  'gbraid',
  'wbraid',
  'ocid',
  'cmpid',
  'ref_src',
]);

export interface TrackerHostPattern {
  host: string;
  pathPrefix?: string;
}

export const TRACKER_HOST_PATTERNS: TrackerHostPattern[] = [
  { host: 'feeds.feedburner.com', pathPrefix: '/~r/' },
  { host: 'substack.com', pathPrefix: '/o/' },
  { host: 'list-manage.com', pathPrefix: '/track/' },
  { host: 'doubleclick.net' },
  { host: 'google-analytics.com' },
  { host: 'pixel.wp.com' },
  { host: 'convertkit-mail.com' },
];

/**
 * Returns the URL without tracking parameters.
 * Keeps all other parameters in their original order, keeps the hash,
 * and never throws. If the input is not a valid absolute http(s) URL,
 * returns it unchanged. If no query remains, removes trailing '?'.
 */
export function stripTrackingParams(rawUrl: string): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return rawUrl;
  }

  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return rawUrl;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return rawUrl;
  }

  const remaining: [string, string][] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (TRACKING_PARAMS.has(lowerKey) || lowerKey.startsWith('utm_')) {
      continue;
    }
    remaining.push([key, value]);
  }

  const hash = parsed.hash || '';
  if (remaining.length === 0) {
    return `${parsed.origin}${parsed.pathname}${hash}`;
  }

  const search = new URLSearchParams(remaining).toString();
  return `${parsed.origin}${parsed.pathname}?${search}${hash}`;
}

/**
 * Checks if a URL points to a known tracking host or path.
 * A host matches itself and any subdomain.
 */
export function isTrackerUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    const clean = rawUrl.trim();
    if (clean.startsWith('//')) {
      parsed = new URL(`https:${clean}`);
    } else {
      parsed = new URL(clean);
    }
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  for (const pattern of TRACKER_HOST_PATTERNS) {
    const targetHost = pattern.host.toLowerCase();
    const matchesHost = hostname === targetHost || hostname.endsWith(`.${targetHost}`);
    if (!matchesHost) continue;

    if (pattern.pathPrefix) {
      if (pathname.startsWith(pattern.pathPrefix)) {
        return true;
      }
    } else {
      return true;
    }
  }

  return false;
}

/**
 * Checks if an image element attribute set represents a tracking pixel.
 * True when width or height is "0" or "1" (also "0px" or "1px"),
 * or the style contains display:none, visibility:hidden, opacity:0, width:1px or height:1px
 * (ignoring spaces and case), or src is a tracker URL.
 */
export function isTrackingPixel(attrs: {
  width?: string | null;
  height?: string | null;
  style?: string | null;
  src?: string | null;
}): boolean {
  const pixelDimensions = new Set(['0', '1', '0px', '1px']);

  if (attrs.width) {
    const w = attrs.width.trim().toLowerCase();
    if (pixelDimensions.has(w)) return true;
  }

  if (attrs.height) {
    const h = attrs.height.trim().toLowerCase();
    if (pixelDimensions.has(h)) return true;
  }

  if (attrs.style) {
    const normStyle = attrs.style.toLowerCase().replace(/\s+/g, '');
    if (
      normStyle.includes('display:none') ||
      normStyle.includes('visibility:hidden') ||
      normStyle.includes('opacity:0') ||
      normStyle.includes('width:1px') ||
      normStyle.includes('height:1px') ||
      normStyle.includes('width:0px') ||
      normStyle.includes('height:0px')
    ) {
      return true;
    }
  }

  if (attrs.src && isTrackerUrl(attrs.src)) {
    return true;
  }

  return false;
}
