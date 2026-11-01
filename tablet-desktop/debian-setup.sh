#!/bin/bash
# =============================================================
#  Runs INSIDE the Debian system (as root), called by setup.sh.
#  Installs the desktop, the programs, Arabic language support
#  and (if possible) support for Windows programs (.exe).
# =============================================================
set -u

DUSER="${DESKTOP_USER:-user}"
DNAME="${DESKTOP_USER_NAME:-المستخدم}"

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; C='\033[1;36m'; N='\033[0m'
step() { printf "\n${C}==> %s${N}\n" "$*"; }
ok()   { printf "${G}  [ok] %s${N}\n" "$*"; }
warn() { printf "${Y}  [skipped] %s${N}\n" "$*"; }
die()  { printf "\n${R}[error] %s${N}\n" "$*"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
APT=(-y --no-install-recommends -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
need() { apt-get "${APT[@]}" install "$@" || die "Could not install: $*. Check your internet and run setup.sh again."; }
want() {
  printf "${C}  installing %s ...${N}\n" "$2"
  if apt-get "${APT[@]}" install "$1"; then ok "$2"; else warn "$2"; fi
}

step "Debian: updating"
# Some slim images skip translation files; Arabic needs them.
sed -i -E '/path-exclude[= ]+\/usr\/share\/locale/d' /etc/dpkg/dpkg.cfg.d/* 2>/dev/null
apt-get update || die "Could not reach the Debian servers. Check your internet."
apt-get "${APT[@]}" full-upgrade || die "Debian update failed."

step "Debian: desktop"
need locales sudo dbus-x11 curl ca-certificates xz-utils \
     xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings xfconf \
     thunar xfce4-terminal xfce4-whiskermenu-plugin \
     fonts-noto-core adwaita-icon-theme gtk-update-icon-cache \
     x11-xkb-utils x11-xserver-utils xdg-utils
want xfce4-notifyd           "Notifications"
want libnotify-bin           "Notification tool"
want tumbler                 "Picture previews in File Explorer"
want gvfs                    "Recycle Bin support"
want thunar-archive-plugin   "Zip support in File Explorer"
want xarchiver               "Zip Files"
want xfce4-pulseaudio-plugin "Volume icon on the taskbar"
want pavucontrol             "Sound settings"
want fonts-noto-color-emoji  "Emoji"

step "Debian: programs"
want firefox-esr             "Internet Browser (Firefox)"
want firefox-esr-l10n-ar     "Internet Browser in Arabic"
want mousepad                "Notepad"
want ristretto               "Photos"
want galculator              "Calculator"
want xfce4-taskmanager       "Task Manager"
want xfce4-screenshooter     "Snipping Tool"
want vlc                     "Media Player"
# Read aloud (Web Speech in the browser): Firefox needs libspeechd (speech-dispatcher)
want speech-dispatcher           "Read aloud in the browser"
want speech-dispatcher-espeak-ng "Read aloud voices (Arabic and English)"
want libreoffice-writer      "Word Documents"
want libreoffice-calc        "Excel Spreadsheets"
want libreoffice-impress     "PowerPoint Slides"
want libreoffice-gtk3        "Office look"
want libreoffice-l10n-ar     "Office in Arabic"

# The desktop's message bus needs a machine id
dbus-uuidgen --ensure 2>/dev/null
[ -s /etc/machine-id ] || dbus-uuidgen > /etc/machine-id 2>/dev/null

step "Debian: Arabic language"
for loc in ar_SA.UTF-8 en_US.UTF-8; do
  sed -i -E "s/^# *(${loc//./\\.} UTF-8)/\1/" /etc/locale.gen
  grep -q "^${loc} UTF-8" /etc/locale.gen || echo "${loc} UTF-8" >> /etc/locale.gen
done
locale-gen >/dev/null && ok "Arabic and English" || warn "Language files"

step "Debian: your user account"
if ! id "$DUSER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -c "$DNAME" "$DUSER" || die "Could not create the user account."
fi
echo "$DUSER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$DUSER"; chmod 440 "/etc/sudoers.d/$DUSER"
UHOME="$(getent passwd "$DUSER" | cut -d: -f6)"
# Folders with the same names as Arabic Windows
if [ ! -f "$UHOME/.config/user-dirs.dirs" ]; then
  mkdir -p "$UHOME/.config"
  cat > "$UHOME/.config/user-dirs.dirs" <<'EOF'
XDG_DESKTOP_DIR="$HOME/سطح المكتب"
XDG_DOCUMENTS_DIR="$HOME/المستندات"
XDG_DOWNLOAD_DIR="$HOME/التنزيلات"
XDG_MUSIC_DIR="$HOME/الموسيقى"
XDG_PICTURES_DIR="$HOME/الصور"
XDG_VIDEOS_DIR="$HOME/مقاطع الفيديو"
XDG_TEMPLATES_DIR="$HOME"
XDG_PUBLICSHARE_DIR="$HOME"
EOF
  echo ar > "$UHOME/.config/user-dirs.locale"
fi
for d in "سطح المكتب" "المستندات" "التنزيلات" "الموسيقى" "الصور" "مقاطع الفيديو"; do mkdir -p "$UHOME/$d"; done
chown -R "$DUSER:$DUSER" "$UHOME"
ok "User '$DUSER'"

step "Debian: Windows programs (.exe) - experimental"
# Wine runs Windows programs; Box64 translates them from PC (x86) chips to the tablet's ARM chip.
want box64 "Box64 (PC chip translator)"
if command -v box64 >/dev/null 2>&1; then
  if [ ! -x /opt/wine/bin/wine ]; then
    rel="$(curl -fsSL https://api.github.com/repos/Kron4ek/Wine-Builds/releases/latest 2>/dev/null)"
    url="$(printf '%s' "$rel" | grep -oE 'https://[^"]+/wine-[0-9][^"/]*-amd64-wow64\.tar\.xz' | grep -v -e staging -e tkg | head -1)"
    [ -n "$url" ] || url="$(printf '%s' "$rel" | grep -oE 'https://[^"]+-amd64-wow64\.tar\.xz' | head -1)"
    if [ -n "$url" ]; then
      echo "  downloading Wine: $(basename "$url")"
      rm -rf /opt/wine; mkdir -p /opt/wine
      curl -fL "$url" | tar -xJ -C /opt/wine --strip-components=1 || { rm -rf /opt/wine; warn "Wine download failed"; }
    else
      warn "Could not find a Wine download"
    fi
  fi
  if [ -x /opt/wine/bin/wine ]; then
    cat > /usr/local/bin/run-exe <<'EOF'
#!/bin/bash
# Run a Windows program (.exe / .msi) with Wine + Box64.
export WINEPREFIX="${WINEPREFIX:-$HOME/.wine}" WINEDEBUG=-all BOX64_LOG=0 BOX64_NOBANNER=1
[ -d "$WINEPREFIX" ] || { command -v notify-send >/dev/null && notify-send -i system-run "Windows" "First run: preparing Windows support, this takes a minute..."; }
if [ $# -eq 0 ]; then exec box64 /opt/wine/bin/wine explorer; fi
exec box64 /opt/wine/bin/wine start /unix "$@"
EOF
    chmod 755 /usr/local/bin/run-exe
    cat > /usr/share/applications/run-exe.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Windows Programs (.exe)
Name[ar]=تشغيل برامج ويندوز (.exe)
Comment=Run Windows programs
Exec=run-exe %f
Icon=system-run
Categories=System;
MimeType=application/x-ms-dos-executable;application/x-msdownload;application/vnd.microsoft.portable-executable;application/x-msi;application/x-ms-shortcut;application/x-wine-extension-msp;
EOF
    mkdir -p "$UHOME/.config"
    {
      echo "[Default Applications]"
      for m in application/x-ms-dos-executable application/x-msdownload application/vnd.microsoft.portable-executable application/x-msi; do
        echo "$m=run-exe.desktop"
      done
    } > "$UHOME/.config/mimeapps.list"
    chown -R "$DUSER:$DUSER" "$UHOME/.config"
    ok "Windows programs: double-click an .exe file to run it"
  fi
else
  warn "Windows programs (.exe): Box64 is not available for this Debian version"
fi

apt-get clean
ok "Debian part finished"
