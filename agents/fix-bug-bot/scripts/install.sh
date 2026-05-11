#!/usr/bin/env bash
# fix-bug-bot/scripts/install.sh
# 编译并安装 fix-bug-bot 到 msctl agents 目录

set -euo pipefail

AGENTS_DIR="${HOME}/.config/msctl/agents"
mkdir -p "$AGENTS_DIR"

echo "Building fix-bug-bot..."
cargo build --release

echo "Installing binary..."
cp target/release/fix-bug-bot "$AGENTS_DIR/fix-bug-bot"
chmod +x "$AGENTS_DIR/fix-bug-bot"

echo "Installing manifest..."
cp fix-bug-bot.toml "$AGENTS_DIR/fix-bug-bot.toml"

echo "Registering plugin..."
msctl agent register --type plugin --name fix-bug-bot

echo "Done. Restart msctl serve to activate fix-bug-bot."
