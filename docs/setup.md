# How the setup works

Claude Code with your own Claude subscription, set up in one command on macOS,
Linux or Windows, with nothing to install first and no administrator rights:

```sh
curl -fsSL https://<gateway>/i/<token> | sh          # macOS, Linux
irm https://<gateway>/i/<token>/win | iex            # Windows PowerShell
```

The same steps run from the archive: unpack it anywhere and run `sh start.sh`
or double-click `start.cmd`; it asks for the bot's command and takes the
gateway and the token from it. Run again by hand, it offers to keep the saved
token on Enter.

## The chain

1. **`/i/<token>[/win][/<lang>]`**: the gateway checks the token and answers
   [`clients/setup/install.sh`](../clients/setup/install.sh) or
   [`install.ps1`](../clients/setup/install.ps1) with its own address, the
   token and the language filled in. A token that is revoked, expired, unknown
   or not for Claude gets a script that only explains, without the token.
2. **The first stage** downloads the archive (`/setup/aitheroute.tar.gz`, or
   `.zip` on Windows) into a temporary folder and runs its `start.sh` /
   `start.ps1`.
3. **`start`** makes `~/.aitheroute` private (0700), copies the archive into it,
   finds Node.js 24.5+ or fetches it from nodejs.org after checking the
   published SHA-256, and runs `setup/core.mjs`. Messages come from
   `setup/<lang>.json`, so the scripts stay ASCII.
