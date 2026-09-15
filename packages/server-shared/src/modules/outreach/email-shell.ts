/**
 * OUTREACH EMAIL SHELL — the designed letter a sequence body is wrapped in.
 *
 * Dependency-free, so the sequence editor renders its preview through the exact
 * same function that produces the HTML we hand Smartlead. A preview drawn by a
 * second implementation is a preview that will eventually disagree with what
 * was sent, and the whole point of the preview is that it doesn't.
 *
 * WHY A SHELL AND NOT A RICH-TEXT EDITOR
 * The body used to go to Smartlead's `email_body` — an HTML field — as raw
 * textarea text. Every newline collapsed, so a three-paragraph note arrived as
 * one run-on block. Rather than hand the operator an HTML editor and hope, the
 * body stays plain and legible (it is the thing that has to sound like a person
 * typed it) and the design is applied around it, in one place, where it can be
 * held to a standard.
 *
 * WHY IT LOOKS RESTRAINED
 * This is cold mail from warmed mailboxes under per-mailbox daily caps. Images,
 * webfonts, tracking pixels and a wall of markup are what separate "a person
 * wrote to me" from the Promotions tab, and the domain reputation those caps
 * exist to protect is the asset here. So: no images, no remote requests, no
 * webfonts, a high text-to-markup ratio, and exactly two accented elements —
 * the standing block and one button. Everything else is type and space.
 *
 * WHAT MAKES IT OURS
 * The standing block. The pipeline already composes `{{hook}}` — this business's
 * Google review count against the median of its own council area, scraped in
 * the same run — and that sentence is the one thing in the letter that could
 * not have been sent to anybody else. It gets the only serif, the only hanging
 * rule, and the space around it that says: read this line. Everything else in
 * the letter is deliberately quiet so that it lands.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * Tokens
 *
 * Hex, not CSS variables: `var()` is unsupported across most mail clients, and
 * a token that resolves to nothing takes the colour with it. These are the
 * suite's own values from styles/theme.css, resolved by hand — Forest #2E9E58
 * at hsl(142.5 55% 40%), ink #0E0E0C, and the accent-tinted paper.
 * ────────────────────────────────────────────────────────────────────────── */

const C = {
  /** The page behind the letter — the suite's tinted paper, hsl(142.5 22% 94%). */
  field: '#E8F0EA',
  /** The letter itself. White, because a tinted reading surface reads as a newsletter. */
  paper: '#FFFFFF',
  ink: '#0E0E0C',
  /** Body copy. Pure ink at 16px over a full column is heavier than it needs to be. */
  body: '#3D3D36',
  /** Footer, eyebrows, anything that must recede. */
  mute: '#7A7A70',
  rule: '#E2E0D6',
  forest: '#2E9E58',
  /** Forest is a fill, not a text colour — this is the same hue taken to a readable weight. */
  forestInk: '#1F6E3D',
} as const;

/**
 * Body face: system stack only.
 *
 * A webfont in a cold email costs a remote request the recipient's client will
 * often block and their gateway will always notice. The letter is set in
 * whatever the reader's own OS uses for interface text, which is the most
 * "written by a person" a typeface can be.
 */
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Display face: reserved for the standing block and the wordmark, nothing else.
 *
 * Georgia is on effectively every machine that will open this, and setting one
 * sentence in a serif inside an otherwise sans letter is what marks it as the
 * line worth reading. Used twice per email, on purpose.
 */
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', Times, serif";

/* ──────────────────────────────────────────────────────────────────────────
 * Authoring
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The small markup the body is written in.
 *
 * Deliberately tiny. Everything here earns its place by appearing in a real
 * cold email; there is no table syntax, no image syntax and no colour syntax,
 * because none of those belong in one.
 */
export const BODY_SYNTAX = [
  { syntax: 'Blank line', means: 'Starts a new paragraph.' },
  { syntax: '## Heading', means: 'A small section heading.' },
  {
    syntax: '> Eyebrow\n> Sentence',
    means: 'The standing block — the accented pull-quote. Put {{hook}} here. First line is its label.',
  },
  { syntax: '- item', means: 'A bullet. Consecutive lines make one list.' },
  { syntax: '[Label](https://…)', means: 'On its own line it becomes the button; inside a sentence, a link.' },
  { syntax: '---', means: 'A hairline divider.' },
  { syntax: '**bold**  ·  *italic*', means: 'Emphasis.' },
] as const;

