/* Trace the Alphabet - main app.
 *
 * The board is a worksheet page: the same letter repeated N times (6 by
 * default). Each copy ("slot") is traced independently. When every slot on the
 * page is finished the letter is complete and the next one loads.
 */
(function () {
  'use strict';

  var BOX = LETTERS.box;
  var G = LETTERS.guides;
  var DIFF = { easy: 15, normal: 11.5, strict: 8.5 };
  var INK_COLORS = ['#6c5ce7', '#00b894', '#0984e3', '#e17055'];

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------ storage */

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem('traceabc.' + key);
      return raw ? Object.assign({}, fallback, JSON.parse(raw)) : Object.assign({}, fallback);
    } catch (e) {
      return Object.assign({}, fallback);
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem('traceabc.' + key, JSON.stringify(value));
    } catch (e) { /* private mode */ }
  }

  var settings = load('settings', {
    difficulty: 'normal',
    perPage: 6,
    sound: true,
    vibrate: true,
    speech: true,
    arrows: true,
    autoDemo: true,
    autoNext: true,
    dark: false,
    letterScale: 1,
    letterCase: 'upper',
    lastIndex: 0
  });
  var progress = load('progress', {});
  var marks = load('marks', { total: 0 });

  var THEMES = {
    light: {
      guideFaint: '#cfdae6', guideMid: '#b9cbe0', guideBase: '#8fa9c4',
      trackOn: '#ded5fb', trackOff: '#eeeaf9',
      dotOn: '#ddd4fb', dotOff: '#ece8f8',
      dash: 'rgba(255,255,255,0.95)',
      chrome: 'rgba(47,53,66,0.08)', num: 'rgba(47,53,66,0.22)',
      finger: 'rgba(255,255,255,0.75)'
    },
    dark: {
      guideFaint: '#3d4a5c', guideMid: '#4a5c72', guideBase: '#7d94ad',
      trackOn: '#3f3a68', trackOff: '#2c2a44',
      dotOn: '#3f3a68', dotOff: '#2c2a44',
      dash: 'rgba(255,255,255,0.32)',
      chrome: 'rgba(255,255,255,0.10)', num: 'rgba(255,255,255,0.26)',
      finger: 'rgba(255,255,255,0.32)'
    }
  };
  function theme() {
    return settings.dark ? THEMES.dark : THEMES.light;
  }

  var SCALE_MIN = 0.55;
  var SCALE_MAX = 1.2;
  function letterScale() {
    var s = Number(settings.letterScale);
    if (!isFinite(s) || !s) s = 1;
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));
  }

  /* ------------------------------------------------ state */

  var state = {
    letter: null,
    slots: [],
    focus: 0,
    tracing: false,
    traceSlot: -1,
    pointerId: null,
    lastPt: null,
    errors: [],
    particles: [],
    demo: null,
    done: false
  };

  var board = $('board');
  var stage = $('stage');
  var ctx = board.getContext('2d');
  var view = { scale: 1, sizeFactor: 1, capped: false, dpr: 1, w: 0, h: 0, cols: 1, rows: 1, cw: 0, ch: 0, cells: [] };
  var pathCache = {};
  var interacted = false;
  var timers = { hint: null, autoNext: null, praise: null };

  function tolerance() {
    return DIFF[settings.difficulty] || DIFF.normal;
  }
  function perPage() {
    return Math.max(1, Math.min(12, settings.perPage || 6));
  }
  function path2d(d) {
    if (!pathCache[d]) pathCache[d] = new Path2D(d);
    return pathCache[d];
  }
  function clearTimers() {
    clearTimeout(timers.autoNext);
    clearTimeout(timers.praise);
    timers.autoNext = null;
    timers.praise = null;
  }

  /* ------------------------------------------------ layout */

  function layout() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    view.w = rect.width;
    view.h = rect.height;
    view.dpr = dpr;
    board.width = Math.max(1, Math.round(rect.width * dpr));
    board.height = Math.max(1, Math.round(rect.height * dpr));

    var n = perPage();
    var best = null;
    for (var cols = 1; cols <= n; cols++) {
      if (n % cols) continue;
      var rows = n / cols;
      var cw = rect.width / cols;
      var ch = rect.height / rows;
      var pad = Math.min(cw, ch) * 0.09 + 4;
      var sc = Math.min((cw - pad * 2) / BOX.w, (ch - pad * 2) / BOX.h);
      if (sc > 0 && (!best || sc > best.scale)) {
        best = { cols: cols, rows: rows, scale: sc, cw: cw, ch: ch };
      }
    }
    if (!best) best = { cols: n, rows: 1, scale: 0.1, cw: rect.width / n, ch: rect.height };

    view.cols = best.cols;
    view.rows = best.rows;
    /* Cell geometry stays fixed so the page layout never shifts; only the
     * glyph inside each cell grows or shrinks. Never let it spill past the
     * cell edge, or a finger near the border would be read as the next copy. */
    var fitCap = Math.min(best.cw / BOX.w, best.ch / BOX.h) / best.scale;
    view.sizeFactor = Math.min(letterScale(), fitCap);
    view.capped = view.sizeFactor < letterScale() - 0.001;
    view.scale = best.scale * view.sizeFactor;
    view.cw = best.cw;
    view.ch = best.ch;
    view.cells = [];
    for (var i = 0; i < n; i++) {
      var c = i % best.cols;
      var r = (i / best.cols) | 0;
      view.cells.push({
        cx: c * best.cw,
        cy: r * best.ch,
        ox: c * best.cw + (best.cw - BOX.w * view.scale) / 2,
        oy: r * best.ch + (best.ch - BOX.h * view.scale) / 2
      });
    }
  }

  /* Screen point -> { slot, x, y } in paper units of that slot. */
  function hit(clientX, clientY) {
    var rect = board.getBoundingClientRect();
    var lx = clientX - rect.left;
    var ly = clientY - rect.top;
    var col = Math.min(view.cols - 1, Math.max(0, Math.floor(lx / view.cw)));
    var row = Math.min(view.rows - 1, Math.max(0, Math.floor(ly / view.ch)));
    var i = Math.min(view.cells.length - 1, row * view.cols + col);
    var cell = view.cells[i];
    return { slot: i, x: (lx - cell.ox) / view.scale, y: (ly - cell.oy) / view.scale };
  }

  function toScreen(slotIndex, x, y) {
    var cell = view.cells[slotIndex] || { ox: 0, oy: 0 };
    return { x: cell.ox + x * view.scale, y: cell.oy + y * view.scale };
  }

  /* ------------------------------------------------ letters and slots */

  function list() {
    return LETTERS[settings.letterCase] || LETTERS.upper;
  }

  function makeSlots() {
    var tol = tolerance();
    var n = perPage();
    var guidedCount = Math.ceil(n / 2);
    state.slots = [];
    for (var i = 0; i < n; i++) {
      state.slots.push({
        runs: state.letter.strokes.map(function (st) {
          return new Tracer.StrokeRun(st, { tolerance: tol });
        }),
        active: 0,
        done: false,
        /* First half is guided; the rest has no start or direction cues. */
        guided: i < guidedCount
      });
    }
    state.focus = 0;
    state.done = false;
  }

  function clearTransient() {
    releasePointer();
    Feedback.stopSpeech();
    state.lastPt = null;
    state.errors = [];
    state.particles = [];
    state.demo = null;
    clearTimers();
  }

  function loadLetter(i, opts) {
    opts = opts || {};
    var all = list();
    settings.lastIndex = ((i % all.length) + all.length) % all.length;
    save('settings', settings);

    clearTransient();
    state.letter = all[settings.lastIndex];
    makeSlots();
    layout();

    updateHeader();
    renderGrid();

    if (settings.autoDemo && !opts.noDemo) startDemo();
    else defaultHint();

    if (!opts.silent && interacted) Feedback.sayParts(spokenParts(state.letter), 750);
  }

  /* Two separate phrases with a pause, so "Small b" does not run into
   * "b is for ball". */
  var COUNT_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  function spokenParts(letter) {
    var name = letter.char.toUpperCase();
    if (letter.kind === 'digit') {
      var n = Number(letter.char);
      if (!n) return ['Number zero.', 'Zero means none at all.'];
      return ['Number ' + letter.word.toLowerCase() + '.',
        'Count with me. ' + COUNT_WORDS.slice(0, n).join(', ') + '.'];
    }
    return [
      (letter.upper ? 'Big ' : 'Small ') + name + '.',
      name + ' is for ' + letter.word + '.'
    ];
  }

  function stars(id) {
    return Math.min(3, progress[id] || 0);
  }

  function doneCount() {
    var n = 0;
    for (var i = 0; i < state.slots.length; i++) if (state.slots[i].done) n++;
    return n;
  }

  function nextUnfinished(from) {
    var n = state.slots.length;
    for (var k = 0; k < n; k++) {
      var i = (from + k) % n;
      if (!state.slots[i].done) return i;
    }
    return -1;
  }

  function updateHeader() {
    var l = state.letter;
    $('letterWord').textContent = l.kind === 'digit'
      ? l.char + '  ·  ' + l.word + ' ' + l.emoji
      : l.char + '  ·  ' + l.char.toUpperCase() + ' is for ' + l.word + ' ' + l.emoji;
    var n = stars(l.id);
    $('stars').textContent = '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);
    $('marks').textContent = '🏅 ' + (marks.total || 0);
    var pips = '';
    for (var i = 0; i < state.slots.length; i++) pips += state.slots[i].done ? '●' : '○';
    $('pips').textContent = pips;
  }

  function setHint(text, kind) {
    var el = $('hint');
    el.textContent = text;
    el.className = 'hint' + (kind ? ' ' + kind : '');
    clearTimeout(timers.hint);
    if (kind) timers.hint = setTimeout(defaultHint, 2200);
  }

  function defaultHint() {
    if (!state.letter) return;
    if (state.done) {
      setHint('Whole page finished! Tap ▶ for the next letter');
      return;
    }
    if (state.demo) {
      setHint('Watch how it is drawn…');
      return;
    }
    var slot = state.slots[state.focus];
    if (!slot) return;
    var left = state.slots.length - doneCount();
    var tail = ' · ' + left + ' to go';
    var run = slot.runs[slot.active];
    var which = slot.runs.length > 1 ? ' (line ' + (slot.active + 1) + ' of ' + slot.runs.length + ')' : '';
    if (!run) return;
    if (!slot.guided) setHint('Your turn — find where to start!' + which + tail);
    else if (run.isDot) setHint('Tap the little dot' + which + tail);
    else if (run.index > 0) setHint('Carry on from the blue dot' + which + tail);
    else setHint('Start on the green dot, follow the arrows' + which + tail);
  }

  /* ------------------------------------------------ drawing */

  function inkProgress(slotIndex, i) {
    if (state.demo && state.demo.slot === slotIndex) {
      if (i < state.demo.i) return 1;
      if (i === state.demo.i) return state.demo.t;
      return 0;
    }
    var run = state.slots[slotIndex].runs[i];
    return run.done ? 1 : run.progress();
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawGuides() {
    var th = theme();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = th.guideFaint;
    ctx.setLineDash([3, 4]);
    line(2, G.cap, BOX.w - 2, G.cap);
    line(2, G.desc, BOX.w - 2, G.desc);
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = th.guideMid;
    line(2, G.mid, BOX.w - 2, G.mid);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = th.guideBase;
    line(2, G.base, BOX.w - 2, G.base);
  }

  function drawTrack(run, isActiveStroke, focused, guided) {
    var th = theme();
    var w = tolerance() * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    if (run.isDot) {
      ctx.beginPath();
      ctx.arc(run.pts[0].x, run.pts[0].y, w * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = focused && isActiveStroke ? th.dotOn : th.dotOff;
      ctx.fill();
      return;
    }
    ctx.strokeStyle = focused && isActiveStroke ? th.trackOn : th.trackOff;
    ctx.lineWidth = w;
    ctx.stroke(path2d(run.stroke.d));

    /* The dashed centre line is part of the guiding: blank copies get the
     * road only, so the child has to remember the path. */
    if (!guided) return;
    ctx.strokeStyle = th.dash;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2.5, 4.5]);
    ctx.stroke(path2d(run.stroke.d));
    ctx.setLineDash([]);
  }

  function drawInk(run, i, p) {
    if (p <= 0.004) return;
    var color = INK_COLORS[i % INK_COLORS.length];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (run.isDot) {
      ctx.beginPath();
      ctx.arc(run.pts[0].x, run.pts[0].y, tolerance() * 0.42 * Math.min(1, p * 1.4), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = tolerance() * 1.15;
    ctx.setLineDash([run.length * p, run.length + 2]);
    ctx.stroke(path2d(run.stroke.d));
    ctx.setLineDash([]);
  }

  function drawArrow(p, angle, size, color) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.75, size * 0.72);
    ctx.lineTo(-size * 0.35, 0);
    ctx.lineTo(-size * 0.75, -size * 0.72);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawMarkers(slot, now) {
    var run = slot.runs[slot.active];
    if (!run) return;
    var p = run.progress();
    var tol = tolerance();

    if (settings.arrows && !run.isDot) {
      [0.28, 0.58, 0.85].forEach(function (t) {
        if (t <= p + 0.04) return;
        var pt = run.pts[Math.round(t * (run.pts.length - 1))];
        drawArrow(pt, pt.angle, tol * 0.5, 'rgba(108,92,231,0.55)');
      });
      var last = run.pts[run.pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, tol * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(22,178,107,0.22)';
      ctx.fill();
    }

    var target = run.index > 0 ? run.resumePoint() : run.startPoint();
    var pulse = 1 + Math.sin(now / 260) * 0.16;
    var resuming = run.index > 0;

    ctx.beginPath();
    ctx.arc(target.x, target.y, tol * 0.78 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = resuming ? 'rgba(9,132,227,0.18)' : 'rgba(22,178,107,0.18)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(target.x, target.y, tol * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = resuming ? '#0984e3' : '#16b26b';
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + tol * 0.62 + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(slot.active + 1), target.x, target.y + 0.4);
  }

  /* A quiet start hint on the other unfinished copies. */
  function drawIdleStart(slot) {
    var run = slot.runs[slot.active];
    if (!run) return;
    var target = run.index > 0 ? run.resumePoint() : run.startPoint();
    ctx.beginPath();
    ctx.arc(target.x, target.y, tolerance() * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = run.index > 0 ? 'rgba(9,132,227,0.45)' : 'rgba(22,178,107,0.45)';
    ctx.fill();
  }

  function drawTick() {
    var x = BOX.w - 14;
    var y = 14;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(22,178,107,0.15)';
    ctx.fill();
    ctx.strokeStyle = '#16b26b';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 4.2, y);
    ctx.lineTo(x - 1.2, y + 3.4);
    ctx.lineTo(x + 4.6, y - 3.6);
    ctx.stroke();
  }

  function drawErrors(slotIndex, now) {
    for (var i = state.errors.length - 1; i >= 0; i--) {
      var e = state.errors[i];
      var age = (now - e.t) / 700;
      if (age >= 1) {
        state.errors.splice(i, 1);
        continue;
      }
      if (e.slot !== slotIndex) continue;
      ctx.beginPath();
      ctx.arc(e.x, e.y, tolerance() * (0.5 + age * 1.1), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,59,48,' + (1 - age) + ')';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([]);
      ctx.stroke();
      if (age < 0.6) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, tolerance() * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,59,48,' + (0.5 - age * 0.5) + ')';
        ctx.fill();
      }
    }
  }

  function drawFinger(slotIndex) {
    if (!state.tracing || state.traceSlot !== slotIndex || !state.lastPt) return;
    ctx.beginPath();
    ctx.arc(state.lastPt.x, state.lastPt.y, tolerance() * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = theme().finger;
    ctx.fill();
    ctx.strokeStyle = 'rgba(108,92,231,0.7)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function drawDemoHand(slotIndex) {
    if (!state.demo || state.demo.slot !== slotIndex) return;
    var run = state.slots[slotIndex].runs[state.demo.i];
    if (!run) return;
    var pt = run.isDot ? run.pts[0] : run.pts[Math.round(state.demo.t * (run.pts.length - 1))];
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, tolerance() * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,214,10,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#f0932b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCellChrome(i, now) {
    var th = theme();
    var cell = view.cells[i];
    var pad = Math.min(view.cw, view.ch) * 0.03;
    var x = cell.cx + pad;
    var y = cell.cy + pad;
    var w = view.cw - pad * 2;
    var h = view.ch - pad * 2;
    var r = Math.min(w, h) * 0.1;
    var slot = state.slots[i];

    if (slot.done) {
      roundRect(x, y, w, h, r);
      ctx.fillStyle = 'rgba(22,178,107,0.06)';
      ctx.fill();
    } else if (i === state.focus && !state.done) {
      roundRect(x, y, w, h, r);
      ctx.fillStyle = 'rgba(108,92,231,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(108,92,231,' + (0.35 + Math.sin(now / 340) * 0.18) + ')';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    roundRect(x, y, w, h, r);
    ctx.strokeStyle = th.chrome;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = th.num;
    ctx.font = 'bold ' + Math.max(10, Math.min(w, h) * 0.09) + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), x + 8, y + 6);
  }

  function drawParticles() {
    for (var i = 0; i < state.particles.length; i++) {
      var p = state.particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 600));
      ctx.font = p.size + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.ch, p.x, p.y);
      ctx.restore();
    }
  }

  function draw(now) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    for (var i = 0; i < state.slots.length; i++) {
      drawCellChrome(i, now);

      var cell = view.cells[i];
      var slot = state.slots[i];
      ctx.save();
      ctx.translate(cell.ox, cell.oy);
      ctx.scale(view.scale, view.scale);

      drawGuides();
      var k;
      for (k = 0; k < slot.runs.length; k++) {
        drawTrack(slot.runs[k], k === slot.active, i === state.focus, slot.guided);
      }
      for (k = 0; k < slot.runs.length; k++) {
        drawInk(slot.runs[k], k, inkProgress(i, k));
      }
      if (slot.done) {
        drawTick();
      } else if (state.demo) {
        /* nothing: the demo hand is the guide */
      } else if (slot.guided) {
        if (i === state.focus) drawMarkers(slot, now);
        else drawIdleStart(slot);
      }
      drawDemoHand(i);
      drawErrors(i, now);
      drawFinger(i);
      ctx.restore();
    }

    drawParticles();
  }

  /* ------------------------------------------------ demo */

  function startDemo() {
    var target = nextUnfinished(state.focus);
    if (target < 0) target = 0;
    state.focus = target;
    var slot = state.slots[target];
    slot.runs.forEach(function (r) { r.reset(); });
    slot.active = 0;
    slot.done = false;
    releasePointer();
    updateHeader();
    state.demo = { slot: target, i: 0, t: 0 };
    setHint('Watch how it is drawn…');
  }

  function stepDemo(dt) {
    var d = state.demo;
    if (!d) return;
    var slot = state.slots[d.slot];
    if (!slot) {
      state.demo = null;
      return;
    }
    var run = slot.runs[d.i];
    if (!run) {
      state.demo = null;
      defaultHint();
      return;
    }
    d.t += run.isDot ? dt / 450 : ((dt / 1000) * 58) / Math.max(8, run.length);
    if (d.t >= 1) {
      d.t = 0;
      d.i++;
      Feedback.tick();
      if (d.i >= slot.runs.length) {
        state.demo = null;
        defaultHint();
      }
    }
  }

  /* ------------------------------------------------ particles (screen space) */

  function burst(slotIndex, px, py, count, chars) {
    var s = toScreen(slotIndex, px, py);
    var size = Math.max(10, view.scale * 7);
    for (var i = 0; i < count; i++) {
      state.particles.push({
        x: s.x,
        y: s.y,
        vx: (Math.random() - 0.5) * 260,
        vy: -Math.random() * 260 - 60,
        life: 600 + Math.random() * 500,
        size: size * (0.6 + Math.random() * 0.8),
        ch: chars[(Math.random() * chars.length) | 0]
      });
    }
  }

  function updateParticles(dt) {
    var s = dt / 1000;
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.vy += 620 * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
  }

  /* ------------------------------------------------ tracing */

  function flashBad() {
    var f = $('flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
  }

  function onOut(slotIndex, pt) {
    state.errors.push({ slot: slotIndex, x: pt.x, y: pt.y, t: performance.now() });
    if (state.errors.length > 14) state.errors.shift();
    if (Feedback.outOfBounds()) {
      flashBad();
      setHint('Oops! Stay on the grey road', 'bad');
    }
  }

  function onStrokeDone(slotIndex) {
    var slot = state.slots[slotIndex];
    var run = slot.runs[slot.active];
    var end = run.isDot ? run.pts[0] : run.pts[run.pts.length - 1];
    burst(slotIndex, end.x, end.y, 6, ['✨', '⭐']);
    Feedback.strokeDone();
    releasePointer();
    slot.active++;
    if (slot.active >= slot.runs.length) slotDone(slotIndex);
    else setHint('Nice! Now line ' + (slot.active + 1), 'good');
  }

  function slotDone(slotIndex) {
    var slot = state.slots[slotIndex];
    slot.done = true;
    slot.active = slot.runs.length - 1;
    burst(slotIndex, BOX.w / 2, BOX.h / 2, 10, ['⭐', '✨', '🎉']);
    updateHeader();

    var left = state.slots.length - doneCount();
    if (left <= 0) {
      pageDone();
      return;
    }
    state.focus = nextUnfinished(slotIndex + 1);
    Feedback.letterDone();
    setHint('That is ' + doneCount() + ' of ' + state.slots.length + '! ' + left + ' to go', 'good');
  }

  function name0(letter) {
    return (letter.upper ? 'big ' : 'small ') + letter.char.toUpperCase();
  }

  function pageDone() {
    state.done = true;
    releasePointer();
    var letter = state.letter;
    progress[letter.id] = Math.min(3, (progress[letter.id] || 0) + 1);
    save('progress', progress);
    marks.total = (marks.total || 0) + 1;
    save('marks', marks);
    updateHeader();
    renderGrid();

    for (var i = 0; i < state.slots.length; i++) {
      burst(i, BOX.w / 2, BOX.h / 2, 10, ['⭐', '🎉', '✨', '🌈', letter.emoji]);
    }
    Feedback.letterDone();
    setHint('Whole page done! +1 mark 🏅 · total ' + marks.total, 'good');

    var c = $('celebrate');
    c.querySelector('span').textContent = '+1 🏅';
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');

    var name = letter.kind === 'digit' ? 'number ' + letter.word.toLowerCase() : name0(letter);
    timers.praise = setTimeout(function () {
      Feedback.sayParts([
        'Great job! You finished a whole page of ' + name + '.',
        'That is ' + marks.total + (marks.total === 1 ? ' mark.' : ' marks.')
      ], 550);
    }, 550);

    if (settings.autoNext) {
      timers.autoNext = setTimeout(function () {
        loadLetter(settings.lastIndex + 1);
      }, 3200);
    }
  }

  function releasePointer() {
    if (state.pointerId != null) {
      try { board.releasePointerCapture(state.pointerId); } catch (e) { /* ignore */ }
    }
    state.pointerId = null;
    state.tracing = false;
    state.traceSlot = -1;
  }

  function processPoint(pt) {
    var slot = state.slots[state.traceSlot];
    if (!slot) return;
    var run = slot.runs[slot.active];
    if (!run || run.done) return;
    var last = state.lastPt || pt;
    var dx = pt.x - last.x;
    var dy = pt.y - last.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.min(40, Math.ceil(d / 2)));
    var slotIndex = state.traceSlot;
    for (var i = 1; i <= steps; i++) {
      var q = { x: last.x + (dx * i) / steps, y: last.y + (dy * i) / steps };
      var res = run.push(q.x, q.y);
      if (res === 'out') {
        state.lastPt = q;
        onOut(slotIndex, q);
        return;
      }
      if (res === 'done') {
        state.lastPt = q;
        onStrokeDone(slotIndex);
        return;
      }
    }
    state.lastPt = pt;
  }

  function onDown(e) {
    if (!e.isPrimary) return;
    e.preventDefault();
    interacted = true;
    Feedback.unlock();

    if (state.demo) {
      state.demo = null;
      defaultHint();
    }

    var h = hit(e.clientX, e.clientY);
    var slot = state.slots[h.slot];
    if (!slot) return;

    if (slot.done) {
      Feedback.tick();
      setHint(
        state.done ? 'Page finished! Tap ▶ for a new letter' : 'That one is done — try a glowing box',
        'good'
      );
      return;
    }

    state.focus = h.slot;
    var run = slot.runs[slot.active];
    if (!run) return;

    if (run.canBegin(h.x, h.y)) {
      state.tracing = true;
      state.traceSlot = h.slot;
      state.pointerId = e.pointerId;
      try { board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      state.lastPt = { x: h.x, y: h.y };
      Feedback.strokeStart();
      if (run.isDot) {
        if (run.push(h.x, h.y) === 'done') onStrokeDone(h.slot);
      } else {
        setHint(slot.guided ? 'Keep going, follow the arrows' : 'Keep going on the road');
      }
    } else {
      Feedback.wrongStart();
      state.errors.push({ slot: h.slot, x: h.x, y: h.y, t: performance.now() });
      setHint(slot.guided
        ? (run.isDot ? 'Tap the little dot!' : 'Start on the green dot ' + (slot.active + 1))
        : 'Try another starting point', 'bad');
    }
  }

  function onMove(e) {
    if (!state.tracing || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    var cell = view.cells[state.traceSlot];
    if (!cell) return;
    var rect = board.getBoundingClientRect();
    var events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    var pts = events && events.length ? events : [e];
    for (var i = 0; i < pts.length; i++) {
      // Stay in the slot the trace started in, even if the finger wanders out.
      processPoint({
        x: (pts[i].clientX - rect.left - cell.ox) / view.scale,
        y: (pts[i].clientY - rect.top - cell.oy) / view.scale
      });
      if (!state.tracing) return;
    }
  }

  function onUp(e) {
    if (e.pointerId !== state.pointerId) return;
    e.preventDefault();
    var slot = state.slots[state.traceSlot];
    var run = slot && slot.runs[slot.active];
    releasePointer();
    if (run && !run.done && run.index > 0 && !state.done) setHint('Carry on from the blue dot');
  }

  /* ------------------------------------------------ actions */

  function resetPage() {
    clearTransient();
    makeSlots();
    updateHeader();
    defaultHint();
  }

  function applyPerPageOrDifficulty() {
    clearTransient();
    makeSlots();
    layout();
    updateHeader();
    defaultHint();
  }

  /* ------------------------------------------------ UI */

  function renderGrid() {
    var grid = $('letterGrid');
    var all = list();
    if (grid.childElementCount !== all.length) {
      grid.innerHTML = '';
      all.forEach(function (l, i) {
        var b = document.createElement('button');
        b.className = 'cell';
        b.dataset.i = i;
        b.innerHTML = '<span class="ch"></span><span class="cellstars"></span>';
        grid.appendChild(b);
      });
    }
    Array.prototype.forEach.call(grid.children, function (b, i) {
      var l = all[i];
      b.firstChild.textContent = l.char;
      b.lastChild.textContent = '★'.repeat(stars(l.id));
      b.classList.toggle('is-on', i === settings.lastIndex);
    });
  }

  function syncSettingsUI() {
    $('optSound').checked = settings.sound;
    $('optVibrate').checked = settings.vibrate;
    $('optSpeech').checked = settings.speech;
    $('optArrows').checked = settings.arrows;
    $('optAutoDemo').checked = settings.autoDemo;
    $('optAutoNext').checked = settings.autoNext;
    $('optDark').checked = !!settings.dark;
    $('btnSizeReset').textContent = Math.round(view.sizeFactor * 100) + '%';
    var atMin = letterScale() <= SCALE_MIN + 0.001;
    var atMax = letterScale() >= SCALE_MAX - 0.001 || view.capped;
    $('btnSizeDown').disabled = atMin;
    $('btnSizeUp').disabled = atMax;
    $('btnSmaller').disabled = atMin;
    $('btnBigger').disabled = atMax;
    Array.prototype.forEach.call($('segDifficulty').children, function (b) {
      b.classList.toggle('is-on', b.dataset.diff === settings.difficulty);
    });
    Array.prototype.forEach.call($('segPerPage').children, function (b) {
      b.classList.toggle('is-on', parseInt(b.dataset.per, 10) === perPage());
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('is-on', t.dataset.case === settings.letterCase);
    });
    Feedback.settings.sound = settings.sound;
    Feedback.settings.vibrate = settings.vibrate;
    Feedback.settings.speech = settings.speech;
  }

  function applyTheme() {
    document.body.classList.toggle('dark', !!settings.dark);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.dark ? '#171a21' : '#fdf7ee');
  }

  function bumpSize(delta) {
    /* Base the step on what is actually on screen, so pressing − after the
     * size was capped by the cell still makes a visible difference. */
    var from = delta < 0 ? Math.min(letterScale(), view.sizeFactor || 1) : letterScale();
    var next = Math.round((from + delta) * 100) / 100;
    settings.letterScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, next));
    save('settings', settings);
    layout();
    syncSettingsUI();
    Feedback.tick();
  }

  function vibeNote() {
    var ua = navigator.userAgent;
    var isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
    var msg;
    if (isIPad) {
      msg = 'This looks like an iPad. iPads have no vibration motor, so buzzing is not ' +
        'possible on this device — mistakes use a red flash, a shake and a buzz sound instead.';
    } else if (Feedback.supports.vibrate) {
      msg = 'Vibration is supported on this device.';
    } else if (Feedback.supports.iosHaptic) {
      msg = 'iPhone haptics are attempted (iOS 17.4+ only, and not guaranteed). Turn on ' +
        'Settings → Sounds & Haptics → System Haptics. The red flash, shake and buzz sound ' +
        'always work.';
    } else {
      msg = 'This device has no vibration support, so mistakes use a red flash, a shake and a buzz sound.';
    }
    $('vibeNote').textContent = msg;
  }

  function relayout() {
    layout();
    syncSettingsUI();
  }

  function bind() {
    board.addEventListener('pointerdown', onDown, { passive: false });
    board.addEventListener('pointermove', onMove, { passive: false });
    board.addEventListener('pointerup', onUp, { passive: false });
    board.addEventListener('pointercancel', onUp, { passive: false });
    board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    $('btnPrev').addEventListener('click', function () { loadLetter(settings.lastIndex - 1); });
    $('btnNext').addEventListener('click', function () { loadLetter(settings.lastIndex + 1); });
    $('btnWatch').addEventListener('click', function () {
      interacted = true;
      Feedback.unlock();
      clearTimers();
      startDemo();
    });
    $('btnReset').addEventListener('click', function () {
      interacted = true;
      Feedback.unlock();
      resetPage();
    });
    $('btnSay').addEventListener('click', function () {
      interacted = true;
      Feedback.unlock();
      var l = state.letter;
      var parts = spokenParts(l);
      if (l.kind !== 'digit') parts.push(l.char.toUpperCase() + ' says ' + l.sound + '.');
      Feedback.sayParts(parts, 750);
    });

    $('btnSmaller').addEventListener('click', function () { bumpSize(-0.1); });
    $('btnBigger').addEventListener('click', function () { bumpSize(0.1); });
    $('btnSizeDown').addEventListener('click', function () { bumpSize(-0.1); });
    $('btnSizeUp').addEventListener('click', function () { bumpSize(0.1); });
    $('btnSizeReset').addEventListener('click', function () {
      settings.letterScale = 1;
      save('settings', settings);
      layout();
      syncSettingsUI();
    });

    $('btnLetters').addEventListener('click', function () {
      renderGrid();
      $('pickerSheet').hidden = false;
    });
    $('btnSettings').addEventListener('click', function () {
      syncSettingsUI();
      vibeNote();
      $('settingsSheet').hidden = false;
    });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { $(b.dataset.close).hidden = true; });
    });
    document.querySelectorAll('.sheet').forEach(function (s) {
      s.addEventListener('click', function (e) { if (e.target === s) s.hidden = true; });
    });

    $('letterGrid').addEventListener('click', function (e) {
      var cell = e.target.closest ? e.target.closest('.cell') : null;
      if (!cell) return;
      interacted = true;
      Feedback.unlock();
      $('pickerSheet').hidden = true;
      loadLetter(parseInt(cell.dataset.i, 10));
    });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        settings.letterCase = t.dataset.case;
        settings.lastIndex = Math.min(settings.lastIndex, list().length - 1);
        save('settings', settings);
        syncSettingsUI();
        $('letterGrid').innerHTML = '';
        loadLetter(settings.lastIndex, { silent: true });
      });
    });

    $('segDifficulty').addEventListener('click', function (e) {
      if (!e.target.dataset.diff) return;
      settings.difficulty = e.target.dataset.diff;
      save('settings', settings);
      syncSettingsUI();
      applyPerPageOrDifficulty();
    });

    $('segPerPage').addEventListener('click', function (e) {
      if (!e.target.dataset.per) return;
      settings.perPage = parseInt(e.target.dataset.per, 10);
      save('settings', settings);
      syncSettingsUI();
      applyPerPageOrDifficulty();
    });

    [
      ['optSound', 'sound'],
      ['optVibrate', 'vibrate'],
      ['optSpeech', 'speech'],
      ['optArrows', 'arrows'],
      ['optAutoDemo', 'autoDemo'],
      ['optAutoNext', 'autoNext'],
      ['optDark', 'dark']
    ].forEach(function (pair) {
      $(pair[0]).addEventListener('change', function (e) {
        settings[pair[1]] = e.target.checked;
        save('settings', settings);
        syncSettingsUI();
        if (pair[1] === 'dark') applyTheme();
        if (pair[1] === 'autoNext' && !e.target.checked) {
          clearTimeout(timers.autoNext);
          timers.autoNext = null;
        }
        if (pair[1] === 'vibrate' && e.target.checked) Feedback.vibrate(30);
        if (pair[1] === 'sound' && e.target.checked) {
          Feedback.unlock();
          Feedback.strokeDone();
        }
      });
    });

    $('btnResetProgress').addEventListener('click', function () {
      if (!confirm('Clear all stars?')) return;
      progress = {};
      save('progress', progress);
      updateHeader();
      renderGrid();
    });

    $('btnResetMarks').addEventListener('click', function () {
      if (!confirm('Clear all marks?')) return;
      marks = { total: 0 };
      save('marks', marks);
      updateHeader();
    });

    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', function () { setTimeout(relayout, 250); });
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(stage);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') loadLetter(settings.lastIndex + 1);
      if (e.key === 'ArrowLeft') loadLetter(settings.lastIndex - 1);
      if (e.key === 'r' || e.key === 'R') resetPage();
      if (e.key === '+' || e.key === '=') bumpSize(0.1);
      if (e.key === '-' || e.key === '_') bumpSize(-0.1);
    });

    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
    });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (e.target === board) e.preventDefault();
    }, { passive: false });
  }

  /* ------------------------------------------------ boot */

  var lastNow = 0;
  function frame(now) {
    var dt = Math.min(50, now - lastNow || 16);
    lastNow = now;
    if (state.demo) stepDemo(dt);
    updateParticles(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  function init() {
    Feedback.init();
    applyTheme();
    bind();
    layout();
    syncSettingsUI();
    loadLetter(settings.lastIndex, { silent: true });
    requestAnimationFrame(frame);

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline only */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
