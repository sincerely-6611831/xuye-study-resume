"""从网页 Logo 生成 Windows 与 Android 启动图标。

只在 Logo 更新时运行本脚本；生成的图标文件直接提交到仓库，正常构建无需 Pillow。
安装生成工具：.venv\\Scripts\\python.exe -m pip install Pillow
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend" / "public" / "icon-512.png"
WINDOWS_ICON = ROOT / "windows" / "XuYe.ico"
ANDROID_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def main() -> None:
    # 网页、桌面、手机和手表共用同一份原始 Logo，避免平台外观不一致。
    with Image.open(SOURCE) as original:
        logo = original.convert("RGBA")

    logo.save(
        WINDOWS_ICON,
        format="ICO",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )

    for platform in ("mobile", "wear"):
        for density, size in ANDROID_SIZES.items():
            target_dir = ROOT / "android" / platform / "src" / "main" / "res" / f"mipmap-{density}"
            target_dir.mkdir(parents=True, exist_ok=True)
            resized = logo.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(target_dir / "ic_launcher.png")

            # 圆形入口专供圆屏和使用圆形启动器的设备；中间标记保持在安全区域内。
            mask = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
            round_icon = resized.copy()
            round_icon.putalpha(mask)
            round_icon.save(target_dir / "ic_launcher_round.png")

    print(f"Generated icons from {SOURCE}")


if __name__ == "__main__":
    main()
