"""ROS 토픽 → 브라우저 중계의 HTTP 부분 (ROS 없이도 동작한다).

토픽 소스(실제 rclpy 구독 또는 모의 데이터)가 Hub.offer() 로 메시지를 넘기면,
Hub 가 토픽마다 정한 주기로 최신 메시지만 골라 브라우저에 보낸다. 늦게 받는 쪽이 있어도 밀리지 않는다.

  GET /api/topics                 → 그래프에 보이는 토픽, 타입, 받은 주기(Hz), 구독 여부
  GET /api/stream?topics=/a,/b    → Server-Sent Events. event: msg, data: {"topic","type","stamp","msg"}
                                    msg 는 ROS 메시지 필드를 그대로 JSON 으로 옮긴 것(raw)
  GET /api/image?topic=/x         → multipart MJPEG (카메라는 raw 대신 JPEG 으로 줄여 보낸다)
  그 밖의 경로                    → --root 폴더의 정적 파일 (같은 주소에서 페이지를 열 수 있게)

웹 → ROS 방향(발행)은 없다. 구독해서 보여주기만 한다.
"""
import json
import math
import threading
import time
from collections import deque
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# 토픽별 최대 전송 주기(Hz). 받는 주기가 더 빨라도 이 이상은 보내지 않는다.
RATE = {"/joint_states": 30, "/tf": 30, "/odom": 20, "/scan": 10, "/plan": 4, "/local_plan": 4,
        "/map": 1, "/global_costmap/costmap": 1, "/local_costmap/costmap": 2}
DEFAULT_RATE = 10
IMAGE_RATE = 10
MERGED = ("/tf", "/tf_static")     # 여러 노드가 나눠 보내는 TF 는 child_frame_id 기준으로 합쳐서 보낸다


def clean(v):
    """JSON 으로 못 쓰는 값(inf, nan)을 null 로 바꾼다."""
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        if v and isinstance(v[0], (int, str)) and not isinstance(v[0], bool) and isinstance(v[-1], type(v[0])):
            return v                               # 지도 data 같은 큰 정수 배열은 그대로
        return [clean(x) for x in v]
    return v


class Topic:
    def __init__(self, name, type_name):
        self.name, self.type = name, type_name
        self.period = 1.0 / RATE.get(name, DEFAULT_RATE)
        self.raw = None            # 아직 변환하지 않은 최신 메시지
        self.convert = None        # raw → dict
        self.dirty = False
        self.last_sent = 0.0
        self.payload = None        # 마지막으로 보낸 SSE 조각(새로 붙은 브라우저에 바로 준다)
        self.recv = deque(maxlen=200)
        self.merged = {}           # /tf, /tf_static: child_frame_id → transform

    def hz(self, now):
        ts = [t for t in self.recv if now - t < 2.0]
        return round((len(ts) - 1) / (ts[-1] - ts[0]), 1) if len(ts) > 2 and ts[-1] > ts[0] else 0.0


class Client:
    def __init__(self, topics):
        self.topics = set(topics)
        self.pending = {}
        self.event = threading.Event()


