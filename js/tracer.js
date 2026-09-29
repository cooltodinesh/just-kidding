/* Tracer: turns SVG stroke data into sampled points, then tracks how far a
 * finger has correctly followed each stroke, in order and in the right
 * direction. All coordinates are in "paper" units (120 x 170).
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SAMPLE_STEP = 1.2; // paper units between samples
  var cache = {};
  var svg, probe;

  function ensureSvg() {
    if (svg) return;
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;left:-9999px;top:0;overflow:hidden';
    probe = document.createElementNS(SVG_NS, 'path');
    svg.appendChild(probe);
    document.body.appendChild(svg);
  }

  /* Sample a path into evenly spaced points with tangent angles. */
  function samplePath(d) {
    if (cache[d]) return cache[d];
    ensureSvg();
    probe.setAttribute('d', d);
    var total = probe.getTotalLength();
    var n = Math.max(2, Math.round(total / SAMPLE_STEP));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var p = probe.getPointAtLength((total * i) / n);
      pts.push({ x: p.x, y: p.y });
    }
    for (var j = 0; j < pts.length; j++) {
      var a = pts[Math.max(0, j - 2)];
      var b = pts[Math.min(pts.length - 1, j + 2)];
      pts[j].angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
    cache[d] = { pts: pts, length: total, step: total / n };
    return cache[d];
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return dx * dx + dy * dy;
  }

  /* ---------------------------------------------------------------- */

  function StrokeRun(stroke, opts) {
    this.stroke = stroke;
    this.isDot = !!stroke.dot;
    this.tolerance = opts.tolerance;
    if (this.isDot) {
      this.pts = [{ x: stroke.x, y: stroke.y, angle: 0 }];
      this.length = 0;
    } else {
      var sampled = samplePath(stroke.d);
      this.pts = sampled.pts;
      this.length = sampled.length;
      this.step = sampled.step;
    }
    this.reset();
  }

  StrokeRun.prototype.reset = function () {
    this.index = 0;
    this.started = false;
    this.done = false;
    this.ink = [];
  };

  StrokeRun.prototype.startPoint = function () {
    return this.pts[0];
  };

  StrokeRun.prototype.resumePoint = function () {
    return this.pts[Math.min(this.index, this.pts.length - 1)];
  };

  StrokeRun.prototype.progress = function () {
    if (this.isDot) return this.done ? 1 : 0;
    return this.index / (this.pts.length - 1);
  };

  /* Can a press at (x,y) begin (or resume) this stroke? */
  StrokeRun.prototype.canBegin = function (x, y) {
    var target = this.index > 0 ? this.resumePoint() : this.startPoint();
    var r = this.isDot ? this.tolerance * 1.6 : this.tolerance * 1.5;
    return dist2(x, y, target.x, target.y) <= r * r;
  };

  /* Feed one point. Returns 'ok' | 'out' | 'done'. */
  StrokeRun.prototype.push = function (x, y) {
    if (this.done) return 'done';

    if (this.isDot) {
      var r = this.tolerance * 1.6;
      if (dist2(x, y, this.pts[0].x, this.pts[0].y) <= r * r) {
        this.done = true;
        this.index = 0;
        return 'done';
      }
      return 'out';
    }

    // How far ahead the finger may jump in one move (prevents skipping).
    var lookAhead = Math.max(12, Math.round(this.tolerance * 2.2 / this.step));
    var best = -1;
    var bestD2 = Infinity;
    var end = Math.min(this.pts.length - 1, this.index + lookAhead);
    // Allow a little backward slack so wobbling does not read as an error.
    var start = Math.max(0, this.index - 6);
    for (var i = start; i <= end; i++) {
      var d = dist2(x, y, this.pts[i].x, this.pts[i].y);
      if (d < bestD2) {
        bestD2 = d;
        best = i;
      }
    }

    var tol = this.tolerance;
    if (bestD2 > tol * tol) return 'out';

    if (best > this.index) this.index = best;
    this.ink.push({ x: x, y: y });

    // Finished when close enough to the end of the path.
    var remaining = this.pts.length - 1 - this.index;
    if (remaining * this.step <= Math.max(2.5, this.tolerance * 0.55)) {
      this.index = this.pts.length - 1;
      this.done = true;
      return 'done';
    }
    return 'ok';
  };

  global.Tracer = {
    samplePath: samplePath,
    StrokeRun: StrokeRun
  };
})(window);
