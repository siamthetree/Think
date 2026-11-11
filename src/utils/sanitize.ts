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

/**
 * Sanitize untrusted article HTML (RSS content, scraped pages) before it is
 * rendered with dangerouslySetInnerHTML. Scripts, event handlers, iframes,
 * forms and javascript: URLs are removed.
 */
export function sanitizeArticleHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'script'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
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
