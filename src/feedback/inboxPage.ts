/**
 * The page the app's maintainer reads reports on, served by the feedback route itself at
 * `…/api/feedback/inbox`. It is one self-contained document — no build step, no assets —
 * because it is served by the Worker rather than by the app.
 *
 * Every report is untrusted text written by a stranger, so the page builds its DOM with
 * `textContent` and never with `innerHTML`, and the route serves it under a CSP that
 * allows nothing but itself. The token lives in `sessionStorage`, so closing the tab
 * forgets it.
 */
export const INBOX_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Feedback inbox</title>
<style>
:root {
  --bg: #fafaf9; --surface: #fff; --line: #e4e4e0; --ink: #1c2024; --ink-2: #5a6169;
  --accent: #0f766e; --accent-weak: #e6f2f0; --danger: #b3261e;
  color: var(--ink); background: var(--bg);
  font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #16181a; --surface: #1e2124; --line: #33363a; --ink: #eceef0; --ink-2: #a8adb3;
    --accent: #2dd4bf; --accent-weak: #163330; --danger: #f2867e; }
}
body { margin: 0; padding: 16px; background: var(--bg); }
main { max-width: 60rem; margin: 0 auto; display: grid; gap: 12px; }
h1 { margin: 0; font-size: 20px; }
/* Every rule below that sets display would otherwise outrank the attribute, and the login
   form stayed on screen after signing in. */
[hidden] { display: none !important; }
form, .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
input, select, button, a.button { font: inherit; min-height: 32px; padding: 0 8px; border: 1px solid var(--line);
  border-radius: 4px; color: var(--ink); background: var(--surface); box-sizing: border-box; }
a.button { display: inline-flex; align-items: center; text-decoration: none; }
button, a.button { cursor: pointer; }
.primary { border-color: var(--accent) !important; background: var(--accent) !important; color: var(--surface) !important; font-weight: 600; }
article { padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface);
  display: grid; gap: 8px; min-width: 0; }
