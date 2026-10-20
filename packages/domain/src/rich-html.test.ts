import { describe, expect, it } from 'vitest';
import { richHtmlToText, sanitizeRichHtml } from './rich-html';

describe('sanitizeRichHtml', () => {
  it('keeps bold, italic, and emoji', () => {
    expect(sanitizeRichHtml('<b class="x" onclick="alert(1)">Hook</b> 🔥 <i>now</i>')).toBe('<b>Hook</b> 🔥 <i>now</i>');
  });

  it('drops scripts and unknown tags', () => {
    expect(sanitizeRichHtml('<script>alert(1)</script><p>Safe</p><img src=x>')).toBe('<p>Safe</p>');
  });

  it('treats an empty editor as blank', () => {
    expect(sanitizeRichHtml('<p><br></p>')).toBe('');
  });

  it('reads the words out of a detailed concept', () => {
    expect(richHtmlToText('<p>One take, <b>golden</b> hour.</p>')).toBe('One take, golden hour.');
  });
});
