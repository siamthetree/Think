import createDOMPurify from 'dompurify';
import { isTrackerUrl, isTrackingPixel, stripTrackingParams } from './trackerRules';
import { isFirstPartyMedia } from './mediaPolicy';
import { buildImageProxyUrl } from './mediaShare';

type DOMPurifyInstance = ReturnType<typeof createDOMPurify>;

let purifyInstance: DOMPurifyInstance | null = null;

function getDOMPurify(): DOMPurifyInstance | null {
  if (purifyInstance) return purifyInstance;
  if (typeof window !== 'undefined' && window.document) {
    purifyInstance = createDOMPurify(window as unknown as Window & typeof globalThis);
    return purifyInstance;
  }
  return null;
}

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const JS_WARNING_BOILERPLATE_RE =
  /(?:please\s+)?(?:turn\s+on|enable|activate)\s+javascript|javascript\s+is\s+(?:required|disabled|turned\s+off)|you\s+need\s+to\s+enable\s+javascript|enable\s+javascript\s+and\s+cookies\s+to\s+continue|browser\s+does\s+not\s+support\s+javascript|জাভাস্ক্রিপ্ট\s+চালু/i;

export function isJavaScriptWarningText(text?: string | null): boolean {
  if (!text) return false;
  return JS_WARNING_BOILERPLATE_RE.test(text.trim());
}

