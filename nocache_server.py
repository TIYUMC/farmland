import http.server, socketserver, os

PORT = 3000
ROOT = r"C:\Users\21430\Desktop\星露谷\stardew-web"

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        # 强制浏览器每次都重新拉取，杜绝 JS 缓存导致的「问题没变」
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, *a):
        pass

with socketserver.TCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
    print(f"serving {ROOT} on :{PORT} (no-cache)")
    httpd.serve_forever()
