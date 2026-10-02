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

  // Colour themes: each is ordered darkest -> lightest. Dither mode uses them as the palette;
  // ASCII mode uses the darkest as the background and the rest as text colours.
  var THEMES = [
    { name: "Lake",           colors: ["#003e25", "#858e8e", "#f58e00"] },
    { name: "Popcorn",        colors: ["#000000", "#975a1d", "#dbac00", "#e5c300"] },
    { name: "Game Boy",       colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] },
    { name: "Amber Terminal", colors: ["#140b00", "#7a4a00", "#ffb000"] },
    { name: "Phosphor",       colors: ["#03140a", "#1f7a3c", "#7dffa0"] },
    { name: "Blueprint",      colors: ["#0b2a5b", "#3f6fb5", "#e6eefc"] },
    { name: "Risograph",      colors: ["#0078bf", "#ff48b0", "#f7f1e3"] },
    { name: "Sunset",         colors: ["#2b1a3d", "#b8406a", "#f7a35c", "#fbe7c6"] },
    { name: "Sepia",          colors: ["#2a1d14", "#7a5a3c", "#c9a77c", "#f3e6cf"] },
    { name: "Ocean",          colors: ["#08233a", "#1f6f8b", "#99d5c9", "#f0f7f4"] },
    { name: "Paper & Ink",    colors: ["#1b1b1f", "#f2efe6"] }
  ];

  function hexLum(hex) {
    var v = parseInt(hex.slice(1), 16);
    return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  }
  // Light text on a dark background means bright parts of the photo get the dense characters.
  // `inks` may be one colour or a list; their average brightness is compared to the background.
  function brightIsDense(inks, paper) {
    inks = [].concat(inks);
    var avg = inks.reduce(function (t, h) { return t + hexLum(h); }, 0) / inks.length;
    return avg > hexLum(paper);
  }
  function sortByLum(list) { return list.slice().sort(function (a, b) { return hexLum(a) - hexLum(b); }); }

  // L: luminance grid (w x h), one value per character cell.
  // mask (optional): 0 = see-through cell, drawn as a blank.
  function toLines(L, w, h, ramp, algo, brightDense, mask) {
    var n = ramp.length, idx = DitherCore.dither(L, w, h, algo, n), lines = [];
    for (var y = 0; y < h; y++) {
      var row = "";
      for (var x = 0; x < w; x++) {
        if (mask && !mask[y * w + x]) { row += " "; continue; }
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
  function toBraille(L, w, h, algo, brightDense, mask) {
    var bits = DitherCore.dither(L, w, h, algo, 2), cols = Math.floor(w / 2), rows = Math.floor(h / 4), lines = [];
    for (var cy = 0; cy < rows; cy++) {
      var row = "";
      for (var cx = 0; cx < cols; cx++) {
        var mask = 0;
        for (var dy = 0; dy < 4; dy++) for (var dx = 0; dx < 2; dx++) {
          var at = (cy * 4 + dy) * w + cx * 2 + dx;
          var on = bits[at] === (brightDense ? 1 : 0) && (!mask || mask[at]);
          if (on) mask |= DOT[dy][dx];
        }
        row += String.fromCharCode(0x2800 + mask);
      }
      lines.push(row);
    }
    return lines;
  }

  // Average luminance per character cell (Braille samples 2x4 dots per character).
  function cellLum(L, w, h, cols, rows) {
    if (w === cols && h === rows) return L;
    var bx = w / cols, by = h / rows, out = new Float32Array(cols * rows);
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var t = 0, n = 0;
      for (var yy = Math.floor(y * by); yy < Math.floor((y + 1) * by); yy++)
        for (var xx = Math.floor(x * bx); xx < Math.floor((x + 1) * bx); xx++) { t += L[yy * w + xx]; n++; }
      out[y * cols + x] = n ? t / n : 0;
    }
    return out;
  }

  // Multi-colour text: each text colour owns a band of tones (inks[0] = shadows ... last =
  // highlights), dithered between neighbours so characters blend instead of banding.
  function bandColors(Lcell, cols, rows, inks, algo) {
    var band = DitherCore.dither(Lcell, cols, rows, algo, inks.length), rgb = inks.map(function (h) {
      var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }), out = new Uint8ClampedArray(cols * rows * 3);
    for (var i = 0; i < band.length; i++) { var c = rgb[band[i]]; out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; }
    return out;
  }

  // Average adjusted RGB per character cell (Braille cells cover 2x4 samples).
  function cellRGB(F, w, h, cols, rows) {
    if (w === cols && h === rows) return F;
    var bx = w / cols, by = h / rows, out = new Float32Array(cols * rows * 3);
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var r = 0, g = 0, b = 0, n = 0;
      for (var yy = Math.floor(y * by); yy < Math.floor((y + 1) * by); yy++)
        for (var xx = Math.floor(x * bx); xx < Math.floor((x + 1) * bx); xx++) { var o = (yy * w + xx) * 3; r += F[o]; g += F[o + 1]; b += F[o + 2]; n++; }
      var p = (y * cols + x) * 3; out[p] = n ? r / n : 0; out[p + 1] = n ? g / n : 0; out[p + 2] = n ? b / n : 0;
    }
    return out;
  }
  // Palette indices -> per-character rgb bytes.
  function colorsFromIdx(idx, inks) {
    var rgb = inks.map(function (h) { var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; });
    var out = new Uint8ClampedArray(idx.length * 3);
    for (var i = 0; i < idx.length; i++) { var c = rgb[idx[i]]; out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; }
    return out;
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
    if (o.clear) ctx.clearRect(0, 0, canvas.width, canvas.height);   // transparent background
    else { ctx.fillStyle = o.paper; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.font = fs + "px " + FONT; ctx.textBaseline = "top";
    for (var y = 0; y < lines.length; y++) {
      if (!o.colors) {
        ctx.fillStyle = o.ink; ctx.fillText(lines[y], 0, y * fs);
        continue;
      }
      var x = 0, line = lines[y];
      while (x < line.length) {                              // coloured: group runs of the same colour
        var p = (y * cols + x) * 3, r = o.colors[p], g = o.colors[p + 1], b = o.colors[p + 2], s0 = x;
        while (x < line.length) {
          var q = (y * cols + x) * 3;
          if (o.colors[q] !== r || o.colors[q + 1] !== g || o.colors[q + 2] !== b) break;
          x++;
        }
        ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
        for (var k = s0; k < x; k++) { var ch = line[k]; if (ch !== " " && ch !== "\u2800") ctx.fillText(ch, k * cw, y * fs); }
      }
    }
    return { cw: cw };
  }

  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function hex2(v) { return (v >> 4 << 4).toString(16).padStart(2, "0"); }   // 4-bit per channel keeps tinted SVGs small
  function hex8(v) { return (v | 0).toString(16).padStart(2, "0"); }        // exact, for theme colours

  // Vector export: real <text>, each run forced to its exact width with textLength so the grid
  // lines up whatever monospace font the viewer has.
  function toSVG(lines, o) {
    var fs = 10, cw = fs * o.aspect, cols = lines[0] ? lines[0].length : 0, hx = o.exact ? hex8 : hex2;
    var W = +(cols * cw).toFixed(2), H = lines.length * fs, body = "";
    for (var y = 0; y < lines.length; y++) {
      var line = lines[y], baseY = (y * fs + fs * 0.8).toFixed(2);
      if (!o.colors) {
        if (line.trim()) body += '<text x="0" y="' + baseY + '" textLength="' + W + '" lengthAdjust="spacingAndGlyphs">' + esc(line) + "</text>";
        continue;
      }
      var x = 0;
      while (x < cols) {                                  // runs of characters sharing a (rounded) colour
        var p = (y * cols + x) * 3, col = "#" + hx(o.colors[p]) + hx(o.colors[p + 1]) + hx(o.colors[p + 2]), s0 = x;
        while (x < cols) {
          var q = (y * cols + x) * 3;
          if ("#" + hx(o.colors[q]) + hx(o.colors[q + 1]) + hx(o.colors[q + 2]) !== col) break;
          x++;
        }
        var run = line.slice(s0, x);
        if (run.trim() && run.replace(/⠀/g, "")) body += '<text x="' + (s0 * cw).toFixed(2) + '" y="' + baseY + '" fill="' + col +
          '" textLength="' + ((x - s0) * cw).toFixed(2) + '" lengthAdjust="spacingAndGlyphs">' + esc(run) + "</text>";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' +
      (o.clear ? "" : '<rect width="100%" height="100%" fill="' + o.paper + '"/>') +
      '<g font-family="' + FONT.replace(/"/g, "'") + '" font-size="' + fs + '" xml:space="preserve"' + (o.colors ? "" : ' fill="' + o.ink + '"') + ">" +
      body + "</g></svg>";
  }

  window.Ascii = { SETS: SETS, THEMES: THEMES, sortByLum: sortByLum, cellLum: cellLum, cellRGB: cellRGB, colorsFromIdx: colorsFromIdx, bandColors: bandColors, brightIsDense: brightIsDense, toLines: toLines, toBraille: toBraille,
                   cellColors: cellColors, cellAspect: cellAspect, paint: paint, toSVG: toSVG, FONT: FONT };
})();
