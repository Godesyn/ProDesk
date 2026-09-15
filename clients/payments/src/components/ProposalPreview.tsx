/**
 * ProposalPreview — shared rendering component used by both ProposalPublic (client view)
 * and ProposalBuilder (WYSIWYG live preview). Keeps the visual contract in one place.
 */
import { useState } from "react";
import { toast } from "sonner";
import { isProd } from "@/lib/env";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type ProposalData = {
  customer: string;
  customerEntity: string;
  customerABN: string;
  customerLocation: string;
  strategist: string;
  strategistRole: string;
  recipient: string;
  scopeSummary: string;
  validUntil: string;
  hero: {
    eyebrow: string;
    context: string;
    title: string[];
    strap: string;
  };
  why: {
    eyebrow: string;
    headline: string;
    lede: string;
    panels: { num: string; tag: string; title: string; body: string }[];
  };
  offer: {
    eyebrow: string;
    headline: string;
    lede: string;
    groups: {
      name: string;
      sub: string;
      lines: { name: string; help: string; units: string; sub: string; badge: string | null }[];
    }[];
    summary: {
      pill: string;
      name: string;
      price: string;
      priceSub: string;
      formula: { k: string; v: string; total: boolean }[];
    };
  };
  team: {
    eyebrow: string;
    headline: string;
    members: { initials: string; name: string; role: string; loc: string; bio: string }[];
  };
  next: {
    eyebrow: string;
    headline: string;
    milestones: { stamp: string; title: string; body: string }[];
  };
  accept: {
    eyebrow: string;
    headline: string;
    lede: string;
    recap: { k: string; v: string }[];
    totalLabel: string;
    total: string;
    terms: string;
  };
  postPay: {
    headline: string[];
    body: string;
    steps: { stamp: string; title: string; body: string }[];
  };
  footer: { entity: string; abn: string; loc: string };
};

