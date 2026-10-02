# Design

Aftershock is a seismograph for a hockey league. The page should feel like
standing at the glass of a freshly resurfaced rink while the arena lights
are on: pale, cool, quiet. Then a goal horn goes off somewhere on the
continent and the ice cracks outward. All of the visual boldness is spent on
that moment. Everything else is disciplined.

**Audience:** hockey fans who follow the standings race, from casual (my
team, tonight) to stats-minded (PPA, methodology). **Primary job:** show,
at a glance, how every goal tonight changes every team's playoff odds.

## Plan (first pass)

### Color

Two themes, each designed. The only saturated colors are the two paints on
a real rink.

| Token | Light: arena lights on | Dark: arena lights down | Role |
|---|---|---|---|
| `--ice` | `#EEF3F6` | `#0D1822` | Page background (fresh ice / dim arena) |
| `--ice-land` | `#DDE7ED` | `#16242F` | Land fill on the map, panel wells |
| `--ice-scratch` | `#C9D6DF` | `#233543` | Borders, province lines, hairlines |
| `--ink` | `#14212B` | `#E3EBF0` | Text, node rings at rest |
| `--ink-soft` | `#5D707E` | `#8EA2B0` | Secondary text, axes |
| `--goal` | `#C8102E` | `#FF4A57` | Goal-line red: tremor origin, goal lamp, falling odds |
| `--blue-line` | `#0B4FA8` | `#5AA2FF` | Blue-line blue: rising odds, focus rings, links |

Dark mode is not an inversion: the land becomes a lit surface slightly
above the arena floor, the red brightens to read as a lamp glowing in the
dark, and the shockwave gets an additive glow it does not have in light.

### Type

- **Display: Big Shoulders Display** (Google Fonts, 600 to 800). Designed
  for Chicago civic signage; condensed and sturdy, it reads like arena
  banners and jersey numbers. Used for team codes on the map, magnitudes,
  the wordmark, and big numbers. Never for sentences.
- **Text: Overpass** (400 to 700). The open-source descendant of Highway
  Gothic, the US road-sign lettering of arena exits, concourses, and old
  scoreboards. Civic signage like Big Shoulders, so the two read as one
  building. All numbers use `font-variant-numeric: tabular-nums`.
  (Replaced Instrument Sans on 2026-09-30, see DECISIONS.)
- Scale (1.25 ratio from 15 px): 12, 13, 15, 19, 24, 30, 38, 60, 96.
  Panel and section titles use the display face (24 px in the home rail,
  30 px on pages); group labels are 15 px text 600; rows 13 to 14 px.
  Line height 1.45 for text, 0.9 to 1.0 for display numerals.

### Layout

Desktop: the map is the page. It fills everything left of a single
right-hand rail; the seismograph runs the full width along the bottom like
the strip under a real seismometer.

```
+----------------------------------------------------------------+
| Aftershock        Live now: 3 games      Leaders  What if  How |
+-----------------------------------------------+----------------+
|                                               | Tonight        |
|              MAP (ice sheet, 32 nodes)        |  game rows     |
|         shockwave rings expand from venue     |  stakes meter  |
|                                               |----------------|
|                                               | Standings /    |
|                                               | Tremors  (tabs)|
+-----------------------------------------------+----------------+
| seismograph trace ~~~^~~~~~~~~^^~~~~~~~~~ needle |  scrubber     |
+----------------------------------------------------------------+
| Data from NHL.com. Aftershock is not affiliated with ...       |
+----------------------------------------------------------------+
```

Mobile: map full width on top (about 55 vh), seismograph under it, panels
in a bottom sheet with three tabs (Tonight, Standings, Tremors).

Everything is left aligned. Numbers in tables are right aligned. The rail
is a single column of sections separated by rules, not a stack of cards.

### Principles

1. **One loud thing.** The shockwave, the goal-lamp flash, and the rising
   delta labels are the only animated, saturated elements. Panels, tables,
   and type stay still and quiet.
2. **Paint means something.** Red is always "a goal happened here" or "odds
   went down". Blue is always "odds went up" or "you are focused here".
   Team colors are a 3 px tick, never a fill.
3. **Signs and arrows, not just color.** Every change carries a sign and a
   direction glyph, so color is never the only signal.
4. **Replay is never mistaken for live.** Replay mode tints the header
   strip and carries a persistent, plain-language banner.
5. **Numbers are the texture.** Percentages with one decimal, changes in
   `pp`, tabular figures everywhere so columns never jitter while they
   update.

## Review against generic defaults (second pass)

- *Near-black background with one acid accent:* the dark theme risked
  landing here. Revised: the dark base is a blue-slate arena floor
  (`#0D1822`) with the land as a lit surface above it, and there are two
  accents with fixed meanings, not one decorative accent.
- *SaaS card kit:* the first sketch had Tonight, Standings, and Tremors as
  three rounded cards with shadows. Revised to one rail of sections divided
  by `--ice-scratch` rules, with a single radius (6 px) used only on
  interactive controls.
- *All-caps tracked eyebrows over every heading:* removed. Section headings
  are sentence case in the display face, and the display face is kept for
  numbers and team codes, where its signage character belongs.
- *Monospace for small data labels:* rejected. Tabular Overpass does
  that job without the "dashboard template" tone.
- *Big number, small label, gradient accent hero:* the hero is the map and
  its motion, not a stat block. The only big number is the magnitude of the
  latest tremor, shown next to its origin.
- *Middle-dot meta strings and arrow-suffixed links:* banned in copy.
  Metadata is set as separate, aligned columns.

What survived review: the ice palette and rink paints (from the subject,
not a trend), Big Shoulders Display (signage, specific to arenas), the
seismograph strip (specific to the product metaphor), and the single-rail
layout.

## Motion

- Shockwave ring: constant screen speed, crossing the continent in about
  2.5 s. Thickness and opacity scale with magnitude. Magnitude 6 and above
  adds a 250 ms screen shake.
- Node update when the ring front passes: gauge arc eases to its new value
  over 600 ms; a signed label rises 14 px and fades over 1.4 s.
- Reversal: the ring contracts back into the origin and the venue shows
  "No goal".
- Reduced motion: no rings, no shake, no rising labels. Values change
  instantly with a 1 s highlight behind the changed number.

## Archived nights

The archive is an invitation to replay a night. Lead with its real games,
team logos and recap headline, then the season's ranked biggest nights.
The calendar is the browsing tool below, with a visible shading key.

An individual night gives the map the first viewport and puts the full
recap in a two-column article below it. Games, tremors and standings share
one switchable rail. Playback controls follow the map directly on phones;
the persistent Replay label distinguishes recorded action from live games.

## Main fan routes

Tonight keeps the live map as the centerpiece, but personal context is
available before it on phones. Current games precede the previous recap.
Labels distinguish game win chances, playoff chances and playoff stakes.
Nearby timeline goals share a chooser rather than overlapping click areas.

Leaders is an editorial list with original ranks, real player imagery and
room to search. Keep selected season and metric visible and shareable.
What If puts the result of a pick within reach, with explicit win types and
plain scenario scope. The odds lead; projected brackets are secondary.
How It Works answers the fan's vocabulary first, then exposes complete
technical evidence on demand. Both casual reading and detailed scrutiny
must remain possible. Errors preserve usable content and provide recovery.

Tonight uses a compact 38vh phone map with a 260px minimum for its geographic
controls. Its desktop rail is 440px wide, balancing games against the map.

The timeline has two distinct layers: the impact trace above, goal controls
below. Persistent magnitude labels stay off the curve; goal details retain
them. A short heading/key and current or replay time make the signal readable.
