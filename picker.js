// Colour picker popover: saturation/brightness field + hue slider, hex, RGB sliders,
// presets and (where supported) an eyedropper. One shared instance.
//   ColorPicker.open(anchorEl, "#rrggbb", onChange, label)
(function () {
  "use strict";

  var PRESETS = [
    { hex: "#d3d4d1", name: "Light grey" }, { hex: "#2c2d30", name: "Dark grey" },
    { hex: "#ffb21e", name: "Warm yellow" }, { hex: "#b7922f", name: "Mustard" },
    { hex: "#f4f1ea", name: "Off-white" }, { hex: "#111214", name: "Off-black" }
  ];

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function hexToRgb(h) { var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function rgbToHex(r, g, b) { return "#" + [r, g, b].map(function (x) { return clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0"); }).join(""); }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
  }
  function hsvToRgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function normHex(t) {
    t = t.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split("").map(function (c) { return c + c; }).join("");
    return /^[0-9a-f]{6}$/i.test(t) ? "#" + t.toLowerCase() : null;
  }

  var el, state = { h: 0, s: 0, v: 0 }, onChange = null, anchor = null;
  // Optional in-page eyedropper supplied by the host page: { available(), start(done) }.
  // done(hex) on pick, done(null) on cancel. Works in every browser (the native
  // EyeDropper API is Chromium-only) and is preferred when available.
  var customEye = null, sampling = false;

  function build() {
    el = document.createElement("div");
    el.className = "cp";
    el.setAttribute("role", "dialog");
    el.hidden = true;
    el.innerHTML =
      '<div class="cp-head"><span class="cp-title"></span><button class="cp-close" type="button" aria-label="Close colour picker">&times;</button></div>' +
      '<div class="cp-sv" tabindex="0" role="slider" aria-label="Saturation and brightness" aria-valuetext=""><div class="cp-sv-thumb"></div></div>' +
      '<input class="cp-hue" type="range" min="0" max="359" step="1" aria-label="Hue">' +
      '<div class="cp-row">' +
        '<span class="cp-preview" aria-hidden="true"></span>' +
        '<label class="cp-hexlabel">Hex <input class="cp-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" inputmode="text"></label>' +
        '<button class="cp-eye" type="button" aria-label="Pick a colour from the screen" title="Eyedropper">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20.7 3.3a3 3 0 0 0-4.2 0l-2.6 2.6-1.4-1.4-1.4 1.4 1.4 1.4-7.8 7.8a2 2 0 0 0-.6 1.4V19H6.6a2 2 0 0 0 1.4-.6l7.8-7.8 1.4 1.4 1.4-1.4-1.4-1.4 2.6-2.6a3 3 0 0 0 0-4.3ZM7.2 17H6v-1.2l7.8-7.8 1.2 1.2Z"/></svg>' +
        "</button>" +
      "</div>" +
      ["R", "G", "B"].map(function (c, i) {
        return '<div class="cp-chan"><span>' + c + '</span><input class="cp-range" data-i="' + i + '" type="range" min="0" max="255" aria-label="' +
          ["Red", "Green", "Blue"][i] + '"><input class="cp-num" data-i="' + i + '" type="number" min="0" max="255" aria-label="' + ["Red", "Green", "Blue"][i] + ' value"></div>';
      }).join("") +
      '<div class="cp-presets">' + PRESETS.map(function (p) {
        return '<button type="button" class="cp-swatch" data-hex="' + p.hex + '" style="--c:' + p.hex + '" title="' + p.name + " " + p.hex + '" aria-label="' + p.name + " " + p.hex + '"></button>';
      }).join("") + "</div>";
    document.body.appendChild(el);

    var sv = el.querySelector(".cp-sv");
    function svFromPointer(e) {
      var r = sv.getBoundingClientRect();
      state.s = clamp((e.clientX - r.left) / r.width, 0, 1);
      state.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
      fromHsv();
    }
    sv.addEventListener("pointerdown", function (e) { sv.setPointerCapture(e.pointerId); svFromPointer(e); });
    sv.addEventListener("pointermove", function (e) { if (sv.hasPointerCapture(e.pointerId)) svFromPointer(e); });
    sv.addEventListener("keydown", function (e) {
      var st = e.shiftKey ? 0.1 : 0.01, k = e.key;
      if (k === "ArrowLeft") state.s -= st; else if (k === "ArrowRight") state.s += st;
      else if (k === "ArrowUp") state.v += st; else if (k === "ArrowDown") state.v -= st; else return;
      e.preventDefault(); state.s = clamp(state.s, 0, 1); state.v = clamp(state.v, 0, 1); fromHsv();
    });
    el.querySelector(".cp-hue").addEventListener("input", function (e) { state.h = +e.target.value; fromHsv(); });
    el.querySelector(".cp-hex").addEventListener("input", function (e) {
      var hx = normHex(e.target.value);
      e.target.toggleAttribute("aria-invalid", !hx);
      if (hx) setHex(hx, "hex");
    });
    el.querySelectorAll(".cp-range, .cp-num").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var rgb = hexToRgb(current());
        rgb[+inp.dataset.i] = clamp(+inp.value || 0, 0, 255);
        setHex(rgbToHex(rgb[0], rgb[1], rgb[2]), inp.classList.contains("cp-num") ? "num" : "range");
      });
    });
    el.querySelectorAll(".cp-swatch").forEach(function (b) {
      b.addEventListener("click", function () { setHex(b.dataset.hex); });
    });
    var eye = el.querySelector(".cp-eye");
    eye.addEventListener("click", function () {
      if (customEye && customEye.available()) {
        var done = onChange;
        sampling = true; el.classList.add("sampling");
        customEye.start(function (hex) {
          sampling = false; el.classList.remove("sampling");
          if (!hex) return;
          if (!el.hidden) setHex(hex); else if (done) done(hex);
        });
        return;
      }
      // Remember who asked, so the picked colour still lands even if the popover
      // closed while the eyedropper was open. Esc cancels the pick (rejects): ignore.
      var cb = onChange;
      new window.EyeDropper().open().then(function (r) {
        var raw = String(r.sRGBHex || ""), hex = normHex(raw);
        var m = !hex && raw.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);   // some builds return rgb()
        if (m) hex = rgbToHex(+m[1], +m[2], +m[3]);
        if (!hex) return;
        if (!el.hidden) setHex(hex);
        else if (cb) cb(hex);
      }).catch(function () {});
    });
    el.querySelector(".cp-close").addEventListener("click", close);
    document.addEventListener("pointerdown", function (e) {
      if (sampling) return;
      if (!el.hidden && !el.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el.hidden && !sampling) { close(); } });
    window.addEventListener("resize", function () { if (!el.hidden) place(); });
  }

  function current() { var c = hsvToRgb(state.h, state.s, state.v); return rgbToHex(c[0], c[1], c[2]); }
  function fromHsv() { sync(); if (onChange) onChange(current()); }
  function setHex(hex, source) {
    var c = hexToRgb(hex), hsv = rgbToHsv(c[0], c[1], c[2]);
    if (hsv[1] > 0 && hsv[2] > 0) state.h = hsv[0];          // keep hue when greyscale/black
    state.s = hsv[1]; state.v = hsv[2];
    sync(source, hex); if (onChange) onChange(hex);
  }

  // Update every control from state (skip the one being typed in).
  function sync(source, exact) {
    var hex = exact || current(), rgb = hexToRgb(hex);
    var sv = el.querySelector(".cp-sv");
    sv.style.setProperty("--hue", "hsl(" + state.h + " 100% 50%)");
    var th = el.querySelector(".cp-sv-thumb");
    th.style.left = state.s * 100 + "%"; th.style.top = (1 - state.v) * 100 + "%";
    th.style.background = hex;
    sv.setAttribute("aria-valuetext", "saturation " + Math.round(state.s * 100) + "%, brightness " + Math.round(state.v * 100) + "%");
    el.querySelector(".cp-hue").value = Math.round(state.h);
    el.querySelector(".cp-preview").style.background = hex;
    if (source !== "hex") { var hx = el.querySelector(".cp-hex"); hx.value = hex; hx.removeAttribute("aria-invalid"); }
    el.querySelectorAll(".cp-chan").forEach(function (row, i) {
      var lo = rgb.slice(), hi = rgb.slice(); lo[i] = 0; hi[i] = 255;
      var r = row.querySelector(".cp-range"), n = row.querySelector(".cp-num");
      r.style.setProperty("--track", "linear-gradient(90deg," + rgbToHex(lo[0], lo[1], lo[2]) + "," + rgbToHex(hi[0], hi[1], hi[2]) + ")");
      if (source !== "range") r.value = rgb[i];
      if (source !== "num") n.value = rgb[i];
    });
  }

  function place() {
    var r = anchor.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight, m = 12;
    var left = r.left + r.width / 2 - pw / 2, top = r.bottom + m;
    if (top + ph > window.innerHeight - m) top = Math.max(m, r.top - ph - m);
    el.style.left = clamp(left, m, window.innerWidth - pw - m) + "px";
    el.style.top = top + "px";
  }

  function open(anchorEl, hex, cb, label) {
    if (!el) build();
    anchor = anchorEl; onChange = null;
    el.querySelector(".cp-title").textContent = label || "Colour";
    el.setAttribute("aria-label", (label || "Colour") + " picker");
    setHex(hex); onChange = cb;
    var eye = el.querySelector(".cp-eye"), mine = customEye && customEye.available();
    eye.hidden = !mine && !("EyeDropper" in window);
    eye.title = mine ? "Pick a colour from your photo" : "Pick a colour from the screen";
    eye.setAttribute("aria-label", eye.title);
    el.hidden = false; place();
    anchorEl.setAttribute("aria-expanded", "true");
    el.querySelector(".cp-sv").focus({ preventScroll: true });
  }
  function close() {
    if (!el || el.hidden) return;
    el.hidden = true; onChange = null;
    if (anchor) { anchor.setAttribute("aria-expanded", "false"); anchor.focus({ preventScroll: true }); }
  }

  window.ColorPicker = { open: open, close: close, setEyedropper: function (impl) { customEye = impl; } };
})();
