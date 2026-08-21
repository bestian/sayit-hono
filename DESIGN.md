# SayIt / archive.tw — Design Charter

> **Status:** canonical design direction  
> **North star:** **The archive should feel like listening with perfect recall.**  
> **Subject:** a bilingual public record of people speaking, in sequence  
> **Primary act:** find exact words, read them in context, and cite the turn  
> **Signature:** the **Turnline**

This document is a contract, not a moodboard. It governs the public archive, its search and AI surfaces, its responsive states, and its print output.

SayIt is not a news site, a dashboard, or an answer machine. It is a room full of public speech made searchable without flattening it. The interface should lower its voice so that every speaker can keep theirs.

“Listening” requires cadence, hand-offs, and enough calm to stay with a long exchange. “Perfect recall” requires exact search, stable anchors, visible context, honest language links, and citations that return to the record. Every design decision should strengthen one or both halves of that sentence.

---

## 1. What the design must do

At archive scale—hundreds of thousands of turns, thousands of speakers, and thousands of sections—pleasantness is not cosmetic. It is the absence of accumulated friction.

| Person | They come to SayIt to… | The design must let them leave with… |
|---|---|---|
| A citizen following a public discussion | understand who said what and what followed | the sequence, speaker hand-offs, and surrounding turns intact |
| A journalist or fact-checker | find an exact phrase quickly | a stable source URL, date, speaker, section, and copyable citation |
| A researcher | scan repeated appearances and compare records | dense but legible indexes, predictable metadata, and no hidden result set |
| A bilingual reader or translator | move between zh-Hant and English | an equal language twin at the same conceptual place, never a flag or an afterthought |
| Someone asking a broad question | synthesize across the archive | a visibly generated answer whose claims lead back to exact source turns |
| A participant finding their own words | locate and read their public record | respectful typography, unambiguous identity, and surrounding context |

### Governing principles

1. **The record comes first.** Search, filters, navigation, and AI are finding aids. None may impersonate the source.
2. **Sequence is meaning.** A transcript is not a pile of quote cards. The visual system must preserve order and make hand-offs obvious.
3. **The language versions are twins.** zh-Hant and English receive equivalent hierarchy, care, URLs, metadata, and reading comfort. One is never styled as a translation footnote.
4. **Typography does the heavy lifting.** Long-form comfort comes from script-appropriate faces, line length, leading, spacing, and hierarchy—not decoration.
5. **Density can be calm.** Indexes may be information-rich, but every line, label, and divider must earn its place.
6. **AI has receipts.** Generated synthesis is useful only when its provenance is visible, close, and operable.
7. **Pleasant does not mean soft.** It does not mean rounder cards, warmer beige, or more empty space. It means the eye never has to recover from the interface.

---

## 2. The visual idea: a living public record

The material vocabulary is the archive itself:

- cool paper rather than lifestyle cream;
- carbon ink rather than pure black;
- index blue for retrieval and links;
- catalogue rules rather than floating cards;
- speaker marks rather than decorative illustration;
- typographic contrast between **what was said** and **what helps find it**.

The result should feel contemporary but durable: more reading room than product dashboard, more public instrument than publication brand. It must not imitate a newspaper. The archive is defined by spoken sequence, not editorial columns.

### One memorable signature: the Turnline

The **Turnline** is a continuous, speaker-labelled line running beside a transcript. It is an evolution of the existing timeline into the archive’s central navigational grammar.

It does three jobs at once:

1. **Handoff:** a new labelled segment begins when the speaker changes.
2. **Position:** a tick marks every stable turn anchor.
3. **Return:** the tick is the visible affordance for opening, copying, or sharing that exact turn.

The Turnline is not decoration and not a data visualization. It is the transcript’s binding.

```text
Wide transcript

  TURNLINE / SPEAKER          SPOKEN RECORD                     TOOLS
  ─────────────────          ─────────────────────────────     ───────────
  Lin Chia-lung       ●────   First turn, set for reading…      Search here
                         │                                       華文 / English
  Audrey Tang         ●────   The reply continues in exact      Copy citation
                         │     sequence and at a calm measure.
  Lin Chia-lung       ●────   The line makes the return visible.

Narrow transcript

  Audrey Tang · turn 184 · Copy link
  ●────────────────────────────────
  The Turnline moves to the inner edge; the record keeps its measure.
```

