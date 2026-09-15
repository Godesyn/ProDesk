import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * AI skills — specialised playbooks (prose) the assistant follows, each
 * optionally unlocking a tool. A brand's owner can switch any skill off from the
 * Strategy app's Skills panel; a disabled skill is dropped from the system prompt
 * and its tools are withheld (see chat.ts / brands router).
 *
 * The prose lives in sibling .md files so it can be edited as writing. Like
 * system-prompt.md they only ship in src/ (tsc doesn't copy .md into dist/), so
 * resolve them via the package root — the same depth ('../../../../') from both
 * src/modules/ai/skills and dist/modules/ai/skills.
 */
const here = dirname(fileURLToPath(import.meta.url));
const readSkill = (file: string): string =>
  readFileSync(
    resolve(here, `../../../../src/modules/ai/skills/${file}`),
    'utf8',
  );

export interface AiSkill {
  /** Stable id persisted in brand_notes.disabled_skills — never rename. */
  id: string;
  /** Label shown in the Skills checklist. */
  name: string;
  /** One-line description shown under the label. */
  description: string;
  /** Prose injected into the system prompt while the skill is enabled. */
  prompt: string;
  /** Tool names this skill unlocks (e.g. Anthropic's server-side web_search). */
  tools: string[];
}

/**
 * The catalog. Competitor Research bundles the web-search playbook with the
 * competitor-analysis method and owns the `web_search` tool — searching the web
 * exists to serve that research, so they are one switch (turning it off also
 * takes web search away). Copywriting is prose-only.
 */
export const AI_SKILLS: readonly AiSkill[] = [
  {
    id: 'competitor_research',
    name: 'Competitor Research',
    description:
      'Studies your market and rivals on the live web, then sharpens your positioning, USP and messaging to outsell them. Includes web search.',
    prompt: [
      readSkill('web-search-skill.md'),
      readSkill('competitor-research-skill.md'),
    ]
      .map((s) => s.trim())
      .join('\n\n'),
    tools: ['web_search'],
  },
  {
    id: 'copywriting',
    name: 'Professional Writing',
    description:
      'Crafts publish-ready copy in your authentic brand voice — from landing pages and sales emails to taglines and high-impact campaigns.',
    prompt: readSkill('copywriting-skill.md').trim(),
    tools: [],
  },
  {
    id: 'pr_media_outreach',
    name: 'PR, Media Outreach & Trends',
    description:
      'Capitalises on trending industry news, finds real journalists/podcasters/newsletters, and drafts targeted pitches and press releases. Includes web search.',
    prompt: [
      readSkill('web-search-skill.md'),
      readSkill('pr-media-outreach-skill.md'),
    ]
      .map((s) => s.trim())
      .join('\n\n'),
    tools: ['web_search'],
  },
  {
    id: 'location',
    name: 'Your Location',
    description:
      'Lets the assistant ask to use your browser location — with your permission — to tailor local competitor research, region-specific advice and nearby opportunities to where you are.',
    prompt: readSkill('location-skill.md').trim(),
    tools: ['request_user_location'],
  },
];

/** Metadata safe to send to the client (no prompt bodies). */
export type SkillMeta = Pick<AiSkill, 'id' | 'name' | 'description'> & {
  enabled: boolean;
};

const disabledSet = (
  disabled: readonly string[] | null | undefined,
): Set<string> => new Set(disabled ?? []);

/** True if `id` is a known skill — guards ids before they're persisted. */
export function isSkillId(id: unknown): id is string {
  return typeof id === 'string' && AI_SKILLS.some((s) => s.id === id);
}

/** The catalog with each skill's enabled state for a brand, for the checklist UI. */
export function skillCatalog(
  disabled: readonly string[] | null | undefined,
): SkillMeta[] {
  const off = disabledSet(disabled);
  return AI_SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    enabled: !off.has(s.id),
  }));
}

/** The skills currently switched on for a brand. */
export function enabledSkills(
  disabled: readonly string[] | null | undefined,
): AiSkill[] {
  const off = disabledSet(disabled);
  return AI_SKILLS.filter((s) => !off.has(s.id));
}

/** Concatenated prose of the enabled skills, injected into the system prompt. */
export function skillsPromptBlock(
  disabled: readonly string[] | null | undefined,
): string {
  return enabledSkills(disabled)
    .map((s) => s.prompt)
    .filter(Boolean)
    .join('\n\n');
}

/** Tool names unlocked by the enabled skills (e.g. `web_search`). */
export function enabledSkillTools(
  disabled: readonly string[] | null | undefined,
): Set<string> {
  const tools = new Set<string>();
  for (const s of enabledSkills(disabled))
    for (const t of s.tools) tools.add(t);
  return tools;
}
