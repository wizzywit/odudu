# Odudu brand assets

Status: **approved by the owner on 2026-10-21**, with the crossbar as a collar
under the ring. The mark is what every server page, the mail shell and the
documentation site carry.

The mark is a staff, the sign of authority carried: a ring on a straight shaft
with a short crossbar.

## Files

| File                                       | What it is                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark.svg`                                 | The staff on a 32 grid, one colour (`currentColor`), so it themes                                                                           |
| `wordmark.svg`                             | `odudu` as five outlines, one colour                                                                                                        |
| `mark-ink.svg`, `mark-paper.svg`           | The mark in the Instrument ink for a light and for a dark surface, for places that cannot take `currentColor` (an image tag, the docs logo) |
| `lockup.svg`                               | Mark left, wordmark right, one baseline                                                                                                     |
| `lockup-paper.svg`                         | The lockup in the Instrument paper colour, for a dark surface where `currentColor` cannot be set (the README on a dark theme)               |
| `NOTICE.md`                                | Who owns the name and the mark, and where the policy is                                                                                     |
| `favicon.svg`, `favicon.ico`               | Mark on the Instrument rail surface, amber ring; the icon holds 16, 32 and 48                                                               |
| `apple-touch-icon.png`, `icon-192/512.png` | The same tile, the mark inset to 75%, square corners                                                                                        |
| `social.svg`, `social.png`                 | 1200 x 630 share image: lockup and tagline on the rail surface                                                                              |
| `LICENSE-IBM-Plex-Mono.txt`                | The font licence that covers the wordmark outlines                                                                                          |
| `geometry.ts`, `tsconfig.json`             | Where the mark sits in each tile; the type-check of `build.ts` and this file                                                                |
| `build.ts`                                 | Exports every PNG and the ICO from the SVGs: `node brand/build.ts`                                                                          |

## Construction

The grid is 32 by 32. The shaft is a line at x=16 from y=10 to y=30. The ring
is a circle centred on (16, 6) with radius 4, and the shaft starts on the
ring's lower stroke, on its centreline, so its round cap meets the ring's inner
edge without entering the hole. The crossbar, a collar, is a line at y=14 from x=12 to x=20. One stroke width, 2,
with round caps, is set once on a group. Everything sits on whole grid units
and the mark is symmetric about x=16.

At 16 px the stroke is one pixel wide and lands between two pixels, so the
shaft renders as two half-covered columns; the ring's hole stays open. The
test in `tests/lint/brand-assets.test.ts` holds both facts.

### The crossbar

The owner chose the collar on 2026-10-21 from three heights, the sheet
`docs/phases/p4g-docs/brand-candidates.png`. With the bar at y=20 or y=25 the
figure reads as the sign for Venus, which is not what a carried sign of
authority should say. At y=14, directly under the ring, it reads as a sceptre.
The test holds the bar to the top quarter of the shaft.

## Colour

The mark, wordmark and lockup take the colour of the text around them. The
favicon and social image use Instrument's own tokens
(`apps/admin-console/src/shared/ui/tokens.css`) and nothing else: the rail
surface `#111514`, the rail ink `#e4e9e7`, the system amber `#f7c95a` for the
ring (amber means authority and nothing else; the owner kept the amber ring
on 2026-10-21, and the plan does not ask for another), and the jade `#4fc894` rule.

## Wordmark

The lowercase word `odudu` is set in IBM Plex Mono Medium at 26 units on the
grid's baseline (y=31) and converted to outlines, so it renders the same
everywhere and no page fetches a font for it. IBM Plex Mono is licensed under
the SIL Open Font License 1.1, which permits embedding glyph outlines in a
logo; the licence text is `LICENSE-IBM-Plex-Mono.txt`. The tagline on the
social image is the same font at weight 400, also outlined.

The script that produced them is not committed: it needs opentype.js, which the
repository does not depend on, and the outputs are committed and held by
`tests/lint/brand-assets.test.ts`. The outlines were produced once with opentype.js 1.3.4 from
`@fontsource/ibm-plex-mono` 5.3.0 (`ibm-plex-mono-latin-500-normal.woff`),
`Font.getPath(character, x, 31, 26)` with the advance of one glyph, 15.6 units,
between letters. The repository does not depend on opentype.js; the outputs are
committed.

## Use

- Clear space: at least the height of the ring (8 units) on every side of the
  mark on its own. The app tiles carry the mark inside their own padding instead:
  the favicon at 87.5% of the tile, the touch and install icons at 75%
  (`geometry.ts`).
- Minimum size: the mark 16 px high, the lockup 96 px wide.
- Put the mark on a surface that gives it 4.5:1; Instrument's pairs do.
- Do not recolour the ring except to the system amber, outline the strokes,
  change the stroke weight, rotate, skew, add effects, or redraw the crossbar.
- Do not use the mark to suggest that a product is made or endorsed by the
  Odudu project.

## Trademark

The name Odudu and the staff mark belong to their owner; [`NOTICE.md`](NOTICE.md)
says whose, and [`../TRADEMARK.md`](../TRADEMARK.md) says what anyone may do
with them. An informal web search on 2026-10-15 found no
product, company or trademark filing named Odudu in identity or software. It
cannot compare logos by eye and is not a clearance; a formal trademark and
design search stays an optional step before any commercial use.

## Keeping the derivatives honest

`node brand/build.ts` rebuilds every PNG and the ICO from the SVGs.
`node brand/build.ts --check` rebuilds them in memory and compares each with
the committed file. Chromium's output is not promised to be byte-identical across
machines, so the comparison is by pixel: no more than 0.5% of pixels may differ
by more than 12 in a channel, and none by more than 64. The brand test runs the
check. The same test reads the mark out of `lockup.svg`, `favicon.svg` and
`social.svg` and fails if any differs from `mark.svg`.

## Where the mark is used

`packages/instrument/src/mark.svg` (the mark inlined by the four server page
renderers and drawn in headers), the console's `BrandLine` component, the
mail rasteriser and the documentation site each carry the same three shapes, and
`tests/lint/brand-assets.test.ts` fails when any differs from `mark.svg`. The
favicon and touch icon in `packages/instrument/src` and the files under
`apps/docs/static/brand` are copies of the files here, held byte for byte by
the same test.

The browser tab shows one icon everywhere. The console shell, every server
page and the documentation site link `favicon.svg`, with `favicon.ico` as the
fallback, never the bare `mark.svg`. The server serves the
two favicon files under `/instrument/` and answers `/favicon.ico` with the same
icon. Like the stylesheet they revalidate by etag, because their names carry no
hash.
