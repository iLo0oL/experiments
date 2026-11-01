#!/usr/bin/env bash
# =============================================================
#  Windows 10 look for the XFCE desktop
#   - Taskbar at the bottom: Start button, pinned apps,
#     open windows, clock, "show desktop" corner
#   - Windows 7 style Start menu: programs on the left,
#     categories on the right, search at the bottom
#   - Windows 10 theme, icons, window buttons and wallpaper
#   - Windows names for the programs (Arabic and English)
#   - Arabic (right-to-left) layout when the desktop runs in Arabic
#
#  Theme and icons by the B00merang Project (GPL-3.0):
#    https://github.com/B00merang-Project/windows-10
#    https://github.com/B00merang-Artwork/windows-10
#
#  Usage:  bash apply.sh
#  Testing with local copies:  WIN10_THEME_SRC=dir WIN10_ICONS_SRC=dir
#                              WINXP_THEME_SRC=dir WINXP_ICONS_SRC=dir
#                              WIN10_WALLPAPER=file bash apply.sh
# =============================================================
set -u

BASE="${DESKTOP_BASE:-https://ilo0ol.github.io/experiments/tablet-desktop}"
THEME_URL="https://github.com/B00merang-Project/windows-10/archive/refs/heads/master.tar.gz"
ICONS_URL="https://github.com/B00merang-Artwork/windows-10/archive/refs/heads/master.tar.gz"
XP_THEME_URL="https://github.com/B00merang-Project/windows-xp/archive/refs/heads/master.tar.gz"
XP_ICONS_URL="https://github.com/B00merang-Artwork/windows-xp/archive/refs/heads/master.tar.gz"

