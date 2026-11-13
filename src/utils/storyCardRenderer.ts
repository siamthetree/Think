import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SpotifyReadingStats } from './feedIntelligence';
import {
  stripDataUrlPrefix,
  buildInstagramStoryDeepLink,
  buildInstagramStoryCameraDeepLink,
  buildFacebookStoryDeepLink,
  detectClientPlatform,
  guessImageExtensionFromMime,
  sanitizePhotoFilename,
  buildImageProxyUrl,
  DEFAULT_STORY_CARD_TRANSFORM,
  type StoryCardTransform,
} from './mediaShare';
import { fetchImageWithCache } from './apiClient';

interface ChintaMediaNativePlugin {
  shareToInstagramStory(opts: {
    stickerBase64?: string;
    imageBase64: string;
    topColor?: string;
    bottomColor?: string;
    attributionUrl?: string;
    allowMusic?: boolean;
  }): Promise<{ ok: boolean; method: string; message: string }>;
  shareToFacebookStory(opts: {
    stickerBase64?: string;
    imageBase64: string;
    topColor?: string;
    bottomColor?: string;
    appId?: string;
  }): Promise<{ ok: boolean; method: string; message: string }>;
  saveImageToGallery(opts: {
    imageBase64?: string;
    imageUrl?: string;
  }): Promise<{ ok: boolean; method: string; message: string }>;
  shareImageSheet(opts: {
    imageBase64: string;
    title?: string;
  }): Promise<{ ok: boolean; method: string; message: string }>;
}

const ChintaMedia = registerPlugin<ChintaMediaNativePlugin>('ChintaMedia');

export type StoryCardMode = 'song' | 'wrapped' | 'lyrics';
export type StoryBackdropThemeId = 'emerald' | 'sunset' | 'midnight' | 'crimson' | 'gold';

export interface StoryBackdropTheme {
  id: StoryBackdropThemeId;
  name: string;
  topColor: string;
  midColor: string;
  bottomColor: string;
  accentColor: string;
  cardBg: string;
  pillText: string;
}

export const SPOTIFY_BACKDROP_THEMES: StoryBackdropTheme[] = [
  {
    id: 'sunset',
    name: 'Warm Ink',
    topColor: '#EA580C',
    midColor: '#7C2D12',
    bottomColor: '#140C08',
    accentColor: '#FF7A2F',
    cardBg: '#171412',
    pillText: '#2A0E04',
  },
  {
    id: 'emerald',
    name: 'Sage',
    topColor: '#0D9488',
    midColor: '#115E59',
    bottomColor: '#071413',
    accentColor: '#2DD4BF',
    cardBg: '#111615',
    pillText: '#042F2E',
  },
  {
    id: 'midnight',
    name: 'Slate',
    topColor: '#4F46E5',
    midColor: '#1E1B4B',
    bottomColor: '#090914',
    accentColor: '#818CF8',
    cardBg: '#11121A',
    pillText: '#1E1B4B',
  },
  {
    id: 'crimson',
    name: 'Garnet',
    topColor: '#E11D48',
    midColor: '#881337',
    bottomColor: '#14070B',
    accentColor: '#FB7185',
    cardBg: '#171013',
    pillText: '#4C0519',
  },
  {
    id: 'gold',
    name: 'Paper Dark',
    topColor: '#D97706',
    midColor: '#573612',
    bottomColor: '#120E09',
    accentColor: '#FBBF24',
    cardBg: '#161411',
    pillText: '#451A03',
  },
];

export interface StoryCardPayload {
  mode: StoryCardMode;
  themeId: StoryBackdropThemeId;
  headline: string;
  publisher: string;
  author?: string;
  readTimeMin?: number;
  imageUrl?: string;
  quoteText?: string;
  attributionUrl?: string;
  stats?: SpotifyReadingStats;
  transform?: StoryCardTransform;
}

export function getStoryBackdropTheme(themeId: StoryBackdropThemeId): StoryBackdropTheme {
  return SPOTIFY_BACKDROP_THEMES.find((t) => t.id === themeId) || SPOTIFY_BACKDROP_THEMES[0];
}

