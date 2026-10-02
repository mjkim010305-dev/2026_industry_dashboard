#!/usr/bin/env python3
"""ROS 없이 중계 서버를 흉내 낸다 (화면 개발·시험용). 파이썬 표준 라이브러리만 쓴다.

    python ros/mock_relay.py            # http://localhost:8765/redesign/live.html

topic_relay.py 와 같은 HTTP API 로, 실제 로봇과 같은 모양의 raw 메시지를 보낸다.
  /map (nav_msgs/OccupancyGrid)   data/real.yaml + real.pgm 을 map_server 규칙으로 바꾼 것
  /tf, /tf_static                  map→odom(조금 어긋나게) → base_footprint → base_link → base_scan, d555_link
  /odom, /joint_states             기체가 지도 안을 돌아다니고, 팔·그리퍼가 천천히 움직인다
  /scan (sensor_msgs/LaserScan)    지도 벽에 광선을 쏴서 만든 360° 거리
  /plan (nav_msgs/Path)            앞으로 갈 길(흉내)
  /camera/camera/color/image_raw   assets/poster.jpg 를 MJPEG 으로
"""
import argparse
import math
import random
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from relay_http import Hub, serve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


# ---------- 지도 ----------
def load_map(yaml_path):
    meta = {}
    for line in yaml_path.read_text(encoding="utf-8").splitlines():
        if ":" in line and not line.strip().startswith("#"):
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    res = float(meta["resolution"])
    origin = [float(x) for x in meta["origin"].strip("[]").split(",")]
    neg = int(float(meta.get("negate", 0)))
    occ_t, free_t = float(meta.get("occupied_thresh", 0.65)), float(meta.get("free_thresh", 0.25))
    raw = (yaml_path.parent / meta["image"]).read_bytes()
    # PGM P5 헤더: 매직, 너비, 높이, 최대값 (주석 줄 건너뜀)
    toks, pos = [], 0
    while len(toks) < 4:
        while raw[pos:pos + 1].isspace():
            pos += 1
        if raw[pos:pos + 1] == b"#":
            pos = raw.index(b"\n", pos) + 1
            continue
        end = pos
        while not raw[end:end + 1].isspace():
            end += 1
        toks.append(raw[pos:end].decode())
        pos = end
    pos += 1
    w, h, mx = int(toks[1]), int(toks[2]), int(toks[3])
    px = raw[pos:pos + w * h]
    data = [0] * (w * h)
    for r in range(h):                 # OccupancyGrid 는 아래 줄(원점 쪽)부터
        src = (h - 1 - r) * w
        for c in range(w):
            v = px[src + c] / mx
            p = v if neg else 1.0 - v
            data[r * w + c] = 100 if p > occ_t else 0 if p < free_t else -1
    return {"w": w, "h": h, "res": res, "origin": origin, "data": data}


def stamp(t):
    return {"sec": int(t), "nanosec": int((t % 1) * 1e9)}


def quat(yaw):
    return {"x": 0.0, "y": 0.0, "z": math.sin(yaw / 2), "w": math.cos(yaw / 2)}


def tf(t, parent, child, x, y, z, yaw):
    return {"header": {"stamp": stamp(t), "frame_id": parent}, "child_frame_id": child,
            "transform": {"translation": {"x": x, "y": y, "z": z}, "rotation": quat(yaw)}}


