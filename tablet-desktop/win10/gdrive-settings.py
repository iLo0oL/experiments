#!/usr/bin/env python3
"""Google Drive sync settings (Start menu > "Google Drive sync"):
connect a Google account, turn the automatic copy on or off, how often,
copy now, open the folder. The copying itself is done by gdrive-sync."""
import os
import re
import subprocess
import time

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

AR = os.environ.get("LANG", "").startswith("ar")


def t(ar, en):
    return ar if AR else en


HOME = os.path.expanduser("~")
CONF = os.path.join(HOME, ".config/xfce4/gdrive.conf")
LAST = os.path.join(HOME, ".cache/gdrive-last")
ERR = os.path.join(HOME, ".cache/gdrive-error")
FOLDER = os.path.join(HOME, "Google Drive")
SYNC = os.path.join(HOME, ".local/bin/gdrive-sync")
EVERY = [
    (5, t("كل ٥ دقائق", "Every 5 minutes")),
    (15, t("كل ربع ساعة", "Every 15 minutes")),
    (30, t("كل نص ساعة", "Every 30 minutes")),
    (60, t("كل ساعة", "Every hour")),
]


def load():
    conf = {"AUTO": "1", "EVERY": "15"}
    try:
        with open(CONF, encoding="utf-8") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k in conf and v:
                    conf[k] = v
    except OSError:
        pass
    return conf


def save(*_):
    os.makedirs(os.path.dirname(CONF), exist_ok=True)
    with open(CONF, "w", encoding="utf-8") as f:
        f.write("AUTO=%s\nEVERY=%s\n" % ("1" if auto_switch.get_active() else "0",
                                         every_box.get_active_id() or "15"))


