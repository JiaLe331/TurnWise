import { ArrowDown, ChevronsDown, Info, ScanEye, UserCheck } from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo, useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { Logo } from '@/components/brand/Logo'
import { illustrativeLayout } from '@/features/floor-scene/layout'
import { sampleFloor, STORY_TABLE } from '@/features/landing/sample'
import { chapterCentre, CHAPTERS, STEP_CHAPTERS, type Chapter } from '@/features/landing/story'
import { useScrollProgress } from '@/features/landing/useScrollProgress'
import { TableTag } from '@/features/table/TableTag'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { STATE } from '@/lib/domain/status'
import { useIdentity } from '@/lib/identity/dev-identity'
import { useMediaQuery, usePrefersReducedMotion } from '@/lib/use-media'

const StoryScene = lazy(() => import('@/features/landing/StoryScene'))

const ROLES = [
  {
    href: '/host',
    persona: 'host-1',
    title: 'Host',
    body: 'See which tables are ready, which are being cleared, and how long each party has been seated.',
  },
  {
    href: '/staff',
    persona: 'staff-ana',
    title: 'Floor staff',
    body: 'Work the clearing queue in order: claim a table, start cleaning, mark it ready.',
  },
  {
    href: '/manager',
    persona: 'manager-1',
    title: 'Manager',
    body: 'Review exceptions, block a table, or correct a state with a recorded reason.',
  },
]

/** Clearing order on the sample floor: oldest departure first, as the API ranks it. */
function queueOrder(entries: TableBoardEntry[]): Map<string, number> {
  const queued = entries
    .filter((e) => e.task && e.session.departed_at)
    .sort((a, b) => Date.parse(a.session.departed_at!) - Date.parse(b.session.departed_at!))
  return new Map(queued.map((e, i) => [e.table.table_id, i + 1]))
}

