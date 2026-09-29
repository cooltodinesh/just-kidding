/* Dev-only: dump generated letter paths as JSON for tools/render_check.py.
 * Run with JavaScriptCore:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tools/dump_letters.js
 */
var window = this;
load('js/letters.js');

var out = {};
['upper', 'lower', 'digits'].forEach(function (k) {
  LETTERS[k].forEach(function (l) {
    out[k[0] + ':' + l.id] = l.strokes.map(function (s) {
      return s.dot ? 'DOT ' + s.x + ' ' + s.y : s.d;
    });
  });
});

print(JSON.stringify({ box: LETTERS.box, guides: LETTERS.guides, letters: out }));
