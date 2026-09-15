/**
 * The viewport point a popover should float beside: the trigger's top-centre.
 *
 * Exists because both chat surfaces had the same defect — the full reaction grid
 * opened as a CENTRED MODAL behind a dark scrim, so picking a 👍 dimmed and
 * covered the whole conversation, including the message being reacted to. The
 * fix in both is to float the grid next to the control that opened it, which
 * means the control has to hand over where it is. Three lines, in one place, so
 * the two surfaces cannot drift on what "beside" means.
 */
export function anchorOf(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top };
}

/**
 * Place a measured popover against an anchor, clamped inside the viewport.
 *
 * Above the anchor by preference — that is where the message is NOT — falling
 * below only when there is no room. Measuring first and placing second is what
 * stops a popover hanging off the bottom of the screen for whoever's message
 * happens to be near the fold.
 */
export function placeBeside(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const left = Math.min(
    Math.max(anchor.x - size.width / 2, margin),
    window.innerWidth - size.width - margin,
  );
  const above = anchor.y - size.height - margin;
  const top =
    above >= margin ? above : Math.min(anchor.y + 28, window.innerHeight - size.height - margin);
  return { left, top };
}