THEMES="$HOME/.themes"
ICONS="$HOME/.icons"
CONF="$HOME/.config/xfce4"
XML="$CONF/xfconf/xfce-perchannel-xml"
WALL="$HOME/.local/share/backgrounds/win10.jpg"
APPS="$HOME/.local/share/applications"
BIN="$HOME/.local/bin"

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
# Arabic is right-to-left, so GTK asks for "go-previous-rtl" etc. (back points
# right). Packs without those show the arrows the wrong way round; add them as
# links to the opposite arrow.
rtl_arrows() {
  local d pair a b ext
  while IFS= read -r d; do
    for pair in previous:next next:previous first:last last:first; do
      a=${pair%%:*}; b=${pair##*:}
      for ext in png svg; do
        [ -e "$d/go-$b.$ext" ] && [ ! -e "$d/go-$a-rtl.$ext" ] && ln -s "go-$b.$ext" "$d/go-$a-rtl.$ext"
        if [ -e "$d/go-$b-symbolic.$ext" ]; then
          [ -e "$d/go-$a-rtl-symbolic.$ext" ] || ln -s "go-$b-symbolic.$ext" "$d/go-$a-rtl-symbolic.$ext"
          [ -e "$d/go-$a-symbolic-rtl.$ext" ] || ln -s "go-$b-symbolic.$ext" "$d/go-$a-symbolic-rtl.$ext"
        fi
      done
    done
  done < <(find "$1" -type d)
}
if get "${WIN10_THEME_SRC:-$THEME_URL}" "$THEMES/Windows-10"; then ok "Windows 10 theme"; else fail "Windows 10 theme (check internet)"; fi
if get "${WIN10_ICONS_SRC:-$ICONS_URL}" "$ICONS/Windows-10"; then
  # fall back to the standard icons for anything the pack doesn't have
  grep -q '^Inherits=' "$ICONS/Windows-10/index.theme" 2>/dev/null \
    || sed -i 's/^\[Icon Theme\]$/[Icon Theme]\nInherits=Adwaita,hicolor/' "$ICONS/Windows-10/index.theme"
  rtl_arrows "$ICONS/Windows-10"
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f "$ICONS/Windows-10" 2>/dev/null
  ok "Windows 10 icons"
else
  fail "Windows 10 icons (check internet)"
fi

# Big-screen copy of the window borders/buttons: make_hidpi <theme dir name>
make_hidpi() {
  [ -d "$THEMES/$1/xfwm4" ] || return 1
  rm -rf "$THEMES/$1-hidpi"; mkdir -p "$THEMES/$1-hidpi/xfwm4"
  for f in "$THEMES/$1/xfwm4"/*; do
    case "$f" in
      *.xpm) xpm2x "$f" > "$THEMES/$1-hidpi/xfwm4/$(basename "$f")" ;;
      *) cp "$f" "$THEMES/$1-hidpi/xfwm4/" ;;
    esac
  done
}
make_hidpi Windows-10 && ok "Large window buttons"

# ---------- Windows XP look (switch with: desktop-theme xp / desktop-theme 10) ----------
# Only the "Windows XP Luna" (blue) variant of the B00merang XP themes is kept.
get_xp_theme() {
  local dest="$THEMES/Windows-XP-Luna" tmp
  if [ -n "${WINXP_THEME_SRC:-}" ]; then
    rm -rf "$dest"; mkdir -p "$dest"; cp -r "$WINXP_THEME_SRC/Windows XP Luna"/. "$dest"/; return 0
  fi
  tmp="$(mktemp -d)"
  if curl -fsSL "$XP_THEME_URL" | tar -xz -C "$tmp" --wildcards '*/Windows XP Luna/*'; then
    rm -rf "$dest"; mkdir -p "$dest"; cp -r "$tmp"/*/"Windows XP Luna"/. "$dest"/
    rm -rf "$tmp"; return 0
  fi
  rm -rf "$tmp"; return 1
}
if get_xp_theme; then
  # The pack moves window titles 10px past the edge, which cuts off the first
  # letter of right-aligned (Arabic) titles.
  sed -i 's/^title_horizontal_offset=.*/title_horizontal_offset=0/' "$THEMES/Windows-XP-Luna/xfwm4/themerc"
  make_hidpi Windows-XP-Luna; ok "Windows XP theme"
else
  fail "Windows XP theme (check internet)"
fi
if get "${WINXP_ICONS_SRC:-$XP_ICONS_URL}" "$ICONS/Windows-XP"; then
  grep -q '^Inherits=' "$ICONS/Windows-XP/index.theme" 2>/dev/null \
    || sed -i 's/^\[Icon Theme\]$/[Icon Theme]\nInherits=Adwaita,hicolor/' "$ICONS/Windows-XP/index.theme"
  rtl_arrows "$ICONS/Windows-XP"
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f "$ICONS/Windows-XP" 2>/dev/null
  ok "Windows XP icons"
else
  fail "Windows XP icons (check internet)"
fi

# ---------- wallpaper ----------
mkdir -p "$(dirname "$WALL")"
if [ -n "${WIN10_WALLPAPER:-}" ]; then cp "$WIN10_WALLPAPER" "$WALL"
else curl -fsSL "$BASE/win10/wallpaper.jpg" -o "$WALL" || fail "Wallpaper"; fi
[ -s "$WALL" ] && ok "Wallpaper"

# asset <name> <destination>: from WIN10_LOCAL_DIR when testing, else from the website
asset() {
  mkdir -p "$(dirname "$2")"
  if [ -n "${WIN10_LOCAL_DIR:-}" ]; then cp "$WIN10_LOCAL_DIR/$1" "$2"
  else curl -fsSL "$BASE/win10/$1" -o "$2"; fi
}

# ---------- startup sound (an original chime) ----------
if asset startup.oga "$HOME/.local/share/sounds/tablet-startup.oga"; then ok "Startup sound"; else fail "Startup sound"; fi

# ---------- look styles ----------
# win7-menu.css = Windows 10 look with a Windows 7 style Start menu
# xp-style.css  = Windows XP look (blue taskbar, green Start button)
# The current one is copied to look.css, which gtk.css imports (the user's own
# gtk.css is otherwise left alone).
G="$HOME/.config/gtk-3.0"
asset win7-menu.css "$G/win7-menu.css" && ok "Windows 7 style Start menu" || fail "Windows 7 style Start menu"
asset xp-style.css  "$G/xp-style.css"  && ok "Windows XP style"          || fail "Windows XP style"
asset xp-wallpaper.jpg "$HOME/.local/share/backgrounds/xp-wallpaper.jpg" || fail "Windows XP wallpaper"
LOOK_FILE="$CONF/.desktop-look"
look="$(cat "$LOOK_FILE" 2>/dev/null)"; [ "$look" = xp ] || look=10
[ "$look" = xp ] && cp "$G/xp-style.css" "$G/look.css" || cp "$G/win7-menu.css" "$G/look.css"
touch "$G/gtk.css"
sed -i '/@import url("win7-menu.css");/d' "$G/gtk.css"
grep -q 'look.css' "$G/gtk.css" || echo '@import url("look.css");' >> "$G/gtk.css"

# ---------- settings ----------
# Written only on the first install (or with WIN10_RESET=1), so updates never
# undo the user's own changes to the taskbar, desktop and windows. Older
# installs have no marker yet; an existing taskbar config counts as installed.
mkdir -p "$XML"
APPLIED="$CONF/.win10-applied"
[ ! -f "$APPLIED" ] && [ -f "$XML/xfce4-panel.xml" ] && touch "$APPLIED"
if [ ! -f "$APPLIED" ] || [ "${WIN10_RESET:-0}" = 1 ]; then
# a fresh start is always the Windows 10 look
rm -f "$LOOK_FILE"; cp "$G/win7-menu.css" "$G/look.css"

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
    <property name="vblank_mode" type="string" value="off"/>
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

# xfce4-desktop.xml was just rewritten (no wallpaper in it), so let the
# startup tweaks set the wallpaper again
rm -f "$CONF/.win10-wallpaper-set"

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
        <value type="string" value="firefox-esr.desktop"/>
        <value type="string" value="thunar.desktop"/>
        <value type="string" value="libreoffice-writer.desktop"/>
        <value type="string" value="libreoffice-calc.desktop"/>
        <value type="string" value="libreoffice-impress.desktop"/>
        <value type="string" value="org.xfce.mousepad.desktop"/>
        <value type="string" value="org.xfce.ristretto.desktop"/>
        <value type="string" value="vlc.desktop"/>
        <value type="string" value="galculator.desktop"/>
        <value type="string" value="com.microsoft.VSCode.desktop"/>
        <value type="string" value="run-exe.desktop"/>
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
launcher() { # id file english arabic exec icon
  mkdir -p "$CONF/panel/launcher-$1"
  cat > "$CONF/panel/launcher-$1/$2" <<EOF
[Desktop Entry]
Type=Application
Name=$3
Name[ar]=$4
Exec=$5
Icon=$6
EOF
}
launcher 2 files.desktop    "File Explorer"    "مستكشف الملفات"  "thunar"         system-file-manager
launcher 3 browser.desktop  "Internet Browser" "متصفح الإنترنت" "x-www-browser"  web-browser
launcher 4 terminal.desktop "Command Prompt"   "موجه الأوامر"    "xfce4-terminal" utilities-terminal
touch "$APPLIED"
ok "Taskbar, Start menu and settings"
else
ok "Taskbar, Start menu and settings (kept your own changes; WIN10_RESET=1 to reset)"
fi

# ---------- Windows names for the programs ----------
# rename "<desktop ids>" "English" "Arabic" [icon]
rename() {
  local id d
  mkdir -p "$APPS"
  for id in $1; do
    for d in /usr/local/share/applications /usr/share/applications; do
      [ -f "$d/$id" ] || continue
      awk -v en="$2" -v ar="$3" -v icon="${4:-}" '
        /^\[/ { main = ($0 == "[Desktop Entry]") }
        main && /^Name(\[[^]]*\])?=/ { if (!n++) { print "Name=" en; print "Name[ar]=" ar }; next }
        main && /^GenericName(\[[^]]*\])?=/ { next }
        main && icon != "" && /^Icon=/ { print "Icon=" icon; next }
        { print }' "$d/$id" > "$APPS/$id"
      break
    done
  done
}
rename "thunar.desktop"                                      "File Explorer"      "مستكشف الملفات"   system-file-manager
rename "org.xfce.mousepad.desktop mousepad.desktop"          "Notepad"            "المفكرة"          accessories-text-editor
rename "xfce4-terminal.desktop"                              "Command Prompt"     "موجه الأوامر"     utilities-terminal
rename "firefox-esr.desktop firefox.desktop"                 "Internet Browser"   "متصفح الإنترنت"  web-browser
rename "xfce-settings-manager.desktop"                       "Control Panel"      "لوحة التحكم"      preferences-desktop
rename "org.xfce.ristretto.desktop ristretto.desktop"        "Photos"             "الصور"            eog
rename "galculator.desktop"                                  "Calculator"         "الحاسبة"          accessories-calculator
rename "synaptic.desktop"                                    "Add or Remove Programs" "إضافة أو إزالة البرامج" system-software-install
rename "org.xfce.taskmanager.desktop xfce4-taskmanager.desktop" "Task Manager"    "إدارة المهام"     utilities-system-monitor
rename "org.xfce.screenshooter.desktop xfce4-screenshooter.desktop" "Snipping Tool" "أداة القطع"     applets-screenshooter
rename "vlc.desktop"                                         "Media Player"       "مشغل الوسائط"
rename "libreoffice-writer.desktop"                          "Word Documents"     "مستندات Word"
rename "libreoffice-calc.desktop"                            "Excel Spreadsheets" "جداول Excel"
rename "libreoffice-impress.desktop"                         "PowerPoint Slides"  "عروض PowerPoint"
rename "xarchiver.desktop"                                   "Zip Files"          "الملفات المضغوطة" package-x-generic
rename "org.pulseaudio.pavucontrol.desktop pavucontrol.desktop" "Sound"           "الصوت"            multimedia-volume-control
ok "Windows names for programs"