function getTheme(themeId: StoryBackdropThemeId): StoryBackdropTheme {
  return getStoryBackdropTheme(themeId);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = words[i];
      if (lines.length >= maxLines - 1) {
        const rest = [current, ...words.slice(i + 1)].join(' ');
        let finalLine = rest;
        while (finalLine.length > 3 && ctx.measureText(`${finalLine}…`).width > maxWidth) {
          finalLine = finalLine.slice(0, -1).trim();
        }
        lines.push(finalLine.length < rest.length ? `${finalLine}…` : finalLine);
        return lines;
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function loadSingleImageUrl(src: string, timeoutMs = 2200): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

async function loadCorsSafeImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) {
    return loadSingleImageUrl(url, 1800);
  }
  const safeUrl = buildImageProxyUrl(url);
  if (!safeUrl) return null;

  const cachedDataUrl = await fetchImageWithCache(safeUrl);
  if (cachedDataUrl) {
    const img = await loadSingleImageUrl(cachedDataUrl, 2200);
    if (img) return img;
  }
  return loadSingleImageUrl(safeUrl, 1800);
}

function drawFooterSignature(ctx: CanvasRenderingContext2D, accentColor: string, centerX: number, y: number) {
  ctx.save();
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(centerX - 116, y - 10, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 28px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('চিন্তা · Think', centerX - 92, y);
  ctx.restore();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, theme: StoryBackdropTheme) {
  const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
  grad.addColorStop(0, theme.topColor);
  grad.addColorStop(0.38, theme.midColor);
  grad.addColorStop(1, theme.bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  const radial = ctx.createRadialGradient(840, 260, 20, 840, 260, 620);
  radial.addColorStop(0, 'rgba(255,255,255,0.12)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 1080, 1920);
}

/**
 * Renders ONLY the transparent floating Story card sticker (1000x1500) with subtle shadow and signature.
 * Used directly as `stickerImage` on Instagram/Facebook Stories so users can resize/rotate/drag
 * the card with two fingers independently of the gradient background color.
 */
export async function renderStoryStickerCanvas(
  payload: StoryCardPayload
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const theme = getTheme(payload.themeId);
  const cardX = 50;
  const cardY = 40;
  const cardW = 900;
  const cardH = 1310;
  const footerY = 1445;

  // Floating Card Surface + Specular Rim
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.44)';
  ctx.shadowBlur = 55;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = theme.cardBg;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.stroke();

  // Mode 1: Editorial Article Story Card
  if (payload.mode === 'song') {
    const coverImg = await loadCorsSafeImage(payload.imageUrl);
    const artX = cardX + 70;
    const artY = cardY + 75;
    const artW = 760;
    const artH = 680;

    ctx.save();
    roundRectPath(ctx, artX, artY, artW, artH, 28);
    ctx.clip();

    if (coverImg) {
      const ratio = Math.max(artW / coverImg.width, artH / coverImg.height);
      const dw = coverImg.width * ratio;
      const dh = coverImg.height * ratio;
      ctx.drawImage(coverImg, artX + (artW - dw) / 2, artY + (artH - dh) / 2, dw, dh);
      const artGrad = ctx.createLinearGradient(0, artY + artH * 0.55, 0, artY + artH);
      artGrad.addColorStop(0, 'rgba(0,0,0,0)');
      artGrad.addColorStop(1, 'rgba(0,0,0,0.52)');
      ctx.fillStyle = artGrad;
      ctx.fillRect(artX, artY, artW, artH);
    } else {
      const coverGrad = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
      coverGrad.addColorStop(0, theme.topColor);
      coverGrad.addColorStop(1, theme.midColor);
      ctx.fillStyle = coverGrad;
      ctx.fillRect(artX, artY, artW, artH);

      const initial = (payload.publisher || 'C').trim().charAt(0).toUpperCase();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '700 240px "Lora", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(initial, artX + artW / 2, artY + artH / 2 + 80);
    }
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accentColor;
    ctx.font = '700 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText((payload.publisher || 'News').toUpperCase(), cardX + 70, cardY + 825);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 50px "Lora", Georgia, serif';
    const titleLines = wrapCanvasText(ctx, payload.headline, 760, 4);
    let textY = cardY + 900;
    for (const line of titleLines) {
      ctx.fillText(line, cardX + 70, textY);
      textY += 66;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(cardX + 70, cardY + 1185, 760, 2);

    const mins = Math.max(1, payload.readTimeMin || 3);
    const cleanAuthor = (payload.author || '').trim();
    const metaLine = cleanAuthor
      ? cleanAuthor.toLowerCase().startsWith('by ')
        ? cleanAuthor
        : `By ${cleanAuthor}`
      : payload.publisher || 'Chinta Edition';
    ctx.fillStyle = cleanAuthor ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.68)';
    ctx.font = `${cleanAuthor ? '600' : '500'} 25px "Plus Jakarta Sans", -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(
      metaLine.length > 34 ? `${metaLine.slice(0, 32)}…` : metaLine,
      cardX + 70,
      cardY + 1245
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '600 25px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(`${mins} min read`, cardX + 830, cardY + 1245);

    drawFooterSignature(ctx, theme.accentColor, 500, footerY);
    return canvas;
  }

  // Mode 2: Editorial Pull-Quote Highlight Card
  if (payload.mode === 'lyrics') {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accentColor;
    ctx.font = '700 25px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText((payload.publisher || 'News').toUpperCase(), cardX + 75, cardY + 105);

    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '500 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    const subTitle =
      payload.headline.length > 46 ? `${payload.headline.slice(0, 44)}…` : payload.headline;
    ctx.fillText(subTitle, cardX + 75, cardY + 152);

    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(cardX + 75, cardY + 198, 750, 2);

    const quote = payload.quoteText || payload.headline;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 54px "Lora", Georgia, serif';
    const quoteLines = wrapCanvasText(ctx, `“${quote}”`, 705, 9);

    const startY = cardY + 320;
    const lineHeight = 86;
    const barHeight = Math.max(120, quoteLines.length * lineHeight - 16);

    ctx.fillStyle = theme.accentColor;
    roundRectPath(ctx, cardX + 75, startY - 50, 7, barHeight, 4);
    ctx.fill();

    let qY = startY;
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < quoteLines.length; i++) {
      ctx.fillText(quoteLines[i], cardX + 112, qY);
      qY += lineHeight;
    }

    const mins = Math.max(1, payload.readTimeMin || 3);
    const cleanAuthor = (payload.author || '').trim();
    const quoteFooter = cleanAuthor
      ? `${cleanAuthor.toLowerCase().startsWith('by ') ? cleanAuthor : `By ${cleanAuthor}`} · ${mins} min read`
      : `${mins} min read · Saved on Chinta`;
    ctx.fillStyle = 'rgba(255,255,255,0.64)';
    ctx.font = '600 23px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(
      quoteFooter.length > 48 ? `${quoteFooter.slice(0, 46)}…` : quoteFooter,
      cardX + 75,
      cardY + 1230
    );

    drawFooterSignature(ctx, theme.accentColor, 500, footerY);
    return canvas;
  }

  // Mode 3: Minimal Newsreader Reading Recap
  const stats = payload.stats;
  const totalMin = stats?.totalMinutesRead ?? 0;
  const totalStories = stats?.totalStoriesRead ?? 0;
  const streak = stats?.streakDays ?? 0;
  const topSources = stats?.topSources?.slice(0, 4) || [];
  const topGenres = stats?.topGenres?.slice(0, 3) || [];

  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 23px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('FOCUSED READING', cardX + 75, cardY + 95);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 124px "Lora", Georgia, serif';
  ctx.fillText(`${totalMin}m`, cardX + 75, cardY + 230);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 30px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText(
    `${totalStories} ${totalStories === 1 ? 'article' : 'articles'} · ${streak}d streak`,
    cardX + 75,
    cardY + 295
  );

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(cardX + 75, cardY + 350, 750, 2);

  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('MOST READ SOURCES', cardX + 75, cardY + 420);

  if (topSources.length > 0) {
    let sy = cardY + 495;
    for (const src of topSources) {
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.font = '700 32px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${src.rank}.`, cardX + 75, sy);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 36px "Lora", Georgia, serif';
      const label = src.title.length > 24 ? `${src.title.slice(0, 22)}…` : src.title;
      ctx.fillText(label, cardX + 135, sy);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.font = '500 26px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${src.storyCount}`, cardX + 825, sy);
      ctx.textAlign = 'left';
      sy += 78;
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '500 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('Read articles to see your top sources here', cardX + 75, cardY + 500);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(cardX + 75, cardY + 845, 750, 2);

  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('TOPICS', cardX + 75, cardY + 915);

  if (topGenres.length > 0) {
    const topicLine = topGenres.map((g) => g.name).join(' · ');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 38px "Lora", Georgia, serif';
    const topicLines = wrapCanvasText(ctx, topicLine, 750, 2);
    let ty = cardY + 985;
    for (const line of topicLines) {
      ctx.fillText(line, cardX + 75, ty);
      ty += 54;
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '500 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('Topics appear as you read across categories', cardX + 75, cardY + 985);
  }

  const profileTitle = stats?.readerAura?.title || 'Mindful Reader';
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRectPath(ctx, cardX + 75, cardY + 1130, 750, 115, 24);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '600 20px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('READING STYLE', cardX + 110, cardY + 1175);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px "Lora", Georgia, serif';
  ctx.fillText(profileTitle, cardX + 110, cardY + 1220);

  drawFooterSignature(ctx, theme.accentColor, 500, footerY);
  return canvas;
}

/**
 * Renders a full 1080x1920 (9:16 vertical Story) image by compositing the movable/scalable/rotatable
 * card sticker over a fixed, unchanged background gradient.
 */
export async function renderStoryCardCanvas(
  payload: StoryCardPayload
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const theme = getTheme(payload.themeId);
  drawBackdrop(ctx, theme);

  // Subtle fixed top mode label on the static background layer
  const pillLabel =
    payload.mode === 'song'
      ? 'READING NOW'
      : payload.mode === 'lyrics'
        ? 'KEY PASSAGE'
        : 'READING RECAP';
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRectPath(ctx, 375, 115, 330, 52, 26);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 21px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(pillLabel, 540, 149);

  // Draw the independent foreground card sticker with any two-finger transform applied
  const stickerCanvas = await renderStoryStickerCanvas(payload);
  const t = payload.transform || DEFAULT_STORY_CARD_TRANSFORM;

  ctx.save();
  ctx.translate(540 + t.offsetX * 1080, 995 + t.offsetY * 1920);
  ctx.rotate((t.rotationDeg * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(stickerCanvas, -stickerCanvas.width / 2, -stickerCanvas.height / 2);
  ctx.restore();

  return canvas;
}

function isNativePlatformSafe(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
  });
}

function triggerBlobDownload(blobUrlOrDataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = blobUrlOrDataUrl;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function triggerPngDownload(canvas: HTMLCanvasElement, filename: string) {
  triggerBlobDownload(canvas.toDataURL('image/png'), filename);
}

function triggerAppSchemeLink(schemeUrl: string) {
  try {
    const a = document.createElement('a');
    a.href = schemeUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    // Scheme launch optional on unsupported browsers
  }
}

async function copyImageBlobToClipboard(blob: Blob | null): Promise<boolean> {
  if (!blob || typeof navigator === 'undefined' || !navigator.clipboard) return false;
  if (typeof ClipboardItem === 'undefined') return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shares a 9:16 Story card directly to Instagram Stories, Facebook Stories, or saves to Photos Gallery.
 * On Capacitor iOS, writes PNG + backdrop colors to UIPasteboard and opens instagram-stories:// or
 * facebook-stories:// directly (only on explicit user tap), or writes to PHPhotoLibrary.
 */
export async function shareSpotifyStyleStory(
  platform: 'instagram' | 'facebook' | 'native' | 'download',
  payload: StoryCardPayload,
  options: { allowInstagramMusic?: boolean } = {}
): Promise<{ ok: boolean; method: string; message: string }> {
  const allowInstagramMusic = options.allowInstagramMusic ?? true;
  const canvas = await renderStoryCardCanvas(payload);
  const theme = getTheme(payload.themeId);
  const filename = sanitizePhotoFilename(`chinta-story-${Date.now().toString(36)}`, 'png');
  const dataUrl = canvas.toDataURL('image/png');
  const imageBase64 = stripDataUrlPrefix(dataUrl);

  // 1. Native Capacitor iOS Bridge
  if (isNativePlatformSafe()) {
    try {
      if (platform === 'instagram' || platform === 'facebook') {
        const stickerCanvas = await renderStoryStickerCanvas(payload);
        const stickerBase64 = stripDataUrlPrefix(stickerCanvas.toDataURL('image/png'));
        if (platform === 'instagram') {
          return await ChintaMedia.shareToInstagramStory({
            stickerBase64,
            imageBase64,
            topColor: theme.topColor,
            bottomColor: theme.bottomColor,
            attributionUrl: allowInstagramMusic ? undefined : payload.attributionUrl,
            allowMusic: allowInstagramMusic,
          });
        }
        return await ChintaMedia.shareToFacebookStory({
          stickerBase64,
          imageBase64,
          topColor: theme.topColor,
          bottomColor: theme.bottomColor,
        });
      }
      if (platform === 'download') {
        return await ChintaMedia.saveImageToGallery({ imageBase64 });
      }
      return await ChintaMedia.shareImageSheet({
        imageBase64,
        title: payload.headline,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg) {
        return { ok: false, method: 'native-error', message: msg };
      }
    }
  }

  // 2. Web / iOS Safari / Android Mobile Web
  const blob = await canvasToBlob(canvas);
  const clientPlatform =
    typeof navigator !== 'undefined'
      ? detectClientPlatform(navigator.userAgent, navigator.maxTouchPoints || 0)
      : 'desktop-web';
  const isMobileWeb = clientPlatform === 'ios-web' || clientPlatform === 'android-web';

  // Save to Gallery / Photos
  if (platform === 'download') {
    if (isMobileWeb && blob && typeof File !== 'undefined') {
      const file = new File([blob], filename, { type: 'image/png' });
      const shareData: ShareData = {
        files: [file],
        title: payload.headline || 'Chinta Story Card',
      };
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          return {
            ok: true,
            method: 'web-share-save',
            message:
              clientPlatform === 'ios-web'
                ? 'Tap "Save Image" to add to Photos.'
                : 'Story image saved to gallery.',
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            return { ok: false, method: 'cancelled', message: 'Save cancelled.' };
          }
        }
      }
    }

    triggerPngDownload(canvas, filename);
    return {
      ok: true,
      method: 'download',
      message: 'Saved 9:16 story image.',
    };
  }

  // Copy image to clipboard as a reliable backup for pasting into Stories
  const copiedImage = await copyImageBlobToClipboard(blob);

  // For Instagram with Music Enabled on mobile web: save via Share Sheet / Photos and open
  // instagram://story-camera instead of third-party share extension, keeping IG Music unlocked.
  if (platform === 'instagram' && allowInstagramMusic) {
    if (isMobileWeb && blob && typeof File !== 'undefined') {
      const file = new File([blob], filename, { type: 'image/png' });
      const saveOnlyShare: ShareData = {
        files: [file],
        title: payload.headline || 'Chinta Story Card',
      };
      if (navigator.share && navigator.canShare && navigator.canShare(saveOnlyShare)) {
        try {
          await navigator.share(saveOnlyShare);
          triggerAppSchemeLink(buildInstagramStoryCameraDeepLink());
          return {
            ok: true,
            method: 'web-ig-music-ready',
            message:
              clientPlatform === 'ios-web'
                ? 'Save Image, then pick from Recents in Instagram Stories to add any song.'
                : 'Saved card - pick from Recents in Instagram Stories to add any song.',
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            return { ok: false, method: 'cancelled', message: 'Share cancelled.' };
          }
        }
      }
    }

    triggerPngDownload(canvas, filename);
    if (isMobileWeb) {
      triggerAppSchemeLink(buildInstagramStoryCameraDeepLink());
    }
    return {
      ok: true,
      method: 'download-ig-music-ready',
      message: copiedImage
        ? 'Saved & copied - pick from Photos or paste in Instagram Stories to add any song.'
        : 'Saved 9:16 card - pick from Photos in Instagram Stories to add any song.',
    };
  }

  if (blob && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: 'image/png' });
    const shareData: ShareData = {
      files: [file],
      title: `Chinta · ${payload.headline}`,
      text: `${payload.headline} - Read on চিন্তা (Think)`,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return {
          ok: true,
          method: 'web-share-files',
          message:
            platform === 'instagram'
              ? 'Shared to Instagram Stories.'
              : platform === 'facebook'
                ? 'Shared to Facebook Stories.'
                : 'Story shared.',
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, method: 'cancelled', message: 'Share cancelled.' };
        }
      }
    }
  }

  // Fallback: Download PNG and on mobile deep-link directly to IG / FB Stories composer
  triggerPngDownload(canvas, filename);
  if (isMobileWeb) {
    if (platform === 'instagram') {
      triggerAppSchemeLink(buildInstagramStoryDeepLink());
    } else if (platform === 'facebook') {
      triggerAppSchemeLink(buildFacebookStoryDeepLink());
    }
  }

  return {
    ok: true,
    method: 'download-fallback',
    message:
      platform === 'instagram'
        ? copiedImage
          ? 'Saved & copied - paste or pick from Photos in Instagram Stories.'
          : 'Saved - pick from Photos in Instagram Stories.'
        : platform === 'facebook'
          ? copiedImage
            ? 'Saved & copied - paste or pick from Photos in Facebook Stories.'
            : 'Saved - pick from Photos in Facebook Stories.'
          : 'Story image saved.',
  };
}

