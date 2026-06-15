# Selection → AI Operation Pipeline

Exploration notes on (1) how FuzzyCAD embeds in Onshape and (2) how to structure
the AI input/output for "given my selection, tell me what to stretch, what to
move, and what to fix" — using the telescope-height use case as the running
example.

## 1. How FuzzyCAD currently embeds in Onshape

FuzzyCAD is an Onshape **App Store application** registered as an OAuth2 app
with an **Element Tab extension** (per
[onshape-public.github.io/docs/app-dev/extensions](https://onshape-public.github.io/docs/app-dev/extensions/)).
Concretely:

- Onshape opens FuzzyCAD's URL in an iframe and appends `documentId`,
  `workspaceId`, `elementId`, `server` as query params. `fuzzycad-home.tsx`
  reads these via `useSearchParams`.
- `/api/oauth/start` and `/api/oauth/callback` implement the OAuth2 code
  exchange and store `onshape_access_token` / `onshape_refresh_token` as
  httpOnly cookies.
- Every Onshape REST call (elements, assembly JSON, glTF translation) goes
  through Next.js API routes (`app/api/onshape/*`, `app/api/fuzzycad/*`) using
  that token — the browser never talks to `cad.onshape.com` directly.
- Geometry is rendered in **FuzzyCAD's own** react-three-fiber viewer (from a
  glTF export of the assembly), not Onshape's native 3D view. Selection
  (click, lasso) happens inside that viewer.

**Gap worth knowing about:** Onshape's extension protocol also supports a
`postMessage`-based **client messaging** channel
([clientmessaging](https://onshape-public.github.io/docs/app-dev/clientmessaging/),
[element-tab messages](https://onshape-public.github.io/docs/app-dev/messages/element-tab/)).
After an extension sends `applicationInit` to `window.parent`, Onshape will
start pushing `messageName: 'SELECTION'` messages whenever the user selects
something in Onshape's *native* tree/3D view. FuzzyCAD doesn't implement this
handshake yet, so today the only selection surface is FuzzyCAD's own viewer.
Adding this later would let a user select parts in Onshape itself and have
that selection feed the same AI pipeline described below — same downstream
contract, just a second input source.

## 2. What's already built (you're further along than you may realize)

There's already a working draft of exactly this pipeline:

1. **`viewer/objectSummary.ts`** — for every mesh object in the loaded glTF,
   does a PCA over its vertices to get a principal axis, axis length,
   cross-section size, elongation ratio, AABB, and the two endpoints along
   the axis → `AxialStretchObjectSummary`.
2. **`lib/operations/compactAxialStretchContext.ts`** — takes all summaries +
   the current lasso selection, classifies each as `elongated` / `compact` /
   `flat`, groups similarly-named/shaped objects together, and produces a
   compact `aiPayload` (`operation`, `instruction`, `heightDirection`,
   `objects[]`, `groups[]`) plus an `aliasMap` (`o1` → real `pathKey`).
3. **`lib/operations/inferCompactAxialStretchPlan.ts`** — a **hand-written
   heuristic** (no AI call yet) that looks at the compact context and assigns
   each selected group a role: `stretchTarget`, `moveWithEnd`, `fixedAnchor`,
   or `excluded`, using elongation, repetition, vertical position, and axis
   direction.

So the "what does AI need" question already has a working first answer — step
3 is a stand-in for an LLM call, and the schemas in `axialStretchTypes.ts` /
`compactAxialStretchContext.ts` are most of the contract already.

## 3. Sharpening the AI input

The current `aiPayload` answers "is this object long & thin, and roughly where
is it?" but is missing the signals that actually carry *telescope* semantics.
Highest-value additions, roughly in priority order:

**a. Mate/DOF information (the big one).** `relationship-graph` already
computes `mateEdges` with `mateType` (SLIDER, CYLINDRICAL, FASTENED,
REVOLUTE, etc.), but `AxialStretchObjectSummary.mateConnections` is left empty
("fill from relationshipGraph.mateEdges in Step 2"). A **SLIDER/CYLINDRICAL
mate between two tube segments aligned with the height axis is the single
strongest signal that this is a telescoping joint and should be the stretch
target**. A **FASTENED mate** means rigid — that part should be `moveWithEnd`
or `fixedAnchor`, never stretched. Wiring this in turns "guess from shape and
position" into "read the actual kinematic intent of the assembly."

**b. The user's actual instruction + a numeric target.** `instruction` is
currently a hardcoded string and `heightDirection`/`uncertaintyDOF.range` are
placeholders. Replace with what the user typed ("raise the tripod by 80 mm")
plus a parsed `targetDelta: { value: 80, unit: "mm" }` when present, so the AI
is solving "make this specific change" rather than "guess what might change."

**c. Assembly hierarchy / grouping by sub-assembly.** Right now objects are a
flat list grouped only by name+shape similarity. Knowing "these 6 objects are
the 3 legs (2 segments each)" vs. "these are all just `Tube`" lets the AI
reason about per-leg structure and symmetry directly.

**d. Units/scale.** `detectScale` in `partGraph.ts` already figures out the
model-unit scale factor but doesn't reach the AI payload — needed so a
numeric delta in mm maps correctly to the glTF's units.

**e. Symmetry/constraint hints.** `sameSourceGroups` from the relationship
graph (e.g., 3 identical leg assemblies) is a ready-made signal that those
groups should receive the *same* delta — feed it through as a constraint
rather than re-deriving it.

**f. Prior plan / history**, for iterative refinement ("now extend the center
column a bit more too") — send the last plan + what was actually applied.

## 4. Sharpening the AI output

`CompactAxialStretchPlan` (role + reason per group) is a solid skeleton.
For a real model call, extend it to:

- **`confidence`** (0–1) per role assignment.
- **A numeric `deltaAlongAxis`** per `stretchTarget` (signed, in model units) —
  not just a category, but how much.
- **`boundEnd`** — which end of a stretched object stays connected to its
  mate vs. which end moves, so the geometry edit knows which face to anchor.
- **`linkedGroups[]`** (already stubbed in `AxialStretchPlan`) — groups that
  must change by the same delta (e.g. all 3 legs).
- **`clarifyingQuestions[]`** — when the selection is genuinely ambiguous
  (e.g. two plausible stretch bands), the model should be able to ask instead
  of guessing, surfaced in the UI *before* anything is touched.
- **`summary`** — one short paragraph in plain language describing the plan,
  for the user to confirm.
- **`warnings[]`** — e.g. "this will also shift the mounting bracket by
  80 mm; confirm."

Example shape:

```json
{
  "operation": "height",
  "summary": "Stretch the two lower leg-tube segments (3 legs) by +80mm each via their slider joints; the upper segments, feet, and head stay fixed.",
  "targetDelta": { "value": 80, "unit": "mm" },
  "roles": [
    {
      "targetId": "g1",
      "targetType": "group",
      "role": "stretchTarget",
      "confidence": 0.92,
      "deltaAlongAxis": 80,
      "boundEnd": "negativeEnd",
      "reason": "Lower leg-tube segments; SLIDER mate to upper segment along the height axis; repeated x3."
    },
    {
      "targetId": "g2",
      "targetType": "group",
      "role": "moveWithEnd",
      "confidence": 0.85,
      "deltaAlongAxis": 80,
      "reason": "Feet are FASTENED to the lower tube end; translate with it but do not stretch."
    },
    {
      "targetId": "g3",
      "targetType": "group",
      "role": "fixedAnchor",
      "confidence": 0.78,
      "reason": "Head/mount assembly; FASTENED to upper tube which is unaffected."
    }
  ],
  "linkedGroups": [
    { "id": "lg1", "pathKeys": ["..."], "constraint": "sameAxialDelta", "reason": "3 identical leg assemblies (sameSourceGroup) must extend equally." }
  ],
  "clarifyingQuestions": [],
  "warnings": []
}
```

## 5. Wiring the heuristic up to a real model

Suggested shape for a new route, `POST /api/fuzzycad/ai-operation-plan`:

- **Input:** the enriched `aiPayload` (section 3) + `aliasMap` + raw user
  instruction string.
- **Call Claude's Messages API** with a tool definition whose `input_schema`
  is the JSON Schema for the extended `AxialStretchPlan` from section 4, and
  `tool_choice` forcing that tool — guarantees structured, parseable output.
- **System prompt** encodes the domain framing: this is a telescope/tripod-
  style assembly, objects are pre-classified (elongated/compact/flat) with
  PCA axes, mate types indicate kinematic intent (slider/cylindrical = can
  extend, fastened = rigid), `o1`/`g1`-style ids are aliases — never invent
  ids not present in the payload.
- **`aliasMap` stays server-side-in/client-side-out only** — the model only
  ever sees `o1`/`g1` aliases (keeps prompts small, stable, and free of real
  part names/IDs); the client maps the response back to real `pathKey`s to
  drive highlighting.
- **Keep `inferCompactAxialStretchPlan` as a local fallback** — it already
  works offline, is free, and can pre-filter (e.g., skip the AI call entirely
  if nothing is selected) or serve as a sanity baseline to compare the AI
  response against.

## 6. Suggested next steps, in order

1. Wire `relationshipGraph.mateEdges` into
   `AxialStretchObjectSummary.mateConnections` (the "Step 2" TODO already
   called out in `axialStretchTypes.ts`) — this is the highest-leverage
   change for telescope-style reasoning.
2. Add a real user-instruction input (small text box near the operation
   toolbar) and a `targetDelta` parser.
3. Extend `compactAxialStretchContext`/`axialStretchTypes` with the section-3
   fields (hierarchy, scale, sameSourceGroup constraints).
4. Build `/api/fuzzycad/ai-operation-plan` against the extended schema; keep
   the heuristic as fallback/baseline.
5. Surface `summary` / `clarifyingQuestions` / `warnings` in the UI as a
   confirm-before-apply step (no geometry edits happen automatically yet
   anyway — this fits the current read-only posture).
6. Longer term: implement the `applicationInit` → `SELECTION` postMessage
   bridge so selections made in Onshape's native UI can also feed this
   pipeline.
