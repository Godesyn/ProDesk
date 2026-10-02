import { describe, expect, it } from 'vitest';
import { httpUrl, isHttpUrl } from './http-url.js';

describe('httpUrl', () => {
  it('accepts http(s) and rejects script/data schemes and junk', () => {
    expect(isHttpUrl('https://example.com/a?b=1')).toBe(true);
    expect(isHttpUrl('http://localhost:5176/r/x')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'not-a-url', '']) {
      expect(isHttpUrl(bad)).toBe(false);
      expect(httpUrl().safeParse(bad).success).toBe(false);
    }
    expect(httpUrl().safeParse('https://g.page/r/x/review').success).toBe(true);
  });
});
