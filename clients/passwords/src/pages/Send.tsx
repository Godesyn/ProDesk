import { useState } from 'react';
import { Link2, Send as SendIcon } from 'lucide-react';
import { ITEMS, SENDS, brandName } from '../data/mock';
import { Drain, Ghost, PageHead, Primary, Section } from '../components/primitives';

/**
 * SEND — get a secret to someone outside the vault without email, Slack or a
 * Google Doc, and make receiving it feel like receiving something valuable.
 *
 * The envelope controls are written as PLAIN-ENGLISH SENTENCES with inline
 * fields rather than a form of labelled inputs — because what people are
 * actually deciding is "how careful am I being", and a sentence is how you think
 * about that. The recipient page (pages/PublicSend) is the app's viral surface:
 * every send is a demo shown to someone who doesn't have Prodesk yet.
 */

/** An envelope rule rendered as a sentence with the control inline. */
function Rule({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-[var(--hair)] py-3.5 text-sm leading-relaxed">
      {children}
    </div>
  );
}

const field =
  'h-8 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3 text-sm outline-none';

export function Send() {
  const [sealed, setSealed] = useState(false);
  const [picked, setPicked] = useState<string[]>(['k9']);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="OUTBOUND"
        title="Send a secret"
        lede={
          <>
            One link, opened once, gone when you say so. They don’t need an
            account and the value never touches your email. You’ll see the moment
            it’s opened, and you can kill it before then.
          </>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Compose ───────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <Section eyebrow="01 · WHAT" title="Pick what goes in">
            <div
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
              style={{ background: 'var(--card)' }}
            >
              {ITEMS.filter((i) => i.type !== 'delegation')
                .slice(0, 6)
                .map((it) => (
                  <label
                    key={it.id}
                    className="ledger-row flex cursor-pointer items-center gap-3 px-4 py-2.5 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(it.id)}
                      onChange={() => toggle(it.id)}
                      className="h-3.5 w-3.5 flex-none accent-[var(--pigment)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {it.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--ink-3)]">
                        {it.identity}
                      </span>
                    </span>
                    <span className="spec flex-none">{brandName(it.brandId)}</span>
                  </label>
                ))}
            </div>
            <p className="spec mt-3">
              OR TYPE A ONE-OFF VALUE THAT IS NEVER STORED IN THE VAULT
            </p>
          </Section>

          <div className="mt-12">
            <Section eyebrow="02 · THE ENVELOPE" title="How careful are you being?">
              <div className="border-t border-[var(--hair)]">
                <Rule>
                  Expires in
                  <select className={field} defaultValue="24 hours">
                    <option>1 hour</option>
                    <option>24 hours</option>
                    <option>7 days</option>
                  </select>
                </Rule>
                <Rule>
                  Can be opened
                  <select className={field} defaultValue="1">
                    <option>1</option>
                    <option>3</option>
                    <option>10</option>
                  </select>
                  time{' '}
                </Rule>
                <Rule>
                  Only by
                  <input
                    className={`${field} min-w-[220px] flex-1`}
                    defaultValue="jo@northwind.studio"
                    placeholder="their email"
                  />
                  <span className="spec w-full">
                    A CODE IS EMAILED — NO ACCOUNT NEEDED
                  </span>
                </Rule>
                <Rule>
                  And after they enter
                  <input
                    className={`${field} min-w-[200px] flex-1`}
                    placeholder="a passphrase you tell them by phone"
                  />
                  <span className="spec w-full">
                    OPTIONAL — SPLITS THE SECRET ACROSS TWO CHANNELS
                  </span>
                </Rule>
                <Rule>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="h-3.5 w-3.5 accent-[var(--pigment)]"
                    />
                    Watermark their email across the view
                  </label>
                </Rule>
                <Rule>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--pigment)]"
                    />
                    Block copy — they have to type it
                  </label>
                </Rule>
              </div>
            </Section>
          </div>

          <div className="mt-12">
            <Section eyebrow="03 · SEAL" title="Send it">
              {sealed ? (
                <div
                  className="pop rounded-[var(--radius-md)] border p-5"
                  style={{
                    borderColor: 'var(--pigment)',
                    background: 'var(--card)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Drain remaining={1} />
                    <span className="spec">SHOWN ONCE · EXPIRES IN 24H</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <code
                      className="revealed min-w-0 flex-1 truncate rounded-[var(--radius-sm)] px-3 py-2"
                      style={{ background: 'var(--stage-2)' }}
                    >
                      keymastr.prodesk.com/s/8f2c1a4b7e
                    </code>
                    <Ghost>
                      <Link2 className="h-3.5 w-3.5" /> Copy link
                    </Ghost>
                  </div>
                  <p className="mt-3 text-xs text-[var(--ink-2)]">
                    The key that opens this rides in the part of the link after
                    the <span className="num">#</span> — it never reaches our
                    server, so we could not read this even if we wanted to.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Primary onClick={() => setSealed(true)}>
                    <SendIcon className="h-3.5 w-3.5" /> Seal and send
                  </Primary>
                  <span className="num text-sm text-[var(--ink-2)]">
                    {picked.length} item{picked.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </Section>
          </div>
        </div>

        {/* ── Live sends ────────────────────────────────────────────────── */}
        <aside className="min-w-0">
          <Section eyebrow="OPEN RIGHT NOW" title="Out there">
            <div className="flex flex-col gap-3">
              {SENDS.map((s) => (
                <div
                  key={s.id}
                  className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-4"
                  style={{ background: 'var(--card)' }}
                >
                  <div className="flex items-center gap-2">
                    <Drain
                      remaining={s.remaining}
                      tone={s.remaining < 0.15 ? 'alarm' : undefined}
                      title={`Expires ${s.expires}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {s.to}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-[12px] text-[var(--ink-2)]">
                    {s.items}
                  </p>
                  <p className="spec mt-1.5">
                    {s.opens} OPENED · {s.expires}
                  </p>
                  {s.receipt && (
                    <p className="num mt-2 text-[11px] text-[var(--ink-3)]">
                      {s.receipt}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-3 border-t border-[var(--hair)] pt-3">
                    <button
                      type="button"
                      className="press text-xs font-semibold"
                      style={{ color: 'var(--alarm)' }}
                    >
                      Revoke
                    </button>
                    {!s.receipt && (
                      <button
                        type="button"
                        className="press text-xs font-semibold"
                        style={{ color: 'var(--pigment)' }}
                      >
                        Chase
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
