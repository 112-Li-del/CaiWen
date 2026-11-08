'use client'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { X, Send, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import EmotionBall from '@/components/chat/EmotionBall'
import { apiFetch, apiUrl } from '@/lib/api'
import type { Overview } from './types'
import { usePortraitSelection } from './PortraitSelection'

export default function PortraitAssistant({
  data,
  days = 30,
}: {
  data?: Overview | null
  days?: number
}) {
  const { teacherId } = usePortraitSelection()
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [answer, setAnswer] = useState(''),
    [error, setError] = useState(''),
    [question, setQuestion] = useState('')
  const [pokeSignal, setPokeSignal] = useState(0)
  const pointerStart = useRef({ x: 0, y: 0 })
  const bounds = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    close = useRef<HTMLButtonElement>(null),
    dragged = useRef(false),
    controller = useRef<AbortController | null>(null)
  const animation = useAnimationControls(),
    reduced = useReducedMotion()
  const key = JSON.stringify([
    data?.dimension,
    data?.student_id,
    data?.class_id,
    data?.semester.id,
    data?.revision,
    data?.board.mode,
    days,
    teacherId,
  ])
  useEffect(() => {
    controller.current?.abort()
    setBusy(false)
    setAnswer('')
    setError('')
    setQuestion('')
    return () => controller.current?.abort()
  }, [key])
  useEffect(() => {
    if (!open) return
    close.current?.focus()
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  async function analyze() {
    if (!data || busy) return
    const ctrl = new AbortController()
    controller.current = ctrl
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch(apiUrl('/api/v1/portrait/analysis'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          semester_id: data.semester.id,
          dimension: data.dimension,
          student_id: data.dimension === 'student' ? data.student_id : null,
          class_id: data.dimension === 'class' ? data.class_id : null,
          teacher_id: teacherId,
          board_mode: data.board.mode,
          days,
          ...(question.trim() ? { question: question.trim() } : {}),
        }),
      })
      const result = await res.json()
      if (!res.ok)
        throw Error(typeof result.detail === 'string' ? result.detail : '分析失败，请重试')
      if (!ctrl.signal.aborted) setAnswer(result.response)
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : '网络连接失败，请重试')
    } finally {
      if (!ctrl.signal.aborted) setBusy(false)
    }
  }
  return (
    <>
      <div ref={bounds} className="pointer-events-none fixed inset-x-3 bottom-3 top-24 z-40">
        <motion.button
          ref={trigger}
          type="button"
          aria-label="打开财宝学情分析"
          aria-expanded={open}
          aria-controls="portrait-assistant"
          drag
          dragConstraints={bounds}
          dragElastic={0.18}
          dragMomentum={false}
          animate={animation}
          onPointerDown={event => {
            dragged.current = false
            pointerStart.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerMoveCapture={event => {
            if (
              event.buttons &&
              Math.hypot(
                event.clientX - pointerStart.current.x,
                event.clientY - pointerStart.current.y
              ) > 6
            )
              dragged.current = true
          }}
          onDragStart={() => {
            dragged.current = true
          }}
          onDrag={(_, info) => {
            if (!reduced)
              void animation.start({
                scaleX: 1 + Math.min(Math.abs(info.velocity.x) / 5000, 0.18),
                scaleY: 1 - Math.min(Math.abs(info.velocity.x) / 7000, 0.12),
                rotate: Math.max(-12, Math.min(12, info.velocity.x / 90)),
                transition: { duration: 0.1 },
              })
          }}
          onDragEnd={() => {
            void animation.start({
              scaleX: 1,
              scaleY: 1,
              rotate: 0,
              transition: { type: 'spring', stiffness: 330, damping: 12 },
            })
          }}
          onClick={event => {
            if (dragged.current && event.detail !== 0) return
            setPokeSignal(value => value + 1)
            setOpen(v => !v)
          }}
          className="pointer-events-auto absolute right-2 top-2 touch-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          style={{ width: 92, height: 92 }}
        >
          <span className="pointer-events-none block [&_.cw-ball-tip]:hidden">
            <EmotionBall
              size={82}
              emotion={busy ? '10' : '01'}
              pokeOnClick={false}
              pokeSignal={pokeSignal}
            />
          </span>
          <span className="absolute inset-x-0 -bottom-1 text-center text-[10px] font-medium text-[var(--muted-foreground)]">
            财宝 · 学情分析
          </span>
        </motion.button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            key="analysis-panel"
            className="fixed right-4 top-52 z-50 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl shadow-xl"
            style={{ transformOrigin: 'top right' }}
            initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: reduced ? 0 : 8,
              scale: reduced ? 1 : 0.98,
              transition: { duration: reduced ? 0 : 0.14 },
            }}
            transition={{ duration: reduced ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <section
              inert={!open}
              id="portrait-assistant"
              role="dialog"
              aria-label="财宝学情分析"
              className="relative flex max-h-[min(660px,calc(100dvh-14rem))] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] p-4">
                <div>
                  <h2 className="font-semibold">财宝 · 学情分析</h2>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {data ? `${data.title} · ${data.semester.name}` : '等待当前画像加载'}
                  </p>
                </div>
                <button
                  ref={close}
                  aria-label="关闭分析"
                  onClick={() => {
                    setOpen(false)
                    trigger.current?.focus()
                  }}
                  className="rounded-lg p-2 hover:bg-[var(--muted)]"
                >
                  <X size={18} />
                </button>
              </header>
              <div className="min-h-0 overflow-y-auto p-5" aria-busy={busy}>
                <p className="text-sm leading-7">
                  需要我帮你分析一下吗？我会结合当前{data?.dimension === 'class' ? '班级' : '学生'}
                  的成绩与行为记录，看看优势和可以改进的地方。
                </p>
                {!data && (
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    请先选择有数据的学生或班级画像。教师档案可点击分管班级进入分析。
                  </p>
                )}
                {answer && (
                  <div className="mt-5 space-y-3 text-sm leading-7 [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                    <ReactMarkdown>{answer}</ReactMarkdown>
                  </div>
                )}
                {busy && (
                  <p role="status" className="mt-4 text-sm text-[var(--primary)]">
                    正在结合当前记录分析…
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-4 text-sm text-[var(--destructive)]">
                    {error}
                  </p>
                )}
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void analyze()
                }}
                className="border-t border-[var(--border)] bg-[var(--card)] p-4"
              >
                <label
                  htmlFor="portrait-question"
                  className="text-xs text-[var(--muted-foreground)]"
                >
                  也可以告诉我你想重点了解什么
                </label>
                <textarea
                  id="portrait-question"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="例如：我该优先复习哪些课程？"
                  className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm"
                />
                <button
                  disabled={!data || busy}
                  type="submit"
                  className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {answer ? <RotateCcw size={14} /> : <Send size={14} />}{' '}
                  {busy ? '分析中…' : answer ? '重新分析' : '帮我分析一下'}
                </button>
                <p className="mt-3 text-[10px] leading-5 text-[var(--muted-foreground)]">
                  AI 分析仅供参考，以学校档案和老师建议为准。切换对象后会清空本次分析。
                </p>
              </form>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
