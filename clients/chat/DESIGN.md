# CHAT — Design Spec

The Prodesk messenger (`clients/chat`, port 5184, `chat.prodesk.com`).

This document is the complete specification. It is the living spec for the
frontend in this directory — when the two disagree, this file is what the code
should be brought back to.

---

## 1 · What this is, and what it is not

Prodesk already has chat, but it is **workspace chat**: every thread is derived
from an org relationship — a brand↔agency connection, a staff grant, a contractor
joining. You cannot start a conversation. Threads are created *for* you by events.

This is the other thing: a **person-to-person messenger**. Any Prodesk account
finds any other by email address, messages them, or spins up a group with
arbitrary members. It sits **beside** workspace chat and never appears in it —
see §7 for the exact mechanism, which is the highest-risk part of the build.

It is **ungated on purpose**. Every other satellite is reached through a staff
permission because every other satellite is a tool an agency buys. Gating a
messenger on a permission is gating the telephone.

### Where this sits in the market

| Product | What it gets right | What it leaves open |
| --- | --- | --- |
| iMessage | The bar for feel. Instant, quiet, native. | No organisation at all. One recency list forever. |
| WhatsApp | Ubiquity, delivery, groups that survive 200 people. | Chronological soup. Every thread equally loud. |
| Telegram | Speed, breadth, genuinely good search. | Visually noisy; features arrive faster than shape. |
| Slack / Discord | Built for many-to-many, threading, presence. | Exhausting. The resting emotion is *behind*. |
| Signal | The security model, and the restraint. | Deliberately plain; no organisation either. |

**The gap.** Every one of them stacks threads by recency and paints unread badges
on all of them. Everything looks equally urgent, so nothing is. Nobody has built
an inbox that knows the difference between *a message arrived* and *someone is
waiting on you* — even though every messaging app already holds the one fact that
decides it: who spoke last.

---

## 2 · Two theses

### Product — the inbox is ordered by what you owe, not by what arrived

| Section | Meaning |
| --- | --- |
| **Owed** | They spoke last. The ball is in your court. |
| **Waiting** | You spoke last. Nothing for you to do. |
| **Settled** | Read, answered, muted, or archived. |

Computed from `lastMessage.senderId` vs me plus read state. **Zero new columns.**
Owed is the only section in any messenger that can be empty and feel like a
reward. That reordering is the product, and it costs one `ORDER BY`.

### Design — chat is not a document, it is a room

Logo Studio and KEYMASTR are ink-on-paper: artifacts, specimen frames, blueprint
grids, a warm Bone stage. A messenger is the opposite. It is air and light, it is
used at night and one-handed and hundreds of times a day, and the content is not
something you produced — it is other people.

So this is the one app in the suite that is **dark-first**, and it drops every
paper motif. Kinship with its siblings is carried by the type system and the
rationed accent, not by the ground.

### The pigment doctrine, third verse

| App | Pigment means |
| --- | --- |
| Logo Studio | **commitment** — a colourway chosen, a concept picked |
| KEYMASTR | **exposure** — something is open right now |
| **Chat** | **presence** — **someone is here** |

Pigment appears on an online bead, a typing pulse, the Owed marker, the send
control the moment it holds something to send. It drains to ink when the moment
passes. At rest the entire app is achromatic. There is no second colour —
`--danger` exists only inside a confirm dialog, because a messenger has no
irreversible state worth colouring on a resting surface.

---

## 3 · Materials

### Type — three faces, three jobs, and never each other's

| Role | Face | Where |
| --- | --- | --- |
| Speech | **Instrument Sans** 400/500 · 15.5px / 1.55 · `-0.003em` (`.speech`) | message bodies, and ONLY message bodies |
| UI + display | **Inter Tight** 500/700/800, tight tracking | names, headers, buttons, nav, counts |
| Data | **JetBrains Mono** 11px / `0.08em` / uppercase (`.spec`) | timestamps, dates, sizes, member counts, receipts |
| Editorial | **Instrument Serif** italic (`.quill`) | exactly one line per empty state. Nowhere else. |

The most consequential and least-considered decision in this category is the
*message body face*. Every competitor sets human speech in the same font as its
buttons. Instrument Sans is from the same superfamily as the house's Instrument
Serif — a family decision, not an import — and speaker names in Inter Tight
against speech in Instrument Sans reads like an interview transcript, which is
what a group conversation actually is.

### Surface — two grounds, and Night is the default

```
NIGHT (default)                        DAY
--room     #101317  the ground         var(--color-paper)   accent-tinted, white-labelled
--room-2   #171B21  raised surfaces    #FFFFFF
--room-3   #1E232A  hover / input      var(--color-inset)
--voice    #EDEEF0  speech ink         var(--color-ink-100)
--voice-2  #9AA1AB  metadata           var(--color-ink-60)
--voice-3  #5F6772  dividers, ghosts   var(--color-ink-40)
--wire     rgba(255,255,255,.08)       rgba(14,14,12,.08)
--wire-2   rgba(255,255,255,.14)       rgba(14,14,12,.14)
--live     var(--color-accent)  ← never overridden, runtime white-labelled
```

