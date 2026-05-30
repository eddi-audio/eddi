#!/bin/bash
# Run once on a fresh Pi to set up Eddi
set -e

echo "→ Setting hostname to eddi..."
sudo hostnamectl set-hostname eddi

echo "→ Installing avahi-daemon..."
sudo apt update -q
sudo apt install -y avahi-daemon nodejs

echo "→ Enabling avahi..."
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

echo "→ Installing systemd services..."
sudo cp /home/pi/eddi/pi/eddi-setup.service /etc/systemd/system/
sudo cp /home/pi/eddi/pi/librespot.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable eddi-setup librespot
sudo systemctl start eddi-setup

echo ""
echo "✓ Done. Open http://eddi.local in a browser on the same network to connect Spotify."
