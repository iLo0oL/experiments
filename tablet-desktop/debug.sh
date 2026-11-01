#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#  Last test showed: the screen CAN draw (blue/red worked), and
#  the desktop parts run, but nothing shows. Most likely the
#  window manager's compositor (effects) is stuck, so this test
#  starts the desktop with the compositor turned OFF.
#  Put Termux and Termux:X11 side by side, answer y or n.
# =============================================================
LOG="$HOME/debug-e.log"
ask() { local a; read -r -p "$1 (y/n): " a; case "$a" in *[yY]*) return 0 ;; *) return 1 ;; esac; }

: >"$LOG"
echo "== stopping old sessions"
pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch|gvfs' 2>/dev/null
pkill -9 -f 'bin/proot' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
sleep 2

echo "== starting the screen"
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1
termux-x11 :0 >"$HOME/x11-debug.log" 2>&1 &
sleep 3
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1

echo "== starting the desktop with the compositor OFF, 30 seconds..."
proot-distro login debian --user user --shared-tmp -- env \
  DISPLAY=:0 PULSE_SERVER=tcp:127.0.0.1 GDK_SCALE=2 \
  LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 LANGUAGE=ar \
  XDG_RUNTIME_DIR=/tmp/runtime-user NO_AT_BRIDGE=1 GIO_USE_VFS=local \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           eval "$(dbus-launch --sh-syntax)"
           xfconf-query -c xfwm4 -p /general/use_compositing -n -t bool -s false
           xfconf-query -c xfwm4 -p /general/vblank_mode -n -t string -s off
           xfsettingsd &
           xfwm4 --compositor=off --vblank=off &
           sleep 2
           xfdesktop & xfce4-panel &
           sleep 4; ~/.local/bin/desktop-tweaks
           wait' >>"$LOG" 2>&1 &

for t in 10 20 30; do
  sleep 10
  n=$(ps -eo args 2>/dev/null | grep -cE '^(xfwm4|xfdesktop|xfce4-panel)')
  echo "   ${t}s: $n of 3 desktop parts running"
done
ask "Do you see the desktop (taskbar or wallpaper) now?" && d=yes || d=no
echo "== desktop visible: $d"
echo "== messages:"; tail -n 12 "$LOG" | cut -c1-100
echo "Take a photo of this screen and send it."
