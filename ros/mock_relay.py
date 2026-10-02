#!/usr/bin/env python3
"""ROS 없이 실시간 조종 서버를 흉내 낸다 (화면 개발·시험용).

    uv run --no-project --with pyyaml python ros/mock_relay.py     # http://localhost:8765/redesign/live.html

topic_relay.py 와 같은 HTTP API · 같은 config.yaml(토픽 이름·주기)로, 실제 로봇과 같은 모양의 raw 메시지를 보낸다.
  map           data/real.yaml + real.pgm 을 map_server 규칙으로 바꾼 것
  tf, tf_static map→odom(조금 어긋나게) → base_footprint → base_link → base_scan, d555_link
  odom, joint_states, cmd_vel, scan(지도 벽에 광선), plan(흉내), camera(assets/poster.jpg)
조종: 화면에서 '연결'하면 ssh 대신 가짜 teleop 이 붙는다. 키는 실제 turtlebot3_manipulation_teleop 규칙대로 기체를 움직인다
      (i/k ±0.01 m/s, j/l ±0.1 rad/s, space 정지, 1~4/q~r 관절 한 칸, o/p 그리퍼). 연결 전에는 기체가 혼자 돌아다닌다(--no-wander 로 끔).
나쁜 네트워크 흉내: POST /api/mock/network {"drop": 0~1, "freeze": true|false}  (메시지를 버리거나 아예 멈춘다)
"""
import argparse
import math
import random
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings  # noqa: E402
from relay_http import Hub, serve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIMITS = [(-math.pi * 175 / 180, math.pi * 175 / 180), (-math.pi * 0.57, math.pi * 0.5),
          (-math.pi * 0.3, math.pi * 0.44), (-math.pi * 0.57, math.pi * 0.65)]
ARM_TRUE_STEP = 0.06     # 모의 기체의 '실제' 한 칸(rad). 화면 추정 처음 값(config arm_step)과 일부러 다르게 둬 자동 보정을 시험한다


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

    def __init__(self, m, pred, wander):
        self.m, self.pred, self.wander = m, pred, wander
        self.x, self.y, self.yaw = self.start()
        self.v = self.w = 0.0              # 실제 속도(가속 제한을 거친 값)
        self.cmd = [0.0, 0.0]              # teleop 이 내는 /cmd_vel
        self.manual = False                # teleop 이 붙으면 True
        self.turn = 0
        self.wl = self.wr = 0.0
        self.q = [0.0, -1.05, 0.35, 0.70]
        self.grip, self.grip_target = 0.01, 0.01
        self.lock = threading.Lock()

    def occ(self, x, y):
        m = self.m
        c, r = int((x - m["origin"][0]) / m["res"]), int((y - m["origin"][1]) / m["res"])
        if c < 0 or r < 0 or c >= m["w"] or r >= m["h"]:
            return True
        return m["data"][r * m["w"] + c] != 0       # 막힘과 모름은 못 지나간다

    def occ_wall(self, x, y):
        m = self.m
        c, r = int((x - m["origin"][0]) / m["res"]), int((y - m["origin"][1]) / m["res"])
        if c < 0 or r < 0 or c >= m["w"] or r >= m["h"]:
            return True
        return m["data"][r * m["w"] + c] == 100

    def free_circle(self, x, y, rad=0.2):
        return not self.occ(x, y) and all(not self.occ(x + rad * math.cos(a), y + rad * math.sin(a))
                                          for a in [k * math.pi / 6 for k in range(12)])

    def start(self):
        for d in [i * 0.05 for i in range(60)]:
            for k in range(16):
                a = k * math.pi / 8
                x, y = d * math.cos(a), d * math.sin(a)
                if self.free_circle(x, y, 0.25):
                    return x, y, 0.0
        raise SystemExit("지도에서 빈 자리를 못 찾았어요")

    def key(self, k):
        """turtlebot3_manipulation_teleop 과 같은 규칙."""
        p = self.pred
        with self.lock:
            if k == "i":
                self.cmd[0] = min(self.cmd[0] + p["linear_step"], p["linear_max"])
            elif k == "k":
                self.cmd[0] = max(self.cmd[0] - p["linear_step"], -p["linear_max"])
            elif k == "j":
                self.cmd[1] = min(self.cmd[1] + p["angular_step"], p["angular_max"])
            elif k == "l":
                self.cmd[1] = max(self.cmd[1] - p["angular_step"], -p["angular_max"])
            elif k == " ":
                self.cmd = [0.0, 0.0]
            elif k in "1234":
                self._jog(int(k) - 1, 1)
            elif k in "qwer":
                self._jog("qwer".index(k), -1)
            elif k == "o":
                self.grip_target = 0.019
            elif k == "p":
                self.grip_target = -0.010

    def _jog(self, n, d):
        lo, hi = LIMITS[n]
        self.q[n] = max(lo, min(hi, self.q[n] + d * ARM_TRUE_STEP))

    def step(self, dt):
        with self.lock:
            if self.manual:
                tv, tw = self.cmd
            elif self.wander:
                ahead = self.free_circle(self.x + 0.3 * math.cos(self.yaw), self.y + 0.3 * math.sin(self.yaw))
                if self.turn == 0 and not ahead:
                    left = self.free_circle(self.x + 0.3 * math.cos(self.yaw + 0.8), self.y + 0.3 * math.sin(self.yaw + 0.8))
                    self.turn = 1 if left else -1
                if self.turn and ahead and random.random() < 0.08:
                    self.turn = 0
                tv = 0.0 if self.turn else 0.15
                tw = 0.9 * self.turn if self.turn else 0.15 * math.sin(time.time() * 0.4)
            else:
                tv = tw = 0.0
            la, aa = self.pred["linear_accel"], self.pred["angular_accel"]   # 가속 제한(diff_drive_controller 값)
            self.v += max(-la * dt, min(la * dt, tv - self.v))
            self.w += max(-aa * dt, min(aa * dt, tw - self.w))
            nx, ny = self.x + self.v * math.cos(self.yaw) * dt, self.y + self.v * math.sin(self.yaw) * dt
            if self.free_circle(nx, ny):
                self.x, self.y = nx, ny
            else:
                self.v = 0.0                                                # 벽에 막힘
            self.yaw = math.atan2(math.sin(self.yaw + self.w * dt), math.cos(self.yaw + self.w * dt))
            self.wl += (self.v - self.w * 0.1435) / 0.033 * dt
            self.wr += (self.v + self.w * 0.1435) / 0.033 * dt
            self.grip += max(-0.03 * dt, min(0.03 * dt, self.grip_target - self.grip))

    def odom_pose(self):
        mx, my, myaw = self.MAP_TO_ODOM
        dx, dy = self.x - mx, self.y - my
        c, s = math.cos(-myaw), math.sin(-myaw)
        return dx * c - dy * s, dx * s + dy * c, self.yaw - myaw

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


