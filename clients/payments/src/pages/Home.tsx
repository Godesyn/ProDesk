import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useCurrentUser } from "@shared/auth/auth-context";
import { useTRPC } from "@shared/lib/trpc";
import { useQuery } from "@tanstack/react-query";
import "@/styles/marketing.css";

// ─── CMS helpers ─────────────────────────────────────────────────────────────────
function fmtPct(pctStr: string | undefined | null, fallback = "1%"): string {
  if (!pctStr) return fallback;
  const n = parseFloat(pctStr);
  if (isNaN(n)) return pctStr;
  // Remove trailing zeros: 1.00 → 1%, 1.70 → 1.7%, 5.00 → 5%
  return `${parseFloat(n.toFixed(2))}%`;
}

// ─── helpers ────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return Math.round(n).toLocaleString("en-AU");
}
function totalForTime(s: number) {
  if (s < 1.0) return 0;
  if (s < 1.15) return Math.round(((s - 1.0) / 0.15) * 24800);
  if (s < 2.0) return 24800;
  if (s < 2.15) return 24800 + Math.round(((s - 2.0) / 0.15) * 36400);
  if (s < 3.0) return 61200;
  if (s < 3.15) return 61200 + Math.round(((s - 3.0) / 0.15) * 12400);
  if (s < 4.5) return 73600;
  return 0;
}
function paidForTime(s: number) {
  if (s < 15.5) return 0;
  if (s < 16.0) return Math.round(((s - 15.5) / 0.5) * 35000);
  if (s < 16.3) return 35000 + Math.round(((s - 16.0) / 0.3) * 25000);
  if (s < 16.6) return 60000 + Math.round(((s - 16.3) / 0.3) * 11000);
  if (s < 16.9) return 71000 + Math.round(((s - 16.6) / 0.3) * 2400);
  if (s < 19.6) return 73400;
  return 0;
}

// ─── main component ──────────────────────────────────────────────────────────
export default function Home() {
  const trpc = useTRPC();
  const { data: user, isLoading, sessionLoading } = useCurrentUser();
  const loading = sessionLoading || isLoading;
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard");
  }, [user, loading, navigate]);

  const loginUrl = "/login";
  const signupUrl = "/signup";

  // Fetch plan tiers from CMS — single fetch, passed to all child sections
  const { data: tiersData } = useQuery({
    ...trpc.payments.pricing.getPlanTiers.queryOptions(),
    staleTime: 60_000,
  });
  const sendPct = fmtPct(tiersData?.find(t => t.key === "send")?.pct, "1%");
  const closePct = fmtPct(tiersData?.find(t => t.key === "close")?.pct, "1.7%");
  const recoverPct = fmtPct(tiersData?.find(t => t.key === "recover")?.pct, "5%");
  // Compute PAID scene deduction: sendPct of $73,600
  const sendRate = parseFloat(tiersData?.find(t => t.key === "send")?.pct ?? "1");
  const proDeskDeduction = (73600 * sendRate / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (loading) return null;
  if (user) return null;

  return (
    <div className="mkt-root">
      <ScrollProgress />
      <Topbar loginUrl={loginUrl} signupUrl={signupUrl} />
      <HeroSection signupUrl={signupUrl} sendPct={sendPct} proDeskDeduction={proDeskDeduction} />
      <StatStrip />
      <HowItWorksSection sendPct={sendPct} />
      <SequencesSection signupUrl={signupUrl} closePct={closePct} />
      <WhoSection />
      <ProofSection />
      <PricingSection signupUrl={signupUrl} sendPct={sendPct} closePct={closePct} recoverPct={recoverPct} />
      <FaqSection sendPct={sendPct} closePct={closePct} />
      <FooterSection />
      <SmoothScrollScript />
    </div>
  );
}

// ─── scroll progress ─────────────────────────────────────────────────────────
function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const pct = h.scrollTop / (h.scrollHeight - h.clientHeight);
      if (barRef.current) barRef.current.style.width = Math.max(0, Math.min(1, pct)) * 100 + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="scroll-progress">
      <div className="bar" ref={barRef} />
    </div>
  );
}

