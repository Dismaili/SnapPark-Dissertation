# SnapPark Architecture Diagrams

Three diagrams, modelled on the [C4 model](https://c4model.com/), give the
dissertation reader a top-down view of the system at three increasing levels
of detail.

| #   | Diagram                                       | C4 level                  | What it answers                                                  |
| --- | --------------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| 1   | [System Context](01-system-context.md)        | Level 1 — Context         | Who uses SnapPark? What external systems does it depend on?      |
| 2   | [Container Diagram](02-container.md)          | Level 2 — Containers      | What runtime processes make up SnapPark, and how do they talk?   |
| 3   | [Event Flow](03-event-flow.md)                | Sequence (cross-cutting)  | What happens, in time, when a citizen submits a report?          |

Read them in order. Each one zooms in on the box from the previous diagram
labelled *SnapPark*.

## Why these three (and not more)

C4 also defines a **Component** (Level 3) and **Code** (Level 4) view. Both
are deliberately omitted from this folder:

- **Level 3 (Components)** is captured in each service's own `README.md`
  inside [`services/*`](../../services). It would be redundant here and would
  rot every time we refactor.
- **Level 4 (Code)** is the source itself. We don't generate UML class
  diagrams from JavaScript.

The three diagrams kept here are **stable**: they describe shape, not detail,
so they don't have to be rewritten with every commit.

## How to render them

### On GitHub
Just open the `.md` files. GitHub renders Mermaid blocks natively.

### Locally (VS Code)
Install the *Markdown Preview Mermaid Support* extension. The preview pane
will render every `mermaid` block.

### For the dissertation PDF
Two options, depending on your toolchain:

**Pandoc + mermaid-filter** (easiest):
```bash
brew install pandoc
npm install -g mermaid-filter
pandoc DISSERTATION.md \
  --filter mermaid-filter \
  -o DISSERTATION.pdf
```

**Manual export to SVG/PNG** (highest quality, recommended for print):
1. Open the diagram on https://mermaid.live/.
2. Paste the `mermaid` block.
3. Click *Actions → SVG / PNG*.
4. Save into `architecture/diagrams/exported/` (this folder is gitignored —
   regenerate when the source changes).

For the bound copy of the dissertation, use the **SVG** export so the
diagrams stay sharp at any zoom level.

## Editing rules

1. **Always edit the Mermaid source**, never a downstream PNG. The `.md` file
   is the source of truth.
2. Keep node labels short — at most three lines. Long descriptions go in the
   prose underneath, not on the canvas.
3. If you add a new external system, update the **System Context** diagram
   first, then propagate to the container diagram. Don't introduce
   externals on the container diagram alone — it leaves the context view
   lying.
4. Update the prose section of each file when the diagram changes.
   The text-after-diagram is not decoration; it's how the reader knows
   what to take away.

## Diagram colour palette

A small custom palette is applied via Mermaid's `themeVariables` so the
diagrams have a consistent visual language across all three:

| Role            | Colour       | Where it appears                           |
| --------------- | ------------ | ------------------------------------------ |
| Person / actor  | Soft blue    | Citizens, authorities                      |
| Internal box    | Soft green   | SnapPark itself, all our services          |
| Datastore       | Soft amber   | Postgres databases, RabbitMQ               |
| External system | Soft red     | Gemini, SMTP, Twilio, FCM                  |
| Boundary        | Dashed grey  | Trust boundary around SnapPark             |

These colours are defined inline in each diagram so the files are
self-contained — you can copy one diagram out and it still renders the same.
