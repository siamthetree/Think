import type { SpotifyReadingStats } from './feedIntelligence';

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
  stats?: SpotifyReadingStats;
}

function getTheme(themeId: StoryBackdropThemeId): StoryBackdropTheme {
  return SPOTIFY_BACKDROP_THEMES.find((t) => t.id === themeId) || SPOTIFY_BACKDROP_THEMES[0];
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

function loadCorsSafeImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url || !url.startsWith('http')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 1800);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function drawFooterSignature(ctx: CanvasRenderingContext2D, accentColor: string, y: number) {
  ctx.save();
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(412, y - 10, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '600 28px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('চিন্তা · Think', 436, y);
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
 * Renders a minimal 1080×1920 (9:16 vertical Instagram / Facebook Story) newsreader card.
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

  // Mode 1: Editorial Article Story Card ('song' ID retained for API compatibility)
  if (payload.mode === 'song') {
    const coverImg = await loadCorsSafeImage(payload.imageUrl);

    // Subtle Top Pill
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRectPath(ctx, 390, 145, 300, 54, 27);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 21px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('READING NOW', 540, 179);

    // Floating Minimal Editorial Card
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 28;
    ctx.fillStyle = theme.cardBg;
    roundRectPath(ctx, 90, 260, 900, 1310, 44);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, 90, 260, 900, 1310, 44);
    ctx.stroke();

    // Editorial Cover Image / Clean Monogram Poster
    const artX = 160;
    const artY = 335;
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

    // Publisher Kicker
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accentColor;
    ctx.font = '700 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText((payload.publisher || 'News').toUpperCase(), 160, 1085);

    // Crisp Serif Headline
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 50px "Lora", Georgia, serif';
    const titleLines = wrapCanvasText(ctx, payload.headline, 760, 4);
    let textY = 1160;
    for (const line of titleLines) {
      ctx.fillText(line, 160, textY);
      textY += 66;
    }

    // Minimal Hairline & Attribution + Read Time
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(160, 1445, 760, 2);

    const mins = Math.max(1, payload.readTimeMin || 3);
    const metaLine = payload.author ? `${payload.author}` : 'Distraction-Free Edition';
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = '500 25px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      metaLine.length > 34 ? `${metaLine.slice(0, 32)}…` : metaLine,
      160,
      1505
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 25px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(`${mins} min read`, 920, 1505);

    drawFooterSignature(ctx, theme.accentColor, 1735);
    return canvas;
  }

  // Mode 2: Editorial Pull-Quote Highlight Card ('lyrics' ID retained)
  if (payload.mode === 'lyrics') {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRectPath(ctx, 400, 145, 280, 54, 27);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 21px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KEY PASSAGE', 540, 179);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 26;
    ctx.fillStyle = theme.cardBg;
    roundRectPath(ctx, 90, 260, 900, 1310, 44);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, 90, 260, 900, 1310, 44);
    ctx.stroke();

    // Publisher Header
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accentColor;
    ctx.font = '700 25px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText((payload.publisher || 'News').toUpperCase(), 165, 365);

    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '500 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    const subTitle =
      payload.headline.length > 46 ? `${payload.headline.slice(0, 44)}…` : payload.headline;
    ctx.fillText(subTitle, 165, 412);

    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(165, 458, 750, 2);

    // Clean Editorial Pull-Quote with vertical accent bar
    const quote = payload.quoteText || payload.headline;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 54px "Lora", Georgia, serif';
    const quoteLines = wrapCanvasText(ctx, `“${quote}”`, 705, 9);

    const startY = 580;
    const lineHeight = 86;
    const barHeight = Math.max(120, quoteLines.length * lineHeight - 16);

    ctx.fillStyle = theme.accentColor;
    roundRectPath(ctx, 165, startY - 50, 7, barHeight, 4);
    ctx.fill();

    let qY = startY;
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < quoteLines.length; i++) {
      ctx.fillText(quoteLines[i], 202, qY);
      qY += lineHeight;
    }

    // Minimal Bottom Line
    const mins = Math.max(1, payload.readTimeMin || 3);
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '600 23px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(`${mins} min read · Saved on Chinta`, 165, 1490);

    drawFooterSignature(ctx, theme.accentColor, 1735);
    return canvas;
  }

  // Mode 3: Minimal Newsreader Reading Recap ('wrapped' ID retained)
  const stats = payload.stats;
  const totalMin = stats?.totalMinutesRead ?? 0;
  const totalStories = stats?.totalStoriesRead ?? 0;
  const streak = stats?.streakDays ?? 0;
  const topSources = stats?.topSources?.slice(0, 4) || [];
  const topGenres = stats?.topGenres?.slice(0, 3) || [];

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRectPath(ctx, 375, 145, 330, 54, 27);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 21px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('READING RECAP', 540, 179);

  // Main Card Container
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.42)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 26;
  ctx.fillStyle = theme.cardBg;
  roundRectPath(ctx, 90, 260, 900, 1310, 44);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, 90, 260, 900, 1310, 44);
  ctx.stroke();

  // Hero Reading Time
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 23px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('FOCUSED READING', 165, 355);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 124px "Lora", Georgia, serif';
  ctx.fillText(`${totalMin}m`, 165, 490);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 30px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText(
    `${totalStories} ${totalStories === 1 ? 'article' : 'articles'} · ${streak}d streak`,
    165,
    555
  );

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(165, 610, 750, 2);

  // Top Sources
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('MOST READ SOURCES', 165, 680);

  if (topSources.length > 0) {
    let sy = 755;
    for (const src of topSources) {
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.font = '700 32px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${src.rank}.`, 165, sy);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 36px "Lora", Georgia, serif';
      const label = src.title.length > 24 ? `${src.title.slice(0, 22)}…` : src.title;
      ctx.fillText(label, 225, sy);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.font = '500 26px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${src.storyCount}`, 915, sy);
      ctx.textAlign = 'left';
      sy += 78;
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '500 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('Read articles to see your top sources here', 165, 760);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(165, 1105, 750, 2);

  // Top Topics
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('TOPICS', 165, 1175);

  if (topGenres.length > 0) {
    const topicLine = topGenres.map((g) => g.name).join(' · ');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 38px "Lora", Georgia, serif';
    const topicLines = wrapCanvasText(ctx, topicLine, 750, 2);
    let ty = 1245;
    for (const line of topicLines) {
      ctx.fillText(line, 165, ty);
      ty += 54;
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '500 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('Topics appear as you read across categories', 165, 1245);
  }

  // Calm Reader Summary Line
  const profileTitle = stats?.readerAura?.title || 'Mindful Reader';
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRectPath(ctx, 165, 1390, 750, 115, 24);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '600 20px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('READING STYLE', 200, 1435);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px "Lora", Georgia, serif';
  ctx.fillText(profileTitle, 200, 1480);

  drawFooterSignature(ctx, theme.accentColor, 1735);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
  });
}

