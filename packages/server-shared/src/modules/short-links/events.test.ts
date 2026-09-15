import { describe, expect, it } from 'vitest';
import { parseUserAgent, referrerHost } from './events.js';

describe('parseUserAgent', () => {
  it('classifies an iPhone Safari UA as mobile/iOS/Safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({
      device: 'mobile',
      os: 'iOS',
      browser: 'Safari',
    });
  });

  it('classifies Android Chrome phone as mobile/Android/Chrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({
      device: 'mobile',
      os: 'Android',
      browser: 'Chrome',
    });
  });

  it('classifies an iPad as a tablet', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1';
    expect(parseUserAgent(ua).device).toBe('tablet');
  });

  it('classifies desktop Windows Chrome and Edge', () => {
    const win =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
    expect(parseUserAgent(win)).toEqual({
      device: 'desktop',
      os: 'Windows',
      browser: 'Chrome',
    });
    const edge = win + ' Edg/124.0';
    expect(parseUserAgent(edge).browser).toBe('Edge');
  });

  it('returns Unknown/other for an empty UA', () => {
    expect(parseUserAgent(undefined)).toEqual({
      device: 'other',
      os: 'Unknown',
      browser: 'Unknown',
    });
  });
});

describe('referrerHost', () => {
  it('extracts the host and strips www.', () => {
    expect(referrerHost('https://www.instagram.com/p/abc')).toBe('instagram.com');
    expect(referrerHost('https://t.co/x')).toBe('t.co');
  });
  it('returns null for missing or invalid referrers', () => {
    expect(referrerHost(undefined)).toBeNull();
    expect(referrerHost('not a url')).toBeNull();
  });
});
