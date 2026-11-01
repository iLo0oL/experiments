"""Generates wallpaper.jpg: an original blue 'light beams' wallpaper (2960x1848)."""
import math, random
from PIL import Image, ImageDraw, ImageFilter

W, H = 2960, 1848
random.seed(10)
img = Image.new("RGB", (W, H))
px = img.load()
# deep navy -> blue vertical/radial gradient
cx, cy = W * 0.62, H * 0.46
for y in range(H):
    for x in range(0, W, 2):
        d = math.hypot((x - cx) / W, (y - cy) / H)
        t = max(0.0, 1 - d * 1.9)
        c = (int(2 + 10 * t), int(10 + 70 * t * t), int(32 + 150 * t * t))
        px[x, y] = c
        if x + 1 < W:
            px[x + 1, y] = c
# light beams fanning out from the glow point
beams = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(beams)
for i in range(38):
    a = math.radians(random.uniform(150, 260))
    spread = math.radians(random.uniform(0.6, 2.4))
    r = W * 1.4
    p1 = (cx + r * math.cos(a - spread), cy + r * math.sin(a - spread))
    p2 = (cx + r * math.cos(a + spread), cy + r * math.sin(a + spread))
    d.polygon([(cx, cy), p1, p2], fill=random.randint(18, 60))
beams = beams.filter(ImageFilter.GaussianBlur(18))
glow = Image.new("RGB", (W, H), (80, 170, 255))
img = Image.composite(glow, img, beams)
# soft central glow
g = Image.new("L", (W, H), 0)
ImageDraw.Draw(g).ellipse((cx - 260, cy - 260, cx + 260, cy + 260), fill=150)
g = g.filter(ImageFilter.GaussianBlur(160))
img = Image.composite(Image.new("RGB", (W, H), (150, 210, 255)), img, g)
img.save(__file__.replace("make-wallpaper.py", "wallpaper.jpg"), quality=86, optimize=True)
