import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Bug,
  Camera,
  CircleDot,
  ImagePlus,
  Lightbulb,
  MessageCircle,
  MessageSquarePlus,
  RotateCw,
  Send,
  Trash2,
  X,
} from 'lucide-react'

import { createUuidV7 } from '../domain/id'
import { collectContext, describeContext } from './context'
import { feedbackInbox, type SentReport } from './inbox'
import {
  FEEDBACK_KINDS,
  kindConfig,
  MAX_SCREENSHOTS,
  MAX_STEPS,
  normaliseEmail,
  type FeedbackKind,
  type FeedbackStep,
  type FeedbackSubmission,
} from './report'
import { canCaptureScreen, captureScreen, fitImage, wasDeclined } from './screenshot'
import { sendFeedback } from './send'
import { FEEDBACK_UI_ATTRIBUTE } from './steps'
import { useStepRecorder } from './useStepRecorder'

const KIND_ICONS: Record<FeedbackKind, typeof Bug> = { bug: Bug, idea: Lightbulb, other: MessageCircle }

/*
 * The address is remembered on this machine, like the theme: someone who left it once
 * should not have to type it again for the next report. It is never stored anywhere else
 * until a report carrying it is sent.
 */
const EMAIL_KEY = 'job-applications-tracker:feedback-email'

function readStoredEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeEmail(value: string): void {
  try {
    if (value.trim()) window.localStorage.setItem(EMAIL_KEY, value.trim())
    else window.localStorage.removeItem(EMAIL_KEY)
  } catch {
    // Remembering is a convenience; a browser that refuses it still sends.
  }
}

/*
 * Whether this browser has been told what the screenshot button is about to ask. The
 * browser's own prompt talks about sharing or recording the screen, which is alarming
 * from a button that says Screenshot, and a page cannot reword it. So the first time, the
 * panel says it first. Once is enough: after that the reader knows what the prompt means.
 */
const CAPTURE_EXPLAINED_KEY = 'job-applications-tracker:feedback-capture-explained'

function captureExplained(): boolean {
  try {
    return window.localStorage.getItem(CAPTURE_EXPLAINED_KEY) === '1'
  } catch {
    return false
  }
}

function markCaptureExplained(): void {
  try {
    window.localStorage.setItem(CAPTURE_EXPLAINED_KEY, '1')
  } catch {
    // Then it is explained again next time, which costs a click and nothing else.
  }
}

function CaptureNotice({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div aria-label="Before the screenshot" className="feedback-notice" role="group">
      <p>
        <strong>Your browser will ask to share this tab.</strong> That is the only way a web
        page can take a picture of itself. One picture is taken, then sharing stops at once —
        nothing is recorded, and nothing is sent until you press Send.
      </p>
      <div className="feedback-notice__actions">
        <button className="button button--quiet" onClick={onCancel} type="button">Cancel</button>
        {/* Focused, being the next thing to decide; Escape or Cancel backs out. */}
        <button autoFocus className="button button--primary" onClick={onConfirm} type="button">
          Continue
        </button>
      </div>
    </div>
  )
}

interface Shot {
  id: string
  blob: Blob
  url: string
}

interface RecordedStep extends FeedbackStep {
  id: string
}

interface Draft {
  kind: FeedbackKind
  message: string
  steps: RecordedStep[]
  shots: Shot[]
  /** The page the report was started from, which is what it is about. */
  view: string | null
}

const EMPTY_DRAFT: Draft = { kind: 'bug', message: '', steps: [], shots: [], view: null }

type Mode = 'closed' | 'open' | 'recording'
type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string | null }
  | { kind: 'error'; message: string }

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

interface FeedbackWidgetProps {
  /** Where the reader is now: the view's name, or Prep. */
  where: string
}

