/**
 * Wise recipient resolution — shared, framework-agnostic core.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CANONICAL COPY. An identical copy is kept at:
 *   - functions/src/modules/billing/wise-recipient.ts
 *   - prodesk-web/server/src/modules/billing/wise-recipient.ts
 * The two packages can't share an import (separate npm projects / module
 * systems), so keep these byte-identical. Only the import *path* at the call
 * sites differs (`.js` extension in prodesk-web's ESM, omitted in functions).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 * Recipient creation used to *guess* the payout currency from a hardcoded,
 * partly-wrong country→currency map and then *hardcode* the Wise account `type`
 * and `details` field layout. Wise strictly validates the currency↔type↔details
 * triple, so the guesses produced constant errors:
 *   - CH/DK/NO/SE/PL/CZ/HU/RO/BG/IS/AL were all mapped to EUR, but they use
 *     CHF/DKK/NOK/SEK/PLN/CZK/HUF/RON/BGN/ISK/ALL — Wise rejects an EUR recipient
 *     on a non-EUR account.
 *   - every unmapped country (IN, JP, AE, HK, …) silently became AUD.
 *   - AUD used type `sort_code`/`sortCode`, but Wise wants `australian`/`bsb`.
 *   - the generic international path used type `swift`, but Wise wants `swift_code`.
 *
 * THE REDESIGN
 * Stop guessing the *shape*. We resolve only the target currency
 * (deterministically — never silently defaulting to AUD), then ask Wise's
 * account-requirements API which `type` and which fields it actually needs for
 * that currency, and map our collected inputs into them. This self-heals when
 * Wise changes its requirements and supports every currency Wise supports.
 *
 * The source currency is always AUD (the balance we hold) — we keep FX to the
 * bare minimum and let Wise quote AUD→target.
 */

export interface WiseConfig {
  /** e.g. https://api.wise.com or https://api.sandbox.transferwise.tech */
  baseUrl: string;
  /** Wise API token (Bearer). */
  token: string;
  /** Wise profile id that owns the recipients. */
  profileId: string;
  /** Currency of the balance we fund payouts from. We hold AUD. */
  sourceCurrency?: string;
  /** Optional structured-logger hook for non-fatal warnings. */
  onWarn?: (message: string, err?: unknown) => void;
}

export interface WireBankDetails {
  accountHolderName: string;
  currency?: string | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
  swiftCode?: string | null;
  bankName?: string | null;
  country?: string | null;
  accountType?: string | null;
  address?: {
    firstLine?: string | null;
    city?: string | null;
    state?: string | null;
    postCode?: string | null;
    country?: string | null;
  } | null;
}

export interface ResolvedWiseRecipient {
  recipientId: string;
  currency: string;
  type: string;
}

/** Thrown when the target payout currency can't be confidently determined. */
export class WiseCurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiseCurrencyError';
  }
}

/**
 * ISO-3166 country → ISO-4217 currency. Used only as a *signal* for the target
 * currency when it isn't given explicitly. Correctness matters: a wrong entry
 * here makes Wise reject the recipient. Eurozone members map to EUR; everything
 * else maps to its own currency. Unknown countries are intentionally absent so
 * we error loudly instead of defaulting to AUD.
 */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  // Eurozone (+ EUR-using microstates / adopters)
  AD: 'EUR', AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR',
  FI: 'EUR', FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR',
  LU: 'EUR', LV: 'EUR', MC: 'EUR', ME: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR',
  SI: 'EUR', SK: 'EUR', SM: 'EUR', VA: 'EUR', XK: 'EUR',
  // Rest of Europe (own currencies — these were the worst offenders before)
  AL: 'ALL', BA: 'BAM', BG: 'BGN', BY: 'BYN', CH: 'CHF', CZ: 'CZK', DK: 'DKK',
  GB: 'GBP', GE: 'GEL', HU: 'HUF', IS: 'ISK', MD: 'MDL', MK: 'MKD', NO: 'NOK',
  PL: 'PLN', RO: 'RON', RS: 'RSD', RU: 'RUB', SE: 'SEK', TR: 'TRY', UA: 'UAH',
  AM: 'AMD', AZ: 'AZN',
  // Americas
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP',
  PE: 'PEN', UY: 'UYU',
  // Asia–Pacific
  AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', JP: 'JPY', CN: 'CNY', IN: 'INR',
  ID: 'IDR', MY: 'MYR', TH: 'THB', PH: 'PHP', VN: 'VND', KR: 'KRW', TW: 'TWD',
  PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  // Middle East & Africa
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', IL: 'ILS',
  JO: 'JOD', ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', EG: 'EGP', MA: 'MAD',
  TZ: 'TZS', UG: 'UGX',
};

