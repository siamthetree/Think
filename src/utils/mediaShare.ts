export type WebClientPlatform = 'ios-web' | 'android-web' | 'desktop-web';

/**
 * Strips `data:image/png;base64,` prefix so native iOS bridge receives raw base64 bytes.
 */
export function stripDataUrlPrefix(dataUrlOrBase64: string): string {
  const raw = (dataUrlOrBase64 || '').trim();
  const idx = raw.indexOf('base64,');
  return idx !== -1 ? raw.slice(idx + 'base64,'.length) : raw;
}

/**
 * Builds Meta's official Instagram Stories iOS/Android URL scheme.
 */
export function buildInstagramStoryDeepLink(sourceApp = 'app.chinta.reader'): string {
  const safeApp = encodeURIComponent((sourceApp || 'app.chinta.reader').trim());
  return `instagram-stories://share?source_application=${safeApp}`;
}

/**
 * Opens Instagram's native Stories camera/gallery composer directly without
 * third-party external-share flags so Instagram Music stickers remain unlocked.
 */
export function buildInstagramStoryCameraDeepLink(): string {
  return 'instagram://story-camera';
}

/**
 * Builds Meta's official Facebook Stories iOS/Android URL scheme.
 */
export function buildFacebookStoryDeepLink(
  sourceApp = 'app.chinta.reader',
  appId?: string
): string {
  const safeApp = encodeURIComponent((sourceApp || 'app.chinta.reader').trim());
  const params = [`source_application=${safeApp}`];
  if (appId && appId.trim()) {
    params.push(`app_id=${encodeURIComponent(appId.trim())}`);
  }
  return `facebook-stories://share?${params.join('&')}`;
}

/**
 * Detects whether a browser runtime is iOS Safari/WebKit, Android browser, or desktop browser.
 */
export function detectClientPlatform(
  userAgent = '',
  maxTouchPoints = 0
): WebClientPlatform {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) {
    return 'ios-web';
  }
  if (/Android/i.test(ua)) {
    return 'android-web';
  }
  return 'desktop-web';
}

/**
 * Infers safe file extension from Content-Type MIME or URL path.
 */
export function guessImageExtensionFromMime(mimeType = '', url = ''): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';

  const cleanPath = url.split('?')[0].toLowerCase();
  if (cleanPath.endsWith('.png')) return 'png';
  if (cleanPath.endsWith('.webp')) return 'webp';
  if (cleanPath.endsWith('.gif')) return 'gif';
  return 'jpg';
}

/**
 * Produces a filesystem/Photos-safe filename for saved cards and article images.
 */
export function sanitizePhotoFilename(
  label = 'chinta-photo',
  extension = 'png'
): string {
  const base = (label || 'chinta-photo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'chinta-photo';
  const ext = (extension || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return `${base}.${ext}`;
}

/**
 * Builds the SSRF-checked backend image proxy URL for safe untainted canvas & gallery saving.
 */
export function buildImageProxyUrl(targetUrl: string): string {
  const clean = (targetUrl || '').trim();
  if (!clean || (!clean.startsWith('http://') && !clean.startsWith('https://'))) {
    return '';
  }
  return `/api/image-proxy?url=${encodeURIComponent(clean)}`;
}

export interface StoryCardTransform {
  /** Normalized horizontal offset relative to story width (-0.35 .. 0.35) */
  offsetX: number;
  /** Normalized vertical offset relative to story height (-0.35 .. 0.35) */
  offsetY: number;
  /** Card scale multiplier (0.55 .. 1.65) */
  scale: number;
  /** Card rotation in degrees (-45 .. 45) */
  rotationDeg: number;
}

export const DEFAULT_STORY_CARD_TRANSFORM: StoryCardTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotationDeg: 0,
};

export interface TouchPoint2D {
  x: number;
  y: number;
}

export function clampStoryCardTransform(
  input: Partial<StoryCardTransform>
): StoryCardTransform {
  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val));
  return {
    offsetX: Number(clamp(input.offsetX ?? 0, -0.35, 0.35).toFixed(4)),
    offsetY: Number(clamp(input.offsetY ?? 0, -0.35, 0.35).toFixed(4)),
    scale: Number(clamp(input.scale ?? 1, 0.55, 1.65).toFixed(3)),
    rotationDeg: Number(clamp(input.rotationDeg ?? 0, -45, 45).toFixed(2)),
  };
}

/**
 * Computes independent foreground card transform (pinch scale, two-finger rotation with angle-wrap
 * safety & subtle 0-deg detent snap, and midpoint pan) without altering the background gradient.
 */
export function computeTwoFingerTransform(params: {
  startP1: TouchPoint2D;
  startP2: TouchPoint2D;
  currP1: TouchPoint2D;
  currP2: TouchPoint2D;
  baseTransform: StoryCardTransform;
  containerWidth: number;
  containerHeight: number;
}): StoryCardTransform {
  const {
    startP1,
    startP2,
    currP1,
    currP2,
    baseTransform,
    containerWidth,
    containerHeight,
  } = params;

  const w = Math.max(1, containerWidth);
  const h = Math.max(1, containerHeight);

  const startDx = startP2.x - startP1.x;
  const startDy = startP2.y - startP1.y;
  const currDx = currP2.x - currP1.x;
  const currDy = currP2.y - currP1.y;

  const startDist = Math.max(12, Math.hypot(startDx, startDy));
  const currDist = Math.max(12, Math.hypot(currDx, currDy));

  const startMidX = (startP1.x + startP2.x) / 2;
  const startMidY = (startP1.y + startP2.y) / 2;
  const currMidX = (currP1.x + currP2.x) / 2;
  const currMidY = (currP1.y + currP2.y) / 2;

  const startAngle = Math.atan2(startDy, startDx);
  const currAngle = Math.atan2(currDy, currDx);
  let deltaRad = currAngle - startAngle;
  // Normalize angular delta across -PI..PI boundary
  while (deltaRad > Math.PI) deltaRad -= Math.PI * 2;
  while (deltaRad < -Math.PI) deltaRad += Math.PI * 2;
  const deltaDeg = (deltaRad * 180) / Math.PI;

  let nextRotation = baseTransform.rotationDeg + deltaDeg;
  // Apple-style subtle magnetic snap to 0° when within ±2.2°
  if (Math.abs(nextRotation) < 2.2) {
    nextRotation = 0;
  }

  return clampStoryCardTransform({
    offsetX: baseTransform.offsetX + (currMidX - startMidX) / w,
    offsetY: baseTransform.offsetY + (currMidY - startMidY) / h,
    scale: baseTransform.scale * (currDist / startDist),
    rotationDeg: nextRotation,
  });
}

export function isStoryTransformModified(t: StoryCardTransform): boolean {
  return (
    Math.abs(t.offsetX) > 0.005 ||
    Math.abs(t.offsetY) > 0.005 ||
    Math.abs(t.scale - 1) > 0.015 ||
    Math.abs(t.rotationDeg) > 0.5
  );
}
