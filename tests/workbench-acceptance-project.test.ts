import { describe, expect, it } from 'vitest'
import { acceptanceCapabilities, exportAcceptanceProject, exportBusinessTemplate, projectTar } from '../src/workbench-acceptance-project.js'
import { emptyProject } from '../src/workbench-project.js'
import { compilePlan } from '../src/workbench-plan.js'

const yaml = 'name: First acceptance\nplatform: ios\nappId: com.example.app\n---\n- assertVisible: {text: Ready}\n- done\n'
function unpack(tar: Buffer): Record<string, string> {
  const files: Record<string, string> = {}
  for (let offset = 0; offset < tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512), name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '')
    const size = parseInt(header.toString('ascii', 124, 136), 8)
    expect(header[156]).toBe(48)
    files[name] = tar.toString('utf8', offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}
describe('portable first acceptance', () => {
  it('exports the bundled scoped prepare/verify/cleanup template, never active project modules', async () => {
    const files = unpack(await exportBusinessTemplate())
    expect(files['prepare.mjs']).toContain('registerCleanup')
    expect(files['verify.mjs']).toContain('inconclusive')
    expect(files['cleanup.mjs']).toContain('DELETE')
    expect(JSON.parse(files['mobile-mirror.project.json']!).extensions.seed.cleanup).toBe('cleanup')
    expect(files['.env']).toBeUndefined()
  })
  it('exports a reusable flow and serial suite without inventing a business verifier', async () => {
    const files = unpack(await exportAcceptanceProject(yaml))
    expect(Object.keys(files)).toEqual(['flows/acceptance.yaml', 'mobile-mirror.project.json', 'README.md', '.gitignore'])
    expect(files['flows/acceptance.yaml']).toBe(yaml)
    const config = JSON.parse(files['mobile-mirror.project.json']!)
    expect(config.suites.acceptance.cases[0]).toMatchObject({ flow: 'acceptance', retries: 0 })
    expect((await compilePlan(files['flows/acceptance.yaml']!, emptyProject())).header.verify).toEqual([])
  })
  it('binds public parameters and rejects unresolved project assets', async () => {
    const parameterized = yaml.replace('---', 'params:\n  title: {type: string}\n---').replace('{text: Ready}', '{text: "{{ params.title }}"}')
    await expect(exportAcceptanceProject(parameterized)).rejects.toThrow('requires string')
    const files = unpack(await exportAcceptanceProject(parameterized, { title: 'Ready' }))
    expect(JSON.parse(files['mobile-mirror.project.json']!).suites.acceptance.cases[0].params.title).toBe('Ready')
    await expect(exportAcceptanceProject(yaml.replace('---', 'verify: [{ref: business}]\n---'))).rejects.toThrow('original project')
  })
  it('rejects dangerous archive paths and exposes only public capability fields', () => {
    for (const path of ['/tmp/file', '../file', 'a/../file', 'a//file']) expect(() => projectTar({ [path]: 'x' })).toThrow('path')
    const project = emptyProject()
    project.extensions.verify = { module: '/secret.mjs', source: 'secret code', sha256: 'hash', role: 'verify', input: { type: 'object' }, output: { type: 'object' }, credentials: { token: 'PRIVATE_TOKEN' }, timeoutMs: 1000 }
    const value = JSON.stringify(acceptanceCapabilities(project))
    expect(value).toContain('verify'); expect(value).not.toMatch(/PRIVATE_TOKEN|secret|sha256/)
  })
})
