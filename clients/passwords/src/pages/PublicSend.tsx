import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Aperture, KeyMark, Specimen, maskOf } from '../components/primitives';

/**
 * THE RECIPIENT PAGE — public, no account, and the app's viral surface. Every
 * send is a demo shown to somebody who doesn't have Prodesk yet, so it gets the
 * full paper stage rather than a bare utility page.
 *
 * The tone matters: receiving a credential over a link is exactly the shape of a
 * phishing email, so this page has to feel like receiving something valuable
 * from someone you know. Sender's brand, one human line, the same Aperture and
 * drain ring the app uses everywhere.
 *
 * On expiry it does NOT 404 — it renders a calm "this has closed" with a way to
 * ask for a new one.
 */
export function PublicSend({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  const secret = 'Quarry-Lantern-Sift-71';

  return (
    <div
      className="km-ui stage-grid grid min-h-screen place-items-center px-4 py-10"
      style={{ background: 'var(--stage)' }}
    >
      <div className="w-full max-w-md">
        <div className="rise mb-8 flex items-center justify-center gap-2.5">
          <KeyMark seed={3} className="h-4 w-9 text-[var(--ink)]" />
          <span className="text-[15px] font-semibold tracking-tight">KEYMASTR</span>
        </div>

        {expired ? (
          <Specimen className="p-8 text-center">
            <h1 className="text-[22px] font-extrabold tracking-tight">
              This has closed.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
              The link expired or has already been opened the agreed number of
              times. Nothing was lost — ask for a fresh one and it takes a second.
            </p>
            <button
              type="button"
              className="press mt-6 inline-flex h-10 items-center rounded-[var(--radius-pill)] px-5 text-sm font-semibold text-white"
              style={{ background: 'var(--pigment)' }}
            >
              Ask for a new one
            </button>
          </Specimen>
        ) : (
          <Specimen
            className="relative overflow-hidden p-8"
            corners={['', '', 'END-TO-END ENCRYPTED', `/${token.slice(0, 6)}`]}
          >
            {/* The watermark, tiled at 4% ink when the sender enables it. */}
            <div
              className="pointer-events-none absolute inset-0 select-none"
              aria-hidden="true"
              style={{
                opacity: 0.04,
                backgroundImage:
                  'repeating-linear-gradient(-30deg, transparent 0 60px, rgba(14,14,12,1) 60px 61px)',
              }}
            />

            <div className="relative text-center">
              <p className="quill text-[19px] leading-snug">
                Sajat at Noize Agency sent you something.
              </p>
              <p className="spec mt-3">1 KEY · CLOSES IN 14 HOURS</p>

              <div className="my-8 border-y border-[var(--hair)] py-8">
                <div className="spec mb-3">XERO — ACCOUNTS@NORTHWIND.STUDIO</div>
                <div className="flex items-center justify-center gap-3">
                  {open ? (
                    <span className="revealed text-[15px]" data-unmask>
                      {secret}
                    </span>
                  ) : (
                    <span className="masked text-[15px]">{maskOf(secret)}</span>
                  )}
                  <Aperture
                    open={open}
                    onOpenChange={setOpen}
                    label="Hold to reveal"
                  />
                </div>
                <p className="spec mt-4">
                  {open ? 'HIDES ITSELF AGAIN SHORTLY' : 'PRESS AND HOLD TO REVEAL'}
                </p>
              </div>

              <p className="flex items-start gap-2 text-left text-[12px] leading-relaxed text-[var(--ink-2)]">
                <ShieldCheck
                  className="mt-0.5 h-3.5 w-3.5 flex-none"
                  style={{ color: 'var(--pigment)' }}
                />
                <span>
                  This was encrypted before it left Sajat’s browser, and the key
                  that opens it is in the part of the address after the{' '}
                  <span className="num">#</span> — which browsers never send to a
                  server. Prodesk cannot read this.
                </span>
              </p>

              <button
                type="button"
                onClick={() => setExpired(true)}
                className="spec press mt-6 underline underline-offset-4"
              >
                I'M DONE — CLOSE IT NOW
              </button>
            </div>
          </Specimen>
        )}

        <p className="spec mt-8 text-center">
          KEYMASTR — THE PASSWORD VAULT FOR PEOPLE WITH CLIENTS
        </p>
      </div>
    </div>
  );
}
