#!/usr/bin/env bash
#
# Build the node program for "Keep a copy" on the Mac (ADR 0068, step 2).
#
# The app fetches it from birdbrain.wtf/app/node/ when a member switches a full node on.
# This builds it for Apple silicon from the open Seeds repository and copies it onto the
# Zo mount. Zo then signs and publishes it with Birdbrain's key:
#
#   Mac:  bash ~/Zo/lab/murmur/scripts/mac-node-build.sh
#   Zo:   bun run scripts/publish-node.ts release/node/seeds-node-darwin-aarch64 darwin-aarch64
#
# Only needed when the node changes, not at every app release. A cold build is long:
# the Polkadot SDK is large. Needs rustup, Xcode CLT (clang) and protoc (brew install protobuf).
#
set -euo pipefail

ZO="${ZO_MOUNT:-$HOME/Zo}"
OUT="$ZO/lab/murmur/release/node"
REPO="$HOME/seeds-build"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$ZO/lab/murmur" ] || die "Zo mount not found at $ZO (set ZO_MOUNT to override)"
command -v cargo >/dev/null || die "Rust/cargo not on PATH: install via https://rustup.rs"
command -v protoc >/dev/null || die "protoc missing: brew install protobuf"
xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools missing: xcode-select --install"
[ "$(uname -m)" = "arm64" ] || die "this builds the Apple-silicon node; run it on an arm64 Mac"

say "fetching github.com/Birdbrain-wtf/seeds → $REPO"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" pull --ff-only
else
  git clone https://github.com/Birdbrain-wtf/seeds "$REPO"
fi

say "building seeds-node (release)"
cd "$REPO/chain"
cargo build --release -p seeds-node

BIN="$REPO/chain/target/release/seeds-node"
VERSION="$("$BIN" --version | awk '{print $NF}')"
[ -n "$VERSION" ] || die "the node didn't report a version"

mkdir -p "$OUT"
cp "$BIN" "$OUT/seeds-node-darwin-aarch64"
echo "$VERSION" > "$OUT/seeds-node-darwin-aarch64.version"

say "done: seeds-node $VERSION"
echo "  copied to $OUT/seeds-node-darwin-aarch64"
echo "  now on Zo: cd lab/murmur && bun run scripts/publish-node.ts release/node/seeds-node-darwin-aarch64 darwin-aarch64"
