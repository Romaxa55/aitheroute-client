#!/bin/sh
# AI The Route: Claude Code in one command, macOS and Linux.
#   curl -fsSL https://<gateway>/i/<token> | sh
# The gateway fills in its origin, the token and the messages below. This
# stage only fetches the setup archive (the same one the bot offers to
# download) into a temporary folder and runs its start.sh, which copies it to
# ~/.aitheroute and does the rest. Nothing needs administrator rights (only the
# optional leak guard's hosts part asks for them, setup/guard.mjs).
#@@VARS@@

fail() {
  printf 'AI The Route: %s\n' "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

main() {
  [ -z "$AITR_STOP" ] || fail "$AITR_STOP"
  has curl && has tar || fail "$M_tools"
  (: </dev/tty) 2>/dev/null || fail "$M_tty"
  printf '%s\n' "$M_core"
  tmp=$(mktemp -d) || fail "$M_download"
  # To a file first: macOS tar takes an empty input as an empty archive.
  curl -fsSL "$AITR_ORIGIN/setup/aitheroute.tar.gz" -o "$tmp/aitheroute.tar.gz" &&
    tar -xzf "$tmp/aitheroute.tar.gz" -C "$tmp" && [ -f "$tmp/aitheroute/start.sh" ] || {
    rm -rf "$tmp"
    fail "$M_download"
  }
  export AITR_ORIGIN AITR_TOKEN AITR_LANG
  sh "$tmp/aitheroute/start.sh" </dev/tty
  # Not `status`: zsh keeps that name read-only, and this may run under zsh.
  code=$?
  rm -rf "$tmp"
  exit "$code"
}

main
