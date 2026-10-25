export const SUPPORTED_DSH_VERSION = '0.2.0-rc.2'
export const SUPPORTED_CORDIS_VERSION = '4.0.5'
export const SUPPORTED_SCHEMASTERY_VERSION = '3.18.4'

type PackageManifest = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export type DshVersionContractInput = {
  manifest: PackageManifest
  lockfile: string
  readme: string
  validation: string
  runtimeProbe: string
  cleanProfileProbe: string
}

const DSH_PEERS = [
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
] as const

export function dshVersionContractErrors(input: DshVersionContractInput): string[] {
  const errors: string[] = []
  if (input.manifest.peerDependencies?.['@deepseek-ai/cordis'] !== `~${SUPPORTED_CORDIS_VERSION}`
    || input.manifest.devDependencies?.['@deepseek-ai/cordis'] !== SUPPORTED_CORDIS_VERSION) {
    errors.push(`package.json Cordis contract must resolve ~${SUPPORTED_CORDIS_VERSION}/${SUPPORTED_CORDIS_VERSION}`)
  }
  if (input.manifest.dependencies?.['@deepseek-ai/schemastery'] !== SUPPORTED_SCHEMASTERY_VERSION) {
    errors.push(`package.json Schemastery contract must equal ${SUPPORTED_SCHEMASTERY_VERSION}`)
  }
  for (const dependency of DSH_PEERS) {
    if (input.manifest.peerDependencies?.[dependency] !== SUPPORTED_DSH_VERSION) {
      errors.push(`package.json peer ${dependency} must equal ${SUPPORTED_DSH_VERSION}`)
    }
  }
  for (const [name, version] of Object.entries(input.manifest.devDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-') && version !== SUPPORTED_DSH_VERSION) {
      errors.push(`package.json dev ${name} must equal ${SUPPORTED_DSH_VERSION}`)
    }
  }
  if (input.manifest.devDependencies?.['@deepseek-ai/dsh-tools'] !== SUPPORTED_DSH_VERSION) {
    errors.push(`package.json dev @deepseek-ai/dsh-tools must equal ${SUPPORTED_DSH_VERSION}`)
  }

  const importer = input.lockfile.match(/\n  \.:\n([\s\S]*?)\npackages:/)?.[1] ?? ''
  if (!importer.includes(`specifier: ${SUPPORTED_DSH_VERSION}`)
    || !importer.includes(`version: ${SUPPORTED_DSH_VERSION}`)) {
    errors.push(`pnpm-lock.yaml importer must resolve @deepseek-ai/dsh-tools to ${SUPPORTED_DSH_VERSION}`)
  }
  if (!input.lockfile.includes(`'@deepseek-ai/dsh-tools@${SUPPORTED_DSH_VERSION}':`)) {
    errors.push(`pnpm-lock.yaml must contain @deepseek-ai/dsh-tools@${SUPPORTED_DSH_VERSION}`)
  }
  for (const match of input.lockfile.matchAll(/^  '?(@deepseek-ai\/dsh(?:-[^@\s']+)?)@([^\s'():]+)'?:/gm)) {
    if (match[2] !== SUPPORTED_DSH_VERSION) errors.push(`pnpm-lock.yaml mixed DSH family ${match[1]}@${match[2]}`)
  }
  if (!input.readme.includes(`DeepSeek Harness \`${SUPPORTED_DSH_VERSION}\` exactly`)) {
    errors.push(`README current Harness baseline must equal ${SUPPORTED_DSH_VERSION}`)
  }
  if (!input.validation.includes(`| Harness | \`@deepseek-ai/dsh\` ${SUPPORTED_DSH_VERSION} clean profile |`)) {
    errors.push(`docs/validation.md current Harness baseline must equal ${SUPPORTED_DSH_VERSION}`)
  }
  if (!input.runtimeProbe.includes(`supportedHarnessVersion = '${SUPPORTED_DSH_VERSION}'`)) {
    errors.push(`runtime probe baseline must equal ${SUPPORTED_DSH_VERSION}`)
  }
  if (!input.runtimeProbe.includes("entry.id === 'deepseek-flash'")
    || !input.runtimeProbe.includes("entry.id === 'deepseek-v4-pro'")
    || !input.runtimeProbe.includes('CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION')) {
    errors.push('runtime probe must distinguish the image-capable and text-only DeepSeek catalog routes')
  }
  if (!input.runtimeProbe.includes("process.env.DSH_TOOLS_MODE === 'ptc'")
    || input.runtimeProbe.includes("process.env.DSH_TOOLS_MODE === 'code'")) {
    errors.push('runtime probe must use DSH native/PTC presentation modes')
  }
  if (!input.cleanProfileProbe.includes(`harness: '${SUPPORTED_DSH_VERSION}'`)
    || !input.cleanProfileProbe.includes("for (const mode of ['native', 'ptc'])")
    || !input.cleanProfileProbe.includes("modes: ['native', 'ptc']")
    || !input.cleanProfileProbe.includes("modelImageBoundary: 'CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION'")) {
    errors.push(`clean-profile probe must use DSH ${SUPPORTED_DSH_VERSION} native/PTC modes`)
  }
  if (input.cleanProfileProbe.includes('profileManifest.dsh.profile')
    || !input.cleanProfileProbe.includes("['live', 'startup']")
    || !input.cleanProfileProbe.includes('stopRuntime')) {
    errors.push('clean-profile probe must verify live/startup HMR and graceful resource cleanup without legacy patchReload')
  }
  return errors
}
