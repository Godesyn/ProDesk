import { describe, it, expect } from 'vitest';
import { tenantFromHost } from './context.js';

describe('tenantFromHost', () => {
  it('extracts a tenant subdomain', () => {
    expect(tenantFromHost('acme.app.prodesk.com')).toBe('acme');
    expect(tenantFromHost('acme.app.prodesk.com:443')).toBe('acme');
  });
  it('ignores reserved subdomains, IPs and missing hosts', () => {
    expect(tenantFromHost('app.prodesk.com')).toBeNull();
    expect(tenantFromHost('www.prodesk.com')).toBeNull();
    expect(tenantFromHost('127.0.0.1:4000')).toBeNull();
    expect(tenantFromHost(undefined)).toBeNull();
  });
});
