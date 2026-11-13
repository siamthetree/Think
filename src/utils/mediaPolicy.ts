/**
 * Media Policy and First-Party CDN Verification Utilities
 */

const TWO_PART_SUFFIXES = new Set<string>([
  'co.uk',
  'com.bd',
  'net.bd',
  'org.bd',
  'gov.bd',
  'edu.bd',
  'com.au',
]);

/**
 * Known publisher-owned CDN hostnames.
 * More hosts are added here as they are found.
 */
export const FIRST_PARTY_MEDIA_HOSTS: Record<string, string[]> = {
  'bbc.com': ['ichef.bbci.co.uk'],
  'bbc.co.uk': ['ichef.bbci.co.uk'],
  'theguardian.com': ['i.guim.co.uk', 'media.guim.co.uk'],
};

/**
 * Extracts the registrable domain from a hostname, handling two-part TLDs.
 */
export function getRegistrableDomain(hostname: string): string {
  const clean = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!clean) return '';
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;

  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (TWO_PART_SUFFIXES.has(lastTwo)) {
    if (parts.length >= 3) {
      return `${parts[parts.length - 3]}.${lastTwo}`;
    }
    return clean;
  }

  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

/**
 * Checks if a media URL belongs to the publisher (same domain, legitimate subdomain,
 * or officially registered publisher CDN).
 */
export function isFirstPartyMedia(mediaUrl: string, publisherUrl: string): boolean {
  if (!mediaUrl || !publisherUrl) return false;

  let parsedMedia: URL;
  let parsedPub: URL;
  try {
    parsedMedia = new URL(mediaUrl.trim());
    parsedPub = new URL(publisherUrl.trim());
  } catch {
    return false;
  }

  const mediaHost = parsedMedia.hostname.toLowerCase();
  const pubHost = parsedPub.hostname.toLowerCase();

  if (mediaHost === pubHost) {
    return true;
  }

  const mediaDomain = getRegistrableDomain(mediaHost);
  const pubDomain = getRegistrableDomain(pubHost);

  if (mediaDomain && pubDomain && mediaDomain === pubDomain) {
    return true;
  }

  const allowedCdns: string[] = [
    ...(FIRST_PARTY_MEDIA_HOSTS[pubHost] || []),
    ...(FIRST_PARTY_MEDIA_HOSTS[pubDomain] || []),
  ];

  for (const cdn of allowedCdns) {
    const cdnLower = cdn.toLowerCase();
    if (mediaHost === cdnLower || mediaHost.endsWith(`.${cdnLower}`)) {
      return true;
    }
  }

  return false;
}