class Hub:
    def __init__(self, ensure=None, list_graph=None):
        """ensure(topic) → 구독을 시작한다(없으면 무시). list_graph() → [(이름, 타입)]."""
        self.lock = threading.Lock()
        self.topics = {}
        self.clients = []
        self.images = {}           # topic → {"raw", "encode", "jpeg", "dirty", "last", "cond", "viewers"}
        self.ensure = ensure or (lambda t: None)
        self.list_graph = list_graph or (lambda: [])
        threading.Thread(target=self._flush_loop, daemon=True).start()

    # ---------- 소스 쪽 ----------
    def offer(self, name, type_name, raw, convert=None):
        """메시지 하나가 들어왔다. 변환은 실제로 보낼 때만 한다."""
        now = time.time()
        with self.lock:
            t = self.topics.get(name)
            if t is None:
                t = self.topics[name] = Topic(name, type_name)
            t.recv.append(now)
            if name in MERGED:
                msg = convert(raw) if convert else raw
                for tr in msg.get("transforms", []):
                    t.merged[tr["child_frame_id"]] = tr
                t.raw, t.convert = {"transforms": list(t.merged.values())}, None
            else:
                t.raw, t.convert = raw, convert
            t.dirty = True

    def offer_image(self, name, type_name, raw, encode):
        """encode(raw) → JPEG bytes. 보는 브라우저가 있을 때만 인코딩한다."""
        now = time.time()
        with self.lock:
            t = self.topics.get(name)
            if t is None:
                t = self.topics[name] = Topic(name, type_name)
            t.recv.append(now)
            im = self.images.setdefault(name, {"jpeg": None, "seq": 0, "dirty": False, "last": 0.0, "cond": threading.Condition(), "viewers": 0})
            im["raw"], im["encode"], im["dirty"] = raw, encode, True

    # ---------- 보내기 ----------
    def _flush_loop(self):
        while True:
            now = time.time()
            out = []
            with self.lock:
                for t in self.topics.values():
                    if t.dirty and now - t.last_sent >= t.period and t.name not in self.images:
                        t.dirty, t.last_sent = False, now
                        out.append((t, t.raw, t.convert))
                imgs = [(n, im) for n, im in self.images.items()
                        if im["dirty"] and im["viewers"] > 0 and now - im["last"] >= 1.0 / IMAGE_RATE]
                for _, im in imgs:
                    im["dirty"], im["last"] = False, now
            for t, raw, convert in out:
                try:
                    msg = convert(raw) if convert else raw
                    data = json.dumps({"topic": t.name, "type": t.type, "stamp": round(now, 3), "msg": clean(msg)},
                                      ensure_ascii=False, separators=(",", ":"))
                except Exception as e:  # 변환 실패는 그 토픽만 건너뛴다
                    data = json.dumps({"topic": t.name, "type": t.type, "stamp": round(now, 3), "error": str(e)})
                chunk = ("event: msg\ndata: " + data + "\n\n").encode("utf-8")
                with self.lock:
                    t.payload = chunk
                    for c in self.clients:
                        if t.name in c.topics:
                            c.pending[t.name] = chunk
                            c.event.set()
            for name, im in imgs:
                try:
                    jpeg = im["encode"](im["raw"])
                except Exception:
                    jpeg = None
                if jpeg:
                    with im["cond"]:
                        im["jpeg"] = jpeg
                        im["seq"] += 1
                        im["cond"].notify_all()
            time.sleep(0.01)

    def topics_info(self):
        now = time.time()
        graph = dict(self.list_graph())
        with self.lock:
            for n, t in self.topics.items():
                graph.setdefault(n, t.type)
            return [{"name": n, "type": ty, "subscribed": n in self.topics,
                     "hz": self.topics[n].hz(now) if n in self.topics else 0.0,
                     "image": n in self.images}
                    for n, ty in sorted(graph.items())]

    def add_client(self, topics):
        for t in topics:
            self.ensure(t)
        c = Client(topics)
        with self.lock:
            for t in topics:                     # 최근 값(지도, TF static 등)을 바로 준다
                tp = self.topics.get(t)
                if tp is not None and tp.payload:
                    c.pending[t] = tp.payload
            self.clients.append(c)
        c.event.set()
        return c

    def remove_client(self, c):
        with self.lock:
            if c in self.clients:
                self.clients.remove(c)


def make_handler(hub, root):
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def end_headers(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            if u.path == "/api/topics":
                body = json.dumps(hub.topics_info(), ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif u.path == "/api/stream":
                topics = [t for t in ",".join(q.get("topics", [])).split(",") if t]
                self._stream(topics)
            elif u.path == "/api/image":
                self._mjpeg(q.get("topic", [""])[0])
            else:
                super().do_GET()

        def _stream(self, topics):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.end_headers()
            c = hub.add_client(topics)
            try:
                self.wfile.write(b"retry: 2000\n\n")
                while True:
                    if not c.event.wait(15):
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        continue
                    with hub.lock:
                        chunks, c.pending = list(c.pending.values()), {}
                        c.event.clear()
                    self.wfile.write(b"".join(chunks))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                hub.remove_client(c)

        def _mjpeg(self, topic):
            hub.ensure(topic)
            im = None
            for _ in range(30):                  # 첫 프레임이 올 때까지 최대 3초 기다린다
                with hub.lock:
                    im = hub.images.get(topic)
                if im is not None:
                    break
                time.sleep(0.1)
            if im is None:
                self.send_error(404, "image topic not available")
                return
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            with hub.lock:
                im["viewers"] += 1
            last = -1
            try:
                while True:
                    with im["cond"]:            # 프레임 번호로 새 프레임을 안다(같은 그림이 와도 계속 보낸다)
                        im["cond"].wait_for(lambda: im["seq"] != last, timeout=15)
                        jpeg, seq = im["jpeg"], im["seq"]
                    if jpeg is None or seq == last:
                        continue
                    last = seq
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                with hub.lock:
                    im["viewers"] -= 1

    return partial(Handler, directory=str(root))


def serve(hub, root, host, port):
    httpd = ThreadingHTTPServer((host, port), make_handler(hub, root))
    httpd.daemon_threads = True
    print(f"중계 서버: http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}/  (페이지 예: /redesign/live.html)")
    httpd.serve_forever()
