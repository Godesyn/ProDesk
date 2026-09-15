/**
 * The reaction set.
 *
 * A hand-written list, not a picker library. Every emoji-picker package is
 * 300KB+ of data and virtualised grid for a feature whose real usage is six
 * reactions people press without looking. The full grid below is 48 glyphs — one
 * screenful, no search, no scroll, no skin-tone menu, no dependency.
 *
 * QUICK is the row that appears inline on hover, ordered by how often people
 * actually reach for them rather than alphabetically or by unicode block.
 *
 * Lives in `shared` rather than in the messenger because the workspace
 * MessagePanel reacts too, and two copies of a list like this diverge the first
 * time somebody adds a glyph to one of them.
 */

export const QUICK: readonly string[] = ['👍', '❤️', '😂', '🎉', '🙏', '👀'];

export const GRID: readonly string[] = [
  ...QUICK,
  '🔥',
  '💯',
  '✅',
  '❌',
  '👏',
  '🤝',
  '😍',
  '😅',
  '😭',
  '😮',
  '🤔',
  '🙄',
  '😴',
  '🤯',
  '🥳',
  '😤',
  '🫡',
  '🤞',
  '💪',
  '🧠',
  '☕',
  '🍕',
  '🚀',
  '⚡',
  '⭐',
  '💡',
  '📌',
  '📎',
  '⏰',
  '💰',
  '📈',
  '📉',
  '🐛',
  '🛠️',
  '🎯',
  '🏁',
  '🤷',
  '🫠',
  '💀',
  '👻',
  '🌈',
  '🌙',
];

export type ReactionSummary = { emoji: string; count: number; mine: boolean; userIds: string[] };

/** Group reactions by emoji with a count and whether I'm in it. */
export function summarise(
  rows: { messageId: string; emoji: string; userId: string }[],
  meId: string | null | undefined,
): Map<string, ReactionSummary[]> {
  const byMessage = new Map<string, Map<string, { count: number; mine: boolean; userIds: string[] }>>();
  for (const r of rows) {
    const forMessage = byMessage.get(r.messageId) ?? new Map();
    const entry = forMessage.get(r.emoji) ?? { count: 0, mine: false, userIds: [] };
    entry.count += 1;
    entry.userIds.push(r.userId);
    if (r.userId === meId) entry.mine = true;
    forMessage.set(r.emoji, entry);
    byMessage.set(r.messageId, forMessage);
  }
  const out = new Map<string, ReactionSummary[]>();
  for (const [messageId, emojis] of byMessage) {
    out.set(
      messageId,
      // Most-used first, so the chip row's leftmost item is the one the eye lands
      // on and the order does not shuffle as counts tie.
      [...emojis.entries()]
        .map(([emoji, v]) => ({ emoji, ...v }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)),
    );
  }
  return out;
}
