/* Feedback: vibration / haptics, sound effects, speech.
 *
 * Vibration reality check:
 *  - Android Chrome/Firefox: navigator.vibrate() works (needs a user gesture first).
 *  - iPhone (iOS 17.4+): no Vibration API, but toggling a hidden
 *    <input type="checkbox" switch> triggers the system Taptic Engine.
 *  - iPad: no vibration motor exists in the hardware, so nothing can buzz.
 *    We fall back to a loud buzz tone + red flash + shake, which is what the
 *    child actually notices anyway.
 */
(function (global) {
  'use strict';

  var Feedback = {
    settings: { sound: true, vibrate: true, speech: true },
    ctx: null,
    hapticSwitch: null,
    _lastBuzz: 0,
    supports: { vibrate: false, iosHaptic: false }
  };

  Feedback.init = function () {
    this.supports.vibrate = typeof navigator.vibrate === 'function';

    // Best-effort iPhone haptics: activating a <input type="checkbox" switch>
    // through its label can fire the Taptic Engine on iOS 17.4+. It is not a
    // documented API and may do nothing, so it is never reported as supported.
    if ('switch' in document.createElement('input')) {
      var wrap = document.createElement('span');
      wrap.setAttribute('aria-hidden', 'true');
      wrap.style.cssText =
        'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none';
      wrap.innerHTML =
        '<input id="haptic-switch" type="checkbox" switch tabindex="-1">' +
        '<label id="haptic-label" for="haptic-switch"></label>';
      document.body.appendChild(wrap);
      this.hapticSwitch = wrap.querySelector('label');
      this.supports.iosHaptic = true; // attempted, not guaranteed
    }
  };

  /* Audio must be unlocked by a real user gesture (iOS rule). */
  Feedback.unlock = function () {
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.ctx && !this._unlocked) {
      this._unlocked = true;
      var b = this.ctx.createBuffer(1, 1, 22050);
      var src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(0);
    }
  };

  Feedback.tone = function (opts) {
    if (!this.settings.sound || !this.ctx) return;
    var ctx = this.ctx;
    var now = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from, now);
    if (opts.to && opts.to !== opts.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), now + opts.dur);
    }
    var vol = opts.vol == null ? 0.22 : opts.vol;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + opts.dur + 0.05);
  };

  Feedback.vibrate = function (pattern) {
    if (!this.settings.vibrate) return;
    if (this.supports.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        /* ignore */
      }
    }
    if (this.hapticSwitch) {
      var el = this.hapticSwitch;
      var pulses = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
      for (var i = 0; i < Math.min(pulses, 3); i++) {
        setTimeout(function () {
          try { el.click(); } catch (e) { /* ignore */ }
        }, i * 90);
      }
    }
  };

  /* --- named effects --- */

  Feedback.outOfBounds = function () {
    var now = Date.now();
    if (now - this._lastBuzz < 260) return false;
    this._lastBuzz = now;
    this.vibrate([90, 60, 90]);
    this.tone({ type: 'square', from: 190, to: 110, dur: 0.18, vol: 0.14 });
    return true;
  };

  Feedback.strokeStart = function () {
    this.vibrate(18);
    this.tone({ type: 'sine', from: 520, to: 660, dur: 0.1, vol: 0.1 });
  };

  Feedback.wrongStart = function () {
    this.vibrate([50, 50, 50]);
    this.tone({ type: 'triangle', from: 300, to: 180, dur: 0.16, vol: 0.12 });
  };

  Feedback.strokeDone = function () {
    this.vibrate(35);
    this.tone({ type: 'sine', from: 660, to: 880, dur: 0.16, vol: 0.16 });
  };

  Feedback.letterDone = function () {
    this.vibrate([40, 60, 40, 60, 90]);
    var notes = [523, 659, 784, 1046];
    for (var i = 0; i < notes.length; i++) {
      this.tone({ type: 'sine', from: notes[i], dur: 0.3, vol: 0.18, delay: i * 0.11 });
    }
  };

  Feedback.tick = function () {
    this.tone({ type: 'sine', from: 900, dur: 0.04, vol: 0.05 });
  };

  Feedback.stopSpeech = function () {
    clearTimeout(this._speechTimer);
    clearTimeout(this._speechGuard);
    this._speechTimer = null;
    this._speechGuard = null;
    if (global.speechSynthesis) {
      try { global.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
  };

  Feedback.say = function (text, rate) {
    this.sayParts([text], 0, rate);
  };

  /* Speak each part in turn, with a real pause between them. Waiting for the
   * 'end' event keeps the gap correct whatever the phrase length; the guard
   * timer covers iOS not always firing it. */
  Feedback.sayParts = function (parts, gapMs, rate) {
    if (!this.settings.speech || !global.speechSynthesis) return;
    this.stopSpeech();

    var self = this;
    var queue = parts.slice();
    var gap = gapMs == null ? 700 : gapMs;

    function next() {
      if (!queue.length) return;
      var text = queue.shift();
      var advanced = false;
      function advance() {
        if (advanced) return;
        advanced = true;
        clearTimeout(self._speechGuard);
        if (queue.length) self._speechTimer = setTimeout(next, gap);
      }
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.rate = rate || 0.85;
        u.pitch = 1.15;
        u.lang = 'en-US';
        u.onend = advance;
        u.onerror = advance;
        global.speechSynthesis.speak(u);
        self._speechGuard = setTimeout(advance, 1400 + text.length * 90);
      } catch (e) {
        advance();
      }
    }
    next();
  };

  global.Feedback = Feedback;
})(window);
