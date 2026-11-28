# The sign-in helper

The helper ([`clients/login`](../clients/login)) opens a provider's own sign-in
page, or runs its CLI's login, through the same gateway route your requests
take. The one-command setup runs it for Claude Code by itself; this page is for
running it by hand and for what it does and does not do.

It runs on Linux, macOS and Windows with Node.js 24.5 or later.

## Two modes

- **Linux: strict mode.** The browser, the CLI and the sign-in's local callback
  share one isolated session: unprivileged user and network namespaces,
  Bubblewrap, a nested Xephyr display, Chromium and Node.js from the system
  (`/usr/bin/bwrap`, `/usr/bin/Xephyr`, `/usr/bin/chromium`, `/usr/bin/node`)
  and a local X11 or XWayland desktop. The session has no network interface of
  its own: direct IPv4, IPv6, UDP and DNS have nowhere to go, and names are
  resolved at the gateway. The helper starts the confined browser before it
  offers the sign-in, and stops the session if a check fails.
- **macOS and Windows: standard mode.** Google Chrome, Chromium or Microsoft
  Edge in /Applications on macOS, Google Chrome or Microsoft Edge on Windows
  (or the browser in `AITR_BROWSER`, any Chromium-based one) opens in a
  separate window with a fresh temporary profile. Its pages and WebRTC go only
  through the gateway, its secure DNS is off, and its background services are
  off. A browser managed by an organisation can override this with its
  policies: use a computer you manage yourself. A CLI runs with the route as
  its proxy and keeps its sign-in in a private home of its own
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`), so your own CLI
  login, git and ssh setup stay as they are. Codex started directly
  (`run chatgpt -- codex ...`) gets
  `-c features.system_proxy_fallback=false -c features.respect_system_proxy=false`,
  which turn off its two ways around the proxy; started through `npx` or a
  script of your own, it gets neither and can go around the proxy.

What standard mode does not do: there is no network isolation. Other programs,
your usual browser and other devices use your own connection, and while a
session runs any program on this computer can reach the provider's sites
through the helper's local port. Open sign-in links only in the helper's
window: a link opened in your usual browser, an email, Telegram or another
device signs in over that device's own connection, not through the route.

- On macOS a CLI that opens its link with `open` gets the helper's window by
  itself. Claude Code does.
- Gemini CLI prints its link: open it in the helper's window and paste the
  code back into the terminal.
- For Codex use `codex login --device-auth` and open the link it shows in the
  helper's window.
- On Windows a CLI may open your usual browser. Do not sign in there: copy the
  printed link into the helper's window.
- On macOS closing the window leaves the browser running: press
  **Завершить сеанс** (end session) or quit it with Cmd+Q.

## Running it

1. In the bot, press **Instructions** under the message with your
   token and unpack the ZIP into a new folder. The one-command setup puts the
   same files in `~/.aitheroute/helper`.
2. Pair it with the gateway, then paste the one-time code the bot shows (it
   stays out of your shell history):

   ```sh
   node clients/login/cli.mjs pair https://<gateway>
   ```

3. Run the command for your token. A local status page opens at
   `http://127.0.0.1:…`; keep it and the terminal open for the session.
4. When the page confirms the route, press **Начать вход** (start sign-in) or
   **Открыть регистрацию** (open registration). Enter passwords, keys and MFA
   codes only where the provider asks for them. **Завершить сеанс**, Ctrl+C or
   closing the terminal stops it: the window closes and its temporary profile,
   with the provider's cookies, is deleted. On Windows a closed console gives
   a program only a few seconds before Windows ends it, and a slow browser exit
   can take longer: there, use the button or Ctrl+C, which have no such limit.

| Token                | Browser                                               | CLI login                                                             |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| Claude subscription  | `node clients/login/cli.mjs open anthropic`           | `node clients/login/cli.mjs run anthropic -- claude setup-token`      |
| Anthropic Console    | `node clients/login/cli.mjs open anthropic --console` | create an API key in the console                                      |
| OpenAI API           | `node clients/login/cli.mjs open openai`              | create a project API key                                              |
| ChatGPT subscription | `node clients/login/cli.mjs open chatgpt`             | `node clients/login/cli.mjs run chatgpt -- codex login --device-auth` |
| Gemini API key       | `node clients/login/cli.mjs open gemini`              | create an API key in AI Studio                                        |
| Gemini CLI           | `node clients/login/cli.mjs open gemini-cli`          | `node clients/login/cli.mjs run gemini-cli -- gemini`                 |

Claude Code needs the helper once: `claude setup-token` through it signs in and
prints a one-year token, which the setup saves as `CLAUDE_CODE_OAUTH_TOKEN`.
A plain `claude` then needs no helper, as that token is not refreshed. Make the
terminal wide first: a token broken over several lines does not paste as one.

On Linux the CLI must be the official one in `/usr/bin` or `/usr/local/bin`
with its runtime under `/usr`; on macOS and Windows any executable on `PATH`
works. In Gemini CLI choose **Sign in with Google**. Whether you may sign up, pay,
recover an account or pass verification is up to the provider.

## What the checks mean

Before it enables the sign-in, the helper sends a fresh random challenge to
the gateway through its authenticated tunnel and checks the answer, then checks
the provider's certificate through the route without fetching a page or
sending anything of yours. The checks repeat before the launch and during the
session; a failure stops it. A passed check is about this route only: the
provider's own page or CLI tells you whether the sign-in worked.

## What it keeps

- `~/.aitheroute/login/<provider>.json`: the pairing. The gateway renews it for
  up to seven days while your access is paid; pairing again replaces it.
- The provider's private home (find it with
  `node clients/login/cli.mjs profile <provider>`): the CLI's sign-in and
  settings, under `~/.aitheroute/profiles/<provider>/`. Pairing with another
  gateway or token asks whether to start clean or keep the old home; both keep
  the old files on disk. Until you choose, the helper does not open that
  provider. If you pressed Return at the question or piped the code in, the
  pairing is saved: choose on the status page, or with
  `node clients/login/cli.mjs select <provider> clean` (or `reuse`).

An offline preview of the status page, for a look without a session (it
writes a new file and stops if one with that name is already there):

```sh
node clients/login/cli.mjs preview registration-preview.html
```