4. **`core.mjs`**, in this order:
   - stops if something would override the gateway: `ANTHROPIC_AUTH_TOKEN` or
     `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` in the shell, or another
     provider's values, an API key or `apiKeyHelper` in `~/.claude/settings.json`.
     `ANTHROPIC_API_KEY` in the shell only gets a warning, and the checks run
     without it;
   - asks the gateway for a pairing code for the sign-in helper, which also
     proves the token before anything is installed;
   - installs Claude Code with npm into `~/.aitheroute/claude`, or updates the
     copy it installed before; your own Claude Code is left alone;
   - sets `hasCompletedOnboarding` and `skipWebFetchPreflight` (see below);
   - keeps a saved sign-in token if one request with it works; otherwise signs
     in: pairs the helper and runs `claude setup-token` through it, or, where
     the helper cannot open the sign-in, asks for a token pasted from another
     computer;
   - saves everything once, then sends one short request to check.

   Your settings are saved only once the sign-in token is in hand (the only
   settings it changes before that are Claude Code's two flags above), so a
   run that stops halfway leaves an earlier working setup as it was.

## What the sign-in needs

| System  | The helper opens the sign-in when                                                                                                                                                                                            | Otherwise                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| macOS   | Google Chrome, Chromium or Microsoft Edge is in /Applications                                                                                                                                                                | paste a token: install one, or sign in elsewhere |
| Windows | Google Chrome or Microsoft Edge is installed (Edge comes with Windows)                                                                                                                                                       | the same                                         |
| Linux   | `bwrap`, `Xephyr`, `chromium` and `node` 24.5+ are in `/usr/bin`, Claude Code is installed under `/usr` (Anthropic's apt, dnf or apk repository), and a local X11 desktop is running; see [login-client.md](login-client.md) | paste a token from a Mac or Windows setup        |

On Linux the copy of Claude Code the setup installs in `~/.aitheroute/claude`
runs your sessions, but the isolated sign-in needs a system one under `/usr`.
A Linux server without a desktop is the common case: run the same command on
your own computer first and paste its sign-in token on the server when asked.

## Where it works

- **Claude Code in a terminal** on macOS, Linux and Windows, including the
  terminal inside VS Code, Cursor and JetBrains IDEs, and the JetBrains plugin,
  which runs `claude` in the IDE's terminal.
- **The VS Code / Cursor extension** brings its own Claude Code and takes the
  editor's environment; it is not checked yet, so not offered. The token is not
  written into the editor's settings, which Settings Sync would carry off the
  computer.
- **The Claude Desktop app is not supported.** Signed in to a Claude account it
  connects to Anthropic directly and ignores `ANTHROPIC_BASE_URL` and
  `settings.json`.

Claude Code's binaries are never modified: it is installed from npm as
published, and the setup only writes its settings (`~/.claude.json`,
`~/.claude/settings.json`) and the environment, on your own computer only.

## The leak guard (optional)

The setup asks once its check has passed (default no), and
`sh ~/.aitheroute/start.sh protect on|off|status` (Windows PowerShell:
`~\.aitheroute\start.cmd protect ...`) turns it on and off at any time.

1. **Claude Code's settings** (no rights needed): `~/.claude/settings.json`
   gets `env.ANTHROPIC_BASE_URL` and the two traffic flags below, unless you
   set a flag yourself. Claude Code applies that `env` however it was started
   (an editor launched from the Dock, fish, cron), so a session goes to the
   gateway, and one without the token header is refused there rather than
   going direct.
2. **The hosts file** (administrator rights: `sudo` on macOS and Linux, the
   elevation prompt on Windows): [`hosts.mjs`](../clients/setup/hosts.mjs)
   points `api.anthropic.com`, `claude.ai`, `www.claude.ai`,
   `platform.claude.com`, `console.anthropic.com`, `downloads.claude.ai`,
   `mcp-proxy.anthropic.com` and `statsig.anthropic.com` at `0.0.0.0` and `::`
   in one marked block, then flushes the lookup cache. The Claude Desktop app
   and claude.ai in your usual browser stop opening; docs, support, status
   pages and claude.com stay open. The helper's browser and CLI leave name
   lookups to the gateway, so the sign-in works as before.

The hosts file is never replaced by a new file and never emptied first. `on`
appends the block; `off` cuts it off the end or, when lines of yours follow
it, writes over the old bytes in place after keeping an undo copy beside the
file. `on` writes in place the same way when it mends a block cut short above
lines of yours, or one that is there twice. `off`, and `on` whenever it writes
the file, first put back a write that stopped midway, from that copy. Only the block's own lines and
the blank line before it go; yours stay as they were, except that a last line
without a line end gets one. A line of yours above the block that names one of
these hosts wins over the block; `on` and `status` say which hosts. A UTF-16
hosts file is left alone, and the guard says so.

What it does not do: block by IP address (a program with built-in addresses,
or a browser or VPN with its own DNS, can still reach them), anything on
another device, or the hosts part without administrator rights (then only
part 1 is on, and it says why). While it is on, Claude Code's auto-update is
off; the copy the setup installed updates when you run `start` again.

## Why it is built this way

- **npm and two flags.** The npm registry and nodejs.org answer where
  `downloads.claude.ai` refuses or cannot be reached. Claude Code's first-run
  check goes to `api.anthropic.com` directly, past the gateway;
  `hasCompletedOnboarding` in `~/.claude.json` marks the first run as done, so
  the session talks to the gateway only. It is an internal field, not a
  documented setting, and may change. `skipWebFetchPreflight` (documented)
  keeps WebFetch's domain check away.
- **Traffic flags.** `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off
  Claude Code's other direct traffic: the auto-updater, telemetry, error
  reports and feature flags, so features that depend on them (Remote Control,
  for one) are not there. `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`
  (documented) skips the official plugin marketplace an interactive first start
  fetches; `claude plugin marketplace add` still adds it by hand. Measured with
  Claude Code 2.1.332 behind a proxy that let nothing out: with these settings
  an interactive session opened nothing but the gateway; without the first flag
  it opened `api.anthropic.com` 12 times, `raw.githubusercontent.com` and
  `downloads.claude.ai`.
- **The token in the address.** The command stays in your shell's history
  (`~/.zsh_history`, PSReadLine's `ConsoleHost_history.txt`), and while `curl`
  runs, other users of a shared Linux machine can see it in `ps`. Reissuing the
  token in the bot ends both. The archive asks for the command instead, so it
  leaves no history.
- **Settings in `~/.aitheroute/env.sh`.** The values, the tokens among them, are
  in a file only you can read (written as a new 0600 file and renamed over the
  old one). The shell's startup file gets one marked block that loads it while
  it exists, so deleting the folder undoes the setup. Windows keeps the values
  as user environment variables, `Path` through the registry so its
  `%VARIABLES%` stay unexpanded.
- **The sign-in token.** `claude setup-token` prints a one-year token wrapped to
  the terminal width; the setup records the session and joins the pieces back.
  Where it cannot (Windows), you paste it. The sign-in runs without the
  gateway's variables, an API key or an older sign-in in its environment.
- **The check** runs in `~/.aitheroute`, not in the folder you started from: a
  project's own `.claude` settings and hooks are not the setup's to run.
- **Open source.** Everything of ours is plain text you can read before it
  runs: the first stage, the start scripts, the setup and the helper. The only
  binaries it fetches are Node.js from nodejs.org, when yours is missing or
  older than 24.5 (the published SHA-256 checked), and Claude Code from npm, as
  published.

The folder takes about 600 MB: Node.js about 200 MB, Claude Code about 380 MB.

## Removing it

1. If you turned the leak guard on, turn it off first: `protect off` (above).
   Folder already deleted, so there is nothing to run `protect off` with? Then
   take its parts out by hand: from `env` in `~/.claude/settings.json`,
   `ANTHROPIC_BASE_URL` with the gateway's address and, unless you set them
   yourself, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and
   `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`; from the hosts file
   (`/etc/hosts`, on Windows `C:\Windows\System32\drivers\etc\hosts`), the
   block from `# >>> AI The Route leak guard >>>` to
   `# <<< AI The Route leak guard <<<`, which needs administrator rights.
2. Delete `~/.aitheroute`. The block in your shell's startup file
   (`# >>> AI The Route >>>`) then does nothing; delete it when you like.
3. On Windows, in "Environment Variables" for your user, delete
   `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_OAUTH_TOKEN`,
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
   `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`, and the entry
   `C:\Users\<you>\.aitheroute\claude` (your `%USERPROFILE%\.aitheroute\claude`)
   in `Path` (there only if the setup installed Claude Code).
4. Optional: `hasCompletedOnboarding` in `~/.claude.json` and
   `skipWebFetchPreflight` in `~/.claude/settings.json` stay. They are Claude
   Code's own flags and harmless; delete them to see the first-run screens
   again.

## Files

| Path                                        | What                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `clients/setup/install.sh`, `install.ps1`   | the first stage, filled in by the gateway                                                 |
| `clients/setup/bundle/`                     | the archive's top: README, `start.sh`, `start.ps1`, `start.cmd`                           |
| `clients/setup/*.mjs`, `ru.json`, `en.json` | the setup and its words (`setup/` in the archive)                                         |
| `clients/setup/package-setup.py`            | builds both archives; the helper's file list comes from `clients/login/package-client.py` |

## Tests

```sh
node --test clients/setup/test/*.test.mjs     # macOS, Linux
node --test clients/login/test/*.test.mjs     # Linux
```

The setup's suite covers every module, every stop of the setup with its steps
replaced, and `start.sh` against the real helper. The helper's suite is kept
for Linux, where its isolated session runs; on macOS two of its tests fail on
the system's `/var` link and the Linux-only strict mode.
