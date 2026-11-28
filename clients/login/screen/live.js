// Keep current controls and keyboard focus when server state is unchanged.
(() => {
  const monitored = new Set(['checking', 'ready', 'active', 'blocked', 'disconnected'])
  const offline = document.getElementById('offline')
  let submitting = false
  let pending = false
  let timer
  document.addEventListener('submit', () => { submitting = true })
  function announce(view, restoreFocus) {
    const heading = view.querySelector('h2')
    const detail = view.querySelector('.reason') || view.querySelector('.description')
    document.getElementById('announcement').textContent = heading.textContent + '. ' + detail.textContent
    if (restoreFocus) heading.focus()
  }
  function lost(current) {
    if (!current.dataset.key) return
    const restoreFocus = current.contains(document.activeElement)
    current.dataset.state = 'disconnected'
    current.dataset.key = ''
    current.querySelector('.status').lastChild.textContent = offline.dataset.status
    current.querySelector('h2').textContent = offline.dataset.title
    current.querySelector('.description').textContent = offline.textContent
    for (const form of current.querySelectorAll('.summary form')) form.remove()
    current.querySelector('.reason')?.remove()
    announce(current, restoreFocus)
  }
  async function refresh() {
    clearTimeout(timer)
    if (pending || submitting) return
    pending = true
    const current = document.getElementById('session')
    try {
      const res = await fetch(location.pathname, {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error('offline')
      const html = new DOMParser().parseFromString(await res.text(), 'text/html')
      const next = html.querySelector('main#session[data-key]')
      if (!next) throw new Error('offline')
      if (!submitting && next.dataset.key !== current.dataset.key) {
        const restoreFocus = current.contains(document.activeElement)
        current.replaceWith(next)
        announce(next, restoreFocus)
      }
    } catch {
      if (!submitting) lost(current)
    } finally {
      pending = false
      const visible = document.getElementById('session')
      if (monitored.has(visible.dataset.state) || visible.dataset.key === '') {
        timer = setTimeout(refresh, 2000)
      }
    }
  }
  if (monitored.has(document.getElementById('session').dataset.state)) {
    timer = setTimeout(refresh, 1500)
    window.addEventListener('pageshow', ({persisted}) => {
      if (!persisted) return
      submitting = false
      lost(document.getElementById('session'))
      void refresh()
    })
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refresh()
    })
  }
})()
