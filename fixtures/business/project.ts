import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stringify } from 'yaml'

export async function createFixtureProject(root: string, platform: 'android' | 'ios', base: string, deviceBase: string) {
  for (const address of [base, deviceBase]) {
    const url = new URL(address)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a plain test server origin')
  }
  base = new URL(base).origin; deviceBase = new URL(deviceBase).origin
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const file of ['prepare', 'verify', 'cleanup']) await copyFile(resolve(dirname(fileURLToPath(import.meta.url)), 'extensions', `${file}.mjs`), resolve(root, `${file}.mjs`))
  const str = { type: 'string' }, num = { type: 'number' }
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties) })
  const header = {
    name: 'Real fixture order', platform, appId: 'dev.mobilemirror.fixture',
    params: { expectedAmount: { type: 'number', default: 1200 } },
    prepare: [{ ref: 'seed', as: 'seed', args: { base } }],
    verify: [{ ref: 'verify', args: { base, id: '{{ outputs.seed.id }}', expectedAmount: '{{ params.expectedAmount }}' } }],
  }
  const steps = ['launchApp',
    { type: { into: { accessibilityId: 'fixture.endpoint' }, text: deviceBase } },
    { type: { into: { accessibilityId: 'fixture.id' }, text: '{{ outputs.seed.id }}' } },
    { tap: { accessibilityId: 'fixture.submit' } },
    { assertVisible: { text: 'Order submitted' } },
  ]
  await writeFile(resolve(root, 'order.yaml'), `${stringify(header)}---\n${stringify(steps)}`)
  const project = { flows: { order: 'order.yaml' }, extensions: {
    seed: { module: 'prepare.mjs', role: 'prepare', cleanup: 'cleanup', input: object({ base: str }), output: object({ id: str }) },
    verify: { module: 'verify.mjs', role: 'verify', input: object({ base: str, id: str, expectedAmount: num }), output: object({ verdict: str, expected: str, actual: str, source: str, readAt: str, artifactRefs: { type: 'array', items: str } }) },
    cleanup: { module: 'cleanup.mjs', role: 'cleanup', input: object({ base: str, id: str }), output: object({ deleted: { type: 'boolean' } }) },
  }, suites: {
    positive: { name: 'Real order positive', cases: [{ id: 'order', flow: 'order', tags: ['fixture'] }] },
    negative: { name: 'Wrong business amount (expected failure)', cases: [{ id: 'wrong-amount', flow: 'order', params: { expectedAmount: 999 }, tags: ['fixture'] }] },
  } }
  const path = resolve(root, 'project.json'); await writeFile(path, JSON.stringify(project, null, 2)); return path
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const platform = process.argv[2]
  if (platform !== 'android' && platform !== 'ios') throw new Error('Usage: project.ts android|ios [host origin] [device origin]')
  console.log(await createFixtureProject(resolve('artifacts/fixture', platform, 'project'), platform, process.argv[3] ?? 'http://127.0.0.1:47831', process.argv[4] ?? 'http://127.0.0.1:47831'))
}
