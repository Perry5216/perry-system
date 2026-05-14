/**
 * @perry/export — KDP Blurb Exporter
 *
 * Converts markdown-formatted blurbs into the exact HTML subset
 * Amazon KDP accepts in the Book Description field, plus variants.
 *
 * KDP allows: <b>, <i>, <u>, <br>, <p>, <ul>, <li>, <ol>, <em>,
 *             <strong>, <h4>, <h5>, <h6>, <s>, <sub>, <sup>.
 * Limit: 4000 characters (including tags). Sweet spot: 1800-2200.
 *
 * Ported from V4 with improvements:
 *   - Exported as a standalone function (no class wrapper needed)
 *   - Better sentence-boundary truncation for preview
 */

const KDP_ALLOWED_TAGS = new Set([
  'b', 'i', 'u', 'br', 'p', 'ul', 'li', 'ol',
  'em', 'strong', 'h4', 'h5', 'h6', 's', 'sub', 'sup',
]);

const KDP_MAX_CHARS = 4000;
const KDP_PREVIEW_MAX_CHARS = 400;

export interface BlurbExport {
  html: string;
  plainText: string;
  preview: string;
  charCount: number;
  plainCharCount: number;
  warnings: string[];
}

/**
 * Convert a markdown blurb into KDP-compliant HTML + variants.
 */
export function exportBlurb(input: string): BlurbExport {
  const warnings: string[] = [];
  let html = markdownToKdpHtml(input);
  html = stripDisallowedTags(html, warnings);
  html = normalizeWhitespace(html);

  if (html.length > KDP_MAX_CHARS) {
    warnings.push(
      `HTML length ${html.length} exceeds KDP's ${KDP_MAX_CHARS}-char limit. Trim the blurb or remove formatting.`
    );
  }

  const plainText = stripTags(html);
  const preview = makePreview(plainText);

  return { html, plainText, preview, charCount: html.length, plainCharCount: plainText.length, warnings };
}

function markdownToKdpHtml(input: string): string {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;

  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  const fmt = (s: string): string => {
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
    s = s.replace(/\b_([^_\n]+)_\b/g, '<i>$1</i>');
    return s;
  };

  const buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) {
      const text = fmt(buf.join(' ').trim());
      if (text) out.push(`<p>${text}</p>`);
      buf.length = 0;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flush(); closeList(); continue; }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flush();
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push(`<li>${fmt(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      flush();
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push(`<li>${fmt(numbered[1])}</li>`);
      continue;
    }

    closeList();
    buf.push(line);
  }

  flush();
  closeList();
  return out.join('\n');
}

function stripDisallowedTags(html: string, warnings: string[]): string {
  const disallowed = new Set<string>();
  const cleaned = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (KDP_ALLOWED_TAGS.has(lower)) return match;
    disallowed.add(lower);
    return '';
  });
  if (disallowed.size > 0) {
    warnings.push(`Stripped disallowed tags: ${Array.from(disallowed).join(', ')}`);
  }
  return cleaned;
}

function normalizeWhitespace(html: string): string {
  return html.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function makePreview(plainText: string): string {
  const firstPara = plainText.split(/\n\s*\n/)[0] || plainText;
  if (firstPara.length <= KDP_PREVIEW_MAX_CHARS) return firstPara.trim();
  const truncated = firstPara.substring(0, KDP_PREVIEW_MAX_CHARS);
  const lastSentence = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? ')
  );
  if (lastSentence > KDP_PREVIEW_MAX_CHARS * 0.6) {
    return truncated.substring(0, lastSentence + 1).trim();
  }
  const lastSpace = truncated.lastIndexOf(' ');
  return truncated.substring(0, lastSpace > 0 ? lastSpace : KDP_PREVIEW_MAX_CHARS).trim() + '…';
}
