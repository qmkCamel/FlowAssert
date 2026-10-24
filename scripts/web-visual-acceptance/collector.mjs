// Audited, read-only collector. No caller/page-supplied JavaScript is accepted.
export const READY = `(() => {
  const image = document.querySelector('#analysis-evidence .report-image-viewport img');
  const step = new URLSearchParams(location.hash.split('?')[1]).get('step');
  const expected = document.documentElement.lang === 'zh-CN' ? '归档步骤 ' + step + ' 截图' : 'Archived step ' + step + ' screenshot';
  return Boolean(image?.complete && image.naturalWidth && image.alt === expected && !document.querySelector('.evidence-pending'));
})()`;
export const COMPARISON_READY = `document.querySelectorAll('.action-image-plane img').length === 2 && [...document.querySelectorAll('.action-image-plane img')].every(i => i.complete && i.naturalWidth)`;
export const ERROR_READY = `Boolean(document.querySelector('.action-comparison button'))`;
export const COLLECT = `(() => {
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const play = document.querySelector('#playback-toggle'), r = play?.getBoundingClientRect();
  const hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const imgs = [...document.querySelectorAll('.action-image-plane img')];
  const circle = document.querySelector('.action-image-plane circle'), plane = circle?.closest('.action-image-plane');
  const cr = circle?.getBoundingClientRect(), pr = plane?.getBoundingClientRect();
  return { url: location.href, origin: location.origin, browser: navigator.userAgent, locale: document.documentElement.lang,
    viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
    playback: {active: play?.getAttribute('aria-pressed') === 'true', status: document.querySelector('#playback-status')?.textContent, speed: document.querySelector('#playback-speed')?.value, selected: new URLSearchParams(location.hash.split('?')[1]).get('step'), loading: Boolean(document.querySelector('.evidence-pending')), nextEnabled: !document.querySelector('#playback-next')?.disabled, focus: document.activeElement?.id, zoom: getComputedStyle(document.documentElement).zoom},
    play: {visible: visible(play), inViewport: Boolean(r && r.top >= 0 && r.bottom <= innerHeight), unobscured: Boolean(hit && (hit === play || play.contains(hit)))},
    result: {alt: document.querySelector('#analysis-evidence .report-image-viewport img')?.alt, visible: visible(document.querySelector('#analysis-evidence .report-image-viewport img'))},
    comparison: {text: document.querySelector('.action-comparison')?.innerText, images: imgs.map(i => ({alt:i.alt, ready:i.complete && i.naturalWidth > 0})), retryVisible: visible(document.querySelector('.action-comparison button')),
      marker: cr && pr ? {x: (cr.x + cr.width / 2 - pr.x) / pr.width, y: (cr.y + cr.height / 2 - pr.y) / pr.height} : null},
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth || Boolean(document.querySelector('#journey')?.getBoundingClientRect().right > innerWidth + 1) };
})()`;
