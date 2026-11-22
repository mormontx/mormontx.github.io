# Pedagogical Tectonics

A teaching portfolio composed as an architectural monograph. Instead of a résumé or a list of competencies, the site files classroom moments the way a monograph files buildings: each teaching structure is a numbered plate with a specification sheet, an elevation of intellectual tension over time, and a blueprint of constraints, failures, and iterations. Ink on paper, hairline rules, drafting marks, and four procedural 3D models — published as fully static HTML.

## Commands

```sh
pnpm install   # install dependencies (once)
pnpm dev       # start the local dev server
pnpm build     # build the static site into dist/
pnpm preview   # serve the built dist/ folder locally
```

## Adding a note

Create `src/content/notes/NN-slug.md` (keep the `NN` numbering sequential). The filename becomes the URL slug.

```yaml
---
title: "The Margin Is a Room"
date: "2025-11-02"
kind: "Field Note"
summary: "One quiet line for the notes index."
tags: ["feedback", "marginalia", "dialogue"]
featured: false
draft: false
---
```

- `kind` must be exactly one of `Field Note`, `Essay`, `Talk`, `Publication`.
- `draft: true` hides the note from the index and its own page.
- Reading time is computed automatically from the word count.
- The body is standard Markdown; an `<aside class="sidenote">…</aside>` becomes a margin note.

## Adding a structure

Create `src/content/structures/NN-slug.md`. Its 3D model is chosen automatically by the `number` in the frontmatter from the four procedural models in `src/components/three/structures/StructureModels.tsx` — numbers 1–4 map to the four built models. A fifth structure needs a new model added there.

```yaml
---
title: "The Socratic Timer"
number: 5
typology: "Seminar Design"
scale: "18 Interlocutors · 6 Weeks"
medium: "Socratic Dialogue"
loadBearing: "Timed questioning"
site: "Upper-Secondary Colloquium"
year: 2025
origin: "after Paulo Freire"
summary: "One quiet line for the index."
sketch: "/sketches/05-the-socratic-timer.svg"
sketchCaption: "Plan view — a timer in the middle of the circle"
elevation:
  - { t: "Week 1", v: 2, note: "the room waits to be led" }
  - { t: "Week 2", v: 4, note: "first timed exchange" }
  - { t: "Week 3", v: 6, note: "the timer becomes invisible" }
  - { t: "Week 6", v: 8, note: "a question is held past the bell" }
blueprint:
  constraints:
    - "The teacher may only speak in questions after minute ten"
    - "Every response must name the previous speaker"
  failurePoints:
    - "The timer is read as punishment rather than scaffold"
  iterations:
    - { year: 2024, change: "untimed discussion — the loudest voices set the pace" }
    - { year: 2025, change: "the timer is introduced and kept through the term" }
---
```

`elevation` takes 4–8 points, each `{ t, v, note }` (label, 0–10 tension, hover note). `blueprint` needs 2+ `constraints`, 1+ `failurePoints`, and 2+ `iterations`.

## Before publishing

- In `src/data/about.ts`, replace every bracketed editorial slot: `[Department]`, `[University]`, `[2021 — ]`, `[Programme]`, `[Institution]`, `[2019 — ]`, `[Add publication]`, `[Journal / press]`, `[Year]`, `[name]@[institution].edu`, `[personal website]`, `[scholar / ORCID]`.
- In `src/data/site.ts`, set `name`, `studio`, `siteTitle`, and `description`.
- In `astro.config.mjs`, `site` is currently set to `https://mormontx.github.io` (the previous project's URL) — update it to the real domain before deploying, and set `base` as well if the site is published under a subpath (e.g. `https://mormontx.github.io/teaching-portfolio-reimagined/`).
- The four `public/sketches/*.svg` plates are placeholders — swap in your own drawings when ready.

## The 3D layer

The models are three.js + React Three Fiber, built entirely from procedural geometry (no model files). Reduced-motion, no-WebGL, and no-JavaScript fallbacks are in place, so the pages still read without a GPU or scripts. The `three` + React Three Fiber bundle is roughly 258 KB gzipped.

## Deployment

This repository is the **source** for the site; it is not currently deployed. GitHub Pages is not configured for this repository (`docs/` is gitignored and no Pages workflow is set up).

To publish, either:

- Enable GitHub Pages on this repository (a static host, a `docs/` folder, or an Actions workflow), or
- Deploy `dist/` after `pnpm build` to any static host (Netlify, Vercel, Cloudflare Pages, S3).

Before deploying, update `site` in `astro.config.mjs` to the real domain. If the site is published under a subpath (e.g. `https://mormontx.github.io/teaching-portfolio-reimagined/`), set `base` accordingly as well, otherwise assets and canonical links will 404.

The previous site lives at `https://mormontx.github.io/` and is a separate deployment.