class Sim:
    LASER = (-0.024, 0.0, 0.132)       # base_footprint 기준 base_scan 위치(대략)
    MAP_TO_ODOM = (0.06, -0.04, 0.03)  # AMCL 보정처럼 조금 어긋나게

    def __init__(self, m):
        self.m = m
        self.x, self.y, self.yaw = self.start()
        self.v, self.w = 0.0, 0.0
        self.turn = 0
        self.wl = self.wr = 0.0
        self.t0 = time.time()

    def occ(self, x, y):
        m = self.m
        c, r = int((x - m["origin"][0]) / m["res"]), int((y - m["origin"][1]) / m["res"])
        if c < 0 or r < 0 or c >= m["w"] or r >= m["h"]:
            return True
        return m["data"][r * m["w"] + c] != 0       # 막힘과 모름은 못 지나간다

    def free_circle(self, x, y, rad=0.2):
        return all(not self.occ(x + rad * math.cos(a), y + rad * math.sin(a)) for a in [k * math.pi / 6 for k in range(12)]) and not self.occ(x, y)

    def start(self):
        for d in [i * 0.05 for i in range(60)]:
            for k in range(16):
                a = k * math.pi / 8
                x, y = d * math.cos(a), d * math.sin(a)
                if self.free_circle(x, y, 0.25):
                    return x, y, 0.0
        raise SystemExit("지도에서 빈 자리를 못 찾았어요")

    def step(self, dt):
        ahead = self.free_circle(self.x + 0.3 * math.cos(self.yaw), self.y + 0.3 * math.sin(self.yaw))
        if self.turn == 0 and not ahead:
            l = self.free_circle(self.x + 0.3 * math.cos(self.yaw + 0.8), self.y + 0.3 * math.sin(self.yaw + 0.8))
            self.turn = 1 if l else -1
        if self.turn and ahead and random.random() < 0.08:
            self.turn = 0
        self.v = 0.0 if self.turn else 0.15
        self.w = 0.9 * self.turn if self.turn else 0.15 * math.sin(time.time() * 0.4)
        nx, ny = self.x + self.v * math.cos(self.yaw) * dt, self.y + self.v * math.sin(self.yaw) * dt
        if self.free_circle(nx, ny):
            self.x, self.y = nx, ny
        self.yaw = math.atan2(math.sin(self.yaw + self.w * dt), math.cos(self.yaw + self.w * dt))
        self.wl += (self.v - self.w * 0.1435) / 0.033 * dt
        self.wr += (self.v + self.w * 0.1435) / 0.033 * dt

    def odom_pose(self):
        mx, my, myaw = self.MAP_TO_ODOM
        dx, dy = self.x - mx, self.y - my
        c, s = math.cos(-myaw), math.sin(-myaw)
        return dx * c - dy * s, dx * s + dy * c, self.yaw - myaw

    def joints(self, t):
        k = t - self.t0
        return [0.9 * math.sin(k * 0.35), -0.6 + 0.45 * math.sin(k * 0.5), 0.3 + 0.35 * math.sin(k * 0.45 + 1),
                0.6 + 0.4 * math.sin(k * 0.6 + 2)], 0.0045 + 0.0135 * math.sin(k * 0.8)

    def scan(self, t):
        lx, ly, _ = self.LASER
        sx = self.x + lx * math.cos(self.yaw) - ly * math.sin(self.yaw)
        sy = self.y + lx * math.sin(self.yaw) + ly * math.cos(self.yaw)
        n, rmax, step = 360, 8.0, self.m["res"] * 0.7
        ranges = []
        for i in range(n):
            a = self.yaw + i * 2 * math.pi / n
            ca, sa, d = math.cos(a), math.sin(a), 0.12
            while d < rmax and not self.occ_wall(sx + d * ca, sy + d * sa):
                d += step
            ranges.append(round(d + random.gauss(0, 0.01), 3) if d < rmax else float("inf"))
        return {"header": {"stamp": stamp(t), "frame_id": "base_scan"}, "angle_min": 0.0, "angle_max": 2 * math.pi * (n - 1) / n,
                "angle_increment": 2 * math.pi / n, "time_increment": 0.0, "scan_time": 0.1,
                "range_min": 0.12, "range_max": rmax, "ranges": ranges, "intensities": [0.0] * n}

    def occ_wall(self, x, y):
        m = self.m
        c, r = int((x - m["origin"][0]) / m["res"]), int((y - m["origin"][1]) / m["res"])
        if c < 0 or r < 0 or c >= m["w"] or r >= m["h"]:
            return True
        return m["data"][r * m["w"] + c] == 100

    def plan(self, t):
        x, y, yaw, poses = self.x, self.y, self.yaw, []
        for k in range(60):
            nx, ny = x + 0.05 * math.cos(yaw), y + 0.05 * math.sin(yaw)
            if not self.free_circle(nx, ny, 0.18):
                yaw += 0.35
                continue
            x, y = nx, ny
            yaw += 0.03 * math.sin(k * 0.2)
            poses.append({"header": {"stamp": stamp(t), "frame_id": "map"},
                          "pose": {"position": {"x": x, "y": y, "z": 0.0}, "orientation": quat(yaw)}})
        return {"header": {"stamp": stamp(t), "frame_id": "map"}, "poses": poses}


