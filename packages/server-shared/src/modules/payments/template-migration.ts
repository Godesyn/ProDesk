/**
 * Payments (EziQuotes) — template structure migration / normalisation
 * (export's PHASE2-18, ported 1:1 from server/templateMigration.ts).
 *
 * Templates created before the block-based TemplateStructure shape was introduced
 * may have one of several legacy shapes:
 *
 *   - Empty array:  []
 *   - Legacy object: { sections: [], lineItems: [], introCopy?: string, ... }
 *   - Partial block array: [{ type, data, ... }]  (already canonical)
 *
 * This module provides `normaliseTemplateStructure(raw)` which converts any legacy
 * shape into the canonical `{ blocks: Block[] }` shape without touching the DB.
 * The normalisation is applied at read-time in the `list` and `get` procedures so
 * existing records are transparently upgraded without a destructive migration.
 *
 * When the TemplateBuilder saves a template, it always writes the canonical shape,
 * so over time all records will converge to the new format.
 */

// Minimal block shape — mirrors the client's lib/blocks.ts Block interface
// but kept here as a plain object to avoid importing the client bundle on the server.
// Exported because it surfaces in the templates router's inferred output type.
export interface MinimalBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  styles: Record<string, unknown>;
}

function uuid(): string {
  return crypto.randomUUID();
}

function makeBlock(type: string, data: Record<string, unknown> = {}): MinimalBlock {
  return {
    id: uuid(),
    type,
    data,
    styles: {
      bg: type === 'hero' || type === 'pricing_table' || type === 'accept_pay'
        ? 'oklch(14% 0.01 240)'
        : 'oklch(97% 0.005 240)',
      color: type === 'hero' || type === 'pricing_table' || type === 'accept_pay'
        ? 'oklch(96% 0.005 240)'
        : 'oklch(14% 0.01 240)',
      padding: '80px 0',
    },
  };
}

/**
 * Detect the shape of a raw template structure value.
 */
function detectShape(raw: unknown): 'canonical' | 'legacy-object' | 'empty' {
  if (!raw) return 'empty';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return 'empty';
    // If it's an array of blocks (has type + data), it's canonical
    if (raw[0] && typeof raw[0] === 'object' && 'type' in (raw[0] as object)) return 'canonical';
    return 'empty';
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // Already canonical object shape { blocks: [...] }
    if (Array.isArray(obj.blocks)) return 'canonical';
    // Legacy shape { sections, lineItems, introCopy, ... }
    if ('sections' in obj || 'lineItems' in obj || 'introCopy' in obj) return 'legacy-object';
  }
  return 'empty';
}

/**
 * Convert a legacy template structure into the canonical `{ blocks: Block[] }` shape.
 * Returns the original value unchanged if it's already canonical.
 */
export function normaliseTemplateStructure(raw: unknown, templateName = 'Template'): { blocks: MinimalBlock[] } {
  const shape = detectShape(raw);

  if (shape === 'canonical') {
    // Already canonical — ensure it's wrapped in { blocks: [...] }
    if (Array.isArray(raw)) {
      return { blocks: raw as MinimalBlock[] };
    }
    return raw as { blocks: MinimalBlock[] };
  }

  if (shape === 'legacy-object') {
    const obj = raw as Record<string, unknown>;
    const blocks: MinimalBlock[] = [];

    // Hero block — populate from legacy fields
    const heroData: Record<string, unknown> = {
      eyebrow: 'Proposal',
      headline: templateName,
      headlineBottom: 'engagement.',
      subheadline: typeof obj.introCopy === 'string' ? obj.introCopy.slice(0, 120) : '',
      introCopy: typeof obj.introCopy === 'string' ? obj.introCopy : '',
      nextStepsCopy: typeof obj.nextStepsCopy === 'string' ? obj.nextStepsCopy : '',
      metaItems: [
        { label: 'Prepared by', value: 'Your Business' },
        { label: 'Client', value: 'Client Name' },
        { label: 'Proposal', value: templateName },
        { label: 'Valid until', value: '30 days' },
      ],
    };
    blocks.push(makeBlock('hero', heroData));

    // Value panels
    blocks.push(makeBlock('value_panels', {}));

    // Pricing table — carry over any legacy lineItems
    const legacyItems = Array.isArray(obj.lineItems) ? obj.lineItems : [];
    blocks.push(makeBlock('pricing_table', {
      eyebrow: 'Investment',
      headline: "What's included",
      lede: '',
      lineItems: legacyItems,
      currency: 'AUD',
      paymentModel: 'one-off',
      taxRate: 10,
      showTax: true,
    }));

    // Team cards
    blocks.push(makeBlock('team_cards', {}));

    // Roadmap
    blocks.push(makeBlock('roadmap', {}));

    // Accept + pay
    blocks.push(makeBlock('accept_pay', {}));

    return { blocks };
  }

  // Empty — return canonical default structure
  const blocks: MinimalBlock[] = [
    makeBlock('hero', {
      eyebrow: 'Proposal',
      headline: templateName,
      headlineBottom: 'engagement.',
      subheadline: '',
      introCopy: '',
      nextStepsCopy: '',
      metaItems: [
        { label: 'Prepared by', value: 'Your Business' },
        { label: 'Client', value: 'Client Name' },
        { label: 'Proposal', value: templateName },
        { label: 'Valid until', value: '30 days' },
      ],
    }),
    makeBlock('value_panels', {}),
    makeBlock('pricing_table', {
      eyebrow: 'Investment',
      headline: "What's included",
      lede: '',
      lineItems: [],
      currency: 'AUD',
      paymentModel: 'one-off',
      taxRate: 10,
      showTax: true,
    }),
    makeBlock('team_cards', {}),
    makeBlock('roadmap', {}),
    makeBlock('accept_pay', {}),
  ];
  return { blocks };
}