function normUpper(v?: string | null): string {
  return (v || '').trim().toUpperCase();
}

/** The 2-letter country prefix of an IBAN, or null if `acc` isn't IBAN-shaped. */
function ibanCountry(acc: string): string | null {
  const m = /^([A-Z]{2})\d{2}[A-Z0-9]{10,30}$/i.exec(acc);
  return m ? m[1].toUpperCase() : null;
}

/** The country embedded in a SWIFT/BIC (chars 5–6), or null. */
function swiftCountry(swift: string): string | null {
  const s = swift.replace(/\s/g, '').toUpperCase();
  return s.length >= 6 ? s.slice(4, 6) : null;
}

/**
 * Resolve the *target* (recipient) currency from the strongest available signal,
 * in priority order. Never defaults — throws WiseCurrencyError if it can't tell,
 * so a payout fails loudly with a clear message instead of being silently
 * mis-sent as AUD.
 */
export function resolveTargetCurrency(d: WireBankDetails): string {
  const explicit = normUpper(d.currency);

  // 1. A genuine, non-default currency is authoritative — e.g. the account's own
  //    currency reported by Wise OAuth import. AUD is our *platform default*
  //    (callers send it as a sentinel, not as the recipient's real currency), so
  //    it's treated as a weak hint and only used if nothing better is found.
  if (/^[A-Z]{3}$/.test(explicit) && explicit !== 'AUD') return explicit;

  const accNum = (d.accountNumber || '').replace(/[\s-]/g, '');

  // 2. An IBAN encodes its own country — the most reliable structural signal.
  const fromIban = ibanCountry(accNum);
  if (fromIban && CURRENCY_BY_COUNTRY[fromIban]) return CURRENCY_BY_COUNTRY[fromIban];

  // 3. The selected bank country.
  const country = normUpper(d.country);
  if (country && CURRENCY_BY_COUNTRY[country]) return CURRENCY_BY_COUNTRY[country];

  // 4. The country embedded in the SWIFT/BIC, as a last resort.
  const fromSwift = d.swiftCode ? swiftCountry(d.swiftCode) : null;
  if (fromSwift && CURRENCY_BY_COUNTRY[fromSwift]) return CURRENCY_BY_COUNTRY[fromSwift];

  // 5. Nothing pointed elsewhere. Honor an explicit AUD; otherwise fail loudly
  //    rather than silently mis-sending a foreign payout as AUD.
  if (explicit === 'AUD') return 'AUD';
  throw new WiseCurrencyError(
    `Could not determine the payout currency from these bank details ` +
      `(country=${d.country || '?'}, account ending ${accNum ? accNum.slice(-4) : '?'}). ` +
      `Please specify the account currency.`,
  );
}

/** Parse a Wise response, turning non-2xx bodies into a readable Error. */
async function parseWiseResponse(
  res: any,
  onWarn?: (m: string, e?: unknown) => void,
): Promise<any> {
  const text = await res.text();
  let data: any = null;
  try {
    if (text) data = JSON.parse(text);
  } catch (e) {
    onWarn?.(`Wise returned a non-JSON body (status ${res.status})`, e);
  }
  if (!res.ok) {
    if (data) {
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        throw new Error(
          data.errors
            .map((e: any) => {
              const field = e.path ? String(e.path).replace('details.', '') : '';
              return field ? `${field}: ${e.message}` : e.message;
            })
            .join(', '),
        );
      }
      if (data.message) throw new Error(data.message);
      throw new Error(JSON.stringify(data));
    }
    throw new Error(text || `Wise request failed with status ${res.status}`);
  }
  return data;
}

