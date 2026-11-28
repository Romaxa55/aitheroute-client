import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {basename, dirname, join} from 'node:path'

/**
 * Where the setup leaves its settings. On macOS and Linux the values
 * go to ~/.aitheroute/env.sh, readable by the person alone, and the shell's
 * startup file gets one marked block that loads it while it exists; on Windows
 * they are the user's environment variables. Every run replaces what it wrote,
 * so running again never stacks lines.
 */

const START = '# >>> AI The Route >>>'
const END = '# <<< AI The Route <<<'
const BLOCK = /# >>> AI The Route >>>[\s\S]*?# <<< AI The Route <<<\n?/g

/** ~/.aitheroute, private: the login helper refuses a folder others can read. */
export function privateBase(base, platform = process.platform) {
  mkdirSync(base, {recursive: true, mode: 0o700})
  if (platform !== 'win32') chmodSync(base, 0o700)
}

/** The startup file the person's shell reads in a new terminal window. */
export function rcFile(env = process.env, home = homedir(), platform = process.platform) {
  const shell = basename(env.SHELL ?? '')
  if (shell === 'zsh') return join(env.ZDOTDIR || home, '.zshrc')
  if (shell !== 'bash') return join(home, '.profile')
  if (platform !== 'darwin') return join(home, '.bashrc')
  // A login bash reads only the first of these: a new .bash_profile would hide the others.
  const files = ['.bash_profile', '.bash_login', '.profile'].map((name) => join(home, name))
  return files.find((file) => existsSync(file)) ?? files[0]
}

const single = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
const double = (value) => '"' + value.replace(/[\\"$`]/g, '\\$&') + '"'

/** What env.sh holds: PATH first, then the variables. */
export function envScript(vars, paths) {
  const path = paths.length ? ['export PATH=' + double(paths.join(':')) + '":$PATH"'] : []
  const lines = Object.entries(vars).map(([name, value]) => `export ${name}=${single(value)}`)
  return [...path, ...lines].join('\n') + '\n'
}

/** The startup file's block: load env.sh while it is there, so deleting the folder undoes it. */
export const loadLine = (envFile) => `[ -f ${double(envFile)} ] && . ${double(envFile)}`
export const shellBlock = (envFile) => [START, loadLine(envFile), END].join('\n')

/** The file's text with our block replaced, or added last so it wins over older lines. */
export function withBlock(text, block) {
  const rest = text.replace(BLOCK, '').trimEnd()
  return (rest ? rest + '\n\n' : '') + block + '\n'
}

/** Adds the block unless it is there; a file that is not UTF-8 only gets it appended. */
export function writeBlock(file, block) {
  const bytes = existsSync(file) ? readFileSync(file) : Buffer.alloc(0)
  const text = bytes.toString('utf8')
  if (text.includes(block)) return
  if (Buffer.from(text, 'utf8').equals(bytes)) return writeFileSync(file, withBlock(text, block))
  writeFileSync(file, '\n' + block + '\n', {flag: 'a'})
}

// Values reach PowerShell as JSON in the environment: nothing to quote on a command line.
// Path goes through the registry to keep its %VARIABLES% unexpanded (REG_EXPAND_SZ);
// SetEnvironmentVariable afterwards tells Explorer that the environment changed.
const WINDOWS = `$add = @($env:AITR_PATHS -split ';' | Where-Object { $_ })
if ($add.Count) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  $now = @(([string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')) -split ';' | Where-Object { $_ })
  $key.SetValue('Path', ((@($add | Where-Object { $now -notcontains $_ }) + $now) -join ';'), 'ExpandString')
  $key.Close() }
$vars = $env:AITR_SET | ConvertFrom-Json
foreach ($p in $vars.PSObject.Properties) {
  [Environment]::SetEnvironmentVariable($p.Name, $p.Value, 'User') }`

/** Writes env.sh whole and private: a new file, then renamed over the old one. */
function writePrivate(file, text) {
  const next = file + '.new'
  writeFileSync(next, text, {mode: 0o600})
  chmodSync(next, 0o600)
  renameSync(next, file)
}

/**
 * Saves the variables for new terminals and sets them in this process too.
 * Null when done; 'envFailed' when nothing could be saved; 'rcFailed' when
 * env.sh is saved but the startup file could not take the block.
 */
export function saveEnvironment(
  vars,
  paths,
  platform = process.platform,
  run = spawnSync,
  envFile = join(homedir(), '.aitheroute', 'env.sh'),
  rc = rcFile(),
) {
  Object.assign(process.env, vars)
  if (platform === 'win32') {
    const env = {...process.env, AITR_SET: JSON.stringify(vars), AITR_PATHS: paths.join(';')}
    const done = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS], {
      env,
      stdio: 'inherit',
    })
    return done.status === 0 ? null : 'envFailed'
  }
  try {
    privateBase(dirname(envFile), platform)
    writePrivate(envFile, envScript(vars, paths))
  } catch {
    return 'envFailed'
  }
  try {
    writeBlock(rc, shellBlock(envFile))
    return null
  } catch {
    // A read-only startup file (a link into /nix/store, say): the person adds the line.
    return 'rcFailed'
  }
}
