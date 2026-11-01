#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Creates the Termux commands that start/stop the computer:
#    desktop        start it        (the Computer button runs this)
#    desktop-stop   stop it
#    desktop-size   save the default size: desktop-size 1|2|3
#  Called by setup.sh. Can also be run on its own to update
#  just these commands:   bash commands.sh
# =============================================================
set -u
case "${PREFIX:-}" in
  */com.termux/files/usr) ;;
  *) echo "Run this inside the Termux app."; exit 1 ;;
esac

cat > "$PREFIX/bin/desktop" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start the computer.
#   DESKTOP_SCALE=1|2|3 desktop   -> size (default 2, or the one saved by desktop-size)
#   DESKTOP_LANG=en desktop       -> English instead of Arabic
# Saved defaults (desktop-size 1|2|3 writes SAVED_SCALE); the variables above win
conf="$HOME/.config/tablet-desktop.conf"
SAVED_SCALE=2; SAVED_LANG=ar
[ -f "$conf" ] && . "$conf"
scale="${DESKTOP_SCALE:-$SAVED_SCALE}"
case "$scale" in 1|2|3|4) ;; *) scale=2 ;; esac
case "${DESKTOP_LANG:-$SAVED_LANG}" in en*) lang=en_US.UTF-8 ;; *) lang=ar_SA.UTF-8 ;; esac
# Same clock as the tablet: turn the UTC offset (+0300) into a POSIX TZ (<+0300>-3:00)
z="$(date +%z)"; hh="${z:1:2}"; mm="${z:3:2}"
[ "${z:0:1}" = "+" ] && s="-" || s="+"
tz="<${z}>${s}${hh#0}:${mm}"

# Runs inside Debian. GDK_GL=disable / LIBGL_ALWAYS_SOFTWARE=1 (set below) are the
# black-screen fix: GTK apps otherwise hang setting up OpenGL (Mesa DRI3) with
# Termux:X11. If xfce4-session still doesn't bring up the window manager, the
# desktop parts are started directly.
read -r -d '' SESSION <<'EOS'
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
eval "$(dbus-launch --sh-syntax)"
# Desktop icons start at the top right in Arabic, top left in English. xfdesktop
# only uses this when it places icons, so set it before it starts, and once per
# language clear the saved positions so the icons are placed from that side.
# After that, icons the user moves stay where they put them.
case "$LANG" in ar*) side=2 ;; *) side=0 ;; esac
mark="$HOME/.config/xfce4/.icons-side"
if [ "$(cat "$mark" 2>/dev/null)" != "$side" ]; then
  xfconf-query -c xfce4-desktop -p /desktop-icons/gravity -n -t int -s "$side" 2>/dev/null
  rm -f "$HOME/.config/xfce4/desktop/icons.screen0.yaml"
  mkdir -p "$(dirname "$mark")" && echo "$side" > "$mark"
fi
running() { local f; for f in /proc/[0-9]*/comm; do [ "$(cat "$f" 2>/dev/null)" = "$1" ] && return 0; done; return 1; }
xfce4-session &
s=$!
for i in $(seq 1 20); do running xfwm4 && break; sleep 1; done
if running xfwm4; then wait "$s"; exit 0; fi
echo "xfce4-session did not start the desktop; starting the parts directly" >&2
kill -9 "$s" 2>/dev/null
xfsettingsd &
xfwm4 &
sleep 2
xfdesktop &
xfce4-panel &
sleep 4
"$HOME/.local/bin/desktop-tweaks" &
wait
EOS

desktop-stop >/dev/null 2>&1
termux-wake-lock >/dev/null 2>&1
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1
nohup termux-x11 :0 >/dev/null 2>&1 &
sleep 2
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
nohup proot-distro login debian --user user --shared-tmp -- env \
  DISPLAY=:0 PULSE_SERVER=tcp:127.0.0.1 GDK_SCALE="$scale" \
  LANG="$lang" LC_ALL="$lang" LANGUAGE="${lang%%_*}" TZ="$tz" \
  XDG_RUNTIME_DIR=/tmp/runtime-user MOZ_FAKE_NO_SANDBOX=1 \
  GDK_GL=disable LIBGL_ALWAYS_SOFTWARE=1 NO_AT_BRIDGE=1 \
  bash -c "$SESSION" >"$HOME/.desktop.log" 2>&1 &
echo "The computer is starting... open the Termux:X11 app if it didn't open by itself."
echo "To stop it, come back here and type: desktop-stop"
EOF

cat > "$PREFIX/bin/desktop-stop" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Stop the computer started by 'desktop'.
pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch' 2>/dev/null
pkill -9 -f 'bin/proot' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
pulseaudio --kill 2>/dev/null
termux-wake-unlock 2>/dev/null
echo "Computer stopped."
EOF

cat > "$PREFIX/bin/desktop-size" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Save the size the computer starts with (also used by the Computer button).
#   desktop-size 1   -> no zoom (best with a 2K / Full HD resolution in Termux:X11)
#   desktop-size 2   -> everything twice as big (default, for the native resolution)
conf="$HOME/.config/tablet-desktop.conf"
case "${1:-}" in
  1|2|3|4) ;;
  *) now=2; [ -f "$conf" ] && . "$conf" && now="${SAVED_SCALE:-2}"
     echo "Usage: desktop-size 1|2|3      (now: $now)"; exit 1 ;;
esac
mkdir -p "$(dirname "$conf")"
{ grep -v '^SAVED_SCALE=' "$conf" 2>/dev/null; echo "SAVED_SCALE=$1"; } > "$conf.tmp" && mv "$conf.tmp" "$conf"
echo "Saved: the computer will start with size $1. Restart it to see: desktop"
EOF

chmod +x "$PREFIX/bin/desktop" "$PREFIX/bin/desktop-stop" "$PREFIX/bin/desktop-size"
rm -f "$PREFIX/bin/desktop-session" "$PREFIX/bin/desktop-tweaks"   # from the older version

# One-tap button for the Android home screen (needs the Termux:Widget app)
mkdir -p "$HOME/.shortcuts/tasks"
printf '#!/data/data/com.termux/files/usr/bin/bash\ndesktop\n' > "$HOME/.shortcuts/tasks/Computer"
chmod +x "$HOME/.shortcuts/tasks/Computer"
echo "  [ok] Commands: desktop, desktop-stop, desktop-size, and the Computer button"
