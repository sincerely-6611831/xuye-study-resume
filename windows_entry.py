"""Windows 打包入口：将可写数据库放进用户目录，静态网页随程序一起携带。"""
import os
from pathlib import Path
import socket
import threading
import time
import webbrowser

import uvicorn


def main():
    base = Path(os.getenv("LOCALAPPDATA", Path.home())) / "XuYe"
    base.mkdir(parents=True, exist_ok=True)
    os.environ["STUDY_DATA_DIR"] = str(base / "data")
    port = int(os.getenv("STUDY_PORT", "8000"))
    url = f"http://127.0.0.1:{port}/"

    def open_when_ready():
        for _ in range(60):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    webbrowser.open(url)
                    return
            except OSError:
                time.sleep(0.2)

    if os.getenv("STUDY_NO_BROWSER") != "1":
        threading.Thread(target=open_when_ready, daemon=True).start()
    uvicorn.run("backend.app.main:create_app", factory=True, host=os.getenv("STUDY_HOST", "127.0.0.1"), port=port)


if __name__ == "__main__":
    main()