`--room` is cool graphite, not black: pure black smears on OLED during momentum
scroll, and this is the most-scrolled surface in the suite. `--voice` is not pure
white — glare at 2am is a real defect.

The ground is a `data-ground` attribute on `<html>`, painted **before React
mounts** (`lib/ground.ts` + `main.tsx`) so there is never a flash. It is a device
preference, not an account one: the same person wants Day on a desk monitor at
10am and Night on a phone at 11pm, and syncing the two fights them.

Everything bespoke is scoped under `.cx-ui`, so the shared auth / onboarding /
verify-email pages keep the stock theme untouched — the same firewall `.logo-ui`
and `.km-ui` use.

### Motion — three named motions, and nothing else

| Name | What | Timing |
| --- | --- | --- |
| `settle` | a message arriving: 6px rise + fade. Never a bounce, never a scale. | 180ms `--ease-click` |
| `slide` | a read bead travelling down the spine | 400ms `cubic-bezier(.4,0,.2,1)` |
| `breathe` | the typing pulse on a bead | 1400ms loop |

Under `prefers-reduced-motion` the beads still **move** — their position is
information, not decoration. What goes away is the travel, the pulse and the
entrance.

---

## 4 · Signature element — **the Spine**

One hairline runs down the transcript at `--cx-gutter` (56px). Every message hangs
off it. It carries four things at once:

**1 · Read beads.** Each participant's 16px avatar is docked *on* the wire at the
vertical position of the last message they have read. When someone reads, their
bead slides down. In a DM there is one bead; in a group of eight there are seven,
clustering where people are together and strung out where they are not. **You can
see the whole group's position in the conversation as beads on a wire.** WhatsApp
gives you two ticks, Slack gives you nothing, and group read state is invisible in
every product on the market. This is the thing chat.prodesk.com is remembered for.

> **Note (current code).** The transcript now uses bubbles, matching the workspace
> `MessagePanel` — so the wire itself is gone and the beads sit inline under the
> message they point at. The read-bead idea survived the change; the drawn spine
> did not. The logo went with it: the mark is now `ChatMark` (a ring with two
> wedges meeting at its centre — two turns of a conversation closed into a
> circle), shipped as `public/chat.svg` for the tab icon and as a `currentColor`
> component in `primitives.tsx`. §4 and §5 below still describe the original
> bubble-less design and are kept as the record of why the beads exist.

**2 · Presence.** Filled with a pigment ring = online (from the existing
`usePresenceHeartbeat`); hollow and dimmed = away.

**3 · Typing.** The bead detaches 4px from the wire and breathes in `--live`. No
"…" row at the bottom of the transcript, so typing can never shift the layout or
fight the scroll anchor. Typing is a property of a *person*, so it renders on that
person.

**4 · Ownership.** Beside your own runs the wire thickens from 1px `--wire` to 2px
solid `--voice-3`.

**Implementation note.** The wire is a per-row `::before` segment, not one
absolutely positioned full-height line: the transcript is virtualised, and a
single line would have to track the scroller's total height and would tear on
every remeasure. Contiguous rows join their segments into one continuous wire.

---

## 5 · The transcript — no bubbles for speech

**This is the one real risk in the design, and it is justified.**

Text messages are a left-aligned transcript: speaker name (Inter Tight 700,
12.5px), speech below it (`.speech`, measure capped at 68ch), mono timestamp in
the right gutter. No bubble, no tail, no opposing sides.

Bubbles are iMessage nostalgia, and they fail exactly where messaging is hardest:

- At five or more participants sidedness encodes nothing — everyone else is
  "left" — so products fall back to colour-coding names, which collapses.
- Long messages inside bubbles wrap into narrow ragged columns.
- A single column is faster to read than a zig-zag.

**Objects still get containers.** Images, video, files, link previews, voice notes
and quoted replies render as `.cx-card` on `--room-2`. They are objects, not
speech, and containing them is correct.

*Fallback if this tests badly: keep the transcript and right-align only your own
name+timestamp row. Do not reintroduce bubbles — it breaks the spine.*

**Runs.** Consecutive messages from one person within 4 minutes collapse: the name
and avatar print once, subsequent lines hang at the same indent with the timestamp
revealed on hover.

**Day rules.** A full-width hairline crossing the wire with a centred mono label —
`TODAY`, `YESTERDAY`, `TUE 11 AUG`.

**The unread divider.** A `--live` hairline labelled `NEW` at the first message
newer than your `lastReadMessageId`. It does **not** vanish the instant you arrive
— it survives until it scrolls out of view, so you can see where you stopped.
Opening a thread with unread messages anchors here, not at the bottom.

---

## 6 · Information architecture

