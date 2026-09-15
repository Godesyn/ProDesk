/**
 * Back-compat shim. The AI provider layer now lives in `providers/` — the SDK
 * client, model ids, and family selection are all defined there (one file per
 * provider, catalogued in providers/registry.ts). This module only re-exports
 * `isAiEnabled` (now "at least one provider family is configured") so existing
 * import sites keep working; new code should import from providers/registry or
 * provider-config directly.
 */
export { isAiEnabled } from './providers/registry.js';
