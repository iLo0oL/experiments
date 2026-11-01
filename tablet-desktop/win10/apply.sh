#!/usr/bin/env bash
# =============================================================
#  Windows 10 look for the XFCE desktop
#   - Taskbar at the bottom: Start button, pinned apps,
#     open windows, clock, "show desktop" corner
#   - Windows 7 style Start menu: programs on the left,
#     categories on the right, search at the bottom
#   - Windows 10 theme, icons, window buttons and wallpaper
#
#  Theme and icons by the B00merang Project (GPL-3.0):
#    https://github.com/B00merang-Project/windows-10
#    https://github.com/B00merang-Artwork/windows-10
#
#  Usage:  bash apply.sh
#  Testing with local copies:  WIN10_THEME_SRC=dir WIN10_ICONS_SRC=dir
#                              WIN10_WALLPAPER=file bash apply.sh
# =============================================================
set -u

BASE="${DESKTOP_BASE:-https://raw.githubusercontent.com/iLo0oL/experiments/main/tablet-desktop}"
THEME_URL="https://github.com/B00merang-Project/windows-10/archive/refs/heads/master.tar.gz"
ICONS_URL="https://github.com/B00merang-Artwork/windows-10/archive/refs/heads/master.tar.gz"

THEMES="$HOME/.themes"
ICONS="$HOME/.icons"
CONF="$HOME/.config/xfce4"
XML="$CONF/xfconf/xfce-perchannel-xml"
WALL="$HOME/.local/share/backgrounds/win10.jpg"

ok()   { printf '\033[1;32m  [ok] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m  [failed] %s\033[0m\n' "$*"; }