/**
 * Saves any article or feed photo directly to Apple Photos (Capacitor iOS) or browser gallery.
 */
export async function savePhotoToGallery(
  imageUrl: string,
  label = 'chinta-photo'
): Promise<{ ok: boolean; method: string; message: string }> {
  const safeUrl = buildImageProxyUrl(imageUrl);
  if (!safeUrl) {
    return { ok: false, method: 'invalid-url', message: 'Photo URL unavailable.' };
  }

  const cachedDataUrl = await fetchImageWithCache(safeUrl);

  if (isNativePlatformSafe()) {
    try {
      if (cachedDataUrl) {
        return await ChintaMedia.saveImageToGallery({
          imageBase64: stripDataUrlPrefix(cachedDataUrl),
        });
      }
      return await ChintaMedia.saveImageToGallery({ imageUrl: safeUrl });
    } catch (err: unknown) {
      return {
        ok: false,
        method: 'native-error',
        message: err instanceof Error ? err.message : 'Unable to save to Photos.',
      };
    }
  }

  let blob: Blob | null = null;
  let mimeType = 'image/jpeg';

  for (const candidate of [cachedDataUrl, safeUrl].filter(Boolean) as string[]) {
    try {
      const res = await fetch(candidate, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      if (contentType && !contentType.toLowerCase().startsWith('image/')) continue;
      blob = await res.blob();
      mimeType = contentType || blob.type || 'image/jpeg';
      if (blob.size > 0) break;
    } catch {
      // Try next candidate
    }
  }

  if (!blob) {
    return { ok: false, method: 'fetch-failed', message: 'Could not download this photo.' };
  }

  const ext = guessImageExtensionFromMime(mimeType, safeUrl);
  const filename = sanitizePhotoFilename(label, ext);
  const clientPlatform =
    typeof navigator !== 'undefined'
      ? detectClientPlatform(navigator.userAgent, navigator.maxTouchPoints || 0)
      : 'desktop-web';
  const isMobileWeb = clientPlatform === 'ios-web' || clientPlatform === 'android-web';

  if (isMobileWeb && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: mimeType });
    const shareData: ShareData = { files: [file], title: label };
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return {
          ok: true,
          method: 'web-share-save',
          message:
            clientPlatform === 'ios-web'
              ? 'Tap "Save Image" to add to Photos.'
              : 'Photo saved to gallery.',
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, method: 'cancelled', message: 'Save cancelled.' };
        }
      }
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerBlobDownload(objectUrl, filename);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
  return {
    ok: true,
    method: 'download',
    message: 'Photo saved.',
  };
}
