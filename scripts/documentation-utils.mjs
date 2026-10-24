import path from 'node:path'
import { marked } from 'marked'

export const repositoryUrl = 'https://github.com/qmkCamel/flowassert'

export function documentInfo(source) {
  const links = []
  const anchors = new Set()
  const used = new Set()
  const tokens = marked.lexer(source)
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href)
    if (token.type === 'heading') {
      const text = token.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[`*]/g, '').toLowerCase()
      const base = text.replace(/[^\p{L}\p{N}\p{M}\p{S}_\- ]/gu, '').replace(/ /g, '-')
      let slug = base
      let suffix = 0
      while (used.has(slug)) slug = `${base}-${++suffix}`
      used.add(slug)
      anchors.add(slug)
    }
    if (token.type === 'html') {
      for (const match of token.text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1])
      for (const match of token.text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) links.push(match[1])
    }
  })
  return { links, anchors }
}

export function localTarget(file, href) {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return null
  const [location, fragment = ''] = href.split('#')
  const pathname = decodeURIComponent(location.split('?')[0])
  const target = pathname ? path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname)) : file
  if (pathname.startsWith('/') || target.startsWith('../')) throw new Error(`Link outside repository: ${file}: ${href}`)
  return { target, fragment: decodeURIComponent(fragment) }
}

export function taskCounts(source) {
  const lines = source.split('\n').filter((line) => /^\s*- \[[ xX]\]/.test(line))
  return `${lines.filter((line) => /^\s*- \[[xX]\]/.test(line)).length}/${lines.length}`
}

export function packageLinkErrors(files, documents) {
  const inventory = new Set(files)
  const errors = []
  for (const [file, source] of documents) {
    for (const href of documentInfo(source).links) {
      const link = localTarget(file, href)
      if (!link) continue
      const prefix = link.target.replace(/\/$/, '') + '/'
      if (!inventory.has(link.target) && !files.some((name) => name.startsWith(prefix))) {
        errors.push(`${file}: not packaged: ${href}`)
      } else if (link.fragment && documents.has(link.target) && !documentInfo(documents.get(link.target)).anchors.has(link.fragment)) {
        errors.push(`${file}: missing packaged anchor: ${href}`)
      }
    }
  }
  return errors
}
