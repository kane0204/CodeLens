"""Loopback-only web adapter; source stays in memory and is never executed."""
import argparse
import json
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

CODE_ROOT = Path(__file__).resolve().parents[1]
if str(CODE_ROOT) not in sys.path:
    sys.path.insert(0, str(CODE_ROOT))

from core_engine.engine import analyze, VERSION

ROOT = CODE_ROOT / "frontend"
TOKEN = secrets.token_urlsafe(32)
MAX_BODY = 12 * 1024 * 1024
STATIC = {"/":("index.html","text/html"),"/index.html":("index.html","text/html"),
          "/app.js":("app.js","text/javascript"),"/styles.css":("styles.css","text/css")}
# 前端按模块拆成多份静态资源，这里只放行 ROOT 下这几个目录与这几种扩展名。
ASSET_DIRS = ("lib", "views", "features", "assets")
ASSET_TYPES = {".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".woff2":"font/woff2"}


def resolve_asset(path):
    """把请求路径映射到 ROOT 内的真实文件；不在白名单内一律返回 None（含目录穿越）。"""
    if path in STATIC:
        name, mime = STATIC[path]
        return ROOT / name, mime
    if ".." in path or "\\" in path or "//" in path:
        return None
    parts = [seg for seg in path.split("/") if seg]
    if len(parts) < 2 or parts[0] not in ASSET_DIRS:
        return None
    # 最后一段是文件名：允许 stem 与单个后缀；中间目录只允许字母数字/-_。
    stem, dot, suffix = parts[-1].rpartition(".")
    if not dot or not stem or stem.startswith("."):
        return None
    if not all(ch.isalnum() or ch in "-_" for ch in stem):
        return None
    mime = ASSET_TYPES.get("." + suffix)
    if mime is None:
        return None
    for seg in parts[:-1]:
        if seg.startswith(".") or not all(ch.isalnum() or ch in "-_" for ch in seg):
            return None
    root = ROOT.resolve()
    candidate = root.joinpath(*parts).resolve()
    if candidate != root and root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate, mime


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        # No source, project names or request payloads in logs.
        pass

    def send_data(self, status, body, mime="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def allowed_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def do_GET(self):
        if not self.allowed_host():
            return self.send_data(403,{"error":"只允许本机访问"})
        path = urlsplit(self.path).path
        if path == "/api/status":
            return self.send_data(200,{"ready":True,"engine_version":VERSION,"token":TOKEN})
        asset = resolve_asset(path)
        if asset is None:
            return self.send_data(404,{"error":"路径不存在"})
        try:
            return self.send_data(200,asset[0].read_bytes(),asset[1])
        except OSError:
            return self.send_data(404,{"error":"路径不存在"})

    def do_POST(self):
        origin = self.headers.get("Origin")
        origins = {f"http://127.0.0.1:{self.server.server_port}",f"http://localhost:{self.server.server_port}"}
        if not self.allowed_host() or origin not in origins or self.headers.get("X-CodeLens-Token") != TOKEN:
            return self.send_data(403,{"error":"请从本机 CodeLens 页面发起分析"})
        if urlsplit(self.path).path != "/api/analyze":
            return self.send_data(404,{"error":"接口不存在"})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send_data(415,{"error":"仅支持 JSON 请求"})
        try:
            length = int(self.headers.get("Content-Length","0"))
            if not 0 < length <= MAX_BODY:
                return self.send_data(413,{"error":"请求超过 12 MB 或为空"})
            self.connection.settimeout(30)
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("请求数据不完整")
            result = analyze(json.loads(data))
            self.send_data(200,result)
        except (ValueError, UnicodeError, TypeError) as exc:
            self.send_data(400,{"error":str(exc)[:200]})
        except Exception:
            self.send_data(500,{"error":"分析失败，请缩小项目范围后重试；未生成替代结果"})


def main():
    parser = argparse.ArgumentParser(description="CodeLens 本机真实 Python 静态分析")
    parser.add_argument("--port",type=int,default=18766)
    args = parser.parse_args()
    if sys.version_info < (3,11):
        raise SystemExit("需要 Python 3.11 或更高版本")
    try:
        server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    except OSError as exc:
        raise SystemExit(f"无法启动端口 {args.port}，可使用 --port 更换端口：{exc}")
    print(f"CodeLens {VERSION}: http://127.0.0.1:{args.port}",flush=True)
    print("Select a project folder in your browser. Ctrl+C to stop.",flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
