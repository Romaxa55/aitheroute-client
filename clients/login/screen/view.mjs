import {readFileSync} from 'node:fs'

export const words = JSON.parse(readFileSync(new URL('ru.json', import.meta.url), 'utf8'))
// macOS and Windows have no isolation; their screens say so.
const desktop = {...words, ...words.desktop,
  states: {...words.states, ...words.desktop.states}, reasons: {...words.reasons, ...words.desktop.reasons}}
const say = (model) => model.isolation === 'desktop' ? desktop : words
// Claude Code's setup-token sign-in is not refreshed, so it needs no helper later.
const refresh = (model, w) => model.provider === 'anthropic' ? w.refreshClaude : w.refresh
export const states = Object.keys(words.states)
export const providers = Object.keys(words.providers)
const validReason = (reason) => typeof reason === 'string' && Object.hasOwn(words.reasons, reason) ? reason : ''
const safeHost = (host) => typeof host === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(host)

export function checked({state, provider, mode, host, reason, choiceId, isolation, preview = false}) {
  const known = providers.includes(provider)
  const valid = known && states.includes(state) && ['browser', 'cli'].includes(mode)
  return {
    state: valid ? state : 'blocked',
    provider: known ? provider : '',
    mode: mode === 'cli' ? 'cli' : 'browser',
    host: preview === true ? 'example.com' : safeHost(host) ? host : '',
    reason: valid ? validReason(reason) : 'setup',
    choiceId: !preview && typeof choiceId === 'string' && /^[a-f0-9]{32}$/.test(choiceId) ? choiceId : '',
    isolation: isolation === 'desktop' && preview !== true ? 'desktop' : 'strict',
    preview: preview === true,
  }
}

function control(action, label, preview, style = 'primary') {
  const button = `<button type="${preview ? 'button' : 'submit'}" class="${style}" data-action="${action}">${label}</button>`
  return preview ? button : `<form method="post" action="${action}">${button}</form>`
}

const providerText = (model) =>
  `<span data-name>${words.providers[model.provider] ?? words.destination}</span>`

function route(model) {
  const words = say(model)
  const steps = [
    ['window', words.start, ''],
    ['relay', words.gateway, model.host],
    ['site', words.destination, providerText(model)],
  ]
  return `<aside class="route" aria-label="${words.route}"><h3>${words.route}</h3>
    <ol>${steps.map(([icon, label, detail]) => `<li>
      <span class="node ${icon}" aria-hidden="true"><i></i></span>
      <div><strong>${label}</strong>${detail ? `<small>${detail}</small>` : ''}</div></li>`).join('')}</ol></aside>`
}

export function scene(model) {
  const words = say(model)
  const {state, mode, reason, preview} = model
  const [status, title, text] = words.states[state]
  const detail = reason && ['blocked', 'disconnected', 'finished'].includes(state)
    ? words.reasons[reason] : ''
  let button = ''
  if (state === 'ready') {
    button = control('continue', `<span data-mode-label>${words[mode]}</span><b aria-hidden="true">&rarr;</b>`, preview)
  } else if (state === 'blocked' && reason === 'profile' && (preview || model.choiceId)) {
    const suffix = preview ? '' : '-' + model.choiceId
    button = control('profile-clean'+suffix, words.profileClean, preview)
      + control('profile-reuse'+suffix, words.profileReuse, preview,'quiet')
  } else if (['disconnected', 'blocked'].includes(state) && reason !== 'unsupported') {
    button = control('retry', words.retry, preview)
  }
  const key = [state, model.provider, mode, reason, model.host, model.choiceId].join('|')
  return `<main id="session" data-state="${state}" data-provider="${model.provider}" data-key="${key}">
    <p class="eyebrow">${words.scope}</p><h1>${providerText(model)}</h1>
    <section class="card"><div class="summary">
      <span class="status"><i aria-hidden="true"></i>${status}</span>
      <h2 tabindex="-1">${title}</h2><p class="description">${detail && state === 'blocked' ? detail : text}</p>
      ${detail && state !== 'blocked' ? `<p class="reason">${detail}</p>` : ''}${button}
    </div>${route(model)}</section></main>`
}

export function demoControls(model) {
  const select = (id, label, entries, value) =>
    `<label>${label}<select id="demo-${id}">${entries.map(([id, name, action]) =>
      `<option value="${id}"${action ? ` data-action="${action}"` : ''}${id === value ? ' selected' : ''}>${name}</option>`).join('')}</select></label>`
  return `<section class="demo"><div><strong>${words.demo}</strong><span>${words.demoNote}</span></div>
    ${select('state', words.selectState, states.map((s) => [s, words.states[s][0]]), model.state)}
    ${select('provider', words.selectProvider, Object.entries(words.providers), model.provider)}
    <label>${words.selectReason}<select id="demo-reason"><option value="">${words.noReason}</option>
    ${Object.entries(words.reasonLabels).map(([id, label]) => `<option value="${id}" data-detail="${words.reasons[id]}">${label}</option>`).join('')}</select></label>
    ${select('mode', words.selectMode, [['browser', words.webMode, words.browser], ['cli', words.cliMode, words.cli]], model.mode)}</section>`
}

export function frame(model) {
  const words = say(model)
  return `<header><div class="brand"><span class="logo" aria-hidden="true"><i></i></span>${words.brand}</div>
    <div class="helper">${model.preview ? `<b class="demo-badge">${words.demo}</b>` : '<span aria-hidden="true"></span>'}${words.helper}</div></header>
    ${scene(model)}<p id="announcement" role="status" aria-atomic="true" class="sr-only"></p>
    <section class="note"><div class="note-icon" aria-hidden="true">i</div><div><h3>${words.safety}</h3>
    <p>${words.notice}</p><details open><summary>${words.more}</summary>
    <p>${words.details}</p><p>${refresh(model, words)}</p></details></div></section>
    <footer>${control('stop', words.stop, model.preview, 'quiet')}</footer>
    ${model.preview ? demoControls(model) : ''}`
}
