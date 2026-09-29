/* Dev-only smoke test for js/tracer.js, run under JavaScriptCore with a
 * minimal SVG stub (straight-line paths only).
 *
 *   jsc tools/test_tracer.js
 */
var window = this;

function FakePath() {
  this.pts = [];
}
FakePath.prototype.setAttribute = function (name, value) {
  if (name !== 'd') return;
  var parts = value.replace(/M/g, '').replace(/L/g, ' ').trim().split(/\s+/);
  this.pts = parts.map(function (p) {
    var xy = p.split(',');
    return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
  });
  this.segs = [];
  this.total = 0;
  for (var i = 0; i < this.pts.length - 1; i++) {
    var a = this.pts[i], b = this.pts[i + 1];
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    this.segs.push({ a: a, b: b, len: len, at: this.total });
    this.total += len;
  }
};
FakePath.prototype.getTotalLength = function () { return this.total; };
FakePath.prototype.getPointAtLength = function (l) {
  l = Math.max(0, Math.min(this.total, l));
  for (var i = 0; i < this.segs.length; i++) {
    var s = this.segs[i];
    if (l <= s.at + s.len || i === this.segs.length - 1) {
      var t = s.len ? (l - s.at) / s.len : 0;
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    }
  }
  return this.pts[0];
};

var document = {
  createElementNS: function (ns, tag) {
    if (tag === 'svg') {
      return { setAttribute: function () {}, style: {}, appendChild: function () {} };
    }
    return new FakePath();
  },
  body: { appendChild: function () {} }
};

load('js/tracer.js');

var failures = 0;
function check(name, cond) {
  print((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) failures++;
}

var TOL = 10;
function run(d) {
  return new Tracer.StrokeRun({ d: d }, { tolerance: TOL });
}

/* --- sampling --- */
var r = run('M0,0 L100,0');
check('samples the whole path', Math.abs(r.length - 100) < 0.01 && r.pts.length > 50);
check('starts at the path start', r.startPoint().x === 0);

/* --- start gating --- */
check('can begin on the start dot', r.canBegin(2, 2));
check('cannot begin far away', !r.canBegin(60, 0));
check('cannot begin off to the side', !r.canBegin(0, 40));

/* --- a clean trace completes --- */
r.reset();
var res = 'ok';
for (var x = 0; x <= 100 && res !== 'done'; x += 2) res = r.push(x, 0);
check('a clean trace completes', res === 'done' && r.done);

/* --- wobble inside the road is fine --- */
r.reset();
res = 'ok';
for (x = 0; x <= 100 && res !== 'done'; x += 2) res = r.push(x, Math.sin(x / 6) * 7);
check('small wobble stays ok', res === 'done');

/* --- straying outside the road is reported and blocks progress --- */
r.reset();
r.push(0, 0);
r.push(10, 0);
var before = r.index;
check('going off the road reports out', r.push(20, 26) === 'out');
check('going off the road does not advance', r.index === before);
check('coming back on the road resumes', r.push(22, 0) === 'ok' && r.index > before);

/* --- cannot skip to the far end --- */
r.reset();
r.push(0, 0);
check('cannot jump to the end', r.push(95, 0) === 'out' && !r.done);

/* --- backwards is tolerated slightly, not rewarded --- */
r.reset();
for (x = 0; x <= 40; x += 2) r.push(x, 0);
var mid = r.index;
r.push(30, 0);
check('moving back does not lose progress', r.index === mid);

/* --- progress reporting --- */
r.reset();
for (x = 0; x <= 50; x += 2) r.push(x, 0);
check('progress is about half', Math.abs(r.progress() - 0.5) < 0.06);

/* --- resume point after lifting the finger --- */
check('resume point follows progress', Math.abs(r.resumePoint().x - 50) < 3);
check('can resume near the resume point', r.canBegin(50, 6));
check('cannot resume somewhere random', !r.canBegin(10, 0));

/* --- corners: a two segment path --- */
var corner = run('M0,0 L50,0 L50,50');
res = 'ok';
for (var i = 0; i <= 50 && res !== 'done'; i += 2) res = corner.push(i, 0);
for (i = 0; i <= 50 && res !== 'done'; i += 2) res = corner.push(50, i);
check('traces around a corner', res === 'done');

/* --- dots --- */
var dot = new Tracer.StrokeRun({ dot: true, x: 60, y: 46 }, { tolerance: TOL });
check('tap on the dot completes', dot.push(62, 48) === 'done');
dot.reset();
check('tap away from the dot is out', dot.push(60, 90) === 'out');

print(failures ? '\n' + failures + ' FAILURE(S)' : '\nall tracer tests passed');
if (failures) throw new Error('tracer tests failed');
