#!/bin/bash

# Get absolute path to script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Create required directories
mkdir -p "$PROJECT_DIR/freeswitch/log" "$PROJECT_DIR/freeswitch/db"

# Start FreeSWITCH natively (installed via Homebrew) in foreground
/opt/homebrew/bin/freeswitch \
  -c \
  -nonat \
  -conf "$PROJECT_DIR/freeswitch/conf" \
  -log "$PROJECT_DIR/freeswitch/log" \
  -db "$PROJECT_DIR/freeswitch/db"
