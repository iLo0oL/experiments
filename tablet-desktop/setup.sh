#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  Tablet -> Computer
#  Installs a full Linux desktop (XFCE) on an Android tablet
#  using Termux + Termux:X11. No root needed.
#  Made for Galaxy Tab S9 Ultra, works on most Android tablets.
#
#  Run inside Termux:      bash setup.sh
#  Start the desktop:      desktop
#  Stop the desktop:       desktop-stop
#  Change the size:        DESKTOP_SCALE=1 desktop   (1, 2, 3; default 2)
# =============================================================
# Messages are in English because the Termux terminal can't
# join Arabic letters or show them right-to-left.

set -u

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; C='\033[1;36m'; N='\033[0m'
step() { printf "\n${C}==> %s${N}\n" "$*"; }
ok()   { printf "${G}  [ok] %s${N}\n" "$*"; }
warn() { printf "${Y}  [skipped] %s${N}\n" "$*"; }
die()  { printf "\n${R}[error] %s${N}\n" "$*"; exit 1; }

case "${PREFIX:-}" in
  */com.termux/files/usr) ;;
  *) die "Run this inside the Termux app (installed from F-Droid or GitHub)." ;;
esac

export DEBIAN_FRONTEND=noninteractive
APT=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

need() {  # packages that must install
  apt-get "${APT[@]}" install "$@" || die "Could not install: $*. Check your internet and run: bash setup.sh"
}
want() {  # package, description  (nice to have; skipped if missing)
  printf "${C}  installing %s ...${N}\n" "$2"
  if apt-get "${APT[@]}" install "$1"; then ok "$2"; else warn "$2"; fi
}

step "1/6  Updating Termux (this can take a few minutes)"
pkg upgrade "${APT[@]}" || { apt-get update && apt-get "${APT[@]}" full-upgrade; } \
  || die "Update failed. Check your internet, or run 'termux-change-repo' and try again."

step "2/6  Adding the desktop package repositories"
need x11-repo
want tur-repo "Extra apps repository (VS Code, LibreOffice)"
apt-get update || die "Could not refresh package lists."

step "3/6  Installing the desktop"
need termux-x11-nightly xfce4 dbus pulseaudio
want xfce4-terminal   "Terminal"
want xfce4-goodies    "Extra desktop tools"
want fontconfig-utils "Font tools"
if ! command -v setxkbmap >/dev/null 2>&1; then
  apt-get "${APT[@]}" install xorg-setxkbmap >/dev/null 2>&1 \
    || apt-get "${APT[@]}" install setxkbmap >/dev/null 2>&1 || true
fi

step "4/6  Installing programs"
want firefox     "Firefox web browser"
want code-oss    "VS Code code editor"
want libreoffice "LibreOffice (Word / Excel / PowerPoint files)"

step "5/6  Arabic fonts"
# Reuse the fonts Android already has (Arabic, emoji, Roboto).
mkdir -p "$HOME/.config/fontconfig"
if [ ! -f "$HOME/.config/fontconfig/fonts.conf" ]; then
  cat > "$HOME/.config/fontconfig/fonts.conf" <<'EOF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/system/fonts</dir>
  <dir>/product/fonts</dir>
  <alias>
    <family>sans-serif</family>
    <prefer><family>Roboto</family><family>Noto Naskh Arabic UI</family></prefer>
  </alias>
</fontconfig>
EOF
  ok "Android fonts linked"
else
  warn "fonts.conf already exists, left as is"
fi
command -v fc-cache >/dev/null 2>&1 && fc-cache -f >/dev/null 2>&1

step "6/6  Creating the 'desktop' and 'desktop-stop' commands"

cat > "$PREFIX/bin/desktop" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start the Linux desktop.  Size: DESKTOP_SCALE=1|2|3 desktop  (default 2)
scale="${DESKTOP_SCALE:-2}"
case "$scale" in 1|2|3|4) ;; *) scale=2 ;; esac
desktop-stop >/dev/null 2>&1
termux-wake-lock >/dev/null 2>&1
export XDG_RUNTIME_DIR="${TMPDIR:-$PREFIX/tmp}"
pulseaudio --start --exit-idle-time=-1 >/dev/null 2>&1
nohup termux-x11 :0 -xstartup "env DESKTOP_SCALE=$scale $PREFIX/bin/desktop-session" >/dev/null 2>&1 &
sleep 2
am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
echo "Desktop is starting... open the Termux:X11 app if it didn't open by itself."
echo "To stop it, come back here and type: desktop-stop"
EOF

cat > "$PREFIX/bin/desktop-session" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Runs inside the X server started by 'desktop'.
export XDG_RUNTIME_DIR="${TMPDIR:-$PREFIX/tmp}"
export GDK_SCALE="${DESKTOP_SCALE:-2}"
exec dbus-launch --exit-with-session xfce4-session
EOF

cat > "$PREFIX/bin/desktop-tweaks" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Runs once the desktop is up (from ~/.config/autostart).
# Bigger window borders when the desktop is scaled up.
if [ "${GDK_SCALE:-1}" -ge 2 ] 2>/dev/null; then theme=Default-xhdpi; else theme=Default; fi
xfconf-query -c xfwm4 -p /general/theme -s "$theme" 2>/dev/null \
  || xfconf-query -c xfwm4 -p /general/theme -n -t string -s "$theme" 2>/dev/null
# Alt+Shift switches between English and Arabic on a physical keyboard.
command -v setxkbmap >/dev/null 2>&1 && setxkbmap -layout us,ara -option grp:alt_shift_toggle 2>/dev/null
exit 0
EOF

cat > "$PREFIX/bin/desktop-stop" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Stop the Linux desktop started by 'desktop'.
pkill -f 'xfce4-session|xfwm4|xfdesktop|xfsettingsd|xfce4-panel|Thunar' 2>/dev/null
pkill -f 'com.termux.x11' 2>/dev/null
pkill -f 'dbus-daemon' 2>/dev/null
pulseaudio --kill 2>/dev/null
termux-wake-unlock 2>/dev/null
echo "Desktop stopped."
EOF

chmod +x "$PREFIX/bin/desktop" "$PREFIX/bin/desktop-session" "$PREFIX/bin/desktop-tweaks" "$PREFIX/bin/desktop-stop"

mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/tablet-tweaks.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Tablet tweaks
Exec=$PREFIX/bin/desktop-tweaks
OnlyShowIn=XFCE;
EOF
ok "Commands created"

# Let the desktop see the tablet's files (Downloads, Pictures...).
if [ ! -d "$HOME/storage" ]; then
  echo "  Allow file access if Android asks."
  termux-setup-storage 2>/dev/null || true
fi

printf "\n${G}=====================================================${N}\n"
printf "${G}  Done! Your tablet is now a computer.${N}\n"
printf "${G}=====================================================${N}\n"
printf "  Start the desktop :  ${Y}desktop${N}\n"
printf "  Stop the desktop  :  ${Y}desktop-stop${N}\n"
printf "  Smaller / bigger  :  ${Y}DESKTOP_SCALE=1 desktop${N}  /  ${Y}DESKTOP_SCALE=3 desktop${N}\n"
printf "  More programs     :  ${Y}pkg install gimp${N}\n\n"
