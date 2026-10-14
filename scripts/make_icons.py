"""Генерация PNG-иконок PWA (192 и 512) — синий фон + белая молния."""
from PIL import Image, ImageDraw

BLUE = (27, 110, 243, 255)
WHITE = (255, 255, 255, 255)


def draw(size):
    img = Image.new("RGBA", (size, size), BLUE)
    d = ImageDraw.Draw(img)
    s = size
    # Молния (относительные координаты, внутри safe-zone для maskable)
    bolt = [
        (0.60 * s, 0.14 * s),
        (0.32 * s, 0.56 * s),
        (0.47 * s, 0.56 * s),
        (0.42 * s, 0.86 * s),
        (0.70 * s, 0.42 * s),
        (0.55 * s, 0.42 * s),
    ]
    d.polygon(bolt, fill=WHITE)
    return img


if __name__ == "__main__":
    import os

    out = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
    os.makedirs(out, exist_ok=True)
    for sz in (192, 512):
        draw(sz).save(os.path.join(out, f"icon-{sz}.png"))
    print("icons generated:", os.path.abspath(out))
