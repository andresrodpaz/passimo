'use client'

import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n'
import { isLocale } from '@/lib/i18n/locales'

/**
 * Language switcher.
 *
 * A menu rather than the previous ES/EN toggle: a two-way toggle stops working the
 * moment a third language exists, and this is the component that would need
 * rewriting. It renders from the locale list, so adding a dictionary adds an entry.
 *
 * Item labels are written in *their own* language — "Español" is never rendered as
 * "Spanish", because someone looking for their language scans for the word they
 * recognise.
 */
export function LanguageToggle({ variant = 'ghost' }: { variant?: 'ghost' | 'outline' }) {
  const { locale, setLocale, locales, labels, shortLabels, t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className="gap-1.5 px-2.5 text-xs font-medium"
          aria-label={t('common.language')}
        >
          <Languages className="size-4" aria-hidden />
          <span>{shortLabels[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (isLocale(value)) setLocale(value)
          }}
        >
          {locales.map((candidate) => (
            <DropdownMenuRadioItem key={candidate} value={candidate} className="cursor-pointer">
              {labels[candidate]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A compact variant for footers, where a dropdown is more chrome than the choice
 * deserves.
 */
export function LanguageLinks() {
  const { locale, setLocale, locales, labels } = useI18n()

  return (
    <div className="flex items-center gap-2 text-sm">
      {locales.map((candidate, index) => (
        <span key={candidate} className="flex items-center gap-2">
          {index > 0 && <span className="text-muted-foreground/40">·</span>}
          <button
            type="button"
            onClick={() => setLocale(candidate)}
            aria-current={candidate === locale ? 'true' : undefined}
            className={
              candidate === locale
                ? 'font-medium text-foreground'
                : 'text-muted-foreground transition-colors hover:text-foreground'
            }
          >
            {labels[candidate]}
          </button>
        </span>
      ))}
    </div>
  )
}