// ─── topbar ──────────────────────────────────────────────────────────────────
function Topbar({ loginUrl, signupUrl }: { loginUrl: string; signupUrl: string }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return (
    <header className={`topbar${scrolled ? " is-scrolled" : ""}`} id="topbar">
      <div className="topbar-inner">
        <a className="brand-lockup" href="#top" style={{ textDecoration: "none" }}>
          <img alt="EziQuotes" className="word-logo" src="/logo-wordmark.svg" style={{ height: 28 }} />
        </a>
        <nav className="topnav">
          <a href="#how">Product</a>
          <a href="#pricing">Pricing</a>
          <a href="#sequences">Sequences</a>
          <a href="#proof">Customers</a>
        </nav>
        <span className="spc" />
        <div className="topbar-right">
          <a className="btn-text" href={loginUrl}>Sign in</a>
          <a className="btn primary" href={signupUrl}>Get started <span className="arrow">&#8594;</span></a>
        </div>
      </div>
    </header>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────────
function HeroSection({ signupUrl, sendPct, proDeskDeduction }: { signupUrl: string; sendPct: string; proDeskDeduction: string }) {
  const totValRef = useRef<HTMLSpanElement>(null);
  const paidBigRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    function loop() {
      const t = (performance.now() / 1000) % 20;
      if (totValRef.current) totValRef.current.textContent = fmt(totalForTime(t));
      if (paidBigRef.current) paidBigRef.current.textContent = "$" + fmt(paidForTime(t));
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div className="hero-grid">
          <div className="hero-left">
            <div className="sec-eye" data-reveal="">
              <span className="tag-new">NEW &middot; MAY 2026</span>
              <span>SMS-FIRST PAYMENTS FOR SERVICE BUSINESSES</span>
            </div>
            <h1 data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
              Get paid faster.<br />
              <em>Branded</em> proposals.<br />
              SMS-delivered.
            </h1>
            <p className="strap" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
              Build a beautiful proposal, send it by SMS, get paid through Stripe.{" "}
              <b>From {sendPct} per payment. No subscription.</b>{" "}
              You pay nothing until you get paid.
            </p>
            <div className="cta-row" data-reveal="" style={{ "--reveal-delay": "240ms" } as React.CSSProperties}>
              <a className="btn primary lg" href={signupUrl}>Get started <span className="arrow">&#8594;</span></a>
              <button className="btn lg" onClick={() => {
                const el = document.getElementById("how");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>See it work</button>
            </div>
          </div>
          <aside className="hero-show" data-reveal="" style={{ "--reveal-delay": "200ms" } as React.CSSProperties}>
            <div className="show-stage">
              {/* SCENE 1 - BUILD */}
              <div className="scene s1">
                <div className="canvas build-canvas">
                  <header className="cv-head">
                    <div>
                      <div className="cv-title">Sarah Chen Studio</div>
                      <div className="cv-sub">SC4-9K &middot; NEW</div>
                    </div>
                    <div className="cv-pill">DRAFT</div>
                  </header>
                  <div className="cv-list">
                    <div className="cv-row r1"><span>Branding DNA</span><span>$24,800</span></div>
                    <div className="cv-row r2"><span>Site build</span><span>$36,400</span></div>
                    <div className="cv-row r3"><span>Launch support</span><span>$12,400</span></div>
                    <div className="cv-total">
                      <span>Total &middot; AUD</span>
                      <span className="tot-num">$<span className="tot-val" ref={totValRef}>0</span></span>
                    </div>
                  </div>
                  <button className="cv-send">Send <span>&#8594;</span></button>
                </div>
              </div>
              {/* SCENE 2 - SEND */}
              <div className="scene s2">
                <div className="canvas send-canvas">
                  <header className="cv-head">
                    <div>
                      <div className="cv-title">Send by SMS</div>
                      <div className="cv-sub">SC4-9K &middot; READY</div>
                    </div>
                    <div className="cv-pill">DELIVER</div>
                  </header>
                  <div className="snd-fields">
                    <div className="snd-field"><span className="lbl">TO</span><span className="val">Sarah Chen</span></div>
                    <div className="snd-field"><span className="lbl">MOBILE</span><span className="val type"><span className="typed" /><span className="caret" /></span></div>
                    <div className="snd-field"><span className="lbl">LINK</span><span className="val link">eziquotes.app/sc4-9k</span></div>
                  </div>
                  <button className="snd-go">SEND <span>&#8594;</span></button>
                  <div aria-hidden="true" className="sms-fly">
                    <div className="sms-bubble">Hi Sarah &mdash; your proposal is ready: <b>eziquotes.app/sc4-9k</b></div>
                  </div>
                  <div className="snd-delivered">
                    <span className="dot" />
                    DELIVERED &middot; OPENED &middot; 0.4s
                  </div>
                </div>
              </div>
              {/* SCENE 3 - PAY */}
              <div className="scene s3">
                <div className="canvas pay-canvas">
                  <div aria-hidden="true" className="phone">
                    <div className="phone-notch" />
                    <div className="phone-screen">
                      <div className="ph-brand">
                        <span className="ph-dot" />
                        Sarah Chen Studio
                      </div>
                      <div className="ph-amt">$73,600 <em>AUD</em></div>
                      <div className="ph-sub">Proposal SC4-9K</div>
                      <div className="ph-lines">
                        <div>Branding DNA<span>$24,800</span></div>
                        <div>Site build<span>$36,400</span></div>
                        <div>Launch support<span>$12,400</span></div>
                      </div>
                      <button className="ph-pay">
                        <span className="ap" /> Pay
                      </button>
                      <div className="ph-overlay">
                        <div className="ph-spinner" />
                        <div className="ph-msg">Authenticating&hellip;</div>
                      </div>
                      <div className="ph-paid-stamp">PAID</div>
                    </div>
                  </div>
                </div>
              </div>
              {/* SCENE 4 - PAID */}
              <div className="scene s4">
                <div className="canvas paid-canvas">
                  <header className="cv-head">
                    <div>
                      <div className="cv-title">Payout settled</div>
                      <div className="cv-sub">WESTPAC &middot;&middot;&middot; 4471</div>
                    </div>
                    <span className="dot-pulse" />
                  </header>
                  <div className="paid-amt">
                    <span className="paid-plus">+</span>
                    <span className="paid-big" ref={paidBigRef}>$73,400</span>
                    <span className="paid-em">net</span>
                  </div>
                  <div className="paid-rows">
                    <div><span>Gross</span><span>$73,600.00</span></div>
                    <div><span>EziQuotes &middot; {sendPct}</span><span>&minus; ${proDeskDeduction}</span></div>
                    <div><span>Stripe fees</span><span>&minus; $1,251.50</span></div>
                  </div>
                  <div className="paid-eta">
                    Cleared in <b>24h</b> <span className="paid-arrow">&#8594;</span>
                  </div>
                  <span className="conf c1" /><span className="conf c2" /><span className="conf c3" />
                  <span className="conf c4" /><span className="conf c5" /><span className="conf c6" />
                  <span className="conf c7" />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

// ─── stat strip ──────────────────────────────────────────────────────────────
function StatStrip() {
  useEffect(() => {
    function animateCounter(el: HTMLElement) {
      if (el.dataset.done) return;
      el.dataset.done = "1";
      const target = +(el.dataset.target || 0);
      const suffix = el.dataset.suffix || "";
      const pre = el.dataset.pre || "";
      const comma = el.dataset.format === "comma";
      const dur = 1500;
      const start = performance.now();
      function tick(t: number) {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 5);
        const val = Math.round(target * eased);
        el.textContent = pre + (comma ? val.toLocaleString("en-AU") : val.toString()) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = pre + (comma ? target.toLocaleString("en-AU") : target.toString()) + suffix;
      }
      requestAnimationFrame(tick);
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          animateCounter(e.target as HTMLElement);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.3 });
    document.querySelectorAll(".counter").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-label="At a glance" className="stat-strip">
      <div className="row">
        <div className="stat" data-reveal="">
          <div className="num">
            <span className="counter" data-format="comma" data-suffix="+" data-target="12400">12,400+</span>
          </div>
          <div className="lbl">Proposals sent</div>
        </div>
        <div className="stat accent" data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          <div className="num">
            <span className="counter" data-format="comma" data-pre="$" data-target="1840000">$1,840,000</span>
          </div>
          <div className="lbl">Paid this month</div>
        </div>
        <div className="stat" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
          <div className="num">
            <span className="counter" data-suffix="%" data-target="68">68%</span>
          </div>
          <div className="lbl">Avg acceptance</div>
        </div>
        <div className="stat" data-reveal="" style={{ "--reveal-delay": "240ms" } as React.CSSProperties}>
          <div className="num">
            <span className="counter" data-suffix="+" data-target="340">340+</span>
          </div>
          <div className="lbl">Businesses active</div>
        </div>
      </div>
    </section>
  );
}

// ─── step-in observer ────────────────────────────────────────────────────────
function StepInObserver() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in-view");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.2 });
    document.querySelectorAll("[data-stepin]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}

// ─── data-reveal observer ────────────────────────────────────────────────────
function RevealObserver() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).style.animationPlayState = "running";
          e.target.classList.add("revealed");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.1 });
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}

// ─── smooth scroll ───────────────────────────────────────────────────────────
function SmoothScrollScript() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a[href^='#']") as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute("href");
      if (!id || id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      const top = el.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: "smooth" });
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);
  return null;
}