// ─── Default demo data ─────────────────────────────────────────────────────────
export const DEFAULT_PROPOSAL_DATA: ProposalData = {
  customer: "iKeep",
  customerEntity: "iKeep Bookkeeping Pty Ltd",
  customerABN: "ABN 84 142 016 778",
  customerLocation: "North Sydney, NSW 2060",
  strategist: "Simon Allsop",
  strategistRole: "Founder · Lead Strategist",
  recipient: "Sarah Chen",
  scopeSummary: "Outsourced bookkeeping, payroll and BAS",
  validUntil: "14 days · 27 May 2026",
  hero: {
    eyebrow: "IKEEP · PROPOSAL · A-2026-0418",
    context: "Prepared for Sarah Chen, Harbourview Architecture · From Simon Allsop, iKeep",
    title: ["your", "engagement", "with iKeep"],
    strap: "Books reconciled weekly. Payroll on time, every time. BAS done before you remember it's due. One fixed monthly fee — and you stop watching the clock.",
  },
  why: {
    eyebrow: "01 · WHY IKEEP",
    headline: "A finance partner, not a service ticket.",
    lede: "We sit inside your business. We know the names of your subcontractors. We chase the supplier who keeps invoicing in the wrong format. We tell you when something is off before your accountant does.",
    panels: [
      { num: "001", tag: "PARTNERSHIP", title: "On retainer, on the team.", body: "You get a named lead and a backup. Same two people every week. No ticket queues, no offshore handoffs." },
      { num: "002", tag: "FIXED FEE",   title: "A price you can plan around.", body: "Monthly fixed fee covers everything in scope. No surprise hourly invoices. Adjust scope quarterly as the business changes." },
      { num: "003", tag: "AUSTRALIAN",  title: "Sydney-based, on local time.", body: "North Sydney office. Australian payroll, super, STP, BAS. ATO correspondence handled here — not from a call centre at 3am." },
    ],
  },
  offer: {
    eyebrow: "02 · YOUR ENGAGEMENT",
    headline: "Monthly, with one quarterly review.",
    lede: "Pick the cadence that fits. You can change it at the end of any quarter.",
    groups: [
      {
        name: "Books & reconciliation",
        sub: "$1,920 / month",
        lines: [
          { name: "Weekly bookkeeping", help: "Up to 200 transactions per month, Xero", units: "4 weeks", sub: "$1,920", badge: null },
          { name: "Daily bank feeds review", help: "Auto-coding rules tuned monthly", units: "Included", sub: "—", badge: "INCLUDED" },
        ],
      },
    ],
    summary: {
      pill: "MONTHLY · FIXED",
      name: "iKeep Standard",
      price: "$2,780",
      priceSub: "/ month",
      formula: [
        { k: "Books & reconciliation", v: "$1,920", total: false },
        { k: "Monthly total", v: "$2,780", total: true },
      ],
    },
  },
  team: {
    eyebrow: "03 · YOUR TEAM",
    headline: "Two names, one inbox.",
    members: [
      { initials: "SA", name: "Simon Allsop", role: "Founder · Lead Strategist", loc: "North Sydney, NSW", bio: "Twelve years in agency finance before iKeep. Reviews your books weekly, joins the quarterly call, escalates to your accountant if needed." },
      { initials: "PN", name: "Priya Naidu",  role: "Senior Bookkeeper", loc: "North Sydney, NSW", bio: "Runs your weekly reconciliation and payroll. CPA-registered. Handles ATO correspondence on your behalf." },
    ],
  },
  next: {
    eyebrow: "04 · WHAT HAPPENS NEXT",
    headline: "Onboarded in ten business days.",
    milestones: [
      { stamp: "DAY 0",    title: "Accept and pay first month",   body: "You confirm, we issue the engagement letter and start the clock." },
      { stamp: "DAY 1–3",  title: "Books migration",              body: "We get read-only access to your Xero, your bank feeds, your last BAS." },
      { stamp: "DAY 4–7",  title: "First reconciliation",         body: "We catch up the last 30 days and flag anything we need from you." },
      { stamp: "DAY 8–10", title: "Live, with your first review", body: "Weekly cadence starts. First monthly P&L lands in your inbox." },
    ],
  },
  accept: {
    eyebrow: "05 · ACCEPT AND PAY",
    headline: "Confirm the engagement.",
    lede: "Your first month is paid up front. Subsequent months are billed on the 1st. Cancel any time with 30 days notice.",
    recap: [
      { k: "Books & reconciliation", v: "$1,920" },
      { k: "Monthly total", v: "$2,780" },
    ],
    totalLabel: "First month",
    total: "$2,780",
    terms: "Secured by Stripe. Card data never touches iKeep or EziQuotes. You can cancel any time with 30 days notice.",
  },
  postPay: {
    headline: ["You're in.", "Welcome to", "iKeep."],
    body: "We'll be in touch within 24 hours with onboarding details.",
    steps: [
      { stamp: "TODAY",    title: "Engagement letter",   body: "Lands in your inbox in the next hour." },
      { stamp: "DAY 1",    title: "Kickoff call booked", body: "Priya will reach out to schedule a 30-minute setup call." },
      { stamp: "DAY 1–10", title: "Books migration",     body: "We migrate everything across. You don't lift a finger." },
    ],
  },
  footer: { entity: "iKeep Bookkeeping Pty Ltd", abn: "ABN 84 142 016 778", loc: "North Sydney, NSW 2060" },
};

