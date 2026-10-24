import { describe, expect, it } from 'vitest'
import {
  dshVersionContractErrors,
  SUPPORTED_CORDIS_VERSION,
  SUPPORTED_DSH_VERSION,
  SUPPORTED_SCHEMASTERY_VERSION,
} from '../scripts/dsh-version-contract.js'

function validInput() {
  return {
    manifest: {
      dependencies: { '@deepseek-ai/schemastery': SUPPORTED_SCHEMASTERY_VERSION },
      peerDependencies: {
        '@deepseek-ai/cordis': `~${SUPPORTED_CORDIS_VERSION}`,
        '@deepseek-ai/dsh-attachment': SUPPORTED_DSH_VERSION,
        '@deepseek-ai/dsh-llm': SUPPORTED_DSH_VERSION,
        '@deepseek-ai/dsh-tools': SUPPORTED_DSH_VERSION,
      },
      devDependencies: {
        '@deepseek-ai/cordis': SUPPORTED_CORDIS_VERSION,
        '@deepseek-ai/dsh-tools': SUPPORTED_DSH_VERSION,
      },
    },
    lockfile: `\nimporters:\n\n  .:\n    devDependencies:\n      '@deepseek-ai/dsh-tools':\n        specifier: ${SUPPORTED_DSH_VERSION}\n        version: ${SUPPORTED_DSH_VERSION}\n\npackages:\n\n  '@deepseek-ai/dsh-tools@${SUPPORTED_DSH_VERSION}':\n`,
    readme: `DeepSeek Harness \`${SUPPORTED_DSH_VERSION}\` exactly`,
    validation: `| Harness | \`@deepseek-ai/dsh\` ${SUPPORTED_DSH_VERSION} clean profile |`,
    runtimeProbe: `export const supportedHarnessVersion = '${SUPPORTED_DSH_VERSION}'\nif (process.env.DSH_TOOLS_MODE === 'ptc') {}\nmodels.find((entry) => entry.id === 'deepseek-flash')\nmodels.find((entry) => entry.id === 'deepseek-v4-pro')\nCATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION`,
    cleanProfileProbe: `for (const reload of ['live', 'startup']) for (const mode of ['native', 'ptc']) {}\nstopRuntime()\n({ harness: '${SUPPORTED_DSH_VERSION}', modes: ['native', 'ptc'], modelImageBoundary: 'CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION' })`,
  }
}

describe('DSH version contract', () => {
  it('accepts one exact rc.2 baseline, Native/PTC presentation and model image boundary across current entry points', () => {
    expect(dshVersionContractErrors(validInput())).toEqual([])
  })

  it.each([
    ['peer dependency', (input: ReturnType<typeof validInput>) => { input.manifest.peerDependencies!['@deepseek-ai/dsh-llm'] = '^0.1.0-rc.8' }],
    ['Cordis dependency', (input: ReturnType<typeof validInput>) => { input.manifest.devDependencies!['@deepseek-ai/cordis'] = '4.0.1' }],
    ['Schemastery dependency', (input: ReturnType<typeof validInput>) => { input.manifest.dependencies!['@deepseek-ai/schemastery'] = '3.18.1' }],
    ['lockfile importer', (input: ReturnType<typeof validInput>) => { input.lockfile = input.lockfile.replaceAll(SUPPORTED_DSH_VERSION, '0.1.0-rc.7') }],
    ['mixed DSH family', (input: ReturnType<typeof validInput>) => { input.lockfile += "\n  '@deepseek-ai/dsh-sandbox@0.1.7-rc.2':\n" }],
    ['runtime peer drift', (input: ReturnType<typeof validInput>) => { Object.assign(input.manifest.devDependencies, { '@deepseek-ai/dsh-session': '0.2.1-alpha.1' }) }],
    ['README baseline', (input: ReturnType<typeof validInput>) => { input.readme = input.readme.replace(SUPPORTED_DSH_VERSION, '0.1.0-rc.7') }],
    ['validation baseline', (input: ReturnType<typeof validInput>) => { input.validation = input.validation.replace(SUPPORTED_DSH_VERSION, '0.1.0-rc.7') }],
    ['runtime probe baseline', (input: ReturnType<typeof validInput>) => { input.runtimeProbe = input.runtimeProbe.replace(SUPPORTED_DSH_VERSION, '0.1.0-rc.7') }],
    ['runtime probe image route', (input: ReturnType<typeof validInput>) => { input.runtimeProbe = input.runtimeProbe.replace("entry.id === 'deepseek-flash'", "entry.id === 'missing-image-model'") }],
    ['runtime probe legacy Code Mode', (input: ReturnType<typeof validInput>) => { input.runtimeProbe = input.runtimeProbe.replace("=== 'ptc'", "=== 'code'") }],
    ['clean-profile legacy Code Mode', (input: ReturnType<typeof validInput>) => { input.cleanProfileProbe = input.cleanProfileProbe.replaceAll("'ptc'", "'code'") }],
    ['legacy profile reload', (input: ReturnType<typeof validInput>) => { input.cleanProfileProbe += '\nprofileManifest.dsh.profile = {patchReload: "startup"}' }],
    ['missing live HMR', (input: ReturnType<typeof validInput>) => { input.cleanProfileProbe = input.cleanProfileProbe.replace("['live', 'startup']", "['startup']") }],
  ])('rejects %s drift', (_name, mutate) => {
    const input = validInput()
    mutate(input)
    expect(dshVersionContractErrors(input)).not.toEqual([])
  })
})
