#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#   A) normal start, with xfce4-session's own detailed log
#   B) start the desktop parts directly, without the session
#      manager (if this works, the desktop stays on screen)
#  Then take ONE photo of Termux and send it.
# =============================================================
LA="$HOME/debug-a.log"
LB="$HOME/debug-b.log"
ENVS=(DISPLAY=:0 PULSE_SERVER=tcp:127.0.0.1 GDK_SCALE=2 LANG=ar_SA.UTF-8
      LC_ALL=ar_SA.UTF-8 LANGUAGE=ar XDG_RUNTIME_DIR=/tmp/runtime-user
      MOZ_FAKE_NO_SANDBOX=1)

show() {
  ps -eo pid,args 2>/dev/null \
    | grep -E 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon' \
    | grep -v grep | cut -c1-80
}
stop_all() {
  pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch' 2>/dev/null
  pkill -9 -f 'bin/proot' 2>/dev/null
  sleep 2
}

echo "== stopping old sessions"
stop_all
pkill -f 'com.termux.x11' 2>/dev/null; sleep 1
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1
termux-x11 :0 >/dev/null 2>&1 &
sleep 3
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1

echo "== A) normal start, 25 seconds..."
proot-distro login debian --user user --shared-tmp -- env "${ENVS[@]}" XFSM_VERBOSE=1 \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"; rm -f ~/.xfce4-session.verbose-log
           exec dbus-launch --exit-with-session xfce4-session' >"$LA" 2>&1 &
sleep 25
show
echo "-- session log:"
proot-distro login debian --user user -- bash -c 'tail -n 10 ~/.xfce4-session.verbose-log 2>&1' | cut -c1-100
tail -n 3 "$LA" | cut -c1-100

echo "== B) desktop parts directly, 15 seconds..."
stop_all
proot-distro login debian --user user --shared-tmp -- env "${ENVS[@]}" \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           eval "$(dbus-launch --sh-syntax)"
           xfsettingsd & xfwm4 & sleep 2
           xfdesktop & xfce4-panel &
           sleep 4; ~/.local/bin/desktop-tweaks
           wait' >"$LB" 2>&1 &
sleep 15
show
echo "-- messages:"
tail -n 8 "$LB" | cut -c1-100
echo
echo "== Done. Look at Termux:X11 too: is the desktop there now?"
echo "   Take a photo of this Termux screen and send it."