/**
 * Ask Wise which recipient `type`s and fields it requires for a given target
 * currency. Uses the quote-independent endpoint so it works during validation
 * (before any transfer amount is known). Source defaults to AUD — the balance
 * we hold — which keeps the FX leg minimal.
 */
async function fetchAccountRequirements(
  cfg: WiseConfig,
  currency: string,
): Promise<any[]> {
  const source = normUpper(cfg.sourceCurrency) || 'AUD';
  const url =
    `${cfg.baseUrl}/v1/account-requirements` +
    `?source=${source}&target=${currency}&sourceAmount=1000`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
      // Opt into the dynamic-form (v1.1) requirements shape.
      'Accept-Minor-Version': '1',
    },
  });
  const data = await parseWiseResponse(res, cfg.onWarn);
  return Array.isArray(data) ? data : [];
}

/**
 * Re-ask Wise for requirements after echoing back the values we have so far.
 * Wise hides *dependent* fields until the field they hang off is supplied —
 * the classic case is a US recipient, where `address.state` (with its
 * `valuesAllowed` list) only appears once `address.country: "US"` is posted
 * back. Wise signals this with `refreshRequirementsOnChange: true` on the
 * trigger field, and the docs say to keep POSTing the partial `details` until
 * no new fields appear. Same URL/params as the GET, but POST with the partial
 * account body.
 */
async function refreshAccountRequirements(
  cfg: WiseConfig,
  currency: string,
  type: string,
  details: Record<string, any>,
): Promise<any[]> {
  const source = normUpper(cfg.sourceCurrency) || 'AUD';
  const url =
    `${cfg.baseUrl}/v1/account-requirements` +
    `?source=${source}&target=${currency}&sourceAmount=1000`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
      'Accept-Minor-Version': '1',
    },
    body: JSON.stringify({ type, details }),
  });
  const data = await parseWiseResponse(res, cfg.onWarn);
  return Array.isArray(data) ? data : [];
}

/** True if any field asks Wise to re-evaluate requirements when it changes. */
function requirementsNeedRefresh(requirements: any[]): boolean {
  return requirements.some((r) =>
    (Array.isArray(r.fields) ? r.fields : []).some((f: any) =>
      (Array.isArray(f.group) ? f.group : []).some(
        (g: any) => g && g.refreshRequirementsOnChange,
      ),
    ),
  );
}

/** A stable signature of every field key a requirement asks for, to detect growth. */
function fieldKeySignature(requirement: any): string {
  const keys: string[] = [];
  for (const f of Array.isArray(requirement.fields) ? requirement.fields : []) {
    for (const g of Array.isArray(f.group) ? f.group : []) {
      if (g && g.key) keys.push(String(g.key));
    }
  }
  return keys.sort().join('|');
}

/**
 * Build a case-insensitive dictionary of every Wise field key we *might* be
 * asked for, mapped from our normalized inputs. Keys are stored lowercased;
 * nested address keys use their full dotted path (e.g. `address.firstline`).
 */
