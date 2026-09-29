# Trace the Alphabet ✏️

A finger-tracing app for young children (A–Z, a–z and 0–9), built as a plain
static web app. No build step, no dependencies, no network calls.

It works on iPad, iPhone, Android tablets/phones, touchscreen laptops, and with
a mouse or Apple Pencil.

## What it does

- **All 62 characters** — uppercase A–Z, lowercase a–z and numbers 0–9.
- **A worksheet page per letter** — the letter appears **6 times** on the page
  (configurable: 2, 4, 6 or 8). Each copy is traced separately, the one to work
  on glows, finished ones get a green ✓, and the next letter only loads when the
  whole page is done.
- **Correct stroke order and direction** — each letter is split into numbered
  strokes. On guided copies, a green ① dot shows where to start and arrows show
  which way to go. The next stroke only unlocks when the current one is finished.
- **Natural, continuous strokes** — the pen only lifts where it really would.
  `d` is one stroke: round the bowl, up the stem and back down without lifting.
  Same for `a b g h m n p q r u` and uppercase `K`. Only `f i j k t x y`,
  digit `4` and the multi-part capitals need a genuine lift.
- **Half guided, half from memory** — on every page the first half of the copies
  show the start dot, the arrows and the dashed centre line. The rest show only
  the plain road: no start circle or arrows, even after a missed start. The
  child figures out where to begin while tracing the same checked stroke path.
- **"Watch" demo** — a yellow dot draws the letter first, one stroke at a time.
- **Stay-on-the-road feedback** — the letter is drawn as a wide grey "road".
  While the finger stays on it, coloured ink follows the path. The moment the
  finger leaves the road the child gets:
  - a **vibration / haptic buzz** (where the hardware supports it — see below),
  - a **red screen flash + shake**,
  - a **red ring** at the exact spot they went off,
  - a low buzz sound.
  Progress simply stops until they come back onto the road — nothing is erased,
  so a 4-year-old never has to start over out of frustration.
- **No cheating** — you cannot skip ahead, trace backwards, or jump to the end.
- **Rewards** — chime, confetti and up to ⭐⭐⭐ per letter, saved on the device.
- **Marks 🏅** — every completed page is worth one mark, and the running total
  stays on screen as the child moves from page to page.
- **Voice** — says the letter, then pauses, then the example word
  ("Small b." … "b is for ball.") and the phonic sound. Numbers are counted out
  loud ("Number five." … "Count with me. one, two, three, four, five.").
- **Letter size** — `A−` / `A+` in the footer (or `-` / `+` on a keyboard) grow
  and shrink the letter itself. The page layout, the number of copies and the
  cell positions never move; only the glyph inside each cell changes, and it is
  always kept inside its own cell.
- **Dark theme** — Settings → Dark theme, for bedtime practice.
- **Difficulty** — Easy / Normal / Tricky changes how wide the road is.
- **Works offline** once installed to the home screen.

## Use it on the iPad (recommended)

It is hosted on GitHub Pages:

**<https://cooltodinesh.github.io/just-kidding/>**

Open that in Safari on the iPad, then tap **Share → Add to Home Screen**. It
launches full screen with no browser bars and keeps working with no wifi, which
is what you want for a toddler.

Pages serves over HTTPS, which is what makes the offline mode work — a plain
`http://192.168.x.x` address cannot register a service worker.

### Publishing changes

```bash
git add -A && git commit -m "your change" && git push
```

Pages redeploys automatically in about a minute. The app is network-first, so
an installed copy picks up the new version the next time it opens online.

## Run it locally

```bash
cd just-kidding
python3 -m http.server 8080 --bind 0.0.0.0
```

- On this computer: <http://localhost:8080/>
- On the iPad / phone on the same wifi: `http://<your-computer-ip>:8080/`
  (find it with `ipconfig getifaddr en0`)

You can also open `index.html` by double-clicking it — everything works except
offline caching, which needs a real server.

## About vibration — read this first

| Device | Vibration feedback |
| --- | --- |
| Android phone / tablet (Chrome, Firefox) | ✅ Real vibration via the Vibration API |
| iPhone, iOS 17.4+ (Safari) | ✅ Taptic buzz, via the hidden `<input type="checkbox" switch>` trick |
| **iPad** | ❌ **Not possible — iPads have no vibration motor at all** |
| Touchscreen laptop / desktop | ❌ No hardware |

Safari does not implement `navigator.vibrate`, and more importantly no iPad model
contains a vibration motor, so *no* app — web or native — can make an iPad buzz.
That is why the out-of-line feedback is deliberately multi-sensory: the red
flash, the screen shake, the red ring and the buzz sound all fire together, and
they are very obvious on an iPad.

If you specifically want a buzz in the child's hand, use an Android tablet, or
an iPhone on iOS 17.4+ with **Settings → Sounds & Haptics → System Haptics** on.

## Files

```
index.html               markup and the settings/letter sheets
css/styles.css           layout and animations
js/letters.js            stroke data for all 62 characters (generated from arcs + lines)
js/tracer.js             path sampling, progress tracking, on/off-road detection
js/feedback.js           haptics, sound effects (WebAudio), speech
js/app.js                canvas rendering, pointer handling, UI, storage
manifest.webmanifest     home-screen install metadata
sw.js                    offline cache
icons/                   app icons
tools/                   development helpers, not shipped to the child
```

### Tools (development only)

macOS ships a JavaScript engine that these use:

```bash
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

# logic tests for the tracing engine
$JSC tools/test_tracer.js

# render every letter to a PNG to check shapes, stroke order and direction
$JSC tools/dump_letters.js > /tmp/letters.json
python3 tools/render_check.py /tmp/letters.json /tmp/upper.png upper
python3 tools/render_check.py /tmp/letters.json /tmp/lower.png lower
python3 tools/render_check.py /tmp/letters.json /tmp/digits.png digits

# regenerate the app icons
python3 tools/make_icons.py
```

In the rendered check sheets: red dot = stroke start, black dot = stroke end,
gold dot = one third along (so you can see the direction), and each stroke gets
its own colour in drawing order.

## Adjusting a letter

Every letter lives in `js/letters.js` on a 120 × 170 "paper":

| y | meaning |
| --- | --- |
| 22 | capital / ascender top |
| 68 | midline (x-height) |
| 124 | baseline |
| 158 | descender bottom |

Strokes are SVG path strings using only `M`, `L` and `A`. Curves are written
with the `arcSeg(cx, cy, rx, ry, startAngle, endAngle)` helper — angles are in
degrees, `0°` points right, and **increasing** angles sweep clockwise on screen.
The order of the strokes in the array is the order the child must draw them.
