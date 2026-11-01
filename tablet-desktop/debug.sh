#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#  Known so far: the screen can draw a colour (xsetroot), the
#  desktop parts run, but nothing shows (also without compositor).
#  This test:
#   1) shows a simple window with eyes (xeyes)
#   2) starts the desktop parts
#   3) lists the windows on the screen and where each part waits
#  Put Termux and Termux:X11 side by side, answer y or n,
#  then send a photo of Termux.
# =============================================================
LOG="$HOME/debug-f.log"
ask() { local a; read -r -p "$1 (y/n): " a; case "$a" in *[yY]*) return 0 ;; *) return 1 ;; esac; }
inside() { proot-distro login debian --user user --shared-tmp -- env DISPLAY=:0 "$@"; }

: >"$LOG"
echo "== stopping old sessions"
pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch|gvfs|xeyes' 2>/dev/null
pkill -9 -f 'bin/proot' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
sleep 2

echo "== installing 2 small test tools (x11-utils, x11-apps)..."
proot-distro login debian -- bash -c \
  'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends x11-utils x11-apps >/dev/null 2>&1 && echo "   ok" || echo "   failed"'

echo "== starting the screen"
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1
termux-x11 :0 >"$HOME/x11-debug.log" 2>&1 &
sleep 3
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
sleep 2

echo "== Test 1: a window with eyes"
inside xeyes -geometry 600x400+100+100 >>"$LOG" 2>&1 &
sleep 6
ask "Do you see EYES in Termux:X11?" && eyes=yes || eyes=no
pkill -f xeyes 2>/dev/null

echo "== Test 2: desktop parts, 25 seconds..."
proot-distro login debian --user user --shared-tmp -- env \
  DISPLAY=:0 GDK_SCALE=2 LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 LANGUAGE=ar \
  XDG_RUNTIME_DIR=/tmp/runtime-user NO_AT_BRIDGE=1 GIO_USE_VFS=local \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           eval "$(dbus-launch --sh-syntax)"
           xfsettingsd & xfwm4 --compositor=off & sleep 2
           xfdesktop & xfce4-panel &
           wait' >>"$LOG" 2>&1 &
sleep 25
ask "Do you see the desktop now?" && desk=yes || desk=no

echo "== RESULT: eyes=$eyes desktop=$desk"
echo "== windows on the screen:"
inside bash -c 'xwininfo -root -children 2>&1 | grep -E "children|\"" | cut -c1-90 | head -12'
echo "== screen info:"
inside bash -c 'xdpyinfo 2>&1 | grep -E "dimensions|MIT-SHM|Composite|XInputExtension" | head -5'
echo "== where each part waits:"
for p in xfwm4 xfdesktop xfce4-panel xfsettingsd xfconfd; do
  pid=$(pgrep -f "^[^ ]*$p" | head -1)
  [ -n "$pid" ] && echo "   $p: $(awk '/^State/{print $2}' /proc/$pid/status 2>/dev/null) $(cat /proc/$pid/wchan 2>/dev/null)" \
                || echo "   $p: not running"
done
echo "== messages:"; tail -n 8 "$LOG" | cut -c1-100
echo "Take a photo of this screen and send it."
