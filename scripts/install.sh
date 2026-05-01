#!/usr/bin/env bash
set -euo pipefail

BINARY_SRC="dist/elefant"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"
SYSTEM_INSTALL_DIR="/usr/local/bin"
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
USE_SUDO=false

# Parse flags
for arg in "$@"; do
  if [ "$arg" = "--system" ]; then
    INSTALL_DIR="$SYSTEM_INSTALL_DIR"
    USE_SUDO=true
  fi
done

# Pre-flight check
if [ ! -f "$BINARY_SRC" ]; then
  echo "Error: '$BINARY_SRC' not found." >&2
  echo "Build it first: bun run build:cli" >&2
  exit 1
fi

INSTALL_PATH="$INSTALL_DIR/elefant"

# Create directory if needed and copy binary
if [ "$USE_SUDO" = true ]; then
  sudo mkdir -p "$INSTALL_DIR"
  sudo cp "$BINARY_SRC" "$INSTALL_PATH"
  sudo chmod +x "$INSTALL_PATH"
else
  mkdir -p "$INSTALL_DIR"
  cp "$BINARY_SRC" "$INSTALL_PATH"
  chmod +x "$INSTALL_PATH"
fi

echo "Installed: $INSTALL_PATH"
echo "Run 'elefant --version' to verify."

if [ "$INSTALL_DIR" = "$DEFAULT_INSTALL_DIR" ]; then
  # Check if it's on PATH
  if ! echo "$PATH" | grep -q "$DEFAULT_INSTALL_DIR"; then
    echo ""
    echo "Note: Add ~/.local/bin to your PATH if not already:"
    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
    echo "  source ~/.bashrc"
  fi
fi
