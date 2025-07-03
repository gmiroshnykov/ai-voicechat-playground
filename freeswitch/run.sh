#!/bin/bash

# Get absolute path to script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Create required directories
mkdir -p "$PROJECT_DIR/freeswitch/log" "$PROJECT_DIR/freeswitch/db"

echo "Starting FreeSWITCH..."

/opt/homebrew/bin/freeswitch \
  -c \
  -nonat \
  -np \
  -conf "$PROJECT_DIR/freeswitch/conf" \
  -log "$PROJECT_DIR/freeswitch/log" \
  -db "$PROJECT_DIR/freeswitch/db"
