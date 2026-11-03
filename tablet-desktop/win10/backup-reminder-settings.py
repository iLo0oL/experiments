#!/usr/bin/env python3
"""Settings for the backup reminder (Start menu > "Backup reminder"):
whether it shows at all, how often, and at what time of day.
Saves ~/.config/xfce4/backup-reminder.conf, read by backup-reminder."""
import glob
import os
import subprocess
import time

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: E402

AR = os.environ.get("LANG", "").startswith("ar")


def t(ar, en):
    return ar if AR else en


CONF = os.path.expanduser("~/.config/xfce4/backup-reminder.conf")
SHOWN = os.path.expanduser("~/.cache/backup-reminder-shown")
BIN = os.path.expanduser("~/.local/bin/backup-reminder")
EVERY = [
    (1, t("كل يوم", "Every day")),
    (3, t("كل ٣ أيام", "Every 3 days")),
    (7, t("كل أسبوع", "Every week")),
    (14, t("كل أسبوعين", "Every 2 weeks")),
    (30, t("كل شهر", "Every month")),
]


def hour_label(h):
    am = h < 12
    return "%02d:00 %s" % (h % 12 or 12, t("ص" if am else "م", "AM" if am else "PM"))


def load():
    conf = {"REMIND": "0", "EVERY": "7", "HOUR": "20"}
    try:
        with open(CONF, encoding="utf-8") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k in conf and v:
                    conf[k] = v
    except OSError:
        pass
    return conf


def last_backup_text():
    files = glob.glob("/sdcard/ComputerBackup/computer-*.tar.gz")
    if not files:
        return t("ما عندك نسخة احتياطية إلى الآن.", "There is no backup yet.")
    newest = max(os.path.getmtime(f) for f in files)
    return t("آخر نسخة احتياطية: ", "Last backup: ") + time.strftime("%Y/%m/%d", time.localtime(newest))


conf = load()
win = Gtk.Window(title=t("تذكير النسخة الاحتياطية", "Backup reminder"))
win.set_border_width(18)
win.set_resizable(False)
win.set_position(Gtk.WindowPosition.CENTER)
win.connect("destroy", Gtk.main_quit)

grid = Gtk.Grid(row_spacing=12, column_spacing=14)
win.add(grid)

on_label = Gtk.Label(label=t("ذكّرني بالنسخة الاحتياطية", "Remind me to back up"), xalign=0)
on_switch = Gtk.Switch(active=conf["REMIND"] == "1", halign=Gtk.Align.START)
grid.attach(on_label, 0, 0, 1, 1)
grid.attach(on_switch, 1, 0, 1, 1)

every_label = Gtk.Label(label=t("التكرار:", "How often:"), xalign=0)
every_box = Gtk.ComboBoxText()
for days, text in EVERY:
    every_box.append(str(days), text)
if not every_box.set_active_id(conf["EVERY"]):
    every_box.set_active_id("7")
grid.attach(every_label, 0, 1, 1, 1)
grid.attach(every_box, 1, 1, 1, 1)

hour_lbl = Gtk.Label(label=t("الساعة:", "At:"), xalign=0)
hour_box = Gtk.ComboBoxText()
for h in range(24):
    hour_box.append(str(h), hour_label(h))
if not hour_box.set_active_id(conf["HOUR"]):
    hour_box.set_active_id("20")
grid.attach(hour_lbl, 0, 2, 1, 1)
grid.attach(hour_box, 1, 2, 1, 1)

info = Gtk.Label(xalign=0, wrap=True, max_width_chars=46)
info.set_text(
    last_backup_text() + "\n" +
    t("يطلع التذكير والكمبيوتر شغّال. وإذا كان مطفأ وقتها، يطلع أول ما تشغّله.",
      "The reminder shows while the computer is on. If it was off at that time, "
      "it shows when you next start it.")
)
grid.attach(info, 0, 3, 2, 1)


def sync_sensitive(*_):
    on = on_switch.get_active()
    for w in (every_label, every_box, hour_lbl, hour_box):
        w.set_sensitive(on)


on_switch.connect("notify::active", sync_sensitive)
sync_sensitive()

buttons = Gtk.Box(spacing=8, halign=Gtk.Align.END)
test_btn = Gtk.Button(label=t("جرّب التذكير", "Try it"))
cancel_btn = Gtk.Button(label=t("إلغاء", "Cancel"))
save_btn = Gtk.Button(label=t("حفظ", "Save"))
save_btn.get_style_context().add_class("suggested-action")
buttons.pack_start(test_btn, False, False, 0)
buttons.pack_start(cancel_btn, False, False, 0)
buttons.pack_start(save_btn, False, False, 0)
grid.attach(buttons, 0, 4, 2, 1)


def on_test(_):
    subprocess.Popen([BIN, "--test"])


def on_save(_):
    os.makedirs(os.path.dirname(CONF), exist_ok=True)
    with open(CONF, "w", encoding="utf-8") as f:
        f.write("REMIND=%s\nEVERY=%s\nHOUR=%s\n" % (
            "1" if on_switch.get_active() else "0",
            every_box.get_active_id(), hour_box.get_active_id()))
    try:
        os.remove(SHOWN)  # new settings: it may show again today
    except OSError:
        pass
    subprocess.Popen([BIN])  # check right away with the new settings
    win.destroy()


test_btn.connect("clicked", on_test)
cancel_btn.connect("clicked", lambda _: win.destroy())
save_btn.connect("clicked", on_save)
win.show_all()
Gtk.main()