class MockTeleop:
    """ssh 대신 모의 기체에 키를 넣는다. 상태 이벤트는 실제 Teleop(teleop_ssh.py) 과 같다."""

    def __init__(self, sim, on_change):
        self.sim, self.on_change = sim, on_change
        self.state = {"state": "disconnected", "reason": None, "label": None, "dropped": False}

    def _set(self, st):
        self.state = {"state": st, "reason": None, "label": None, "dropped": False}
        self.on_change(dict(self.state))

    def connect(self, host, port, username, password, command, key_file=""):
        if self.state["state"] != "disconnected":
            return 409, {"ok": False, "error": "already_connecting_or_connected"}
        self._set("connecting")
        time.sleep(0.4)
        with self.sim.lock:
            self.sim.manual, self.sim.cmd = True, [0.0, 0.0]
        self._set("connected")
        return 200, {"ok": True, "state": "connected"}

    def send(self, key):
        if self.state["state"] != "connected":
            return 409, {"ok": False, "error": "not_connected"}
        if len(key) != 1:
            return 400, {"ok": False, "error": "invalid_field:key"}
        self.sim.key(key)
        return 200, {"ok": True}

    def stop_motion(self):
        self.sim.key(" ")

    def disconnect(self):
        self.sim.key(" ")
        with self.sim.lock:
            self.sim.manual = False
        if self.state["state"] != "disconnected":
            self._set("disconnected")
        return 200, {"ok": True, "state": "disconnected"}


def graph(T):
    return [(T["map"], "nav_msgs/msg/OccupancyGrid"), (T["tf"], "tf2_msgs/msg/TFMessage"), (T["tf_static"], "tf2_msgs/msg/TFMessage"),
            (T["odom"], "nav_msgs/msg/Odometry"), (T["joint_states"], "sensor_msgs/msg/JointState"),
            (T["cmd_vel"], "geometry_msgs/msg/Twist"), (T["scan"], "sensor_msgs/msg/LaserScan"),
            (T["plan"], "nav_msgs/msg/Path"), (T["camera"], "sensor_msgs/msg/Image")]