# get <local-dir-or-tarball-url> <destination>
get() {
  local src="$1" dest="$2" tmp
  if [ -d "$src" ]; then
    rm -rf "$dest"; mkdir -p "$dest"; cp -r "$src"/. "$dest"/; rm -rf "$dest/.git"
    return 0
  fi
  tmp="$(mktemp -d)"
  if curl -fsSL "$src" | tar -xz -C "$tmp"; then
    rm -rf "$dest"; mkdir -p "$dest"; cp -r "$tmp"/*/. "$dest"/
    rm -rf "$tmp"; return 0
  fi
  rm -rf "$tmp"; return 1
}

# Double the size of an XPM image (for sharp window buttons on big screens).
xpm2x() {
  awk '
  BEGIN { state = 0 }
  {
    if (state < 3 && match($0, /"[^"]*"/)) {
      s = substr($0, RSTART + 1, RLENGTH - 2); rest = substr($0, RSTART + RLENGTH)
      if (state == 0) {
        n = split(s, h, /[ \t]+/); cpp = h[4]; left = h[3]
        out = h[1] * 2 " " h[2] * 2 " " h[3] " " h[4]
        for (i = 5; i <= n; i++) out = out " " (h[i] ~ /^[0-9]+$/ ? h[i] * 2 : h[i])
        print "\"" out "\"" rest; state = 1; next
      }
      if (state == 1) { print; if (--left <= 0) state = 2; next }
      o = ""
      for (i = 1; i <= length(s); i += cpp) { p = substr(s, i, cpp); o = o p p }
      print "\"" o "\","; print "\"" o "\"" rest
      if (rest ~ /}/) state = 3
      next
    }
    print
  }' "$1"
}

echo "Applying the Windows 10 look..."

# ---------- theme + icons ----------
if get "${WIN10_THEME_SRC:-$THEME_URL}" "$THEMES/Windows-10"; then ok "Windows 10 theme"; else fail "Windows 10 theme (check internet)"; fi
if get "${WIN10_ICONS_SRC:-$ICONS_URL}" "$ICONS/Windows-10"; then
  # fall back to the standard icons for anything the pack doesn't have
  grep -q '^Inherits=' "$ICONS/Windows-10/index.theme" 2>/dev/null \
    || sed -i 's/^\[Icon Theme\]$/[Icon Theme]\nInherits=Adwaita,hicolor/' "$ICONS/Windows-10/index.theme"
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f "$ICONS/Windows-10" 2>/dev/null
  ok "Windows 10 icons"
else
  fail "Windows 10 icons (check internet)"
fi

# Big-screen copy of the window borders/buttons
if [ -d "$THEMES/Windows-10/xfwm4" ]; then
  rm -rf "$THEMES/Windows-10-hidpi"; mkdir -p "$THEMES/Windows-10-hidpi/xfwm4"
  for f in "$THEMES/Windows-10/xfwm4"/*; do
    case "$f" in
      *.xpm) xpm2x "$f" > "$THEMES/Windows-10-hidpi/xfwm4/$(basename "$f")" ;;
      *) cp "$f" "$THEMES/Windows-10-hidpi/xfwm4/" ;;
    esac
  done
  ok "Large window buttons"
fi

# ---------- wallpaper ----------
mkdir -p "$(dirname "$WALL")"
if [ -n "${WIN10_WALLPAPER:-}" ]; then cp "$WIN10_WALLPAPER" "$WALL"
else curl -fsSL "$BASE/win10/wallpaper.jpg" -o "$WALL" || fail "Wallpaper"; fi
[ -s "$WALL" ] && ok "Wallpaper"

# ---------- settings ----------
mkdir -p "$XML"

cat > "$XML/xsettings.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xsettings" version="1.0">
  <property name="Net" type="empty">
    <property name="ThemeName" type="string" value="Windows-10"/>
    <property name="IconThemeName" type="string" value="Windows-10"/>
    <property name="EnableEventSounds" type="bool" value="false"/>
  </property>
  <property name="Xft" type="empty">
    <property name="Antialias" type="int" value="1"/>
    <property name="Hinting" type="int" value="1"/>
    <property name="HintStyle" type="string" value="hintslight"/>
    <property name="RGBA" type="string" value="rgb"/>
  </property>
  <property name="Gtk" type="empty">
    <property name="FontName" type="string" value="Sans 10"/>
    <property name="MonospaceFontName" type="string" value="Monospace 10"/>
    <property name="ButtonImages" type="bool" value="true"/>
    <property name="MenuImages" type="bool" value="true"/>
  </property>
</channel>
EOF

cat > "$XML/xfwm4.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfwm4" version="1.0">
  <property name="general" type="empty">
    <property name="theme" type="string" value="Windows-10"/>
    <property name="button_layout" type="string" value="O|HMC"/>
    <property name="title_alignment" type="string" value="left"/>
    <property name="title_font" type="string" value="Sans 10"/>
    <property name="workspace_count" type="int" value="1"/>
    <property name="use_compositing" type="bool" value="true"/>
    <property name="show_dock_shadow" type="bool" value="false"/>
    <property name="snap_to_border" type="bool" value="true"/>
    <property name="tile_on_move" type="bool" value="true"/>
  </property>
</channel>
EOF

cat > "$XML/xfce4-desktop.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-desktop" version="1.0">
  <property name="desktop-icons" type="empty">
    <property name="style" type="int" value="2"/>
    <property name="icon-size" type="uint" value="48"/>
    <property name="file-icons" type="empty">
      <property name="show-home" type="bool" value="true"/>
      <property name="show-filesystem" type="bool" value="false"/>
      <property name="show-removable" type="bool" value="false"/>
      <property name="show-trash" type="bool" value="true"/>
    </property>
  </property>
</channel>
EOF

# Taskbar: [Start][Files][Browser][Terminal][open windows ...........][tray][clock][|]
cat > "$XML/xfce4-panel.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-panel" version="1.0">
  <property name="configver" type="int" value="2"/>
  <property name="panels" type="array">
    <value type="int" value="1"/>
    <property name="dark-mode" type="bool" value="true"/>
    <property name="panel-1" type="empty">
      <property name="position" type="string" value="p=10;x=0;y=0"/>
      <property name="length" type="uint" value="100"/>
      <property name="position-locked" type="bool" value="true"/>
      <property name="size" type="uint" value="40"/>
      <property name="icon-size" type="uint" value="24"/>
      <property name="enter-opacity" type="uint" value="100"/>
      <property name="leave-opacity" type="uint" value="100"/>
      <property name="background-style" type="uint" value="1"/>
      <property name="background-rgba" type="array">
        <value type="double" value="0.063"/>
        <value type="double" value="0.075"/>
        <value type="double" value="0.11"/>
        <value type="double" value="1"/>
      </property>
      <property name="plugin-ids" type="array">
        <value type="int" value="1"/>
        <value type="int" value="2"/>
        <value type="int" value="3"/>
        <value type="int" value="4"/>
        <value type="int" value="5"/>
        <value type="int" value="6"/>
        <value type="int" value="7"/>
        <value type="int" value="8"/>
        <value type="int" value="9"/>
      </property>
    </property>
  </property>
  <property name="plugins" type="empty">
    <property name="plugin-1" type="string" value="whiskermenu">
      <property name="button-icon" type="string" value="start-here"/>
      <property name="show-button-title" type="bool" value="false"/>
      <property name="show-button-icon" type="bool" value="true"/>
      <property name="position-search-alternate" type="bool" value="true"/>
      <property name="position-commands-alternate" type="bool" value="true"/>
      <property name="position-categories-alternate" type="bool" value="false"/>
      <property name="position-profile-alternate" type="bool" value="false"/>
      <property name="view-mode" type="int" value="1"/>
      <property name="default-category" type="int" value="0"/>
      <property name="category-show-name" type="bool" value="true"/>
      <property name="launcher-show-name" type="bool" value="true"/>
      <property name="launcher-show-description" type="bool" value="false"/>
      <property name="item-icon-size" type="int" value="3"/>
      <property name="category-icon-size" type="int" value="1"/>
      <property name="menu-width" type="int" value="430"/>
      <property name="menu-height" type="int" value="520"/>
      <property name="menu-opacity" type="int" value="100"/>
      <property name="profile-shape" type="int" value="1"/>
      <property name="show-command-settings" type="bool" value="true"/>
      <property name="show-command-lockscreen" type="bool" value="false"/>
      <property name="show-command-switchuser" type="bool" value="false"/>
      <property name="show-command-logoutuser" type="bool" value="false"/>
      <property name="show-command-restart" type="bool" value="false"/>
      <property name="show-command-shutdown" type="bool" value="false"/>
      <property name="show-command-suspend" type="bool" value="false"/>
      <property name="show-command-hibernate" type="bool" value="false"/>
      <property name="show-command-logout" type="bool" value="true"/>
      <property name="show-command-menueditor" type="bool" value="false"/>
      <property name="show-command-profile" type="bool" value="false"/>
      <property name="favorites" type="array">
        <value type="string" value="firefox.desktop"/>
        <value type="string" value="thunar.desktop"/>
        <value type="string" value="code-oss.desktop"/>
        <value type="string" value="libreoffice-writer.desktop"/>
        <value type="string" value="libreoffice-calc.desktop"/>
        <value type="string" value="org.xfce.mousepad.desktop"/>
        <value type="string" value="xfce4-terminal.desktop"/>
        <value type="string" value="xfce-settings-manager.desktop"/>
      </property>
    </property>
    <property name="plugin-2" type="string" value="launcher">
      <property name="items" type="array"><value type="string" value="files.desktop"/></property>
    </property>
    <property name="plugin-3" type="string" value="launcher">
      <property name="items" type="array"><value type="string" value="browser.desktop"/></property>
    </property>
    <property name="plugin-4" type="string" value="launcher">
      <property name="items" type="array"><value type="string" value="terminal.desktop"/></property>
    </property>
    <property name="plugin-5" type="string" value="tasklist">
      <property name="show-labels" type="bool" value="false"/>
      <property name="grouping" type="bool" value="true"/>
      <property name="flat-buttons" type="bool" value="true"/>
      <property name="show-handle" type="bool" value="false"/>
    </property>
    <property name="plugin-6" type="string" value="separator">
      <property name="expand" type="bool" value="true"/>
      <property name="style" type="uint" value="0"/>
    </property>
    <property name="plugin-7" type="string" value="systray">
      <property name="square-icons" type="bool" value="true"/>
    </property>
    <property name="plugin-8" type="string" value="clock">
      <property name="mode" type="uint" value="2"/>
      <property name="digital-layout" type="uint" value="1"/>
      <property name="digital-time-format" type="string" value="%I:%M %p"/>
      <property name="digital-date-format" type="string" value="%d/%m/%Y"/>
      <property name="digital-time-font" type="string" value="Sans 9"/>
      <property name="digital-date-font" type="string" value="Sans 9"/>
      <property name="digital-format" type="string" value="%I:%M %p%n%d/%m/%Y"/>
    </property>
    <property name="plugin-9" type="string" value="showdesktop"/>
  </property>
</channel>
EOF

# pinned taskbar apps
launcher() { # id file name exec icon
  mkdir -p "$CONF/panel/launcher-$1"
  cat > "$CONF/panel/launcher-$1/$2" <<EOF
[Desktop Entry]
Type=Application
Name=$3
Exec=$4
Icon=$5
EOF
}
launcher 2 files.desktop    "File Explorer" "thunar"         system-file-manager
launcher 3 browser.desktop  "Browser"       "firefox"        web-browser
launcher 4 terminal.desktop "Command Prompt" "xfce4-terminal" utilities-terminal

ok "Taskbar, Start menu and settings"
echo "Done. Restart the desktop to see it: desktop-stop, then desktop"
