# Prodesk — Data Model Overview

**Audience:** Executive / Business Analyst
**Purpose:** A plain-language summary of the core "objects" the Prodesk platform manages, the key information each one holds, and the role it plays in the business.

Prodesk is a B2B marketplace and project-delivery platform connecting three types of customers — **Brands** (clients who need work done), **Agencies** (who sell and deliver services), and **Contractors** (freelancers who do production work for agencies). The data model below is the backbone that supports the entire sales-to-delivery-to-payout lifecycle.

---

## 1. People & Identity

### User

**What it is:** Every person with a login — a brand owner, agency owner, contractor, staff member, or platform admin.
**Key information:** Name, email, role, profile photo, which organizations they belong to, their currently active context (which brand/agency they're "acting as"), payout details (bank/Stripe/PayPal), and who referred them.
**Business function:** The single source of truth for who can access the platform and what they're allowed to do. Drives personalization, billing identity, and referral/commission tracking.

### Contractor

**What it is:** The professional profile of a freelancer.
**Key information:** Bio, skills, hourly rate, availability, portfolio, work experience, résumé, and links (website, LinkedIn).
**Business function:** Lets agencies discover and evaluate freelance talent, and powers the contractor marketplace.

---

## 2. Organizations

### Brand

**What it is:** A client business that buys services.
**Key information:** Business and legal name, contact details, industry, brand guidelines (logos, colours, typography, tone of voice, messaging), connected agencies, and favourite services.
**Business function:** The "buyer" account. Holds everything an agency needs to serve the client consistently, and anchors all of the client's projects, proposals, and purchases.

### Agency

**What it is:** A service provider business that sells to brands and delivers work.
**Key information:** Business profile, disciplines/services offered, verification status, subdomain/username (for white-label storefronts), commission settings, designated staff roles (briefing, allocation, approval), bank/payout setup, and social links.
**Business function:** The "seller" account. Controls the agency's catalog, team, workflow rules, commission splits, and earnings. Supports white-labeling (each agency can have its own branded subdomain).

---

## 3. Team & Access

### Staff

**What it is:** A team member inside a brand or agency (or an invited contractor link), with a defined set of permissions.
**Key information:** Which organization they belong to, their display name, granular permissions (e.g. can manage clients, can send proposals, can view invoices, can chat with brands), and invitation status (pending / active / removed).
**Business function:** Enables organizations to delegate work safely with fine-grained access control — the foundation of "who can see and do what" within each company.

### Memberships (User ↔ Brand / User ↔ Agency)

**What it is:** The links recording which people belong to which organizations.
**Business function:** Lets one person participate in multiple businesses and switch between them, supporting multi-business owners and shared staff.

---

## 4. Relationships (Connections)

### Brand–Agency Connection (and Connection Requests)

**What it is:** A confirmed working relationship between a brand and an agency, plus the pending invitations that lead to one.
**Business function:** Gates collaboration — only connected brands and agencies can exchange proposals, run projects, and message each other. Connection requests manage the "handshake" before work begins.

### Agency–Contractor Connection

**What it is:** The relationship between an agency and a freelancer, with a status (invited, applied, active, rejected, revoked).
**Business function:** Controls which contractors an agency can assign work to, and tracks the full invite/apply/approve lifecycle.

---

## 5. Catalog (What Agencies Sell)

### Service

**What it is:** A single offering an agency sells (e.g. "Logo Design", "Monthly Social Media").
**Key information:** Pricing (one-off or recurring, upfront and delivery fees), type, disciplines, media (image/video), purchase options (buy now, book a meeting, request a proposal), variants/add-ons, custom intake fields, delivery frequency, and the commission split across roles.
**Business function:** The fundamental unit of revenue. Defines what can be bought, how it's priced and billed, who gets paid, and how the resulting work is configured.

### Package

**What it is:** A bundle of multiple services sold together.
**Business function:** Lets agencies sell curated bundles, increasing deal size and simplifying buyer choice.

---

## 6. Sales

### Proposal

**What it is:** A formal quote an agency sends to a brand.
**Key information:** Line items, optional phases/stages, attached documents, a comment thread between parties, totals, terms, validity period, and a lifecycle status (draft → sent → viewed → accepted/rejected/changes-requested → paid).
**Business function:** The core sales artifact. Tracks every deal from draft through negotiation to acceptance, captures change requests, and converts directly into a purchase and live projects when paid.

---

## 7. Transactions

### Purchase

**What it is:** A record of a completed (or in-progress) transaction — either a direct marketplace buy or an accepted proposal.
**Key information:** Items bought, the brand/buyer, payment status, selected payment plan, commission breakdown (agency, affiliate, platform, sales), linked projects, payment counts (for recurring billing), and Stripe references.
**Business function:** The financial system of record for what was sold. Triggers project creation, drives recurring billing, and feeds the commission and payout engine.

---

## 8. Delivery

### Project

**What it is:** A unit of work being delivered, created from a purchase.
**Key information:** Title, brief and brief documents, deadline, workflow stage (client brief → brief → allocate → production → internal approval → revision → client approval → completed), who's assigned (staff or contractor), contractor budget, deliverables, revision history, internal notes, recurring-cycle settings, and the commission split.
**Business function:** The operational heart of the platform. Moves work through a defined production pipeline, manages handoffs between agency/contractor/client, tracks deliverables and approvals, and handles recurring work cycles.

---

## 9. Finance

### Invoice

**What it is:** A billing document tied to a purchase cycle, between two parties.
**Key information:** The "from" and "to" parties, line items, billing cycle number, commission type, and status.
**Business function:** Provides the formal financial paper trail for each billing event and underpins reconciliation and reporting.

### Payout

**What it is:** Money owed to a beneficiary (agency, contractor, staff, or the platform).
**Key information:** Amount, currency, who's being paid, the source of the earnings, a detailed breakdown by project/role, payout method (Stripe, PayPal, Wise/wire), and status through the payment pipeline.
**Business function:** Powers the earnings and disbursement engine — how everyone gets paid, across multiple payout providers, with full traceability.

---

## 10. Communication

### Chat Thread & Message

**What it is:** Conversations (threads) and the individual messages within them.
**Key information (thread):** Participants, type (group, private, personal, platform-admin), the brand/agency context, last message, and per-person unread counts. **(message):** Sender, content, attachments (image/video/document), read receipts, and optional links to a project.
**Business function:** Keeps all brand–agency–contractor communication in one place, organized by relationship and project, with unread tracking and email digests.

---

## 11. Productivity

### Task

**What it is:** An actionable or informational item in a user's task board (inbox / to-do / completed / archived).
**Key information:** Type (e.g. staff invitation, proposal pending, approval needed, connection request), assignee, related entity (project/proposal), and visibility.
**Business function:** The platform's notification and action-tracking system — surfaces what each user needs to act on and routes workflow steps to the right people.

---

## 12. Content & Resources

### File & Folder

**What it is:** Uploaded assets (logos, briefs, deliverables, documents) and the folder structure that organizes them.
**Business function:** A shared document locker for each brand/agency relationship, with privacy controls and project linkage.

### Resource

**What it is:** A shared template or asset library item, provided by the platform or an agency.
**Business function:** Distributes reusable templates and materials to agencies and brands.

---

## 13. Scheduling

### Meeting

**What it is:** A booked meeting between a brand user and an agency contact, often tied to a service.
**Key information:** Participants, time window, status, and Google Calendar / video-call links.
**Business function:** Powers "book a meeting" offerings and integrates with Google Calendar for scheduling.

---

## 14. Platform Configuration

### Global Settings

**What it is:** Platform-wide defaults controlled by administrators.
**Key information:** Default commission rates (platform, affiliate, agency, sales), default payment plans, and the master lists of disciplines and services.
**Business function:** Central control panel for the economics and taxonomy of the whole marketplace.

---

## How it fits together (the lifecycle)

1. A **Brand** and an **Agency** form a **Connection**.
2. The Agency builds its **Catalog** (Services & Packages).
3. The Agency sends a **Proposal** (or the Brand buys directly in the marketplace).
4. Acceptance/checkout creates a **Purchase**.
5. The Purchase spawns **Projects**, which move through the delivery pipeline — often with a **Contractor** assigned.
6. Communication happens in **Chat**; action items appear as **Tasks**.
7. Completed work generates **Invoices** and **Payouts** to everyone owed.
8. **Global Settings** govern commissions and taxonomy throughout.

---

_This document describes the data model of the platform rebuild (React + tRPC + Drizzle + Supabase). It reflects functional parity with the existing application._