/* ──────────────────────────────────────────────────────────────────────────
 * Rendering
 * ────────────────────────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only http(s), mailto and a bare merge tag may become an href. */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^\{\{\s*\w+\s*\}\}$/.test(u)) return u;
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return escapeHtml(u);
  return null;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Inline emphasis and links, applied to already-escaped text.
 *
 * Escaping first means a business name with an ampersand in it can't break the
 * markup, and the merge braces survive untouched — `{` and `}` are not special
 * to HTML, so `{{hook}}` reaches Smartlead intact.
 */
function inline(raw: string): string {
  let out = escapeHtml(raw);
  out = out.replace(LINK, (_whole, label: string, url: string) => {
    const href = safeHref(url);
    if (!href) return label;
    return `<a href="${href}" style="color:${C.forestInk};text-decoration:underline;text-underline-offset:2px;">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:600;color:${C.ink};">$1</strong>`);
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return out;
}

/** A paragraph, at the measure and leading the whole letter is set to. */
function p(html: string, topMargin = 16): string {
  return `<p style="margin:${topMargin}px 0 0;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body};">${html}</p>`;
}

/**
 * THE SIGNATURE ELEMENT — the standing.
 *
 * A hanging Forest rule, a letterspaced label, and the sentence in serif. It is
 * built from table cells rather than a bordered div because Outlook drops
 * left borders on block elements, and this is the one element in the letter
 * that must not degrade — without it this is a template, and with it, it isn't.
 */
function standing(eyebrow: string | null, lines: string[]): string {
  const label = eyebrow
    ? `<div style="font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:${C.forestInk};padding-bottom:6px;">${eyebrow}</div>`
    : '';
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:26px;border-collapse:collapse;">
  <tr>
    <td width="3" style="width:3px;background-color:${C.forest};font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding:2px 0 2px 18px;">
      ${label}
      <div style="font-family:${SERIF};font-size:21px;line-height:31px;color:${C.ink};">${lines.join('<br />')}</div>
    </td>
  </tr>
</table>`;
}

/**
 * The call to action.
 *
 * A table-cell button, left-aligned at the text margin rather than centred:
 * centred buttons are the single most newsletter-shaped thing an email can do,
 * and this letter is trying not to look like one. Padded generously enough to
 * be a comfortable tap target on a phone.
 */
function button(label: string, href: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;border-collapse:separate;">
  <tr>
    <td style="background-color:${C.forest};border-radius:6px;">
      <a href="${href}" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:6px;">${label}</a>
    </td>
  </tr>
</table>`;
}

/** One authored block, classified by how it starts. */
function renderBlock(block: string, isFirst: boolean): string {
  const lines = block.split('\n').map((l) => l.trimEnd());
  const top = isFirst ? 0 : 16;

  if (lines.every((l) => /^---+$/.test(l.trim()))) {
    return `<div style="margin-top:28px;border-top:1px solid ${C.rule};font-size:0;line-height:0;">&nbsp;</div>`;
  }

  if (lines[0].startsWith('## ')) {
    return `<h2 style="margin:${isFirst ? 0 : 30}px 0 0;font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-0.01em;line-height:22px;color:${C.ink};">${inline(lines[0].slice(3))}</h2>`;
  }

  if (lines[0].startsWith('>')) {
    const quoted = lines
      .filter((l) => l.startsWith('>'))
      .map((l) => l.replace(/^>\s?/, '').trim())
      .filter(Boolean);
    if (quoted.length === 0) return '';
    // Two or more lines: the first is the label. One line stands alone — an
    // eyebrow invented for a single sentence would be decoration.
    const eyebrow = quoted.length > 1 ? inline(quoted[0]) : null;
    const rest = (eyebrow ? quoted.slice(1) : quoted).map(inline);
    return standing(eyebrow, rest);
  }

  if (lines[0].startsWith('- ')) {
    const items = lines
      .filter((l) => l.startsWith('- '))
      .map(
        (l) =>
          `<li style="margin:0 0 8px;padding-left:4px;">${inline(l.slice(2))}</li>`,
      )
      .join('');
    return `<ul style="margin:${top + 4}px 0 0;padding-left:20px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body};">${items}</ul>`;
  }

  // A link alone on its line is the button — the only way to get one, so an
  // email can't accidentally sprout three.
  const solo = block.trim().match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (solo) {
    const href = safeHref(solo[2]);
    if (href) return button(escapeHtml(solo[1]), href);
  }

  return p(lines.map(inline).join('<br />'), top);
}

export interface EmailShellOptions {
  /** The wordmark at the head of the letter. Type, never an image. */
  wordmark?: string;
  /**
   * The footer's plain-language opt-out.
   *
   * A reply, not a link: the reply classifier already treats unsubscribe
   * language as instant automatic suppression, so the sentence the recipient
   * reads and the mechanism that honours it are the same thing.
   */
  footerNote?: string;
  /** Who is writing, shown under the note. Keep it to a line. */
  senderLine?: string;
}

const DEFAULTS: Required<EmailShellOptions> = {
  wordmark: 'ProDesk',
  footerNote: 'Not for you? Reply “no thanks” and I’ll take you off the list — that’s the whole process.',
  senderLine: '',
};

/**
 * Wrap an authored body in the letter.
 *
 * Returns a FRAGMENT, not a document: Smartlead owns the envelope, and an
 * `<html>` wrapper handed to an ESP that writes its own is how you end up with
 * two of them. The `<style>` block carries mobile and dark-mode rules only —
 * Gmail strips it, which is exactly why nothing structural lives there. Every
 * colour, size and space that matters is inline.
 */
export function renderEmailHtml(body: string, opts: EmailShellOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const blocks = body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const content = blocks.map((b, i) => renderBlock(b, i === 0)).join('\n');

  return `<style>
  @media only screen and (max-width:620px){
    .pd-pad{padding:26px 22px !important;}
    .pd-gut{padding:16px 12px !important;}
  }
  @media (prefers-color-scheme: dark){
    .pd-field{background-color:#12130F !important;}
    .pd-paper{background-color:#1A1B16 !important;border-color:#2E3029 !important;}
    .pd-ink{color:#F2F1EA !important;}
    .pd-body{color:#C9C7BC !important;}
    .pd-mute{color:#8E8E84 !important;}
    .pd-rule{border-color:#2E3029 !important;}
  }
</style>
<table role="presentation" class="pd-field" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${C.field};border-collapse:collapse;">
  <tr>
    <td class="pd-gut" align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;border-collapse:collapse;">
        <tr>
          <td class="pd-paper pd-rule pd-pad" style="background-color:${C.paper};border:1px solid ${C.rule};border-radius:10px;padding:38px 40px;">

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
              <tr>
                <td style="font-family:${SERIF};font-size:19px;line-height:24px;letter-spacing:-0.01em;color:${C.ink};" class="pd-ink">${escapeHtml(o.wordmark)}</td>
                <td align="right" style="font-size:0;line-height:0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
                    <td width="26" height="3" style="width:26px;height:3px;background-color:${C.forest};font-size:0;line-height:0;">&nbsp;</td>
                  </tr></table>
                </td>
              </tr>
            </table>

            <div class="pd-rule" style="margin-top:14px;border-top:1px solid ${C.rule};font-size:0;line-height:0;">&nbsp;</div>

            <div style="padding-top:22px;" class="pd-body">
${content}
            </div>

          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px 0;">
            <p class="pd-mute" style="margin:0;font-family:${SANS};font-size:12px;line-height:19px;color:${C.mute};">${inline(o.footerNote)}</p>
            ${o.senderLine ? `<p class="pd-mute" style="margin:6px 0 0;font-family:${SANS};font-size:12px;line-height:19px;color:${C.mute};">${inline(o.senderLine)}</p>` : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * The fragment as a standalone document, for the editor's preview iframe.
 *
 * `color-scheme` is declared here rather than in the fragment so the preview
 * follows the operator's own OS setting and they can see both treatments
 * without leaving the screen.
 */
export function renderEmailDocument(body: string, opts: EmailShellOptions = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="color-scheme" content="light dark" /><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{margin:0;padding:0;}</style></head><body>${renderEmailHtml(body, opts)}</body></html>`;
}
