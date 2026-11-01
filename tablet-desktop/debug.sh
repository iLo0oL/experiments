#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#  Known so far: simple X windows show (xeyes), but the GTK
#  desktop parts hang before opening any window (0 windows,
#  all waiting in futex). This test shows:
#   1) the threads of a stuck xfwm4 and what each waits on
#   2) Notepad (mousepad) with English, then Arabic language,
#      with GLib debug messages and the window count
#  No questions this time. Send a photo of Termux at the end.
# =============================================================
inside() { proot-distro login debian --user user --shared-tmp -- env DISPLAY=:0 \
             XDG_RUNTIME_DIR=/tmp/runtime-user NO_AT_BRIDGE=1 "$@"; }
wins() { inside bash -c 'xwininfo -root -children 2>&1 | grep -m1 children'; }

echo "== stopping old sessions"
pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch|gvfs|xeyes|mousepad' 2>/dev/null
pkill -9 -f 'bin/proot' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
sleep 2
termux-x11 :0 >"$HOME/x11-debug.log" 2>&1 &
sleep 3
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
sleep 2

echo "== 1) xfwm4 alone (Arabic), threads after 12 s:"
inside bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"; LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 \
  exec dbus-run-session -- xfwm4 --compositor=off' >"$HOME/debug-g1.log" 2>&1 &
sleep 12
pid=$(pgrep -f '^[^ ]*xfwm4' | head -1)
if [ -n "$pid" ]; then
  for t in /proc/$pid/task/*; do
    printf '   %-16s %s\n' "$(cat $t/comm 2>/dev/null)" "$(cat $t/wchan 2>/dev/null)"
  done | head -8
else
  echo "   xfwm4 not running"
fi
echo "   $(wins)"
tail -n 3 "$HOME/debug-g1.log" | cut -c1-100
pkill -9 -f 'xfwm4|dbus-daemon|dbus-run-session' 2>/dev/null; sleep 2

for L in C.UTF-8 ar_SA.UTF-8; do
  echo "== 2) Notepad with LANG=$L, 15 s:"
  inside bash -c "LANG=$L LC_ALL=$L G_MESSAGES_DEBUG=all exec dbus-run-session -- mousepad" \
    >"$HOME/debug-g2.log" 2>&1 &
  sleep 15
  echo "   $(wins)"
  grep -v '^$' "$HOME/debug-g2.log" | tail -n 5 | cut -c1-100
  pkill -9 -f 'mousepad|dbus-daemon|dbus-run-session' 2>/dev/null; sleep 2
done
echo "Take a photo of this screen and send it."
