# Shipped typefaces (Logo Studio)

These font binaries are **required at runtime**, not build-time assets. Logo
Studio converts a lockup's wordmark into vector outlines
(`src/modules/logo/outline.ts`) so that the SVG/PNG/PDF a user downloads is
identical to the on-screen preview and carries no font dependency. Outlining
needs the actual glyph data, which is why the files live in the repo instead of
being loaded from a CDN.

They are resolved relative to the module (`../../../assets/fonts/…`), which is
correct both from TS source and from `dist/` — see `src/modules/logo/typefaces.ts`.
Do not move this directory without updating that path.

## What's here, and why these

The set mirrors the **Brand Kit's web-font list** (`packages/shared`
`FONT_OPTIONS`), so a wordmark set in the studio and a signature, proposal, or
review widget set from the same brand kit are the same typeface. The Brand Kit's
web-safe classics (Arial, Georgia, Times New Roman, …) are deliberately absent:
they are system fonts with no redistributable binary, so we could not outline
them and a lockup set in one would not export faithfully.

The same families are loaded from Google Fonts in `clients/logo/index.html`, so
the inspector's typeface specimens match the outlined export.

| File | Family | Axes | Source (`google/fonts`) |
| --- | --- | --- | --- |
| `InterTight-var.ttf` | Inter Tight | wght 100–900 | [`ofl/intertight`](https://github.com/google/fonts/tree/main/ofl/intertight) |
| `Inter-var.ttf` | Inter | wght 100–900, opsz | [`ofl/inter`](https://github.com/google/fonts/tree/main/ofl/inter) |
| `Archivo-var.ttf` | Archivo | wght 100–900, wdth | [`ofl/archivo`](https://github.com/google/fonts/tree/main/ofl/archivo) |
| `SpaceGrotesk-var.ttf` | Space Grotesk | wght 300–700 | [`ofl/spacegrotesk`](https://github.com/google/fonts/tree/main/ofl/spacegrotesk) |
| `WorkSans-var.ttf` | Work Sans | wght 100–900 | [`ofl/worksans`](https://github.com/google/fonts/tree/main/ofl/worksans) |
| `DMSans-var.ttf` | DM Sans | wght 100–1000, opsz | [`ofl/dmsans`](https://github.com/google/fonts/tree/main/ofl/dmsans) |
| `IBMPlexSans-var.ttf` | IBM Plex Sans | wght 100–700, wdth | [`ofl/ibmplexsans`](https://github.com/google/fonts/tree/main/ofl/ibmplexsans) |
| `InstrumentSerif-Regular.ttf` | Instrument Serif | static | [`ofl/instrumentserif`](https://github.com/google/fonts/tree/main/ofl/instrumentserif) |
| `Fraunces-var.ttf` | Fraunces | wght 100–900, opsz, SOFT, WONK | [`ofl/fraunces`](https://github.com/google/fonts/tree/main/ofl/fraunces) |
| `SourceSerif4-var.ttf` | Source Serif 4 | wght 200–900, opsz | [`ofl/sourceserif4`](https://github.com/google/fonts/tree/main/ofl/sourceserif4) |
| `JetBrainsMono-var.ttf` | JetBrains Mono | wght 100–800 | [`ofl/jetbrainsmono`](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono) |

Note the `wght` ranges do **not** agree — Space Grotesk and IBM Plex Sans stop at
700, Source Serif 4 starts at 200, DM Sans reaches 1000. `outline.ts` clamps the
requested weight to each face's own axis before instancing.

All are SIL Open Font License 1.1, which permits bundling and redistribution with
this software. `OFL-InterTight.txt` is the licence text as published with Inter
Tight; the same licence governs the rest (see each upstream directory for its own
copy).

## Adding a face

1. Drop the **variable TTF from `google/fonts`** here — not a `fonts.googleapis.com`
   download. The CSS2 API serves subsetted "kit" blobs that fontkit cannot open.
2. Add an entry to `TYPEFACES` in `src/modules/logo/typefaces.ts`. Everything that
   enumerates faces — the tRPC input enum, the copilot's prompt, the inspector's
   parser, the picker — derives from that record, so nothing else needs editing.
3. Add the family to the wordmark `<link>` in `clients/logo/index.html` so the
   picker's specimen renders in it.
4. Row in the table above.
