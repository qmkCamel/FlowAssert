import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createFixture } from '../../tests/visual-acceptance/fixture.ts'
import { Browser, preflight, hash } from './browser.mjs'

// Opt-in real browser contract probe, not part of ordinary unit-test startup.
const root = resolve('artifacts/visual-acceptance', `safety-${randomUUID()}`)
await mkdir(root, { recursive: true })
const environment = await preflight(root), fixture = await createFixture(`${root}/fixture`), results = []
try {
  for (const kind of ['cancel', 'action-budget', 'timeout']) {
    const directory = `${root}/${kind}`; await mkdir(directory)
    const controller = new AbortController()
    const browser = new Browser({ origin: fixture.origin, root: directory, signal: controller.signal, maxActions: kind === 'action-budget' ? 4 : 30 })
    try {
      await browser.open(`${fixture.origin}/#/runs/${fixture.id}?step=1&tab=evidence`)
      const evidence = await browser.capture('retained-before-stop')
      if (kind === 'cancel') controller.abort(new Error('Probe cancellation'))
      let error
      try {
        // A comparison-ready wait without opening the panel must time out.
        if (kind === 'timeout') await browser.wait('comparison')
        else await browser.snapshot()
      } catch (failure) { error = failure.message }
      if (!error) throw new Error(`${kind} did not stop`)
      if (hash(await readFile(`${directory}/${evidence.path}`)) !== evidence.sha256) throw new Error('Prior screenshot changed')
      results.push({ kind, stopped: true, error, evidence, session: browser.session, acceptance: 'incomplete' })
    } finally { await browser.close() }
  }
} finally {
  await fixture.close()
  await writeFile(`${root}/safety.json`, JSON.stringify({ environment, results, noWrites: fixture.requests.every(r => r.method === 'GET') }, null, 2))
  console.log(root)
}
