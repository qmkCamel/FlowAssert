import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const out = resolve(root, '../../../artifacts/fixture/ios')
mkdirSync(out, { recursive: true })
for (const file of ['project.yml', 'MirrorFixture.swift']) copyFileSync(resolve(root, file), resolve(out, file))
execFileSync('xcodegen', ['generate', '--spec', resolve(out, 'project.yml')], { stdio: 'inherit' })
const signing = process.env.FIXTURE_DEVELOPMENT_TEAM
execFileSync('xcodebuild', ['-project', resolve(out, 'MirrorFixture.xcodeproj'), '-scheme', 'MirrorFixture', '-sdk', 'iphoneos', '-configuration', 'Debug', '-derivedDataPath', resolve(out, 'build'), ...(signing ? [`DEVELOPMENT_TEAM=${signing}`, 'CODE_SIGN_STYLE=Automatic'] : ['CODE_SIGNING_ALLOWED=NO']), 'build'], { stdio: 'inherit' })
