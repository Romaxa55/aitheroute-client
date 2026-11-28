#!/bin/sh
# AI The Route: Claude Code with your own subscription, macOS and Linux.
#   sh start.sh
# Run it from the unpacked archive or from ~/.aitheroute: it copies itself to
# ~/.aitheroute, finds Node.js 24.5+ or fetches it from nodejs.org (checking
# the published SHA-256), and runs setup/core.mjs. The one-command install
# (install.sh) runs this same file. Nothing needs administrator rights (only the
# optional leak guard's hosts part asks for them, setup/guard.mjs).

say() { printf '%s\n' "$*"; }
fail() {
  printf 'AI The Route: %s\n' "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }
# A message from setup/<lang>.json: one "key": "value" per line, as the repository keeps it.
msg() {
  sed -n 's/^  "'"$1"'": "\(.*\)",\{0,1\}$/\1/p' "$words" 2>/dev/null | sed 's/\\"/"/g' | head -n 1
}
node_ok() {
  has node && node -e 'const [a, b] = process.versions.node.split(".").map(Number)
    process.exit(a > 24 || (a === 24 && b >= 5) ? 0 : 1)' 2>/dev/null
}

fetch_node() {
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail "$(msg os)" ;; esac
  case "$(uname -m)" in x86_64 | amd64) cpu=x64 ;; arm64 | aarch64) cpu=arm64 ;; *) fail "$(msg os)" ;; esac
  say "$(msg node)"
  dist=https://nodejs.org/dist/latest-v24.x
  tmp=$(mktemp -d) || fail "$(msg download)"
  curl -fsSL "$dist/SHASUMS256.txt" -o "$tmp/sums" || fail "$(msg download)"
  file=$(grep -o "node-v[0-9.]*-$os-$cpu\.tar\.gz" "$tmp/sums" | head -n 1)
  [ -n "$file" ] || fail "$(msg os)"
  curl -fsSL "$dist/$file" -o "$tmp/$file" || fail "$(msg download)"
  want=$(grep " $file\$" "$tmp/sums" | cut -d ' ' -f 1)
  if has sha256sum; then got=$(sha256sum "$tmp/$file" | cut -d ' ' -f 1)
  else got=$(shasum -a 256 "$tmp/$file" | cut -d ' ' -f 1); fi
  [ -n "$want" ] && [ "$want" = "$got" ] || fail "$(msg checksum)"
  rm -rf "$base/node" && mkdir -p "$base/node" || fail "$(msg download)"
  tar -xzf "$tmp/$file" -C "$base/node" --strip-components 1 || fail "$(msg download)"
  rm -rf "$tmp"
}

# Each part replaced whole, so a newer archive never leaves an older file behind.
copy_home() {
  for item in README.md start.sh start.cmd start.ps1 setup helper; do
    [ -e "$here/$item" ] || continue
    rm -rf "$base/$item.new" && cp -R "$here/$item" "$base/$item.new" &&
      rm -rf "$base/$item" && mv "$base/$item.new" "$base/$item" || fail "$(msg download)"
  done
}

main() {
  here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) || exit 1
  base="$HOME/.aitheroute"
  if [ -z "$AITR_LANG" ]; then
    case "${LC_ALL:-${LC_MESSAGES:-$LANG}}" in ru*) AITR_LANG=ru ;; *) AITR_LANG=en ;; esac
  fi
  words="$here/setup/$AITR_LANG.json"
  [ -f "$here/setup/core.mjs" ] || fail "setup/core.mjs is missing: unpack the whole archive."
  has curl && has tar || fail "$(msg tools)"
  # Private: the login helper refuses a folder others can read. Set again on every run.
  (umask 077 && mkdir -p "$base") && chmod 700 "$base" || fail "$(msg download)"
  [ "$here" = "$(cd "$base" && pwd)" ] || copy_home
  words="$base/setup/$AITR_LANG.json"
  # A Node.js this setup fetched before, or the person's own if new enough.
  [ -x "$base/node/bin/node" ] && PATH="$base/node/bin:$PATH"
  node_ok || { fetch_node && PATH="$base/node/bin:$PATH"; }
  node_ok || fail "$(msg nodeFailed)"
  export PATH AITR_LANG
  # The leak guard by hand: sh ~/.aitheroute/start.sh protect on|off|status (setup/guard.mjs).
  if [ "${1:-}" = protect ]; then
    shift
    exec node "$base/setup/protect.mjs" "$@"
  fi
  # Started from `curl | sh`, stdin is not the terminal: the questions need it.
  if [ -t 0 ]; then exec node "$base/setup/core.mjs"; fi
  (: </dev/tty) 2>/dev/null || fail "$(msg tty)"
  exec node "$base/setup/core.mjs" </dev/tty
}

main "$@"
