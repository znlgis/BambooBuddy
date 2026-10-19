"""生成应用图标与启动图。

刻意用几何图形画：和游戏内的美术保持一致（圆润卡通 + 竹绿/暖色），
而且不引入任何需要授权的素材。

产物：
  apps/desktop/src-tauri/icon-source.png   → 交给 `pnpm exec tauri icon` 生成全套桌面图标
  apps/mobile/resources/*.png              → 交给 `capacitor-assets` 生成安卓图标与启动图
"""

import os
from PIL import Image, ImageDraw

S = 1024
CREAM = (250, 243, 231, 255)
CREAM_DEEP = (240, 228, 207, 255)
INK = (74, 59, 47, 255)
PANDA = (251, 247, 239, 255)
BLACK = (59, 58, 55, 255)
BLUSH = (242, 184, 174, 255)
BAMBOO = (122, 160, 92, 255)
BAMBOO_DEEP = (85, 121, 63, 255)
GOLD = (242, 193, 78, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = size / 1024.0

    def box(x0, y0, x1, y1):
        return [x0 * u, y0 * u, x1 * u, y1 * u]

    def w(v):
        return max(1, int(v * u))

    # 竹绿圆角方底 + 米白内衬
    d.rounded_rectangle(box(0, 0, 1023, 1023), radius=int(220 * u), fill=BAMBOO, outline=INK, width=w(16))
    d.rounded_rectangle(box(74, 74, 949, 949), radius=int(170 * u), fill=CREAM, outline=INK, width=w(10))

    # 竹子（左右各一根，压在熊猫身后）
    for cx, top, bottom in ((214, 250, 900), (812, 300, 900)):
        d.rounded_rectangle(box(cx - 26, top, cx + 26, bottom), radius=int(26 * u), fill=BAMBOO, outline=INK, width=w(8))
        for y in range(top + 120, bottom - 60, 150):
            d.rectangle(box(cx - 26, y, cx + 26, y + 14), fill=BAMBOO_DEEP)

    # 耳朵
    for cx in (352, 672):
        d.ellipse(box(cx - 92, 208 - 92, cx + 92, 208 + 92), fill=BLACK, outline=INK, width=w(8))

    # 头
    d.ellipse(box(512 - 274, 560 - 274, 512 + 274, 560 + 274), fill=PANDA, outline=INK, width=w(10))

    # 眼斑 + 眼睛（圆润卡通的关键：眼斑大、眼白小高光）
    for cx in (402, 622):
        d.ellipse(box(cx - 88, 520 - 116, cx + 88, 520 + 116), fill=BLACK)
        d.ellipse(box(cx - 34, 524 - 34, cx + 34, 524 + 34), fill=(255, 255, 255, 255))
        d.ellipse(box(cx - 18, 530 - 18, cx + 18, 530 + 18), fill=BLACK)
        d.ellipse(box(cx + 2, 500, cx + 20, 518), fill=(255, 255, 255, 255))

    # 鼻子与嘴
    d.ellipse(box(512 - 52, 636 - 40, 512 + 52, 636 + 40), fill=BLACK)
    d.line(box(512, 676, 512, 718), fill=INK, width=w(10))
    d.arc(box(512 - 92, 700, 512 + 92, 800), start=20, end=160, fill=INK, width=w(12))

    # 腮红
    for cx in (330, 694):
        d.ellipse(box(cx - 66, 640 - 40, cx + 66, 640 + 40), fill=BLUSH)

    # 头顶一枚竹叶
    d.ellipse(box(512 - 92, 232, 512 + 92, 300), fill=BAMBOO_DEEP, outline=INK, width=w(6))

    return img


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icon = draw_icon(S)

    targets = [
        os.path.join(root, "apps", "desktop", "src-tauri", "icon-source.png"),
        os.path.join(root, "apps", "mobile", "resources", "icon.png"),
        os.path.join(root, "apps", "mobile", "resources", "icon-only.png"),
        os.path.join(root, "apps", "mobile", "resources", "icon-foreground.png"),
    ]
    for path in targets:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        icon.save(path)
        print("icon  ->", path)

    # 启动图：纸色底 + 居中图标（安卓需要方形，避免被裁）
    splash = Image.new("RGBA", (2732, 2732), CREAM)
    small = icon.resize((1100, 1100), Image.LANCZOS)
    splash.paste(small, ((2732 - 1100) // 2, (2732 - 1100) // 2), small)
    splash_path = os.path.join(root, "apps", "mobile", "resources", "splash.png")
    splash.save(splash_path)
    print("splash->", splash_path)


if __name__ == "__main__":
    main()
