'use client'

import * as React from 'react'
import { useApi } from '@/lib/client/api'
import { useStoredValue } from '@/lib/client/hooks'
import type { Permission } from '@/lib/auth/rbac'
import type { CapabilityReport } from '@/lib/env'
import type { Feature, Limits, PlanId } from '@/lib/billing/plans'

/**
 * Workspace context.
 *
 * Holds the answer to "which business am I looking at, what may I do here, and
 * what does this plan include?" so no component ever has to thread a businessId
 * through five layers of props, and both kinds of gate are a one-liner at the
 * point of use.
 *
 * `can` and `has` are deliberately separate. Role and plan fail for different
 * reasons and deserve different UI: a viewer who cannot send campaigns needs
 * their manager, an owner on Free needs a checkout page. Collapsing them into
 * one `isAllowed` is how products end up showing "upgrade" to someone whose
 * company already pays.
 */

export type WorkspaceEntitlements = {
  plan: PlanId
  effective_plan: PlanId
  features: Feature[]
  limits: Limits
  trial: { active: boolean; endsAt: string | null; daysRemaining: number }
  subscription: {
    status: string | null
    interval: 'month' | 'year'
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    delinquent: boolean
  }
}

export type WorkspaceBusiness = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  plan: string | null
  role: string
  permissions: Permission[]
  entitlements: WorkspaceEntitlements | null
}

type MeResponse = {
  user: { id: string | null; email: string | null }
  businesses: WorkspaceBusiness[]
  active_business_id: string | null
  capabilities: CapabilityReport
  unread_notifications: number
}

type WorkspaceValue = {
  loading: boolean
  error: Error | null
  user: MeResponse['user'] | null
  businesses: WorkspaceBusiness[]
  business: WorkspaceBusiness | null
  businessId: string | null
  capabilities: CapabilityReport | null
  entitlements: WorkspaceEntitlements | null
  unreadNotifications: number
  /** Role check: "is my account allowed to do this?" */
  can: (permission: Permission) => boolean
  /** Plan check: "does this workspace pay for this?" */
  has: (feature: Feature) => boolean
  switchBusiness: (id: string) => void
  refresh: () => void
}

const WorkspaceContext = React.createContext<WorkspaceValue | null>(null)

const STORAGE_KEY = 'passimo.activeBusiness'

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data, error, isLoading, mutate } = useApi<MeResponse>('/api/v1/me')

  // Restore the last workspace so multi-location owners do not re-pick on every
  // page load. Read through useSyncExternalStore rather than an effect: it is
  // hydration-safe and avoids a cascading re-render on mount.
  const [selectedId, setSelectedId] = useStoredValue(STORAGE_KEY)

  const businesses = React.useMemo(() => data?.businesses ?? [], [data])
  const business =
    businesses.find((candidate) => candidate.id === selectedId) ??
    businesses.find((candidate) => candidate.id === data?.active_business_id) ??
    businesses[0] ??
    null

  const switchBusiness = React.useCallback(
    (id: string) => setSelectedId(id),
    [setSelectedId]
  )

  const permissions = React.useMemo(
    () => new Set(business?.permissions ?? []),
    [business]
  )

  const features = React.useMemo(
    () => new Set(business?.entitlements?.features ?? []),
    [business]
  )

  const value = React.useMemo<WorkspaceValue>(
    () => ({
      loading: isLoading,
      error: error ?? null,
      user: data?.user ?? null,
      businesses,
      business,
      businessId: business?.id ?? null,
      capabilities: data?.capabilities ?? null,
      entitlements: business?.entitlements ?? null,
      unreadNotifications: data?.unread_notifications ?? 0,
      can: (permission) => permissions.has(permission),
      // Optimistic while `/me` is in flight: showing a locked screen for a
      // fraction of a second to a paying customer is the worse failure.
      has: (feature) => (business?.entitlements ? features.has(feature) : true),
      switchBusiness,
      refresh: () => void mutate(),
    }),
    [isLoading, error, data, businesses, business, permissions, features, switchBusiness, mutate]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const context = React.useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  return context
}

/** Convenience for the very common "I need the id or nothing" pattern. */
export function useBusinessId(): string | null {
  return useWorkspace().businessId
}
