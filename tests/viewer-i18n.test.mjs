import { describe, expect, it, vi } from 'vitest'
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  normalizeLocale,
  readLocalePreference,
  resolveInitialLocale,
  translate,
  writeLocalePreference,
} from '../viewer/i18n.js'

describe('Viewer localization', () => {
  it('keeps the English and Simplified Chinese catalogs in exact key parity', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh-CN'])
    expect(Object.keys(TRANSLATIONS['zh-CN']).sort()).toEqual(Object.keys(TRANSLATIONS.en).sort())
    for (const key of ['zoom.group', 'zoom.fit', 'zoom.fit.title', 'zoom.out', 'zoom.in', 'zoom.percent']) {
      expect(TRANSLATIONS.en[key]).toBeTruthy()
      expect(TRANSLATIONS['zh-CN'][key]).toBeTruthy()
    }
  })

  it('normalizes Chinese and English variants without accepting unsupported locales', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN')
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeLocale('zh_Hans')).toBe('zh-CN')
    expect(normalizeLocale('EN-us')).toBe('en')
    expect(normalizeLocale('ja-JP')).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
  })

  it('prefers a valid saved locale, otherwise selects Chinese from browser preferences', () => {
    const storage = { getItem: vi.fn(() => 'en') }
    expect(resolveInitialLocale({ storage, languages: ['zh-CN'] })).toBe('en')
    expect(resolveInitialLocale({ storage: { getItem: () => 'invalid' }, languages: ['en-US', 'zh-Hans'] })).toBe('zh-CN')
    expect(resolveInitialLocale({ languages: ['fr-FR'] })).toBe('en')
  })

  it('reads and writes only canonical locale values and fails closed when storage throws', () => {
    const values = new Map()
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }
    expect(writeLocalePreference(storage, 'zh-CN')).toBe(true)
    expect(values).toEqual(new Map([[LOCALE_STORAGE_KEY, 'zh-CN']]))
    expect(readLocalePreference(storage)).toBe('zh-CN')
    expect(writeLocalePreference(storage, 'fr')).toBe(false)
    values.set(LOCALE_STORAGE_KEY, 'private-invalid-value')
    expect(readLocalePreference(storage)).toBeNull()
    expect(values.has(LOCALE_STORAGE_KEY)).toBe(false)

    const blocked = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readLocalePreference(blocked)).toBeNull()
    expect(writeLocalePreference(blocked, 'en')).toBe(false)
    expect(resolveInitialLocale({ storage: blocked, languages: ['zh-TW'] })).toBe('zh-CN')
  })

  it('interpolates parameters, falls back to English, and never exposes an internal key', () => {
    expect(translate('zh-CN', 'assistant.progress.check', { platform: 'Android' })).toBe('正在检查 Android…')
    const catalogs = {
      en: { ...TRANSLATIONS.en, fallbackOnly: 'English fallback' },
      'zh-CN': { ...TRANSLATIONS['zh-CN'] },
    }
    expect(translate('zh-CN', 'fallbackOnly', {}, catalogs)).toBe('English fallback')
    expect(translate('zh-CN', 'internal.missing.key')).toBe('暂不可用')
    expect(translate('zh-CN', 'internal.missing.key')).not.toContain('internal.missing.key')
  })
})
