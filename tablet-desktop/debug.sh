#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#  Put Termux and Termux:X11 side by side (split screen) first.
#   1) paints the screen BLUE  (normal drawing)
#   2) paints the screen RED   (legacy drawing)  - only if 1 failed
#   3) starts the desktop with fixes for apps that hang at start
#  Answer the questions with y or n, then send a photo of Termux.
# =============================================================
LOG="$HOME/debug-d.log"

stop_all() {
  pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch|gvfs' 2>/dev/null
  pkill -9 -f 'bin/proot' 2>/dev/null
  sleep 1
}
start_x() {  # $1 = extra termux-x11 option
  pkill -f 'com.termux.x11' 2>/dev/null; sleep 1
  termux-x11 :0 $1 >"$HOME/x11-debug.log" 2>&1 &
  sleep 3
  am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
  sleep 2
}
paint() {  # colour
  timeout 25 proot-distro login debian --user user --shared-tmp -- \
    env DISPLAY=:0 xsetroot -solid "$1" >>"$LOG" 2>&1
  echo "   paint result: $?   (0 = ok, 124 = stuck, other = error)"
}
ask() { local a; read -r -p "$1 (y/n): " a; [ "$a" = y ] || [ "$a" = Y ]; }

: >"$LOG"
echo "== Put Termux and Termux:X11 side by side, so you can see both."
stop_all
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1

echo "== Test 1: normal drawing, painting the screen BLUE..."
start_x ""
paint '#1e6fd9'
mode=""
if ask "Is the Termux:X11 screen BLUE?"; then
  mode=normal
else
  echo "== Test 2: legacy drawing, painting the screen RED..."
  start_x "-legacy-drawing"
  paint '#d93a1e'
  if ask "Is the Termux:X11 screen RED?"; then mode=legacy; fi
fi
echo "$mode" >"$HOME/.desktop-x11-mode"

if [ -z "$mode" ]; then
  echo "== The screen could not show a colour. Screen messages:"
  tail -n 12 "$HOME/x11-debug.log" | cut -c1-100
  echo "== Other messages:"; tail -n 6 "$LOG" | cut -c1-100
  echo "Take a photo of this screen and send it."
  exit 0
fi

echo "== Screen works ($mode). Test 3: desktop with fixes, 45 seconds..."
proot-distro login debian --user user --shared-tmp -- env \
  DISPLAY=:0 PULSE_SERVER=tcp:127.0.0.1 GDK_SCALE=2 \
  LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 LANGUAGE=ar \
  XDG_RUNTIME_DIR=/tmp/runtime-user NO_AT_BRIDGE=1 GIO_USE_VFS=local \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           eval "$(dbus-launch --sh-syntax)"
           xfsettingsd & xfwm4 & sleep 2
           xfdesktop & xfce4-panel &
           sleep 4; ~/.local/bin/desktop-tweaks
           wait' >>"$LOG" 2>&1 &
for t in 15 30 45; do
  sleep 15
  n=$(ps -eo args 2>/dev/null | grep -cE '^(xfwm4|xfdesktop|xfce4-panel)')
  echo "   ${t}s: $n of 3 desktop parts running"
done
ask "Do you see the desktop (taskbar or wallpaper) now?" && d=yes || d=no
echo "== desktop visible: $d   mode: $mode"
echo "== messages:"; tail -n 10 "$LOG" | cut -c1-100
echo "Take a photo of this screen and send it."
