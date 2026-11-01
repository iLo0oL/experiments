#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#  Starts the screen (Termux:X11) in "legacy drawing" mode and
#  the desktop parts directly (without xfce4-session, which got
#  stuck in the last test). Then shows what is running.
# =============================================================
LOG="$HOME/debug-c.log"
ENVS=(DISPLAY=:0 PULSE_SERVER=tcp:127.0.0.1 GDK_SCALE=2 LANG=ar_SA.UTF-8
      LC_ALL=ar_SA.UTF-8 LANGUAGE=ar XDG_RUNTIME_DIR=/tmp/runtime-user
      MOZ_FAKE_NO_SANDBOX=1)

echo "== stopping old sessions"
pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch' 2>/dev/null
pkill -9 -f 'bin/proot' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
sleep 2

echo "== starting the screen in legacy drawing mode"
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1
termux-x11 :0 -legacy-drawing >"$HOME/x11-debug.log" 2>&1 &
sleep 3
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1

echo "== starting the desktop parts, 15 seconds..."
proot-distro login debian --user user --shared-tmp -- env "${ENVS[@]}" \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           eval "$(dbus-launch --sh-syntax)"
           xfsettingsd & xfwm4 & sleep 2
           xfdesktop & xfce4-panel &
           sleep 4; ~/.local/bin/desktop-tweaks
           wait' >"$LOG" 2>&1 &
sleep 15

echo "== running:"
ps -eo pid,args 2>/dev/null \
  | grep -E 'xfwm4|xfce4-panel|xfdesktop|xfsettingsd|termux-x11' \
  | grep -v grep | cut -c1-80
echo "== screen messages:"
tail -n 6 "$HOME/x11-debug.log" | cut -c1-100
echo "== desktop messages:"
tail -n 6 "$LOG" | cut -c1-100
echo
echo "== Now open Termux:X11 (full screen). Do you see the desktop?"
echo "   Take a photo of this Termux screen too."
