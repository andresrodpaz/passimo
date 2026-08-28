'use client'

import * as React from 'react'
import { Copy, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/lib/i18n'
import { WEEKDAYS, type OpeningHours, type OpeningHoursRange, type Weekday } from '@/lib/wallet/types'

/**
 * Opening hours editor.
 *
 * Seven rows, each with a closed/open switch and one or more time ranges. Two
 * ranges per day is the *common* case, not an edge case — a bakery closing 14:00 to
 * 17:00 is normal in the markets this product sells into — so adding a second period
 * is one button rather than a hidden advanced mode.
 *
 * "Apply to every day" exists because the realistic first action is "we open 09:00
 * to 20:00, six days a week", and typing fourteen times to express that is where a
 * merchant abandons the form.
 *
 * A day with no ranges is *closed*, and a whole object with no days is *unknown* —
 * two different things. The proximity engine treats unknown as "do not suppress
 * anything", so a merchant who skips this section does not silently lose every
 * notification.
 */
export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHours
  onChange: (value: OpeningHours) => void
}) {
  const { t } = useI18n()

  // Monday-first, which is how a week reads everywhere this is sold, while the
  // storage keys stay Sunday-indexed to match `Date.getDay()`.
  const orderedDays: Weekday[] = React.useMemo(
    () => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    []
  )

  const setDay = (day: Weekday, ranges: OpeningHoursRange[] | undefined) => {
    const next: OpeningHours = { ...value }
    if (!ranges || ranges.length === 0) delete next[day]
    else next[day] = ranges
    onChange(next)
  }

  const applyToAll = (day: Weekday) => {
    const ranges = value[day]
    if (!ranges?.length) return
    const next: OpeningHours = {}
    for (const candidate of orderedDays) next[candidate] = ranges.map((range) => [...range])
    onChange(next)
  }

  return (
    <div className="divide-y rounded-xl border">
      {orderedDays.map((day) => {
        const ranges = value[day] ?? []
        const open = ranges.length > 0

        return (
          <div key={day} className="p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Switch
                  id={`hours-${day}`}
                  checked={open}
                  onCheckedChange={(checked) =>
                    setDay(day, checked ? [['09:00', '18:00']] : undefined)
                  }
                />
                <Label htmlFor={`hours-${day}`} className="cursor-pointer text-sm font-medium">
                  {t(`locations.hours.days.${day}` as 'locations.hours.days.mon')}
                </Label>
              </div>

              {open ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => applyToAll(day)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Copy className="size-3" aria-hidden />
                  <span className="hidden sm:inline">{t('locations.hours.copyToAll')}</span>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t('locations.hours.closed')}</span>
              )}
            </div>

            {open && (
              <div className="mt-3 space-y-2 pl-[3.25rem]">
                {ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={t('locations.hours.from')}
                      value={range[0]}
                      onChange={(event) => {
                        const next = ranges.map((entry, position) =>
                          position === index
                            ? ([event.target.value, entry[1]] as OpeningHoursRange)
                            : entry
                        )
                        setDay(day, next)
                      }}
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground">
                      {t('locations.hours.to')}
                    </span>
                    <Input
                      type="time"
                      aria-label={t('locations.hours.to')}
                      value={range[1]}
                      onChange={(event) => {
                        const next = ranges.map((entry, position) =>
                          position === index
                            ? ([entry[0], event.target.value] as OpeningHoursRange)
                            : entry
                        )
                        setDay(day, next)
                      }}
                      className="w-28"
                    />
                    {ranges.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={t('locations.hours.removeRange')}
                        onClick={() => setDay(day, ranges.filter((_, position) => position !== index))}
                      >
                        <X className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}

                {ranges.length < 4 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDay(day, [...ranges, ['17:00', '20:00']])}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <Plus className="size-3" aria-hidden />
                    {t('locations.hours.addRange')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { WEEKDAYS }
