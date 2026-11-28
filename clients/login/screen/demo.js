// Offline preview controls only change local markup.
(() => {
  const state = document.querySelector('#demo-state')
  const provider = document.querySelector('#demo-provider')
  const mode = document.querySelector('#demo-mode')
  const reason = document.querySelector('#demo-reason')
  let retryTimer
  function show() {
    const choosing = reason.value === 'profile'
    if (choosing) state.value = 'blocked'
    const view = document.querySelector('#scene-' + (choosing ? 'profile' : state.value)).content.cloneNode(true)
    const next = view.querySelector('main')
    next.dataset.provider = provider.value
    for (const name of next.querySelectorAll('[data-name]')) {
      name.textContent = provider.selectedOptions[0].textContent
    }
    if (reason.value) {
      const detail = reason.selectedOptions[0].dataset.detail
      if (state.value === 'disconnected') {
        const explanation = document.createElement('p')
        explanation.className = 'reason'
        explanation.textContent = detail
        next.querySelector('.description').after(explanation)
      } else next.querySelector('.description').textContent = detail
    }
    const label = next.querySelector('[data-mode-label]')
    if (label) label.textContent = mode.selectedOptions[0].dataset.action
    const current = document.querySelector('main')
    const restoreFocus = current.contains(document.activeElement)
    current.replaceWith(next)
    const heading = next.querySelector('h2')
    const detail = next.querySelector('.reason') || next.querySelector('.description')
    document.getElementById('announcement').textContent = heading.textContent + '. ' + detail.textContent
    if (restoreFocus) heading.focus()
  }
  state.addEventListener('change', () => {
    clearTimeout(retryTimer)
    reason.value = ''
    show()
  })
  reason.addEventListener('change', () => {
    clearTimeout(retryTimer)
    if (reason.value) {
      if (reason.value === 'unsupported') state.value = 'unsupported'
      else if (['closed', 'cli'].includes(reason.value)) state.value = 'finished'
      else if (state.value !== 'disconnected') state.value = 'blocked'
    }
    show()
  })
  for (const field of [provider, mode]) field.addEventListener('change', show)
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    clearTimeout(retryTimer)
    const next = {continue: 'active', retry: 'checking', 'profile-clean': 'checking', 'profile-reuse': 'checking', stop: 'finished'}[button.dataset.action]
    if (!next) return
    state.value = next
    reason.value = ''
    show()
    if (next === 'checking') retryTimer = setTimeout(() => {
      if (state.value === 'checking') {
        state.value = 'ready'
        show()
      }
    }, 900)
    document.querySelector('main h2').focus({preventScroll: true})
  })
})()
