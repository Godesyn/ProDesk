/**
 * /terms — EziQuotes Terms of Service
 * Standalone public page (no auth required)
 */
import { Link } from "wouter";

const EFFECTIVE_DATE = "1 June 2025";
const COMPANY = "EziQuotes Pty Ltd (ABN 12 345 678 901)";
const CONTACT_EMAIL = "legal@ezyquotes.com";

interface SectionProps {
  num: string;
  title: string;
  children: React.ReactNode;
}

function Section({ num, title, children }: SectionProps) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1a1a1a", marginBottom: 10, display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ color: "#888", fontWeight: 500, minWidth: 28 }}>{num}.</span>
        {title}
      </h2>
      <div style={{ paddingLeft: 38, color: "#444", lineHeight: 1.75, fontSize: 14.5 }}>
        {children}
      </div>
    </section>
  );
}

export default function Terms() {
  return (
    <div style={{ minHeight: "100vh", background: "#fafaf9" }}>
      {/* Header */}
      <div style={{ background: "#0f0f0f", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/">
          <img src="/logo-wordmark.svg" alt="EziQuotes" style={{ height: 24, filter: "brightness(0) invert(1)", cursor: "pointer" }} />
        </Link>
        <Link href="/">
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, cursor: "pointer" }}>Back to home</span>
        </Link>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px 80px" }}>
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: "inline-block", background: "#D9F542", color: "#0f0f0f", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", padding: "4px 10px", borderRadius: 4, marginBottom: 16, textTransform: "uppercase" }}>
            Legal
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: "#0f0f0f", margin: "0 0 12px", letterSpacing: "-0.03em" }}>
            Terms of Service
          </h1>
          <p style={{ color: "#666", fontSize: 14, margin: 0 }}>
            Effective date: {EFFECTIVE_DATE} &nbsp;&middot;&nbsp; {COMPANY}
          </p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e8e8e5", borderRadius: 12, padding: "20px 24px", marginBottom: 40, fontSize: 14, color: "#444", lineHeight: 1.75 }}>
          Please read these Terms of Service carefully before using EziQuotes. By creating an account or using any part of the platform, you agree to be bound by these terms. If you do not agree, do not use the platform.
        </div>

        <Section num="1" title="Definitions">
          <p><strong>"Platform"</strong> means the EziQuotes software-as-a-service, including all web interfaces, APIs, and associated services operated by {COMPANY}.</p>
          <p style={{ marginTop: 8 }}><strong>"Vendor"</strong> means a business or individual who creates an account to send proposals and collect payments.</p>
          <p style={{ marginTop: 8 }}><strong>"Payer"</strong> means a person or entity who receives a proposal and makes a payment through the Platform.</p>
          <p style={{ marginTop: 8 }}><strong>"Proposal"</strong> means a payment request created by a Vendor and presented to a Payer through the Platform.</p>
          <p style={{ marginTop: 8 }}><strong>"Transaction"</strong> means any payment processed through the Platform between a Vendor and a Payer.</p>
        </Section>

        <Section num="2" title="Eligibility and Account Registration">
          <p>You must be at least 18 years old and have the legal capacity to enter into contracts to use the Platform. By registering, you represent that all information you provide is accurate and current.</p>
          <p style={{ marginTop: 8 }}>You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You must notify us immediately at <a href={"mailto:" + CONTACT_EMAIL} style={{ color: "#0f0f0f", fontWeight: 600 }}>{CONTACT_EMAIL}</a> if you suspect any unauthorised access.</p>
          <p style={{ marginTop: 8 }}>We reserve the right to refuse registration or suspend accounts at our sole discretion, including for violation of these Terms or applicable law.</p>
        </Section>

        <Section num="3" title="Platform Services">
          <p>EziQuotes provides tools for Vendors to create and send payment proposals, configure payment models (one-off, subscription, payment plan, dual-option), manage payer lifecycle events, receive webhook notifications, and access payment analytics.</p>
          <p style={{ marginTop: 8 }}>Payment processing is provided by Stripe, Inc. and is subject to Stripe's terms of service. EziQuotes is not a bank, payment institution, or financial services provider.</p>
        </Section>

        <Section num="4" title="Fees and Charges">
          <p>EziQuotes charges a platform fee on each Transaction. The current fee rate is displayed on the pricing page and within your account settings. Fees are deducted from the Transaction amount before disbursement to the Vendor.</p>
          <p style={{ marginTop: 8 }}>We reserve the right to change our fee structure with 30 days' written notice. Continued use of the Platform after the notice period constitutes acceptance of the new fees.</p>
          <p style={{ marginTop: 8 }}>You are responsible for any taxes applicable to your use of the Platform, including GST where applicable under Australian law.</p>
        </Section>

        <Section num="5" title="Payment Processing and Stripe">
          <p>All payment processing is handled by Stripe, Inc. By using the Platform, you also agree to Stripe's Connected Account Agreement and Privacy Policy. You authorise EziQuotes to instruct Stripe to process payments on your behalf.</p>
          <p style={{ marginTop: 8 }}>EziQuotes does not store card numbers, CVV codes, or other sensitive payment credentials. All such data is handled exclusively by Stripe in accordance with PCI DSS requirements.</p>
          <p style={{ marginTop: 8 }}>Refunds and disputes are subject to Stripe's policies. EziQuotes will cooperate with dispute resolution processes but is not liable for the outcome of payment disputes between Vendors and Payers.</p>
        </Section>

        <Section num="6" title="Vendor Obligations">
          <p>As a Vendor, you agree to only send proposals for legitimate goods and services, accurately describe the goods or services in each proposal, honour the terms of accepted proposals, comply with all applicable laws including consumer protection laws, and not use the Platform for any unlawful purpose.</p>
          <p style={{ marginTop: 8 }}>You are solely responsible for the goods and services described in your proposals and for resolving any disputes with Payers.</p>
        </Section>

        <Section num="7" title="Prohibited Uses">
          <p>You must not use the Platform to process payments for illegal goods or services, engage in fraud or money laundering, violate export control or sanctions laws, harass or harm any person, transmit malware or spam, attempt unauthorised access to any system, or reverse engineer any part of the Platform.</p>
        </Section>

        <Section num="8" title="Intellectual Property">
          <p>The Platform, including all software, design, trademarks, and content, is owned by or licensed to {COMPANY}. You are granted a limited, non-exclusive, non-transferable licence to use the Platform for its intended purpose.</p>
          <p style={{ marginTop: 8 }}>You retain ownership of all content you upload to the Platform. You grant EziQuotes a limited licence to use this content solely to provide the Platform services. You must not use our trademarks or brand assets without prior written consent.</p>
        </Section>

        <Section num="9" title="Data and Privacy">
          <p>Our collection and use of personal information is governed by our Privacy Policy, incorporated into these Terms by reference. You are responsible for obtaining all necessary consents from Payers before submitting their personal information to the Platform, and for complying with all applicable privacy laws including the Australian Privacy Act 1988 (Cth).</p>
        </Section>

        <Section num="10" title="Subscription and Payment Plan Terms">
          <p>Where a Vendor configures a subscription or payment plan, the Vendor is responsible for configuring accurate billing terms. Payer lifecycle actions (pause, cancel, defer, early exit) are subject to the permissions configured by the Vendor. EziQuotes will process scheduled payments in accordance with the agreed schedule, subject to Stripe's availability. The Vendor is responsible for communicating payment terms clearly to Payers.</p>
        </Section>

        <Section num="11" title="Limitation of Liability">
          <p>To the maximum extent permitted by law, EziQuotes and its directors, officers, employees, and agents will not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform.</p>
          <p style={{ marginTop: 8 }}>Our total liability to you for any claim will not exceed the total fees paid by you to EziQuotes in the 12 months preceding the claim. Nothing in these Terms limits liability for death or personal injury caused by negligence, fraud, or any other liability that cannot be excluded by law.</p>
        </Section>

        <Section num="12" title="Indemnification">
          <p>You agree to indemnify and hold harmless EziQuotes and its affiliates from any claims, damages, losses, liabilities, costs, and expenses arising from your use of the Platform, your breach of these Terms, your violation of any applicable law, any dispute between you and a Payer, or any content you submit to the Platform.</p>
        </Section>

        <Section num="13" title="Termination">
          <p>You may terminate your account at any time by contacting us at <a href={"mailto:" + CONTACT_EMAIL} style={{ color: "#0f0f0f", fontWeight: 600 }}>{CONTACT_EMAIL}</a>. We may suspend or terminate your account immediately if you breach these Terms or engage in prohibited conduct. Termination does not affect any outstanding payment obligations or Transactions initiated before termination.</p>
        </Section>

        <Section num="14" title="Governing Law and Disputes">
          <p>These Terms are governed by the laws of New South Wales, Australia. You agree to submit to the exclusive jurisdiction of the courts of New South Wales for any dispute arising from these Terms. Before commencing legal proceedings, you agree to attempt to resolve any dispute by contacting us and allowing 30 days for resolution.</p>
        </Section>

        <Section num="15" title="Changes to These Terms">
          <p>We may update these Terms from time to time. We will notify you of material changes by email or by displaying a notice in the Platform. Your continued use of the Platform after the effective date of the updated Terms constitutes acceptance.</p>
          <p style={{ marginTop: 8 }}>For questions about these Terms, contact us at <a href={"mailto:" + CONTACT_EMAIL} style={{ color: "#0f0f0f", fontWeight: 600 }}>{CONTACT_EMAIL}</a>.</p>
        </Section>

        <div style={{ borderTop: "1px solid #e8e8e5", paddingTop: 24, marginTop: 48, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ color: "#999", fontSize: 12, margin: 0 }}>
            &copy; {new Date().getFullYear()} {COMPANY}. All rights reserved.
          </p>
          <Link href="/">
            <span style={{ color: "#666", fontSize: 12, cursor: "pointer" }}>Back to EziQuotes</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
