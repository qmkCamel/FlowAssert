import { compilePlan } from './workbench-plan.js'
import { readFile } from 'node:fs/promises'
import { emptyProject, type ProjectSnapshot } from './workbench-project.js'

/** Public authoring metadata only; never include module source, paths or credential mappings. */
export function acceptanceCapabilities(project: ProjectSnapshot) {
  return {
    fixtures: Object.entries(project.extensions).map(([ref, definition]) => ({ ref, role: definition.role,
      input: definition.input, output: definition.output, timeoutMs: definition.timeoutMs,
      ...(definition.cleanup ? { cleanup: definition.cleanup } : {}) })),
    flows: Object.keys(project.flows), lifecycle: 'isolated-per-run' as const,
  }
}

/** Only bundled, reviewed templates; never copies the configured project's executable modules. */
export async function exportBusinessTemplate(): Promise<Buffer> {
  const files: Record<string, string> = {}
  for (const [input, output] of Object.entries({ 'prepare.mjs': 'prepare.mjs', 'verify.mjs': 'verify.mjs', 'cleanup.mjs': 'cleanup.mjs', 'project.json.example': 'mobile-mirror.project.json', 'order.yaml.example': 'order.yaml' })) {
    files[output] = await readFile(new URL(`../examples/business-http/${input}`, import.meta.url), 'utf8')
  }
  files['README.md'] = '# Extracted business fixture template / 业务夹具接入模板\n\nFiles are already renamed: mobile-mirror.project.json and order.yaml. Review all trusted worker modules; configure your authorized test backend and App before running. Set MOBILE_MIRROR_TEST_PROJECT to the absolute path of mobile-mirror.project.json. Do not run against production or put credentials in Git.\n\n准备、验证、清理均逐次运行；套件每个 case/重试独立准备与清理，无共享可变 fixture。下面是仓库原始指南，链接/源码路径需在 FlowAssert 仓库查看。\n\n' + await readFile(new URL('../docs/workbench-business-template.md', import.meta.url), 'utf8')
  files['.gitignore'] = '.env\nartifacts/\nnode_modules/\n'
  return projectTar(files)
}

/** Fixed-name, local download. No project modules or personal configuration are copied. */
export async function exportAcceptanceProject(yaml: string, params: Record<string, unknown> = {}): Promise<Buffer> {
  let plan
  try { plan = await compilePlan(yaml, emptyProject(), params) }
  catch (error) { throw new Error(`Standalone project requires a valid self-contained flow. Registered hooks/subflows/visual/recovery profiles need the original project: ${error instanceof Error ? error.message : String(error)}`) }
  return projectTar({
    'flows/acceptance.yaml': yaml,
    'mobile-mirror.project.json': JSON.stringify({ flows: { acceptance: 'flows/acceptance.yaml' }, suites: {
      acceptance: { name: plan.header.name, cases: [{ id: 'acceptance', flow: 'acceptance', params, retries: 0 }] },
    } }, null, 2),
    'README.md': `# ${plan.header.name.replace(/[\r\n]/g, ' ')}\n\nLocal acceptance project / 本机验收项目\n\n1. Review flows/acceptance.yaml and public parameters before committing. / 提交前审查流程和公开参数。\n2. Install FlowAssert and prepare the ${plan.header.platform} toolchain. Start the Viewer with MOBILE_MIRROR_TEST_PROJECT set to the absolute path of mobile-mirror.project.json.\n3. Connect the intended device, then explicitly run the acceptance suite. The app must already be installed.\n4. Inspect UI, business, visual, cleanup and evidence separately. This project has no independent business verifier.\n\nCLI (attached Viewer): flowassert test suite acceptance --url http://127.0.0.1:<port>\n\n设备准备时间与用例创作时间应分开测量。UI 通过不代表业务持久化已独立验证。\n`,
    '.gitignore': '.env\nartifacts/\nnode_modules/\n',
  })
}

/** Minimal USTAR writer for bounded, fixed relative text files (no links, devices or executable entries). */
export function projectTar(files: Record<string, string>): Buffer {
  if (Object.keys(files).length > 20) throw new Error('Project file budget exceeded')
  const chunks: Buffer[] = []
  let total = 0
  for (const [name, text] of Object.entries(files)) {
    if (!/^[a-zA-Z0-9_.\/-]{1,99}$/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid project archive path')
    const body = Buffer.from(text); total += body.length
    if (total > 256 * 1024) throw new Error('Project archive budget exceeded')
    const header = Buffer.alloc(512)
    header.write(name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48
    header.write('ustar\0', 257); header.write('00', 263)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)])
}
