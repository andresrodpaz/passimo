'use client'

import * as React from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Handshake,
  Loader2,
  Plus,
  Search,
  Store,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useApi, apiPost, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { FeatureGate, UpgradePrompt } from '@/components/billing/upgrade'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'

type Partner = {
  partnershipId: string
  partnerId: string
  partnerName: string
  partnerLogoUrl: string | null
  partnerCategory: string | null
  partnerCity: string | null
  status: 'pending' | 'active' | 'declined' | 'ended'
  direction: 'sent' | 'received'
  allowCrossEarn: boolean
  allowCrossRedeem: boolean
  offersLive: number
  redemptionsIn: number
  redemptionsOut: number
}

type DirectoryEntry = {
  id: string
  name: string
  logoUrl: string | null
  category: string | null
  city: string | null
  bio: string | null
  reach: string
  relationship: string | null
}

type Offer = {
  id: string
  businessId: string
  businessName: string | null
  title: string
  description: string | null
  redemptionLimit: number | null
  redeemedCount: number
  isActive: boolean
  endsAt: string | null
}

type NetworkResponse = {
  participation: {
    opted_in: boolean
    bio: string | null
    city: string | null
    category: string | null
  }
  partners: Partner[]
  directory: DirectoryEntry[]
  our_offers: Offer[]
  partner_offers: Offer[]
}

/**
 * The partner network.
 *
 * The one feature here with a real network effect: a loyalty app is worth the
 * same to the tenth merchant as the first, but a network of local businesses
 * that send each other customers gets more valuable with every one that joins.
 * A merchant who leaves loses their partners, not just their software.
 */
export default function NetworkPage() {
  return (
    <FeatureGate
      feature="coalition"
      fallback={
        <div className="space-y-6">
          <Header />
          <NetworkUpsell />
        </div>
      }
    >
      <NetworkView />
    </FeatureGate>
  )
}

function Header() {
  const { t } = useI18n()
  return (
    <header>
      <h2 className="text-xl font-semibold tracking-tight">{t('network.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('network.subtitle')}</p>
    </header>
  )
}

function NetworkUpsell() {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-6">
        <h3 className="text-base font-semibold">{t('network.howItWorks')}</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t('network.howItWorksBody')}
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          {(['network.rule1', 'network.rule2', 'network.rule3'] as const).map((key) => (
            <li key={key}>· {t(key)}</li>
          ))}
        </ul>
      </section>
      <UpgradePrompt
        feature="coalition"
        title={t('network.upsellTitle')}
        description={t('network.upsellBody')}
      />
    </div>
  )
}