// ─── Map DB proposal to ProposalData ──────────────────────────────────────────
export function mapDbProposal(p: any): ProposalData {
  const structure = (p.structure ?? {}) as any;
  const lineItems: any[] = structure.lineItems ?? [];
  const totalCents: number = p.totalCents ?? 0;
  const subtotalCents: number = p.subtotalCents ?? totalCents;
  const taxCents: number = p.taxCents ?? 0;
  const currency: string = p.currency ?? "AUD";
  const taxLabel: string = p.account?.taxLabel ?? "GST";
  const taxBehaviour: string = p.account?.taxBehaviourDefault ?? "inclusive";
  const taxRate: number = parseFloat(p.account?.defaultTaxRate ?? "10");
  const fmtCents = (cents: number) => {
    const n = cents / 100;
    const sym = currency === "AUD" || currency === "NZD" || currency === "CAD" ? "$" : currency === "USD" ? "US$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency + " ";
    return sym + n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 !== 0 ? 2 : 0 });
  };
  const clientName: string = p.client?.name ?? "Client";
  const bizName: string = p.account?.businessName ?? "EziQuotes";
  const abn: string = p.account?.abn ? `ABN ${p.account.abn}` : "";
  const paymentLabel = p.paymentModel === "subscription" ? " / month" : "";
  const groups = lineItems
    .filter((li: any) => li.type !== "break")
    .map((li: any) => ({
      name: li.name,
      sub: fmtCents(li.unitPriceCents * (li.quantity ?? 1)) + paymentLabel,
      lines: [{
        name: li.name,
        help: li.description ?? "",
        units: li.quantity > 1 ? `${li.quantity}×` : "1×",
        sub: fmtCents(li.unitPriceCents * (li.quantity ?? 1)),
        badge: null as string | null,
      }],
    }));
  const recapLines = lineItems
    .filter((li: any) => li.type !== "break")
    .map((li: any) => ({ k: li.name, v: fmtCents(li.unitPriceCents * (li.quantity ?? 1)), total: false }));

  // Use editable structure fields if present, else fall back to defaults
  const editableWhy = structure.why ?? DEFAULT_PROPOSAL_DATA.why;
  const editableTeam = structure.team ?? DEFAULT_PROPOSAL_DATA.team;
  const editableNext = structure.next ?? DEFAULT_PROPOSAL_DATA.next;

  return {
    customer: bizName,
    customerEntity: bizName,
    customerABN: abn,
    customerLocation: "",
    strategist: bizName,
    strategistRole: `Prepared by ${bizName}`,
    recipient: clientName,
    scopeSummary: p.title ?? "Proposal",
    validUntil: p.expiresAt ? `Valid until ${new Date(p.expiresAt).toLocaleDateString()}` : "",
    hero: {
      eyebrow: `${bizName.toUpperCase()} · PROPOSAL · ${(p.slug ?? "").toUpperCase()}`,
      context: `Prepared for ${clientName} · From ${bizName}`,
      title: structure.heroTitle ?? ["your", "engagement", `with ${bizName}`],
      strap: structure.introCopy ?? `A proposal prepared for ${clientName}.`,
    },
    why: editableWhy,
    offer: {
      eyebrow: "02 · YOUR ENGAGEMENT",
      headline: p.title ?? "Your proposal.",
      lede: structure.offerLede ?? "",
      groups: groups.length > 0 ? groups : DEFAULT_PROPOSAL_DATA.offer.groups,
      summary: {
        pill: p.paymentModel === "subscription" ? "MONTHLY · FIXED" : p.paymentModel === "payment_plan" ? "PAYMENT PLAN" : "ONE-OFF",
        name: p.title ?? "Proposal",
        price: fmtCents(totalCents),
        priceSub: paymentLabel,
          formula: [
          ...recapLines,
          ...(taxBehaviour !== "exempt" && taxCents > 0 ? [
            { k: "Subtotal", v: fmtCents(subtotalCents), total: false },
            { k: `${taxLabel} ${taxRate}% (${taxBehaviour === "inclusive" ? "incl." : "excl."})`, v: fmtCents(taxCents), total: false },
          ] : []),
          { k: p.paymentModel === "subscription" ? "Monthly total" : "Total", v: fmtCents(totalCents), total: true },
        ],
      },
    },
    team: editableTeam,
    next: editableNext,
    accept: {
      eyebrow: "05 · ACCEPT AND PAY",
      headline: structure.acceptHeadline ?? "Confirm the engagement.",
      lede: structure.nextStepsCopy ?? (p.paymentModel === "subscription"
        ? "Your first month is paid up front. Subsequent months are billed on the 1st. Cancel any time with 30 days notice."
        : "Payment is due upon acceptance."),
      recap: [
        ...recapLines,
        ...(taxBehaviour !== "exempt" && taxCents > 0 ? [
          { k: "Subtotal", v: fmtCents(subtotalCents), total: false },
          { k: `${taxLabel} ${taxRate}%`, v: fmtCents(taxCents), total: false },
        ] : []),
      ],
      totalLabel: p.paymentModel === "subscription" ? "First month" : "Total",
      total: fmtCents(totalCents),
      terms: structure.termsText ?? `Secured by Stripe. Card data never touches ${bizName} or EziQuotes.${p.paymentModel === "subscription" ? " You can cancel any time with 30 days notice." : ""}`,
    },
    postPay: {
      headline: ["You're in.", "Welcome to", `${bizName}.`],
      body: "We'll be in touch within 24 hours with onboarding details. In the meantime, here's what to expect.",
      steps: DEFAULT_PROPOSAL_DATA.postPay.steps,
    },
    footer: { entity: bizName, abn, loc: "" },
  };
}

