import DOMPurify from 'dompurify';
import { isTrackingPixel, isTrackerUrl } from './trackerRules';
import { isFirstPartyMedia } from './mediaPolicy';
import { buildImageProxyUrl } from './mediaShare';

export const MEDIA_PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340" fill="none"><rect width="600" height="340" fill="#141418"/><circle cx="300" cy="150" r="28" fill="#24242A"/><path d="M292 142l16 8-16 8v-16z" fill="#FF6719"/><text x="50%" y="210" text-anchor="middle" fill="#A8A29E" font-family="-apple-system, sans-serif" font-size="13" font-weight="600">Tap to load image</text></svg>';

export const MEDIA_PLACEHOLDER_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(MEDIA_PLACEHOLDER_SVG)}`;

/** Escape plain text so it is safe to place inside HTML markup. */
export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const JS_WARNING_BOILERPLATE_RE =
  /(?:please\s+)?(?:turn\s+on|enable|activate)\s+javascript|javascript\s+is\s+(?:required|disabled|turned\s+off)|you\s+need\s+to\s+enable\s+javascript|enable\s+javascript\s+and\s+cookies\s+to\s+continue|browser\s+does\s+not\s+support\s+javascript|জাভাস্ক্রিপ্ট\s+চালু/i;

export function isJavaScriptWarningText(text: string): boolean {
  if (!text) return false;
  return JS_WARNING_BOILERPLATE_RE.test(text.trim());
}

export interface SanitizeArticleOptions {
  publisherUrl?: string;
  blockThirdPartyMedia?: boolean;
  tapToLoadMedia?: boolean;
}

function getPurify() {
  if (typeof DOMPurify === 'function') {
    const win =
      typeof window !== 'undefined'
        ? window
        : (globalThis as unknown as { window?: unknown }).window;
    if (win) {
      return (DOMPurify as any)(win);
    }
  }
  return DOMPurify;
}

/**
 * Sanitize untrusted article HTML (RSS content, scraped pages) before it is
 * rendered with dangerouslySetInnerHTML. Removes tracking pixels, trackers,
 * scripts, iframes, forms, and handles media privacy policy.
 */
export function sanitizeArticleHtml(html: string, options: SanitizeArticleOptions = {}): string {
  if (!html) return '';

  const purify = getPurify();
  const withoutNoscript = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Add hooks for this sanitize pass
  purify.addHook('uponSanitizeElement', (node: Element, data: any) => {
    if (data.tagName === 'img') {
      const width = node.getAttribute('width');
      const height = node.getAttribute('height');
      const style = node.getAttribute('style');
      const src = node.getAttribute('src') || node.getAttribute('data-src') || '';

      // 1. Remove tracking pixels and tracker URLs
      if (isTrackingPixel({ width, height, style, src }) || (src && isTrackerUrl(src))) {
        node.remove();
        return;
      }

      // 2. Apply media privacy policy: block third-party media or tap-to-load
      const isBlocked =
        Boolean(options.tapToLoadMedia) ||
        Boolean(
          options.blockThirdPartyMedia &&
            options.publisherUrl &&
            src &&
            !isFirstPartyMedia(src, options.publisherUrl)
        );

      if (isBlocked) {
        node.setAttribute('data-chinta-src', src);
        node.setAttribute('src', MEDIA_PLACEHOLDER_DATA_URI);
        node.setAttribute('data-chinta-blocked', '1');
        node.setAttribute('class', 'chinta-tap-to-load-img');
      } else if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
        const proxied = buildImageProxyUrl(src);
        if (proxied) {
          node.setAttribute('src', proxied);
        }
      }
    }
  });

  purify.addHook('afterSanitizeElements', (node: Element) => {
    // For <a> tags whose href is a tracker URL, remove the tag but keep its text
    if (node.nodeName === 'A') {
      const href = node.getAttribute('href') || '';
      if (isTrackerUrl(href)) {
        const parent = node.parentNode;
        if (parent) {
          while (node.firstChild) {
            parent.insertBefore(node.firstChild, node);
          }
          parent.removeChild(node);
        }
      }
    }
  });

  purify.addHook('afterSanitizeAttributes', (node: Element) => {
    // Enforce rel and referrerpolicy on all surviving <a> links
    if (node.nodeName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer');
      node.setAttribute('referrerpolicy', 'no-referrer');
      node.setAttribute('target', '_blank');
    }
    if (node.nodeName === 'IMG') {
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });

  let clean = '';
  try {
    clean = purify.sanitize(withoutNoscript, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'style',
        'link',
        'meta',
        'video',
        'audio',
        'source',
        'track',
      ],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
    });
  } finally {
    purify.removeHook('uponSanitizeElement');
    purify.removeHook('afterSanitizeElements');
    purify.removeHook('afterSanitizeAttributes');
  }

  return clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (full, inner) => {
    const plain = String(inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return isJavaScriptWarningText(plain) ? '' : full;
  });
}

export interface HtmlBlock {
  type: string;
  text?: string;
  src?: string;
  caption?: string;
}

/** Convert extracted plain-text blocks into safe HTML (text is escaped). */
export function blocksToHtml(blocks: HtmlBlock[]): string {
  return blocks
    .map((b) => {
      const text = escapeHtml(b.text || '');
      if (b.type === 'h2' || b.type === 'h3') return `<h2>${text}</h2>`;
      if (b.type === 'blockquote') return `<blockquote>${text}</blockquote>`;
      if (b.type === 'p') return `<p>${text}</p>`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