export default function Landing() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const reducedMotion = usePrefersReducedMotion()
  const track = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const invalidate = useRef<() => void>(() => {})
  const registerInvalidate = useCallback((fn: () => void) => {
    invalidate.current = fn
  }, [])
  const { progress, chapter: chapterIndex } = useScrollProgress(track, stage, () => invalidate.current())

  const chapter = CHAPTERS[chapterIndex]
  const entries = useMemo(() => sampleFloor(chapter.storyState), [chapter.storyState])
  const layout = useMemo(() => illustrativeLayout(sampleFloor('occupied')), [])
  const order = useMemo(() => queueOrder(entries), [entries])
  const tagEls = useRef(new Map<string, HTMLElement>())
  const now = Date.now()

  // On phones the wide shots are too small for twelve labels; only the clearing-order step keeps them.
  const tagged =
    chapter.tags === 'all' && wide
      ? entries
      : chapter.tags === 'queue'
        ? entries.filter((e) => order.has(e.table.table_id) && !(chapter.callout && e.table.table_id === STORY_TABLE))
        : []
  const tagKey = [chapter.id, ...tagged.map((e) => e.table.table_id), chapter.callout ? `${STORY_TABLE}#note` : ''].join(',')

  const scrollToChapter = (index: number) => {
    const el = track.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const scrollable = el.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + chapterCentre(index) * scrollable, behavior: reducedMotion ? 'auto' : 'smooth' })
  }
  const skipStory = () =>
    document.getElementById('roles')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })

  return (
    <div className="min-h-full bg-linen">
      <header className="fixed inset-x-0 top-0 z-30 flex h-[72px] items-center gap-6 bg-linen/90 px-5 lg:px-16">
        <Logo className="text-[23px]" />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => scrollToChapter(1)}
          className="hidden text-[15px] font-semibold text-ink hover:underline sm:inline"
        >
          How a table turns
        </button>
        <a href="#roles" className="hidden text-[15px] font-semibold text-ink no-underline hover:underline sm:inline">
          For your team
        </a>
        <Link
          href="/staff"
          className="rounded-[10px] bg-ink px-4 py-2.5 text-[15px] font-bold whitespace-nowrap text-white no-underline hover:bg-[#2a3a49]"
        >
          <span className="sm:hidden">Open demo</span>
          <span className="hidden sm:inline">Open the demo floor</span>
        </Link>
      </header>

      {/* Screen readers get the story as a plain ordered list; the stage below is visual. */}
      <ol className="sr-only" aria-label="How a table turns, following one table">
        {STEP_CHAPTERS.map((c) => (
          <li key={c.id}>
            {c.step!.title}. {c.step!.body} {c.concept ? 'This step is a concept: AI detection is not built yet.' : ''}
          </li>
        ))}
      </ol>

      <section ref={track} aria-label="How a table turns" className="relative" style={{ height: wide ? '700vh' : '600vh' }}>
        <div
          ref={stage}
          className="sticky top-0 h-dvh overflow-hidden"
          style={{ ['--story-p' as string]: 0, ['--chapter-p' as string]: 0 }}
        >
          <Suspense fallback={null}>
            <StoryScene
              layout={layout}
              entries={entries}
              chapterIndex={chapterIndex}
              progress={progress}
              wide={wide}
              reducedMotion={reducedMotion}
              tagEls={tagEls}
              tagKey={tagKey}
              registerInvalidate={registerInvalidate}
            />
          </Suspense>

          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {tagged.map((entry) => (
              <div
                key={entry.table.table_id}
                ref={(el) => {
                  if (el) tagEls.current.set(entry.table.table_id, el)
                  else tagEls.current.delete(entry.table.table_id)
                }}
                className="absolute top-0 left-0"
                style={{ visibility: 'hidden' }}
              >
                <TableTag
                  entry={entry}
                  serverNow={now}
                  compact={chapter.tags !== 'queue'}
                  order={chapter.tags === 'queue' ? order.get(entry.table.table_id) : undefined}
                  tabIndex={-1}
                  className="animate-[fade-in_250ms_ease-out]"
                />
              </div>
            ))}
            {chapter.callout ? (
              <div
                key={chapter.id}
                ref={(el) => {
                  if (el) tagEls.current.set(`${STORY_TABLE}#note`, el)
                  else tagEls.current.delete(`${STORY_TABLE}#note`)
                }}
                className="absolute top-0 left-0 size-0"
                style={{ visibility: 'hidden' }}
              >
                <StoryCallout chapter={chapter} wide={wide} />
              </div>
            ) : null}
          </div>

          <ConceptChip />
          <Hero visible={chapterIndex === 0} onStart={() => scrollToChapter(1)} />
          {chapter.step ? (
            <ChapterCard chapter={chapter} chapterIndex={chapterIndex} onJump={scrollToChapter} onSkip={skipStory} />
          ) : null}
          {chapter.id === 'outro' ? <OutroPanel /> : null}
        </div>
      </section>

      <section id="roles" className="mx-auto max-w-[1180px] scroll-mt-20 px-5 pt-16 pb-12 lg:px-16" aria-labelledby="roles-title">
        <h2 id="roles-title" className="m-0 font-serif text-[34px] font-normal">
          One floor, three ways in
        </h2>
        <p className="mt-2 mb-7 max-w-[560px] text-[16px] leading-relaxed text-pewter">
          Each role sees the same tables and only the actions it can take. Pick one to open the demo floor.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {ROLES.map((role) => (
            <RoleEntry key={role.href} {...role} />
          ))}
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 border-t border-rule px-5 py-6 text-[13.5px] text-pewter lg:px-16">
        <Logo className="text-[17px] text-ink" />
        <span className="order-last basis-full sm:order-none sm:basis-0 sm:flex-1">
          Demo build. Seeded data resets when the API restarts.
        </span>
        <span className="flex-1 sm:hidden" />
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })}
          className="inline-flex items-center gap-1 font-semibold text-ink"
        >
          <ArrowDown className="size-4 rotate-180" aria-hidden />
          Back to top
        </button>
      </footer>
    </div>
  )
}

function ConceptChip() {
  return (
    <p className="pointer-events-none absolute top-[84px] right-4 z-10 m-0 hidden items-center gap-1.5 rounded-[9px] border border-rule bg-white/90 px-2.5 py-1.5 text-[12.5px] font-semibold text-pewter sm:flex lg:right-16">
      <Info className="size-3.5" aria-hidden />
      Concept walkthrough on a sample floor
    </p>
  )
}

