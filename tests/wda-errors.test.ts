import { describe, expect, it } from 'vitest'
import { classifyWdaStartFailure } from '../src/wda-errors.js'

describe('WDA start error classification', () => {
  it('does not turn speculative timeout advice into a confirmed locked-device diagnosis', () => {
    expect(classifyWdaStartFailure(new Error('Timed out waiting for WDA. The device might be locked.'), []).code).toBe('wda_unknown_start_failure')
    expect(classifyWdaStartFailure(new Error('The device is locked'), []).code).toBe('wda_device_trust_or_developer_mode_required')
  })
  it('classifies missing profiles and invalid signing identities', () => {
    expect(classifyWdaStartFailure(
      new Error("No profiles for 'com.example.WebDriverAgentRunner.xctrunner' were found"),
      [],
    ).code).toBe('wda_profile_missing')
    expect(classifyWdaStartFailure(
      new Error('The identity used to sign the executable is no longer valid (0xe8008018)'),
      [],
    ).code).toBe('wda_signing_identity_invalid')
  })

  it('classifies explicit Xcode account absence without exposing Team or email', () => {
    const team = 'SECRETTEAM'
    const email = 'private@example.com'
    const error = classifyWdaStartFailure(new Error(
      `No Accounts with Team ${team} found. Sign in to ${email} at /Users/private/Library/Developer. No profiles for WDA were found.`,
    ), [team, email])
    expect(error.code).toBe('wda_developer_account_unavailable')
    expect(error.summary).toBeNull()
    for (const secret of [team, email, '/Users/private']) expect(error.message).not.toContain(secret)
    expect(classifyWdaStartFailure(new Error('No profiles for WDA were found'), []).code).toBe('wda_profile_missing')
  })

  it('keeps a bounded sanitized summary for unknown xcodebuild 65 failures', () => {
    const team = 'SECRETTEAM'
    const udid = '00008120-001234567890001E'
    const bundle = 'com.private.WebDriverAgentRunner'
    const error = classifyWdaStartFailure(new Error(
      `xcodebuild failed with code 65 for ${team} ${udid} ${bundle} at /Users/private/Library/Developer secret@example.com 0123456789012345678901234567890123456789`,
    ), [team, udid, bundle])

    expect(error.code).toBe('wda_unknown_start_failure')
    expect(error.summary?.length).toBeLessThanOrEqual(320)
    for (const secret of [team, udid, bundle, '/Users/private', 'secret@example.com', '0123456789012345678901234567890123456789']) {
      expect(error.message).not.toContain(secret)
    }
  })
})