export function blocksToHtml(
  blocks: Array<{ type: string; text?: string; src?: string }>
): string {
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

export interface SanitizeArticleOptions {
  articleUrl?: string;
  publisherUrl?: string;
  blockThirdPartyMedia?: boolean;
  tapToLoadMedia?: boolean;
}

const TRANSPARENT_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function extractAttr(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
}

function sanitizeWithoutDom(dirtyHtml: string, options?: SanitizeArticleOptions): string {
  const baseUrl = options?.articleUrl || options?.publisherUrl || '';
  const blockThirdPartyMedia = options?.blockThirdPartyMedia ?? true;
  const tapToLoadMedia = options?.tapToLoadMedia ?? false;

  let html = dirtyHtml
    .replace(/<(script|style|iframe|object|embed|form|textarea|select|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(input|button|meta|link|base|source)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Sanitize <a> links
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_full, attrs: string, inner: string) => {
    const rawHref = extractAttr(attrs, 'href');
    if (rawHref && isTrackerUrl(rawHref)) {
      return inner;
    }
    const cleanHref = rawHref ? stripTrackingParams(rawHref) : '';
    const hrefAttr = cleanHref ? ` href="${escapeHtml(cleanHref)}"` : '';
    return `<a${hrefAttr} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${inner}</a>`;
  });

  // Sanitize <img> tags
  html = html.replace(/<img\b([^>]*)\/?>/gi, (_full, attrs: string) => {
    const width = extractAttr(attrs, 'width');
    const height = extractAttr(attrs, 'height');
    const style = extractAttr(attrs, 'style');
    const rawSrc = extractAttr(attrs, 'src');
    const alt = extractAttr(attrs, 'alt');

    if (isTrackingPixel({ width, height, style, src: rawSrc })) {
      return '';
    }
    if (!rawSrc) return '';

    const src = stripTrackingParams(rawSrc);
    if (isTrackerUrl(src)) {
      return '';
    }

    const altAttr = alt ? ` alt="${escapeHtml(alt)}"` : '';

    if (tapToLoadMedia) {
      return `<img src="${TRANSPARENT_PLACEHOLDER}" data-chinta-src="${escapeHtml(src)}" data-chinta-blocked="1"${altAttr} referrerpolicy="no-referrer" />`;
    }

    if (blockThirdPartyMedia && baseUrl && /^https?:\/\//i.test(src)) {
      if (!isFirstPartyMedia(src, baseUrl)) {
        return `<img src="${TRANSPARENT_PLACEHOLDER}" data-chinta-src="${escapeHtml(src)}" data-chinta-blocked="1"${altAttr} referrerpolicy="no-referrer" />`;
      }
    }

    if (/^https?:\/\//i.test(src)) {
      return `<img src="${TRANSPARENT_PLACEHOLDER}" data-chinta-src="${escapeHtml(src)}"${altAttr} referrerpolicy="no-referrer" />`;
    }

    return `<img src="${escapeHtml(src)}"${altAttr} referrerpolicy="no-referrer" />`;
  });

  return html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (full, inner) => {
    const plain = String(inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return isJavaScriptWarningText(plain) ? '' : full;
  });
}

/**
 * Sanitizes untrusted RSS/Atom or extracted article HTML before rendering.
 * Strips scripts, event handlers, tracking pixels, tracker URLs, tracking parameters,
 * unproxied srcset attributes, and optionally third-party or auto-loaded images.
 */
export function sanitizeArticleHtml(
  dirtyHtml: string,
  options?: SanitizeArticleOptions
): string {
  if (!dirtyHtml) return '';

  const purify = getDOMPurify();
  if (!purify) {
    return sanitizeWithoutDom(dirtyHtml, options);
  }

  const articleUrl = options?.articleUrl || options?.publisherUrl || '';
  const blockThirdPartyMedia = options?.blockThirdPartyMedia ?? true;
  const tapToLoadMedia = options?.tapToLoadMedia ?? false;

  purify.removeAllHooks();

  purify.addHook('uponSanitizeElement', (node, data) => {
    const el = node as Element;
    if (!el || typeof el.getAttribute !== 'function') return;

    const tag = data.tagName?.toLowerCase();

    if (tag === 'img') {
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
      el.removeAttribute('data-srcset');
      el.removeAttribute('data-src');
      el.removeAttribute('data-original');
      el.removeAttribute('data-lazy-src');

      if (isTrackingPixel(el)) {
        el.parentNode?.removeChild(el);
        return;
      }

      const rawSrc = el.getAttribute('src') || '';
      if (!rawSrc) {
        el.parentNode?.removeChild(el);
        return;
      }

      const src = stripTrackingParams(rawSrc);
      if (isTrackerUrl(src)) {
        el.parentNode?.removeChild(el);
        return;
      }

      if (tapToLoadMedia) {
        el.setAttribute('data-chinta-src', src);
        el.setAttribute('data-chinta-blocked', '1');
        el.setAttribute('src', TRANSPARENT_PLACEHOLDER);
        return;
      }

      if (blockThirdPartyMedia && articleUrl && /^https?:\/\//i.test(src)) {
        if (!isFirstPartyMedia(src, articleUrl)) {
          el.setAttribute('data-chinta-src', src);
          el.setAttribute('data-chinta-blocked', '1');
          el.setAttribute('src', TRANSPARENT_PLACEHOLDER);
          return;
        }
      }

      if (/^https?:\/\//i.test(src)) {
        el.setAttribute('data-chinta-src', src);
        el.setAttribute('src', TRANSPARENT_PLACEHOLDER);
        el.setAttribute('referrerpolicy', 'no-referrer');
      }
    } else if (tag === 'iframe' || tag === 'script') {
      const src = el.getAttribute('src') || '';
      if (src && isTrackerUrl(src)) {
        el.parentNode?.removeChild(el);
      }
    }
  });

  purify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (!el || typeof el.getAttribute !== 'function') return;

    if (el.tagName === 'A') {
      el.removeAttribute('ping');
      const href = el.getAttribute('href') || '';
      if (href && isTrackerUrl(href)) {
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
          }
          parent.removeChild(el);
        }
        return;
      }
      if (href) {
        const cleanHref = stripTrackingParams(href);
        el.setAttribute('href', cleanHref);
      }
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('referrerpolicy', 'no-referrer');
    } else if (el.tagName === 'IMG') {
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
      el.setAttribute('referrerpolicy', 'no-referrer');
    }
  });

  const clean = purify.sanitize(dirtyHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'meta',
      'link',
      'base',
      'source',
      'picture',
      'noscript',
    ],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur',
      'srcset',
      'ping',
    ],
    ADD_ATTR: ['target', 'rel', 'referrerpolicy', 'data-chinta-src', 'data-chinta-blocked'],
  });

  purify.removeAllHooks();
  return clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (full, inner) => {
    const plain = String(inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return isJavaScriptWarningText(plain) ? '' : full;
  });
}
