/**
 * A short, self-contained "new message" chime, synthesized with the Web Audio
 * API so there's no audio asset to bundle or fetch (CSP-friendly). Plays a soft
 * two-note ascending ding. Safe to call from anywhere — failures (autoplay
 * blocked before the first user gesture, Web Audio unavailable) are swallowed so
 * a missing sound never breaks the surrounding UI.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

/** Play the default new-message notification sound. */
export function playMessageSound(): void {
  try {
    const audio = getContext();
    if (!audio) return;
    // Browsers suspend the context until a user gesture; resume opportunistically
    // (a no-op once the user has interacted with the app).
    if (audio.state === 'suspended') void audio.resume();

    const now = audio.currentTime;
    // Two quick ascending sine notes for a gentle "ding".
    const notes = [
      { freq: 660, start: 0, dur: 0.13 },
      { freq: 880, start: 0.1, dur: 0.17 },
    ];
    for (const n of notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // Fast attack then exponential decay — keeps it soft and avoids clicks.
      // (exponential ramps can't target 0, so we ramp to a tiny floor.)
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.16, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  } catch {
    // Autoplay blocked or Web Audio unavailable — ignore.
  }
}
