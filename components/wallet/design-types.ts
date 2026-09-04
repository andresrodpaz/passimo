import type { BrandKit } from '@/lib/brand/kit'
import type { CardDesign } from '@/lib/wallet/card-design'
import type { ProviderStatus } from '@/lib/wallet/types'

/**
 * What `GET /api/v1/wallet/design` returns.
 *
 * Declared once and imported by every screen that reads that endpoint — the
 * designer, the brand kit panel and onboarding all consume the same response, so
 * three hand-written copies of this shape would be three chances for one of them
 * to drift from the route.
 */
export type CardDesignProgram = {
  name: string | null
  isStampProgram: boolean
  goal: number | null
  unitSingular: string | null
  unitPlural: string | null
  rewardName: string | null
}

export type CardDesignResponse = {
  design: CardDesign
  /** True once the merchant has edited the card since it was first created. */
  customised: boolean
  brand: BrandKit
  program: CardDesignProgram
  locationName: string | null
  providers: ProviderStatus[]
}
