/**
 * The follow-up wait must survive a page refresh.
 *
 * Smartlead accepts the delay as `seq_delay_details.delay_in_days` and answers
 * with `delayInDays` — the same write/read asymmetry the schedule already has.
 * The editor parsed only the written name, got `undefined`, and fell through to
 * its 5-day default, so a saved 10-day follow-up read back as 5 on every
 * refresh while the campaign really did wait 10. These pin the reader that
 * closes that gap.
 */
import { describe, it, expect } from 'vitest';
import { sequenceStepDelayDays, type SmartleadSequenceStep } from './smartlead.js';

const step = (delay: SmartleadSequenceStep['seq_delay_details']): SmartleadSequenceStep => ({
  id: 1,
  seq_number: 2,
  subject: null,
  email_body: null,
  seq_delay_details: delay,
});

describe('sequenceStepDelayDays', () => {
  it('reads the name Smartlead answers under', () => {
    expect(sequenceStepDelayDays(step({ delayInDays: 10 }))).toBe(10);
  });

  it('reads the name Smartlead accepts', () => {
    expect(sequenceStepDelayDays(step({ delay_in_days: 10 }))).toBe(10);
  });

  it('keeps zero, which is a real answer and not a missing one', () => {
    expect(sequenceStepDelayDays(step({ delay_in_days: 0 }))).toBe(0);
    expect(sequenceStepDelayDays(step({ delayInDays: 0 }))).toBe(0);
  });

  it('returns null — never a default — when the step carries no delay', () => {
    expect(sequenceStepDelayDays(step(null))).toBeNull();
    expect(sequenceStepDelayDays(step({}))).toBeNull();
    expect(sequenceStepDelayDays(step({ delay_in_days: null }))).toBeNull();
  });
});
