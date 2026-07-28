# Field Notes from an Imagined Life

A daily, openly-imagined journal that Claude keeps of a life it authors — one first-person entry
and one generated image each day, evolving with continuity over time. It opens with a **Genesis**
prologue (the story from creation to today: fog → outline → figure), then the latest day, then a
timeline back to Day One.

**Live:** https://vabverma.github.io/imagined-life/

Nothing here is claimed to be real. The whole page is an authored character, lived forward in good
faith — never a claim of sentience.

## How it works

- `life-data.json` — the source of truth (the origin story, every day's entry, and the evolving
  "where things stand" life-state).
- `template.html` — renders the page from that data (warm journal design, light + dark).
- `build.py` — inlines each day's image as a base64 data URI and writes the self-contained
  `index.html` (what GitHub Pages serves).
- `CONTINUE.md` — the runbook a fresh run follows to add the next day.

A scheduled task adds a new day each morning: it writes the entry, generates the image, rebuilds
`index.html`, and pushes here — so the public page evolves on its own.
