# What a gateway must answer

AI The Route's gateway is not published: it runs the service and holds its
keys. The setup and the sign-in helper in this repository talk to it over a
few HTTPS routes, listed here, so you can write a gateway of your own that
they work with. Each part also says what ours does.

The smallest gateway is the API pass-through alone ([below](#the-api-pass-through)).
Set `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS` yourself, and you need
neither the setup nor the helper. Anthropic's
[LLM gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol)
says what Claude Code expects of any gateway; read it first.

## The basics

- **The origin** is `https://` with a DNS name, not an IP address, and no path:
  every route below, the API among them, is served from the root.
- **The token** travels in the `x-aitheroute-token` header (the name is fixed
  in the client) and is made of `A-Z a-z 0-9 _ -`.
- **No redirects:** the helper refuses one.

## The routes

| Route                                                    | Called by                             | Answer                                                                      |
| -------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `GET /i/<token>[/<lang>]`, `GET /i/<token>/win[/<lang>]` | `curl … \| sh`, `irm … \| iex`        | the first stage, filled in ([below](#the-first-stage))                      |
| `GET /setup/aitheroute.tar.gz`, `/setup/aitheroute.zip`  | the first stage                       | the archives [`package-setup.py`](../clients/setup/package-setup.py) builds |
| `POST /login/install`, header `x-aitheroute-token`       | the setup                             | a pairing code ([below](#pairing-the-helper))                               |
| `POST /login/pair`, body `{"code"}`                      | the helper                            | the helper's own credential                                                 |
| `POST /login/renew`, body `{"credential"}`               | the helper                            | the same credential, renewed                                                |
| `wss://<gateway>/login/tunnel`                           | the helper                            | the sign-in tunnel ([below](#the-sign-in-tunnel))                           |
| everything else (`/v1/messages`, …)                      | Claude Code, via `ANTHROPIC_BASE_URL` | Anthropic's API, passed through                                             |

## The first stage

[`install.sh`](../clients/setup/install.sh) and
[`install.ps1`](../clients/setup/install.ps1) hold one line, `#@@VARS@@`. The
gateway puts assignments there, single-quoted for that shell (PowerShell also
takes the curly quotes U+2018 to U+201B as quotes, so double those too):

- `AITR_ORIGIN`: the gateway's own origin;
- `AITR_TOKEN`: the token, or empty when the gateway refuses it;
- `AITR_LANG`: `ru` or `en`;
- `AITR_STOP`: empty, or the reason the token is refused, in that language.
  The script then prints it and stops;
- `M_tools`, `M_tty`, `M_download`, `M_core`: the first stage's messages, from
  [`clients/setup/<lang>.json`](../clients/setup/en.json).

Answer a refused token with `200` and `AITR_STOP` filled in, not with a 4xx:
`curl -f` drops the body of an error, and the person would see no reason. Ours
does that, uses `ru` when the address names no language, and slows down an
address that keeps trying unknown tokens.

## Pairing the helper

1. **`/login/install`** answers `{"code": "…", "provider": "anthropic"}`. The
   code is 32 to 2048 characters with no whitespace, and must stay valid for
   at least 5 minutes: the setup uses it up to then. The setup reads the
   answer this way:
   - no answer, a 5xx, or a 2xx without a string `code`: the network;
   - `410`: the token is over; `429`: too many tries; any other refusal: a
     token that does not work;
   - a `provider` other than `anthropic`: a token for another tool.
2. **`/login/pair`** answers
   `{"provider", "credential", "expiresAt", "tokenId"}`:
   - `provider`: `anthropic` for Claude Code (the helper also knows `openai`,
     `chatgpt`, `gemini`, `gemini-cli`);
   - `credential`: a non-empty string, the helper's own, not your token;
   - `expiresAt`: Unix time in **milliseconds**, an integer;
   - `tokenId`: optional; when present, `tok_` and 1 to 100 of
     `A-Z a-z 0-9 _ -`.
3. **`/login/renew`** runs when less than 2 minutes are left. It must answer
   the same `credential`, `provider` and `tokenId` with a later `expiresAt`;
   anything else makes the helper ask for a new pairing.

On either call, `401`, `403` or `410` tells the person to get a new pairing
code; any other refusal ends the session as a gateway error. Ours keeps a code
10 minutes and a credential an hour, renewable for up to 7 days.

## The sign-in tunnel

The helper brings the sign-in page and the CLI's login to the provider through
the gateway, without the gateway seeing inside:

1. It opens a WebSocket to `/login/tunnel` and sends one text message,
   `{"credential", "host", "port": 443}`.
2. The gateway connects to `host:443` and answers the text `ok`, within 20 s.
   From then on both sides send raw bytes as binary messages (the helper sends
   up to 16 KiB at a time and takes up to 1 MiB). TLS runs between the browser
   (or the CLI) and the provider, so the gateway relays it and cannot decrypt
   it.
3. `check.login.invalid` is the route check. The gateway answers `ok` as for
   any host but connects nowhere. The helper then sends 32 random bytes in one
   binary message; the gateway answers `AITR1` followed by the same 32 bytes in
   one binary message and closes. Next, the helper opens real TLS through the
   tunnel to the sign-in page's host and checks its certificate. Only then is
   the sign-in enabled; both checks repeat every 10 s.

Which hosts to let through is the gateway's choice. Ours takes, for Claude:
`claude.ai`, `claude.com`, `platform.claude.com`, `platform.claude.ai`,
`console.anthropic.com`, `sso.claude.com`, `api.anthropic.com`,
`assets.claude.ai`, `assets-proxy.anthropic.com`, `s-cdn.anthropic.com`,
`challenges.cloudflare.com`, `hcaptcha.com` and one level of names under it,
and Google's sign-in hosts (`accounts.google.com`, `accounts.gstatic.com`,
`ssl.gstatic.com`, `www.gstatic.com`, `oauth2.googleapis.com`,
`www.googleapis.com`). It also reads the server name in the TLS ClientHello
before it sends anything on, refuses a name other than `host` (with
[`client-hello.ts`](../apps/proxy/src/login/client-hello.ts), the one file here
that comes from the gateway), connects only to public addresses, and sends the
tunnel out through the token's exit server, so the sign-in comes from where
the requests do.

## The API pass-through

What ours does with a request to the model:

1. **The token.** It takes `x-aitheroute-token`, computes its SHA-256 and looks
   the hash up. A token that is unknown, expired or revoked gets **403, not
   401**: Claude Code takes a 401 for its own sign-in gone stale and retries
   for minutes, while a 403 it shows at once. Nothing goes to Anthropic. The
   token itself is never stored. After 20 failures from one address in 10
   minutes, that address gets 429.
2. **The headers.** It drops its own header, the hop-by-hop ones (`Connection`
   and those it names, `Keep-Alive`, `TE`, `Trailer`, `Transfer-Encoding`,
   `Upgrade`, `Proxy-Authorization`, `Proxy-Connection`) and `Forwarded`,
   `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
   `X-Forwarded-Port`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, and
   sets `Host`. Everything else, `Authorization`, `x-api-key` and
   `anthropic-beta` among it, is passed on as it is, unread. A subscription
   needs `anthropic-beta` untouched.
3. **The destination** is fixed: `https://api.anthropic.com`, with its
   certificate checked. Nothing in a request can send it elsewhere.
4. **The exit.** The request leaves from an exit server in the token's
   country. In a pool of 2 to 9 servers every token of one person uses the
   same server; another one there takes over while that one is down, or for
   good once an hourly run has replaced it. With no server alive the answer is
   502, and with the token's pool gone from the configuration 503: never a
   request from the gateway's own address.
5. **Streaming.** The body and the answer are relayed as they come. The
   gateway does not buffer them, unpack them or parse them, so Claude Code
   prints the answer as it does without a gateway.

The proxy logs the time, the token's id (not the token), the client's address,
the provider, the pool, the method, the path without its query, the status,
the duration and an error, if any. It does not log prompts, answers or
credentials. [PRIVACY.md](../PRIVACY.md) lists everything the service keeps.

## Whose credentials go through it

A gateway in front of Claude Code with an Anthropic API key is a documented
setup ([LLM gateway](https://code.claude.com/docs/en/llm-gateway)). For Claude
subscriptions, Anthropic's
[rule on credentials](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
says: "Anthropic does not permit third-party developers to offer Claude.ai
login into their own applications, or to route requests through Free, Pro,
Max, or Ultra plan credentials on behalf of their users. Moreover, developers
may not collect, store, or intermediate Claude.ai credentials or session
tokens — sign-in to a Claude account must complete through Anthropic's own
flow." Read it before you choose a gateway, yours or ours.
