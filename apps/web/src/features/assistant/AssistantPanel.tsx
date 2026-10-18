import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { ArrowUp, Copy, Mic, RotateCcw, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { OUTLET_ID } from '@/config'
import { currentApiScope } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { AnswerText, BarChart, LookupChip, lookupLabel } from './parts'
import { speak, useReadAloud, useSpeechInput } from './speech'
import { ProposalCard } from './ProposalCard'
import type { AssistantMessage, ProposalOutcome } from './types'

const SUGGESTIONS = ['How did tonight go?', 'What should we change?', 'Why did parties wait?']
const MAX_LENGTH = 500

/**
 * Continue only once the manager has answered a proposal. Server tools (lookups, charts) arrive
 * with their results, so resending after those would ask the model about its own finished answer.
 */
function proposalAnswered({ messages }: { messages: AssistantMessage[] }): boolean {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return false
  const step = last.parts.slice(last.parts.map((p) => p.type).lastIndexOf('step-start') + 1)
  return (
    step.some((p) => p.type === 'tool-propose_action' && p.state === 'output-available') &&
    lastAssistantMessageIsCompleteWithToolCalls({ messages })
  )
}

function textOf(message: AssistantMessage): string {
  return message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()
}

/** The manager's shift assistant: a streaming chat over the shift record, via the AI SDK. */
export function AssistantPanel({ className }: { className?: string }) {
  const [input, setInput] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const { messages, sendMessage, status, error, regenerate, clearError, addToolOutput } = useChat<AssistantMessage>({
    transport: new DefaultChatTransport({
      // The scope (live outlet or a replay session) is read when each request is sent.
      prepareSendMessagesRequest: ({ messages }) => {
        const scope = currentApiScope()
        return {
          api: `${scope.base}/outlets/${OUTLET_ID}/assistant`,
          headers: scope.headers,
          body: { messages: messages.slice(-24) },
        }
      },
    }),
    sendAutomaticallyWhen: proposalAnswered,
  })
  const busy = status === 'submitted' || status === 'streaming'
  const [readAloud, setReadAloud] = useReadAloud()
  const voice = useSpeechInput((text) => ask(text, true))
  const wasBusy = useRef(false)

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, status])

  // Read each finished answer once, when the toggle is on.
  useEffect(() => {
    const last = messages.at(-1)
    if (wasBusy.current && status === 'ready' && readAloud && last?.role === 'assistant') {
      const text = textOf(last)
      if (text) speak(text)
    }
    wasBusy.current = busy
  }, [status, busy, messages, readAloud])

  function ask(text: string, spoken = false) {
    const question = text.trim().slice(0, MAX_LENGTH)
    if (!question || busy) return
    clearError()
    void sendMessage({ text: question, metadata: { spoken } })
    setInput('')
  }

  // After a confirmed or declined proposal, continue from it; regenerating would propose it again.
  function retry() {
    const last = messages.at(-1)
    const settled = last?.role === 'assistant' && last.parts.some((p) => p.type === 'tool-propose_action' && p.state === 'output-available')
    clearError()
    void (settled ? sendMessage() : regenerate())
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    ask(input)
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="text-[12.5px] text-pewter">Tonight, last 12 hours</span>
        <button
          type="button"
          role="switch"
          aria-checked={readAloud}
          onClick={() => setReadAloud(!readAloud)}
          className="flex items-center gap-2 text-[12.5px] font-semibold text-pewter hover:text-ink"
        >
          <Volume2 className="size-4" aria-hidden />
          Read answers aloud
          <span className={cn('relative h-[18px] w-[30px] rounded-full transition-colors', readAloud ? 'bg-ink' : 'bg-rule')} aria-hidden>
            <span className={cn('absolute top-[2px] size-[14px] rounded-full bg-white transition-[left]', readAloud ? 'left-[14px]' : 'left-[2px]')} />
          </span>
        </button>
      </div>

      <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="pt-6">
            <p className="m-0 font-serif text-[21px] leading-snug">Ask about tonight's shift.</p>
            <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-pewter">
              Answers come from the shift record. Anything that changes the floor waits for your confirmation.
            </p>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ml-auto w-fit max-w-[85%] rounded-[14px_14px_4px_14px] bg-ink px-3 py-2 text-[14px] leading-snug text-white">
              {textOf(m)}
              {m.metadata?.spoken ? (
                <span className="mt-0.5 flex items-center justify-end gap-1 text-[11.5px] opacity-70">
                  <Mic className="size-3" aria-hidden />
                  Spoken
                </span>
              ) : null}
            </div>
          ) : (
            <AssistantTurn
              key={m.id}
              message={m}
              done={!busy || m.id !== messages.at(-1)?.id}
              onOutcome={(toolCallId, output) => void addToolOutput({ tool: 'propose_action', toolCallId, output })}
            />
          ),
        )}

        {status === 'submitted' ? <p className="m-0 text-[13px] text-pewter">Looking at the shift…</p> : null}
        {error ? (
          <div className="rounded-lg border border-clearing/30 bg-clearing-tint px-3 py-2 text-[13px] text-clearing-deep">
            {error.message.includes('Gemini') ? error.message : 'The assistant could not answer. Gemini may be busy.'}{' '}
            <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-semibold underline">
              <RotateCcw className="size-3.5" aria-hidden />
              Try again
            </button>
          </div>
        ) : null}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-rule px-3 pt-2.5 pb-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => ask(s)}
              className="shrink-0 rounded-full border border-rule px-2.5 py-1 text-[12.5px] whitespace-nowrap hover:bg-wash disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-[#c9d0ca] bg-white py-1.5 pr-1.5 pl-3 focus-within:border-ink">
          <input
            value={voice.listening ? voice.interim : input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={voice.listening ? 'Listening…' : 'Ask about the shift'}
            readOnly={voice.listening}
            aria-label="Ask the shift assistant"
            maxLength={MAX_LENGTH}
            className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
          {voice.supported ? (
            <button
              type="button"
              aria-label={voice.listening ? 'Release to send' : 'Hold to talk'}
              aria-pressed={voice.listening}
              disabled={busy}
              onPointerDown={(e) => {
                e.preventDefault()
                voice.start()
              }}
              onPointerUp={voice.stop}
              onPointerLeave={voice.stop}
              onKeyDown={(e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return
                e.preventDefault()
                if (voice.listening) voice.stop()
                else voice.start()
              }}
              className={cn(
                'flex h-8 shrink-0 touch-none items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold select-none disabled:opacity-40',
                voice.listening ? 'bg-clearing text-white' : 'bg-ink text-white hover:bg-[#2a3a49]',
              )}
            >
              <Mic className="size-4" aria-hidden />
              {voice.listening ? 'Listening' : 'Hold to talk'}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-rule text-ink hover:bg-wash disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        </div>
        {voice.error ? <p className="m-0 mt-1.5 text-[12.5px] text-clearing-deep">{voice.error}</p> : null}
      </form>
    </div>
  )
}

function AssistantTurn({
  message,
  done,
  onOutcome,
}: {
  message: AssistantMessage
  done: boolean
  onOutcome: (toolCallId: string, outcome: ProposalOutcome) => void
}) {
  const lookups = message.parts.flatMap((p) => {
    const label = lookupLabel(p)
    return label && isToolUIPart(p) ? [{ label, done: p.state === 'output-available', id: p.toolCallId }] : []
  })
  const text = textOf(message)

  return (
    <div className="text-[14px] leading-relaxed">
      {lookups.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {lookups.map((l) => (
            <LookupChip key={l.id} label={l.label} done={l.done} />
          ))}
        </div>
      ) : null}
      {message.parts.map((p, i) => {
        if (p.type === 'text') return <AnswerText key={i} text={p.text} />
        if (p.type === 'tool-show_chart' && p.state === 'output-available') return <BarChart key={i} chart={p.output} />
        if (p.type === 'tool-propose_action' && (p.state === 'input-available' || p.state === 'output-available')) {
          return (
            <ProposalCard
              key={p.toolCallId}
              proposal={p.input}
              outcome={p.state === 'output-available' ? p.output : undefined}
              onOutcome={(outcome) => onOutcome(p.toolCallId, outcome)}
            />
          )
        }
        return null
      })}
      {done && text ? (
        <div className="flex gap-3 text-[11.5px] text-pewter">
          <button type="button" onClick={() => speak(text)} className="inline-flex items-center gap-1 hover:text-ink">
            <Volume2 className="size-3.5" aria-hidden />
            Read aloud
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'))}
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            <Copy className="size-3.5" aria-hidden />
            Copy
          </button>
        </div>
      ) : null}
    </div>
  )
}
