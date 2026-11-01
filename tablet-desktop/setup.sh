#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Tablet -> Computer
#  Installs a full desktop that looks like Windows 10 (with a
#  Windows 7 style Start menu), in Arabic, on an Android tablet.
#  It runs Debian Linux inside Termux (proot) and shows it in
#  the Termux:X11 app. No root needed.
#  Made for Galaxy Tab S9 Ultra, works on most Android tablets.
#
#  Run inside Termux:      bash setup.sh
#  Start the computer:     desktop
#  Stop the computer:      desktop-stop
#  Options:                DESKTOP_SCALE=1|2|3   (size, default 2)
#                          DESKTOP_LANG=en       (English instead of Arabic)
# =============================================================
# Messages are in English because the Termux terminal can't
# join Arabic letters or show them right-to-left.

set -u

BASE="${DESKTOP_BASE:-https://ilo0ol.github.io/experiments/tablet-desktop}"
DISTRO=debian
DUSER=user

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; C='\033[1;36m'; N='\033[0m'
step() { printf "\n${C}==> %s${N}\n" "$*"; }
ok()   { printf "${G}  [ok] %s${N}\n" "$*"; }
die()  { printf "\n${R}[error] %s${N}\n" "$*"; exit 1; }

case "${PREFIX:-}" in
  */com.termux/files/usr) ;;
  *) die "Run this inside the Termux app (installed from F-Droid or GitHub)." ;;
esac
# Files for Debian go to Termux's tmp folder, which is /tmp inside Debian
# (--shared-tmp). This works with every proot-distro version, whatever
# folder it keeps the Debian files in.
SHARED_TMP="$PREFIX/tmp"
mkdir -p "$SHARED_TMP"

export DEBIAN_FRONTEND=noninteractive
APT=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

step "1/6  Updating Termux (this can take a few minutes)"
pkg upgrade "${APT[@]}" || { apt-get update && apt-get "${APT[@]}" full-upgrade; } \
  || die "Update failed. Check your internet, or run 'termux-change-repo' and try again."

step "2/6  Installing the screen, sound and Linux tools"
apt-get "${APT[@]}" install x11-repo || die "Could not add the x11 repository."
apt-get update || die "Could not refresh package lists."
apt-get "${APT[@]}" install termux-x11-nightly pulseaudio proot-distro curl \
  || die "Could not install Termux:X11 / PulseAudio / proot-distro."
ok "Termux part"

step "3/6  Installing Debian Linux (about 1 GB, please wait)"
if proot-distro login "$DISTRO" -- true >/dev/null 2>&1; then
  ok "Debian is already installed"
else
  proot-distro install "$DISTRO" || die "Could not install Debian. Check your internet and run: bash setup.sh"
  ok "Debian installed"
fi

step "4/6  Installing the desktop and programs inside Debian (10-30 minutes)"
curl -fsSL "$BASE/debian-setup.sh" -o "$SHARED_TMP/debian-setup.sh" \
  || die "Could not download debian-setup.sh from $BASE"
proot-distro login "$DISTRO" --shared-tmp -- env DESKTOP_USER="$DUSER" bash /tmp/debian-setup.sh \
  || die "Something went wrong inside Debian. Run 'bash setup.sh' again; it continues where it stopped."

step "5/6  Applying the Windows look"
curl -fsSL "$BASE/win10/apply.sh" -o "$SHARED_TMP/apply.sh" || die "Could not download the Windows look."
chmod 755 "$SHARED_TMP/apply.sh"
proot-distro login "$DISTRO" --user "$DUSER" --shared-tmp -- env DESKTOP_BASE="$BASE" bash /tmp/apply.sh \
  || die "Could not apply the Windows look."

step "6/6  Creating the 'desktop' and 'desktop-stop' commands"

cat > "$PREFIX/bin/desktop" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start the computer.
#   DESKTOP_SCALE=1|2|3 desktop   -> size (default 2)
#   DESKTOP_LANG=en desktop       -> English instead of Arabic
scale="${DESKTOP_SCALE:-2}"
case "$scale" in 1|2|3|4) ;; *) scale=2 ;; esac
case "${DESKTOP_LANG:-ar}" in en*) lang=en_US.UTF-8 ;; *) lang=ar_SA.UTF-8 ;; esac
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

chmod +x "$PREFIX/bin/desktop" "$PREFIX/bin/desktop-stop"
rm -f "$PREFIX/bin/desktop-session" "$PREFIX/bin/desktop-tweaks"   # from the older version

# One-tap button for the Android home screen (needs the Termux:Widget app)
mkdir -p "$HOME/.shortcuts/tasks"
printf '#!/data/data/com.termux/files/usr/bin/bash\ndesktop\n' > "$HOME/.shortcuts/tasks/Computer"
chmod +x "$HOME/.shortcuts/tasks/Computer"
ok "Commands created"

# Let the computer see the tablet's files (Downloads, Pictures...).
if [ ! -d "$HOME/storage" ]; then
  echo "  Allow file access if Android asks."
  termux-setup-storage 2>/dev/null || true
fi
# Shortcut to the tablet's own files inside the computer's home folder
proot-distro login "$DISTRO" --user "$DUSER" -- bash -c \
  'L="$HOME/ملفات التابلت"; [ -e "$L" ] || [ -L "$L" ] || ln -s /sdcard "$L"' 2>/dev/null

printf "\n${G}=====================================================${N}\n"
printf "${G}  Done! Your tablet is now a computer.${N}\n"
printf "${G}=====================================================${N}\n"
printf "  Start the computer :  ${Y}desktop${N}\n"
printf "  Stop the computer  :  ${Y}desktop-stop${N}\n"
printf "  Smaller / bigger   :  ${Y}DESKTOP_SCALE=1 desktop${N}  /  ${Y}DESKTOP_SCALE=3 desktop${N}\n"
printf "  English instead    :  ${Y}DESKTOP_LANG=en desktop${N}\n\n"
