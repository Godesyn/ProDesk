/**
 * The promise this module exists to keep: nobody receives a sentence with a
 * hole in it.
 *
 * The bug these tests pin was invisible from the one screen built to catch it.
 * `{{first_name}}` was offered in the tag picker and never uploaded on the lead,
 * so every recipient of "Hi {{first_name}}," got "Hi ,", while the preview
 * quietly faked a name out of the first word of the business name and showed
 * "Hi Sydney,". Two implementations of the same substitution, disagreeing, with
 * only the wrong one visible.
 *
 * So the test that matters is not "does the fallback work" — it is "does a
 * prospect we know NOTHING about still produce a readable letter", asked
 * against the single function both sides now call.
 */
import { describe, it, expect } from 'vitest';
import {
  MERGE_TAGS,
  NUMERIC_TAGS,
  findBlankableTags,
  findUnknownTags,
  renderTemplate,
  resolveMergeValues,
} from './merge-tags.js';

/** The worst case the pipeline can produce: §11 keeps contacts like this. */
const NOTHING = {
  businessName: null,
  website: null,
  address: null,
  hook: null,
  detail: null,
  reviewsCount: null,
  rating: null,
};

describe('resolveMergeValues', () => {
  it('leaves no text tag empty for a prospect we know nothing about', () => {
    const v = resolveMergeValues(NOTHING);
    for (const t of MERGE_TAGS) {
      if (NUMERIC_TAGS.includes(t.key)) continue;
      expect(v[t.key], `${t.tag} resolved to an empty string`).not.toBe('');
    }
  });

  it('renders a whole template with nothing to render it from', () => {
    const body = 'Hi {{first_name}}, I had a look at {{website}} — {{hook}}. {{detail}} in {{location}}.';
    const out = renderTemplate(body, resolveMergeValues(NOTHING));
    // The real assertion is the absence of a hole: no double space, no stray
    // punctuation pair, nothing left unsubstituted.
    expect(out).not.toContain('{{');
    expect(out).not.toMatch(/\s{2}/);
    expect(out).toBe(
      'Hi there, I had a look at your website — how your Google reviews are tracking. ' +
        'the work you do in your area.',
    );
  });

  it('never invents a person, because the scrape never finds one', () => {
    // Google Maps returns businesses. A first name resolved from the business
    // name is how "Hi Sydney," happened.
    expect(resolveMergeValues({ businessName: 'Sydney Smiles Dental' }).first_name).toBe('there');
  });

  it('prefers what is known over the fallback', () => {
    const v = resolveMergeValues({
      businessName: 'Sydney Smiles Dental',
      website: 'https://sydneysmiles.com.au',
      address: 'Newtown NSW',
      reviewsCount: 11,
      rating: 4.2,
    });
    expect(v.company_name).toBe('Sydney Smiles Dental');
    expect(v.location).toBe('Newtown NSW');
    expect(v.reviews).toBe('11');
    expect(v.rating).toBe('4.2');
  });

  it('treats whitespace as nothing, because a scrape can return it', () => {
    expect(resolveMergeValues({ businessName: '   ' }).company_name).toBe('your business');
  });

  it('reads the rating back from the numeric column as well as the scrape', () => {
    // Stored as `numeric(3,2)`, which postgres.js hands back as a string.
    expect(resolveMergeValues({ rating: '4.20' }).rating).toBe('4.2');
    expect(resolveMergeValues({ rating: 4.2 }).rating).toBe('4.2');
  });

  it('leaves the two numeric tags blank rather than inventing a figure', () => {
    // There is no number we can substitute for a business we just failed to
    // measure that isn't a claim about them. Blank, and the editor warns.
    const v = resolveMergeValues(NOTHING);
    expect(v.reviews).toBe('');
    expect(v.rating).toBe('');
  });
});

describe('findUnknownTags', () => {
  it('catches the typo that used to mail a literal {{...}} to strangers', () => {
    expect(findUnknownTags('Hi {{first_name}}, about {{buisness_name}}')).toEqual([
      '{{buisness_name}}',
    ]);
  });

  it('passes a body that only uses real tags', () => {
    expect(findUnknownTags('{{hook}} — {{detail}} at {{company_name}}')).toEqual([]);
  });

  it('reports each unknown tag once, however often it appears', () => {
    expect(findUnknownTags('{{nope}} {{nope}} {{nope}}')).toEqual(['{{nope}}']);
  });

  it('tolerates the spacing people actually type', () => {
    expect(findUnknownTags('{{ hook }}')).toEqual([]);
  });
});

describe('findBlankableTags', () => {
  it('warns on the two tags that can still arrive empty', () => {
    expect(findBlankableTags('you are on {{reviews}} reviews at {{rating}} stars')).toEqual([
      '{{reviews}}',
      '{{rating}}',
    ]);
  });

  it('stays quiet for a template that uses the composed opener instead', () => {
    expect(findBlankableTags('{{hook}} — worth a look?')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('leaves an unknown tag visible rather than blanking it', () => {
    // A sequence saved before the check existed still opens, and the preview
    // shows the problem instead of swallowing it.
    expect(renderTemplate('Hi {{nope}}', resolveMergeValues(NOTHING))).toBe('Hi {{nope}}');
  });
});
