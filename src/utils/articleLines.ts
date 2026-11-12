import { isJavaScriptWarningText } from './sanitize';

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&[a-z0-9#]+;/gi, (entity) => {
      const lower = entity.toLowerCase();
      if (ENTITY_MAP[lower]) return ENTITY_MAP[lower];
      if (lower.startsWith('&#x')) {
        const code = parseInt(lower.slice(3, -1), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      if (lower.startsWith('&#')) {
        const code = parseInt(lower.slice(2, -1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return entity;
    });
}

function htmlToPlainLines(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeBasicEntities(withoutScripts);
}

/**
 * Normalizes a user-highlighted text selection from the Reader body.
 */
export function sanitizeTextSelection(raw: string, maxLength = 340): string {
  const cleaned = (raw || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 6) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

/**
 * Splits a news paragraph into clean shareable sentences/lines across English and Bengali (`।`),
 * keeping common abbreviations (`U.S.`, `Dr.`, `Mr.`) and decimal numbers (`3.5`) intact.
 */
export function splitParagraphIntoLines(paragraph: string): string[] {
  const normalized = (paragraph || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  // Temporarily protect decimals & common dotted abbreviations from sentence splitting
  const protectedText = normalized
    .replace(/(\d)\.(\d)/g, '$1__DOT__$2')
    .replace(/\b(U\.S|U\.K|U\.N|E\.U|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Fig)\./gi, '$1__DOT__')
    .replace(/([A-Z])\.([A-Z])\./g, '$1__DOT__$2__DOT__');

  const rawParts = protectedText
    .split(/(?<=[.!?।])\s+(?=[A-Z0-9"“‘(\u0980-\u09FF])/u)
    .map((p) => p.replace(/__DOT__/g, '.').trim())
    .filter(Boolean);

  // Merge tiny trailing fragments (< 20 chars) back onto previous sentence when helpful
  const merged: string[] = [];
  for (const part of rawParts) {
    if (part.length < 20 && merged.length > 0 && merged[merged.length - 1].length < 180) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

/**
 * Extracts all clean, shareable lines/sentences from an article's extracted blocks,
 * clean text, HTML, or summary — ready for Spotify-style line picking inside QuoteShareModal.
 */
export function extractSelectableArticleLines(params: {
  articleText?: string;
  contentHtml?: string;
  contentClean?: string;
  summary?: string;
  title?: string;
  maxLines?: number;
}): string[] {
  const {
    articleText,
    contentHtml,
    contentClean,
    summary,
    title,
    maxLines = 60,
  } = params;

  const rawSources: string[] = [];
  if (articleText && articleText.trim().length > 0) {
    rawSources.push(articleText);
  } else if (contentClean && contentClean.trim().length > 0) {
    rawSources.push(contentClean);
  }
  if (contentHtml && contentHtml.trim().length > 0 && rawSources.length === 0) {
    rawSources.push(htmlToPlainLines(contentHtml));
  }
  if (summary && summary.trim().length > 0) {
    rawSources.push(htmlToPlainLines(summary));
  }

  const lines: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: string) => {
    const clean = candidate.replace(/\s+/g, ' ').trim();
    if (clean.length < 18) return;
    if (isJavaScriptWarningText(clean)) return;
    if (/^tap to load full story|full story loads in the app/i.test(clean)) return;
    const clipped = clean.length > 260 ? `${clean.slice(0, 256).trim()}…` : clean;
    const key = clipped.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(clipped);
  };

  for (const source of rawSources) {
    const paragraphs = source
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const para of paragraphs) {
      const sentences = splitParagraphIntoLines(para);
      for (const s of sentences) {
        pushCandidate(s);
        if (lines.length >= maxLines) return lines;
      }
    }
  }

  if (title && title.trim().length >= 8) {
    pushCandidate(title);
  }

  return lines;
}

/**
 * Combines chosen line indices in reading order into a crisp quote card string.
 */
export function composeSelectedQuote(
  lines: string[],
  selectedIndices: number[],
  fallback = ''
): string {
  const uniqueSorted = Array.from(new Set(selectedIndices))
    .filter((i) => i >= 0 && i < lines.length)
    .sort((a, b) => a - b);

  if (uniqueSorted.length === 0) return fallback;
  const joined = uniqueSorted.map((i) => lines[i]).join(' ');
  return joined.length > 340 ? `${joined.slice(0, 336).trim()}…` : joined;
}