function buildCandidates(d: WireBankDetails): Record<string, string> {
  const accNum = (d.accountNumber || '').replace(/[\s-]/g, '');
  const isIban = !!ibanCountry(accNum);
  const swift = (d.swiftCode || '').replace(/[\s-]/g, '').toUpperCase();
  const routing = (d.routingNumber || '').replace(/[\s-]/g, '');
  const country = normUpper(d.country);

  const c: Record<string, string> = {};
  const set = (key: string, val?: string | null) => {
    if (val) c[key.toLowerCase()] = val;
  };

  set('legalType', 'PRIVATE');
  set('accountHolderName', d.accountHolderName);
  // The account number fills whichever key the currency's type asks for. An
  // IBAN is also a valid `accountNumber` — some IBAN currencies (e.g. ALL)
  // expose only a `swift_code` type keyed on `accountNumber`, not `IBAN` — so
  // set both and let the chosen type pick the one it needs.
  set('accountNumber', accNum);
  if (isIban) set('IBAN', accNum);
  set('bic', swift);
  set('swiftCode', swift);

  // The same routing value lands under whichever key the currency uses
  // (Wise only asks for one of these per type).
  set('sortCode', routing); // GBP
  set('bsbCode', routing); // AUD — Wise's `australian` type keys this as `bsbCode`
  set('bsb', routing); // AUD alias, harmless if unused by the chosen type
  set('abartn', routing); // USD ABA
  set('bankCode', routing); // SGD and others
  set('ifscCode', routing); // INR — Wise's `indian` type keys the IFSC here
  set('routingNumber', routing);

  // Canada splits a 9-digit routing into institution + transit numbers.
  if (routing && country === 'CA') {
    if (routing.length === 9 && routing.startsWith('0')) {
      set('institutionNumber', routing.slice(1, 4));
      set('transitNumber', routing.slice(4, 9));
    } else {
      set('transitNumber', routing.slice(0, 5));
      set('institutionNumber', routing.slice(5, 8));
    }
  }

  if (d.accountType) set('accountType', d.accountType.toUpperCase());

  const a = d.address;
  if (a) {
    set('address.firstLine', a.firstLine);
    set('address.city', a.city);
    set('address.state', a.state);
    set('address.postCode', a.postCode);
    set('address.country', normUpper(a.country) || country);
  } else if (country) {
    // Some types ask for a bare country at the top level.
    set('country', country);
  }

  return c;
}

/** Assign `value` into `details`, supporting dotted (nested) keys like `address.city`. */
function assignDetail(details: Record<string, any>, key: string, value: string): void {
  const dot = key.indexOf('.');
  if (dot === -1) {
    details[key] = value;
    return;
  }
  const head = key.slice(0, dot);
  const tail = key.slice(dot + 1);
  if (typeof details[head] !== 'object' || details[head] === null) details[head] = {};
  assignDetail(details[head], tail, value);
}

/**
 * Fill a single requirement `type`'s fields from our candidate values. Returns
 * the built `details` object plus the list of required fields we couldn't fill.
 */
function fillRequirement(
  requirement: any,
  candidates: Record<string, string>,
): { details: Record<string, any>; missing: string[] } {
  const details: Record<string, any> = {};
  const missing: string[] = [];
  const fields = Array.isArray(requirement.fields) ? requirement.fields : [];

  for (const field of fields) {
    const groups = Array.isArray(field.group) ? field.group : [];
    let filled = false;
    let required = false;

    for (const g of groups) {
      if (g && g.required) required = true;
      const key: string | undefined = g && g.key;
      if (filled || !key) continue;
      const candidate = candidates[key.toLowerCase()];
      if (candidate == null || candidate === '') continue;

      let value = candidate;
      // Normalize against an allowed-value list when present (e.g. accountType,
      // legalType, country, US/CA state). Wise validates these against the
      // entry *key* (e.g. "CA"), but users naturally type the display *name*
      // ("California") — so match on either, case-insensitively, and send the
      // canonical key. This is why a filled-in state could still fail with
      // "address.state: Please enter a state": Wise treats an unrecognised value
      // as empty. If nothing matches we still send the raw value and let Wise
      // validate, rather than blocking on a stale local list.
      if (Array.isArray(g.valuesAllowed) && g.valuesAllowed.length > 0) {
        const want = value.trim().toUpperCase();
        const match =
          g.valuesAllowed.find((v: any) => String(v.key).toUpperCase() === want) ||
          g.valuesAllowed.find(
            (v: any) => String(v.name ?? '').toUpperCase() === want,
          );
        if (match) value = String(match.key);
      }
      assignDetail(details, key, value);
      filled = true;
    }

    if (!filled && required) {
      missing.push(field.name || (groups[0] && groups[0].key) || 'unknown');
    }
  }

  return { details, missing };
}

