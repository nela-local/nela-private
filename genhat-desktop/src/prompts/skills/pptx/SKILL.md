---
name: pptx
description: >-
  Use whenever the deliverable is a slide deck or presentation. Prefer
  generate_presentation (HTML deck) over ad-hoc markdown slides.
---

# NELA presentation skill (`generate_presentation`)

Create decks with `generate_presentation` (prefer self-contained `html` for rich slides).

## Requirements

- Light backgrounds, dark readable text unless the user asks for dark mode
- One idea per slide; substantial plain-language copy, not title-only slides
- Consistent theme; title slide + section dividers + closing slide when appropriate
- Charts via `render_chart` + `data-nela-chart` markers when plotting data
- Never claim a file is PowerPoint unless `generate_presentation` succeeded

## Anti-patterns

- Using `generate_html` for a multi-slide deck when `generate_presentation` exists
- Sparse decks with only headings and no explanatory copy
- Inventing Chart.js snippets instead of host chart markers