#### Turnline rules

- The base line uses the rule colour; the active speaker segment uses a deterministic speaker colour.
- Every named speaker is shown. Unlabelled editorial turns keep a neutral segment rather than inventing a distracting identity. Colour is never the only identity cue.
- Consecutive turns by the same speaker keep one visual segment. Every turn still keeps its own semantic anchor.
- The quiet Turnline dot opens two explicit share modes: **with surrounding context** (`#s{id}`) or **this turn only** (`/speech/{id}`). The choices appear only on intent.
- A hash-targeted turn receives one restrained arrival cue: the segment strengthens and a cool wash fades once. It does not pulse indefinitely.
- On small screens, the line moves inside the content edge and the speaker label sits above the turn. It never steals horizontal reading measure.
- In print, the line becomes a thin grayscale rule; names and source order carry the meaning.
- The Turnline is reserved for source sequence. Search results, AI answers, and generic lists must not borrow it.

---

## 3. Typography is the product

Every screen has two voices:

- **Record voice:** the words people spoke and the editorial prose that must be read continuously.
- **Finding voice:** headings, speaker hand-offs, search, navigation, filters, metadata, citations, and system feedback.

There is no third “technical” voice. Monospace metadata would turn a civic record into a terminal aesthetic and make bilingual texture worse.

### Typeface roles

| Role | English / Latin | Traditional Chinese | Use |
|---|---|---|---|
| Record | **Newsreader**, regular with real italic | **jf Lanyang Ming Light** (`.jf-lanyangming-light`, family `jf-lanyangming`) | transcript turns, quoted source excerpts, long editorial and legal reading |
| Decisive finding | **Source Sans 3**, 700–800 | **jf Lanyang Hei ExtraBold** (`.jf-lanyanghei-extrabold`, family `jf-lanyanghei`) | page titles, section titles, speaker hand-offs, primary actions |
| Routine finding | **Source Sans 3**, 400–650 | **PingFang TC**, **Noto Sans TC**, system sans | navigation, controls, filters, metadata, dense indexes |

This is one matched system across two scripts, not an English design with Chinese fallback.

- **Newsreader** was made for continuous on-screen reading. Its optical sizes, open rhythm, and true italic give English the care that the present Georgia fallback cannot.
- **Lanyang Ming** gives the zh-Hant record the texture of a spoken archive without turning it into a facsimile or a newspaper.
- **Source Sans 3** is plainspoken and exceptionally legible at utility sizes.
- **Lanyang Hei ExtraBold** supplies decisive Han headings and speaker hand-offs. Its force is valuable because it is rare.
- Routine Han UI stays in a normal system sans. Setting every control in ExtraBold would make the interface shout over the record.

### Font stacks

```css
:root {
  --font-record:
    "Newsreader",
    "jf-lanyangming",
    "Noto Serif TC",
    "Songti TC",
    "PMingLiU",
    Georgia,
    serif;

  --font-finding:
    "Source Sans 3",
    "PingFang TC",
    "Noto Sans TC",
    "Microsoft JhengHei",
    system-ui,
    sans-serif;

  --font-decisive:
    "Source Sans 3",
    "jf-lanyanghei",
    "PingFang TC",
    "Noto Sans TC",
    system-ui,
    sans-serif;
}
```

Latin faces come first so mixed-script lines retain a considered Latin texture; Han glyphs naturally fall through to the appropriate Han face. Correct `lang` attributes remain mandatory for pronunciation, punctuation, line breaking, and language-specific styling.

### The live-font contract

The production webfont path is deliberate and narrow:

- Justfont project **65960** provides loader class `jf-lanyangming-light` at registered weight **200** with family alias `jf-lanyangming`, and `jf-lanyanghei-extrabold` at **800** with alias `jf-lanyanghei`.
- Bootstrap it from the project’s local copy of the official Justfont Universal **v6.1** snippet, which loads kit ID **69938697899** from `ds.justfont.com`; do not resurrect the obsolete S3 loader endpoint.
- Justfont is the sole deliberate runtime font-service exception. Do not add Google Fonts, another foundry loader, or a second copy of the same faces.
- The page must remain fully visible and usable while Justfont is unavailable or loading. Never gate the body behind a `.loading` class.
- Never commit or publicly serve Lanyang font binaries. The existing licensed local-font-to-PNG Open Graph path remains image-only; its output may ship, its source font may not.
- Self-host route-appropriate WOFF2 subsets of Newsreader and Source Sans 3. Do not preload a face unless measured above-the-fold use justifies it; do not make CJK shards part of the Latin critical path.
- Newsreader italic is a real italic file/axis. No browser-synthesized italic or bold anywhere in the system.
- Set `font-synthesis: none` globally. Request normal text weight at the style layer so system fallbacks stay legible; when Justfont is present, its registered 200 Ming face remains the selected family face.
- Test three states: all fonts loaded, Justfont blocked, and all webfonts blocked. Each must preserve hierarchy, readable measures, and stable controls.