/**
 * Choose the recipient `type` to use. Prefers types we can fully satisfy, then
 * leans toward the structurally-correct one for the data we have (IBAN → an
 * IBAN type; otherwise a SWIFT type when a BIC is present).
 *
 * `domestic` means the recipient bank sits in the home country of the payout
 * currency (e.g. a USD account at a US bank). Wise forbids SWIFT-type recipients
 * for domestic transfers — "you can't send USD via Swift to accounts inside the
 * United States". So when the payout is domestic and a local (non-SWIFT) type
 * exists for the currency, we drop the SWIFT types from consideration entirely:
 * the correct local type (e.g. `aba`) is chosen, and if it's missing a required
 * field (routing number, address state) the caller gets a clear missing-field
 * error instead of an opaque SWIFT rejection from Wise.
 */

/**
 * Non-bank "alternative payout" rails Wise offers alongside the real bank types
 * (email/Interac e-Transfer, UPI / mobile-money wallets). This is a *bank wire*
 * feature, so these must never be selected: they key the payout on an email
 * address or a wallet/VPA id, would happily accept a typed bank account number
 * as that id and silently mis-route, and — because they ask for very few fields
 * — would otherwise win the "fewest missing fields" race over the genuine bank
 * rail. Dropping them means an incomplete bank input fails with a clear
 * missing-field error instead of being routed to email/UPI. None of Wise's bank
 * type names contain these substrings (e.g. `indian`/`canadian` don't match).
 */
function isBankRail(type: string): boolean {
  return !/email|interac|upi|mobile|wallet|alipay|paym/i.test(type);
}

function selectRecipientType(
  requirements: any[],
  candidates: Record<string, string>,
  isIban: boolean,
  hasSwift: boolean,
  domestic: boolean,
): { type: string; details: Record<string, any>; missing: string[]; requirement: any } {
  const scored = requirements.map((r) => {
    const { details, missing } = fillRequirement(r, candidates);
    const t = String(r.type || '').toLowerCase();
    let pref = 0;
    if (isIban && t.includes('iban')) pref += 3;
    if (hasSwift && t.includes('swift')) pref += 2;
    return { type: r.type as string, details, missing, pref, requirement: r };
  });

  // Restrict to genuine bank rails. Fall back to the full set only if a currency
  // somehow offers nothing else — then the create POST fails loudly rather than
  // here, which is still preferable to silently picking a non-bank rail.
  const bankScored = scored.filter((s) => isBankRail(String(s.type || '')));
  let candidatesPool = bankScored.length > 0 ? bankScored : scored;

  // For domestic payouts, exclude SWIFT types as long as a local rail exists for
  // the currency — Wise rejects SWIFT recipients sent to a domestic account.
  if (domestic) {
    const local = candidatesPool.filter(
      (s) => !String(s.type || '').toLowerCase().includes('swift'),
    );
    if (local.length > 0) candidatesPool = local;
  }

  const viable = candidatesPool.filter((s) => s.missing.length === 0);
  const pool = viable.length > 0 ? viable : candidatesPool;
  pool.sort((a, b) => a.missing.length - b.missing.length || b.pref - a.pref);

  const best = pool[0];
  if (!best) {
    throw new Error('Wise returned no recipient account types for this currency.');
  }
  // Don't reject on missing fields yet — Wise hides some required fields (e.g. a
  // US `address.state`) until we echo back the values they depend on (see the
  // refresh loop in createWiseRecipient). The missing list is re-checked there,
  // after the requirements have been fully expanded.
  return {
    type: best.type,
    details: best.details,
    missing: best.missing,
    requirement: best.requirement,
  };
}

/** The fully-resolved Wise account request, before it is POSTed to create the recipient. */
export interface ResolvedWiseAccountRequest {
  currency: string;
  type: string;
  details: Record<string, any>;
  /** Required fields Wise asked for that we still couldn't fill (empty = ready to create). */
  missing: string[];
}

