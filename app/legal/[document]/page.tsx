import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator, formatDate } from '@/lib/i18n/translate'
import {
  LEGAL_DOCUMENTS,
  getLegalContent,
  isLegalDocument,
  type LegalDocument,
} from '@/lib/legal/documents'

/**
 * The legal pages.
 *
 * A server component, so several thousand words in two languages never reach a
 * visitor's JavaScript bundle. Only the rendered locale crosses the wire.
 *
 * These exist because the footer linked to them and they returned 404 — which, on a page
 * whose entire argument is that we do not fabricate anything, was the most expensive
 * broken link on the site. The content is written from what the code actually does
 * (see `lib/legal/documents.ts` for the traceability), because a policy describing
 * behaviour this product does not have would be a worse credibility problem than the
 * missing page it replaced.
 */

export function generateStaticParams(): Array<{ document: LegalDocument }> {
  return LEGAL_DOCUMENTS.map((document) => ({ document }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>
}): Promise<Metadata> {
  const { document } = await params
  if (!isLegalDocument(document)) return {}

  const locale = await getLocale()
  const content = getLegalContent(document, locale)
  const t = createTranslator(locale)

  return {
    title: `${content.title} — ${t('common.appName')}`,
    description: content.intro,
    // Legal pages are not what we want ranking for the product, and duplicate
    // language variants competing with each other helps nobody.
    robots: { index: true, follow: true },
  }
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ document: string }>
}) {
  const { document } = await params
  if (!isLegalDocument(document)) notFound()

  const locale = await getLocale()
  const t = createTranslator(locale)
  const content = getLegalContent(document, locale)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-lg font-bold tracking-tight">{t('common.appName')}</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('common.back')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{content.title}</h1>

        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {content.intro}
        </p>

        <p className="mt-4 text-sm text-muted-foreground">
          {formatDate(content.updated, locale)}
        </p>

        {/* The disclaimer is at the top, not buried at the bottom. A reader who
            stops after the first screen should already know what this is. */}
        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{content.disclaimer}</p>
        </div>

        <div className="mt-10 space-y-10">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>

              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-pretty leading-relaxed text-muted-foreground">
                  <Emphasised text={paragraph} />
                </p>
              ))}

              {section.bullets && (
                <ul className="mt-4 space-y-2.5">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 leading-relaxed text-muted-foreground">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                      <span className="text-pretty">
                        <Emphasised text={bullet} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <nav className="mt-14 flex flex-wrap gap-x-6 gap-y-2 border-t pt-8 text-sm">
          {LEGAL_DOCUMENTS.filter((candidate) => candidate !== document).map((candidate) => (
            <Link
              key={candidate}
              href={`/legal/${candidate}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {getLegalContent(candidate, locale).title}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  )
}

/**
 * Renders `**bold**` spans.
 *
 * A deliberately tiny subset of Markdown rather than a parser dependency: the only
 * inline formatting these documents need is emphasis on the handful of phrases a reader
 * skimming for the important part would want to find, and `dangerouslySetInnerHTML` over
 * prose is not a trade worth making for that.
 */
function Emphasised({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={index} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </>
  )
}
