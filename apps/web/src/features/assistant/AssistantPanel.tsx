import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { ArrowUp, Copy, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { OUTLET_ID } from '@/config'
import { currentApiScope } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { AnswerText, BarChart, LookupChip, lookupLabel } from './parts'
import type { AssistantMessage } from './types'

const SUGGESTIONS = ['How did tonight go?', 'What should we change?', 'Why did parties wait?']
const MAX_LENGTH = 500

function textOf(message: AssistantMessage): string {
  return message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()
}

/** The manager's shift assistant: a streaming chat over the shift record, via the AI SDK. */
export function AssistantPanel({ className }: { className?: string }) {
  const [input, setInput] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const { messages, sendMessage, status, error, regenerate, clearError } = useChat<AssistantMessage>({
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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })
  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, status])

  function ask(text: string, spoken = false) {
    const question = text.trim().slice(0, MAX_LENGTH)
    if (!question || busy) return
    clearError()
    void sendMessage({ text: question, metadata: { spoken } })
    setInput('')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    ask(input)
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="text-[12.5px] text-pewter">Tonight, last 12 hours</span>
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
            <div key={m.id} className="ml-auto max-w-[85%] rounded-[14px_14px_4px_14px] bg-ink px-3 py-2 text-[14px] leading-snug text-white">
              {textOf(m)}
            </div>
          ) : (
            <AssistantTurn key={m.id} message={m} done={!busy || m.id !== messages.at(-1)?.id} />
          ),
        )}

        {status === 'submitted' ? <p className="m-0 text-[13px] text-pewter">Looking at the shift…</p> : null}
        {error ? (
          <div className="rounded-lg border border-clearing/30 bg-clearing-tint px-3 py-2 text-[13px] text-clearing-deep">
            {error.message.includes('Gemini') ? error.message : 'The assistant could not answer. Gemini may be busy.'}{' '}
            <button type="button" onClick={() => void regenerate()} className="inline-flex items-center gap-1 font-semibold underline">
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the shift"
            aria-label="Ask the shift assistant"
            maxLength={MAX_LENGTH}
            className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-rule text-ink hover:bg-wash disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        </div>
      </form>
    </div>
  )
}

function AssistantTurn({ message, done }: { message: AssistantMessage; done: boolean }) {
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
        return null
      })}
      {done && text ? (
        <div className="flex gap-3 text-[11.5px] text-pewter">
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