function Hero({ visible, onStart }: { visible: boolean; onStart: () => void }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      style={{ opacity: 'clamp(0, calc((0.1 - var(--story-p)) * 28), 1)' }}
      aria-hidden={!visible}
    >
      <div className={cn('px-5 pt-[96px] lg:absolute lg:top-[150px] lg:left-16 lg:w-[470px] lg:p-0', visible && 'pointer-events-auto')}>
        <h1 className="m-0 font-serif text-[40px] leading-[1.04] font-normal tracking-[-0.01em] sm:text-[48px] lg:text-[66px]">
          Every table turn, handed off cleanly.
        </h1>
        <p className="mt-5 mb-6 text-[16.5px] leading-relaxed font-medium text-[#46535e] lg:mt-6 lg:mb-7 lg:text-[18.5px]">
          TurnWise uses the cameras you already have to notice tables that look finished, then hands the work to people.
          Staff confirm the departure, clear the table and mark it ready. Hosts see it the moment it is.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/staff"
            tabIndex={visible ? undefined : -1}
            className="inline-flex h-12 items-center rounded-[10px] bg-ink px-5 text-[16px] font-bold text-white no-underline hover:bg-[#2a3a49]"
          >
            Open the demo floor
          </Link>
          <button
            type="button"
            tabIndex={visible ? undefined : -1}
            onClick={onStart}
            className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-[#c9d0ca] bg-white px-5 text-[16px] font-bold text-ink hover:bg-wash"
          >
            <ChevronsDown className="size-4" aria-hidden />
            Follow one table
          </button>
        </div>
        <p className="mt-4 hidden items-start gap-2 text-[14px] leading-normal font-medium text-pewter sm:flex">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          The demo runs on seeded tables. Camera detection is in development.
        </p>
      </div>
      <p className="absolute bottom-6 left-1/2 m-0 flex -translate-x-1/2 items-center gap-2 text-[14px] font-semibold whitespace-nowrap text-pewter">
        <ArrowDown className="size-4 animate-bounce motion-reduce:animate-none" aria-hidden />
        Scroll to follow one table
      </p>
    </div>
  )
}

