/* Scroll choreography: works out which scene is on screen, how far through it you are, and where
   the camera should be. The canvas stage (stage.js) reads Bloop.state() every frame. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  // Camera per scene: tx/ty = world point to frame, fx/fy = where on screen it sits, z = zoom.
  // Mobile frames the subject higher and centred, with the copy underneath.
  const CAM = {
    hero:     { tx: 0,    ty: -130, fx: .66, fy: .53, z: .86, night: 0 },
    how:      { tx: 0,    ty: -60,  fx: .5,  fy: .6,  z: .55, night: 0 },
    score:    { tx: -96,  ty: -46,  fx: .7,  fy: .56, z: 2.55, night: 0 },
    plan:     { tx: -10,  ty: -170, fx: .33, fy: .55, z: .96, night: .08 },
    nudge:    { tx: -96,  ty: -60,  fx: .7,  fy: .58, z: 2.2, night: .15 },
    privacy:  { tx: 0,    ty: -150, fx: .5,  fy: .53, z: .45, night: .35 },
    download: { tx: 0,    ty: -130, fx: .5,  fy: .27, z: .32, night: 1 },
    info:     { tx: 0,    ty: -1500, fx: .5, fy: .5,  z: .36, night: 1 }
  };
  const MOBILE = {
    hero: { fx: .5, fy: .3, z: .5 }, how: { fx: .5, fy: .5, z: .45 }, score: { fx: .5, fy: .28, z: 1.4 },
    plan: { fx: .5, fy: .3, z: .55 }, nudge: { fx: .5, fy: .26, z: 1.2 }, privacy: { fx: .5, fy: .5, z: .4 },
    download: { fx: .5, fy: .22, z: .26 }
  };

  const sections = [...document.querySelectorAll('[data-scene]')];
  const names = sections.map((s) => s.dataset.scene);
  let anchors = [];
  function measure() {
    const vh = innerHeight;
    anchors = sections.map((s, i) => {
      const top = s.offsetTop, h = s.offsetHeight;
      if (i === 0) return 0;
      if (s.classList.contains('pinned')) return top + Math.max(0, h - vh) * 0.5;
      if (s.dataset.scene === 'download') return top + vh * 0.1;
      return top + vh * 0.6;
    });
  }

  function camFor(name) {
    const c = { ...CAM[name] };
    if (innerWidth < 861 && MOBILE[name]) Object.assign(c, MOBILE[name]);
    return c;
  }

  // Progress through each pinned scene, 0..1 while it is pinned.
  function progressOf(s) {
    const r = s.getBoundingClientRect();
    const span = Math.max(1, s.offsetHeight - innerHeight);
    return clamp(-r.top / span);
  }

  let current = 'hero';
  const st = { cam: camFor('hero'), scene: 'hero', p: 0, mood: 'sleeping', bubble: null, planT: -1, chip: -1 };

  function compute() {
    const y = scrollY;
    // camera: blend between neighbouring anchors
    let i = 0;
    while (i < anchors.length - 1 && y > anchors[i + 1]) i++;
    let cam;
    if (i >= anchors.length - 1 || y <= anchors[0]) cam = camFor(names[Math.min(i, names.length - 1)]);
    else {
      const t = smooth(clamp((y - anchors[i]) / (anchors[i + 1] - anchors[i])));
      const a = camFor(names[i]), b = camFor(names[i + 1]);
      cam = {};
      for (const k of Object.keys(a)) cam[k] = k === 'z' ? Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) : lerp(a[k], b[k], t);
    }
    st.cam = cam;

    // which scene holds the middle of the screen
    const mid = innerHeight * 0.5;
    let scene = names[0], el = sections[0];
    for (const s of sections) { const r = s.getBoundingClientRect(); if (r.top <= mid) { scene = s.dataset.scene; el = s; } }
    st.scene = scene;
    st.p = el.classList.contains('pinned') ? progressOf(el) : 0;

    // plan papers fly through around the plan anchor (-1 .. 1)
    const pi = names.indexOf('plan');
    const span = (anchors[pi + 1] - anchors[pi - 1]) / 2;
    st.planT = clamp((y - anchors[pi]) / span, -1, 1);

    // pet mood and speech per scene
    let mood = 'idle', bubble = null;
    const p = st.p;
    switch (scene) {
      case 'hero': mood = 'sleeping'; break;
      case 'how': mood = p < .1 ? 'sleeping' : p < .62 ? 'idle' : 'worried'; break;
      case 'score': mood = p < .38 ? 'happy' : p < .78 ? 'worried' : 'happy'; break;
      case 'plan': mood = 'idle'; break;
      case 'nudge':
        if (p < .58) { mood = 'worried'; bubble = 'psst… is this homework? 👀'; }
        else { mood = 'celebrate'; bubble = "yay, back on track!"; }
        break;
      case 'privacy': mood = 'sleeping'; break;
      case 'download': mood = 'wave'; break;
      default: mood = 'sleeping';
    }
    st.mood = mood;
    st.bubble = bubble;
    if (scene !== current) { current = scene; onScene(scene); }
    syncDom();
  }

  /* ---------- DOM bits that follow the scroll ---------- */
  const chips = [...document.querySelectorAll('.chips li')];
  const timeline = [...document.querySelectorAll('.timeline li')];
  const scoreCard = document.querySelector('.score-card');
  const scoreNum = document.querySelector('.score-num');
  const scoreState = document.querySelector('.score-state');
  const scoreFront = document.querySelector('.score-front b');
  const scoreBar = document.querySelector('.ring .bar');
  const pager = document.querySelector('.pager');
  const capSpan = document.querySelector('.caption span');
  pager.innerHTML = sections.map(() => '<i></i>').join('');
  const dots = [...pager.children];

  function syncDom() {
    const { scene, p } = st;
    chips.forEach((c, i) => c.classList.toggle('on', scene === 'how' && p >= [0, .3, .62][i]));
    const steps = [0, .2, .4];
    timeline.forEach((li, i) => li.classList.toggle('on', scene === 'nudge' && (i === 3 ? p >= .58 : p >= steps[i] && p < .58)));

    // example score: 100, drifts down while a game is open, recovers when you're back
    let sp2 = scene === 'score' ? p : 0;
    let score = 100, state = 'Focused', front = 'a lecture on YouTube', drift = false;
    if (sp2 >= .38 && sp2 < .78) { score = Math.round(100 - 19 * smooth(clamp((sp2 - .38) / .4))); state = 'Drifting'; front = 'a game'; drift = true; }
    else if (sp2 >= .78) { score = Math.round(81 + 7 * smooth(clamp((sp2 - .78) / .22))); state = 'Back on track'; front = 'your notes'; }
    if (scoreNum.textContent !== String(score)) scoreNum.textContent = score;
    scoreState.textContent = state;
    scoreFront.textContent = front;
    scoreCard.classList.toggle('drift', drift);
    scoreBar.style.strokeDashoffset = String(100 - score);

    const idx = names.indexOf(scene);
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    document.body.classList.toggle('on-night', st.cam.night > .55 && scene !== 'info');
    document.body.classList.toggle('on-info', scene === 'info');
    document.body.classList.toggle('scrolled', scrollY > 40);
  }

  let capTimer;
  function onScene(scene) {
    const text = sections[names.indexOf(scene)].dataset.caption || '';
    capSpan.classList.add('swap');
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { capSpan.textContent = text; capSpan.classList.remove('swap'); }, 220);
  }
  capSpan.textContent = sections[0].dataset.caption;

  /* ---------- download button picks your OS ---------- */
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const isMobile = /iPhone|iPad|Android/i.test(ua);
  const os = isMobile ? null : /Mac/i.test(platform) || /Macintosh/.test(ua) ? 'mac' : /Win/i.test(platform) ? 'win' : /Linux/i.test(platform) ? 'linux' : null;
  const primary = document.querySelector('[data-dl="primary"]');
  const hint = document.querySelector('[data-dl="hint"]');
  if (os) {
    const a = document.querySelector(`[data-os="${os}"]`);
    primary.href = a.href;
    primary.textContent = { mac: 'Download for Mac', win: 'Download for Windows', linux: 'Download for Linux' }[os];
    hint.innerHTML = { mac: 'Free and open source. Apple Silicon build. <a href="#download">Intel Mac, Windows or Linux?</a>', win: 'Free and open source. Windows 10 and 11. <a href="#download">Other downloads</a>', linux: 'Free and open source. AppImage for x86_64. <a href="#download">Other downloads</a>' }[os];
    a.closest('.dl').classList.add('suggested');
  } else if (isMobile) hint.textContent = 'Bloop is a desktop app. Open this page on your computer to download it.';

  document.querySelector('.explore').addEventListener('click', () => document.getElementById('how').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth' }));

  measure();
  compute();
  addEventListener('resize', () => { measure(); compute(); });
  addEventListener('load', () => { measure(); compute(); });
  addEventListener('scroll', compute, { passive: true });

  window.Bloop = { state: () => st, reduce };
})();