### Reading sizes and rhythm

| Role | Size | Line height | Measure | Notes |
|---|---:|---:|---:|---|
| English transcript | `clamp(19px, 18px + .22vw, 21px)` | `1.68` | `64–68ch` | Newsreader 400, optical sizing on, ragged right |
| zh-Hant transcript | `clamp(20px, 19px + .18vw, 21px)` | `1.92` | `34–38ic` | Lanyang Ming; strict CJK line breaking |
| UI body | `16px` | `1.55` | `68ch` | Source Sans 3 / system Han sans |
| Metadata | `14px` | `1.45` | none | tabular figures for dates, counts, and turn IDs |
| Turn speaker label | `14–15px` | `1.35` | rail width | decisive face; wraps rather than truncates |
| Section heading | `clamp(24px, 21px + .7vw, 32px)` | `1.12` English / `1.22` Han | `24ch` / `14ic` | sentence case, no eyebrow above by default |
| Page title | `clamp(32px, 26px + 1.5vw, 48px)` | `1.08` English / `1.12` Han | full record lane | maximum two intentional lines on wide screens |

The transcript sizes are deliberately close across scripts; their line heights are not. Han needs more vertical air around dense square forms and punctuation. Equal pixel leading would not be equal comfort.

```css
.record-copy {
  font-family: var(--font-record);
  font-synthesis: none;
  font-optical-sizing: auto;
  font-kerning: normal;
  text-wrap: pretty;
}

.record-copy:lang(en) {
  max-inline-size: 66ch;
  font-size: clamp(1.1875rem, 1.13rem + .22vw, 1.3125rem);
  line-height: 1.68;
  hyphens: none;
}

.record-copy:lang(zh-Hant) {
  max-inline-size: 36ic;
  font-size: clamp(1.25rem, 1.19rem + .18vw, 1.3125rem);
  line-height: 1.92;
  line-break: strict;
  word-break: normal;
}

@supports (text-autospace: normal) {
  .record-copy:lang(zh-Hant) { text-autospace: normal; }
}

.record-copy:lang(zh-Hant) em {
  font-style: normal;
  text-emphasis: filled sesame;
  text-emphasis-position: under right;
}
```

### Typesetting rules

- Never justify transcript text. A living rag preserves word shape and prevents rivers in English or forced spacing in Han.
- Keep the record’s paragraph breaks. Use `0.8em` between paragraphs, never blank decorative dividers.
- Use more space at a speaker hand-off than between turns by the same speaker: approximately `52px` versus `32px` on wide screens, proportionally less on narrow screens.
- Headings use `text-wrap: balance`; prose uses `text-wrap: pretty` as progressive enhancement. The fallback must still look intentional.
- Use hanging punctuation only as a progressive enhancement. Never make alignment depend on it.
- Use real curly quotation marks only when they exist in the source or authored UI copy. Do not silently rewrite transcript punctuation.
- Use tabular lining figures for dates, result counts, timestamps, and turn IDs. Keep prose numerals proportional.
- Do not letter-space Han. Do not set Han in all caps by proxy. English labels remain sentence case rather than institutional all caps.
- Never render meaningful text below `13px`.
- Links inside prose are visibly underlined at rest. Navigation and button-shaped actions need not be.
- Source text remains selectable and copyable without labels, pseudo-elements, or generated anchor glyphs entering the copied string.

---

## 4. Colour: cool paper, carbon, index blue

The palette should feel like a well-kept public file, not aged stationery. It is cool, quiet, and predominantly flat.

### Core tokens

