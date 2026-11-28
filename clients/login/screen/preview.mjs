import {writeFile} from 'node:fs/promises'
import {renderScreen} from './render.mjs'

const [output] = process.argv.slice(2)
if (!output) throw new Error('Usage: node clients/login/screen/preview.mjs OUTPUT.html')
const html = await renderScreen({
  state: 'ready', provider: 'anthropic', mode: 'browser', preview: true,
})
await writeFile(output, html)