function ChapterCard({
  chapter,
  chapterIndex,
  onJump,
  onSkip,
}: {
  chapter: Chapter
  chapterIndex: number
  onJump: (index: number) => void
  onSkip: () => void
}) {
  const step = chapter.step!
  const style = STATE[chapter.storyState]
  return (
    <div className="absolute inset-x-3 bottom-3 z-20 sm:inset-x-auto sm:bottom-10 sm:left-6 sm:w-[400px] lg:left-16">
      <div
        key={chapter.id}
        className="rounded-[16px] border border-rule bg-white p-4 shadow-[var(--shadow-float)] animate-[fade-in_250ms_ease-out] sm:p-5"
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
            style={{ background: style.solid }}
          >
            {step.number}
          </span>
          <h2 className="m-0 font-serif text-[24px] leading-tight font-normal sm:text-[27px]">{step.title}</h2>
          <span className="tabular ml-auto shrink-0 text-[13px] font-semibold text-pewter">{step.number} of 5</span>
        </div>
        <p className="mt-2.5 mb-0 text-[15px] leading-relaxed text-[#46535e]">{step.body}</p>
        {chapter.concept ? (
          <p className="mt-3 mb-0 inline-flex items-center gap-1.5 rounded-md border border-dashed border-review bg-review-tint px-2 py-1 text-[12.5px] font-semibold text-review-deep">
            <ScanEye className="size-3.5" aria-hidden />
            Concept. AI detection isn't built yet.
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-3">
          <ol className="m-0 flex flex-1 list-none gap-1 p-0" aria-label="Steps">
            {STEP_CHAPTERS.map((c) => {
              const index = CHAPTERS.indexOf(c)
              const fill =
                index < chapterIndex
                  ? '100%'
                  : index === chapterIndex
                    ? 'clamp(8%, calc(var(--chapter-p) * 100%), 100%)'
                    : '0%'
              return (
                <li key={c.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => onJump(index)}
                    aria-label={`Step ${c.step!.number}: ${c.step!.title}`}
                    aria-current={index === chapterIndex ? 'step' : undefined}
                    className="group flex h-6 w-full items-center"
                  >
                    <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-wash group-hover:bg-rule">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: fill, background: STATE[c.storyState].solid }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <button type="button" onClick={onSkip} className="shrink-0 text-[13px] font-semibold text-pewter hover:text-ink hover:underline">
            Skip the story
          </button>
        </div>
      </div>
    </div>
  )
}

/** The card that floats beside the story table. Dashed for a camera suggestion, solid for staff. */
function StoryCallout({ chapter, wide }: { chapter: Chapter; wide: boolean }) {
  const callout = chapter.callout!
  const camera = callout.source === 'camera'
  const style = STATE[chapter.storyState]
  // Phones have no room to the left of the table, so callouts always open to the right there.
  const left = callout.side === 'left' && wide
  return (
    <div
      className={cn(
        'absolute bottom-[16px] animate-[fade-in_300ms_ease-out]',
        wide ? 'w-[270px]' : 'w-[210px]',
        left ? (wide ? 'right-[-20px]' : 'right-[-24px]') : wide ? 'left-[-20px]' : 'left-[-24px]',
      )}
    >
      <div
        className={cn(
          'rounded-xl bg-white px-3.5 py-3 text-[13.5px] leading-snug font-medium text-pewter shadow-[0_12px_30px_rgb(27_39_51/0.16)]',
          camera ? 'border-2 border-dashed border-review' : 'border border-rule',
        )}
      >
        <b className="mb-1 flex items-center gap-2 text-[15px] text-ink">
          <span className="font-serif text-[18px] font-normal">{STORY_TABLE}</span>
          {callout.title}
        </b>
        {wide ? callout.text : null}
        {camera ? (
          <span className="mt-2.5 block">
            <span className="mb-1 flex justify-between text-[11.5px] font-semibold text-review-deep">
              <span>Empty seats</span>
              <span>{wide ? '30 s to suggest a check' : '30 s'}</span>
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-review-tint">
              <span
                className="block h-full rounded-full bg-review"
                style={{ width: 'clamp(0%, calc((var(--chapter-p) - 0.12) / 0.55 * 100%), 100%)' }}
              />
            </span>
          </span>
        ) : null}
        {chapter.id === 'confirm' ? (
          <span className="mt-2.5 flex items-center justify-center gap-2 rounded-lg bg-ink py-2 text-[13.5px] font-bold text-white">
            <UserCheck className="size-4" aria-hidden />
            Departure confirmed
          </span>
        ) : null}
        {callout.source ? (
          <span
            className="mt-2 flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold"
            style={
              camera
                ? { background: 'var(--color-review-tint)', color: 'var(--color-review-deep)' }
                : { background: 'var(--color-ready-tint)', color: 'var(--color-ready-deep)' }
            }
          >
            {camera ? <ScanEye className="size-3.5" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}
            {camera ? 'Camera suggestion (concept)' : 'Staff confirmed'}
          </span>
        ) : null}
      </div>
      <span
        className={cn('absolute -bottom-[16px] h-[16px] border-l-2', left ? 'right-[20px]' : 'left-[20px]')}
        style={{ borderColor: style.solid }}
        aria-hidden
      />
      <span
        className={cn('absolute -bottom-[20px] size-[10px] rounded-full border-2 border-white', left ? 'right-[16px]' : 'left-[16px]')}
        style={{ background: style.solid }}
        aria-hidden
      />
    </div>
  )
}

function OutroPanel() {
  return (
    <div className="absolute inset-x-3 bottom-3 z-20 sm:inset-x-auto sm:bottom-12 sm:left-1/2 sm:w-[560px] sm:-translate-x-1/2">
      <div className="rounded-[18px] border border-rule bg-white p-5 text-center shadow-[var(--shadow-float)] animate-[fade-in_300ms_ease-out] sm:p-7">
        <h2 className="m-0 font-serif text-[30px] font-normal sm:text-[36px]">That's one turn.</h2>
        <p className="mx-auto mt-2 mb-5 max-w-[420px] text-[15.5px] leading-relaxed text-[#46535e]">
          TurnWise follows every table on the floor like this, and shows each role only what it can act on.
        </p>
        <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link
            href="/staff"
            className="inline-flex h-12 w-full items-center justify-center rounded-[10px] bg-ink px-5 text-[16px] font-bold text-white no-underline hover:bg-[#2a3a49] sm:w-auto"
          >
            Open the demo floor
          </Link>
          <Link href="/host" className="inline-flex h-12 items-center rounded-[10px] px-4 text-[15px] font-semibold text-ink no-underline hover:bg-wash">
            Host view
          </Link>
          <Link href="/manager" className="inline-flex h-12 items-center rounded-[10px] px-4 text-[15px] font-semibold text-ink no-underline hover:bg-wash">
            Manager view
          </Link>
        </div>
      </div>
    </div>
  )
}

function RoleEntry({ href, persona, title, body }: (typeof ROLES)[number]) {
  const { setActorId } = useIdentity()
  const [, navigate] = useLocation()
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (import.meta.env.DEV) setActorId(persona)
        navigate(href)
      }}
      className="group flex flex-col rounded-[14px] border border-rule bg-white p-5 text-ink no-underline hover:border-ink"
    >
      <span className="text-[18px] font-bold">{title}</span>
      <span className="mt-1.5 mb-4 flex-1 text-[14.5px] leading-relaxed text-pewter">{body}</span>
      <span className="text-[15px] font-bold group-hover:underline">Open the {title.toLowerCase()} view</span>
    </a>
  )
}