| Token | Value | Role |
|---|---|---|
| `--paper` | `#F3F6F6` | default reading field |
| `--sheet` | `#FCFDFD` | inputs, dialogs, and rare raised surfaces |
| `--carbon` | `#16262D` | primary text; 14.3:1 on paper |
| `--slate` | `#59696F` | secondary text; 5.3:1 on paper |
| `--rule` | `#C7D3D6` | dividers, inactive Turnline, field borders |
| `--index` | `#005F78` | links, primary actions, selected state; 6.6:1 on paper |
| `--index-wash` | `#DCECF0` | target, selection, receipt, and query-highlight wash |
| `--proof` | `#B63D13` | focus and urgent correction only; 5.3:1 on paper |

Semantic additions:

- success: `#2D6A55`
- warning: `#805800`
- error: `#9A3340`

`--proof` is a functional editorial mark, not a general accent. Index blue carries ordinary interaction.

### Night reading

Night mode is a reading accommodation, not a second brand. It keeps the same hierarchy and removes all gradients:

| Token | Night value |
|---|---|
| paper | `#101A1F` |
| sheet | `#162329` |
| carbon | `#E7EFEF` |
| slate | `#A9B8BE` |
| rule | `#34474E` |
| index | `#76C4D5` |
| index wash | `#163740` |
| proof | `#FF8B63` |

Ship night mode only after proofing Lanyang Ming on macOS, Windows, iOS, and Android. A thin Ming face that blooms or disappears is not an acceptable dark theme. Respect the system preference and permit a user override; persist the choice without blocking first paint.

### Speaker colour

Replace the legacy neon set with a stable, restrained categorical palette. A useful starting set is:

```text
#1D6775  #355D8C  #6B508A  #8A4B66
#975143  #7A6224  #42704C  #4E6670
```

- Hash a stable speaker identifier to the palette in `src/utils/speakerColor.ts`; never hash the display name alone if a stable ID exists.
- Use the colour for the Turnline segment, its tick, and at most one small repeated mark.
- Keep speaker-name text in carbon. Colour must not carry identity, status, sentiment, party, or chronology by itself.
- Provide lighter night-mode counterparts rather than mechanically inverting the palette.
- In forced colours and print, names, ticks, and ordering remain sufficient without colour.

### Surface rules

- No gradients.
- No glass effects.
- No ambient shadows around ordinary content.
- One restrained shadow is permitted for a modal dialog that must separate from the document below it.
- Default corner radius is `3px`; large panels may use `6px`. Pills are reserved for true compact states or removable filters, not generic labels.
- A border is structural. Do not put every result or paragraph into a bordered card.

---

## 5. Layout and spatial rhythm

### Spacing scale

Use a small non-linear scale so nearby relationships remain obvious:

```css
:root {
  --space-1: 0.25rem; /* 4 */
  --space-2: 0.5rem;  /* 8 */
  --space-3: 0.75rem; /* 12 */
  --space-4: 1.25rem; /* 20 */
  --space-5: 2rem;    /* 32 */
  --space-6: 3.25rem; /* 52 */
  --space-7: 5.25rem; /* 84 */
}
```

Do not interpolate arbitrary 14, 18, 26, and 30 pixel gaps until hierarchy becomes invisible. Components may use optical corrections, but their base relationship comes from this scale.

### Page geometry

- Maximum shell width: approximately `88rem`, with `clamp(1rem, 4vw, 2.5rem)` side gutters.
- Transcript layout on wide screens: speaker rail `8–10rem`, record measure `66ch` or `36ic`, optional tools rail `11–13rem`.
- The record column—not the shell—is the alignment source. Title, section context, transcript, and citations begin on the same reading edge.
- Search and index pages may use a wider `76rem` working lane because rows distribute metadata horizontally.
- Long reading is never centered line-by-line in a giant viewport. The composed transcript group may be centered; the text itself remains left aligned.
- At `720–1100px`, collapse the tools rail before reducing the record measure. Put language and citation actions beneath the title.
- Below `720px`, use one column, `16–20px` gutters, speaker labels above turns, and an inner-edge Turnline.
- Do not shrink transcript text to make the desktop composition survive. Change the composition.

### Rhythm before boxes

Hierarchy should usually be expressed with spacing, type, and a rule—not a container.