GRAPH = [("/map", "nav_msgs/msg/OccupancyGrid"), ("/tf", "tf2_msgs/msg/TFMessage"), ("/tf_static", "tf2_msgs/msg/TFMessage"),
         ("/odom", "nav_msgs/msg/Odometry"), ("/joint_states", "sensor_msgs/msg/JointState"),
         ("/scan", "sensor_msgs/msg/LaserScan"), ("/plan", "nav_msgs/msg/Path"),
         ("/camera/camera/color/image_raw", "sensor_msgs/msg/Image")]


def run(hub, m, map_name):
    sim = Sim(m)
    t = time.time()
    grid = {"header": {"stamp": stamp(t), "frame_id": "map"},
            "info": {"map_load_time": stamp(t), "resolution": m["res"], "width": m["w"], "height": m["h"],
                     "origin": {"position": {"x": m["origin"][0], "y": m["origin"][1], "z": 0.0}, "orientation": quat(m["origin"][2])}},
            "data": m["data"]}
    lx, ly, lz = Sim.LASER
    static = {"transforms": [tf(t, "base_footprint", "base_link", 0, 0, 0.010, 0),
                             tf(t, "base_link", "base_scan", lx, ly, lz - 0.010, 0),
                             tf(t, "base_link", "d555_link", 0.1205, 0.0475, 0.0624, 0)]}
    jpeg = (ROOT / "assets" / "poster.jpg").read_bytes()
    print(f"모의 데이터: 지도 {map_name} ({m['w']} × {m['h']}), 시작 ({sim.x:.2f}, {sim.y:.2f})")
    n, last = 0, time.time()
    while True:
        now = time.time()
        dt, last = now - last, now
        sim.step(dt)
        ox, oy, oyaw = sim.odom_pose()
        mx, my, myaw = Sim.MAP_TO_ODOM
        hub.offer("/tf", "tf2_msgs/msg/TFMessage", {"transforms": [tf(now, "map", "odom", mx, my, 0, myaw),
                                                                   tf(now, "odom", "base_footprint", ox, oy, 0, oyaw)]})
        hub.offer("/odom", "nav_msgs/msg/Odometry", {
            "header": {"stamp": stamp(now), "frame_id": "odom"}, "child_frame_id": "base_footprint",
            "pose": {"pose": {"position": {"x": ox, "y": oy, "z": 0.0}, "orientation": quat(oyaw)}, "covariance": [0.0] * 36},
            "twist": {"twist": {"linear": {"x": sim.v, "y": 0.0, "z": 0.0}, "angular": {"x": 0.0, "y": 0.0, "z": sim.w}}, "covariance": [0.0] * 36}})
        q, g = sim.joints(now)
        hub.offer("/joint_states", "sensor_msgs/msg/JointState", {
            "header": {"stamp": stamp(now), "frame_id": ""},
            "name": ["gripper_left_joint", "joint1", "joint2", "joint3", "joint4", "wheel_left_joint", "wheel_right_joint"],
            "position": [g] + q + [sim.wl, sim.wr], "velocity": [0.0] * 7, "effort": [0.0] * 7})
        if n % 3 == 0:
            hub.offer("/scan", "sensor_msgs/msg/LaserScan", sim.scan(now))
            hub.offer_image("/camera/camera/color/image_raw", "sensor_msgs/msg/Image", None, lambda _r: jpeg)
        if n % 10 == 0:
            hub.offer("/plan", "nav_msgs/msg/Path", sim.plan(now))
        if n % 150 == 0:
            hub.offer("/map", "nav_msgs/msg/OccupancyGrid", grid)
            hub.offer("/tf_static", "tf2_msgs/msg/TFMessage", static)
        n += 1
        time.sleep(max(0.0, 1 / 30 - (time.time() - now)))


def main():
    ap = argparse.ArgumentParser(description="ROS 없이 중계 서버 흉내 (시험용)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    real = ROOT / "data" / "real.yaml"
    ap.add_argument("--map", default=str(real if real.exists() else ROOT / "samples" / "nav2_map" / "map.yaml"),
                    help="Nav2 map.yaml (기본: data/real.yaml, 없으면 samples/nav2_map/map.yaml)")
    args = ap.parse_args()
    m = load_map(Path(args.map))
    hub = Hub(list_graph=lambda: GRAPH)
    threading.Thread(target=run, args=(hub, m, Path(args.map).name), daemon=True).start()
    try:
        serve(hub, ROOT, args.host, args.port)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
