import { Check } from 'lucide-react';
import { BRANDS, PEOPLE } from '../data/mock';
import { Ghost, PageHead, Primary, Section, Specimen } from '../components/primitives';

/**
 * BILLING — the `passwords` feature subscription, per seat.
 *
 * PRICES ARE NEVER HARDCODED (.agents/AGENTS.md). In the real build every figure
 * on this screen comes from the API — `entitlement.unitAmount` / `currency` and
 * the subscription amount — and is formatted with the app's money helper. The
 * constant below stands in for that ONE call while this is a skeleton; it is not
 * a licence to type a number into the copy.
 *
 * The deliberate commercial choice: EXTERNAL CLIENT COLLABORATORS ARE FREE.
 * Hypervault does this and it's right — the client is the reason the agency buys,
 * so charging for them caps adoption at exactly the wrong boundary.
 */

// Stand-in for the API response. Real build: trpc.featureSubscriptions.* →
// { unitAmount, currency, interval }.
const PLAN = { unitAmount: 400, currency: 'AUD', interval: 'month' };

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(
    cents / 100,
  );

const INCLUDED = [
  'Unlimited keys, brands and vaults',
  'One-time Send and client Intake',
  'The access map, and the statement your client can read',
  'Offboarding with an exit certificate',
  'The full register, exportable',
  'Break-glass and named recovery contacts',
];

export function Billing() {
  const billable = PEOPLE.filter((p) => !p.external && !p.departed).length;
  const free = PEOPLE.filter((p) => p.external).length;
  const perSeat = money(PLAN.unitAmount, PLAN.currency);
  const total = money(PLAN.unitAmount * billable, PLAN.currency);

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="SUBSCRIPTION"
        title="Billing"
        lede={
          <>
            One seat per person on your team. The clients you collaborate with
            don’t cost anything — they’re the reason this is worth having.
          </>
        }
        actions={<Ghost>See invoices</Ghost>}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Section eyebrow="THIS CYCLE" title="Seats">
            <div
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
              style={{ background: 'var(--card)' }}
            >
              {PEOPLE.map((p) => (
                  <div
                    key={p.id}
                    className="ledger-row flex items-center gap-3 px-4 py-3 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--ink-3)]">
                        {p.org}
                      </span>
                    </span>
                    {p.departed ? (
                      <span className="spec flex-none">REMOVED — NOT BILLED</span>
                    ) : p.external ? (
                      <span className="chip flex-none" data-tone="pigment">
                        Client · free
                      </span>
                    ) : (
                      <span className="num flex-none text-sm">{perSeat}</span>
                    )}
                  </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-t border-[var(--hair)] pt-5">
              <span className="text-sm text-[var(--ink-2)]">
                <span className="num font-semibold text-[var(--ink)]">
                  {billable}
                </span>{' '}
                billable seats ·{' '}
                <span className="num font-semibold text-[var(--ink)]">{free}</span>{' '}
                client collaborators, free
              </span>
              <span className="num text-[26px] font-extrabold leading-none">
                {total}
                <span className="spec ml-2">/ {PLAN.interval}</span>
              </span>
            </div>
          </Section>

          <div className="mt-12">
            <Section eyebrow="EVERY PLAN" title="What’s included">
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {INCLUDED.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 flex-none"
                      style={{ color: 'var(--pigment)' }}
                    />
                    {f}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>

        <aside className="flex flex-col gap-8">
          <Specimen className="p-6">
            <div className="pt-4">
              <div className="spec">CARD ON FILE</div>
              <p className="num mt-2 text-sm">Visa •••• 4102 · 09/28</p>
              <Ghost className="mt-4">Update card</Ghost>
              <p className="mt-4 border-t border-[var(--hair)] pt-4 text-[12px] leading-relaxed text-[var(--ink-2)]">
                New seats charge to this card straight away — no checkout detour
                when you add a teammate mid-cycle.
              </p>
            </div>
          </Specimen>

          <Section eyebrow="COVERAGE" title="Vaults on this plan">
            <div className="flex flex-col gap-2">
              {BRANDS.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px]">{b.name}</span>
                  <span className="spec flex-none">{b.keys} KEYS</span>
                </div>
              ))}
            </div>
          </Section>

          <Primary className="w-full justify-center">Manage subscription</Primary>
        </aside>
      </div>
    </div>
  );
}
