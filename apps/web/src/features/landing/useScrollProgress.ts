import { useEffect, useRef, useState, type RefObject } from 'react'
import { chapterAt } from './story'

/**
 * Tracks how far the reader has scrolled through the story track (0..1).
 * The continuous value lives in a ref and CSS variables (`--story-p`, `--chapter-p`) so the page
 * doesn't re-render on every scroll event; React state changes only when the chapter changes.
 */
export function useScrollProgress(
  track: RefObject<HTMLElement | null>,
  stage: RefObject<HTMLElement | null>,
  onProgress: () => void,
) {
  const progress = useRef(0)
  const [chapter, setChapter] = useState(0)
  const callback = useRef(onProgress)
  callback.current = onProgress

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const el = track.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const scrollable = Math.max(1, rect.height - window.innerHeight)
      const p = Math.min(1, Math.max(0, -rect.top / scrollable))
      progress.current = p
      const { index, local } = chapterAt(p)
      stage.current?.style.setProperty('--story-p', p.toFixed(4))
      stage.current?.style.setProperty('--chapter-p', local.toFixed(4))
      setChapter((current) => (current === index ? current : index))
      callback.current()
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [track, stage])

  return { progress, chapter }
}
