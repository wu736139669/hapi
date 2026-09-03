import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { en, zhCN } from './locales'

export type Locale = 'en' | 'zh-CN'

export type Translations = Record<string, string>

export type I18nContextValue = {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const I18nContext = createContext<I18nContextValue | null>(null)

const locales: Record<Locale, Translations> = { en, 'zh-CN': zhCN }

function getInitialLocale(): Locale {
  const saved = localStorage.getItem('hapi-lang')
  if (saved === 'en' || saved === 'zh-CN') return saved

  // Shared-session links are commonly opened on a second device. The owner
  // may include an explicit language, while a bare share link defaults to the
  // Chinese UI used by the HAPI operator in this deployment.
  const requested = new URLSearchParams(window.location.search).get('lang')
  if (requested === 'en' || requested === 'zh-CN') return requested
  if (window.location.pathname.startsWith('/shared-session/')) return 'zh-CN'
  return 'en'
}

function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key]
    return value !== undefined ? String(value) : match
  })
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem('hapi-lang', newLocale)
    document.documentElement.lang = newLocale
  }, [])

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const dict = locales[locale] ?? locales.en
    const value = dict[key]
    const fallback = locales.en[key] ?? key
    return interpolate(value ?? fallback, params)
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <I18nContext.Provider value={{ t, locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}
