#!/usr/bin/env bash
# ==============================================================================
# 🌲 World Tree - Master All-in-One Setup Script (Linux / Production / Dev)
# ==============================================================================
# Usage:
#   bash setup.sh
# ==============================================================================
set -Eeuo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "\n${BOLD}${GREEN}🌲 World Tree Master Provisioning & Setup${RESET}"
echo -e "${CYAN}Executing complete system, network, dependency, and database setup...${RESET}\n"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 1. System Package Provisioning (Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo -e "${BOLD}${CYAN}=== [ System Packages & Toolchain Check ] ===${RESET}"
  
  # Check for DNF (Oracle Linux / RHEL)
  if command -v dnf &> /dev/null; then
    if ! command -v ffmpeg &> /dev/null || ! command -v yt-dlp &> /dev/null || ! command -v wg &> /dev/null; then
      echo -e "  ${YELLOW}Installing missing multimedia/wireguard system tools via dnf...${RESET}"
      sudo dnf install -y epel-release 2>/dev/null || true
      sudo dnf install -y ffmpeg-free wireguard-tools 2>/dev/null || true
    fi
  # Check for APT (Ubuntu / Debian)
  elif command -v apt-get &> /dev/null; then
    if ! command -v ffmpeg &> /dev/null || ! command -v yt-dlp &> /dev/null || ! command -v wg &> /dev/null; then
      echo -e "  ${YELLOW}Installing missing multimedia/wireguard system tools via apt...${RESET}"
      sudo apt-get update -qq && sudo apt-get install -y ffmpeg wireguard-tools python3 2>/dev/null || true
    fi
  fi

  # Check & Install latest yt-dlp binary if missing
  if ! command -v yt-dlp &> /dev/null; then
    echo -e "  ${YELLOW}Installing latest yt-dlp binary to /usr/local/bin/yt-dlp...${RESET}"
    sudo curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp || true
    sudo chmod a+rx /usr/local/bin/yt-dlp 2>/dev/null || true
  fi

  # Check Cloudflare WARP IPv6 WireGuard interface
  if [[ -f "/etc/wireguard/warp.conf" ]]; then
    if ! ip link show warp &>/dev/null; then
      echo -e "  ${YELLOW}Activating WireGuard Cloudflare WARP IPv6 tunnel...${RESET}"
      sudo systemctl enable --now wg-quick@warp 2>/dev/null || true
    fi
  fi
fi

# 2. Run the Cross-Platform Master Setup Script
if command -v node &> /dev/null; then
  node scripts/setup.js
elif command -v node-22 &> /dev/null; then
  node-22 scripts/setup.js
else
  echo -e "  ${RED}✗ Node.js runtime not found. Please install Node.js 20+ or 22+ before continuing.${RESET}"
  exit 1
fi

# 3. Manage Systemd Service in Production (if present)
if [[ "$OSTYPE" == "linux-gnu"* ]] && [[ -f "/etc/systemd/system/world-tree.service" ]]; then
  echo -e "\n${BOLD}${CYAN}=== [ Systemd Service Startup ] ===${RESET}"
  echo -e "  Reloading and restarting world-tree.service..."
  sudo systemctl daemon-reload
  sudo systemctl enable world-tree.service
  sudo systemctl restart world-tree.service
  sleep 2
  
  if systemctl is-active --quiet world-tree.service; then
    echo -e "  ${GREEN}✓${RESET} world-tree.service is ${GREEN}ACTIVE & RUNNING${RESET}!"
  else
    echo -e "  ${YELLOW}⚠${RESET} Service restart check: run 'sudo journalctl -u world-tree.service -n 20' to inspect."
  fi
fi

echo -e "\n${BOLD}${GREEN}✨ All setup steps completed successfully!${RESET}\n"
