import DOMPurify from 'dompurify';

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
 * Sanitize untrusted article HTML (RSS content, scraped pages) before it is
 * rendered with dangerouslySetInnerHTML. Scripts, noscript warnings, event handlers,
 * iframes, forms and javascript: URLs are removed.
 */
export function sanitizeArticleHtml(html: string): string {
  if (!html) return '';
  const withoutNoscript = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const clean = DOMPurify.sanitize(withoutNoscript, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'script', 'noscript'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  });
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