- Page sections begin after `--space-7` on wide screens and `--space-6` on narrow screens.
- A heading sits closer to what follows than to what precedes it.
- Dense index rows use `12–16px` block padding and one rule, not card gaps.
- Search result excerpts use whitespace and a query mark; they do not need shadows.
- Metadata can wrap onto a second line. Never truncate a speaker, section, or date required to understand the record.

---

## 6. Components and interaction grammar

### Header and navigation

- The header is a compact finding aid, not a promotional masthead.
- Keep the archive name, primary search entry, current section, and language twin legible at every width.
- Treat **record language** and **interface language** as separate controls. Following civic.ai’s interior-page treatment, place the record twin as a compact, hairline-framed **English** / **華文** button beside the title; its position establishes that it changes the document, while its accessible name says “Read … transcript.”
- Keep the quieter interface control in the utility bar and state its current mode—**介面：華文** / **Interface: English**.
- Never place two bare language buttons in the same control group. Use correct `lang` attributes; flags represent countries, not languages.
- On a record-language twin link, preserve the conceptual destination and query where the data permits. Do not silently replace the page in place.
- The active item uses weight plus a short index-blue rule; colour alone is insufficient.
- Provide a skip link that lands at the page’s unique main heading or transcript.

### Search

Search is the archive’s front door.

- Label the field visibly: **Search exact words, speakers, or sections**.
- The primary submit action says **Search**, not “Go” or “Submit.”
- Exact search and AI synthesis are two modes with distinct labels and surfaces. Do not hide the difference behind a sparkle icon.
- Filters are native, labelled controls. Selected removable filters may be pills because they are true compact states.
- Query highlights use `--index-wash`, inherited text colour, and a subtle underline. Fluorescent yellow is too loud for repeated reading.
- Result count, current scope, and sort order sit together. Changing one updates a polite live region without moving keyboard focus.
- Search remains usable as an ordinary server request. Enhanced suggestions must not be a prerequisite.

### Links and buttons

- A link goes somewhere. A button changes something on the current surface.
- Primary buttons use index blue with light text; secondary buttons use a rule and transparent field; tertiary actions are underlined text.
- Every icon-only action has an accessible name and a visible tooltip on hover/focus. Prefer short text labels for uncommon actions such as **Copy citation** and **Ask archive**.
- Minimum target size is `44 × 44px`, even when the visible glyph is smaller.
- Focus is a `2px` proof-colour outline with `2px` offset. Never remove it in favour of a shadow.
- Loading labels preserve the action’s vocabulary: **Searching…**, **Copying…**, **Generating answer…**.

### Transcript turns

Each turn is a semantic article with:

- a stable DOM `id`;
- speaker identity;
- turn identifier or sequence position;
- spoken text in the record voice;
- an operable deep link;
- source metadata available to citation tools.

Do not put each turn in a card. The Turnline, speaker label, spacing, and source order are enough.

The hash target must land below sticky navigation without JavaScript timing tricks. Use `scroll-margin-block-start`. Browser find, text selection, deep links, and print are core behavior; never virtualize turns in a way that breaks them.

### Dialogs, drawers, and overlays

- Search and AI overlays use a real dialog only when they interrupt the current task. Otherwise, use an in-flow region with a stable URL.
- A modal traps focus, closes with Escape, labels itself, and restores focus to its invoker.
- On narrow screens, a drawer may occupy the viewport, but the close action stays in the first focusable region and the underlying page does not scroll.
- Overlay type remains the finding voice. Quoted source excerpts inside it switch deliberately to the record voice.

### Empty, loading, and error states

They direct; they do not perform mood.

- Empty search: **No exact matches for “…”** followed by a concrete scope or spelling action.
- No language twin: **English is not available for this section.** Keep the current page intact.
- AI without usable receipts: **No sourced answer could be assembled. Search the record instead.**
- Copy success: **Citation copied.**
- Errors name what failed and the next action. They do not apologize or say “Something went wrong.”
- Skeletons are reserved for geometry that is genuinely known. Server-rendered text should not flash through a fake loading state.

---

## 7. Page blueprints

### Home and search

The hero is an act of retrieval, not a giant archive statistic.

```text
  SAYIT / 公開發言紀錄                         華文  English

  Find the exact words.
  [ Search exact words, speakers, or sections              ] [Search]
  Search the record                                      Ask with sources

  406k+ turns · 8k+ speakers · 2k+ sections
  A quiet scale line, not three promotional metric cards.

  Recent or notable sections
  ─────────────────────────────────────────────────────────────
  Date             Section                         Speakers
```