def connected():
    """True when the "gdrive" remote exists and has its sign-in key (token)."""
    try:
        out = subprocess.run(["rclone", "config", "show", "gdrive"],
                             capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return any(line.startswith("token = ") for line in out.splitlines())


def forget_unfinished():
    """A sign-in that was stopped leaves a "gdrive" remote with no key."""
    if not connected():
        subprocess.run(["rclone", "config", "delete", "gdrive"], capture_output=True)


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


conf = load()
win = Gtk.Window(title=t("مزامنة Google Drive", "Google Drive sync"))
win.set_border_width(18)
win.set_resizable(False)
win.set_position(Gtk.WindowPosition.CENTER)
win.connect("destroy", Gtk.main_quit)
grid = Gtk.Grid(row_spacing=12, column_spacing=14)
win.add(grid)

status = Gtk.Label(xalign=0, wrap=True, max_width_chars=48)
grid.attach(status, 0, 0, 2, 1)

connect_btn = Gtk.Button(label=t("ربط حساب Google", "Connect Google account"))
login_btn = Gtk.Button(label=t("افتح صفحة تسجيل الدخول", "Open the sign-in page"))
disconnect_btn = Gtk.Button(label=t("إلغاء الربط", "Disconnect"))
row = Gtk.Box(spacing=8)
for b in (connect_btn, login_btn, disconnect_btn):
    row.pack_start(b, False, False, 0)
grid.attach(row, 0, 1, 2, 1)

auto_label = Gtk.Label(label=t("مزامنة تلقائية", "Sync automatically"), xalign=0)
auto_switch = Gtk.Switch(active=conf["AUTO"] == "1", halign=Gtk.Align.START)
grid.attach(auto_label, 0, 2, 1, 1)
grid.attach(auto_switch, 1, 2, 1, 1)

every_label = Gtk.Label(label=t("التكرار:", "How often:"), xalign=0)
every_box = Gtk.ComboBoxText()
for minutes, text in EVERY:
    every_box.append(str(minutes), text)
if not every_box.set_active_id(conf["EVERY"]):
    every_box.set_active_id("15")
grid.attach(every_label, 0, 3, 1, 1)
grid.attach(every_box, 1, 3, 1, 1)

info = Gtk.Label(xalign=0, wrap=True, max_width_chars=48)
info.set_text(t(
    "أي ملف تحطه في مجلد «Google Drive» (على سطح المكتب) ينحفظ في درايف داخل مجلد "
    "«كمبيوتر التابلت». ينسخ ويحدّث الملفات بس، وما يحذف شي من درايف.",
    "Every file you put in the \"Google Drive\" folder (on the desktop) is saved on Drive "
    "in the folder \"كمبيوتر التابلت\". It only copies and updates files; it never "
    "deletes anything on Drive."))
grid.attach(info, 0, 4, 2, 1)

buttons = Gtk.Box(spacing=8, halign=Gtk.Align.END)
open_btn = Gtk.Button(label=t("افتح المجلد", "Open the folder"))
sync_btn = Gtk.Button(label=t("زامن الآن", "Sync now"))
close_btn = Gtk.Button(label=t("إغلاق", "Close"))
for b in (open_btn, sync_btn, close_btn):
    buttons.pack_start(b, False, False, 0)
grid.attach(buttons, 0, 5, 2, 1)

state = {"proc": None, "link": None, "busy": False}


def when_done(proc, done):
    """Call done() once proc has finished (checked twice a second)."""
    def check():
        if proc.poll() is None:
            return True
        done()
        return False
    GLib.timeout_add(500, check)


def refresh():
    on = connected()
    if state["busy"]:
        text = t("سجّل دخولك في المتصفح اللي انفتح ووافق. إذا ما انفتح، اضغط «افتح صفحة تسجيل الدخول».",
                 "Sign in and allow access in the browser that opened. If it didn't open, "
                 "press \"Open the sign-in page\".")
    elif on:
        last = read(LAST)
        if last.isdigit():
            tm = time.localtime(int(last))
            clock = "%02d:%02d %s" % (tm.tm_hour % 12 or 12, tm.tm_min,
                                      t("ص", "AM") if tm.tm_hour < 12 else t("م", "PM"))
            when = time.strftime("%Y/%m/%d", tm) + t("، الساعة ", ", ") + clock
        else:
            when = t("ما صارت إلى الآن", "not yet")
        text = t("مربوط بحساب Google ✓\nآخر مزامنة: ", "Connected to Google ✓\nLast sync: ") + when
        if read(ERR):
            text += t("\nآخر محاولة ما زبطت. تأكد من الإنترنت.", "\nThe last try failed. Check the internet.")
    else:
        text = t("مو مربوط. اضغط «ربط حساب Google» عشان تبدأ.", "Not connected. Press \"Connect Google account\" to start.")
    status.set_text(text)
    connect_btn.set_visible(not on and not state["busy"])
    login_btn.set_visible(state["busy"] and state["link"] is not None)
    disconnect_btn.set_visible(on and not state["busy"])
    for w in (auto_label, auto_switch, every_label, every_box, sync_btn):
        w.set_sensitive(on and not state["busy"])
    every_box.set_sensitive(on and not state["busy"] and auto_switch.get_active())


def on_output(source, condition):
    line = source.readline()
    if line:
        m = re.search(r"https?://127\.0\.0\.1:\d+/auth\?state=\S+", line)
        if m:
            state["link"] = m.group(0)
            refresh()
        return True
    return False


def on_connect_done():
    state["busy"] = False
    state["proc"] = None
    os.makedirs(FOLDER, exist_ok=True)
    if connected():
        save()
        subprocess.Popen([SYNC, "--quiet"])
    else:
        forget_unfinished()
    refresh()


def on_connect(_):
    forget_unfinished()
    # rclone opens the browser for Google's sign-in and waits for the answer
    proc = subprocess.Popen(
        ["rclone", "config", "create", "gdrive", "drive", "scope=drive.file"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    state.update(proc=proc, link=None, busy=True)
    GLib.io_add_watch(proc.stdout, GLib.IO_IN | GLib.IO_HUP, on_output)
    when_done(proc, on_connect_done)
    refresh()


def on_login(_):
    if state["link"]:
        subprocess.Popen(["xdg-open", state["link"]])


def on_disconnect(_):
    subprocess.run(["rclone", "config", "delete", "gdrive"])
    refresh()


def on_sync(_):
    sync_btn.set_sensitive(False)
    proc = subprocess.Popen([SYNC])
    when_done(proc, refresh)


def on_open(_):
    os.makedirs(FOLDER, exist_ok=True)
    subprocess.Popen(["xdg-open", FOLDER])


def on_close(_):
    if state["proc"] is not None:
        state["proc"].terminate()
        state["proc"].wait()
        forget_unfinished()
    win.destroy()


auto_switch.connect("notify::active", lambda *_: (save(), refresh()))
every_box.connect("changed", save)
connect_btn.connect("clicked", on_connect)
login_btn.connect("clicked", on_login)
disconnect_btn.connect("clicked", on_disconnect)
sync_btn.connect("clicked", on_sync)
open_btn.connect("clicked", on_open)
close_btn.connect("clicked", on_close)
win.connect("delete-event", lambda *_: (on_close(None), True)[1])
win.show_all()
refresh()
Gtk.main()
