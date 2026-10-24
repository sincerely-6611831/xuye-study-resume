"""一键准备与启动。初次运行会创建虚拟环境、安装依赖并构建前端。"""

import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(args, cwd=ROOT):
    # 用参数列表调用，避免路径里的空格、中文或特殊符号被当作shell命令。
    print("正在执行：", " ".join(str(a) for a in args), flush=True)
    subprocess.run([str(a) for a in args], cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser(description="启动学习断片续接器")
    parser.add_argument("--setup", action="store_true", help="重新安装依赖和构建界面")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not PYTHON.exists():
        run([sys.executable, "-m", "venv", ROOT / ".venv"])
    # 检查完整应用入口能否导入，避免仅安装了一部分依赖时误判准备成功。
    check = subprocess.run(
        [str(PYTHON), "-c", "from backend.app.main import create_app; import uvicorn"],
        cwd=ROOT,
        capture_output=True,
    )
    if args.setup or check.returncode:
        lock = ROOT / "requirements.lock.txt"
        run(
            [
                PYTHON,
                "-m",
                "pip",
                "install",
                "-r",
                lock if lock.exists() else ROOT / "requirements.txt",
            ]
        )
    front = ROOT / "frontend"
    dist = front / "dist" / "index.html"
    sources = (
        list((front / "src").rglob("*"))
        + list((front / "public").rglob("*"))
        + [front / "package.json", front / "package-lock.json"]
    )
    rebuild = (
        args.setup
        or not dist.exists()
        or any(
            p.is_file() and p.stat().st_mtime > dist.stat().st_mtime for p in sources
        )
    )
    if rebuild:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise RuntimeError("未找到Node.js/npm，请先安装Node.js LTS后重新运行。")
        # 仅检查 node_modules 目录不够：新增 Motion 等依赖后，旧目录仍存在但缺少新包。
        installed_lock = front / "node_modules" / ".package-lock.json"
        manifest_changed = max(
            (front / "package.json").stat().st_mtime,
            (front / "package-lock.json").stat().st_mtime,
        )
        if (
            args.setup
            or not installed_lock.exists()
            or installed_lock.stat().st_mtime < manifest_changed
        ):
            run([npm, "ci"], front)
        run([npm, "run", "build"], front)
    # 检查端口，避免用户误以为新服务已启动，实际上打开的是另一个程序。
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", args.port)) == 0:
            print(
                f"端口{args.port}已有服务。若是本应用，可直接打开 http://127.0.0.1:{args.port}；否则使用 --port 8002。"
            )
            return
    url = f"http://127.0.0.1:{args.port}"
    print(
        f"\n电脑打开：{url}\n手机/平板：在同一可互通网络中，使用电脑的局域网IP和相同端口。\n按 Ctrl+C 停止服务。\n",
        flush=True,
    )
    if not args.no_browser:

        def open_browser():
            for _ in range(30):
                try:
                    with socket.create_connection(
                        ("127.0.0.1", args.port), timeout=0.3
                    ):
                        webbrowser.open(url)
                        return
                except OSError:
                    time.sleep(0.3)

        threading.Thread(target=open_browser, daemon=True).start()
    try:
        run(
            [
                PYTHON,
                "-m",
                "uvicorn",
                "backend.app.main:create_app",
                "--factory",
                "--host",
                "0.0.0.0",
                "--port",
                args.port,
            ]
        )
    except KeyboardInterrupt:
        print("\n服务已停止。已保存记录位于data目录。")


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, RuntimeError) as e:
        print("启动未完成：", e)
        sys.exit(1)