function NetworkView() {
  const { businessId, can } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [editingOffer, setEditingOffer] = React.useState<Offer | 'new' | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const key = businessId ? `/api/v1/network${query({ businessId, search: debounced })}` : null
  const network = useApi<NetworkResponse>(key)

  async function act(action: string, payload: Record<string, unknown>, busyKey: string) {
    if (!businessId) return
    setBusy(busyKey)
    setError(null)
    try {
      await apiPost('/api/v1/network', { action, businessId, ...payload })
      void network.mutate()
    } catch (cause) {
      setError(toastError(cause, t))
    } finally {
      setBusy(null)
    }
  }

  const pendingInvites = (network.data?.partners ?? []).filter(
    (partner) => partner.status === 'pending' && partner.direction === 'received'
  )
  const activePartners = (network.data?.partners ?? []).filter(
    (partner) => partner.status === 'active'
  )

  return (
    <div className="space-y-6">
      <Header />

      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <AsyncBoundary
        data={network.data}
        error={network.error}
        isLoading={network.isLoading}
        onRetry={() => void network.mutate()}
      >
        {(data) => (
          <>
            <ParticipationCard
              participation={data.participation}
              canEdit={can('settings:write')}
              busy={busy === 'participation'}
              onSave={(optIn, bio) => void act('set_participation', { optIn, bio }, 'participation')}
            />

            {!data.participation.opted_in ? null : (
              <>
                {pendingInvites.length > 0 && (
                  <section className="rounded-xl border border-primary/40 bg-card">
                    <h3 className="border-b p-4 text-base font-semibold">
                      {t('network.invitations', { count: pendingInvites.length })}
                    </h3>
                    <ul className="divide-y">
                      {pendingInvites.map((invite) => (
                        <li
                          key={invite.partnershipId}
                          className="flex flex-wrap items-center gap-3 p-4"
                        >
                          <PartnerAvatar name={invite.partnerName} logo={invite.partnerLogoUrl} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{invite.partnerName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[invite.partnerCategory, invite.partnerCity]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="gap-1.5"
                              disabled={busy === invite.partnershipId}
                              onClick={() =>
                                void act(
                                  'respond',
                                  { partnershipId: invite.partnershipId, accept: true },
                                  invite.partnershipId
                                )
                              }
                            >
                              <Check className="size-4" />
                              {t('network.accept')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={t('network.decline')}
                              disabled={busy === invite.partnershipId}
                              onClick={() =>
                                void act(
                                  'respond',
                                  { partnershipId: invite.partnershipId, accept: false },
                                  invite.partnershipId
                                )
                              }
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <Tabs defaultValue="partners">
                  <TabsList>
                    <TabsTrigger value="partners">
                      {t('network.tabPartners', { count: formatNumber(activePartners.length) })}
                    </TabsTrigger>
                    <TabsTrigger value="discover">{t('network.tabDiscover')}</TabsTrigger>
                    <TabsTrigger value="offers">{t('network.tabOffers')}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="partners" className="mt-4">
                    {activePartners.length === 0 ? (
                      <EmptyState
                        icon={Handshake}
                        title={t('network.noPartners')}
                        description={t('network.noPartnersBody')}
                      />
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {activePartners.map((partner) => (
                          <PartnerCard
                            key={partner.partnershipId}
                            partner={partner}
                            canEdit={can('settings:write')}
                            busy={busy === partner.partnershipId}
                            onEnd={() =>
                              void act(
                                'end',
                                { partnershipId: partner.partnershipId },
                                partner.partnershipId
                              )
                            }
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="discover" className="mt-4 space-y-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('network.searchPlaceholder')}
                        className="h-10 pl-9"
                        aria-label={t('network.searchLabel')}
                      />
                    </div>

                    {data.directory.length === 0 ? (
                      <EmptyState
                        icon={Store}
                        title={t('network.nobodyNearby')}
                        description={t('network.nobodyNearbyBody')}
                      />
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {data.directory.map((entry) => (
                          <DirectoryCard
                            key={entry.id}
                            entry={entry}
                            canInvite={can('settings:write')}
                            busy={busy === entry.id}
                            onInvite={() =>
                              void act('invite', { partnerBusinessId: entry.id }, entry.id)
                            }
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="offers" className="mt-4 space-y-6">
                    <section>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-base font-semibold">{t('network.ourOffers')}</h3>
                        {can('settings:write') && (
                          <Button size="sm" className="gap-2" onClick={() => setEditingOffer('new')}>
                            <Plus className="size-4" />
                            {t('network.newOffer')}
                          </Button>
                        )}
                      </div>
                      {data.our_offers.length === 0 ? (
                        <p className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                          {t('network.ourOffersEmpty')}
                        </p>
                      ) : (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {data.our_offers.map((offer) => (
                            <OfferCard key={offer.id} offer={offer} mine />
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h3 className="text-base font-semibold">{t('network.partnerOffers')}</h3>
                      {data.partner_offers.length === 0 ? (
                        <p className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                          {t('network.partnerOffersEmpty')}
                        </p>
                      ) : (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {data.partner_offers.map((offer) => (
                            <OfferCard key={offer.id} offer={offer} mine={false} />
                          ))}
                        </div>
                      )}
                    </section>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </AsyncBoundary>

      <Sheet open={editingOffer !== null} onOpenChange={(open) => !open && setEditingOffer(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {editingOffer !== null && (
            <OfferForm
              key={editingOffer === 'new' ? 'new' : editingOffer.id}
              businessId={businessId}
              offer={editingOffer}
              partners={activePartners}
              onSaved={() => {
                setEditingOffer(null)
                void network.mutate()
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ParticipationCard({
  participation,
  canEdit,
  busy,
  onSave,
}: {
  participation: NetworkResponse['participation']
  canEdit: boolean
  busy: boolean
  onSave: (optIn: boolean, bio: string | null) => void
}) {
  const { t } = useI18n()
  const [bio, setBio] = React.useState(participation.bio ?? '')

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold">
            {participation.opted_in ? t('network.listed') : t('network.notListed')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {participation.opted_in
              ? t('network.listedBody', {
                  city: participation.city ?? t('network.yourArea'),
                })
              : t('network.notListedBody')}
          </p>
        </div>
        {canEdit && (
          <Switch
            checked={participation.opted_in}
            disabled={busy}
            onCheckedChange={(checked) => onSave(checked, bio || null)}
            aria-label={t('network.participationLabel')}
          />
        )}
      </div>

      {participation.opted_in && canEdit && (
        <div className="mt-4 space-y-2">
          <Label htmlFor="network-bio">{t('network.bio')}</Label>
          <Textarea
            id="network-bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder={t('network.bioPlaceholder')}
            rows={2}
            maxLength={280}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || bio === (participation.bio ?? '')}
            onClick={() => onSave(true, bio || null)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('network.saveBio')}
          </Button>
        </div>
      )}
    </section>
  )
}

function PartnerAvatar({ name, logo }: { name: string; logo: string | null }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold uppercase text-primary"
    >
      {name.slice(0, 2)}
    </span>
  )
}

function PartnerCard({
  partner,
  canEdit,
  busy,
  onEnd,
}: {
  partner: Partner
  canEdit: boolean
  busy: boolean
  onEnd: () => void
}) {
  const { t, formatNumber } = useI18n()

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <PartnerAvatar name={partner.partnerName} logo={partner.partnerLogoUrl} />
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-medium">{partner.partnerName}</h4>
          <p className="truncate text-xs text-muted-foreground">
            {[partner.partnerCategory, partner.partnerCity].filter(Boolean).join(' · ')}
          </p>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onEnd}>
            {t('network.endPartnership')}
          </Button>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowDownLeft className="size-3" />
            {t('network.theySentYou')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatNumber(partner.redemptionsIn)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUpRight className="size-3" />
            {t('network.youSentThem')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatNumber(partner.redemptionsOut)}
          </dd>
        </div>
      </dl>

      {partner.redemptionsIn === 0 && partner.redemptionsOut === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">{t('network.noTraffic')}</p>
      )}
    </article>
  )
}

function DirectoryCard({
  entry,
  canInvite,
  busy,
  onInvite,
}: {
  entry: DirectoryEntry
  canInvite: boolean
  busy: boolean
  onInvite: () => void
}) {
  const { t } = useI18n()

  return (
    <article className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <PartnerAvatar name={entry.name} logo={entry.logoUrl} />
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-medium">{entry.name}</h4>
          <p className="truncate text-xs text-muted-foreground">
            {[entry.category, entry.city].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {entry.bio && (
        <p className="mt-3 line-clamp-3 flex-1 text-xs text-muted-foreground">{entry.bio}</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="outline">{entry.reach}</Badge>
        {entry.relationship === 'active' ? (
          <Badge variant="secondary">{t('network.partners')}</Badge>
        ) : entry.relationship === 'pending' ? (
          <Badge variant="outline">{t('network.pending')}</Badge>
        ) : canInvite ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onInvite}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('network.invite')}
          </Button>
        ) : null}
      </div>
    </article>
  )
}

function OfferCard({ offer, mine }: { offer: Offer; mine: boolean }) {
  const { t, formatNumber } = useI18n()

  return (
    <article className={`rounded-xl border bg-card p-4 ${offer.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium">{offer.title}</h4>
        {!offer.isActive && <Badge variant="outline">{t('common.paused')}</Badge>}
      </div>
      {!mine && offer.businessName && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('network.fromBusiness', { name: offer.businessName })}
        </p>
      )}
      {offer.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{offer.description}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {offer.redemptionLimit
          ? t('network.claimedOf', {
              count: formatNumber(offer.redeemedCount),
              limit: formatNumber(offer.redemptionLimit),
            })
          : t('network.claimedTimes', { count: offer.redeemedCount })}
      </p>
    </article>
  )
}

function OfferForm({
  businessId,
  offer,
  partners,
  onSaved,
}: {
  businessId: string | null
  offer: Offer | 'new'
  partners: Partner[]
  onSaved: () => void
}) {
  const { t } = useI18n()
  const isNew = offer === 'new'
  const existing = offer !== 'new' ? offer : null

  const [title, setTitle] = React.useState(existing?.title ?? '')
  const [description, setDescription] = React.useState(existing?.description ?? '')
  const [partnershipId, setPartnershipId] = React.useState('')
  const [limit, setLimit] = React.useState(
    existing?.redemptionLimit ? String(existing.redemptionLimit) : ''
  )
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save() {
    if (!businessId) return
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/network', {
        action: 'upsert_offer',
        businessId,
        id: existing?.id ?? null,
        partnershipId: partnershipId || null,
        title: title.trim(),
        description: description.trim() || null,
        redemptionLimit: limit ? Number(limit) : null,
        perCustomerLimit: 1,
        isActive: true,
      })
      onSaved()
    } catch (cause) {
      setError(toastError(cause, t, 'common.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{isNew ? t('network.offerTitle') : t('network.offerEditTitle')}</SheetTitle>
        <SheetDescription>{t('network.offerSubtitle')}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-4 px-4 pb-8">
        {error && (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="offer-title">{t('network.offerLabel')}</Label>
          <Input
            id="offer-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('network.offerPlaceholder')}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="offer-description">{t('network.offerDetails')}</Label>
          <Textarea
            id="offer-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('network.offerDetailsPlaceholder')}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="offer-partner">{t('network.whoCanClaim')}</Label>
          <select
            id="offer-partner"
            value={partnershipId}
            onChange={(event) => setPartnershipId(event.target.value)}
            className="h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{t('network.anyPartner')}</option>
            {partners.map((partner) => (
              <option key={partner.partnershipId} value={partner.partnershipId}>
                {t('network.onlyPartner', { name: partner.partnerName })}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="offer-limit">
            {t('network.totalClaims')} ({t('common.optional').toLocaleLowerCase(t.tag)})
          </Label>
          <Input
            id="offer-limit"
            type="number"
            min={1}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            placeholder={t('network.totalClaimsPlaceholder')}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">{t('network.totalClaimsHint')}</p>
        </div>

        <Button
          className="h-11 w-full gap-2"
          disabled={busy || !title.trim()}
          onClick={() => void save()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {isNew ? t('network.publishOffer') : t('common.saveChanges')}
        </Button>
      </div>
    </>
  )
}