/**
 * Resolve everything needed to create a Wise recipient *without* the final,
 * side-effecting `POST /v1/accounts` — the target currency, the chosen account
 * `type`, the mapped `details`, and any still-missing required fields. This is
 * the read-only half of recipient creation: it performs only the
 * account-requirements GET (and the dependent-field refresh POSTs, which are
 * themselves read-only — Wise returns requirements, not a created account). Use
 * it to validate or preview bank details without leaving a recipient behind.
 */
export async function resolveWiseAccountRequest(
  cfg: WiseConfig,
  details: WireBankDetails,
): Promise<ResolvedWiseAccountRequest> {
  if (!cfg.token || !cfg.profileId) {
    throw new Error('Wise is not configured (missing API token / profile id).');
  }

  const currency = resolveTargetCurrency(details);
  const requirements = await fetchAccountRequirements(cfg, currency);
  if (requirements.length === 0) {
    throw new Error(
      `Wise has no recipient requirements for ${currency} — it is not a supported payout currency.`,
    );
  }

  const accNum = (details.accountNumber || '').replace(/[\s-]/g, '');
  const isIban = !!ibanCountry(accNum);
  const hasSwift = !!(details.swiftCode && details.swiftCode.trim());
  // The payout is "domestic" when the recipient bank's country is the home
  // country of the payout currency (e.g. USD at a US bank). Wise requires local
  // rails — never SWIFT — for these.
  const recipientCountry = normUpper(details.country);
  const domestic =
    !!recipientCountry && CURRENCY_BY_COUNTRY[recipientCountry] === currency;
  const candidates = buildCandidates(details);
  const selected = selectRecipientType(
    requirements,
    candidates,
    isIban,
    hasSwift,
    domestic,
  );
  const { type } = selected;
  let resDetails = selected.details;
  let missing = selected.missing;

  // Some currencies (notably USD) gate fields behind values we must echo back:
  // Wise only reveals `address.state` — and its allowed list — after it sees
  // `address.country: "US"`. Without this, the first (GET) requirements never
  // mention state, so we POST a recipient with no state and Wise rejects it with
  // "address.state: Please enter a state" even though the user supplied one.
  // Iterate the POST refresh until the field set stops growing (Wise's guidance),
  // re-mapping our inputs into the newly-revealed fields each round.
  if (requirementsNeedRefresh(requirements)) {
    let prevKeys = fieldKeySignature(selected.requirement);
    for (let i = 0; i < 5; i++) {
      const refreshed = await refreshAccountRequirements(
        cfg,
        currency,
        type,
        resDetails,
      );
      const req = refreshed.find((r) => String(r.type) === String(type));
      if (!req) break;
      const filled = fillRequirement(req, candidates);
      resDetails = filled.details;
      missing = filled.missing;
      const keys = fieldKeySignature(req);
      if (keys === prevKeys) break; // no new fields revealed — requirements settled
      prevKeys = keys;
    }
  }

  return { currency, type, details: resDetails, missing };
}

/**
 * Create (and thereby validate) a Wise recipient account for the given bank
 * details. Resolves the target currency, asks Wise what it needs, maps our
 * inputs in, and POSTs the account. Returns the recipient id, the resolved
 * currency, and the chosen Wise type. Throws a readable Error on any problem.
 */
export async function createWiseRecipient(
  cfg: WiseConfig,
  details: WireBankDetails,
): Promise<ResolvedWiseRecipient> {
  const { currency, type, details: resDetails, missing } =
    await resolveWiseAccountRequest(cfg, details);

  // Fail loudly on anything we still can't fill (after dependent fields were
  // revealed) rather than letting Wise reject the POST opaquely.
  if (missing.length > 0) {
    throw new Error(
      `Missing bank details required by Wise for this currency/country: ` +
        `${missing.join(', ')}.`,
    );
  }

  const res = await fetch(`${cfg.baseUrl}/v1/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({
      profile: Number(cfg.profileId),
      accountHolderName: details.accountHolderName,
      currency,
      type,
      details: resDetails,
    }),
  });
  const data = await parseWiseResponse(res, cfg.onWarn);
  if (!data || !data.id) {
    throw new Error('Wise did not return a recipient id.');
  }
  return { recipientId: String(data.id), currency, type };
}
