"""Generates xp-wallpaper.jpg: an original 'green hill under a blue sky'
wallpaper (2960x1848), drawn from scratch (not the Windows XP photo)."""
import math, random
from PIL import Image, ImageDraw, ImageFilter

W, H = 2960, 1848
random.seed(7)
img = Image.new("RGB", (W, H))
d = ImageDraw.Draw(img)
# sky: deep blue at the top to light blue at the horizon
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(30 + 120 * t), int(90 + 120 * t), int(200 + 50 * t)))
# soft clouds
clouds = Image.new("L", (W, H), 0)
cd = ImageDraw.Draw(clouds)
for _ in range(16):
    cx, cy = random.randint(0, W), random.randint(80, int(H * 0.45))
    for _ in range(9):
        rx, ry = random.randint(120, 300), random.randint(50, 110)
        ox, oy = random.randint(-260, 260), random.randint(-50, 50)
        cd.ellipse((cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry), fill=random.randint(110, 200))
clouds = clouds.filter(ImageFilter.GaussianBlur(40))
img = Image.composite(Image.new("RGB", (W, H), (250, 252, 255)), img, clouds)
# rolling green hills
def hill(base, amp, freq, phase):
    return [(x, base - amp * math.sin(x / W * math.pi * freq + phase)) for x in range(0, W + 8, 8)]
back = Image.new("L", (W, H), 0)
ImageDraw.Draw(back).polygon(hill(H * 0.66, 90, 1.6, 0.9) + [(W, H), (0, H)], fill=255)
front = Image.new("L", (W, H), 0)
ImageDraw.Draw(front).polygon(hill(H * 0.72, 190, 1.0, 0.25) + [(W, H), (0, H)], fill=255)
grass_back = Image.new("RGB", (W, H))
grass = Image.new("RGB", (W, H))
gb, gf = ImageDraw.Draw(grass_back), ImageDraw.Draw(grass)
for y in range(H):
    t = max(0.0, (y - H * 0.5) / (H * 0.5))
    gb.line([(0, y), (W, y)], fill=(int(70 + 30 * t), int(140 + 20 * t), int(40 + 10 * t)))
    gf.line([(0, y), (W, y)], fill=(int(90 - 40 * t), int(175 - 40 * t), int(40 - 10 * t)))
img = Image.composite(grass_back, img, back.filter(ImageFilter.GaussianBlur(3)))
# light on the front hill
glow = Image.new("L", (W, H), 0)
ImageDraw.Draw(glow).ellipse((W * 0.15, H * 0.55, W * 0.75, H * 1.1), fill=90)
grass = Image.composite(Image.new("RGB", (W, H), (150, 210, 70)), grass, glow.filter(ImageFilter.GaussianBlur(150)))
img = Image.composite(grass, img, front.filter(ImageFilter.GaussianBlur(3)))
img.save(__file__.replace("make-xp-wallpaper.py", "xp-wallpaper.jpg"), quality=86, optimize=True)
