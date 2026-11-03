"""Generates win7-wallpaper.jpg: an original 'blue glow with light ribbons'
wallpaper (2960x1848) in the colours of Windows 7, drawn from scratch
(not the Windows 7 picture, and without any logo)."""
import math
import numpy as np
from PIL import Image, ImageFilter

W, H = 2960, 1848
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# background: bright blue glow a little right of the centre, deep navy at the edges
cx, cy = W * 0.58, H * 0.46
r = np.sqrt(((xx - cx) / W) ** 2 + ((yy - cy) / H) ** 2 * 1.6)
t = np.clip(r / 0.75, 0, 1) ** 0.9
inner = np.array([70, 170, 240], np.float32)
outer = np.array([6, 30, 82], np.float32)
img = inner * (1 - t[..., None]) + outer * t[..., None]

# soft light ribbons sweeping from the lower left to the upper right
ribbons = [
    # (height at left, rise, wave size, wave count, phase, thickness, colour, strength)
    (0.80, 0.55, 0.06, 1.3, 0.0, 0.020, (190, 235, 255), 0.85),
    (0.86, 0.60, 0.05, 1.1, 1.2, 0.012, (255, 255, 255), 0.75),
    (0.74, 0.48, 0.07, 1.6, 2.1, 0.030, (120, 215, 255), 0.55),
    (0.92, 0.62, 0.04, 0.9, 0.6, 0.009, (170, 255, 210), 0.50),
    (0.68, 0.40, 0.08, 1.4, 2.8, 0.045, (90, 190, 250), 0.40),
    (0.97, 0.70, 0.05, 1.2, 3.6, 0.016, (255, 215, 150), 0.30),
]
u = xx / W
for base, rise, amp, freq, ph, thick, col, k in ribbons:
    centre = base - rise * u + amp * np.sin(u * math.pi * freq * 2 + ph)
    dist = np.abs(yy / H - centre)
    glow = np.exp(-(dist / thick) ** 2) * k
    halo = np.exp(-(dist / (thick * 5)) ** 2) * k * 0.35
    a = np.clip(glow + halo, 0, 1)[..., None]
    img = img * (1 - a) + np.array(col, np.float32) * a

# gentle vignette
v = np.clip(1 - 0.35 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 2.2, 0.6, 1)
img = np.clip(img * v[..., None], 0, 255).astype(np.uint8)

out = Image.fromarray(img, "RGB").filter(ImageFilter.GaussianBlur(2))
out.save("win7-wallpaper.jpg", quality=88, optimize=True)
print("saved win7-wallpaper.jpg", out.size)
