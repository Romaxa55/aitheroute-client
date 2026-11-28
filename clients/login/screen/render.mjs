import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {checked, frame, scene, states, words} from './view.mjs'

const asset = (name) => readFile(new URL(name, import.meta.url), 'utf8')
const hash = (source) => "'sha256-" + createHash('sha256').update(source).digest('base64') + "'"

export async function renderScreen(options) {
  const model = checked(options)
  const [css, script] = await Promise.all([asset('styles.css'), asset(model.preview ? 'demo.js' : 'live.js')])
  const local = model.preview ? "'none'" : "'self'"
  const referrer = model.preview ? 'no-referrer' : 'same-origin'
  const csp = `default-src 'none'; base-uri 'none'; style-src ${hash(css)}; script-src ${hash(script)}; connect-src ${local}; form-action ${local}`
  const templates = model.preview
    ? states.map((state) => `<template id="scene-${state}">${scene({...model, state, reason: ''})}</template>`).join('')
      + `<template id="scene-profile">${scene({...model, state:'blocked', reason:'profile'})}</template>`
    : `<p id="offline" hidden data-status="${words.offlineStatus}" data-title="${words.offlineTitle}">${words.offline}</p>`
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="${referrer}"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${words.title} &middot; ${words.brand}</title><style>${css}</style></head>
<body><div class="wrap">${frame(model)}</div>${templates}<script>${script}</script></body></html>`
}
