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
    id: 'emerald',
    name: 'Spotify Emerald',
    topColor: '#1DB954',
    midColor: '#0E4E2B',
    bottomColor: '#07140D',
    accentColor: '#1DB954',
    cardBg: '#121514',
    pillText: '#052E16',
  },
  {
    id: 'sunset',
    name: 'Editorial Sunset',
    topColor: '#FF6719',
    midColor: '#9D2235',
    bottomColor: '#1A0A10',
    accentColor: '#FF7A2F',
    cardBg: '#161214',
    pillText: '#2A0E04',
  },
  {
    id: 'midnight',
    name: 'Midnight Aura',
    topColor: '#6366F1',
    midColor: '#2E1065',
    bottomColor: '#09091A',
    accentColor: '#818CF8',
    cardBg: '#11121B',
    pillText: '#1E1B4B',
  },
  {
    id: 'crimson',
    name: 'Crimson Pulse',
    topColor: '#F43F5E',
    midColor: '#881337',
    bottomColor: '#16060C',
    accentColor: '#FB7185',
    cardBg: '#161013',
    pillText: '#4C0519',
  },
  {
    id: 'gold',
    name: 'Vinyl Gold',
    topColor: '#F59E0B',
    midColor: '#78350F',
    bottomColor: '#160E05',
    accentColor: '#FBBF24',
    cardBg: '#161410',
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
        // Put remaining words onto final line and truncate cleanly with ellipsis
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
  // Circle mark ◉
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(386, y - 10, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0B0B0B';
  ctx.beginPath();
  ctx.arc(386, y - 10, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 32px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('চিন্তা · Think', 416, y);
  ctx.restore();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, theme: StoryBackdropTheme) {
  const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
  grad.addColorStop(0, theme.topColor);
  grad.addColorStop(0.42, theme.midColor);
  grad.addColorStop(1, theme.bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  // Subtle ambient orbs
  const radial = ctx.createRadialGradient(840, 320, 30, 840, 320, 580);
  radial.addColorStop(0, 'rgba(255,255,255,0.16)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 1080, 1920);
}

/**
 * Renders a crisp 1080×1920 (9:16 vertical Instagram / Facebook Story) Canvas card.
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

  if (payload.mode === 'song') {
    const coverImg = await loadCorsSafeImage(payload.imageUrl);

    // Top badge
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRectPath(ctx, 360, 130, 360, 62, 31);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NOW READING ON CHINTA', 540, 170);

    // Floating Spotify Song Share Card
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.48)';
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 30;
    ctx.fillStyle = theme.cardBg;
    roundRectPath(ctx, 90, 260, 900, 1340, 48);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    roundRectPath(ctx, 90, 260, 900, 1340, 48);
    ctx.stroke();

    // Square Album-Style Story Cover Art (740x740 centered)
    const artX = 170;
    const artY = 340;
    const artSize = 740;
    ctx.save();
    roundRectPath(ctx, artX, artY, artSize, artSize, 28);
    ctx.clip();

    if (coverImg) {
      const ratio = Math.max(artSize / coverImg.width, artSize / coverImg.height);
      const dw = coverImg.width * ratio;
      const dh = coverImg.height * ratio;
      ctx.drawImage(
        coverImg,
        artX + (artSize - dw) / 2,
        artY + (artSize - dh) / 2,
        dw,
        dh
      );
      // Slight bottom vignette inside art
      const artGrad = ctx.createLinearGradient(0, artY + artSize * 0.5, 0, artY + artSize);
      artGrad.addColorStop(0, 'rgba(0,0,0,0)');
      artGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = artGrad;
      ctx.fillRect(artX, artY, artSize, artSize);
    } else {
      const coverGrad = ctx.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
      coverGrad.addColorStop(0, theme.topColor);
      coverGrad.addColorStop(1, theme.midColor);
      ctx.fillStyle = coverGrad;
      ctx.fillRect(artX, artY, artSize, artSize);

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(artX + artSize * 0.8, artY + artSize * 0.25, 190, 0, Math.PI * 2);
      ctx.fill();

      const initial = (payload.publisher || 'C').trim().charAt(0).toUpperCase();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 280px "Lora", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(initial, artX + artSize / 2, artY + artSize / 2 + 95);
    }
    ctx.restore();

    // Publisher badge over art bottom-left
    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    roundRectPath(ctx, artX + 28, artY + artSize - 88, 360, 56, 28);
    ctx.fill();
    ctx.fillStyle = theme.accentColor;
    ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    const pubClipped =
      payload.publisher.length > 22
        ? `${payload.publisher.slice(0, 20)}…`
        : payload.publisher.toUpperCase();
    ctx.fillText(pubClipped, artX + 54, artY + artSize - 52);

    // Track Headline
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 48px "Lora", Georgia, serif';
    ctx.textAlign = 'left';
    const titleLines = wrapCanvasText(ctx, payload.headline, 740, 3);
    let textY = 1165;
    for (const line of titleLines) {
      ctx.fillText(line, 170, textY);
      textY += 62;
    }

    // Artist / Publisher + Author Line
    const artistLine = payload.author
      ? `${payload.publisher} · ${payload.author}`
      : `${payload.publisher} · Distraction-Free Edition`;
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = '500 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(
      artistLine.length > 42 ? `${artistLine.slice(0, 40)}…` : artistLine,
      170,
      Math.max(1335, textY + 18)
    );

    // Spotify Scrubber Bar
    const barY = 1410;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRectPath(ctx, 170, barY, 740, 10, 5);
    ctx.fill();

    ctx.fillStyle = theme.accentColor;
    roundRectPath(ctx, 170, barY, 530, 10, 5);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(700, barY + 5, 16, 0, Math.PI * 2);
    ctx.fill();

    // Scrubber time labels
    const mins = Math.max(1, payload.readTimeMin || 3);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '600 22px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('100% FOCUSED', 170, barY + 46);
    ctx.textAlign = 'right';
    ctx.fillText(`${mins}:00 MIN READ`, 910, barY + 46);

    // Mini Player Controls
    const ctrlY = 1515;
    // Play / Pause circle
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(540, ctrlY, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.cardBg;
    ctx.fillRect(526, ctrlY - 16, 10, 32);
    ctx.fillRect(544, ctrlY - 16, 10, 32);

    // Prev / Next triangles
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(410, ctrlY);
    ctx.lineTo(445, ctrlY - 20);
    ctx.lineTo(445, ctrlY + 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(402, ctrlY - 20, 6, 40);

    ctx.beginPath();
    ctx.moveTo(670, ctrlY);
    ctx.lineTo(635, ctrlY - 20);
    ctx.lineTo(635, ctrlY + 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(672, ctrlY - 20, 6, 40);

    drawFooterSignature(ctx, theme.accentColor, 1740);
    return canvas;
  }

  if (payload.mode === 'lyrics') {
    // Spotify Lyrics Share Style
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRectPath(ctx, 355, 130, 370, 62, 31);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HIGHLIGHT · KEY LINE', 540, 170);

    // Main Spotify Lyrics Card
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 26;
    ctx.fillStyle = theme.cardBg;
    roundRectPath(ctx, 90, 265, 900, 1320, 48);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    roundRectPath(ctx, 90, 265, 900, 1320, 48);
    ctx.stroke();

    // Top Track Header inside Lyrics Card
    ctx.fillStyle = theme.accentColor;
    roundRectPath(ctx, 160, 345, 96, 96, 20);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 48px "Lora", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText((payload.publisher || 'C').charAt(0).toUpperCase(), 208, 410);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 32px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(
      payload.publisher.length > 26 ? `${payload.publisher.slice(0, 24)}…` : payload.publisher,
      284,
      384
    );
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '500 24px "Plus Jakarta Sans", -apple-system, sans-serif';
    const subTitle =
      payload.headline.length > 38 ? `${payload.headline.slice(0, 36)}…` : payload.headline;
    ctx.fillText(subTitle, 284, 424);

    // Highlighted Quote Lines
    const quote = payload.quoteText || payload.headline;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 56px "Lora", Georgia, serif';
    const quoteLines = wrapCanvasText(ctx, `“${quote}”`, 750, 9);

    let qY = 580;
    for (let i = 0; i < quoteLines.length; i++) {
      // Subtle highlight block behind each line like Spotify Lyrics
      const lineW = Math.min(760, ctx.measureText(quoteLines[i]).width + 32);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRectPath(ctx, 148, qY - 56, lineW, 74, 14);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(quoteLines[i], 164, qY);
      qY += 96;
    }

    // Bottom Track Tag
    ctx.fillStyle = theme.accentColor;
    ctx.font = '700 26px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('READ DISTRACTION-FREE', 164, 1500);

    drawFooterSignature(ctx, theme.accentColor, 1740);
    return canvas;
  }

  // Mode 3: 'wrapped' — Spotify Wrapped Stats Style
  const stats = payload.stats;
  const totalMin = stats?.totalMinutesRead ?? 42;
  const totalStories = stats?.totalStoriesRead ?? 12;
  const streak = stats?.streakDays ?? 1;
  const topSources = stats?.topSources?.slice(0, 4) || [];
  const topGenres = stats?.topGenres?.slice(0, 4) || [];
  const auraTitle = stats?.readerAura?.title || 'Signal Seeker';

  // Top WRAPPED Badge
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRectPath(ctx, 345, 115, 390, 62, 31);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 24px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CHINTA WRAPPED · 2026', 540, 155);

  // Main Card Container
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 26;
  ctx.fillStyle = theme.cardBg;
  roundRectPath(ctx, 80, 220, 920, 1400, 48);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 3;
  roundRectPath(ctx, 80, 220, 920, 1400, 48);
  ctx.stroke();

  // Hero Minutes Read
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 26px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('MINUTES OF DEEP READING', 150, 310);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 132px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText(`${totalMin}`, 150, 445);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '600 32px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText(
    `${totalStories} stories finished · ${streak}d mindful streak`,
    150,
    505
  );

  // Divider
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(150, 548, 780, 2);

  // Top Publishers (#1 - #4)
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 24px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('TOP PUBLISHERS', 150, 610);

  if (topSources.length > 0) {
    let sy = 678;
    for (const src of topSources) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '800 34px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`#${src.rank}`, 150, sy);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 34px "Lora", Georgia, serif';
      const label = src.title.length > 26 ? `${src.title.slice(0, 24)}…` : src.title;
      ctx.fillText(label, 225, sy);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '600 26px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${src.storyCount} reads`, 930, sy);
      ctx.textAlign = 'left';
      sy += 68;
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '500 30px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('Read stories to rank your top newsrooms', 150, 680);
  }

  // Divider
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(150, 960, 780, 2);

  // Top Reading Beats (#1 - #4)
  ctx.fillStyle = theme.accentColor;
  ctx.font = '700 24px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('TOP READING BEATS', 150, 1022);

  if (topGenres.length > 0) {
    let gy = 1090;
    for (const g of topGenres) {
      ctx.fillStyle = g.color || theme.accentColor;
      ctx.beginPath();
      ctx.arc(165, gy - 11, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 32px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${g.rank}. ${g.name}`, 196, gy);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '600 26px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.fillText(`${g.sharePercent}%`, 930, gy);
      ctx.textAlign = 'left';
      gy += 62;
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '500 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('Explore categories to reveal your top beats', 150, 1090);
  }

  // Reader Aura Card at bottom of Wrapped panel
  const auraGrad = ctx.createLinearGradient(140, 1345, 940, 1545);
  auraGrad.addColorStop(0, theme.topColor);
  auraGrad.addColorStop(1, theme.midColor);
  ctx.fillStyle = auraGrad;
  roundRectPath(ctx, 140, 1350, 800, 195, 32);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
  ctx.fillText('YOUR READER AURA', 180, 1405);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 46px "Lora", Georgia, serif';
  ctx.fillText(auraTitle, 180, 1468);

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '500 24px "Plus Jakarta Sans", -apple-system, sans-serif';
  const auraDesc = stats?.readerAura?.subtitle || 'Distraction-free clarity every day.';
  ctx.fillText(auraDesc.length > 56 ? `${auraDesc.slice(0, 54)}…` : auraDesc, 180, 1515);

  drawFooterSignature(ctx, theme.accentColor, 1750);
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
 * Shares a 9:16 Spotify-style Story card to Instagram, Facebook, Native Share Sheet, or PNG Download.
 */
export async function shareSpotifyStyleStory(
  platform: 'instagram' | 'facebook' | 'native' | 'download',
  payload: StoryCardPayload
): Promise<{ ok: boolean; method: string; message: string }> {
  const canvas = await renderStoryCardCanvas(payload);
  const filename = `chinta-${payload.mode}-story-${Date.now().toString(36)}.png`;

  if (platform === 'download') {
    triggerPngDownload(canvas, filename);
    return {
      ok: true,
      method: 'download',
      message: '9:16 Story PNG saved to device.',
    };
  }

  const blob = await canvasToBlob(canvas);
  if (blob && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: 'image/png' });
    const shareData: ShareData = {
      files: [file],
      title: `Chinta · ${payload.headline}`,
      text: `${payload.headline} — Read distraction-free on চিন্তা (Think)`,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return {
          ok: true,
          method: 'web-share-files',
          message:
            platform === 'instagram'
              ? 'Select Instagram Story in your iOS Share Sheet.'
              : platform === 'facebook'
                ? 'Select Facebook Story in your iOS Share Sheet.'
                : 'Story card shared!',
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, method: 'cancelled', message: 'Share cancelled.' };
        }
        // fall through to download fallback
      }
    }
  }

  // Fallback for desktop browsers without Web Share Level 2 file sharing
  triggerPngDownload(canvas, filename);
  return {
    ok: true,
    method: 'download-fallback',
    message:
      platform === 'instagram'
        ? '9:16 PNG saved! Open Instagram Stories and pick it from Photos.'
        : platform === 'facebook'
          ? '9:16 PNG saved! Open Facebook Stories and pick it from Photos.'
          : '9:16 PNG saved to your device.',
  };
}