- The title makes the promise; the field lets the person act immediately.
- Archive counts are useful orientation and proof of scope. Keep them in one metadata line and render them with tabular figures.
- Recent, popular, or curated sections are flat rows under one clear heading. Never invent editorial importance from activity alone.
- If **Ask with sources** is present, its label and explanation make generation explicit before invocation.

### Search results

- Repeat the query in an editable field at the top.
- Put scope, filters, sort, and count in one compact control band.
- Each result shows speaker, date, section, exact excerpt, query highlight, and a link to the anchored turn.
- The excerpt gets record typography; its metadata and actions get finding typography.
- Group only when grouping answers a real question, such as by section or speaker. Do not group for visual variety.
- Pagination is explicit and URL-addressable. Infinite scroll is inappropriate for a citable archive.

### Transcript / section

- Start with the section title, date/context, record identifiers, and an equal language-twin link.
- Keep search-within, copy citation, and reading-mode actions close but subordinate.
- The Turnline begins with the first source turn and continues through the section. Editorial notes interrupt it visibly and never masquerade as speech.
- Section subheadings cross the record column with a rule and retain stable anchors.
- A sticky tools rail may remain on wide screens; it must not pin the title, speaker names, or reading text into a cramped viewport.
- Arrival by deep link reveals enough preceding context to orient the reader.

### Speaker

- Lead with the canonical speaker name; place variants, transliterations, or roles directly beneath it as metadata, not badges.
- Provide **Search this speaker’s words** as the primary action.
- Show appearances as a chronological, ruled list with section, date, turn count, and anchored excerpt.
- Keep aggregate counts restrained. They are orientation, not a score.
- Speaker colour may appear in the Turnline sample or one identity rule, never as a full background.

### Speaker and section indexes

- Use typographic tables or ruled lists, not a card matrix.
- Offer native sorting and filtering appropriate to each language. Do not force Han names into a decorative A–Z scheme.
- Sticky group labels are acceptable when they preserve place and do not cover focused rows.
- Counts align with tabular figures. Long names wrap. Every row remains a real link.
- Large indexes are paginated or progressively enhanced over server-rendered links; they are not a client-only virtual list.

### AI answer with receipts

Generated synthesis must be distinguishable in shape, type, colour, and language.

```text
  AI SYNTHESIS — not the transcript
  ┃ Answer in the finding face, on a cool index wash.
  ┃ Each factual paragraph carries [1] [2] source receipts.

  Sources in the public record
  [1] Audrey Tang · Section title · turn 184
      “Exact quoted excerpt in the record face…”
      View source turn →
```

- Use a visible text label such as **AI synthesis**; never rely on sparkles.
- Set generated prose in the finding face. Source excerpts alone use the record face.
- Place receipts at the claim or paragraph they support, then repeat a complete source list below.
- Every receipt opens the exact source turn and includes speaker, section, and date context.
- Generated text never enters the Turnline and never inherits the visual treatment of a transcript.
- State when the answer was generated and what archive scope it used. Do not bury this in a tooltip.
- If receipts are absent or fail to resolve, the surface is an error state—not a finished answer.

### About, legal, and citation guidance

- Use the record voice for sustained prose and the finding voice for headings and navigation.
- Keep the English measure at `62–68ch` and zh-Hant at `34–38ic`.
- Put licences, source provenance, reuse terms, and citation examples in visibly structured sections, not a wall of fine print.
- A citation example is selectable text with a dedicated **Copy citation** action.

### Print

Print is a first-class archive surface.

- White background, black text, grayscale Turnline, no navigation, search, dialogs, sticky tools, or decorative backgrounds.
- Preserve title, date, section identifier, language, speaker names, turn anchors, licence/source note, and canonical URL.
- Use approximately `11pt / 1.55` for English and enough leading for Han; do not squeeze to save pages.
- Avoid widowed speaker labels and split short turns. Use `orphans: 3`, `widows: 3`, and conservative break rules.
- Printing an AI answer is a separate action. It must include the **AI synthesis** label and all receipts; it must never resemble transcript print output.

---

## 8. Motion and feedback

The archive should feel still until the person acts.

