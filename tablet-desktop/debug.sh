#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen? This starts the computer like 'desktop' does,
#  but keeps every message, waits 30 seconds, then shows them.
#  Run inside Termux:   bash debug.sh
# =============================================================
LOG="$HOME/desktop-debug.log"
XLOG="$HOME/x11-debug.log"

echo "1) Stopping the old session..."
pkill -x proot 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
sleep 1

echo "2) Starting sound and the screen (Termux:X11)..."
pulseaudio --start --exit-idle-time=-1 \
  --load="module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >/dev/null 2>&1
termux-x11 :0 >"$XLOG" 2>&1 &
sleep 3

echo "3) Starting the desktop inside Debian..."
proot-distro login debian --user user --shared-tmp -- env \
  DISPLAY=:0 PULSE_SERVER=tcp:127.0.0.1 GDK_SCALE=2 \
  LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 LANGUAGE=ar \
  XDG_RUNTIME_DIR=/tmp/runtime-user MOZ_FAKE_NO_SANDBOX=1 \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           echo "inside Debian as: $(id -un)  DISPLAY=$DISPLAY"
           echo "X11 sockets: $(ls /tmp/.X11-unix 2>&1)"
           exec dbus-launch --exit-with-session xfce4-session' \
  >"$LOG" 2>&1 &

am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1

echo "4) Waiting 30 seconds... (come back to Termux after that)"
sleep 30

echo
echo "===== running ====="
ps -eo pid,args 2>/dev/null | grep -E 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|dbus-daemon|termux-x11|CmdEntryPoint' \
  | grep -v grep | cut -c1-110
echo "===== desktop messages (last 40) ====="
tail -n 40 "$LOG"
echo "===== screen messages (last 8) ====="
tail -n 8 "$XLOG"
echo
echo "Take a photo of this screen and send it."
