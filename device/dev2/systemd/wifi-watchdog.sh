#!/bin/bash
# eddi wifi-watchdog — self-heal dev1's "alive but off-network" WiFi drops.
#
# dev1's brcmfmac WiFi intermittently disassociates while the box stays powered,
# leaving it invisible to the LAN (and killing the Spotify Web Playback SDK
# stream — playback just stops). The systemd hardware watchdog
# (RuntimeWatchdogSec) only catches CPU freezes, NOT this off-network-but-alive
# state, so nothing recovers it without a hand at the plug.
#
# Run every ~60s by wifi-watchdog.timer: ping the gateway and, on sustained
# failure, re-associate; reboot as a last resort if the radio is wedged.
# Logs to /var/log/wifi-watchdog.log (survives reboots) + the journal.
set -u

CONN="netplan-wlan0-Altbach Seattle" # NetworkManager connection name (eddi2/netplan-managed)
STATE="/run/wifi-watchdog.fails"     # consecutive-failure counter (tmpfs; resets on boot, fine)
LOG="/var/log/wifi-watchdog.log"
REBOOT_AFTER=5                       # consecutive failed cycles (~5 min) before rebooting

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" | logger -t wifi-watchdog; }

gw="$(ip route 2>/dev/null | awk '/^default/{print $3; exit}')"

# Healthy if we can reach the default gateway OR a public anycast resolver.
if { [ -n "$gw" ] && ping -c1 -W3 "$gw" >/dev/null 2>&1; } || ping -c1 -W3 1.1.1.1 >/dev/null 2>&1; then
    if [ -f "$STATE" ]; then log "connectivity restored"; rm -f "$STATE"; fi
    exit 0
fi

fails="$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))"
echo "$fails" > "$STATE"
sig="$(awk 'NR==3{gsub(/\./,"",$4); print $4}' /proc/net/wireless 2>/dev/null)"
log "no connectivity (fail #$fails, gw=${gw:-none}, signal=${sig:-?}dBm)"

if [ "$fails" -ge "$REBOOT_AFTER" ]; then
    log "still down after $fails cycles — rebooting"
    rm -f "$STATE"
    exec /sbin/reboot
fi

# Re-associate; if NetworkManager itself is stuck, bounce it and retry.
if nmcli con up "$CONN" >/dev/null 2>&1; then
    log "issued nmcli con up '$CONN'"
else
    log "nmcli con up failed — restarting NetworkManager"
    systemctl restart NetworkManager
    sleep 5
    nmcli con up "$CONN" >/dev/null 2>&1 && log "reconnected after NM restart"
fi
exit 0
