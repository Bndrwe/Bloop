/* Bloop's pet art, ported 1:1 from the app (src/renderer/src/pet/skins/Blobby.tsx).
   Returns an SVG string per mood. Used for the loader, the nav, and the canvas sprites. */
(function () {
  const INK = '#000', PAPER = '#fff', TONGUE = '#9a9a9a', SHADOW = '#808080', LINE = 3, FINE = 1.8;

  const openEyes = (small) => {
    const rx = small ? 6.8 : 7.6, ry = small ? 8.2 : 9.2;
    return [45, 75].map((cx) =>
      `<ellipse cx="${cx}" cy="68" rx="${rx}" ry="${ry}" fill="${INK}"/>` +
      `<circle cx="${cx + 2.6}" cy="64.2" r="3.1" fill="#fff"/>` +
      `<circle cx="${cx - 2.4}" cy="71.6" r="1.4" fill="#fff" opacity=".9"/>`).join('');
  };
  const happyEyes = `<g fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"><path d="M38 70 Q45 59 52 70"/><path d="M68 70 Q75 59 82 70"/></g>`;
  const closedEyes = `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M38 68 Q45 74 52 68"/><path d="M68 68 Q75 74 82 68"/></g>`;
  const sadEyes = [45, 75].map((cx) => `<ellipse cx="${cx}" cy="70" rx="6.8" ry="7.6" fill="${INK}"/><circle cx="${cx + 1.8}" cy="70.5" r="2.2" fill="#fff"/>`).join('') +
    `<path d="M35 58 L56 58 L56 66 Q46 63.5 35 69.5 Z" fill="${PAPER}"/><path d="M64 58 L85 58 L85 69.5 Q74 63.5 64 66 Z" fill="${PAPER}"/>` +
    `<g fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"><path d="M36 69 Q46 63 55 66"/><path d="M65 66 Q74 63 84 69"/></g>`;
  const brows = `<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><path d="M37 57 Q44 55.5 51 52"/><path d="M69 52 Q76 55.5 83 57"/></g>`;
  const blush = `<g fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round">` +
    [30, 85].map((x) => `<path d="M${x - 2} 83 L${x + 1} 77"/><path d="M${x + 2} 83 L${x + 5} 77"/><path d="M${x + 6} 83 L${x + 9} 77"/>`).join('') + '</g>';

  function mouth(m) {
    switch (m) {
      case 'happy': case 'wave':
        return `<path d="M53 79 Q60 80 67 79 Q66 89 60 89 Q54 89 53 79 Z" fill="${INK}"/><path d="M55.6 85.4 Q60 82.2 64.4 85.4 Q62.6 88.6 60 88.6 Q57.4 88.6 55.6 85.4 Z" fill="${TONGUE}"/>`;
      case 'celebrate':
        return `<path d="M50 78 Q60 80 70 78 Q69 93 60 93 Q51 93 50 78 Z" fill="${INK}"/><path d="M53.5 87.5 Q60 83 66.5 87.5 Q64 92.4 60 92.4 Q56 92.4 53.5 87.5 Z" fill="${TONGUE}"/>`;
      case 'worried':
        return `<path d="M52 84 Q54.7 80.5 57.3 84 Q60 87.5 62.7 84 Q65.3 80.5 68 84" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 'sad':
        return `<path d="M53 87 Q60 80.5 67 87" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
      case 'sleeping':
        return `<ellipse cx="60" cy="84" rx="2.6" ry="3.1" fill="${INK}"/>`;
      default:
        return `<path d="M54 80 Q60 86.5 66 80" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
  }
  function star(x, y, r, fill) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 === 0 ? r : r * 0.45;
      pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke"/>`;
  }

  /**
   * mood: idle | blink | happy | worried | sad | sleeping | celebrate | wave
   * opts.shadow (ground shadow), opts.halo (the app's white sticker cut), opts.zzz, opts.px (intrinsic size),
   * opts.pad (extra viewBox padding in pet units, for sprites)
   */
  function svg(mood, opts = {}) {
    const m = mood === 'blink' ? 'idle' : mood;
    const waving = m === 'wave';
    let eyes;
    if (mood === 'blink' || m === 'sleeping') eyes = closedEyes;
    else if (m === 'happy' || m === 'celebrate') eyes = happyEyes;
    else if (m === 'sad') eyes = sadEyes;
    else eyes = openEyes(m === 'worried');
    const pad = opts.pad || 0;
    const vb = `${-pad} ${-pad} ${120 + pad * 2} ${120 + pad * 2}`;
    const size = opts.px ? ` width="${opts.px}" height="${opts.px}"` : '';
    const halo = opts.halo ? `<defs><filter id="h" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${opts.halo}" result="g"/><feFlood flood-color="#fff" result="p"/><feComposite in="p" in2="g" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` : '';
    const f = opts.halo ? ' filter="url(#h)"' : '';
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${size}>${halo}`;
    if (opts.shadow) s += `<ellipse cx="60" cy="113" rx="30" ry="3.6" fill="${SHADOW}" opacity=".45"/>`;
    s += `<g${f}>`;
    s += `<ellipse cx="45" cy="107" rx="9" ry="5" fill="${PAPER}" stroke="${INK}" stroke-width="${LINE - 0.4}"/>`;
    s += `<ellipse cx="75" cy="107" rx="9" ry="5" fill="${PAPER}" stroke="${INK}" stroke-width="${LINE - 0.4}"/>`;
    s += `<ellipse cx="17.5" cy="82" rx="6.5" ry="9" fill="${PAPER}" stroke="${INK}" stroke-width="${LINE - 0.4}" transform="rotate(20 17.5 82)"/>`;
    s += waving
      ? `<ellipse cx="107" cy="56" rx="7" ry="12" fill="${PAPER}" stroke="${INK}" stroke-width="${LINE - 0.4}" transform="rotate(38 107 56)"/>`
      : `<ellipse cx="102.5" cy="82" rx="6.5" ry="9" fill="${PAPER}" stroke="${INK}" stroke-width="${LINE - 0.4}" transform="rotate(-20 102.5 82)"/>`;
    s += `<path d="M60 30 C89 30 105 52 105 77 C105 99 87 109 60 109 C33 109 15 99 15 77 C15 52 31 30 60 30 Z" fill="${PAPER}" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"/>`;
    s += `<path d="M30 56 Q33 45 42 39" fill="none" stroke="${INK}" stroke-width="${FINE}" stroke-linecap="round"/><path d="M27.5 63 L28.2 60.6" fill="none" stroke="${INK}" stroke-width="${FINE}" stroke-linecap="round"/>`;
    s += `<path d="M60 31 C60 25 61 20 63 16" fill="none" stroke="${INK}" stroke-width="${LINE}" stroke-linecap="round"/>`;
    s += `<path d="M62 18 C55 9 46 10 43 15 C49 22 57 22 62 18 Z" fill="${PAPER}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
    s += `<path d="M63 17 C68 7 79 7 82 12 C77 20 68 21 63 17 Z" fill="${PAPER}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
    s += `<g fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"><path d="M59 17 Q52 15 47 15"/><path d="M66 15 Q72 12 78 12"/></g>`;
    s += blush + eyes + ((m === 'worried' || m === 'sad') ? brows : '') + mouth(m);
    if (m === 'worried') s += `<path d="M93 40 C97 46 98.5 50 93 52.5 C87.5 50 89 46 93 40 Z" fill="${PAPER}" stroke="${INK}" stroke-width="${FINE}" stroke-linejoin="round"/><path d="M91.2 48.6 Q91 46.6 92.2 45.2" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`;
    if (m === 'sad') s += `<path d="M38 77 C41 82 42 85 38 87 C34 85 35 82 38 77 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
    if (m === 'happy') s += star(98, 36, 6, PAPER) + star(20, 50, 4.5, INK);
    s += '</g>';
    if (opts.zzz && m === 'sleeping') {
      s += `<g fill="${PAPER}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" paint-order="stroke" font-family="Geist, system-ui, sans-serif" font-weight="600"><text x="80" y="30" font-size="17">z</text><text x="93" y="14" font-size="12">z</text></g>`;
    }
    return s + '</svg>';
  }

  window.BloopPet = { svg, url: (mood, opts) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(mood, opts)) };

  // Inline pets in the DOM (loader, nav, footer).
  for (const el of document.querySelectorAll('[data-pet]')) el.innerHTML = svg(el.dataset.pet, { zzz: el.dataset.pet === 'sleeping' });
  const ico = document.createElement('link');
  ico.rel = 'icon';
  ico.href = window.BloopPet.url('happy');
  document.head.appendChild(ico);
})();
