/**
 * Integration prompt.
 *
 * Produces a copy-pasteable LLM prompt that documents Prodesk's public service
 * API so an agency can embed a service/package buy-flow into an external site.
 * Surfaced from the service / package detail dialogs (catalog) via the "copy
 * integration prompt" button.
 *
 * Faithful port of the legacy Flutter `prompt_utils.dart` / Firebase
 * `publicService` function contract: a public, keyless GET that fetches a
 * service OR package by id and returns the transformed `Service<Either>` shape
 * (single vs. multiple billing cycle). The only modernisation is the host: the
 * legacy Firebase `{env}-publicService` function name is replaced with an
 * env-resolved base host (the env used to be a function-name prefix; it now
 * lives in the domain).
 */

import { PRODESK_ORIGINS } from '../../lib/origins';

/**
 * Public Prodesk host for the running build's environment, resolved from
 * `VITE_APP_PRODESK_ORIGIN` (a bare host per env, baked in at build time):
 *   production  → app.prodesk.com
 *   staging     → stage-app.prodesk.com
 *   development → dev-app.prodesk.com
 */
const BASE_HOST = PRODESK_ORIGINS.app;

// Built as an array of literal lines (joined with newlines) so the markdown
// can contain backticks and `${...}` freely without escaping. Placeholders
// ({id}, {agencyId}, {userId}, {base}) are substituted in getIntegrationPrompt.
const INTEGRATION_PROMPT = [
  '# Parameters',
  '',
  "The UI to be implemented will have these parameters. Refer to the documentation below on how to use these Ids, service's id, agency's id and user's id.",
  '',
  'id: {id}',
  'agencyId: {agencyId}',
  'userId: {userId}',
  '',
  '# Documentation on integration with Prodesk',
  '',
  'This is the documentation for the external api that you will be using in order to access services or packages and integrate them into Websites. `Prodesk` exposes public `GET` api to fetch services or packages by id.',
  '',
  '## GET ITEM BY ID',
  '',
  '```http',
  'GET https://{base}/publicService?id={id}&agencyId={agencyId}&userId={userId}',
  '```',
  '',
  '### Interface of Response Data',
  '',
  '```typescript',
  'type Service<Either extends boolean> = {',
  '  id: string;',
  '  name: string;',
  '  description: string;',
  '  benefits?: string[];',
  '  disciplines?: string[];',
  '  options?: {',
  '    name: string;',
  '    choices: string[];',
  '  }[];',
  '  variants?: ({',
  '    id: string;',
  '    options: Record<string, string>;',
  '  } & (Either extends true',
  '    ? { difference: number }',
  '    : { upfrontDifference: number; weeklyDifference: number }))[];',
  '  addons?: {',
  '    id: string;',
  '    name: string;',
  '  } & (Either extends true',
  '    ? { difference: number }',
  '    : { upfrontDifference: number; weeklyDifference: number })[];',
  '  pricing: Either extends true',
  '    ? {',
  '        oneOff: {',
  '          price: number;',
  '          deliveryFee: number | undefined;',
  '        };',
  '      }',
  '    : {',
  '        recurring: {',
  '          upfront: {',
  '            upfrontFee: number | undefined;',
  '            upfrontDeliveryFee: number | undefined;',
  '          };',
  '          weeklyAfter: {',
  '            recurringFee: number | undefined;',
  '            recurringDeliveryFee: number | undefined;',
  '          };',
  '        };',
  '      };',
  '  buyButton: {',
  '    url: string;',
  '  };',
  '} & (',
  '  | {',
  '      imageUrl: string;',
  '    }',
  '  | {',
  '      videoUrl: string;',
  '    }',
  '  | { imageUrl: string; videoUrl: string }',
  ');',
  '```',
  '',
  '### UI Guidelines',
  '',
  'Service is either has one billing cycle or multiple cycle depending on this fields like `variants`, `pricing`, `options` and `addons` might have two pricing objects or only one. Basically displaying the pricing will be something like',
  '',
  '- in case of multiple billing cycle:',
  '  $100 upfront + $10 weekly',
  '',
  '- in case of single billing cycle:',
  '  $100',
  '',
  '#### videoUrl',
  '',
  'This can either be a youtube link or object link. You can detect if it is youtube link by comparing against these regex',
  '',
  '1. `youtube\\.com\\/watch\\?v=([a-zA-Z0-9_-]+)`',
  '2. `youtube\\.com\\/embed\\/([a-zA-Z0-9_-]+)`',
  '3. `youtube\\.com\\/shorts\\/([a-zA-Z0-9_-]+)`',
  '4. `youtu\\.be\\/([a-zA-Z0-9_-]+)`',
  '5. `youtube\\.com\\/v\\/([a-zA-Z0-9_-]+)`',
  '',
  'get videoId from here and `https://img.youtube.com/vi/$videoId/mqdefault.jpg` in order to get the thumbnail of the youtube type video',
  '',
  'For the object urls find the last dot in order to get replace the extension with `_thumbnail.jpg`. This will be the thumbnail for the object type video',
  '',
  '#### imageUrl',
  '',
  '`imageUrl` field if exists will act as the thumbnail for the `videoUrl` field if `videoUrl` field exists. The initial media will be the `imageUrl` with a play button which when pressed will play the `videoUrl`. In absence of the `videoUrl` field the `imageUrl` will be the preview image with absence of the play button.',
  '',
  '#### variants, addons, options',
  '',
  'The user should be has to choose each of the `options` as mandatory but can choose multiple `addons` or none, these choices make changes to the pricing. How much the chosen set of `options` make change to pricing will be mentioned by `variants` field while each `addons` will have their difference in the object itself.',
  '',
  '#### buyButton.url',
  '',
  'This url will be the url to which user will be redirected when he clicks the buy button. This will redirect the user to the prodesk app where they can buy the product.',
  'In url add the addons ids and variant id as well add on ids should be seperated by comma (,) like this',
  '',
  '```typescript',
  '((buyButtonUrl: string, selectedAddOnIds: string[], variantId?: string) => {',
  '  let buyUrl = `${buyButtonUrl}`;',
  '  if (variantId) buyUrl += `&variantId=${variantId}`;',
  '  if (selectedAddOnIds.length)',
  "    buyUrl += `&addonIds=${selectedAddOnIds.join(',')}`;",
  '  return buyUrl;',
  '})(buyButton.url, selectedAddOnIds, variantId);',
  '```',
  '',
].join('\n');

/** Build the integration prompt for a service/package (legacy `getIntegrationPrompt`). */
export function getIntegrationPrompt(
  id: string,
  userId: string,
  agencyId: string,
  opts: { isPackage?: boolean } = {},
): string {
  return INTEGRATION_PROMPT.replaceAll('{id}', id)
    .replaceAll('{agencyId}', agencyId)
    .replaceAll('{userId}', userId)
    .replaceAll('{type}', opts.isPackage ? 'package' : 'service')
    // Same fallback convention as origins.ts originUrl(): the current host
    // covers a missing env var (previously this silently printed "undefined").
    .replaceAll('{base}', BASE_HOST ?? window.location.host);
}