function triggerPngDownload(canvas: HTMLCanvasElement, filename: string) {
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Shares a 9:16 Story card via iOS Share Sheet (Instagram, Facebook, etc.) or saves PNG.
 */
export async function shareSpotifyStyleStory(
  platform: 'instagram' | 'facebook' | 'native' | 'download',
  payload: StoryCardPayload
): Promise<{ ok: boolean; method: string; message: string }> {
  const canvas = await renderStoryCardCanvas(payload);
  const filename = `chinta-story-${Date.now().toString(36)}.png`;

  if (platform === 'download') {
    triggerPngDownload(canvas, filename);
    return {
      ok: true,
      method: 'download',
      message: 'Story image saved.',
    };
  }

  const blob = await canvasToBlob(canvas);
  if (blob && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: 'image/png' });
    const shareData: ShareData = {
      files: [file],
      title: `Chinta · ${payload.headline}`,
      text: `${payload.headline} — Read on চিন্তা (Think)`,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return {
          ok: true,
          method: 'web-share-files',
          message:
            platform === 'instagram'
              ? 'Select Instagram in the Share Sheet.'
              : platform === 'facebook'
                ? 'Select Facebook in the Share Sheet.'
                : 'Story shared.',
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, method: 'cancelled', message: 'Share cancelled.' };
        }
      }
    }
  }

  triggerPngDownload(canvas, filename);
  return {
    ok: true,
    method: 'download-fallback',
    message:
      platform === 'instagram'
        ? 'Image saved — pick it from Photos in Instagram Stories.'
        : platform === 'facebook'
          ? 'Image saved — pick it from Photos in Facebook Stories.'
          : 'Story image saved.',
  };
}