// ─── Micro icons ───────────────────────────────────────────────────────────────
function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function CheckSvg({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Logo ──────────────────────────────────────────────────────────────────────
function Logo({ customer, theme }: { customer: string; theme: string }) {
  const letterColor = theme === "digital" ? "#053D2A" : theme === "luxury" ? "var(--t-bg)" : "white";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: "var(--t-accent)", color: letterColor,
        display: "grid", placeItems: "center",
        fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em",
        flexShrink: 0,
      }}>{customer.charAt(0)}</div>
      <span className="logo-text">
        {theme === "digital"
          ? <>{customer}<span> · payments</span></>
          : customer}
      </span>
    </div>
  );
}

// ─── Hero headline (per-theme) ─────────────────────────────────────────────────
function HeroHeadline({ theme, title }: { theme: string; title: string[] }) {
  const [w1, w2, w3] = title;
  if (theme === "digital") {
    return (
      <h1 className="hero-headline">
        <span className="thin">{w1}</span><br/>
        {w2}<br/>
        <em>{w3}</em>
      </h1>
    );
  }
  if (theme === "luxury") {
    return (
      <h1 className="hero-headline">
        <em>{w1} {w2}</em><br/>
        {w3}
      </h1>
    );
  }
  return (
    <h1 className="hero-headline">
      {w1} <em>{w2}</em><br/>
      {w3}
    </h1>
  );
}

// ─── Section edit overlay (for builder mode) ──────────────────────────────────
function EditOverlay({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute", inset: 0, zIndex: 10,
        border: "2px dashed transparent",
        borderRadius: 4,
        cursor: "pointer",
        transition: "border-color 150ms, background 150ms",
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
        padding: 8,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(217,245,66,0.6)";
        (e.currentTarget as HTMLDivElement).style.background = "rgba(217,245,66,0.04)";
        const badge = e.currentTarget.querySelector(".edit-badge") as HTMLElement;
        if (badge) badge.style.opacity = "1";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
        const badge = e.currentTarget.querySelector(".edit-badge") as HTMLElement;
        if (badge) badge.style.opacity = "0";
      }}
    >
      <span className="edit-badge" style={{
        opacity: 0, transition: "opacity 150ms",
        background: "#D9F542", color: "#0a0a0a",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        padding: "3px 8px", borderRadius: 4,
        fontFamily: "var(--font-mono)",
        pointerEvents: "none",
      }}>EDIT {label}</span>
    </div>
  );
}

// ─── Main ProposalPage component ───────────────────────────────────────────────
export type SectionEditCallbacks = {
  onEditHero?: () => void;
  onEditWhy?: () => void;
  onEditOffer?: () => void;
  onEditTeam?: () => void;
  onEditNext?: () => void;
  onEditAccept?: () => void;
};