/**
 * The way to tell the app's maintainer something, reachable from the topbar on every view.
 *
 * Three states: closed, the panel open, and **recording** — the panel shrunk to a pill so
 * the problem can be shown rather than described, while the steps taken are written down
 * and more screenshots taken from the pill. The panel is not modal: the page behind it
 * stays usable, since the page is the thing being reported on.
 *
 * The panel and the pill are portalled to `body`, above the dialog backdrop, so a problem
 * inside the application editor can be shown and photographed too. Escape, Tab, paste and
 * file drops stop at the panel's edge: the editor's focus trap, the window's import drop
 * and the panel's own Escape would otherwise each answer one key press twice.
 */
export function FeedbackWidget({ where }: FeedbackWidgetProps) {
  const [mode, setMode] = useState<Mode>('closed')
  const [tab, setTab] = useState<'new' | 'sent'>('new')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [email, setEmail] = useState(readStoredEmail)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [fieldError, setFieldError] = useState<{ field: 'message' | 'email' | 'shots'; message: string } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [sent, setSent] = useState<SentReport[]>([])
  const [retrying, setRetrying] = useState<string | null>(null)
  /** Where the note about the browser's prompt is showing, before a first screenshot. */
  const [explaining, setExplaining] = useState<'panel' | 'pill' | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const shotsRef = useRef<Shot[]>([])
  const titleId = useId()
  const hintId = useId()
  const emailHintId = useId()

  useEffect(() => {
    shotsRef.current = draft.shots
  }, [draft.shots])
  // Object URLs outlive the component unless they are let go of.
  useEffect(() => () => shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.url)), [])

  const refreshSent = useCallback(async () => {
    try {
      setSent(await feedbackInbox().list())
    } catch {
      setSent([])
    }
  }, [])

  useStepRecorder(mode === 'recording', (text) => {
    setDraft((current) => {
      if (current.steps.length >= MAX_STEPS) return current
      // A double click, or one field changed twice running, is one step.
      if (current.steps.at(-1)?.text === text) return current
      return {
        ...current,
        steps: [...current.steps, { id: createUuidV7(), at: new Date().toISOString(), text }],
      }
    })
  })

  const open = () => {
    setDraft((current) => (current.view ? current : { ...current, view: where }))
    setMode('open')
    if (status.kind === 'sent') setStatus({ kind: 'idle' })
    // Read on opening rather than once: another tab may have sent or retried since.
    void refreshSent()
  }

  const close = () => {
    setExplaining(null)
    setMode('closed')
    setFieldError(null)
    triggerRef.current?.focus()
  }

  const addShots = (blobs: Blob[]) => {
    setDraft((current) => {
      const room = MAX_SCREENSHOTS - current.shots.length
      const added = blobs.slice(0, Math.max(0, room)).map((blob) => ({
        id: createUuidV7(),
        blob,
        url: URL.createObjectURL(blob),
      }))
      return { ...current, shots: [...current.shots, ...added] }
    })
    setFieldError(null)
  }

  const removeShot = (id: string) => {
    setDraft((current) => {
      const shot = current.shots.find((candidate) => candidate.id === id)
      if (shot) URL.revokeObjectURL(shot.url)
      return { ...current, shots: current.shots.filter((candidate) => candidate.id !== id) }
    })
  }

  const full = draft.shots.length >= MAX_SCREENSHOTS

  const addFiles = async (files: File[]) => {
    const images = files.filter(isImageFile)
    if (images.length === 0) return
    try {
      addShots(await Promise.all(images.map(fitImage)))
    } catch (error) {
      setFieldError({ field: 'shots', message: error instanceof Error ? error.message : 'That image could not be added.' })
    }
  }

  /*
   * The panel and the pill step out of the picture for the frame being taken: a screenshot
   * of a bug with the bug report over it shows the report. Two animation frames, so the
   * hide has been painted before the browser is asked for anything.
   */
  const takeScreenshot = async () => {
    if (full) return
    setCapturing(true)
    setFieldError(null)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    try {
      addShots([await captureScreen()])
    } catch (error) {
      if (!wasDeclined(error)) {
        setFieldError({
          field: 'shots',
          message: error instanceof Error ? error.message : 'The screenshot could not be taken.',
        })
      }
    } finally {
      setCapturing(false)
    }
  }

  const requestScreenshot = (where: 'panel' | 'pill') => {
    if (full) return
    if (captureExplained()) void takeScreenshot()
    else setExplaining(where)
  }

  // A press on Continue is a fresh user gesture, which is what the browser's prompt needs.
  const confirmScreenshot = () => {
    markCaptureExplained()
    setExplaining(null)
    void takeScreenshot()
  }

  const startRecording = () => {
    setMode('recording')
    setFieldError(null)
    // Back to the page, which is where the showing happens.
    triggerRef.current?.focus()
  }

  const stopRecording = () => {
    setExplaining(null)
    setMode('open')
  }

  useEffect(() => {
    if (mode === 'open' && tab === 'new' && status.kind !== 'sent') messageRef.current?.focus()
  }, [mode, tab, status.kind])

  const reset = () => {
    draft.shots.forEach((shot) => URL.revokeObjectURL(shot.url))
    setDraft({ ...EMPTY_DRAFT, kind: draft.kind, view: where })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (status.kind === 'sending') return
    if (!draft.message.trim()) {
      setFieldError({ field: 'message', message: 'Write a line about it first.' })
      messageRef.current?.focus()
      return
    }
    const address = normaliseEmail(email)
    if (address === 'invalid') {
      setFieldError({ field: 'email', message: 'That email address does not look right. Leave it blank to send without one.' })
      return
    }
    setFieldError(null)
    storeEmail(address ?? '')

    const submission: FeedbackSubmission = {
      kind: draft.kind,
      message: draft.message.trim(),
      email: address,
      steps: draft.steps.map(({ at, text }) => ({ at, text })),
      context: collectContext(draft.view ?? where),
      created_at: new Date().toISOString(),
    }
    const local: SentReport = {
      id: createUuidV7(),
      remote_id: null,
      submission,
      screenshots: draft.shots.map((shot) => shot.blob),
      sent_at: null,
      error: null,
    }

    setStatus({ kind: 'sending' })
    try {
      local.remote_id = await sendFeedback(submission, local.screenshots)
      local.sent_at = new Date().toISOString()
    } catch (error) {
      local.error = error instanceof Error ? error.message : 'It could not be sent.'
    }
    try {
      await feedbackInbox().put(local)
    } catch {
      // The report itself went or did not; the list is a record of that, not a condition.
    }
    await refreshSent()
    reset()
    if (local.error) {
      // Kept, not lost: it is waiting under Sent, with the reason and a retry beside it.
      setStatus({ kind: 'idle' })
      setTab('sent')
    } else {
      setStatus({ kind: 'sent', email: address })
    }
  }

  const retry = async (report: SentReport) => {
    setRetrying(report.id)
    const next = { ...report }
    try {
      next.remote_id = await sendFeedback(report.submission, report.screenshots)
      next.sent_at = new Date().toISOString()
      next.error = null
    } catch (error) {
      next.error = error instanceof Error ? error.message : 'It could not be sent.'
    }
    await feedbackInbox().put(next)
    await refreshSent()
    setRetrying(null)
  }

  const forget = async (report: SentReport) => {
    await feedbackInbox().delete(report.id)
    await refreshSent()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      // Not the open dialog's to trap: focus is in the panel, which is beside it.
      event.stopPropagation()
    }
  }

  const onPaste = (event: ClipboardEvent) => {
    const images = Array.from(event.clipboardData.files).filter(isImageFile)
    if (images.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    void addFiles(images)
  }

  /* Drops here are screenshots, not tracker files: the window's import never sees them. */
  const onDrag = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    event.stopPropagation()
    event.preventDefault()
  }

  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    event.stopPropagation()
    event.preventDefault()
    void addFiles(Array.from(event.dataTransfer.files))
  }

  const unsent = sent.filter((report) => report.error).length
  const kind = kindConfig(draft.kind)
  const canCapture = canCaptureScreen()
  const steps = draft.steps.length
  const stepsLabel = `${steps} step${steps === 1 ? '' : 's'}`
  const preview = collectContext(draft.view ?? where)

  const panel = mode === 'open' && (
    <section
      aria-labelledby={titleId}
      aria-modal="false"
      className="feedback-panel"
      hidden={capturing}
      onDragEnter={onDrag}
      onDragLeave={onDrag}
      onDragOver={onDrag}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      role="dialog"
      {...{ [FEEDBACK_UI_ATTRIBUTE]: '' }}
    >
      <header className="feedback-panel__header">
        <h2 className="feedback-panel__title" id={titleId}>Feedback</h2>
        <div aria-label="Feedback" className="feedback-panel__tabs" role="group">
          <button
            aria-pressed={tab === 'new'}
            className="button button--quiet"
            onClick={() => setTab('new')}
            type="button"
          >
            New
          </button>
          <button
            aria-pressed={tab === 'sent'}
            className="button button--quiet"
            onClick={() => setTab('sent')}
            type="button"
          >
            Sent{sent.length > 0 && <span className="feedback-panel__count">{sent.length}</span>}
            {unsent > 0 && <span className="sr-only">, {unsent} not sent</span>}
          </button>
        </div>
        <button aria-label="Close feedback" className="icon-button feedback-panel__close" onClick={close} title="Close (keeps your draft)" type="button">
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      {tab === 'new' && status.kind === 'sent' && (
        <div className="feedback-panel__body feedback-panel__done" role="status">
          <p><strong>Thank you — it is sent.</strong></p>
          <p>
            {status.email
              ? `You will hear at ${status.email} when it is dealt with.`
              : 'It went without an email address, so there will be no reply.'}
          </p>
          <button className="button" onClick={() => setStatus({ kind: 'idle' })} type="button">
            Send another
          </button>
        </div>
      )}

      {tab === 'new' && status.kind !== 'sent' && (
        <form className="feedback-panel__body" noValidate onSubmit={submit}>
          <fieldset className="feedback-kind">
            <legend className="sr-only">What kind of feedback</legend>
            {FEEDBACK_KINDS.map((option) => {
              const Icon = KIND_ICONS[option.id]
              return (
                <label className="feedback-kind__option" key={option.id}>
                  <input
                    checked={draft.kind === option.id}
                    name="feedback-kind"
                    onChange={() => setDraft((current) => ({ ...current, kind: option.id }))}
                    type="radio"
                    value={option.id}
                  />
                  <Icon aria-hidden="true" size={14} />
                  <span>{option.label}</span>
                </label>
              )
            })}
          </fieldset>

          <label className="field">
            <span>{kind.prompt}</span>
            <textarea
              aria-describedby={fieldError?.field === 'message' ? `${hintId}-message` : undefined}
              aria-invalid={fieldError?.field === 'message' || undefined}
              onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))}
              placeholder={kind.placeholder}
              ref={messageRef}
              rows={4}
              value={draft.message}
            />
          </label>
          {fieldError?.field === 'message' && (
            <p className="feedback-panel__error" id={`${hintId}-message`}>{fieldError.message}</p>
          )}

          <div className="feedback-section">
            <div className="feedback-section__row">
              <span className="feedback-section__label">
                Screenshots <span className="feedback-section__count">{draft.shots.length}/{MAX_SCREENSHOTS}</span>
              </span>
              <span className="feedback-section__actions">
                {canCapture && (
                  <button className="button" disabled={full} onClick={() => requestScreenshot('panel')} type="button">
                    <Camera aria-hidden="true" size={14} /> Screenshot
                  </button>
                )}
                {/* Only while the panel is: the app's own import inputs are found by being
                    the page's file inputs, and this one is for images, not trackers. */}
                <input
                  accept="image/*"
                  aria-hidden="true"
                  className="sr-only"
                  multiple
                  onChange={(event) => {
                    void addFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                  ref={fileRef}
                  tabIndex={-1}
                  type="file"
                />
                <button
                  aria-label="Add an image"
                  className="icon-button"
                  disabled={full}
                  onClick={() => fileRef.current?.click()}
                  title="Add an image"
                  type="button"
                >
                  <ImagePlus aria-hidden="true" size={16} />
                </button>
              </span>
            </div>
            {explaining === 'panel' && (
              <CaptureNotice onCancel={() => setExplaining(null)} onConfirm={confirmScreenshot} />
            )}
            {draft.shots.length > 0 ? (
              <ul className="feedback-shots">
                {draft.shots.map((shot, index) => (
                  <li key={shot.id}>
                    <a href={shot.url} rel="noreferrer" target="_blank">
                      <img alt={`Screenshot ${index + 1}`} src={shot.url} />
                    </a>
                    <button
                      aria-label={`Remove screenshot ${index + 1}`}
                      className="icon-button feedback-shots__remove"
                      onClick={() => removeShot(shot.id)}
                      title="Remove"
                      type="button"
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : explaining === 'panel' ? null : (
              <p className="feedback-section__hint">
                {canCapture
                  ? 'Your browser asks to share this tab, takes one picture, then stops. Or paste or drop an image here.'
                  : 'Paste or drop an image here, or add one.'}
              </p>
            )}
            {fieldError?.field === 'shots' && <p className="feedback-panel__error" role="alert">{fieldError.message}</p>}
          </div>

          <div className="feedback-section">
            <div className="feedback-section__row">
              <span className="feedback-section__label">
                Steps {steps > 0 && <span className="feedback-section__count">{steps}</span>}
              </span>
              <span className="feedback-section__actions">
                {steps > 0 && (
                  <button
                    className="button button--quiet"
                    onClick={() => setDraft((current) => ({ ...current, steps: [] }))}
                    type="button"
                  >
                    Clear
                  </button>
                )}
                <button className="button" onClick={startRecording} type="button">
                  <CircleDot aria-hidden="true" size={14} /> {steps > 0 ? 'Record more' : 'Show me'}
                </button>
              </span>
            </div>
            {steps > 0 ? (
              <ol className="feedback-steps">
                {draft.steps.map((step) => (
                  <li key={step.id}>
                    <span>{step.text}</span>
                    <button
                      aria-label={`Remove step: ${step.text}`}
                      className="icon-button feedback-steps__remove"
                      onClick={() =>
                        setDraft((current) => ({ ...current, steps: current.steps.filter((other) => other.id !== step.id) }))
                      }
                      title="Remove this step"
                      type="button"
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="feedback-section__hint">
                Shrinks this panel while you show the problem, and notes which buttons you press —
                never what you type.
              </p>
            )}
          </div>

          <label className="field">
            <span>Email me when it is done <span className="feedback-section__count">optional</span></span>
            <input
              aria-describedby={emailHintId}
              aria-invalid={fieldError?.field === 'email' || undefined}
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>
          <p className={fieldError?.field === 'email' ? 'feedback-panel__error' : 'feedback-section__hint'} id={emailHintId}>
            {fieldError?.field === 'email' ? fieldError.message : 'Used only to reply about this.'}
          </p>

          <details className="feedback-context">
            <summary>Also sent with it</summary>
            <dl>
              {describeContext(preview).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="feedback-section__hint">Nothing from your applications is sent.</p>
          </details>

          <div className="feedback-panel__footer">
            <button className="button button--primary" disabled={status.kind === 'sending'} type="submit">
              <Send aria-hidden="true" size={14} />
              {status.kind === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      )}

      {tab === 'sent' && (
        <div className="feedback-panel__body">
          {sent.length === 0 ? (
            <p className="feedback-section__hint">Nothing sent from this browser yet.</p>
          ) : (
            <ul className="feedback-sent">
              {sent.map((report) => {
                const Icon = KIND_ICONS[report.submission.kind]
                return (
                  <li className={report.error ? 'feedback-sent__item feedback-sent__item--failed' : 'feedback-sent__item'} key={report.id}>
                    <div className="feedback-sent__head">
                      <Icon aria-hidden="true" size={14} />
                      <span className="feedback-sent__title">{firstLine(report.submission.message)}</span>
                    </div>
                    <p className="feedback-sent__meta">
                      {report.error ? (
                        <>Not sent: {report.error}</>
                      ) : (
                        <>
                          Sent{' '}
                          <time dateTime={report.sent_at ?? undefined}>
                            {new Date(report.sent_at ?? report.submission.created_at).toLocaleString()}
                          </time>
                          {report.submission.email && ` · reply to ${report.submission.email}`}
                        </>
                      )}
                    </p>
                    <div className="feedback-sent__actions">
                      {report.error && (
                        <button
                          className="button"
                          disabled={retrying === report.id}
                          onClick={() => void retry(report)}
                          type="button"
                        >
                          <RotateCw aria-hidden="true" size={14} />
                          {retrying === report.id ? 'Sending…' : 'Try again'}
                        </button>
                      )}
                      <button
                        aria-label={`Remove “${firstLine(report.submission.message)}” from this list`}
                        className="icon-button"
                        onClick={() => void forget(report)}
                        title={report.error ? 'Discard this report' : 'Remove from this list'}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )

  const pill = mode === 'recording' && (
    <div
      aria-label="Recording steps for your feedback"
      className="feedback-pill"
      hidden={capturing}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (explaining) setExplaining(null)
          else stopRecording()
        }
      }}
      role="region"
      {...{ [FEEDBACK_UI_ATTRIBUTE]: '' }}
    >
      <span aria-hidden="true" className="feedback-pill__dot" />
      <span className="feedback-pill__label">Recording · {stepsLabel}</span>
      {canCapture && (
        <button
          aria-label={full ? 'Screenshot limit reached' : 'Take a screenshot'}
          className="icon-button"
          disabled={full}
          onClick={() => requestScreenshot('pill')}
          title={full ? `At most ${MAX_SCREENSHOTS} screenshots` : `Take a screenshot (${draft.shots.length}/${MAX_SCREENSHOTS})`}
          type="button"
        >
          <Camera aria-hidden="true" size={16} />
        </button>
      )}
      <button className="button button--primary" onClick={stopRecording} ref={pillRef} type="button">
        Done
      </button>
      {explaining === 'pill' && (
        <CaptureNotice onCancel={() => setExplaining(null)} onConfirm={confirmScreenshot} />
      )}
      {/* Said here as well as in the panel: the pill is all that is on screen while recording. */}
      {explaining !== 'pill' && fieldError?.field === 'shots' && (
        <p className="feedback-notice feedback-notice--error" role="alert">{fieldError.message}</p>
      )}
    </div>
  )

  return (
    <>
      <button
        aria-expanded={mode === 'open'}
        className="button button--quiet feedback-trigger"
        onClick={() => (mode === 'open' ? close() : mode === 'recording' ? stopRecording() : open())}
        ref={triggerRef}
        title="Report a problem or suggest something"
        type="button"
        {...{ [FEEDBACK_UI_ATTRIBUTE]: '' }}
      >
        <MessageSquarePlus aria-hidden="true" size={16} />
        <span className="feedback-trigger__label">Feedback</span>
        {mode === 'recording' && <span className="sr-only"> (recording)</span>}
      </button>
      {typeof document !== 'undefined' && (panel || pill) && createPortal(<>{panel}{pill}</>, document.body)}
    </>
  )
}