/* What a closed report said is faded; what can still be done with it is not. */
article[data-status="done"] > :not(.bar), article[data-status="wont-do"] > :not(.bar) { opacity: .65; }
.reply-to { font-size: 12px; color: var(--ink-2); }
.meta { color: var(--ink-2); font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.kind { font-weight: 600; color: var(--accent); }
.message { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
ol { margin: 0; padding-left: 20px; font-size: 12px; color: var(--ink-2); }
details summary { cursor: pointer; font-size: 12px; color: var(--ink-2); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 4px 0 0; font-size: 12px; }
dt { color: var(--ink-2); } dd { margin: 0; overflow-wrap: anywhere; }
.shots { display: flex; flex-wrap: wrap; gap: 8px; }
.shots img { max-width: 14rem; max-height: 10rem; border: 1px solid var(--line); border-radius: 4px; cursor: zoom-in; }
.status { color: var(--ink-2); }
.hint { flex-basis: 100%; margin: 0; font-size: 12px; }
.error { color: var(--danger); margin: 0; }
.error:empty { display: none; }
.danger { color: var(--danger); }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Feedback inbox</h1>
  <form id="login">
    <label>Admin token <input id="token" type="password" autocomplete="current-password" required></label>
    <button class="primary" type="submit">Open</button>
    <p class="status hint" hidden id="local-hint">
      Running locally, the token is <code>local</code> unless the dev server was started with
      <code>FEEDBACK_ADMIN_TOKEN</code> set. The token you set on Cloudflare is for the hosted inbox.
    </p>
  </form>
  <div class="bar" hidden id="bar">
    <label>Show <select id="filter">
      <option value="open">Open</option>
      <option value="all">All</option>
      <option value="done">Done or won't do</option>
    </select></label>
    <button id="refresh" type="button">Refresh</button>
    <span class="status" id="count" role="status"></span>
  </div>
  <p class="error" id="error" role="alert"></p>
  <section id="list" aria-label="Reports"></section>
</main>
<script>
(() => {
  const api = location.pathname.replace(/\\/inbox\\/?$/, '')
  const KINDS = { bug: 'Bug', idea: 'Idea', other: 'Other' }
  const STATUSES = { 'new': 'New', 'in-progress': 'In progress', done: 'Done', 'wont-do': "Won't do" }
  const $ = (id) => document.getElementById(id)
  let token = ''
  try { token = sessionStorage.getItem('feedback-token') || '' } catch {}
  let reports = []
  /*
   * Reports whose status changed since the list was last drawn from scratch. They stay on
   * screen whatever the filter says until it is changed or the list refreshed: marking one
   * Done is exactly when its sender is owed a reply, and a card that vanished under the Open
   * filter took the way to send one with it.
   */
  const kept = new Set()

  const el = (tag, props, ...children) => {
    const node = document.createElement(tag)
    Object.assign(node, props || {})
    for (const child of children) if (child != null) node.append(child)
    return node
  }

  async function call(path, init) {
    const response = await fetch(api + path, {
      ...init,
      headers: { ...(init && init.headers), Authorization: 'Bearer ' + token },
    })
    if (response.status === 401) {
      try { sessionStorage.removeItem('feedback-token') } catch {}
      $('login').hidden = false
      $('bar').hidden = true
      throw new Error('That token was refused.')
    }
    if (!response.ok) {
      let message = response.statusText
      try { message = (await response.json()).error || message } catch {}
      throw new Error(message)
    }
    return response
  }

  /* What the reply says follows where the report stands, so Done reads as done. */
  /*
   * The reply is written in the maintainer's voice to someone who took time out of a job
   * search to report something. Each line says only what is true at the report's status:
   * nothing promises a follow-up the status does not mean is coming.
   */
  const THANKS = {
    bug: ['bug report', 'Reports like yours are how I find out what needs fixing.'],
    idea: ['suggestion', 'Suggestions like yours are how I decide what to build next.'],
    other: ['message', 'Hearing from the people who use it is how I learn what to improve.'],
  }

  function replyLine(report) {
    if (report.status === 'done') {
      return report.kind === 'bug' ? 'The problem you reported is now fixed.'
        : report.kind === 'idea' ? 'Your suggestion is now in the tracker.'
        : 'I have now dealt with it.'
    }
    if (report.status === 'wont-do') {
      return 'I have decided not to make this change for now, but I am grateful you took the trouble to suggest it.'
    }
    if (report.status === 'in-progress') return 'I am working on it now.'
    return 'I have read it and will look into it.'
  }

  function reply(report) {
    const [noun, why] = THANKS[report.kind] || THANKS.other
    const subject = 'Thank you for your ' + noun + ' about the job applications tracker'
    const quoted = report.message.split('\\n').map((line) => '> ' + line).join('\\n')
    const body = [
      'Hi,',
      'Thank you for taking the time to send your ' + noun + ' about the job applications tracker. ' + why,
      replyLine(report),
      'Good luck with your job search!',
      quoted,
    ].join('\\n\\n') + '\\n'
    return { subject, body }
  }

  function notifyLink(report) {
    const { subject, body } = reply(report)
    return 'mailto:' + encodeURIComponent(report.email) + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body)
  }

  function render() {
    const filter = $('filter').value
    const shown = reports.filter((report) =>
      kept.has(report.id) ? true
        : filter === 'all' ? true
        : filter === 'open' ? report.status === 'new' || report.status === 'in-progress'
        : report.status === 'done' || report.status === 'wont-do')
    $('count').textContent = shown.length + ' of ' + reports.length
    $('list').replaceChildren(...shown.map(card))
  }

  function card(report) {
    const status = el('select', { ariaLabel: 'Status' })
    for (const [value, label] of Object.entries(STATUSES)) {
      status.append(el('option', { value, textContent: label, selected: value === report.status }))
    }
    status.addEventListener('change', async () => {
      try {
        const next = await (await call('/' + report.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: status.value }),
        })).json()
        Object.assign(report, next)
        kept.add(report.id)
        render()
      } catch (error) { $('error').textContent = error.message }
    })

    const remove = el('button', { type: 'button', className: 'danger', textContent: 'Delete' })
    remove.addEventListener('click', async () => {
      if (!confirm('Delete this report and its screenshots for good?')) return
      try {
        await call('/' + report.id, { method: 'DELETE' })
        reports = reports.filter((other) => other.id !== report.id)
        render()
      } catch (error) { $('error').textContent = error.message }
    })

    const meta = el('div', { className: 'meta' },
      el('span', { className: 'kind', textContent: KINDS[report.kind] || report.kind }),
      el('time', { dateTime: report.received_at, textContent: new Date(report.received_at).toLocaleString() }),
      el('span', { textContent: report.context.view + ' · ' + report.context.build }),
    )
    meta.append(el('span', { textContent: report.email ? 'Wants a reply' : 'No email left' }))

    /*
     * The reply is a button beside the status that prompts it, and loudest once the report is
     * closed. A mailto link does nothing where no mail app is the default — Gmail in a browser,
     * say — so the same reply can be copied and pasted into whatever is used instead.
     */
    const actions = el('div', { className: 'bar' }, status)
    if (report.email) {
      const closed = report.status === 'done' || report.status === 'wont-do'
      actions.append(el('a', {
        className: closed ? 'button primary' : 'button',
        href: notifyLink(report),
        textContent: 'Notify by email',
        title: 'Opens your mail app with a reply to ' + report.email + ' already written',
      }))
      const copy = el('button', {
        type: 'button',
        textContent: 'Copy reply',
        title: 'For when no mail app opens: copies the address, subject and message to paste into any email',
      })
      copy.addEventListener('click', async () => {
        const { subject, body } = reply(report)
        try {
          await navigator.clipboard.writeText('To: ' + report.email + '\\nSubject: ' + subject + '\\n\\n' + body)
          copy.textContent = 'Copied'
          setTimeout(() => { copy.textContent = 'Copy reply' }, 2000)
        } catch {
          $('error').textContent = 'The reply could not be copied. Write to ' + report.email + ' directly.'
        }
      })
      actions.append(copy, el('span', { className: 'reply-to', textContent: report.email }))
    }
    actions.append(remove)

    const shots = el('div', { className: 'shots' })
    for (const shot of report.screenshots) {
      const img = el('img', { alt: 'Screenshot ' + (shot.index + 1) })
      call('/' + report.id + '/screenshots/' + shot.index)
        .then((response) => response.blob())
        .then((blob) => {
          img.src = URL.createObjectURL(blob)
          img.addEventListener('click', () => window.open(img.src, '_blank', 'noopener'))
        })
        .catch(() => { img.alt = 'Screenshot ' + (shot.index + 1) + ' could not load' })
      shots.append(img)
    }

    const steps = report.steps.length
      ? el('details', {},
          el('summary', { textContent: report.steps.length + ' recorded step' + (report.steps.length === 1 ? '' : 's') }),
          el('ol', {}, ...report.steps.map((step) => el('li', { textContent: step.text }))))
      : null

    const context = el('details', {}, el('summary', { textContent: 'Context' }),
      el('dl', {}, ...Object.entries(report.context).flatMap(([key, value]) =>
        [el('dt', { textContent: key }), el('dd', { textContent: String(value) })])))

    const article = el('article', {},
      meta,
      el('p', { className: 'message', textContent: report.message }),
      report.screenshots.length ? shots : null,
      steps,
      context,
      actions,
    )
    article.dataset.status = report.status
    return article
  }

  async function load() {
    $('error').textContent = ''
    try {
      reports = (await (await call('')).json()).reports
      kept.clear()
      $('login').hidden = true
      $('bar').hidden = false
      render()
    } catch (error) { $('error').textContent = error.message }
  }

  // The dev server's token differs from the hosted one, and nothing else on the page says so.
  // Inside the login form, so it goes when the form does.
  $('local-hint').hidden = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

  $('login').addEventListener('submit', (event) => {
    event.preventDefault()
    token = $('token').value
    try { sessionStorage.setItem('feedback-token', token) } catch {}
    load()
  })
  $('refresh').addEventListener('click', load)
  $('filter').addEventListener('change', () => {
    kept.clear()
    render()
  })
  if (token) load()
})()
</script>
</body>
</html>
`
