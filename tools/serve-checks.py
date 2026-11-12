#!/usr/bin/env python3
# 実ブラウザ確認用の配信。使い方: web で python3 tools/serve-checks.py [port]（既定 8992）。
# 標準の python3 -m http.server は接続の待ち行列が5件しかなく、1ページが100本近い台本を
# 同時に取りに来ると接続を落とし、確認が「変数が未定義」で不規則に落ちるため、待ち行列だけ広げている。
import http.server
import sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


Server(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8992), Quiet).serve_forever()
