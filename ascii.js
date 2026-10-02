// ASCII art for Dither Studio: luminance grid -> characters -> canvas / text / SVG.
// Reuses DitherCore's dithering to pick characters, so shading stays smooth.
(function () {
  "use strict";

  // Ramps run from sparse (light coverage) to dense (heavy coverage).
  var SETS = {
    classic: " .:-=+*#%@",
    detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    blocks: " ░▒▓█"
  };

  function hexLum(hex) {
    var v = parseInt(hex.slice(1), 16);
    return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  }
  // Light text on a dark background means bright parts of the photo get the dense characters.
  function brightIsDense(ink, paper) { return hexLum(ink) > hexLum(paper); }

  // L: luminance grid (w x h), one value per character cell.
  function toLines(L, w, h, ramp, algo, brightDense) {
    var n = ramp.length, idx = DitherCore.dither(L, w, h, algo, n), lines = [];
    for (var y = 0; y < h; y++) {
      var row = "";
      for (var x = 0; x < w; x++) {
        var k = idx[y * w + x];                       // 0 = darkest tone ... n-1 = lightest
        row += ramp[brightDense ? k : n - 1 - k];
      }
      lines.push(row);
    }
    return lines;
  }

  // Braille: each character is a 2x4 block of dots (U+2800 + bit mask), so L is sampled at
  // 2x the columns and 4x the rows and dithered to on/off dots.
  var DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];   // [row][col]
  function toBraille(L, w, h, algo, brightDense) {
    var bits = DitherCore.dither(L, w, h, algo, 2), cols = Math.floor(w / 2), rows = Math.floor(h / 4), lines = [];
    for (var cy = 0; cy < rows; cy++) {
      var row = "";
      for (var cx = 0; cx < cols; cx++) {
        var mask = 0;
        for (var dy = 0; dy < 4; dy++) for (var dx = 0; dx < 2; dx++) {
          var on = bits[(cy * 4 + dy) * w + cx * 2 + dx] === (brightDense ? 1 : 0);
          if (on) mask |= DOT[dy][dx];
        }
        row += String.fromCharCode(0x2800 + mask);
      }
      lines.push(row);
    }
    return lines;
  }

  // Per-character colours for "tint with photo colours" (averages blocks for Braille).
  // Keeps each cell's hue but sets its brightness for the background: lifted to full
  // brightness on dark backgrounds, deepened on light ones, so tinted text always reads.
  function cellColors(sampled, cols, rows, lightText) {
    var bx = sampled.w / cols, by = sampled.h / rows, out = new Uint8ClampedArray(cols * rows * 3);
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var r = 0, g = 0, b = 0, n = 0;
      for (var yy = Math.floor(y * by); yy < Math.floor((y + 1) * by); yy++)
        for (var xx = Math.floor(x * bx); xx < Math.floor((x + 1) * bx); xx++) {
          var o = (yy * sampled.w + xx) * 3; r += sampled.rgb[o]; g += sampled.rgb[o + 1]; b += sampled.rgb[o + 2]; n++;
        }
      r /= n; g /= n; b /= n;
      var mx = Math.max(r, g, b, 1), k = (lightText ? 255 : 105) / mx;
      k = lightText ? Math.max(1, k) : Math.min(1, k);
      var p = (y * cols + x) * 3; out[p] = r * k; out[p + 1] = g * k; out[p + 2] = b * k;
    }
    return out;
  }

  var FONT = '"Geist Mono", ui-monospace, Menlo, Consolas, monospace';
  // Width / height of one character cell (line height = font size), measured from the real font.
  function cellAspect() {
    var c = document.createElement("canvas").getContext("2d");
    c.font = "100px " + FONT;
    return c.measureText("M").width / 100;
  }

  // Draw lines onto a canvas at `fs` px per line. colors: optional per-cell rgb.
  function paint(canvas, lines, o) {
    var fs = o.fs, ctx = canvas.getContext("2d");
    ctx.font = fs + "px " + FONT;
    var cw = ctx.measureText("M").width, cols = lines[0] ? lines[0].length : 0;
    canvas.width = Math.max(1, Math.ceil(cols * cw)); canvas.height = Math.max(1, lines.length * fs);
    ctx.fillStyle = o.paper; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fs + "px " + FONT; ctx.textBaseline = "top";
    for (var y = 0; y < lines.length; y++) {
      if (!o.colors) {
        ctx.fillStyle = o.ink; ctx.fillText(lines[y], 0, y * fs);
        continue;
      }
      for (var x = 0; x < lines[y].length; x++) {             // tinted: one fill per character
        var ch = lines[y][x]; if (ch === " " || ch === "⠀") continue;
        var p = (y * cols + x) * 3;
        ctx.fillStyle = "rgb(" + o.colors[p] + "," + o.colors[p + 1] + "," + o.colors[p + 2] + ")";
        ctx.fillText(ch, x * cw, y * fs);
      }
    }
    return { cw: cw };
  }

  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function hex2(v) { return (v >> 4 << 4).toString(16).padStart(2, "0"); }   // 4-bit per channel keeps tinted SVGs small

  // Vector export: real <text>, each run forced to its exact width with textLength so the grid
  // lines up whatever monospace font the viewer has.
  function toSVG(lines, o) {
    var fs = 10, cw = fs * o.aspect, cols = lines[0] ? lines[0].length : 0;
    var W = +(cols * cw).toFixed(2), H = lines.length * fs, body = "";
    for (var y = 0; y < lines.length; y++) {
      var line = lines[y], baseY = (y * fs + fs * 0.8).toFixed(2);
      if (!o.colors) {
        if (line.trim()) body += '<text x="0" y="' + baseY + '" textLength="' + W + '" lengthAdjust="spacingAndGlyphs">' + esc(line) + "</text>";
        continue;
      }
      var x = 0;
      while (x < cols) {                                  // runs of characters sharing a (rounded) colour
        var p = (y * cols + x) * 3, col = "#" + hex2(o.colors[p]) + hex2(o.colors[p + 1]) + hex2(o.colors[p + 2]), s0 = x;
        while (x < cols) {
          var q = (y * cols + x) * 3;
          if ("#" + hex2(o.colors[q]) + hex2(o.colors[q + 1]) + hex2(o.colors[q + 2]) !== col) break;
          x++;
        }
        var run = line.slice(s0, x);
        if (run.trim() && run.replace(/⠀/g, "")) body += '<text x="' + (s0 * cw).toFixed(2) + '" y="' + baseY + '" fill="' + col +
          '" textLength="' + ((x - s0) * cw).toFixed(2) + '" lengthAdjust="spacingAndGlyphs">' + esc(run) + "</text>";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' +
      '<rect width="100%" height="100%" fill="' + o.paper + '"/>' +
      '<g font-family="' + FONT.replace(/"/g, "'") + '" font-size="' + fs + '" xml:space="preserve"' + (o.colors ? "" : ' fill="' + o.ink + '"') + ">" +
      body + "</g></svg>";
  }

  window.Ascii = { SETS: SETS, brightIsDense: brightIsDense, toLines: toLines, toBraille: toBraille,
                   cellColors: cellColors, cellAspect: cellAspect, paint: paint, toSVG: toSVG, FONT: FONT };
})();
