import DOMPurify from 'dompurify';
import {
  stripTrackingParams,
  isTrackerUrl,
  isAllowedPublisherMediaUrl,
} from './urlSecurity';

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

/**
 * Checks whether an <img> tag is a tracking pixel, 1x1/0x0 beacon, hidden via inline style,
 * or points to a known tracker/beacon domain.
 */
export function isTrackingPixelImgTag(imgTagHtml: string): boolean {
  if (!imgTagHtml) return false;

  // 1. Check width="1", height="1", width="0", height="0" (quoted or unquoted, with optional px)
  if (/\b(?:width|height)\s*=\s*(?:["']?\s*(?:0|1)(?:px)?\s*["']?)(?:\s|>|\/|$)/i.test(imgTagHtml)) {
    return true;
  }

  // 2. Check inline style containing display:none, visibility:hidden, opacity:0, width:1px, height:1px, width:0, height:0
  const styleMatch = imgTagHtml.match(/\bstyle\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
  const styleVal = (styleMatch?.[1] || styleMatch?.[2] || '').toLowerCase();
  if (styleVal) {
    if (
      /display\s*:\s*none/i.test(styleVal) ||
      /visibility\s*:\s*hidden/i.test(styleVal) ||
      /opacity\s*:\s*0(?:\b|;|px|$)/i.test(styleVal) ||
      /(?:^|;|\s)(?:width|height)\s*:\s*(?:0|1)(?:px)?(?:\b|;|\s|$)/i.test(styleVal)
    ) {
      return true;
    }
  }

  // 3. Check src / data-src against known tracker hosts or 1x1 pixel filenames
  const srcMatch = imgTagHtml.match(/\b(?:src|data-src|data-lazy-src)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i);
  const rawSrc = (srcMatch?.[1] || srcMatch?.[2] || '').trim();
  if (!rawSrc) return true;
  if (isTrackerUrl(rawSrc)) return true;
  if (/(?:^|\/|[._-])1x1(?:[._-]|$)/i.test(rawSrc) || /\btracking\b|\bbeacon\b|\bpixel\b/i.test(rawSrc)) {
    return true;
  }

  return false;
}

export interface SanitizeArticleOptions {
  articleUrl?: string;
  blockThirdPartyMedia?: boolean;
  strictTextOnlyMode?: boolean;
}

/**
 * Pure cross-environment HTML sanitizer and tracking pixel blocker.
 * Strips executable/external tags (<script>, <iframe>, <object>, <embed>, <form>, <input>, <style>, <link>, <meta>),
 * inline on* attributes, tracking pixels (1x1, 0x0, hidden styles, tracker domains), and tracking URL parameters.
 * Forces rel="noopener noreferrer" and referrerPolicy="no-referrer" on all <a> tags, and
 * referrerPolicy="no-referrer" on all allowed <img> and <video> tags.
 */
export function sanitizeArticleHtml(html: string, options?: SanitizeArticleOptions): string {
  if (!html) return '';

  const blockThirdParty = options?.blockThirdPartyMedia ?? false;
  const strictTextOnly = options?.strictTextOnlyMode ?? false;
  const articleUrl = options?.articleUrl;

  // Step 1: Remove paired executable and external resource blocks BEFORE DOMPurify (so tracking styles on <img> are inspected before style attributes are stripped)
  let working = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|iframe|object|embed|form|style|noscript|button|applet|frame|frameset)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|form|input|style|link|meta|noscript|button|base|applet|frame|frameset)\b[^>]*\/?>/gi, '');

  // Step 2: Detect and remove tracking pixels and hidden beacon <img> tags BEFORE style attributes are stripped
  working = working.replace(/<img\b[^>]*>/gi, (imgTag) => {
    if (isTrackingPixelImgTag(imgTag)) {
      return '';
    }
    if (strictTextOnly) {
      return '';
    }
    const srcMatch = imgTag.match(/\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i);
    const rawSrc = (srcMatch?.[1] || srcMatch?.[2] || '').trim();
    if (!rawSrc || /^javascript:|^data:text\//i.test(rawSrc)) {
      return '';
    }
    if (blockThirdParty && articleUrl && !isAllowedPublisherMediaUrl(rawSrc, articleUrl, true)) {
      return '';
    }
    return imgTag;
  });

  // Step 3: Remove or sanitize <video> and <audio> tags
  working = working.replace(/<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (fullTag, tagName, attrs, inner) => {
    if (strictTextOnly) return '';
    const srcMatch = String(attrs).match(/\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i);
    const rawSrc = (srcMatch?.[1] || srcMatch?.[2] || '').trim();
    if (rawSrc && isTrackerUrl(rawSrc)) return '';
    if (blockThirdParty && articleUrl && rawSrc && !isAllowedPublisherMediaUrl(rawSrc, articleUrl, true)) {
      return '';
    }
    return `<${tagName}${attrs}>${inner}</${tagName}>`;
  });

  // Step 4: Remove any <a> link pointing to known tracker/beacon hosts, and clean allowed <a> links
  working = working.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (fullMatch, attrs, inner) => {
    const hrefMatch = String(attrs).match(/\bhref\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
    const rawHref = (hrefMatch?.[1] || hrefMatch?.[2] || '').trim();
    if (!rawHref || /^javascript:|^vbscript:|^data:/i.test(rawHref)) {
      return inner;
    }
    if (isTrackerUrl(rawHref)) {
      // If the tracker anchor only wraps an empty or stripped image, remove completely
      const textInside = String(inner).replace(/<[^>]+>/g, '').trim();
      return textInside ? textInside : '';
    }
    const cleanHref = stripTrackingParams(rawHref);
    return `<a href="${escapeHtml(cleanHref)}" rel="noopener noreferrer" referrerpolicy="no-referrer">${inner}</a>`;
  });

  // Step 5: Run DOMPurify when in browser DOM environment
  if (typeof window !== 'undefined' && typeof DOMPurify?.sanitize === 'function') {
    working = DOMPurify.sanitize(working, {
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
        'noscript',
        'button',
        'base',
      ],
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ADD_ATTR: ['referrerpolicy', 'target', 'rel'],
    });
  }

  // Step 6: Strip any remaining inline on* event handlers or style attributes in all environments
  working = working
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Step 7: Enforce rel="noopener noreferrer" and referrerpolicy="no-referrer" on all <a> tags
  working = working.replace(/<a\b([^>]*)>/gi, (_, attrs) => {
    const hrefMatch = String(attrs).match(/\bhref\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
    const rawHref = (hrefMatch?.[1] || hrefMatch?.[2] || '').trim();
    if (!rawHref || isTrackerUrl(rawHref) || /^javascript:/i.test(rawHref)) {
      return '<a>';
    }
    const cleanHref = stripTrackingParams(rawHref);
    return `<a href="${escapeHtml(cleanHref)}" rel="noopener noreferrer" referrerpolicy="no-referrer">`;
  });

  // Step 8: Enforce referrerpolicy="no-referrer" and stripped tracking params on all allowed <img> and <video> tags
  working = working.replace(/<img\b([^>]*)>/gi, (fullImg, attrs) => {
    if (isTrackingPixelImgTag(fullImg)) return '';
    const srcMatch = String(attrs).match(/\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i);
    const rawSrc = (srcMatch?.[1] || srcMatch?.[2] || '').trim();
    if (!rawSrc || isTrackerUrl(rawSrc) || /^javascript:/i.test(rawSrc)) return '';
    if (blockThirdParty && articleUrl && !isAllowedPublisherMediaUrl(rawSrc, articleUrl, true)) {
      return '';
    }
    const cleanSrc = stripTrackingParams(rawSrc);
    const altMatch = String(attrs).match(/\balt\s*=\s*["']([^"']*)["']/i);
    const altAttr = altMatch ? ` alt="${escapeHtml(altMatch[1])}"` : ' alt=""';
    return `<img src="${escapeHtml(cleanSrc)}"${altAttr} referrerpolicy="no-referrer" loading="lazy" />`;
  });

  working = working.replace(/<video\b([^>]*)>/gi, (_, attrs) => {
    const srcMatch = String(attrs).match(/\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i);
    const rawSrc = (srcMatch?.[1] || srcMatch?.[2] || '').trim();
    if (rawSrc && isTrackerUrl(rawSrc)) return '';
    let cleanedAttrs = String(attrs).replace(/\breferrerpolicy\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    if (rawSrc) {
      const cleanSrc = stripTrackingParams(rawSrc);
      cleanedAttrs = cleanedAttrs.replace(
        /\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        `src="${escapeHtml(cleanSrc)}"`
      );
    }
    return `<video${cleanedAttrs} referrerpolicy="no-referrer">`;
  });

  // Step 9: Remove JavaScript warning boilerplate paragraphs
  return working.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (full, inner) => {
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