export function ProposalPage({
  theme,
  data,
  onAccept,
  accepted,
  engageRef,
  isDemo,
  paymentModel,
  editCallbacks,
  payElement,
}: {
  theme: string;
  data: ProposalData;
  onAccept: () => void;
  accepted: boolean;
  engageRef?: React.RefObject<HTMLDivElement | null>;
  isDemo?: boolean;
  slug?: string;
  paymentModel?: string;
  editCallbacks?: SectionEditCallbacks;
  payElement?: React.ReactNode;
}) {
  const [payMethod, setPayMethod] = useState<"card"|"apple"|"google"|"becs">("card");
  const tc = "theme-" + theme;
  const isEditMode = !!editCallbacks;

  const scrollToAccept = () => {
    document.getElementById("accept-section")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className={"proposal " + tc}>

      {/* Sticky nav */}
      <div className="prop-top">
        <Logo customer={data.customer} theme={theme} />
        <div className="ctx">
          <span className="lbl">Prepared for </span>
          <b>{data.recipient}</b>
        </div>
        <span className="pill">
          <span className="dot" />
          {accepted ? "Accepted" : "Sent · awaiting decision"}
        </span>
        {!isEditMode && !isProd && (
          <button
            className="btn-prop ghost secondary"
            style={{ padding: "8px 14px", border: "1px solid currentColor", opacity: 0.65 }}
            onClick={() => toast("Request changes — coming soon")}
          >
            Request changes
          </button>
        )}
        <button className="btn-prop primary" style={{ padding: "8px 16px" }} onClick={isEditMode ? undefined : scrollToAccept}>
          Accept &amp; pay <ArrowRight size={12} />
        </button>
      </div>

      {/* HERO */}
      <section className="prop-section hero" style={{ position: "relative" }}>
        {theme === "digital" && <div className="hero-atmosphere" />}
        <div className="sec-eyebrow">
          <span>{data.hero.eyebrow}</span>
          <span className="bar" />
        </div>
        <div className="hero-context">{data.hero.context}</div>
        <HeroHeadline theme={theme} title={data.hero.title} />
        <p className="hero-strap">{data.hero.strap}</p>
        {theme === "luxury" && <div className="hero-rule" />}
        <div className="meta-strip">
          <div className="item">
            <div className="k">Prepared by</div>
            <div className="v">{data.strategist}<br/><span style={{ fontSize: 12, opacity: 0.6 }}>{data.strategistRole}</span></div>
          </div>
          <div className="item">
            <div className="k">Scope</div>
            <div className="v">{data.scopeSummary}</div>
          </div>
          <div className="item">
            <div className="k">{paymentModel === "subscription" ? "Monthly" : "Total"}</div>
            <div className="v" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{data.offer.summary.price} {data.offer.summary.priceSub && <span style={{ fontSize: 14, opacity: 0.6 }}>{data.offer.summary.priceSub}</span>}</div>
          </div>
          <div className="item">
            <div className="k">Valid until</div>
            <div className="v">{data.validUntil || "Open offer"}</div>
          </div>
        </div>
        <EditOverlay label="COVER" onClick={editCallbacks?.onEditHero} />
      </section>

      {/* 01 WHY */}
      <section className="prop-section" style={{ position: "relative" }}>
        <div className="sec-eyebrow"><span>{data.why.eyebrow}</span><span className="bar" /></div>
        <h2>{data.why.headline}</h2>
        <p className="lede">{data.why.lede}</p>
        <div className="panel-3up" style={{ marginTop: 48 }}>
          {data.why.panels.map((p, i) => (
            <div className="panel" key={i}>
              <div className="num">{p.num}</div>
              <div className="tag-corner">{p.tag}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
        <EditOverlay label="WHY US" onClick={editCallbacks?.onEditWhy} />
      </section>

      {/* 02 OFFER */}
      <section className="prop-section" ref={engageRef as any} style={{ position: "relative" }}>
        <div className="sec-eyebrow"><span>{data.offer.eyebrow}</span><span className="bar" /></div>
        <h2>{data.offer.headline}</h2>
        <p className="lede">{data.offer.lede}</p>
        <div className="offer" style={{ marginTop: 48 }}>
          <div>
            {data.offer.groups.map((g, i) => (
              <div className="line-group" key={i}>
                <div className="gh">
                  <span className="name">{g.name}</span>
                  <span className="sub">{g.sub}</span>
                </div>
                {g.lines.map((l, j) => (
                  <div className="li" key={j}>
                    <div>
                      <div className="nm">
                        {l.name}
                        {l.badge && <span className="badge">{l.badge}</span>}
                      </div>
                      <div className="help">{l.help}</div>
                    </div>
                    <div className="units">{l.units}</div>
                    <div className="sub">{l.sub}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="offer-sum">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="nm">{data.offer.summary.pill}</span>
              <span style={{ fontSize: 11, opacity: 0.45, letterSpacing: "0.04em" }}>v2 · final</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{data.offer.summary.name}</div>
            <div className="price">
              {data.offer.summary.price}
              <span style={{ fontSize: 18, opacity: 0.45, marginLeft: 6 }}>{data.offer.summary.priceSub}</span>
            </div>
            <div className="formula">
              {data.offer.summary.formula.map((r, i) => (
                <div className={"row" + (r.total ? " total" : "")} key={i}>
                  <span>{r.k}</span><span>{r.v}</span>
                </div>
              ))}
            </div>
            <div className="ctas">
              <button className="btn-prop primary" onClick={isEditMode ? undefined : scrollToAccept}>
                Accept &amp; pay {data.offer.summary.price} <ArrowRight size={12} />
              </button>
              {!isEditMode && !isProd && (
                <button
                  className="btn-prop ghost"
                  style={{ border: "1px solid currentColor", opacity: 0.65 }}
                  onClick={() => toast("Request changes — coming soon")}
                >
                  Request changes
                </button>
              )}
            </div>
          </div>
        </div>
        <EditOverlay label="PRICING" onClick={editCallbacks?.onEditOffer} />
      </section>

      {/* 03 TEAM */}
      <section className="prop-section" style={{ position: "relative" }}>
        <div className="sec-eyebrow"><span>{data.team.eyebrow}</span><span className="bar" /></div>
        <h2>{data.team.headline}</h2>
        <div className="team-2up">
          {data.team.members.map((m, i) => (
            <div className="team-card" key={i}>
              <div className="avt">{m.initials}</div>
              <div className="info">
                <h4>{m.name}</h4>
                <div className="role">{m.role} · {m.loc}</div>
                <p>{m.bio}</p>
              </div>
            </div>
          ))}
        </div>
        <EditOverlay label="TEAM" onClick={editCallbacks?.onEditTeam} />
      </section>

      {/* 04 TIMELINE */}
      <section className="prop-section" style={{ position: "relative" }}>
        <div className="sec-eyebrow"><span>{data.next.eyebrow}</span><span className="bar" /></div>
        <h2>{data.next.headline}</h2>
        <div className="milestones">
          {data.next.milestones.map((m, i) => (
            <div className="milestone" key={i}>
              <div className="stamp">{m.stamp}</div>
              <h4>{m.title}</h4>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
        <EditOverlay label="TIMELINE" onClick={editCallbacks?.onEditNext} />
      </section>

      {/* 05 ACCEPT */}
      <section className="prop-section" id="accept-section" style={{ position: "relative" }}>
        <div className="sec-eyebrow"><span>{data.accept.eyebrow}</span><span className="bar" /></div>
        <h2>{data.accept.headline}</h2>
        <p className="lede">{data.accept.lede}</p>
        <div className="accept-grid">
          <div className="accept-summary">
            {data.accept.recap.map((r, i) => (
              <div className="li-recap" key={i}>
                <span>{r.k}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.v}</span>
              </div>
            ))}
            <div className="totalrow">
              <span>{data.accept.totalLabel}</span>
              <span>{data.accept.total}</span>
            </div>
            <div className="terms">
              <CheckSvg size={14} />
              <span>{data.accept.terms}</span>
            </div>
          </div>
          <div className="pay-element">
            {payElement ?? (isDemo ? (
              <>
                <div className="methods">
                  {(["card","apple","google","becs"] as const).map((m) => (
                    <button key={m} className={payMethod === m ? "on" : ""} onClick={() => setPayMethod(m)}>
                      {payMethod === m && <CheckSvg size={11} />}
                      {m === "card" ? "Card" : m === "apple" ? "Apple Pay" : m === "google" ? "Google Pay" : "BECS"}
                    </button>
                  ))}
                </div>
                <div className="fld-pay">
                  <label>Card number</label>
                  <div className="ip">4242 4242 4242 <span style={{ opacity: 0.35 }}>____</span></div>
                </div>
                <div className="grid2">
                  <div className="fld-pay"><label>Expiry</label><div className="ip">12 / 28</div></div>
                  <div className="fld-pay"><label>CVC</label><div className="ip">•••</div></div>
                </div>
                <div className="fld-pay">
                  <label>Name on card</label>
                  <div className="ip">{data.recipient}</div>
                </div>
                <button className="btn-prop primary" style={{ marginTop: 8 }} onClick={onAccept}>
                  Confirm &amp; pay {data.accept.total} <ArrowRight size={12} />
                </button>
                <div className="footnote">
                  <CheckSvg size={12} />
                  <span>Secured by Stripe · 256-bit TLS · PCI DSS Level 1</span>
                </div>
              </>
            ) : (
              <div style={{ padding: "20px", textAlign: "center", opacity: 0.5, fontSize: 13 }}>
                Payment form loads here
              </div>
            ))}
          </div>
        </div>
        <EditOverlay label="ACCEPT" onClick={editCallbacks?.onEditAccept} />
      </section>

      {/* Footer */}
      <div className="prop-footer">
        <div>{data.footer.entity} · {data.footer.abn} · {data.footer.loc}</div>
        <div className="links">
          <a href="https://ezyquotes.com/terms" target="_blank" rel="noopener noreferrer">Terms</a>
          <a href="https://ezyquotes.com/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
          <a href="#">Contact</a>
          <a href="https://ezyquotes.com" target="_blank" rel="noopener noreferrer" style={{ opacity: 0.35 }}>Powered by EziQuotes</a>
        </div>
      </div>
    </div>
  );
}

// ─── Post-pay success screen ───────────────────────────────────────────────────
export function ProposalSuccess({
  theme,
  data,
  thankYouConfig,
  brandKit,
}: {
  theme: string;
  data: ProposalData;
  thankYouConfig?: { headline: string; strap: string; steps: Array<{ stamp: string; title: string; body: string }> } | null;
  brandKit?: { primaryColor?: string | null; accentColor?: string | null; darkColor?: string | null; lightColor?: string | null; headingFont?: string | null; bodyFont?: string | null } | null;
}) {
  // Resolve colours — prefer brand kit, fall back to theme CSS vars
  const bgColor = brandKit?.darkColor ?? (theme === "digital" ? "#0A0A0A" : theme === "luxury" ? "#FAFAF7" : "#1A1A18");
  const accentColor = brandKit?.accentColor ?? (theme === "digital" ? "#65F5C9" : theme === "luxury" ? "#C0392B" : "#D9F542");
  const textColor = brandKit?.lightColor ?? (theme === "digital" ? "#FAFAF9" : theme === "luxury" ? "#1A1A18" : "#FAFAF9");
  const checkIconColor = bgColor;

  // Resolve content — prefer saved thankYouConfig, fall back to proposal postPay data
  const headline = thankYouConfig?.headline ?? data.postPay.headline.join(" ");
  const strap = thankYouConfig?.strap ?? data.postPay.body;
  const steps = thankYouConfig?.steps ?? data.postPay.steps;

  const headingFont = brandKit?.headingFont ?? "Inter Tight";
  const bodyFont = brandKit?.bodyFont ?? "Inter";

  return (
    <div style={{ background: bgColor, color: textColor, minHeight: "100vh", fontFamily: `'${bodyFont}', sans-serif` }}>
      {/* Top bar */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 24px",
        background: bgColor,
        borderBottom: `1px solid ${textColor}18`,
        backdropFilter: "blur(12px)",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: accentColor, color: checkIconColor,
          display: "grid", placeItems: "center",
          fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em",
          fontFamily: `'${headingFont}', sans-serif`,
        }}>{data.customer.charAt(0).toUpperCase()}</div>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em", fontFamily: `'${headingFont}', sans-serif` }}>{data.customer}</span>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", opacity: 0.5 }}>Receipt for</div>
        <b style={{ fontSize: 13, fontWeight: 700 }}>{data.recipient}</b>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: `${accentColor}22`, color: accentColor,
          borderRadius: 999, padding: "4px 12px",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: accentColor, display: "inline-block" }} />
          PAID
        </span>
      </div>

      {/* Hero */}
      <section style={{ padding: "80px 24px 64px", textAlign: "center", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <div style={{
            width: 88, height: 88, borderRadius: "50%",
            background: accentColor, display: "grid", placeItems: "center",
            color: checkIconColor,
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", opacity: 0.5 }}>PAYMENT CONFIRMED · {data.accept.total}</div>
          <h1 style={{
            fontSize: "clamp(48px, 8vw, 88px)",
            fontWeight: 900,
            lineHeight: 1.0,
            letterSpacing: "-0.03em",
            margin: 0,
            fontFamily: `'${headingFont}', sans-serif`,
            color: textColor,
          }}>
            {headline}
          </h1>
          <p style={{ maxWidth: 580, fontSize: 18, lineHeight: 1.6, opacity: 0.7, margin: 0 }}>{strap}</p>
        </div>
      </section>

      {/* Steps */}
      {steps.length > 0 && (
        <section style={{ padding: "0 24px 64px", maxWidth: 960, margin: "0 auto" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(steps.length, 3)}, 1fr)`,
            gap: 16,
          }}>
            {steps.map((s, i) => (
              <div key={i} style={{
                background: `${textColor}08`,
                border: `1px solid ${textColor}12`,
                borderRadius: 12,
                padding: "28px 24px",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: accentColor, marginBottom: 12 }}>{s.stamp}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", fontFamily: `'${headingFont}', sans-serif` }}>{s.title}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.65, margin: 0 }}>{s.body}</p>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 48 }}>
            <button style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: accentColor, color: checkIconColor,
              border: "none", borderRadius: 8,
              padding: "14px 24px", fontSize: 15, fontWeight: 700,
              cursor: "pointer", fontFamily: `'${headingFont}', sans-serif`,
            }}>
              Open your {data.customer} portal <ArrowRight size={12} />
            </button>
            <button style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "transparent", color: textColor,
              border: `1px solid ${textColor}30`, borderRadius: 8,
              padding: "14px 24px", fontSize: 15, fontWeight: 600,
              cursor: "pointer", opacity: 0.7,
            }}>
              Email me a copy
            </button>
          </div>
        </section>
      )}

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${textColor}12`,
        padding: "20px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 12,
        fontSize: 12, opacity: 0.45,
      }}>
        <div>{data.footer.entity}{data.footer.abn ? ` · ${data.footer.abn}` : ""}</div>
        <div style={{ display: "flex", gap: 16 }}>
          <a href="#" style={{ color: "inherit", textDecoration: "none" }}>Receipt PDF</a>
          <a href="https://ezyquotes.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>Terms</a>
          <a href="https://ezyquotes.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>Privacy</a>
          <a href="https://ezyquotes.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", opacity: 0.5 }}>Powered by EziQuotes</a>
        </div>
      </div>
    </div>
  );
}

