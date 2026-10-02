// Dither: image -> two-colour dithered bitmap -> SVG/PNG. No dependencies.
(function () {
  "use strict";

  function bayer(n) {                       // n = 2, 4 or 8
    var m = [[0]];
    for (var s = 1; s < n; s *= 2) {
      var r = [];
      for (var y = 0; y < s * 2; y++) {
        r.push([]);
        for (var x = 0; x < s * 2; x++) {
          r[y].push(4 * m[y % s][x % s] + [0, 2, 3, 1][(y < s ? 0 : 2) + (x < s ? 0 : 1)]);
        }
      }
      m = r;
    }
    return m;
  }
  var BAYER = { 2: bayer(2), 4: bayer(4), 8: bayer(8) };

  // Downscale the source to `cols` dots across (stepwise halving keeps it sharp-but-smooth).
  // `rows` is optional (ASCII mode passes it, since character cells aren't square).
  // Returns luminance L plus each cell's colour (rgb, 3 bytes per cell) for tinting.
  function sample(img, cols, rowsWanted) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    cols = Math.max(8, Math.min(cols, iw));
    var rows = Math.max(1, Math.min(ih, rowsWanted || Math.round(cols * ih / iw)));
    var src = img, w = iw, h = ih;
    while (w / 2 > cols) {
      var c = document.createElement("canvas");
      w = Math.round(w / 2); h = Math.round(h / 2);
      c.width = w; c.height = h;
      var cx = c.getContext("2d"); cx.imageSmoothingQuality = "high";
      cx.drawImage(src, 0, 0, w, h); src = c;
    }
    var out = document.createElement("canvas"); out.width = cols; out.height = rows;
    var ox = out.getContext("2d", { willReadFrequently: true });
    ox.imageSmoothingQuality = "high"; ox.drawImage(src, 0, 0, cols, rows);
    var d = ox.getImageData(0, 0, cols, rows).data, L = new Float32Array(cols * rows), rgb = new Uint8ClampedArray(cols * rows * 3);
    for (var i = 0; i < L.length; i++) {
      var a = d[i * 4 + 3] / 255;                     // transparent pixels read as paper
      L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 * a + (1 - a);
      rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
    }
    return { w: cols, h: rows, L: L, rgb: rgb };
  }

  // Tone adjustments, in this order: brightness, contrast, gamma, sharpen.
  function adjust(s, o) {
    var w = s.w, h = s.h, src = s.L, L = new Float32Array(src.length);
    var c = o.contrast >= 0 ? 1 + o.contrast / 50 : 1 + o.contrast / 100;   // -100..100
    for (var i = 0; i < L.length; i++) {
      var v = src[i] + o.brightness / 100;
      v = (v - 0.5) * c + 0.5;
      v = Math.min(1, Math.max(0, v));
      L[i] = Math.pow(v, 1 / o.gamma);
    }
    if (o.sharpen > 0) {
      var out = new Float32Array(L.length);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var sum = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) { sum += L[yy * w + xx]; n++; }
        }
        var p = y * w + x;
        out[p] = L[p] + o.sharpen * (L[p] - sum / n);
      }
      L = out;
    }
    return L;
  }

  // Dither luminance to `levels` evenly spaced tones (2-4).
  // Returns Uint8Array of palette indices: 0 = darkest colour ... levels-1 = lightest.
  function dither(L, w, h, algo, levels) {
    var n = (levels || 2) - 1, idx = new Uint8Array(w * h);
    if (algo === "threshold") {
      for (var i = 0; i < idx.length; i++) idx[i] = Math.round(Math.min(1, Math.max(0, L[i])) * n);
      return idx;
    }
    if (algo.indexOf("bayer") === 0) {
      var size = +algo.slice(5), m = BAYER[size], nn = size * size;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = y * w + x, v = Math.min(1, Math.max(0, L[p])) * n, k = Math.floor(v);
        if (k >= n) { idx[p] = n; continue; }
        idx[p] = v - k > (m[y % size][x % size] + 0.5) / nn ? k + 1 : k;
      }
      return idx;
    }
    // Error diffusion (serpentine scan): quantise to the nearest tone, spread the error.
    var K = algo === "atkinson"
      ? { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] }
      : { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] };      // Floyd-Steinberg
    var e = Float32Array.from(L);
    for (var y2 = 0; y2 < h; y2++) {
      var rev = y2 & 1;
      for (var i2 = 0; i2 < w; i2++) {
        var x2 = rev ? w - 1 - i2 : i2, q = y2 * w + x2, old = e[q];
        var lvl = Math.round(Math.min(1, Math.max(0, old)) * n);
        idx[q] = lvl;
        var err = (old - lvl / n) / K.div;
        for (var j = 0; j < K.k.length; j++) {
          var tx = x2 + (rev ? -K.k[j][0] : K.k[j][0]), ty = y2 + K.k[j][1];
          if (tx >= 0 && tx < w && ty < h) e[ty * w + tx] += err * K.k[j][2];
        }
      }
    }
    return idx;
  }

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // palette: array of hex colours, darkest tone first.
  function paint(canvas, idx, w, h, palette) {
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
    var pal = palette.map(hexToRgb);
    for (var i = 0; i < idx.length; i++) {
      var c = pal[idx[i]], o = i * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Vector export: background rect in the most common colour, then one path per other
  // colour made of merged horizontal runs. Crisp at any size, reasonably small.
  function toSVG(idx, w, h, palette) {
    var counts = palette.map(function () { return 0; });
    for (var i = 0; i < idx.length; i++) counts[idx[i]]++;
    var bg = counts.indexOf(Math.max.apply(null, counts));
    var paths = palette.map(function () { return []; });
    for (var y = 0; y < h; y++) {
      var x = 0;
      while (x < w) {
        var c = idx[y * w + x], s0 = x;
        while (x < w && idx[y * w + x] === c) x++;
        if (c !== bg) paths[c].push("M" + s0 + " " + y + "h" + (x - s0) + "v1h-" + (x - s0) + "z");
      }
    }
    var body = '<rect width="' + w + '" height="' + h + '" fill="' + palette[bg] + '"/>';
    palette.forEach(function (col, k) {
      if (k !== bg && paths[k].length) body += '<path fill="' + col + '" d="' + paths[k].join("") + '"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h +
      '" shape-rendering="crispEdges">' + body + "</svg>";
  }

  // Dithered fade: dissolve the image into one palette colour across a band, using the
  // 8x8 Bayer matrix so the transition is made of the same single pixels as the art.
  //   f = { edge: "bottom" | "top", a: 0..1, b: 0..1 (a < b, as fractions of height), color: palette index }
  // bottom: image above a, dissolving between a and b, solid colour below b. top: the mirror.
  function fade(idx, w, h, f) {
    var out = Uint8Array.from(idx), m = BAYER[8];
    var a = Math.min(f.a, f.b) * h, b = Math.max(f.a, f.b) * h, span = Math.max(1, b - a);
    for (var y = 0; y < h; y++) {
      var t = (y + 0.5 - a) / span;                 // 0 at line a, 1 at line b
      if (f.edge === "top") t = 1 - t;
      if (t <= 0) continue;
      var row = m[y & 7];
      for (var x = 0; x < w; x++) {
        if (t >= 1 || t > (row[x & 7] + 0.5) / 64) out[y * w + x] = f.color;
      }
    }
    return out;
  }

  // Is this image already a dithered piece (<= 4 flat colours)? Read it pixel-for-pixel at its
  // own size; if 4 colours cover ~all of it, return those pixels as palette indices.
  function readPredithered(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h || w * h > 4000 * 4000) return null;
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var cx = c.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, w, h);
    var d = cx.getImageData(0, 0, w, h).data, counts = new Map();
    for (var i = 0; i < d.length; i += 4) {
      var k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
      if (counts.size > 64) return null;                  // a photo, not flat dithered art
    }
    var top = Array.from(counts.entries()).sort(function (p, q) { return q[1] - p[1]; }).slice(0, 4);
    var covered = top.reduce(function (s, e) { return s + e[1]; }, 0);
    if (top.length < 2 || covered < 0.995 * w * h) return null;
    var lum = function (k) { return 0.2126 * (k >> 16) + 0.7152 * ((k >> 8) & 255) + 0.0722 * (k & 255); };
    var keys = top.map(function (e) { return e[0]; }).sort(function (p, q) { return lum(p) - lum(q); });   // darkest first
    var rgbs = keys.map(function (k) { return [k >> 16, (k >> 8) & 255, k & 255]; });
    var idx = new Uint8Array(w * h);
    for (var j = 0, p = 0; j < d.length; j += 4, p++) {
      var best = 0, bd = 1e9;                              // stray pixels snap to the nearest colour
      for (var q = 0; q < rgbs.length; q++) {
        var dr = d[j] - rgbs[q][0], dg = d[j + 1] - rgbs[q][1], db = d[j + 2] - rgbs[q][2], dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = q; }
      }
      idx[p] = best;
    }
    return { w: w, h: h, idx: idx, palette: keys.map(function (k) { return "#" + k.toString(16).padStart(6, "0"); }) };
  }

  window.DitherCore = { sample: sample, adjust: adjust, dither: dither, paint: paint, toSVG: toSVG, fade: fade, readPredithered: readPredithered };
})();
