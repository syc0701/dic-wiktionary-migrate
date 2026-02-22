#!/bin/bash
# Install Node.js (LTS) via NodeSource - supports Debian/Ubuntu and RHEL/CentOS/Amazon Linux
set -e

if [ -f /etc/debian_version ]; then
  # Debian, Ubuntu
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
elif [ -f /etc/redhat-release ] || [ -f /etc/system-release ]; then
  # RHEL, CentOS, Amazon Linux
  curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
  if command -v dnf &>/dev/null; then
    sudo dnf install -y nodejs
  else
    sudo yum install -y nodejs
  fi
else
  echo "Unsupported OS. Install Node.js manually: https://nodejs.org/"
  exit 1
fi

node -v
npm -v
