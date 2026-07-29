# Country programme materials

Generated collateral for five countries: **Georgia, Armenia, Kyrgyzstan, Ethiopia, Bhutan**.

Per country: one long-form memorandum (A4) plus four proposal decks (16:9) —
**stablecoin**, **gaming clubs**, **hardware sponsorship**, **schools & universities**.
The hardware deck pitches sponsorship, not distribution: $5,000 a season plus
hardware as prizes — "there is no AI without GPUs; we are building the AI community."
Armenia and Kyrgyzstan are additionally generated in Russian.

```
node build.mjs        # writes dist/ — 35 pages + an index
open dist/index.html
```

## Layout

| file | purpose |
|---|---|
| `src/data.mjs` | country facts and the shared economic model (`SOLD_UTIL`, `nodeHour`, `clubMonth`, `payback`, `talent`) |
| `src/strings.mjs` | every word, EN and RU, as a function of the country |
| `src/styles.mjs` | two stylesheets: A4 serif memorandum, 16:9 sans deck |
| `src/svg.mjs` | inline SVG: corridor diagram, bar charts, day ring, rig grid, timeline, icons |
| `src/doc.mjs` | memorandum template |
| `src/decks.mjs` | the four deck templates |

Change a number in `data.mjs` and every derived figure across all 35 pages moves with it.

## Printing

Print from the browser and choose *Save as PDF* with background graphics enabled.
Decks page at 297×167 mm (16:9); the memorandum at A4 portrait.
No external images — everything is inline SVG, so output is identical offline.

## Before these go out

- **Contact lines are placeholders.** Every deck closes with
  `Telegram - @bogidotcom`. Fill in `contactFill` in `src/strings.mjs`.
- **Figures are internal modelling estimates**, not audited statistics — country
  indicators (workforce, students, club counts, electricity, wages) in `data.mjs`
  are working assumptions and should be replaced with sourced numbers before
  anything is shown to a ministry. Each page says so in its footnote.
- The settlement premise stated throughout is **direct**: client EUR/USD enters
  each country to a licensed local entity, converts once at wholesale into the
  local stablecoin, and is paid out to the community. There is no intermediary
  hub jurisdiction and no intermediary token (GELT is only Georgia's own local
  stablecoin, not a rail for the other countries).