def run(hub, sim, m, map_name, T):
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
    print(f"모의 데이터: 지도 {map_name} ({m['w']} × {m['h']}), 시작 ({sim.x:.2f}, {sim.y:.2f})", flush=True)
    n, last = 0, time.time()
    while True:
        now = time.time()
        dt, last = now - last, now
        sim.step(dt)
        ox, oy, oyaw = sim.odom_pose()
        mx, my, myaw = Sim.MAP_TO_ODOM
        hub.offer(T["tf"], "tf2_msgs/msg/TFMessage", {"transforms": [tf(now, "map", "odom", mx, my, 0, myaw),
                                                                     tf(now, "odom", "base_footprint", ox, oy, 0, oyaw)]})
        hub.offer(T["odom"], "nav_msgs/msg/Odometry", {
            "header": {"stamp": stamp(now), "frame_id": "odom"}, "child_frame_id": "base_footprint",
            "pose": {"pose": {"position": {"x": ox, "y": oy, "z": 0.0}, "orientation": quat(oyaw)}, "covariance": [0.0] * 36},
            "twist": {"twist": {"linear": {"x": sim.v, "y": 0.0, "z": 0.0}, "angular": {"x": 0.0, "y": 0.0, "z": sim.w}},
                      "covariance": [0.0] * 36}})
        hub.offer(T["cmd_vel"], "geometry_msgs/msg/Twist", {"linear": {"x": sim.cmd[0], "y": 0.0, "z": 0.0},
                                                             "angular": {"x": 0.0, "y": 0.0, "z": sim.cmd[1]}})
        hub.offer(T["joint_states"], "sensor_msgs/msg/JointState", {
            "header": {"stamp": stamp(now), "frame_id": ""},
            "name": ["gripper_left_joint", "joint1", "joint2", "joint3", "joint4", "wheel_left_joint", "wheel_right_joint"],
            "position": [sim.grip] + list(sim.q) + [sim.wl, sim.wr], "velocity": [0.0] * 7, "effort": [0.0] * 7})
        if n % 3 == 0:
            hub.offer(T["scan"], "sensor_msgs/msg/LaserScan", sim.scan(now))
            hub.offer_image(T["camera"], "sensor_msgs/msg/Image", None, lambda _r: jpeg)
        if n % 10 == 0:
            hub.offer(T["plan"], "nav_msgs/msg/Path", sim.plan(now))
        if n % 150 == 0:
            hub.offer(T["map"], "nav_msgs/msg/OccupancyGrid", grid)
            hub.offer(T["tf_static"], "tf2_msgs/msg/TFMessage", static)
        n += 1
        time.sleep(max(0.0, 1 / 30 - (time.time() - now)))


def main():
    ap = argparse.ArgumentParser(description="ROS 없이 실시간 조종 서버 흉내 (시험용)")
    ap.add_argument("--config", default=str(settings.CONFIG_PATH))
    ap.add_argument("--host")
    ap.add_argument("--port", type=int)
    real = ROOT / "data" / "real.yaml"
    ap.add_argument("--map", default=str(real if real.exists() else ROOT / "samples" / "nav2_map" / "map.yaml"),
                    help="Nav2 map.yaml (기본: data/real.yaml, 없으면 samples/nav2_map/map.yaml)")
    ap.add_argument("--no-wander", action="store_true", help="조종 전에 기체가 혼자 돌아다니지 않게")
    args = ap.parse_args()
    cfg = settings.load(args.config)
    m = load_map(Path(args.map))
    T = cfg["topics"]
    hub = Hub(cfg, list_graph=lambda: graph(T), mock=True)
    sim = Sim(m, cfg["predict"], not args.no_wander)
    hub.teleop = MockTeleop(sim, hub.set_teleop_state)

    def network(body):
        hub.net["drop"] = max(0.0, min(1.0, float(body.get("drop", hub.net["drop"]))))
        hub.net["freeze"] = bool(body.get("freeze", hub.net["freeze"]))
        return 200, {"ok": True, **hub.net}
    hub.routes["/api/mock/network"] = network
    threading.Thread(target=run, args=(hub, sim, m, Path(args.map).name, T), daemon=True).start()
    try:
        serve(hub, ROOT, args.host or cfg["server"]["host"], args.port or int(cfg["server"]["port"]))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