# ---------- downloads go to the tablet's own Download folder ----------
# The Arabic "Downloads" folder becomes a link to Android's Download folder, so
# whatever the browser saves shows up on the tablet right away. Anything already
# in it is moved there first; a file with the same name there is never replaced,
# the moved one gets "من الكمبيوتر - " in front of its name instead.
DL="$HOME/التنزيلات"
if [ -d /sdcard/Download ] && [ -w /sdcard/Download ] && [ ! -L "$DL" ]; then
  if [ -d "$DL" ]; then
    for f in "$DL"/* "$DL"/.[!.]*; do
      [ -e "$f" ] || [ -L "$f" ] || continue
      n="$(basename "$f")"; t="/sdcard/Download/$n"
      [ -e "$t" ] && t="/sdcard/Download/من الكمبيوتر - $n"
      [ -e "$t" ] || mv "$f" "$t" 2>/dev/null
    done
    rmdir "$DL" 2>/dev/null
  fi
  if [ ! -e "$DL" ]; then ln -s /sdcard/Download "$DL" && ok "Downloads go to the tablet's Download folder"
  else fail "Downloads folder: some files could not be moved, it stays as it was"; fi
elif [ -L "$DL" ]; then
  ok "Downloads go to the tablet's Download folder"
fi

# ---------- runs every time the desktop starts ----------
mkdir -p "$BIN" "$HOME/.config/autostart"
cat > "$BIN/desktop-tweaks" <<'EOF'
#!/usr/bin/env bash
# Runs each time the desktop starts (from ~/.config/autostart).
scale="${GDK_SCALE:-1}"
# window borders: big ones on a scaled-up screen
base=Windows-10
[ "$(cat "$HOME/.config/xfce4/.desktop-look" 2>/dev/null)" = xp ] && [ -d "$HOME/.themes/Windows-XP-Luna/xfwm4" ] && base=Windows-XP-Luna
if [ -d "$HOME/.themes/$base/xfwm4" ]; then
  if [ "$scale" -ge 2 ] 2>/dev/null && [ -d "$HOME/.themes/$base-hidpi" ]; then theme=$base-hidpi; else theme=$base; fi
elif [ "$scale" -ge 2 ] 2>/dev/null; then theme=Default-xhdpi; else theme=Default; fi
xfconf-query -c xfwm4 -p /general/theme -s "$theme" 2>/dev/null \
  || xfconf-query -c xfwm4 -p /general/theme -n -t string -s "$theme"
# Arabic Windows has the window buttons on the left and the title on the right
case "${LANG:-}" in
  ar*) layout="CMH|O"; align=right ;;
  *)   layout="O|HMC"; align=left ;;
esac
xfconf-query -c xfwm4 -p /general/button_layout -s "$layout" 2>/dev/null \
  || xfconf-query -c xfwm4 -p /general/button_layout -n -t string -s "$layout"
xfconf-query -c xfwm4 -p /general/title_alignment -s "$align" 2>/dev/null \
  || xfconf-query -c xfwm4 -p /general/title_alignment -n -t string -s "$align"
xfconf-query -c xsettings -p /Gtk/CursorThemeSize -n -t int -s $((24 * scale)) 2>/dev/null
# Arabic Windows: Start button on the right, clock on the left, menu mirrored
case "${LANG:-}" in
  ar*) order="9 8 7 6 5 4 3 2 1"; menu_alt=true ;;
  *)   order="1 2 3 4 5 6 7 8 9"; menu_alt=false ;;
esac
now="$(xfconf-query -c xfce4-panel -p /panels/panel-1/plugin-ids 2>/dev/null | grep -E '^[0-9]+$' | tr '\n' ' ' | sed 's/ $//')"
if [ -n "$now" ] && [ "$now" != "$order" ] && [ "$(echo "$now" | wc -w)" = 9 ]; then
  args=(); for id in $order; do args+=(-t int -s "$id"); done
  xfconf-query -c xfce4-panel -p /panels/panel-1/plugin-ids "${args[@]}"
  xfconf-query -c xfce4-panel -p /plugins/plugin-1/position-categories-alternate -n -t bool -s "$menu_alt"
  xfce4-panel -r >/dev/null 2>&1 &
fi
# wallpaper (only the first time, so your own choice is kept later)
wall="$HOME/.local/share/backgrounds/win10.jpg"
mark="$HOME/.config/xfce4/.win10-wallpaper-set"
if [ -f "$wall" ] && [ ! -f "$mark" ]; then
  for i in 1 2 3 4 5 6 7 8 9 10; do
    paths="$(xfconf-query -c xfce4-desktop -l 2>/dev/null | grep 'workspace0/last-image$')"
    [ -n "$paths" ] && break; sleep 1
  done
  # xfdesktop 4.20 may not write these until changed: build them from the monitor names
  if [ -z "$paths" ] && command -v xrandr >/dev/null 2>&1; then
    for m in $(xrandr --listmonitors 2>/dev/null | awk 'NR>1{print $NF}'); do
      paths="$paths /backdrop/screen0/monitor$m/workspace0/last-image"
    done
  fi
  for p in $paths; do
    xfconf-query -c xfce4-desktop -p "$p" -n -t string -s "$wall"
    xfconf-query -c xfce4-desktop -p "${p%last-image}image-style" -n -t int -s 5
  done
  [ -n "$paths" ] && touch "$mark"
fi
# Windows keyboard shortcuts. Added once the keyboard settings have copied the
# defaults into "custom" (override=true); before that they would be reset.
for i in 1 2 3 4 5 6 7 8 9 10; do
  xfconf-query -c xfce4-keyboard-shortcuts -p /commands/custom/override >/dev/null 2>&1 && break
  sleep 1
done
if xfconf-query -c xfce4-keyboard-shortcuts -p /commands/custom/override >/dev/null 2>&1; then
  sc() { xfconf-query -c xfce4-keyboard-shortcuts -p "$1" -n -t string -s "$2" 2>/dev/null; }
  sc '/commands/custom/<Primary><Alt>Delete' xfce4-taskmanager      # Ctrl+Alt+Del -> Task Manager
  sc '/commands/custom/Super_L'              xfce4-popup-whiskermenu # Windows key -> Start menu
  sc '/commands/custom/<Super>e'             thunar                  # Win+E -> File Explorer
  sc '/xfwm4/custom/<Super>d'                show_desktop_key        # Win+D -> show desktop
fi
# Startup sound (turn off: touch ~/.config/xfce4/.no-startup-sound)
snd="$HOME/.local/share/sounds/tablet-startup.oga"
if [ -f "$snd" ] && [ ! -f "$HOME/.config/xfce4/.no-startup-sound" ] && command -v paplay >/dev/null 2>&1; then
  paplay "$snd" >/dev/null 2>&1 &
fi
# Alt+Shift switches the keyboard between English and Arabic
command -v setxkbmap >/dev/null 2>&1 && setxkbmap -layout us,ara -option grp:alt_shift_toggle 2>/dev/null
exit 0
EOF
chmod +x "$BIN/desktop-tweaks"
cat > "$HOME/.config/autostart/desktop-tweaks.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Desktop tweaks
Exec=$BIN/desktop-tweaks
OnlyShowIn=XFCE;
EOF
ok "Startup tweaks"

# ---------- desktop-theme: switch between the Windows 10 and Windows XP looks ----------
cat > "$BIN/desktop-theme" <<'EOF'
#!/usr/bin/env bash
# Switch the look:   desktop-theme xp   |   desktop-theme 10
case "${1:-}" in
  xp|XP)      look=xp ;;
  10|win10)   look=10 ;;
  *) echo "Usage: desktop-theme xp|10   (now: $(cat ~/.config/xfce4/.desktop-look 2>/dev/null || echo 10))"; exit 1 ;;
esac
G="$HOME/.config/gtk-3.0"
if [ "$look" = xp ]; then
  gtk=Windows-XP-Luna; icons=Windows-XP; css=xp-style.css; wall=xp-wallpaper.jpg; bg=0; title=true; name=XP
else
  gtk=Windows-10; icons=Windows-10; css=win7-menu.css; wall=win10.jpg; bg=1; title=false; name=10
fi
[ -d "$HOME/.themes/$gtk" ] || { echo "The $look look is not installed yet. Run the update first."; exit 1; }
mkdir -p "$HOME/.config/xfce4"; echo "$look" > "$HOME/.config/xfce4/.desktop-look"
cp "$G/$css" "$G/look.css"
q() { xfconf-query "$@" 2>/dev/null; }
q -c xsettings -p /Net/ThemeName -n -t string -s "$gtk"
q -c xsettings -p /Net/IconThemeName -n -t string -s "$icons"
q -c xfce4-panel -p /panels/panel-1/background-style -n -t uint -s "$bg"
q -c xfce4-panel -p /plugins/plugin-1/show-button-title -n -t bool -s "$title"
case "${LANG:-}" in ar*) start="ابدأ" ;; *) start="start" ;; esac
q -c xfce4-panel -p /plugins/plugin-1/button-title -n -t string -s "$start"
# window borders: big ones on a scaled-up screen (same rule as desktop-tweaks)
if [ "${GDK_SCALE:-1}" -ge 2 ] 2>/dev/null && [ -d "$HOME/.themes/$gtk-hidpi" ]; then wm="$gtk-hidpi"; else wm="$gtk"; fi
q -c xfwm4 -p /general/theme -n -t string -s "$wm"
# wallpaper on every monitor
for p in $(xfconf-query -c xfce4-desktop -l 2>/dev/null | grep 'workspace0/last-image$'); do
  q -c xfce4-desktop -p "$p" -s "$HOME/.local/share/backgrounds/$wall"
done
xfce4-panel -r >/dev/null 2>&1 &
echo "Done: Windows $name look."
EOF
chmod +x "$BIN/desktop-theme"
mkdir -p "$APPS"
for l in xp 10; do
  if [ "$l" = xp ]; then en="Windows XP look"; ar="شكل ويندوز XP"; else en="Windows 10 look"; ar="شكل ويندوز 10"; fi
  cat > "$APPS/desktop-look-$l.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$en
Name[ar]=$ar
Comment=Switch the desktop look
Exec=$BIN/desktop-theme $l
Icon=preferences-desktop-theme
Categories=Settings;DesktopSettings;
EOF
done
ok "Look switcher (Start menu > Settings, or: desktop-theme xp|10)"

echo "Done. Restart the desktop to see it: desktop-stop, then desktop"
