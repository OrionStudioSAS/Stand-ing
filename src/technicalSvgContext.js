import DOMPurify from 'dompurify';

const svgNS = 'http://www.w3.org/2000/svg';

function element(name, attributes = {}) {
  const node = document.createElementNS(svgNS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

// Only the drawing primitives used by the technical plan are recorded. Unlike a
// canvas snapshot, the resulting paths, text and imported SVGs remain vectorial.
export function createTechnicalSvgContext(width, height) {
  const svg = element('svg', { xmlns: svgNS, width, height, viewBox: `0 0 ${width} ${height}` });
  const defs = element('defs');
  svg.append(defs);
  const measure = document.createElement('canvas').getContext('2d');
  let state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: 'normal 16px Arial', textAlign: 'left', textBaseline: 'alphabetic', matrix: new DOMMatrix(), dash: [], clips: [] };
  const stack = [];
  let path = [];
  let serial = 0;
  const transform = () => `matrix(${[state.matrix.a, state.matrix.b, state.matrix.c, state.matrix.d, state.matrix.e, state.matrix.f].join(' ')})`;
  const append = (node) => {
    node.setAttribute('transform', transform());
    let wrapped = node;
    state.clips.forEach((id) => { const group = element('g', { 'clip-path': `url(#${id})` }); group.append(wrapped); wrapped = group; });
    svg.append(wrapped);
  };
  const paint = (node, fill) => {
    node.setAttribute('fill', fill ? state.fillStyle : 'none');
    if (!fill) {
      node.setAttribute('stroke', state.strokeStyle);
      node.setAttribute('stroke-width', state.lineWidth);
      if (state.dash.length) node.setAttribute('stroke-dasharray', state.dash.join(' '));
    }
    append(node);
  };
  const ctx = {
    svg,
    save() { stack.push({ ...state, matrix: DOMMatrix.fromMatrix(state.matrix), clips: [...state.clips], dash: [...state.dash] }); },
    restore() { if (stack.length) state = stack.pop(); },
    scale(x, y) { state.matrix = state.matrix.scale(x, y); },
    translate(x, y) { state.matrix = state.matrix.translate(x, y); },
    rotate(angle) { state.matrix = state.matrix.rotate(angle * 180 / Math.PI); },
    setLineDash(dash) { state.dash = [...dash]; },
    beginPath() { path = []; },
    moveTo(x, y) { path.push(`M ${x} ${y}`); },
    lineTo(x, y) { path.push(`L ${x} ${y}`); },
    rect(x, y, w, h) { path.push(`M ${x} ${y} h ${w} v ${h} h ${-w} Z`); },
    arc(x, y, r, start, end) {
      if (Math.abs(end - start) < Math.PI * 2 - 0.0001) throw new Error('Unsupported technical plan arc');
      path.push(`M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`);
    },
    fill() { paint(element('path', { d: path.join(' ') }), true); },
    stroke() { paint(element('path', { d: path.join(' ') }), false); },
    fillRect(x, y, width, height) { paint(element('rect', { x, y, width, height }), true); },
    strokeRect(x, y, width, height) { paint(element('rect', { x, y, width, height }), false); },
    clip() {
      const id = `clip-${++serial}`;
      const clip = element('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
      clip.append(element('path', { d: path.join(' '), transform: transform() }));
      defs.append(clip);
      state.clips.push(id);
    },
    measureText(text) { measure.font = state.font; return measure.measureText(text); },
    fillText(text, x, y) {
      const [, weight = 'normal', size = '16', family = 'Arial'] = state.font.match(/^(.*?)\s*(\d+(?:\.\d+)?)px\s+(.+)$/) || [];
      const node = element('text', { x, y, fill: state.fillStyle, 'font-size': size, 'font-family': family, 'font-weight': weight.trim() || 'normal', 'text-anchor': state.textAlign === 'center' ? 'middle' : state.textAlign === 'right' ? 'end' : 'start', 'xml:space': 'preserve' });
      node.textContent = String(text);
      append(node);
    },
    drawImage(image, x, y, width, height) {
      if (image.technicalSvg) {
        const copy = image.technicalSvg.cloneNode(true);
        const id = `picto-${++serial}`;
        // Prefix IDs and CSS so separate pictograms cannot overwrite each other.
        const idMap = new Map([...copy.querySelectorAll('[id]')].map((node) => [node.id, `${id}-${node.id}`]));
        if (copy.id) idMap.set(copy.id, `${id}-${copy.id}`);
        [copy, ...copy.querySelectorAll('*')].forEach((node) => {
          [...node.attributes].forEach((attribute) => {
            let value = attribute.value;
            idMap.forEach((replacement, original) => { value = value.replaceAll(`url(#${original})`, `url(#${replacement})`); if (value === `#${original}`) value = `#${replacement}`; });
            if (attribute.name === 'id') value = idMap.get(value) || value;
            node.setAttribute(attribute.name, value);
          });
        });
        copy.querySelectorAll('style').forEach((style) => {
          const css = new CSSStyleSheet();
          css.replaceSync(style.textContent);
          style.textContent = [...css.cssRules].filter((rule) => rule.type === CSSRule.STYLE_RULE).map((rule) => {
            let selector = rule.selectorText;
            idMap.forEach((replacement, original) => { selector = selector.replaceAll(`#${original}`, `#${replacement}`); });
            let declarations = rule.style.cssText;
            idMap.forEach((replacement, original) => { declarations = declarations.replaceAll(`#${original}`, `#${replacement}`); });
            return `${selector.split(',').map((part) => `#${id} ${part.trim()}`).join(',')} { ${declarations} }`;
          }).join('\n');
        });
        copy.setAttribute('x', x); copy.setAttribute('y', y);
        copy.setAttribute('width', width); copy.setAttribute('height', height);
        const group = element('g', { id });
        group.append(copy);
        append(group);
      } else {
        const node = element('image', { x, y, width, height, href: image.technicalDataUrl || image.src, preserveAspectRatio: 'xMidYMid meet' });
        append(node);
      }
    },
  };
  ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline'].forEach((key) => Object.defineProperty(ctx, key, { get: () => state[key], set: (value) => { state[key] = value; } }));
  return ctx;
}

export function sanitizeTechnicalSvg(markup) {
  const clean = DOMPurify.sanitize(markup, { USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM: false });
  const svg = new DOMParser().parseFromString(clean, 'image/svg+xml').documentElement;
  if (svg.localName !== 'svg' || svg.querySelector('parsererror')) throw new Error('Picto SVG invalide');
  const safeCss = (value) => value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, url) => url.trim().startsWith('#') ? `url(${url.trim()})` : 'none');
  [svg, ...svg.querySelectorAll('*')].forEach((node) => {
    [...node.attributes].forEach(({ name, value }) => {
      if ((/(?:^|:)href$/.test(name) && !value.startsWith('#') && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) || /^on/i.test(name) || (/^(?:fill|stroke|filter|mask|clip-path|marker-.*)$/.test(name) && value.includes('\\'))) node.removeAttribute(name);
      else node.setAttribute(name, safeCss(name === 'style' ? node.style.cssText : value));
    });
    if (node.localName === 'style') {
      const css = new CSSStyleSheet();
      css.replaceSync(node.textContent.replace(/@import[^;]*;?/gi, ''));
      node.textContent = [...css.cssRules].filter((rule) => rule.type === CSSRule.STYLE_RULE).map((rule) => `${rule.selectorText} { ${safeCss(rule.style.cssText)} }`).join('\n');
    }
  });
  if (!svg.hasAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  return svg;
}
