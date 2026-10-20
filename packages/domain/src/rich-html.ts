const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li']);

/** Keeps bold, italic, underline, and lists. Drops every attribute and every other tag. Emoji are ordinary text and stay. */
export function sanitizeRichHtml(input: string): string {
  const html = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (full, tag: string) => {
      const name = tag.toLowerCase();
      if (!ALLOWED.has(name)) return '';
      if (name === 'br') return '<br>';
      return full.startsWith('</') ? `</${name}>` : `<${name}>`;
    });
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text ? html.trim() : '';
}

/** Visible words from a detailed concept, for search snippets and the short project concept. */
export function richHtmlToText(input: string): string {
  return sanitizeRichHtml(input)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
