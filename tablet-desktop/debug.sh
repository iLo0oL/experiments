#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Black screen check. Run inside Termux:   bash debug.sh
#  Known so far: simple X windows show (xeyes); GTK programs
#  hang (single thread, futex) before opening any window, with
#  English and Arabic alike. Likely cause: GTK sets up OpenGL at
#  start, and Mesa's DRI3 waits for a fence the screen never
#  signals. This test:
#   1) Notepad with GDK_GL=disable          (GTK skips OpenGL)
#   2) Notepad with LIBGL_ALWAYS_SOFTWARE=1 (Mesa skips DRI3)
#   3) the whole desktop with both, then asks if you see it
# =============================================================
inside() { proot-distro login debian --user user --shared-tmp -- env DISPLAY=:0 \
             XDG_RUNTIME_DIR=/tmp/runtime-user NO_AT_BRIDGE=1 "$@"; }
wins() { inside bash -c 'xwininfo -root -children 2>&1 | grep -m1 children'; }
ask() { local a; read -r -p "$1 (y/n): " a; case "$a" in *[yY]*) return 0 ;; *) return 1 ;; esac; }
stop_apps() { pkill -9 -f 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon|dbus-launch|dbus-run-session|gvfs|xeyes|mousepad' 2>/dev/null; sleep 2; }

echo "== stopping old sessions"
stop_apps
pkill -9 -f 'bin/proot' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
sleep 2
termux-x11 :0 >"$HOME/x11-debug.log" 2>&1 &
sleep 3
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
sleep 2

echo "== 1) Notepad with GDK_GL=disable, 12 s:"
inside GDK_GL=disable dbus-run-session -- mousepad >"$HOME/debug-h1.log" 2>&1 &
sleep 12
echo "   $(wins)"
stop_apps

echo "== 2) Notepad with LIBGL_ALWAYS_SOFTWARE=1, 12 s:"
inside LIBGL_ALWAYS_SOFTWARE=1 dbus-run-session -- mousepad >"$HOME/debug-h2.log" 2>&1 &
sleep 12
echo "   $(wins)"
stop_apps

echo "== 3) whole desktop with both fixes, 25 s..."
proot-distro login debian --user user --shared-tmp -- env \
  DISPLAY=:0 GDK_SCALE=2 LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 LANGUAGE=ar \
  XDG_RUNTIME_DIR=/tmp/runtime-user NO_AT_BRIDGE=1 \
  GDK_GL=disable LIBGL_ALWAYS_SOFTWARE=1 \
  bash -c 'mkdir -p -m 700 "$XDG_RUNTIME_DIR"
           eval "$(dbus-launch --sh-syntax)"
           xfsettingsd & xfwm4 --compositor=off & sleep 2
           xfdesktop & xfce4-panel &
           sleep 4; ~/.local/bin/desktop-tweaks
           wait' >"$HOME/debug-h3.log" 2>&1 &
sleep 25
echo "   $(wins)"
ask "Do you see the desktop now?" && d=yes || d=no
echo "== RESULT: desktop=$d"
echo "== messages:"; tail -n 6 "$HOME/debug-h3.log" | cut -c1-100
echo "Take a photo of this screen and send it."