- No scroll reveals, parallax, floating blobs, animated counts, shimmer on server-rendered content, or ambient timeline motion.
- The signature motion is functional: arriving at a deep-linked turn strengthens its Turnline segment and fades `--index-wash` to paper over roughly `600ms` once.
- Dialog and drawer transitions may fade and move no more than `4px` over `120–160ms`.
- Search/filter updates keep geometry stable and use a quiet opacity transition only when the result truly changes.
- `prefers-reduced-motion: reduce` makes every transition immediate and disables smooth scrolling.
- Never delay text, focus, or navigation so an animation can finish.

---

## 9. Language, content, and citation voice

### Interface language

Use plain, archival verbs:

- **Search**
- **Search this section**
- **Ask archive**
- **View source turn**
- **Copy link**
- **Copy citation**
- Title-adjacent record twin: **English** / **華文**
- Utility-bar interface state: **介面：華文** / **Interface: English**

Avoid promotional copy such as “Discover insights,” “Unlock the conversation,” or “Experience AI-powered search.” The archive is already valuable; the interface need only make it usable.

### Bilingual mechanics

- Set the document `lang` correctly and mark every meaningful language change.
- Provide canonical and `hreflang` metadata for real language twins.
- Translate interface vocabulary consistently; the same action keeps the same name through button, loading state, and confirmation.
- Do not use flags, automatic locale assumptions, or unlabeled globe icons.
- Switching the interface language must never hide, replace, or reinterpret the transcript’s record language.
- Preserve names as the record presents them while exposing canonical/transliterated forms where the data supports it.
- Localize date order and number formatting without changing stable identifiers.

### Citations

A copied citation should include, where available:

1. speaker;
2. exact section title;
3. date;
4. stable turn identifier;
5. canonical URL;
6. archive/source name.

The visible source and copied value must agree. A copied citation may add structured context, but it may not alter the quoted words.

---

## 10. Accessibility is structural

Target WCAG 2.2 AA as a floor.

- One unique `h1`; logical headings; `header`, `nav`, `main`, `article`, and `footer` landmarks.
- A keyboard user can reach search, language twin, every turn anchor, citations, filters, pagination, and dialog controls in a predictable order.
- Speaker identity, selected filters, active navigation, errors, and AI provenance never rely on colour alone.
- Body and transcript text reflow at `320px` CSS width and at `200%` zoom without horizontal reading scroll.
- Text contrast meets AA; interactive boundaries and focus meet non-text contrast requirements.
- Links in prose are recognizable without hover. Hover-only anchor affordances become persistent on touch/coarse pointers.
- Search results and generated-answer status use restrained live regions; the transcript itself is not a live region.
- Dialogs trap and restore focus. Hash navigation moves focus only when the action explicitly asks to navigate; loading a shared URL must not unexpectedly steal it.
- Respect reduced motion, forced colours, increased contrast, and user font-size preferences.
- Source order remains meaningful without CSS. The Turnline enhances it; it does not create it.
- Touch targets are at least `44px`; adjacent turn actions have enough separation to avoid accidental activation.
- Test with keyboard only, VoiceOver/Safari, one Chromium screen reader pairing, 200% zoom, forced colours, and font loading blocked.

---

## 11. Performance and resilience

The record should arrive before its enhancements.

- Server-render the page title, metadata, transcript/search content, language links, and pagination. Reading and following source links must work without JavaScript.
- Keep one canonical global design layer. Do not duplicate base type, colour, and spacing rules inside every Vue view.
- Inline only genuinely critical shell CSS; load the canonical stylesheet normally so it can be cached across routes.
- Self-host compact Latin WOFF2 assets. Subset by script, not by fragile page-specific character lists. Preload at most the immediately used regular face.
- Load the Justfont exception asynchronously without hiding fallback text. Remove the current Google font dependency once the system/owned fallback path is in place.
- Aim for `CLS < 0.05` on font swap. Tune fallback metrics where controlled; never use fixed-height clipping to conceal movement.
- Keep initial design-layer CSS below roughly `35 KiB` compressed and the route’s critical Latin fonts below roughly `160 KiB` compressed. These are budgets, not reasons to omit required glyphs or accessibility.
- Long transcripts may be paginated at stable boundaries, but never client-virtualized in a way that breaks browser find, anchors, selection, print, or source order.
- Do not load Open Graph rasterization assets in the browser. OG output belongs in metadata only.
- A failed enhancement leaves a readable archive, not a blank shell, uncloseable overlay, or missing language link.

