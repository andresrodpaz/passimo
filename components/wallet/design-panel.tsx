'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AsyncBoundary } from '@/components/states'
import { CardDesigner } from '@/components/wallet/card-designer'
import type { CardDesignResponse } from '@/components/wallet/design-types'
import { apiFetch, apiPatch, useApi, query } from '@/lib/client/api'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import type { CardDesign } from '@/lib/wallet/card-design'

/**
 * The card designer, wired to the server.
 *
 * Thin on purpose: fetching, saving and toasts here, every design decision in
 * `CardDesigner`, every rule in `lib/wallet/card-design.ts`. That split is what
 * lets onboarding mount the same designer against the same endpoint without
 * either screen owning a second copy of the logic.
 */
export function CardDesignPanel({
  businessId,
  canWrite,
  uploadsEnabled,
}: {
  businessId: string
  canWrite: boolean
  uploadsEnabled: boolean
}) {
  const { t } = useI18n()
  const key = `/api/v1/wallet/design${query({ businessId })}`
  const { data, error, isLoading, mutate } = useApi<CardDesignResponse>(key)
  const [saving, setSaving] = React.useState(false)

  async function save(design: CardDesign) {
    setSaving(true)
    try {
      await apiPatch(key.split('?')[0]!, { businessId, ...design })
      toast.success(t('cardDesign.saved'))
      await mutate()
    } catch (cause) {
      toast.error(toastError(cause, t, 'cardDesign.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function uploadLogo(file: File): Promise<string> {
    const form = new FormData()
    form.append('file', file)
    const result = await apiFetch<{ logoUrl: string }>(
      `/api/v1/brand/logo${query({ businessId })}`,
      { method: 'POST', body: form }
    )
    await mutate()
    return result.logoUrl
  }

  async function setLogo(logoUrl: string | null) {
    try {
      await apiPatch('/api/v1/brand', { businessId, logoUrl })
      await mutate()
    } catch (cause) {
      toast.error(toastError(cause, t, 'brandKit.saveFailed'))
    }
  }

  return (
    <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>
      {(loaded) => {
        const unconfigured = loaded.providers.filter((provider) => !provider.configured)

        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">{t('cardDesign.title')}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {t('cardDesign.designHint')}
              </p>
            </div>

            {/*
              Said once, here, rather than under every preview. The design is
              real and is stored; what is not yet real is the pass, and a
              merchant deserves to know that before they show a colleague their
              "Apple Wallet card". `providers` travels with the design response
              precisely so this claim is derived rather than assumed.
            */}
            {unconfigured.length > 0 && (
              <Alert>
                <AlertTriangle className="size-4" aria-hidden />
                <AlertTitle>{t('cardDesign.preview.notConfigured')}</AlertTitle>
                <AlertDescription>
                  {t('cardDesign.preview.notConfiguredBody', {
                    providers: unconfigured.map((provider) => provider.label).join(', '),
                  })}
                </AlertDescription>
              </Alert>
            )}

            <CardDesigner
              /*
               * Keyed on the saved design's *content*, not on a fetch identity.
               * SWR returns a new object on every revalidation, so keying on the
               * reference would remount — and discard an in-progress edit —
               * every time the tab regained focus. Keying on content remounts
               * only when the stored design actually changed, which is exactly
               * when the draft should be reseeded.
               */
              key={JSON.stringify(loaded.design)}
              design={loaded.design}
              brand={loaded.brand}
              program={{
                goal: loaded.program.goal,
                isStampProgram: loaded.program.isStampProgram,
                unitSingular:
                  loaded.program.unitSingular ?? t('cardDesign.preview.defaultUnitSingular'),
                unitPlural: loaded.program.unitPlural ?? t('cardDesign.preview.defaultUnitPlural'),
                rewardName: loaded.program.rewardName,
                programName: loaded.program.name ?? t('cardDesign.preview.defaultProgram'),
              }}
              sampleLocationName={loaded.locationName}
              saving={saving}
              readOnly={!canWrite}
              uploadsEnabled={uploadsEnabled}
              onUploadLogo={canWrite ? uploadLogo : undefined}
              onLogoChange={canWrite ? (value) => void setLogo(value) : undefined}
              onSave={(design) => void save(design)}
            />
          </div>
        )
      }}
    </AsyncBoundary>
  )
}