```
/                 Inbox        Owed · Waiting · Settled
/t/:threadId      Room         the conversation
/requests         Requests     first messages from people you don't know
/search           Search       across every thread (⌘K)
/settings         Settings     appearance · notifications · privacy · blocked
/profile          Account      native — your face, your name, your password
/support[/:id]    Support      native screen, shared data layer

?v=<messageId>&i=<n>           the media viewer — a URL param, so Back closes it
```

**Panel groups** (`AppShell`, `identity` slot — user-level, no brand dropdown):

```
            Inbox · Requests · Search
Account     Settings
tail        Support
identity    Profile
```

The rail **starts collapsed** (72px, icon-only), seeded once in `main.tsx`. A
messenger's whole navigation is four rows and the horizontal budget belongs to the
conversation. Unlike Logo Studio and KEYMASTR the panel is **not** permanently
dark — `.psp-theme-chat` reads `--room` from `.cx-ui`, so it goes light in Day
with the rest of the app. A black slab down the side of a light room looks like
two applications stapled together.

---

## 7 · The rest of the spec

Screen-by-screen interaction detail (§1.7 of the build plan), the data model, the
privacy design for email discovery, and the realtime/cache architecture are
recorded in the implementation plan and mirrored in the code's own docblocks. The
three things worth restating here because getting them wrong breaks something
outside this frontend:

1. **`direct` and `group` are in `ALL_THREAD_TYPES` but in NO identity
   predicate.** `packages/shared/src/pages/chat.tsx` calls `chat.threads` without
   `identityType` in unread-overview mode, and `routers/chat/threads.ts` only
   applies the type filter when one is supplied — so a consumer thread would leak
   into the main app's list and `threadVisuals()` (an exhaustive switch with no
   `default`) would return `undefined` into a destructure. **A white screen in the
   main app.** The messenger passes `surface: 'messenger'`; the workspace branch
   carries an explicit `notInArray(CONSUMER_THREAD_TYPES)`.

2. **Email discoverability makes the Requests inbox mandatory, not optional.** A
   first message from someone you share no thread with does not bump Owed, does
   not notify, and does not send a digest email. There are two independent gates
   for that — one on send, one in the digest worker — and both are load-bearing.

3. **Discovery never enumerates.** Exact `eq(users.email, …)` only, never
   `ilike '%q%'`. Fail-closed rate limits per user *and* per IP. And
   "opted out", "blocked me" and "no account" all return the **identical**
   response, because an opt-out you can distinguish is not an opt-out.

   The strategist's messenger tools inherit this rule rather than working around
   it: the assistant may never resolve an address. It passes emails through to
   the confirm card and the **client** looks them up when the user presses the
   button — same procedure, same budgets, and a deliberate human act rather than
   a loop the model can run. See `server-shared/modules/ai/tools/messenger.ts`.

---

## 8 · Attachments

**Nothing is re-encoded.** The shared uploader's default is a 1600px WebP
re-encode for images and a 720p CRF-24 transcode for video. That is right for an
avatar and wrong for a conversation: what people send each other here is
*evidence* — a screenshot someone has to read text off, a photo of a document, a
design at its export resolution — and the recipient will never see another copy.
Every chat upload passes `noCompress`. The server-side video step stays, because
it is an `-c copy` faststart remux (the moov atom moves so a long clip starts
playing before it finishes downloading); it copies streams rather than encoding
them, so it costs nothing.

**Any file, and every file is saveable.** No extension list gates a send.
`<a download>` is ignored cross-origin, and every attachment lives on the storage
host — so what used to be "Download" was really "open in a tab". `lib/download.ts`
fetches the bytes and hands the browser a same-origin blob, which is what makes
the button honest on a phone.

**Media reserves its space.** Every inline picture carries intrinsic
width/height derived from a remembered aspect ratio (`lib/media-size.ts`); the
sender's own copy is measured from the local file while it uploads, so a sent
photo is drawn at its final height on the first paint. What that buys is the
bottom anchor: an unsized image is the largest layout shift in a transcript, and
in a bottom-anchored one that shift is what strands the reader one bubble above
the message that just landed. Rows also report `onMediaLoad` so the transcript
re-pins for the growth a virtualiser cannot see. See `stick-to-bottom.ts#repin`.

**The drop target is the whole room.** Header to composer, not the composer —
when you drag a file at a chat window you are aiming at the conversation, and a
target the size of a text field means most drops land on the page behind, which
in a browser means navigating away from the app.

## 9 · Touch

The message actions — react, reply, forward, copy, edit, delete — live in a
toolbar that appears on hover. A phone has no hover, so the entire set was
desktop-only by accident. Press and hold (or right-click) now opens a bottom
sheet carrying all of it, with the reactions across the top at full tap size.

`visualViewport`, not `100dvh`, sets the app's height. On iOS the software
keyboard does not change the layout viewport — it slides over the page, putting
the composer underneath the keyboard you opened to type into it.