---

## 12. Metadata and shared presentation

- Page titles begin with the specific speaker, section, or query; the archive name follows.
- Descriptions state what the record contains, not generic SEO copy.
- Canonical and alternate-language links reflect real routes.
- `theme-color` follows paper/night paper rather than index blue; browser chrome should not overpower the reading field.
- Open Graph images may use the licensed Lanyang image pipeline. They remain raster output and must include equivalent text metadata outside the image.
- A shared visual change must reach SSR HTML, hydrated Vue, error pages, and print. No route should retain an accidental second brand.

---

## 13. What this design refuses

- Warm beige plus terracotta as an automatic “human” aesthetic.
- Broadsheet cosplay, ornamental column rules, and newspaper mastheads.
- Dark gradients, glowing panels, glass, and ambient shadows.
- Card grids for transcripts, search results, speakers, or legal prose.
- Giant metric tiles as the home-page thesis.
- Neon speaker-name text or colour as the only identity cue.
- Monospace dates, labels, and turn IDs as a substitute for hierarchy.
- Flags for language and sparkles for AI.
- A generated answer styled like a source turn.
- Centered long-form copy, justified transcript text, tiny metadata, and truncated speaker names.
- Infinite scroll or virtualization that destroys stable position.
- Client-only access to public record content.
- Hidden text while fonts load.
- Synthetic Ming bold, synthetic English italic, or Lanyang binaries committed to the repository.
- A second token system living beside the first “temporarily.” Migration is a clean cutover, route by route.

---

## 14. Repository implementation map

The design should land as one system, not a collection of view-local overrides.

| Area | Responsibility |
|---|---|
| `src/styles/design.css` | canonical tokens, font roles, global type, focus, controls, layout primitives, Turnline, responsive and print rules |
| `src/ssr/render.ts` | link the canonical layer, retain only truly critical SSR shell CSS, apply document language/theme hooks, remove duplicated global styling |
| `src/ssr/heads.ts` | own self-hosted font hints, the single Justfont loader integration, canonical/alternate metadata, theme colour, and OG references |
| `src/components/Navbar.vue` | textual language twins, compact search/navigation, skip-path compatibility, responsive focus order |
| `src/components/Footer.vue` | source, licence, language, and archive identity without a second navigation system |
| `src/views/*` | semantic page structure, page-specific composition, real `lang` boundaries, and reuse of canonical primitives rather than copied CSS |
| `src/utils/speakerColor.ts` | stable restrained speaker palette with light/night outputs and no identity-by-colour assumption |
| `public/static/speeches/css/speeches.css` | legacy source to retire after each migrated route reaches parity; not a permanent override layer |
| existing OG renderer | preserve licensed local-font → raster-only output; never expose the font binary to the web build |

### Build order

1. **Foundation:** canonical CSS, colour/spacing tokens, English font assets, Justfont integration, fallback states, shell, focus, language links.
2. **Record:** transcript typography, stable turn semantics, Turnline, deep-link arrival, citation action, responsive composition, and print.
3. **Retrieval:** home/search, result rows, filters, pagination, indexes, and speaker pages.
4. **Synthesis:** AI answer surface, claim-level receipts, failure states, and source-return behavior.
5. **Cutover:** remove migrated inline/view CSS and legacy rules, then verify every route in both languages, both colour schemes, fallback fonts, and print.

Do not maintain aliases for old component styles. Move a route to the canonical layer, verify it, and delete the obsolete rules that served that route.

---

## 15. Definition of done

A surface belongs to this design only when:

- its source record reads comfortably in both English and zh-Hant at the prescribed measure;
- its fallback-font state remains visible, legible, and structurally stable;
- its sequence, speaker, date, section, language twin, and stable return path are apparent;
- keyboard, touch, zoom, reduced-motion, and screen-reader paths work;
- AI material is unmistakably generated and every usable claim returns to a source turn;
- it uses the canonical tokens and components with no competing local design system;
- it works as server-rendered HTML before enhancement;
- its print form preserves the record and removes interface noise;
- no gradient, card, icon, colour, animation, or typeface is present without a job.

The final test is simple: after ten minutes in a transcript, the reader should remember the exchange—not the interface—and still be able to return to the exact sentence that mattered.