// ─── how it works ────────────────────────────────────────────────────────────
function HowItWorksSection({ sendPct }: { sendPct: string }) {
  return (
    <section className="section" id="how">
      <StepInObserver />
      <RevealObserver />
      <div className="wrap">
        <div className="sec-eye" data-reveal="">
          <span className="dot" />
          <span>HOW IT WORKS</span>
          <span className="rule" />
        </div>
        <h2 data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          From quote to <em>paid</em> in three clicks.
        </h2>
        <p className="lede" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
          No CRM to learn. No API keys to find. No subscriptions to forget you signed up for.
        </p>
        <div className="steps">
          {/* STEP 01 BUILD */}
          <div className="step" data-reveal="" data-stepin="">
            <div className="num"><span className="n">01</span>BUILD</div>
            <div className="copy">
              <h3>Click items in.<br />Watch the total <em>add up.</em></h3>
              <p>Drop products from your catalog. Inline-edit names, prices, quantities. Choose one-off, subscription, or payment plan.</p>
            </div>
            <div className="viz viz-build">
              <div className="vh">
                <span>NEW PROPOSAL &middot; DRAFT</span>
                <span className="vh-pill">SC4-9K</span>
              </div>
              <div className="bv-rows">
                <div className="bv-row"><span className="bv-tag">ONE-OFF</span><span className="bv-name">Branding DNA</span><span className="bv-price">$24,800</span></div>
                <div className="bv-row latest"><span className="bv-tag">ONE-OFF</span><span className="bv-name">Site build</span><span className="bv-price">$36,400</span></div>
                <div className="bv-row"><span className="bv-tag">RETAINER</span><span className="bv-name">Launch support</span><span className="bv-price">$12,400</span></div>
              </div>
              <div className="bv-total">
                <span>TOTAL &middot; AUD</span>
                <span className="bv-total-num">$73,600</span>
              </div>
              <button className="bv-cta" type="button">Send to client <span className="arrow">&#8594;</span></button>
            </div>
          </div>
          {/* STEP 02 SEND */}
          <div className="step" data-reveal="" data-stepin="">
            <div className="num"><span className="n">02</span>SEND</div>
            <div className="copy">
              <h3>One field, one number.<br />One <em>SMS.</em></h3>
              <p>Your client gets a personal link in their pocket. They open it on their phone. 95% of opens happen inside 90 seconds.</p>
            </div>
            <div className="viz viz-send-step">
              <div className="vh">
                <span>SMS &middot; 12:04PM AEST</span>
                <span className="vh-pill ok">SENT</span>
              </div>
              <div className="sv-screen">
                <div className="sv-head">
                  <span className="sv-app">EziQuotes</span>
                  <span className="sv-time">now</span>
                </div>
                <div className="sv-bubble">
                  Hi Sarah &mdash; proposal for the Sept launch is ready.<br />
                  <span className="sv-link">eziquotes.app/sc4-9k</span>
                </div>
                <div className="sv-typing">
                  <span className="sv-dot" /><span className="sv-dot" /><span className="sv-dot" />
                  <span className="sv-typing-label">Sarah is reading&hellip;</span>
                </div>
              </div>
              <div className="sv-status">
                <span className="sv-pulse" />
                <span>DELIVERED &middot; OPENED <b>0.4s</b> AGO</span>
              </div>
            </div>
          </div>
          {/* STEP 03 GET PAID */}
          <div className="step" data-reveal="" data-stepin="">
            <div className="num"><span className="n">03</span>GET PAID</div>
            <div className="copy">
              <h3>Stripe handles it.<br />You see <em>the money.</em></h3>
              <p>Card, Apple Pay, Google Pay, BECS. Payouts in 24 hours. EziQuotes takes from {sendPct}, deducted automatically. No invoices to chase.</p>
            </div>
            <div className="viz viz-paid-step">
              <div className="vh">
                <span>PAYOUT &middot; WESTPAC &middot;&middot;&middot; 4471</span>
                <span className="vh-pill volt">PAID</span>
              </div>
              <div className="pv-hero">
                <span className="pv-plus">+</span>
                <span className="pv-amt">$71,392</span>
                <span className="pv-net"><em>net</em></span>
              </div>
              <div className="pv-bars">
                <div className="pv-bar pv-bar-gross">
                  <span className="pv-bar-fill" />
                  <span className="pv-bar-lbl">GROSS</span>
                  <span className="pv-bar-val">$73,600.00</span>
                </div>
                <div className="pv-bar pv-bar-fee">
                  <span className="pv-bar-fill" />
                  <span className="pv-bar-lbl">PRODESK &middot; {sendPct}</span>
                  <span className="pv-bar-val">&minus; $2,208.00</span>
                </div>
              </div>
              <div className="pv-eta">
                <span className="pv-eta-bar"><span className="pv-eta-fill" /></span>
                <span className="pv-eta-lbl">CLEARED IN <b>24H</b></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── sequences ───────────────────────────────────────────────────────────────
function SequencesSection({ closePct }: { signupUrl: string; closePct: string }) {
  return (
    <section className="sequences on-ink" id="sequences">
      <div className="wrap">
        <div className="head">
          <div>
            <div className="sec-eye" data-reveal="">
              <span className="dot" />
              <span>CLOSE TIER &middot; {closePct}</span>
              <span className="rule" />
              <span className="tag-new">NEW</span>
            </div>
            <h2 data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
              The follow-up that<br />
              <em>closes deals</em><br />
              while you sleep.
            </h2>
          </div>
          <p className="lede" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
            Communication Sequences fire the right message at the right time &mdash; cold outreach, engagement nudges, missed-payment recovery &mdash; all on autopilot.
          </p>
        </div>
        <div className="seq-grid">
          <article className="seq-card" data-reveal="">
            <div className="seq-demo demo-cold">
              <div className="demo-row">
                <span className="demo-day">D+2</span>
                <span className="demo-bubble">Hey Sarah &mdash; quick check on the proposal.</span>
              </div>
              <div className="demo-row">
                <span className="demo-day">D+5</span>
                <span className="demo-bubble">Still keen? Happy to jump on a call.</span>
              </div>
              <div className="demo-row">
                <span className="demo-day">D+10</span>
                <span className="demo-bubble">Last touch &mdash; link expires soon.</span>
              </div>
            </div>
            <div className="tagline">COLD SEQUENCE</div>
            <h4>Sent but <em>no opens?</em></h4>
            <p>A 3-touch SMS + email sequence fires automatically 2, 5, and 10 days after sending. Personalised, human-sounding. You write it once.</p>
            <div className="seq-foot">3 TOUCHES &middot; WRITE ONCE</div>
          </article>
          <article className="seq-card" data-reveal="" style={{ "--reveal-delay": "100ms" } as React.CSSProperties}>
            <div className="seq-demo demo-engage">
              <div className="demo-eye">
                <span className="demo-eye-lbl">SARAH&apos;S VIEW &middot; 73% SCROLLED</span>
                <span className="demo-scroll"><span className="demo-fill" /></span>
              </div>
              <div className="demo-scrolled">
                <span className="demo-tick">&#10003;</span> Header
                <span className="demo-tick">&#10003;</span> Scope
                <span className="demo-tick">&#10003;</span> Timeline
                <span className="demo-pending">&#9675;</span> Pricing
              </div>
              <div className="demo-ai">
                <span className="demo-ai-pulse" />
                <span>AI rewrites with <b>budget angle</b></span>
              </div>
            </div>
            <div className="tagline">ENGAGEMENT SEQUENCE</div>
            <h4>Opened but <em>not accepted?</em></h4>
            <p>When a client views but doesn&apos;t sign, a tailored nudge goes out. AI rewrites the message based on what they scrolled past.</p>
            <div className="seq-foot">AI-TUNED PER VIEW</div>
          </article>
          <article className="seq-card" data-reveal="" style={{ "--reveal-delay": "200ms" } as React.CSSProperties}>
            <div className="seq-demo demo-recover">
              <div className="demo-chain">
                <div className="demo-chip demo-chip-fail">
                  <span className="demo-chip-dot" />
                  FAILED &middot; 12H
                </div>
                <span className="demo-arrow">&#8594;</span>
                <div className="demo-chip demo-chip-pending">
                  <span className="demo-spinner" />
                  RETRY &middot;&middot;&middot; 4242
                </div>
                <span className="demo-arrow">&#8594;</span>
                <div className="demo-chip demo-chip-paid">
                  <span className="demo-chip-dot" />
                  PAID
                </div>
              </div>
              <div className="demo-recover-note">3 auto-retries &middot; then a polite nudge</div>
            </div>
            <div className="tagline">MISSED PAYMENT</div>
            <h4>Payment <em>failed?</em></h4>
            <p>Automatic retry prompts fire within hours of a failed charge. Polite, persistent, and effective &mdash; without you lifting a finger.</p>
            <div className="seq-foot">RECOVER TIER &middot; WAITLIST</div>
          </article>
        </div>
        <div className="seq-cta" data-reveal="">
          <a className="seq-cta-btn" href="#pricing">Unlock sequences <span className="arrow">&#8594;</span></a>
          <span className="seq-cta-meta">Included in Close &middot; {closePct} per payment</span>
        </div>
      </div>
    </section>
  );
}

// ─── who it's for ────────────────────────────────────────────────────────────
const WHO_CATS = [
  {
    num: "01", title: "Home & Trade Services",
    types: [
      ["Roofers","Quote per square, take a deposit, balance on completion."],
      ["Painters","Quote rooms or whole house, 30% deposit, paid on walk-through."],
      ["Tilers","Quote per m², deposit before order, balance once grouted."],
      ["Carpenters","Itemise materials and labour. Deposit secures the slot."],
      ["Builders","Stage payments — slab, frame, lockup, handover — fired by SMS."],
      ["Renovators","Scoped fixed-price quote. Deposit, then fortnightly progress claims."],
      ["Bathroom Renovators","All-in quote. 20% deposit, balance the day the door shuts."],
      ["Kitchen Renovators","Deposit secures cabinetry, second draw on install, final at sign-off."],
      ["Flooring Installers","Quote per m² including underlay. Balance on completion."],
      ["Air Conditioning Technicians","Quote install + service plan. Recurring maintenance debit."],
      ["Pest Control Technicians","One-off treatment or quarterly plan, paid by SMS link."],
      ["Security System Installers","Hardware quote + monitoring. Monthly auto-charge for alarms."],
      ["Locksmiths","Quote on call. Tap-to-pay on-site once keys are cut."],
      ["Window & Door Installers","Per-opening quote, 50% deposit on order, balance on install."],
      ["Fencing Contractors","Quote per linear metre. Deposit covers materials, balance at completion."],
      ["Concreters","Quote per m² + pump. Balance once cured and cleaned."],
      ["Landscapers","Design fee, plant deposit, balance staged by zone."],
      ["Tree Loppers","Quote per tree. 20% deposit, paid the day stumps are gone."],
      ["Irrigation Specialists","Quote zones + controller. Balance on commissioning."],
      ["Garage Door Installers","Door + opener quote. Balance once it cycles."],
      ["Shed Builders","Quote slab + shed. Deposit before order, balance on handover."],
      ["Home Automation Installers","Quote rooms + hub. Balance once the app pairs."],
    ],
  },
  {
    num: "02", title: "Auto & Marine",
    types: [
      ["Panel Beaters","Insurance excess or private quote — paid before pickup."],
      ["Auto Electricians","Diagnostic fee, repair quote by SMS, paid before keys."],
      ["Car Detailers","Package quote. Deposit secures booking, balance on collection."],
      ["Caravan Repairers","Inspection fee, repair quote, paid before the van leaves."],
      ["Boat Mechanics","Service quote, parts approval by SMS, paid before splash."],
      ["Marine Detailers","Per-foot quote. Deposit, balance once cleared."],
      ["Tyre Shops","Quote by tyre + alignment. Paid before drive-away."],
      ["Windscreen Repairers","Mobile quote. Tap to pay while it cures."],
      ["Motorbike Mechanics","Service quote, parts approval, paid before pickup."],
    ],
  },
  {
    num: "03", title: "Health, Medical & Wellness",
    types: [
      ["Dentists","Treatment plan, split over 6 months. Gap covered by SMS."],
      ["Orthodontists","Quote braces or aligners. Monthly auto-debit till done."],
      ["Chiropractors","Session pack quote — pre-paid 5, 10, or 20 visits."],
      ["Physiotherapists","Treatment plan. Gap charged by SMS after each session."],
      ["Podiatrists","Initial assessment + orthotics quote. Paid on order."],
      ["Optometrists","Frames + lens quote. Deposit, balance on collection."],
      ["Audiologists","Hearing aid trial, finance plan, monthly auto-debit."],
      ["Cosmetic Injectors","Package quote. Deposit holds the chair, balance on the day."],
      ["Skin Clinics","Course of treatments, pre-paid, top-up reminders."],
      ["Laser Clinics","Pre-paid laser packages. No-show recovery if missed."],
      ["Weight Loss Clinics","Program quote, monthly auto-charge, pause anytime."],
      ["IVF Clinics","Cycle quote. Deposit on schedule, balance before transfer."],
      ["Veterinarians","Estimate by SMS, paid before pickup. Recurring scripts handled."],
      ["Psychologists","Session pack. Gap by SMS, Medicare rebate handled."],
      ["Allied Health Clinics","Multi-discipline plans split per provider. One invoice."],
    ],
  },
  {
    num: "04", title: "Beauty & Personal Care",
    types: [
      ["Barbers","Subscription cuts, paid monthly. Walk-in tap-to-pay too."],
      ["Beauty Salons","Package quote, gift voucher links, retail top-ups."],
      ["Nail Technicians","Booking deposit, balance at the chair, rebook reminder."],
      ["Brow & Lash Artists","Pre-paid 3-month package. Fill-in reminders fire by SMS."],
      ["Tattoo Artists","Deposit holds the slot. Balance the day you bleed."],
      ["Cosmetic Tattooists","Procedure + 6-week touch-up, quoted together."],
      ["Medispa Clinics","Course of treatments, pre-paid, loyalty top-ups."],
      ["Hair Transplant Clinics","Per-graft quote. Deposit, balance on the day."],
    ],
  },
  {
    num: "05", title: "Professional Services",
    types: [
      ["Accountants","Engagement letter, monthly retainer, tax-time top-up."],
      ["Bookkeepers","Hourly or fixed plan. Weekly or monthly auto-charge."],
      ["Mortgage Brokers","Free + trail. One-off services paid by SMS."],
      ["Financial Planners","SOA fee, ongoing advice paid quarterly."],
      ["Business Coaches","Monthly retainer. Pre-paid quarter saves 10%."],
      ["Consultants","Scope of work, milestone billing, change orders by SMS."],
      ["Migration Agents","Visa quote, paid in stages by case milestone."],
      ["Conveyancers","Fixed-fee quote, paid at exchange and settlement."],
      ["Insurance Brokers","Annual quote, monthly debits if preferred."],
      ["Recruitment Agencies","Search-fee deposit, placement balance on start."],
      ["Education Consultants","Initial assessment, retainer, application milestones."],
    ],
  },
  {
    num: "06", title: "Events & Lifestyle",
    types: [
      ["Wedding Planners","Booking deposit, six monthly milestones, balance on the day."],
      ["Wedding Photographers","Pack quote. Save-the-date deposit, balance pre-day."],
      ["Videographers","Project quote, deposit + final, extras as add-ons."],
      ["Event Stylists","Concept fee, deposit on items, balance pre-event."],
      ["Florists","Per-event quote. Deposit, balance the morning of."],
      ["Caterers","Per-head quote. 50% deposit, final headcount confirmed by SMS."],
      ["Function Venues","Booking deposit, F&B balance, bond held on event day."],
      ["Party Hire Companies","Item quote, delivery + pickup fee, bond held."],
      ["Marquee Hire Companies","Quote by m². Deposit, balance on install."],
      ["Personal Trainers","Session packs, monthly debit, no-show recovery."],
      ["Gyms","Membership + casual passes, family plans, pause anytime."],
      ["Dance Schools","Term enrolment, split by week, costume add-ons."],
      ["Martial Arts Schools","Monthly debit, grading fees, gear add-ons."],
    ],
  },
  {
    num: "07", title: "Education & Training",
    types: [
      ["Tutors","Per-session or packs. Weekly auto-charge."],
      ["Driving Schools","Lesson packs, pre-paid, instructor surcharge handled."],
      ["Registered Training Organisations","Course fee with payment plans. Gov-funded portions handled."],
      ["Music Teachers","Termly fee, split by week, recital extras."],
      ["Language Schools","Course bundle, payment plan, certificate fee on completion."],
      ["Swimming Schools","Termly enrolment, auto-renew, gear add-ons."],
      ["First Aid Training Providers","Per-student quote. Group bookings, certificate on payment."],
    ],
  },
  {
    num: "08", title: "Business & Commercial",
    types: [
      ["Web Developers","Scope of work, milestone billing, hosting on retainer."],
      ["Branding Agencies","Phase quote, milestone payments, asset delivery on final."],
      ["SEO Agencies","Audit deposit, monthly retainer, performance bonus."],
      ["Digital Marketing Agencies","Setup + ad spend + management — one monthly debit."],
      ["IT Support Providers","Monthly seat-based, on-demand top-ups."],
      ["Cybersecurity Consultants","Audit fee, remediation quote, ongoing watch."],
      ["Commercial Cleaners","Per-visit or per-m² monthly contract."],
      ["Office Fitout Companies","Design fee, deposit, milestone billing to handover."],
      ["Signage Companies","Design + manufacture quote. Deposit, balance on install."],
      ["Print Companies","Job quote, paid before press, account terms by request."],
      ["Uniform Suppliers","Per-piece or pack. Deposit, balance on shipment."],
      ["Equipment Hire Companies","Per-day quote. Bond held, balance on return."],
    ],
  },
];

function WhoSection() {
  return (
    <section className="section" id="who">
      <div className="wrap">
        <div className="sec-eye" data-reveal="">
          <span className="dot" />
          <span>WHO IT&apos;S FOR &middot; 8 INDUSTRIES &middot; 100+ TYPES</span>
          <span className="rule" />
        </div>
        <h2 data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          Built for <em>service businesses</em><br />
          that quote and collect.
        </h2>
        <div className="who-cats" style={{ marginTop: 64 }}>
          {WHO_CATS.map((cat) => (
            <article className="who-cat" data-reveal="" key={cat.num}>
              <header className="wc-head">
                <span className="wc-num">{cat.num}</span>
                <span className="wc-title">{cat.title}</span>
              </header>
              <div className="wc-types">
                {cat.types.map(([name, use]) => (
                  <span className="wc-type" data-use={use} key={name}>{name}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
        <div className="who-tail" data-reveal="">
          Don&apos;t see your industry? <a className="who-tail-link" href="mailto:hello@noize.com.au">Tell us &mdash; we&apos;ll set it up.</a>
        </div>
      </div>
    </section>
  );
}

// ─── proof ───────────────────────────────────────────────────────────────────
function ProofSection() {
  return (
    <section className="proof" id="proof">
      <div className="wrap">
        <div className="sec-eye" data-reveal="">
          <span className="stars">&#9733; &#9733; &#9733; &#9733; &#9733;</span>
          <span className="rule" />
          <span>FOUNDING CUSTOMER &middot; IKEEP</span>
        </div>
        <blockquote className="quote" data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          <span className="qmark">&ldquo;</span>We sent <em>seventy-four</em> proposals in the first month. Sixty-one paid. The other thirteen are sitting in the chase queue. <em>I used to spend a Tuesday a fortnight</em> doing what this now does on its own.<span className="qmark">&rdquo;</span>
        </blockquote>
        <div className="sig" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
          <span className="name">Simon Allsop</span>
          <span className="div">&middot;</span>
          <span className="meta">FOUNDER &middot; IKEEP BOOKKEEPING</span>
          <span className="div">&middot;</span>
          <span className="meta">NORTH SYDNEY &middot; 14 CLIENTS &middot; 247K PROCESSED</span>
        </div>
      </div>
    </section>
  );
}

// ─── pricing ─────────────────────────────────────────────────────────────────
const CHECK_SVG = (
  <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

function PricingSection({ signupUrl, sendPct, closePct, recoverPct }: { signupUrl: string; sendPct: string; closePct: string; recoverPct: string }) {
  return (
    <section className="section" id="pricing">
      <div className="wrap">
        <div className="sec-eye" data-reveal="">
          <span className="dot" />
          <span>PRICING &middot; THREE TIERS</span>
          <span className="rule" />
        </div>
        <h2 data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          Pay only when<br /><em>you get paid.</em>
        </h2>
        <div className="price-grid" style={{ marginTop: 64 }}>
          {/* SEND */}
          <article className="price-card" data-reveal="">
            <div className="tier">SEND</div>
            <div className="price"><span className="pct">{sendPct}</span></div>
            <div className="tier" style={{ margin: "6px 0 0" }}>PER PAYMENT &middot; NO SUBSCRIPTION</div>
            <div className="punch">Send, collect, done.</div>
            <p className="blurb">Everything you need to build beautiful proposals, deliver by SMS or email, and collect payment via Stripe.</p>
            <ul className="features">
              {["Proposal builder (standard + quick)","Brand kit & templates","SMS + email delivery","Stripe Connect payouts","Activity timeline"].map((f) => (
                <li key={f}>{CHECK_SVG}<span>{f}</span></li>
              ))}
            </ul>
            <a className="cta" href={signupUrl}>Start for free <span className="arrow">&#8594;</span></a>
          </article>
          {/* CLOSE */}
          <article className="price-card feature" data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
            <span className="ribbon">MOST POPULAR</span>
            <div className="tier">CLOSE</div>
            <div className="price"><span className="pct">{closePct}</span><span className="spark" /></div>
            <div className="tier" style={{ margin: "6px 0 0" }}>PER PAYMENT &middot; NO SUBSCRIPTION</div>
            <div className="punch">Automated follow-up that converts.</div>
            <p className="blurb">Everything in Send, plus Communication Sequences &mdash; AI-powered touchpoints that fire at the right time.</p>
            <ul className="features">
              {["Everything in Send","Cold outreach sequences (3 touches)","Proposal chase messages","Engagement nudge sequences","AI message rewriter","Per-proposal sequence controls","Mark in conversation"].map((f) => (
                <li key={f}>{CHECK_SVG}<span>{f}</span></li>
              ))}
            </ul>
            <a className="cta" href={signupUrl}>Upgrade to Close <span className="arrow">&#8594;</span></a>
          </article>
          {/* RECOVER */}
          <article className="price-card" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
            <div className="tier">RECOVER</div>
            <div className="price"><span className="pct">{recoverPct}</span></div>
            <div className="tier" style={{ margin: "6px 0 0" }}>PER PAYMENT &middot; NO SUBSCRIPTION</div>
            <div className="punch">Rescue failed payments.</div>
            <p className="blurb">Everything in Close, plus a dedicated missed-payment recovery sequence. Join the waitlist.</p>
            <ul className="features">
              {["Everything in Close","Missed payment sequences","Failed-charge retry prompts","Lapsed client re-engagement","Priority support","Waitlist access"].map((f) => (
                <li key={f}>{CHECK_SVG}<span>{f}</span></li>
              ))}
            </ul>
            <a className="cta" href={signupUrl}>Join waitlist <span className="arrow">&#8594;</span></a>
          </article>
        </div>
        <p className="price-fineprint" data-reveal="">
          <b>Stripe fees apply on top.</b> 1.7% + 30&cent; for domestic AU cards. We don&apos;t mark them up. SMS charged at cost (~5&cent;/msg). Visible in your dashboard.
        </p>
      </div>
    </section>
  );
}

// ─── faq ─────────────────────────────────────────────────────────────────────
function FaqSection({ sendPct, closePct }: { sendPct: string; closePct: string }) {
  const FAQ_QUESTIONS = [
    `What does ${sendPct} actually cover?`,
    "Do my clients need a EziQuotes account?",
    "Can I use my own Stripe account?",
    "What payment methods do you support?",
    "How fast do I get paid?",
    "Is there a contract or minimum term?",
    "Can I white-label the proposals?",
    `What’s the Close tier (${closePct})?`,
    "What’s the Recover tier?",
  ];
  return (
    <section className="section" id="faq">
      <div className="wrap">
        <div className="sec-eye" data-reveal="">
          <span className="dot" />
          <span>FAQ</span>
          <span className="rule" />
        </div>
        <h2 data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          Questions we get <em>a lot.</em>
        </h2>
        <div className="faq-list" data-reveal="" style={{ "--reveal-delay": "120ms" } as React.CSSProperties}>
          {FAQ_QUESTIONS.map((q) => (
            <details className="faq-item" key={q}>
              <summary><span>{q}</span><span className="toggle">+</span></summary>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── footer ──────────────────────────────────────────────────────────────────
function FooterSection() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="col brand-block">
            <div className="lockup">
              <img alt="EziQuotes" src="/logo-wordmark.svg" style={{ height: 36, display: "block" }} />
            </div>
            <div className="tag-line">Run your business from <em>one</em> tab. Get paid through it too.</div>
            <div className="legal">&copy; 2026 EziQuotes Pty Ltd &middot; ABN 27 661 042 519 &middot; Made in Sydney</div>
          </div>
          <div className="col">
            <h5>Product</h5>
            <a href="#how">How it works</a>
            <a href="#sequences">Sequences</a>
            <a href="#proof">Customers</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="col">
            <h5>Get started</h5>
            <a href="/signup">Sign up</a>
            <a href="/login">Log in</a>
          </div>
          <div className="col">
            <h5>Company</h5>
            <a href="mailto:hello@noize.com.au">Contact</a>
            <a href="/terms">Terms &middot; Privacy</a>
          </div>
        </div>
        <div aria-hidden="true" className="foot-mark">
          <img alt="" className="logo-big" src="/logo-wordmark.svg" />
          <span className="everything">EVERYTHING CLICKS</span>
        </div>
      </div>
    </footer>
  );
}
