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

export interface SanitizeArticleOptions {
  articleUrl?: string;
  blockThirdPartyMedia?: boolean;
  tapToLoadMedia?: boolean;
}

const TRANSPARENT_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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
    return dirtyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  const articleUrl = options?.articleUrl || '';
  const blockThirdPartyMedia = options?.blockThirdPartyMedia ?? true;
  const tapToLoadMedia = options?.tapToLoadMedia ?? false;

  purify.removeAllHooks();

  purify.addHook('uponSanitizeElement', (node, data) => {
    const el = node as Element;
    if (!el || typeof el.getAttribute !== 'function') return;

    const tag = data.tagName?.toLowerCase();

    if (tag === 'img') {
      // Always remove srcset and lazy-load attributes so browsers never fetch unproxied publisher URLs directly
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
        el.setAttribute('data-chinta-blocked', 'tap-to-load');
        el.setAttribute('src', TRANSPARENT_PLACEHOLDER);
        return;
      }

      if (blockThirdPartyMedia && articleUrl && /^https?:\/\//i.test(src)) {
        if (!isFirstPartyMedia(src, articleUrl)) {
          el.setAttribute('data-chinta-src', src);
          el.setAttribute('data-chinta-blocked', 'third-party');
          el.setAttribute('src', TRANSPARENT_PLACEHOLDER);
          return;
        }
      }

      // Route all surviving HTTP(S) images through the local image proxy to prevent publisher IP & Referer leaks
      if (/^https?:\/\//i.test(src)) {
        const proxied = buildImageProxyUrl(src);
        if (proxied) {
          el.setAttribute('src', proxied);
          el.setAttribute('referrerpolicy', 'no-referrer');
        } else {
          el.parentNode?.removeChild(el);
        }
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
      // Remove ping attribute so clicks never fire tracking beacons
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
  return clean;
}
