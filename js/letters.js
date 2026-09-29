/* Letter stroke data.
 *
 * Coordinate system (the "paper"): 120 wide x 170 tall.
 *   y = 22  -> ascender / capital top
 *   y = 68  -> midline (x-height top)
 *   y = 124 -> baseline
 *   y = 158 -> descender bottom
 *
 * Every letter is a list of strokes, in teaching order.
 * A stroke is either { d: "<svg path data>" } or { dot: true, x, y }.
 */
(function (global) {
  'use strict';

  var CAP = 22;
  var MID = 68;
  var BASE = 124;
  var DESC = 158;

  function rnd(n) {
    return Math.round(n * 100) / 100;
  }

  function ptOn(cx, cy, rx, ry, deg) {
    var a = (deg * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  }

  /* Arc commands only (no leading move). Angles in degrees, SVG space
   * (0 = right, 90 = down). Increasing angle = clockwise on screen. */
  function arcSeg(cx, cy, rx, ry, a0, a1) {
    var total = a1 - a0;
    var steps = Math.max(1, Math.ceil(Math.abs(total) / 120));
    var step = total / steps;
    var sweep = total > 0 ? 1 : 0;
    var out = '';
    for (var i = 1; i <= steps; i++) {
      var p = ptOn(cx, cy, rx, ry, a0 + step * i);
      out += ' A' + rnd(rx) + ',' + rnd(ry) + ' 0 0 ' + sweep + ' ' + rnd(p.x) + ',' + rnd(p.y);
    }
    return out;
  }

  function M(cx, cy, rx, ry, a) {
    var p = ptOn(cx, cy, rx, ry, a);
    return 'M' + rnd(p.x) + ',' + rnd(p.y);
  }

  function arcPath(cx, cy, rx, ry, a0, a1) {
    return M(cx, cy, rx, ry, a0) + arcSeg(cx, cy, rx, ry, a0, a1);
  }

  function dot(x, y) {
    return { dot: true, x: x, y: y };
  }

  /* ---------- uppercase ---------- */

  var UPPER = {
    A: ['M60,22 L28,124', 'M60,22 L92,124', 'M40,94 L80,94'],
    B: [
      'M32,22 L32,124',
      'M32,22 L58,22' + arcSeg(58, 47.5, 25, 25.5, -90, 90) + ' L32,73',
      'M32,73 L60,73' + arcSeg(60, 98.5, 27, 25.5, -90, 90) + ' L32,124'
    ],
    C: [arcPath(60, 73, 33, 51, -55, -305)],
    D: ['M32,22 L32,124', 'M32,22 L52,22' + arcSeg(52, 73, 42, 51, -90, 90) + ' L32,124'],
    E: ['M32,22 L32,124', 'M32,22 L90,22', 'M32,73 L80,73', 'M32,124 L90,124'],
    F: ['M32,22 L32,124', 'M32,22 L90,22', 'M32,73 L80,73'],
    G: [arcPath(60, 73, 33, 51, -55, -305) + ' L92,115 L92,73 L68,73'],
    H: ['M30,22 L30,124', 'M90,22 L90,124', 'M30,73 L90,73'],
    I: ['M60,22 L60,124', 'M38,22 L82,22', 'M38,124 L82,124'],
    J: ['M74,22 L74,100' + arcSeg(54, 100, 20, 22, 0, 180)],
    K: ['M30,22 L30,124', 'M88,22 L36,72 L88,124'],
    L: ['M32,22 L32,124 L90,124'],
    M: ['M28,124 L28,22 L60,86 L92,22 L92,124'],
    N: ['M30,124 L30,22 L90,124 L90,22'],
    O: [arcPath(60, 73, 33, 51, -90, -450)],
    P: ['M32,22 L32,124', 'M32,22 L56,22' + arcSeg(56, 50, 26, 28, -90, 90) + ' L32,78'],
    Q: [arcPath(60, 73, 33, 51, -90, -450), 'M72,100 L96,132'],
    R: [
      'M32,22 L32,124',
      'M32,22 L56,22' + arcSeg(56, 49, 26, 27, -90, 90) + ' L32,76',
      'M56,76 L90,124'
    ],
    S: [arcPath(60, 48, 26, 25, -25, -270) + arcSeg(60, 98, 26, 25, -90, 155)],
    T: ['M28,22 L92,22', 'M60,22 L60,124'],
    U: ['M30,22 L30,96' + arcSeg(60, 96, 30, 28, 180, 0) + ' L90,22'],
    V: ['M30,22 L60,124 L90,22'],
    W: ['M26,22 L44,124 L60,56 L76,124 L94,22'],
    X: ['M30,22 L90,124', 'M90,22 L30,124'],
    Y: ['M30,22 L60,74 L60,124', 'M90,22 L60,74'],
    Z: ['M30,22 L90,22 L30,124 L90,124']
  };

  /* ---------- lowercase ----------
   * Strokes are merged wherever a real pen would not lift: "around and down"
   * for a/d/g/q, "down, back up, around" for b/h/m/n/p/r. Retracing back up a
   * stem is part of one continuous stroke. */

  var LOWER = {
    a: [arcPath(60, 96, 28, 28, 0, -360) + ' L88,124'],
    b: ['M32,22 L32,124 L32,96' + arcSeg(60, 96, 28, 28, 180, 540)],
    c: [arcPath(60, 96, 28, 28, -55, -305)],
    d: [arcPath(60, 96, 28, 28, 0, -360) + ' L88,22 L88,124'],
    e: ['M34,94 L87.93,94' + arcSeg(60, 96, 28, 28, -4.1, -305)],
    f: [arcPath(52, 38, 20, 16, 0, -180) + ' L32,124', 'M16,68 L52,68'],
    g: [
      arcPath(60, 96, 28, 28, 0, -360) + ' L88,68 L88,140' +
        arcSeg(68, 140, 20, 18, 0, 180)
    ],
    h: ['M32,22 L32,124 L32,96' + arcSeg(60, 96, 28, 28, 180, 360) + ' L88,124'],
    i: ['M60,68 L60,124', dot(60, 46)],
    j: ['M62,68 L62,140' + arcSeg(42, 140, 20, 18, 0, 180), dot(62, 46)],
    k: ['M32,22 L32,124', 'M84,68 L36,100 L86,124'],
    l: ['M60,22 L60,124'],
    m: [
      'M28,68 L28,124 L28,90' + arcSeg(42, 90, 14, 22, 180, 360) +
        ' L56,124 L56,90' + arcSeg(70, 90, 14, 22, 180, 360) + ' L84,124'
    ],
    n: ['M32,68 L32,124 L32,92' + arcSeg(60, 92, 28, 24, 180, 360) + ' L88,124'],
    o: [arcPath(60, 96, 28, 28, -90, -450)],
    p: ['M32,68 L32,158 L32,96' + arcSeg(60, 96, 28, 28, 180, 540)],
    q: [arcPath(60, 96, 28, 28, 0, -360) + ' L88,68 L88,158'],
    r: ['M34,68 L34,124 L34,90' + arcSeg(56, 90, 22, 22, 180, 310)],
    s: [arcPath(60, 82, 22, 14, -25, -270) + arcSeg(60, 110, 22, 14, -90, 155)],
    t: ['M56,32 L56,110' + arcSeg(72, 110, 16, 14, 180, 60), 'M34,68 L78,68'],
    u: ['M32,68 L32,100' + arcSeg(60, 100, 28, 24, 180, 0) + ' L88,68 L88,124'],
    v: ['M32,68 L60,124 L88,68'],
    w: ['M28,68 L44,124 L60,80 L76,124 L92,68'],
    x: ['M34,68 L86,124', 'M86,68 L34,124'],
    y: ['M32,68 L60,124', 'M88,68 L64,140' + arcSeg(44, 140, 20, 18, 0, 180)],
    z: ['M34,68 L86,68 L34,124 L86,124']
  };

  /* ---------- digits ---------- */

  var DIGITS = {
    '0': [arcPath(60, 73, 28, 51, -90, -450)],
    '1': ['M40,44 L60,22 L60,124'],
    '2': ['M34,48' + arcSeg(60, 48, 26, 26, 180, 380) + ' L30,124 L90,124'],
    '3': [arcPath(58, 48, 26, 26, 198, 450) + arcSeg(58, 99, 25, 25, 270, 522)],
    '4': ['M76,22 L30,86 L92,86', 'M76,48 L76,124'],
    '5': ['M86,22 L40,22 L38,72.8' + arcSeg(56, 96, 32, 28, -124.2, 115)],
    '6': [arcPath(60, 73, 30, 51, -50, -270) + arcSeg(60, 100, 26, 24, 90, -270)],
    '7': ['M32,22 L90,22 L44,124'],
    '8': [arcPath(60, 49, 24, 26, 90, -270) + arcSeg(60, 101, 27, 26, -90, 270)],
    '9': [arcPath(60, 52, 26, 28, 0, -360) + ' L86,124']
  };

  /* ---------- words + phonics ---------- */

  var WORDS = {
    A: ['Apple', '🍎'], B: ['Ball', '⚽'], C: ['Cat', '🐱'], D: ['Dog', '🐶'],
    E: ['Egg', '🥚'], F: ['Fish', '🐠'], G: ['Grapes', '🍇'], H: ['Hat', '🎩'],
    I: ['Ice cream', '🍦'], J: ['Jam', '🍯'], K: ['Kite', '🪁'], L: ['Lion', '🦁'],
    M: ['Moon', '🌙'], N: ['Nest', '🪺'], O: ['Orange', '🍊'], P: ['Panda', '🐼'],
    Q: ['Queen', '👑'], R: ['Rocket', '🚀'], S: ['Sun', '☀️'], T: ['Tree', '🌳'],
    U: ['Umbrella', '☂️'], V: ['Van', '🚐'], W: ['Whale', '🐳'], X: ['Xylophone', '🎹'],
    Y: ['Yo-yo', '🪀'], Z: ['Zebra', '🦓']
  };

  var SOUNDS = {
    A: 'ah', B: 'buh', C: 'kuh', D: 'duh', E: 'eh', F: 'ff', G: 'guh', H: 'huh',
    I: 'ih', J: 'juh', K: 'kuh', L: 'll', M: 'mm', N: 'nn', O: 'oh', P: 'puh',
    Q: 'kwuh', R: 'rr', S: 'sss', T: 'tuh', U: 'uh', V: 'vv', W: 'wuh',
    X: 'ks', Y: 'yuh', Z: 'zzz'
  };

  var DIGIT_WORDS = {
    '0': ['Zero', '⚪'], '1': ['One', '☝️'], '2': ['Two', '🦆'], '3': ['Three', '🐱'],
    '4': ['Four', '🚗'], '5': ['Five', '🖐️'], '6': ['Six', '🐝'], '7': ['Seven', '🌈'],
    '8': ['Eight', '🐙'], '9': ['Nine', '🎈']
  };

  var ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var DIGIT_ORDER = '0123456789'.split('');

  function build(map, isUpper) {
    return ORDER.map(function (up) {
      var ch = isUpper ? up : up.toLowerCase();
      return {
        id: ch,
        char: ch,
        kind: 'letter',
        upper: isUpper,
        word: WORDS[up][0],
        emoji: WORDS[up][1],
        sound: SOUNDS[up],
        strokes: map[ch].map(function (st) {
          return typeof st === 'string' ? { d: st } : st;
        })
      };
    });
  }

  function buildDigits() {
    return DIGIT_ORDER.map(function (ch) {
      return {
        id: '#' + ch,
        char: ch,
        kind: 'digit',
        upper: true,
        word: DIGIT_WORDS[ch][0],
        emoji: DIGIT_WORDS[ch][1],
        sound: DIGIT_WORDS[ch][0].toLowerCase(),
        strokes: DIGITS[ch].map(function (d) { return { d: d }; })
      };
    });
  }

  global.LETTERS = {
    upper: build(UPPER, true),
    lower: build(LOWER, false),
    digits: buildDigits(),
    guides: { cap: CAP, mid: MID, base: BASE, desc: DESC },
    box: { w: 120, h: 170 }
  };
})(window);
