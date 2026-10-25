# Design

Puckquake is a seismograph for a hockey league. The page should feel like
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
| Puckquake        Live now: 3 games      Leaders  What if  How |
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
| Data from NHL.com. Puckquake is not affiliated with ...       |
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

## First visit and the polish pass (2026-10-09)

**The shockwave outranks the chrome.** Rings draw at alpha 0.62 or more
(0.95 cap) with a thicker front. Change labels claim a free spot above,
higher above, or below their ring, and are skipped rather than stacked in
the crowded Northeast. The origin's M label scales with magnitude (17 to 29
px) and stays four seconds. Competing weights were demoted: Pause is an
outline button, and replay status lives in Home's tinted title block
("October 8, replayed" and the next live time) instead of an ink banner
that inverted in dark mode and shifted the page when it arrived. (Live score
chips beside teams were removed on 2026-10-24; see below.)

**One page frame.** Content pages share `max-w-6xl` and one title size
(38 px on phones, 60 px above). A paragraph after a display heading gets
0.4rem unless it sets its own spacing. Radii are the 6 px token only.

**Paint keeps its meaning.** The rink chart separates teams by tone (ink
and ink-soft), not blue. Team tremor lists lead with that team's change,
in blue or red, with magnitude in the details. Overturned goals keep full
contrast and strike out their number. Magnitudes under 1 drop to a
lighter weight.

**Touch.** On phones, the first tap on a team previews it (odds, game, an
Open button); the second opens it. The map key sits behind a Map key
button instead of disappearing.

**The key never covers a team.** Team logos draw above the key, so a team
under it showed through. From tablet width the key looks for a spot along
the bottom edge, then the top, that clears every team: tall and narrow
first, then wide and short.
When no spot is clear it folds behind the same Map key button as phones.

**The walkthrough** (`web/src/tour/`). Seven steps over the real page:
welcome (live or replay, in plain words), the rings, the shockwave (blue,
red, pp, M), the timeline, the games and stakes, my team, and the other
pages. A spotlight cut from a dim layer outlines the target in blue (the
focus color); clicks pass through, so the page stays usable. On desktop
the card sits beside the target; on phones it docks at the bottom and the
target scrolls to the top. It opens once for a first visitor after the
map loads, is skippable from every step and with Esc, moves with the arrow
keys, and replays from "How to read this" on Home or "Take the tour" in
the footer (`/?tour=1`). Seen state is `aftershock.tourSeen` in local
storage.


## Launch pass (2026-10-23 to 24)

**Puckquake.** The site was renamed from Aftershock (the code, database, and
browser storage keys keep the old name). The wordmark is the name in Big
Shoulders Display; the icon is the seismograph mark.

**One column everywhere.** The header, every page's content, Tonight's title
band, and a replayed night's title sit in the same `max-w-6xl` column, so the
logo never moves between pages. Only the home map, its panels, and the
timeline run edge to edge beneath it. A title says "replayed" once; there is
no separate Replay tag.

**The footer** carries the wordmark and maker, Explore and About links, a
Sources list (each source with its link), every team by division, and the
disclaimer. Every page is at least a screen tall, so the footer never shows
under a page that is still loading and then jumps away.

**The map** shows no numbers beside teams. Both teams in a game on now get a
red outline, and the home team's circle pulses. Scores are in the games list
beside the map and in each team's hover card.

**Panels beside the map**, on Tonight and on every replayed night, have two
tabs: the night (its games, tonight's upcoming games while a replay runs, its
goals, and the recap) and Standings.

**Replays.** Next goal and Restart keep playing and land just before the
moment, so the goal's shockwave and magnitude play out on the map.

**Standings** (`/standings`, formerly Teams) has Division, Wild card,
Conference, and League views. A darker rule marks the playoff line where one
exists (third in a division, the last wild card); in the conference and
league views a dark bar marks each team in a playoff spot today.

**Game page rink.** Every shot dot opens a small card on hover or tap: the
shooter's photo, time, shot type, and chance of scoring; goals add their
magnitude, the scoring team's change in playoff odds, and a link to the goal.
The home team's logo sits faded (14 percent) at center ice.

**What-If Lab.** Each game shows its favorite's chance. Sorting by biggest
change shows before, with your picks, and change. The projected bracket is a
full-width section below the picks, every round showing the favorite's
chance to win the series. Picks never move the page. Below laptop width the
picks, the forecast, and the bracket take turns on screen (Picks, Forecast,
Bracket in the sticky summary bar, with sharing as an icon beside them)
instead of one 14-screen page. Links are short (`/what-if?id=...`, saved picks) and their preview is the
server's 1200 by 630 card of the same scenario. The card the menu shares is
1200 by 675, drawn on a canvas in the viewer's light or dark palette, with
no logos so the canvas is never tainted. How it works has a "Use the What-If Lab" guide, linked from the lab.

**Sharing.** The What-If Lab, goal pages, and game pages share through one
menu (`components/ShareMenu.tsx`; a sheet along the bottom on phones) with
three options in this order: Post on X, Share, Copy link. Post on X copies
the card picture as it opens X's composer, so the post carries the picture
(paste it in) and X shows no link preview; X's share link cannot attach a
picture itself, and where a browser will not copy one, the card downloads
instead. Share opens the phone's share sheet with the card; where a browser
cannot share files (most laptops) it is Download image. Goal and game cards
are drawn by the server (`/api/og/tremor`, `/api/og/game`), which also uses
them as the pages' link previews.

**Map zoom.** Ctrl or cmd and scroll (or a trackpad pinch) zooms at the
pointer, two fingers pinch on a touch screen, and once zoomed a drag pans;
+, -, and reset sit in the map's top right. Plain scrolling stays with the
page (a hint says how to zoom), and on touch one finger scrolls the page
until the map is zoomed in. The projection itself is scaled, so team circles
keep their size and crowded areas like New York spread apart.

**Phones.** Long lists start short with a Show all button (team pages,
`components/PhoneFold.tsx`); the footer shows team logos by division and
the sources as one sentence; Leaders rows are one tap target each with the
team code on top.

**Charts.** Percentage charts label their shared corner once. Calibration
charts zoom to where their predictions are and list the diagonal in the
legend. Team odds charts mark forecast model updates with a dashed line, so a
step from a model change is not read as something on the ice.

**Live clock** wording: "2nd 12:34", "End 1st" in an intermission, and
"Start of 2nd" before a period's puck drop.
