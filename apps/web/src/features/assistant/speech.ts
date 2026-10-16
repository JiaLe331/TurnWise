import { useCallback, useEffect, useRef, useState } from 'react'

/** The parts of the Web Speech API used here; browsers ship it prefixed or not at all (Firefox). */
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Hold-to-talk dictation. `interim` follows the words as they're heard; `onFinal` gets the result on release. */
export function useSpeechInput(onFinal: (text: string) => void) {
  const [supported] = useState(() => recognitionCtor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const heard = useRef('')
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor || rec.current) return
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = navigator.language || 'en-US'
    heard.current = ''
    r.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript
      heard.current = text
      setInterim(text)
    }
    r.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone blocked. Allow it in the browser to talk.')
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError("Didn't catch that. Try again or type.")
      }
    }
    r.onend = () => {
      rec.current = null
      setListening(false)
      setInterim('')
      const text = heard.current.trim()
      if (text) finalRef.current(text)
    }
    setError(null)
    setListening(true)
    rec.current = r
    r.start()
  }, [])

  const stop = useCallback(() => rec.current?.stop(), [])

  useEffect(() => () => rec.current?.abort(), [])

  return { supported, listening, interim, error, start, stop }
}

/** Speaks an answer, replacing anything already being read. Markdown markers are dropped. */
export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
  utterance.lang = navigator.language || 'en-US'
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

const READ_ALOUD_KEY = 'turnwise.readAloud'

/** Whether finished answers are read out; remembered per browser. */
export function useReadAloud(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(READ_ALOUD_KEY) === 'true'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOn(next)
    if (!next) stopSpeaking()
    try {
      localStorage.setItem(READ_ALOUD_KEY, String(next))
    } catch {
      // Storage blocked (private window); the toggle still works for this visit.
    }
  }, [])
  return [on, set]
}
