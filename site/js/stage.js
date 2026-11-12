/* The toon stage: a hand-built 2.5D canvas scene in black and white.
   Layers sit at a depth d (0 = sky, 1 = Bloop's island, >1 = foreground). The camera from
   site.js frames a world point; far layers move and zoom less, which gives the parallax. */
(function () {
  const B = window.Bloop, PET = window.BloopPet;
  const cv = document.getElementById('stage');
  const ctx = cv.getContext('2d');
  const TAU = Math.PI * 2;
  const INK = '#111';
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const g = (v) => { v = Math.round(clamp(v, 0, 255)); return `rgb(${v},${v},${v})`; };
  const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const reduced = () => B.reduce.matches;
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  let W = 0, H = 0, DPR = 1, unit = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    unit = W < 861 ? Math.min(H / 1000, W / 520) : Math.min(H / 900, W / 1400);
    makePetals();
    makeStars();
  }

  /* ---------- camera ---------- */
  const cam = { ...B.state().cam };
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, sx: -1, sy: -1 };
  function camStep(dt) {
    const tgt = B.state().cam;
    const k = reduced() ? 1 : 1 - Math.exp(-dt * 4.5);
    for (const key in tgt) cam[key] += (tgt[key] - cam[key]) * k;
    const kp = reduced() ? 0 : 1 - Math.exp(-dt * 3);
    ptr.x += (ptr.tx - ptr.x) * kp; ptr.y += (ptr.ty - ptr.y) * kp;
  }
  function params(d, c = cam) {
    const S = unit * Math.pow(c.z, 0.4 + 0.6 * d);
    return { S, ox: c.fx * W + ptr.x * d * 26 - c.tx * d * S, oy: c.fy * H + ptr.y * d * 16 - c.ty * d * S };
  }
  let S = 1, LW = 1;
  function layer(d) {
    const p = params(d);
    S = p.S;
    ctx.setTransform(DPR * S, 0, 0, DPR * S, DPR * p.ox, DPR * p.oy);
    LW = Math.sqrt(S / unit) / S; // line widths grow gently with zoom
    return p;
  }
  const px = (n) => n * LW;
  function toScreen(x, y, d) { const p = params(d); return [p.ox + x * p.S, p.oy + y * p.S, p.S]; }
  function bounds(d, m = 200) { const p = params(d); return { l: -p.ox / p.S - m, r: (W - p.ox) / p.S + m, t: -p.oy / p.S - m, b: (H - p.oy) / p.S + m }; }

  /* ---------- helpers ---------- */
  function spline(path, pts, closed = true) {
    const n = pts.length, at = (i) => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
    path.moveTo(pts[0][0], pts[0][1]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) path.closePath();
    return path;
  }
  function cr(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3),
      0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3)];
  }
  /** A tapered stroke along a spline, as a fillable outline (roots). */
  function taper(pts, w0, w1) {
    const n = pts.length, at = (i) => pts[clamp(i, 0, n - 1)], samp = [];
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < 8; k++) samp.push(cr(at(i - 1), at(i), at(i + 1), at(i + 2), k / 8));
    samp.push(pts[n - 1]);
    const L = [], R = [], m = samp.length;
    for (let i = 0; i < m; i++) {
      const a = samp[Math.max(0, i - 1)], b = samp[Math.min(m - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
      const w = lerp(w0, w1, Math.pow(i / (m - 1), 1.3)) / 2;
      L.push([samp[i][0] + nx * w, samp[i][1] + ny * w]); R.push([samp[i][0] - nx * w, samp[i][1] - ny * w]);
    }
    const shape = new Path2D(); shape.moveTo(L[0][0], L[0][1]);
    for (const p of L) shape.lineTo(p[0], p[1]);
    for (let i = R.length - 1; i >= 0; i--) shape.lineTo(R[i][0], R[i][1]);
    shape.closePath();
    const mid = new Path2D(); const end = Math.floor(m * 0.65);
    mid.moveTo((samp[0][0] + L[0][0]) / 2, (samp[0][1] + L[0][1]) / 2);
    for (let i = 1; i < end; i++) mid.lineTo((samp[i][0] * 0.55 + L[i][0] * 0.45), (samp[i][1] * 0.55 + L[i][1] * 0.45));
    return { shape, mid };
  }
  let boil = 0;
  const jit = (i) => (hash(i * 7.13 + boil * 3.71) - 0.5) * 2;

  /** Puffy cel-shaded cluster (canopy, clouds, little trees): thick ink silhouette, three flat greys. */
  function puff(lobes, o) {
    const sway = o.sway || 0, t = o.t || 0;
    const make = (inflate, dx, dy, sc) => {
      const p = new Path2D();
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const s = sway ? Math.sin(t * 1.05 + l.ph) * sway * l.w : 0;
        const r = Math.max(1, l.r * sc + inflate + (o.boil ? jit(i + o.seed) * l.r * 0.014 : 0));
        const cx = l.x + s + dx * l.r, cy = l.y + s * 0.25 + dy * l.r;
        p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, TAU);
      }
      return p;
    };
    ctx.fillStyle = o.ink; ctx.fill(make(o.lw, 0, 0, 1));
    const body = make(0, 0, 0, 1);
    ctx.fillStyle = o.shade; ctx.fill(body);
    ctx.save(); ctx.clip(body);
    ctx.fillStyle = o.mid; ctx.fill(make(0, -0.1, -0.17, 0.9));
    ctx.fillStyle = o.light; ctx.fill(make(0, -0.24, -0.36, 0.64));
    if (o.creases) {
      ctx.strokeStyle = o.ink; ctx.lineWidth = o.lw * 0.5; ctx.lineCap = 'round';
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i]; if (!l.crease) continue;
        const s = sway ? Math.sin(t * 1.05 + l.ph) * sway * l.w : 0;
        ctx.beginPath(); ctx.arc(l.x + s, l.y + s * 0.25, l.r * 0.96, 0.34 * Math.PI, 0.5 * Math.PI); ctx.stroke();
      }
    }
    if (o.after) o.after(make);
    ctx.restore();
  }
  function star4(x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.32 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
  }

  /* ---------- world: Bloop's island ---------- */
  const CAN = { x: 14, y: -400 };
  const canopy = (() => {
    const R = rng(11), lobes = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + R() * 0.2;
      const bottom = Math.sin(a) > 0.3;
      lobes.push({ x: Math.cos(a) * (250 + R() * 30), y: Math.sin(a) * (bottom ? 120 : 150) - (bottom ? 10 : 0), r: (bottom ? 78 : 92) + R() * 26 });
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + R();
      lobes.push({ x: Math.cos(a) * (120 + R() * 40), y: Math.sin(a) * (70 + R() * 30) - 20, r: 100 + R() * 30, crease: true });
    }
    lobes.push({ x: 0, y: -30, r: 140 });
    for (const l of lobes) { l.ph = l.x * 0.012 + l.y * 0.004; l.w = clamp(0.5 + (-l.y + 150) / 300, 0.4, 1.4);  }
    return lobes;
  })();
  const blossoms = (() => { const R = rng(5), out = []; for (let i = 0; i < 46; i++) { const l = canopy[(R() * canopy.length) | 0]; const a = R() * TAU, d = R() * l.r * 0.85; out.push({ l, x: Math.cos(a) * d, y: Math.sin(a) * d, r: 4 + R() * 3.5, rot: R() * TAU }); } return out; })();

  const trunkPath = spline(new Path2D(), [[-86, 8], [-44, -22], [-30, -120], [-34, -196], [-70, -250], [-128, -300], [-112, -322], [-40, -276], [-12, -330], [22, -336], [36, -280], [104, -320], [126, -300], [54, -236], [34, -170], [34, -60], [56, -14], [92, 10], [0, 22]]);
  const trunkShade = spline(new Path2D(), [[6, -350], [14, -240], [2, -150], [10, -60], [20, 30], [200, 30], [200, -350]]);
  const islandRock = spline(new Path2D(), [[-344, 10], [-326, 58], [-272, 104], [-214, 132], [-176, 196], [-112, 236], [-60, 300], [-16, 380], [22, 318], [76, 262], [128, 226], [172, 168], [240, 128], [296, 82], [344, 10]]);
  const rockLight = spline(new Path2D(), [[-344, 10], [-320, 60], [-262, 112], [-200, 150], [-160, 210], [-110, 238], [-80, 160], [-140, 90], [-220, 50], [-300, 20]]);
  const rockDark = spline(new Path2D(), [[40, 20], [60, 140], [10, 240], [-16, 380], [22, 318], [76, 262], [128, 226], [172, 168], [240, 128], [296, 82], [344, 10]]);
  const GRASS = { x: 0, y: 8, rx: 344, ry: 64 };
  const tufts = (() => { const R = rng(3), out = []; for (let i = 0; i < 26; i++) { const a = R() * TAU, d = Math.sqrt(R()) * 0.9; const x = Math.cos(a) * GRASS.rx * d, y = GRASS.y + Math.sin(a) * GRASS.ry * d; if (Math.abs(x + 100) < 70 && y > 0) continue; out.push([x, y, 0.7 + R() * 0.6]); } return out; })();
  const lip = (() => { const out = []; for (let i = 0; i <= 26; i++) { const a = Math.PI * (i / 26); out.push([Math.cos(a) * GRASS.rx, GRASS.y + Math.sin(a) * GRASS.ry]); } return out; })();
  const roots = [
    { pts: [[30, 8], [72, 46], [96, 78], [102, 130], [88, 186]], w: 15 },
    { pts: [[58, 4], [140, 34], [204, 62], [218, 108], [204, 150]], w: 12 },
    { pts: [[-74, 2], [-196, 32], [-262, 58], [-282, 100], [-266, 142]], w: 13 },
    { pts: [[-20, 12], [-12, 60], [-30, 84], [-36, 120]], w: 9 },
    { pts: [[96, 74], [128, 92], [150, 130]], w: 6 },
    { pts: [[-262, 58], [-232, 100], [-236, 128]], w: 5 }
  ];
  const PETX = -100, PETY = 46;
  const pebbles = [{ x: -60, y: 430, r: 18 }, { x: 70, y: 400, r: 11 }, { x: -150, y: 340, r: 9 }];

  function drawIsland(t) {
    layer(1);
    const lw = px(3.4);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // pebbles floating under the island
    for (let i = 0; i < pebbles.length; i++) {
      const p = pebbles[i], y = p.y + Math.sin(t * 0.9 + i * 2) * 8;
      ctx.beginPath(); ctx.ellipse(p.x, y, p.r * 1.2, p.r, 0.3, 0, TAU);
      ctx.fillStyle = g(120); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.8; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(p.x - p.r * 0.3, y - p.r * 0.3, p.r * 0.5, p.r * 0.35, 0.3, 0, TAU); ctx.fillStyle = g(170); ctx.fill();
    }
    // rock underside
    ctx.fillStyle = g(128); ctx.fill(islandRock);
    ctx.save(); ctx.clip(islandRock);
    ctx.fillStyle = g(176); ctx.fill(rockLight);
    ctx.fillStyle = g(86); ctx.fill(rockDark);
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.5;
    for (const [x0, y0, x1, y1, cx, cy] of [[-260, 110, -80, 140, -170, 150], [-120, 210, 30, 230, -40, 240], [60, 150, 230, 120, 150, 150], [-30, 300, 40, 290, 10, 310]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(islandRock);
    // grass lip (scalloped edge hanging over the rock)
    const lipP = new Path2D();
    for (let i = 0; i < lip.length; i++) { const [x, y] = lip[i]; lipP.moveTo(x + 22, y + 6); lipP.arc(x, y + 6, 22 + (i % 3) * 3, 0, TAU); }
    ctx.fillStyle = INK; ctx.save(); ctx.translate(0, 0); ctx.fill(lipP); ctx.restore();
    ctx.lineWidth = lw * 2; ctx.strokeStyle = INK; ctx.stroke(lipP);
    ctx.fillStyle = g(150); ctx.fill(lipP);
    // grass top
    ctx.beginPath(); ctx.ellipse(GRASS.x, GRASS.y, GRASS.rx, GRASS.ry, 0, 0, TAU);
    ctx.fillStyle = g(214); ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.ellipse(GRASS.x, GRASS.y, GRASS.rx, GRASS.ry, 0, 0, TAU); ctx.clip();
    ctx.beginPath(); ctx.ellipse(GRASS.x - 60, GRASS.y - 26, GRASS.rx * 0.82, GRASS.ry * 0.62, 0, 0, TAU); ctx.fillStyle = g(234); ctx.fill();
    // the canopy's shadow on the grass
    ctx.beginPath(); ctx.ellipse(40 + Math.sin(t * 0.5) * 4, 6, 250, 40, 0, 0, TAU); ctx.fillStyle = g(178); ctx.fill();
    ctx.restore();
    // grass tufts
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.55;
    for (const [x, y, s] of tufts) { ctx.beginPath(); ctx.moveTo(x - 7 * s, y); ctx.lineTo(x - 3 * s, y - 9 * s); ctx.moveTo(x, y); ctx.lineTo(x + 1 * s, y - 12 * s); ctx.moveTo(x + 6 * s, y); ctx.lineTo(x + 5 * s, y - 8 * s); ctx.stroke(); }
    // trunk
    ctx.fillStyle = g(176); ctx.fill(trunkPath);
    ctx.save(); ctx.clip(trunkPath); ctx.fillStyle = g(112); ctx.fill(trunkShade);
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.5;
    for (const [x0, y0, x1, y1] of [[-14, -60, -8, -150], [12, -100, 18, -200], [-20, -200, -10, -260], [-50, 0, -30, -40]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + 8, (y0 + y1) / 2, x1, y1); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(trunkPath);
    // hollow in the trunk
    ctx.beginPath(); ctx.ellipse(10, -132, 9, 15, 0, 0, TAU); ctx.fillStyle = INK; ctx.fill();
    // roots spilling over the edge: tapered, wobbling a little at the tips
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      const pts = r.pts.map(([x, y], k) => [x + (k > 2 ? Math.sin(t * 0.8 + i) * 3 * (k - 2) : 0), y]);
      const { shape, mid } = taper(pts, r.w * 1.5, 2.5);
      ctx.fillStyle = g(150); ctx.fill(shape);
      ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.9; ctx.stroke(shape);
      ctx.strokeStyle = g(205); ctx.lineWidth = r.w * 0.28; ctx.stroke(mid);
    }
    // a little stack of books and a pencil beside Bloop
    drawBooks(-222, 52, lw);
  }
  function drawBooks(x, y, lw) {
    ctx.save(); ctx.translate(x, y);
    const book = (bx, by, w, h, rot, fill) => {
      ctx.save(); ctx.translate(bx, by); ctx.rotate(rot);
      ctx.beginPath(); ctx.roundRect(-w / 2, -h, w, h, 4); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke();
      ctx.beginPath(); ctx.rect(-w / 2 + 6, -h + 4, w - 12, h - 8); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = lw * 0.5; ctx.stroke();
      ctx.beginPath(); for (let k = 1; k < 3; k++) { ctx.moveTo(-w / 2 + 8, -h + 4 + k * (h - 8) / 3); ctx.lineTo(w / 2 - 8, -h + 4 + k * (h - 8) / 3); } ctx.stroke();
      ctx.restore();
    };
    ctx.beginPath(); ctx.ellipse(0, 2, 52, 9, 0, 0, TAU); ctx.fillStyle = g(170); ctx.fill();
    book(0, 0, 86, 20, 0, g(90));
    book(4, -20, 74, 18, -0.05, g(200));
    book(-2, -38, 64, 16, 0.04, g(120));
    // pencil
    ctx.save(); ctx.translate(30, -54); ctx.rotate(-0.5);
    ctx.beginPath(); ctx.rect(0, -5, 52, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52, -5); ctx.lineTo(66, 0); ctx.lineTo(52, 5); ctx.closePath(); ctx.fillStyle = g(200); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(62, -1.6); ctx.lineTo(66, 0); ctx.lineTo(62, 1.6); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.rect(-8, -5, 8, 10); ctx.fillStyle = g(120); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  function drawCanopy(t) {
    layer(1);
    ctx.save(); ctx.translate(CAN.x, CAN.y);
    puff(canopy, {
      ink: INK, shade: g(150), mid: g(206), light: '#fff', lw: px(4.2), sway: reduced() ? 0 : 7, t, boil: true, seed: 0, creases: true,
      after: () => {
        // little blossoms dotted over the canopy
        for (const b of blossoms) {
          const s = Math.sin(t * 1.05 + b.l.ph) * 7 * b.l.w;
          const x = b.l.x + s + b.x, y = b.l.y + s * 0.25 + b.y;
          ctx.save(); ctx.translate(x, y); ctx.rotate(b.rot);
          ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = px(1.3);
          ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; ctx.moveTo(Math.cos(a) * b.r + b.r * 0.55, Math.sin(a) * b.r); ctx.arc(Math.cos(a) * b.r, Math.sin(a) * b.r, b.r * 0.55, 0, TAU); }
          ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, b.r * 0.35, 0, TAU); ctx.fillStyle = INK; ctx.fill();
          ctx.restore();
        }
      }
    });
    ctx.restore();
  }

  /* ---------- far islands, clouds, sky ---------- */
  const farIslands = [
    { x: -980, y: -420, s: .62, d: .42 }, { x: 900, y: -200, s: .7, d: .5 }, { x: -640, y: 360, s: .42, d: .36 },
    { x: 560, y: -760, s: .38, d: .3 }, { x: 1500, y: 300, s: .55, d: .55 }, { x: -1600, y: 120, s: .6, d: .5 }, { x: 100, y: 820, s: .45, d: .4 }
  ].map((f, i) => {
    const R = rng(40 + i);
    const tree = []; for (let k = 0; k < 6; k++) tree.push({ x: (R() - .5) * 120, y: -R() * 70, r: 40 + R() * 20, ph: R() * 6, w: 1 });
    return { ...f, i, tree, flip: R() > .5 ? 1 : -1 };
  });
  function haze(v, d) { return lerp(skyBot, v, clamp(0.25 + d * 1.2)); }
  let skyTop = 250, skyBot = 222;
  function drawFarIsland(f, t) {
    layer(f.d);
    const y = f.y + Math.sin(t * 0.45 + f.i) * 10;
    ctx.save(); ctx.translate(f.x, y); ctx.scale(f.s * f.flip, f.s);
    const inkT = g(haze(17, f.d * 0.8)), lw = px(3.2) / f.s;
    const rock = spline(new Path2D(), [[-190, 0], [-160, 50], [-90, 90], [-40, 190], [10, 120], [80, 80], [160, 40], [190, 0]]);
    ctx.fillStyle = g(haze(128, f.d)); ctx.fill(rock);
    ctx.save(); ctx.clip(rock); ctx.fillStyle = g(haze(90, f.d)); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(200, 0); ctx.lineTo(0, 200); ctx.fill(); ctx.restore();
    ctx.strokeStyle = inkT; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(rock);
    ctx.beginPath(); ctx.ellipse(0, 0, 196, 32, 0, 0, TAU); ctx.fillStyle = g(haze(214, f.d)); ctx.fill(); ctx.stroke();
    ctx.fillStyle = g(haze(150, f.d)); ctx.fillRect(-6, -80, 12, 80); ctx.strokeRect(-6, -80, 12, 80);
    ctx.translate(0, -110);
    puff(f.tree, { ink: inkT, shade: g(haze(160, f.d)), mid: g(haze(214, f.d)), light: g(haze(255, f.d)), lw, sway: reduced() ? 0 : 3, t, boil: false });
    ctx.restore();
  }
  const clouds = (() => {
    const R = rng(77), out = [];
    for (let i = 0; i < 16; i++) {
      const d = i < 6 ? 0.12 + R() * 0.12 : i < 13 ? 0.35 + R() * 0.35 : 1.25 + R() * 0.25;
      const w = 160 + R() * 180, lobes = [], n = 5 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) { const u = k / (n - 1) - 0.5; lobes.push({ x: u * w, y: -(1 - Math.abs(u) * 1.6) * w * 0.2 - R() * w * 0.06, r: w * (0.15 + R() * 0.08), ph: R() * 6, w: 1 }); }
      lobes.push({ x: -w * 0.22, y: w * 0.04, r: w * 0.16, ph: 0, w: 1 }, { x: w * 0.22, y: w * 0.05, r: w * 0.15, ph: 1, w: 1 });
      out.push({ x: (R() - 0.5) * 4200, y: d > 1.2 ? 380 + R() * 260 : -1500 + R() * 1900, d, lobes, v: 6 + R() * 10, s: d > 1.2 ? 1.1 : 0.7 + R() * 0.5, seed: i * 50 });
    }
    return out.sort((a, b) => a.d - b.d);
  })();
  function drawCloud(c, t, dt) {
    if (!reduced()) c.x += c.v * dt;
    const bd = bounds(c.d, 500), span = bd.r - bd.l;
    if (c.x > bd.r) c.x -= span; else if (c.x < bd.l) c.x += span;
    layer(c.d);
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.s, c.s);
    const inkV = haze(17, c.d * 0.9);
    puff(c.lobes, { ink: g(inkV), shade: g(haze(200, c.d)), mid: g(haze(232, c.d)), light: '#fff', lw: px(3) / c.s, boil: c.d > 0.5, seed: c.seed });
    ctx.restore();
  }

  let dots = null;
  function dotPattern() {
    const c = document.createElement('canvas'); c.width = c.height = 10;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.beginPath(); x.arc(5, 5, 1.6, 0, TAU); x.fill();
    return ctx.createPattern(c, 'repeat');
  }
  let stars = [];
  function makeStars() { const R = rng(9); stars = []; for (let i = 0; i < 110; i++) stars.push({ x: R() * W, y: R() * H, r: R() < 0.12 ? 5 + R() * 4 : 0.8 + R() * 1.4, ph: R() * 6 }); }
  function drawSky(t) {
    const night = clamp(cam.night);
    skyTop = lerp(249, 30, night); skyBot = lerp(224, 64, night);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, g(skyTop)); gr.addColorStop(1, g(skyBot));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    // manga screentone haze near the horizon
    if (!dots) dots = dotPattern();
    ctx.save(); ctx.globalAlpha = 0.1 * (1 - night) + 0.08 * night;
    if (night > 0.5) ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = night > 0.5 ? (dots.w || (dots.w = (() => { const c = document.createElement('canvas'); c.width = c.height = 10; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(5, 5, 1.2, 0, TAU); x.fill(); return ctx.createPattern(c, 'repeat'); })())) : dots;
    const gy = H * 0.55; const grd = ctx.createLinearGradient(0, gy, 0, H);
    ctx.fillRect(0, gy, W, H - gy);
    ctx.restore();
    // stars at night
    if (night > 0.02) {
      ctx.save(); ctx.globalAlpha = night;
      for (const s of stars) {
        const tw = 0.6 + 0.4 * Math.sin(t * 2 + s.ph * 3);
        const x = s.x + ptr.x * 6, y = s.y + ptr.y * 4;
        if (s.r > 3) star4(x, y, s.r * tw, '#fff', null);
        else { ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * tw})`; ctx.fillRect(x, y, s.r, s.r); }
      }
      ctx.restore();
    }
    // sun by day, moon by night (far layer)
    layer(0.05);
    const sx = -900, sy = -620;
    ctx.save();
    ctx.globalAlpha = 1 - night;
    for (let k = 3; k >= 1; k--) { ctx.beginPath(); ctx.arc(sx, sy, 90 + k * 34, 0, TAU); ctx.strokeStyle = g(212 + k * 8); ctx.lineWidth = px(2); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(sx, sy, 90, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = g(180); ctx.lineWidth = px(2.5); ctx.stroke();
    ctx.globalAlpha = night;
    ctx.beginPath(); ctx.arc(sx, sy, 80, 0, TAU); ctx.fillStyle = '#f4f4f4'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px(3); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + 28, sy - 16, 80, 0, TAU); ctx.fillStyle = g(skyTop + 4); ctx.fill();
    ctx.restore();
  }

  /* ---------- birds ---------- */
  const birds = [];
  let birdTimer = 2;
  function spawnFlock() {
    const d = 0.5 + Math.random() * 0.35, bd = bounds(d, 60), dir = Math.random() > 0.35 ? 1 : -1;
    const y = lerp(bd.t + 220, bd.t + (bd.b - bd.t) * 0.3, Math.random());
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) birds.push({ d, dir, x: (dir > 0 ? bd.l : bd.r) - dir * i * 70, y: y + i * 28 * (i % 2 ? 1 : -0.6), v: 150 + Math.random() * 40, ph: Math.random() * 6, s: 1 + d * 0.3 });
  }
  function drawBirds(t, dt, front) {
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      if ((b.d > 0.9) !== front) continue;
      if (!reduced()) { b.x += b.v * b.dir * dt; b.y += Math.sin(t * 2 + b.ph) * 12 * dt; }
      const bd = bounds(b.d, 300);
      if (b.x > bd.r || b.x < bd.l) { birds.splice(i, 1); continue; }
      layer(b.d);
      const flap = reduced() ? 0.4 : Math.sin(t * 13 + b.ph);
      const ink = g(haze(17, b.d)), lw = px(2.4);
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.s * b.dir, b.s);
      const wing = (back) => {
        ctx.beginPath(); ctx.moveTo(-4, -2);
        ctx.quadraticCurveTo(-10, -12 - flap * 12, back ? -14 : -18, -6 - flap * 22);
        ctx.quadraticCurveTo(-4, -6 - flap * 6, 6, -2); ctx.closePath();
        ctx.fillStyle = back ? g(170) : '#fff'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
      };
      ctx.save(); ctx.translate(4, -1); wing(true); ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 7.5, -0.1, 0, TAU); ctx.moveTo(-10, -1); ctx.lineTo(-20, -5); ctx.lineTo(-18, 3); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.stroke();
      ctx.beginPath(); ctx.arc(12, -5, 6, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(17, -6); ctx.lineTo(23, -4); ctx.lineTo(17, -2); ctx.fillStyle = g(120); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(13.5, -6.5, 1.4, 0, TAU); ctx.fillStyle = ink; ctx.fill();
      wing(false);
      ctx.restore();
    }
  }

  /* ---------- petals (screen space, each at its own depth) ---------- */
  let petals = [];
  function makePetals() {
    const n = Math.round(clamp((W * H) / 13000, 40, 120)), R = Math.random;
    petals = [];
    for (let i = 0; i < n; i++) petals.push({ x: R() * W, y: R() * H, z: 0.3 + Math.pow(R(), 1.6) * 1.5, rot: R() * TAU, spin: (R() - 0.5) * 3, ph: R() * TAU, fl: 1.5 + R() * 2 });
  }
  let prevCam = null;
  function petalStep(dt, t) {
    if (!prevCam) prevCam = { ...cam };
    for (const p of petals) {
      const a = params(p.z, prevCam), b = params(p.z);
      const wx = (p.x - a.ox) / a.S, wy = (p.y - a.oy) / a.S;
      p.x = b.ox + wx * b.S; p.y = b.oy + wy * b.S;
      if (!reduced()) {
        p.y += (16 + 26 * p.z) * dt;
        p.x += (10 + 12 * p.z + Math.sin(t * 1.3 + p.ph) * 22) * dt;
        p.rot += p.spin * dt;
      }
      const m = 40;
      if (p.y > H + m) { p.y = -m; p.x = Math.random() * W * 1.1 - W * 0.1; }
      if (p.y < -m * 2) p.y = H + m;
      if (p.x > W + m) p.x -= W + m * 2; else if (p.x < -m) p.x += W + m * 2;
    }
    prevCam = { ...cam };
  }
  function drawPetals(t, front) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const p of petals) {
      if ((p.z >= 0.95) !== front) continue;
      const s = (4 + p.z * 5) * Math.sqrt(Math.max(.5, unit * Math.pow(cam.z, .5)));
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(1, reduced() ? 0.7 : Math.cos(t * p.fl + p.ph));
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.95, -s * 0.15, 0, s); ctx.quadraticCurveTo(-s * 0.95, -s * 0.15, 0, -s);
      ctx.fillStyle = p.z < 0.6 ? g(haze(255, p.z)) : '#fff'; ctx.fill();
      ctx.strokeStyle = g(haze(17, p.z)); ctx.lineWidth = 0.9 + p.z * 0.7; ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- Bloop ---------- */
  const MOODS = ['idle', 'blink', 'happy', 'worried', 'sad', 'sleeping', 'celebrate', 'wave'];
  const sprites = {};
  const PAD = 14, SPX = 640;
  function loadSprites() {
    return Promise.all(MOODS.map((m) => new Promise((res) => {
      const img = new Image();
      img.onload = () => { sprites[m] = img; res(); };
      img.onerror = () => res();
      img.src = PET.url(m, { pad: PAD, halo: 2.2, px: SPX });
    })));
  }
  const pet = { mood: 'sleeping', shown: 'sleeping', sq: 0, sqv: 0, hy: 0, hv: 0, blinkAt: 2, override: null, overrideUntil: 0, bubble: null, bubbleAt: 0, clickBubble: null, clickUntil: 0, box: null };
  const WAKE = ['huh? oh, hi!', 'five more minutes…', 'mm? is it study time?'];
  const LINES = ['woohoo, focus mode on!', "there you are! let's keep going ✨", 'I believe in you! back to work? 📚', "future you will say thanks. let's go!", 'boop!'];
  let lineIx = 0;
  const confetti = [];
  const sparkles = [];

  function petStep(t, dt) {
    const st = B.state();
    let mood = st.mood;
    if (pet.override && t < pet.overrideUntil) mood = pet.override; else pet.override = null;
    if (mood !== pet.mood) {
      pet.mood = mood; pet.sqv -= 2.6;
      if (mood === 'celebrate') burst();
    }
    // springy squash and hop
    if (!reduced()) {
      const acc = -340 * pet.sq - 13 * pet.sqv;
      pet.sqv += acc * dt; pet.sq += pet.sqv * dt;
      pet.hv += 1700 * dt; pet.hy += pet.hv * dt;
      if (pet.hy > 0) { if (pet.hv > 200) pet.sqv -= pet.hv / 260; pet.hy = 0; pet.hv = 0; }
    } else { pet.sq = 0; pet.hy = 0; }
    // celebrate: little hops
    if (mood === 'celebrate' && pet.hy === 0 && !reduced()) pet.hv = -520;
    // blink while idle
    let shown = mood;
    if (mood === 'idle' && !reduced()) { if (t > pet.blinkAt + 0.13) pet.blinkAt = t + 2 + Math.random() * 3; else if (t > pet.blinkAt) shown = 'blink'; }
    pet.shown = shown;
  }
  function drawPet(t) {
    layer(1);
    const m = pet.mood;
    const sleeping = m === 'sleeping';
    const breath = reduced() ? 0 : sleeping ? Math.sin(t * 1.6) * 0.035 : Math.sin(t * 2.6) * 0.016;
    const sy = 1 + breath - pet.sq * 0.9, sx = 1 - breath * 0.8 + pet.sq * 0.7;
    let lean = sleeping ? 0.11 : 0, dx = 0;
    if (m === 'wave' && !reduced()) lean = Math.sin(t * 5) * 0.07;
    if (m === 'worried' && !reduced()) dx = Math.sin(t * 38) * 0.9;
    if (m === 'idle' && !reduced()) lean = Math.sin(t * 1.3) * 0.03;
    // ground shadow
    const lift = clamp(-pet.hy / 120);
    ctx.beginPath(); ctx.ellipse(PETX + 4, PETY + 2, 40 * (1 - lift * 0.4), 7 * (1 - lift * 0.4), 0, 0, TAU); ctx.fillStyle = g(150); ctx.fill();
    ctx.save();
    ctx.translate(PETX + dx, PETY + pet.hy);
    ctx.rotate(lean);
    ctx.scale(sx, sy);
    const img = sprites[pet.shown] || sprites[m];
    if (img) ctx.drawImage(img, -(60 + PAD), -(109 + PAD), 120 + PAD * 2, 120 + PAD * 2);
    ctx.restore();
    const a = toScreen(PETX - 52, PETY - 112 + pet.hy, 1), b = toScreen(PETX + 52, PETY + 4, 1);
    pet.box = [a[0], a[1], b[0], b[1]];
    // zzz
    if (sleeping) {
      ctx.font = `600 22px Geist, system-ui, sans-serif`;
      ctx.lineJoin = 'round';
      for (let k = 0; k < 3; k++) {
        const ph = reduced() ? 0.3 + k * 0.25 : (t * 0.42 + k / 3) % 1;
        const x = PETX + 34 + ph * 46 + Math.sin(ph * 7) * 6, y = PETY - 112 - ph * 90;
        const sz = 0.7 + ph * 0.9;
        ctx.save(); ctx.translate(x, y); ctx.scale(sz, sz); ctx.rotate(-0.15);
        ctx.globalAlpha = Math.sin(ph * Math.PI);
        ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.strokeText('z', 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillText('z', 0, 0);
        ctx.restore();
      }
    }
  }
  function burst() {
    for (let i = 0; i < 28; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 260 + Math.random() * 420;
      confetti.push({ x: PETX, y: PETY - 80, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, kind: i % 3, ink: i % 2 === 0, life: 0 });
    }
  }
  function drawConfetti(dt) {
    if (!confetti.length) return;
    layer(1);
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.life += dt; c.vy += 900 * dt; c.vx *= 1 - dt * 1.2; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
      if (c.life > 2.2) { confetti.splice(i, 1); continue; }
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.globalAlpha = clamp(2.2 - c.life);
      ctx.fillStyle = c.ink ? INK : '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = px(1.6);
      if (c.kind === 0) { ctx.beginPath(); ctx.rect(-6, -3.5, 12, 7); ctx.fill(); ctx.stroke(); }
      else if (c.kind === 1) { ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fill(); ctx.stroke(); }
      else star4(0, 0, 9, c.ink ? INK : '#fff', INK, px(1.4));
      ctx.restore();
    }
  }
  let sparkTimer = 0;
  function drawSparkles(t, dt) {
    sparkTimer -= dt;
    if (sparkTimer < 0 && !reduced()) {
      sparkTimer = 0.35 + Math.random() * 0.5;
      const l = canopy[(Math.random() * canopy.length) | 0];
      sparkles.push({ x: CAN.x + l.x + (Math.random() - 0.5) * l.r * 1.4, y: CAN.y + l.y - l.r * 0.6 * Math.random(), r: 10 + Math.random() * 10, life: 0, d: 0.9 });
      if (pet.mood === 'happy' || pet.mood === 'celebrate') sparkles.push({ x: PETX + (Math.random() - 0.5) * 150, y: PETY - 60 - Math.random() * 90, r: 8 + Math.random() * 8, life: 0, d: 0.7 });
    }
    layer(1);
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i]; s.life += dt / s.d;
      if (s.life >= 1) { sparkles.splice(i, 1); continue; }
      const k = Math.sin(s.life * Math.PI);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.life * 1.5);
      star4(0, 0, s.r * k, '#fff', INK, px(2));
      ctx.restore();
    }
  }

  /* ---------- speech bubble (screen space, pops in with a bouncy ease) ---------- */
  function drawBubble(t) {
    const st = B.state();
    let text = st.bubble;
    if (pet.clickBubble && t < pet.clickUntil) text = pet.clickBubble;
    if (text !== pet.bubble) { pet.bubble = text; pet.bubbleAt = t; }
    if (!text || !pet.box) return;
    const [x0, y0, x1] = pet.box;
    const petW = x1 - x0;
    if (petW < 40) return;
    const fs = clamp(petW * 0.11, 15, 21);
    const pop = reduced() ? 1 : easeBack(clamp((t - pet.bubbleAt) / 0.38));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.font = `600 ${fs}px Geist, system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const padX = fs * 0.9, h = fs * 2.5, w = tw + padX * 2;
    let ax = x0 + petW * 0.72, ay = y0 + petW * 0.1;
    let bx = Math.min(ax - w * 0.25, W - w - 16), by = ay - h - fs * 1.4;
    bx = Math.max(16, bx);
    ctx.save();
    ctx.translate(ax, ay); ctx.scale(pop, pop); ctx.translate(-ax, -ay);
    ctx.rotate(Math.sin(t * 2) * 0.01);
    const shape = new Path2D();
    shape.roundRect(bx, by, w, h, h / 2);
    const tx = clamp(ax, bx + h * 0.6, bx + w - h * 0.6);
    const tail = new Path2D();
    tail.moveTo(tx - fs * 0.7, by + h - 2); tail.lineTo(ax - fs * 0.1, ay); tail.lineTo(tx + fs * 0.5, by + h - 2); tail.closePath();
    ctx.fillStyle = INK;
    ctx.save(); ctx.translate(4, 4); ctx.fill(shape); ctx.fill(tail); ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke(shape); ctx.stroke(tail);
    ctx.fillStyle = '#fff'; ctx.fill(shape); ctx.fill(tail);
    ctx.fillStyle = INK; ctx.textBaseline = 'middle';
    if ('filter' in ctx) ctx.filter = 'grayscale(1)';
    ctx.fillText(text, bx + padX, by + h / 2 + 1);
    ctx.filter = 'none';
    ctx.restore();
  }

  /* ---------- deadline papers that float by in the plan scene ---------- */
  let papers = null;
  function makePapers() {
    const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.scale(2, 2); draw(x, w, h); return { c, w, h }; };
    const card = (x, w, h, r = 16) => {
      x.fillStyle = '#8a8a8a'; x.beginPath(); x.roundRect(9, 9, w - 12, h - 12, r); x.fill();
      x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 3; x.beginPath(); x.roundRect(3, 3, w - 12, h - 12, r); x.fill(); x.stroke();
    };
    const mono = (s) => `500 ${s}px "Geist Mono", ui-monospace, monospace`;
    const sans = (s, wgt = 500) => `${wgt} ${s}px Geist, system-ui, sans-serif`;
    const serif = (s, it) => `${it ? 'italic ' : ''}400 ${s}px "Instrument Serif", Georgia, serif`;
    const deadline = mk(270, 168, (x, w, h) => {
      card(x, w, h);
      x.save(); x.beginPath(); x.roundRect(3, 3, w - 12, 40, [16, 16, 0, 0]); x.fillStyle = INK; x.fill(); x.restore();
      x.fillStyle = '#fff'; x.font = mono(11); x.fillText('BRIGHTSPACE · DUE NEXT', 20, 28);
      x.fillStyle = INK; x.font = serif(38); x.fillText('Fri, 11:59 pm', 20, 88);
      x.font = sans(15); x.fillStyle = '#4d4d4d'; x.fillText('Lab report 3 · example', 20, 116);
      x.strokeStyle = INK; x.lineWidth = 2.5; x.beginPath(); x.moveTo(20, 132); x.quadraticCurveTo(80, 126, 150, 132); x.stroke();
      // paperclip
      x.lineWidth = 3; x.beginPath(); x.moveTo(w - 46, -6); x.lineTo(w - 46, 34); x.arc(w - 38, 34, 8, Math.PI, 0, true); x.lineTo(w - 30, 0); x.arc(w - 36, 0, 6, 0, Math.PI, true); x.lineTo(w - 42, 28); x.stroke();
    });
    const cal = mk(232, 214, (x, w, h) => {
      card(x, w, h, 14);
      x.fillStyle = INK; x.font = mono(11); x.fillText('NOVEMBER', 18, 40);
      for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(30 + i * 34, 6, 6, 0, TAU); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = INK; x.stroke(); }
      x.font = sans(12); x.fillStyle = '#4d4d4d';
      let n = 1;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) { if (n > 30) break; if (r === 0 && c < 5) continue; const cx = 22 + c * 28, cy = 70 + r * 26; x.fillText(String(n), cx - (n > 9 ? 6 : 3), cy); if (n === 14) { x.save(); x.strokeStyle = INK; x.lineWidth = 2.6; x.beginPath(); x.ellipse(cx, cy - 4, 13, 11, -0.2, 0.2, TAU + 0.6); x.stroke(); x.fillStyle = INK; x.font = '700 22px Geist, sans-serif'; x.fillText('!', cx + 13, cy - 12); x.restore(); } n++; }
    });
    const plan = mk(262, 182, (x, w, h) => {
      card(x, w, h);
      x.fillStyle = INK; x.font = serif(30, true); x.fillText('this week', 20, 46);
      x.font = mono(10); x.fillStyle = '#4d4d4d'; x.fillText('STUDY PLAN · EXAMPLE', 132, 44);
      const rows = [['Mon', 'Read chapter 4', true], ['Wed', 'Lab report draft', false], ['Thu', 'Practice set', false]];
      rows.forEach(([d, s, done], i) => {
        const y = 82 + i * 30;
        x.strokeStyle = INK; x.lineWidth = 2.2; x.fillStyle = '#fff'; x.beginPath(); x.roundRect(20, y - 13, 16, 16, 4); x.fill(); x.stroke();
        if (done) { x.beginPath(); x.moveTo(23, y - 5); x.lineTo(27, y - 1); x.lineTo(34, y - 10); x.stroke(); }
        x.fillStyle = INK; x.font = mono(11); x.fillText(d.toUpperCase(), 46, y);
        x.font = sans(14); x.fillText(s, 86, y);
        if (done) { x.beginPath(); x.moveTo(84, y - 5); x.lineTo(86 + x.measureText(s).width, y - 5); x.lineWidth = 1.6; x.stroke(); }
      });
    });
    papers = [
      { p: deadline, x: .12, y: .2, r: -0.1, sp: 1.15 },
      { p: cal, x: .44, y: .14, r: 0.12, sp: 0.9 },
      { p: plan, x: .3, y: .62, r: -0.05, sp: 1.3 }
    ];
  }
  function drawPapers(t) {
    if (!papers) return;
    const pt = B.state().planT;
    if (Math.abs(pt) >= 0.999) return;
    const mob = W < 861;
    const k = clamp(W / 1440, 0.62, 1.2) * (mob ? 0.8 : 1);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    papers.forEach((o, i) => {
      const bx = mob ? [0.05, 0.5, 0.2][i] : o.x, by = mob ? [0.08, 0.04, 0.3][i] : o.y;
      const x = W * bx - pt * W * 0.95 * o.sp + Math.sin(t * 0.7 + i) * 10;
      const y = H * by + Math.sin(t * 1.1 + i * 2) * 10 - pt * H * 0.18 * (i % 2 ? -1 : 1);
      const rot = o.r + Math.sin(t * 0.8 + i) * 0.05 + pt * 0.5;
      const flutter = reduced() ? 1 : 1 - Math.abs(Math.sin(t * 1.4 + i)) * 0.07;
      ctx.save(); ctx.translate(x + o.p.w * k / 2, y + o.p.h * k / 2); ctx.rotate(rot); ctx.scale(k * flutter, k);
      ctx.drawImage(o.p.c, -o.p.w / 2, -o.p.h / 2, o.p.w, o.p.h);
      ctx.restore();
    });
  }

  /* ---------- pointer: parallax, hover, click the pet ---------- */
  const inPet = (x, y) => { const b = pet.box; return b && x > b[0] && x < b[2] && y > b[1] && y < b[3]; };
  addEventListener('pointermove', (e) => {
    ptr.tx = (e.clientX / W - 0.5) * 2; ptr.ty = (e.clientY / H - 0.5) * 2;
    document.body.classList.toggle('pet-hover', e.target === cv && inPet(e.clientX, e.clientY));
  }, { passive: true });
  cv.addEventListener('click', (e) => {
    if (!inPet(e.clientX, e.clientY)) return;
    const t = now;
    pet.sqv -= 4.2; pet.hv = -620;
    const sleeping = pet.mood === 'sleeping';
    if (sleeping) { pet.override = 'happy'; pet.overrideUntil = t + 2.8; }
    pet.clickBubble = sleeping ? WAKE[(Math.random() * WAKE.length) | 0] : LINES[lineIx++ % LINES.length];
    pet.clickUntil = t + 2.6;
    for (let i = 0; i < 6; i++) sparkles.push({ x: PETX + (Math.random() - 0.5) * 170, y: PETY - 40 - Math.random() * 110, r: 9 + Math.random() * 9, life: 0, d: 0.6 });
  });

  /* ---------- loop ---------- */
  let now = 0, last = performance.now();
  function frame(ms) {
    const dt = Math.min(0.05, (ms - last) / 1000); last = ms;
    if (!reduced()) now += dt;
    const t = now;
    boil = Math.floor(ms / 125);
    camStep(dt);
    petStep(t, dt);
    if (!reduced()) { birdTimer -= dt; if (birdTimer < 0) { spawnFlock(); birdTimer = 5 + Math.random() * 6; } }

    drawSky(t);
    for (const c of clouds) if (c.d < 0.3) drawCloud(c, t, dt);
    for (const f of farIslands) drawFarIsland(f, t);
    for (const c of clouds) if (c.d >= 0.3 && c.d < 1) drawCloud(c, t, dt);
    drawBirds(t, dt, false);
    petalStep(dt, t);
    drawPetals(t, false);
    drawIsland(t);
    drawPet(t);
    drawCanopy(t);
    drawSparkles(t, dt);
    drawConfetti(dt);
    for (const c of clouds) if (c.d >= 1) drawCloud(c, t, dt);
    drawBirds(t, dt, true);
    drawPetals(t, true);
    drawPapers(t);
    drawBubble(t);
    requestAnimationFrame(frame);
  }

  resize();
  addEventListener('resize', resize);
  const fontsReady = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
  const minWait = new Promise((r) => setTimeout(r, 650));
  Promise.all([loadSprites(), fontsReady.then(() => Promise.all(['400 20px "Instrument Serif"', 'italic 400 20px "Instrument Serif"', '500 12px "Geist Mono"', '600 20px Geist'].map((f) => document.fonts.load(f).catch(() => {})))), minWait])
    .then(() => { makePapers(); document.body.classList.add('ready'); });
  spawnFlock();
  requestAnimationFrame(frame);
})();
