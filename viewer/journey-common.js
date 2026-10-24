const translations = new Map()
export const copy = (zh, en) => { const pair = [zh, en]; translations.set(zh, pair); translations.set(en, pair); return document.documentElement.lang === 'zh-CN' ? zh : en }
new MutationObserver(() => {
  const index = document.documentElement.lang === 'zh-CN' ? 0 : 1
  for (const root of document.querySelectorAll('.journey, .journey-nav, .journey-active, .journey-dialog')) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) { const text = walker.currentNode; if (!text.parentElement?.closest('pre, textarea, input') && translations.has(text.nodeValue)) text.nodeValue = translations.get(text.nodeValue)[index] }
    for (const element of [root, ...root.querySelectorAll('[aria-label], [alt]')]) for (const attribute of ['aria-label', 'alt']) { const pair = translations.get(element.getAttribute(attribute)); if (pair) element.setAttribute(attribute, pair[index]) }
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
export function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el }
export function button(zh, en, action, id) { const el = node('button', copy(zh, en), 'check-button'); el.type = 'button'; if (id) el.id = id; el.onclick = action; return el }
export function field(root, zh, en, id, value = '', tag = 'input') { const label = node('label', copy(zh, en)); label.htmlFor = id; const input = node(tag); input.id = id; input.value = value; root.append(label, input); return input }
export async function api(path, body, signal) {
  const response = await fetch(path, body === undefined ? { signal, cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error ?? data.message ?? `HTTP ${response.status}`), { status: response.status, code: data.code })
  return data
}
export function download(name, data, type) { const url = URL.createObjectURL(new Blob([data], { type })), link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
export function choose(title, choices) {
  return new Promise(resolve => {
    const dialog = node('dialog', undefined, 'journey-dialog'); dialog.append(node('h2', title))
    const finish = result => { dialog.close(); dialog.remove(); resolve(result) }
    for (const [key, zh, en] of choices) dialog.append(button(zh, en, () => finish(key)))
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel') }); document.body.append(dialog); dialog.showModal()
  })
}
