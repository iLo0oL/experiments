#!/usr/bin/env python3
"""Welcome screen shown while the desktop starts, like the "Welcome" screen
of Windows: a blue background, spinning dots and "مرحبًا".
The session closes it as soon as the desktop and the taskbar are up; it also
closes by itself after a minute. Turn it off: touch ~/.config/xfce4/.no-splash
"""
import math
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import GLib, Gdk, Gtk, Pango, PangoCairo  # noqa: E402

AR = os.environ.get("LANG", "").startswith("ar")
TEXT = "مرحبًا" if AR else "Welcome"
START = GLib.get_monotonic_time()

win = Gtk.Window(type=Gtk.WindowType.POPUP)  # above everything, no border
screen = Gdk.Screen.get_default()
win.set_default_size(screen.get_width(), screen.get_height())
win.move(0, 0)
area = Gtk.DrawingArea()
win.add(area)


def draw(widget, cr):
    w = widget.get_allocated_width()
    h = widget.get_allocated_height()
    cr.set_source_rgb(0.0, 0.39, 0.69)  # Windows "welcome" blue
    cr.paint()

    # five dots running round a circle, bunching up and spreading out
    t = (GLib.get_monotonic_time() - START) / 1e6
    cx, cy = w / 2, h * 0.42
    radius = min(w, h) * 0.045
    dot = max(2.0, min(w, h) * 0.0055)
    cr.set_source_rgb(1, 1, 1)
    for i in range(5):
        p = (t / 2.2 - i * 0.07) % 1.0  # one lap every 2.2 s
        eased = p - math.sin(p * 2 * math.pi) / (2 * math.pi) * 0.85
        a = eased * 2 * math.pi - math.pi / 2
        cr.arc(cx + radius * math.cos(a), cy + radius * math.sin(a), dot, 0, 2 * math.pi)
        cr.fill()

    # the word, shaped and joined by Pango (Arabic letters connect properly)
    layout = PangoCairo.create_layout(cr)
    layout.set_text(TEXT, -1)
    font = Pango.FontDescription("Sans")
    font.set_absolute_size(max(18, min(w, h) * 0.045) * Pango.SCALE)
    layout.set_font_description(font)
    tw, th = layout.get_pixel_size()
    cr.move_to((w - tw) / 2, cy + radius * 2.2)
    PangoCairo.show_layout(cr, layout)


def tick():
    area.queue_draw()
    return True


def keep_on_top():
    gdk_win = win.get_window()
    if gdk_win is not None:
        gdk_win.raise_()
    return True


area.connect("draw", draw)
win.show_all()
GLib.timeout_add(33, tick)
GLib.timeout_add(700, keep_on_top)
GLib.timeout_add_seconds(60, Gtk.main_quit)
try:
    Gtk.main()
except KeyboardInterrupt:
    sys.exit(0)
