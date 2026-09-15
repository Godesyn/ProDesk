/**
 * The letter.
 *
 * Two failures are worth pinning here, and neither is about how it looks.
 *
 * First: the body used to be posted straight into Smartlead's `email_body`,
 * which is an HTML field. A three-paragraph note written in a textarea arrived
 * as one run-on block, because HTML does not honour newlines — an entirely
 * invisible bug from the editor, which rendered the same text with
 * `whitespace-pre-wrap` and looked correct.
 *
 * Second: merge tags have to survive the render. The shell escapes the body
 * before it styles it, and if that escaping ever touched a brace, every tag in
 * every template would reach Smartlead as `&#123;&#123;hook&#125;&#125;` and
 * substitute to nothing.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailHtml } from './email-shell.js';

describe('renderEmailHtml', () => {
  it('keeps paragraphs apart', () => {
    const html = renderEmailHtml('First para.\n\nSecond para.');
    expect(html.match(/<p style/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('First para.');
    expect(html).toContain('Second para.');
  });

  it('keeps a single newline as a line break rather than dropping it', () => {
    // A sign-off is two lines of one paragraph, not two paragraphs.
    expect(renderEmailHtml('Thanks,\nSajat')).toContain('Thanks,<br />Sajat');
  });

  it('passes merge tags through untouched', () => {
    const html = renderEmailHtml('Hi {{first_name}}, {{hook}}');
    expect(html).toContain('{{first_name}}');
    expect(html).toContain('{{hook}}');
  });

  it('escapes the body so a business name cannot break the markup', () => {
    const html = renderEmailHtml('Smith & Sons <script>alert(1)</script>');
    expect(html).toContain('Smith &amp; Sons');
    expect(html).not.toContain('<script>');
  });

  it('gives the standing block its label and its sentence', () => {
    const html = renderEmailHtml('> What we saw on Google\n> {{hook}}');
    expect(html).toContain('What we saw on Google');
    expect(html).toContain('{{hook}}');
    // The Forest rule is the block's whole identity — without it this is a
    // paragraph.
    expect(html).toContain('#2E9E58');
  });

  it('treats a one-line quote as the sentence, not as a label', () => {
    const html = renderEmailHtml('> {{hook}}');
    expect(html).toContain('{{hook}}');
    // No eyebrow: an uppercase label invented for a lone sentence is decoration.
    expect(html).not.toContain('text-transform:uppercase');
  });

  it('makes a link on its own line the button, and one in a sentence a link', () => {
    const button = renderEmailHtml('[Book a look](https://prodesk.com)');
    expect(button).toContain('border-radius:6px');
    expect(button).toContain('Book a look');

    const inline = renderEmailHtml('You can [book a look](https://prodesk.com) any time.');
    expect(inline).toContain('<a href="https://prodesk.com"');
    expect(inline).not.toContain('border-radius:6px;">\n      <a');
  });

  it('refuses an href that is not http, mailto or a merge tag', () => {
    const html = renderEmailHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    // The label survives — the link is what is dropped, not the sentence.
    expect(html).toContain('click');
  });

  it('sends a fragment, not a document, because Smartlead owns the envelope', () => {
    const html = renderEmailHtml('Hello.');
    expect(html).not.toContain('<html');
    expect(html).not.toContain('<body');
  });

  it('asks for nothing from the network', () => {
    // Every remote request in a cold email is a blocked image, a gateway
    // signal, or both. There are no images and no webfonts by construction, and
    // this is the test that keeps it that way.
    const html = renderEmailHtml('Hi {{first_name}},\n\n> Label\n> {{hook}}\n\n[Go](https://x.com)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('@import');
  });
});
