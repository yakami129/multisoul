#!/usr/bin/env bash
# bugfix-bot/scripts/install.sh
# 编译并安装 bugfix-bot 到 msctl agents 目录

set -euo pipefail

AGENTS_DIR="${HOME}/.config/msctl/agents"
mkdir -p "$AGENTS_DIR"

echo "Building bugfix-bot..."
cargo build --release

echo "Installing binary..."
cp target/release/bugfix-bot "$AGENTS_DIR/bugfix-bot"
chmod +x "$AGENTS_DIR/bugfix-bot"

echo "Installing manifest..."
cp bugfix-bot.toml "$AGENTS_DIR/bugfix-bot.toml"

echo "Registering plugin..."
msctl agent register --type plugin --name bugfix-bot

echo "Done. Restart msctl serve to activate bugfix-bot."
