#!/usr/bin/env python3
"""실시간 조종 서버: ROS 2 토픽 구독(화면 표시) + ssh teleop(실제 조종).

실행 (ROS 2 Humble 이 있는 WSL/리눅스):
    source /opt/ros/humble/setup.bash
    python3 ros/topic_relay.py                  # http://localhost:8765/redesign/live.html
    python3 ros/topic_relay.py --config 다른설정.yaml

도메인·토픽 이름·주기·teleop 접속 기본값은 ros/config.yaml 에서 바꾼다(화면에서는 못 바꾼다).
ROS 토픽은 구독만 한다(발행 없음). 조종은 ssh 로 로봇 터미널의 teleop 에 키 글자를 넣는 방식이다(teleop_ssh.py).
카메라(sensor_msgs/Image)는 보는 화면이 있을 때만 JPEG 으로 줄여 보내고, CompressedImage(jpeg)는 그대로 넘긴다.
HTTP 쪽 동작은 relay_http.py 에 있다.
"""
import argparse
import array
import sys
import threading
from pathlib import Path

import rclpy
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from rosidl_runtime_py.utilities import get_message

sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings  # noqa: E402
from relay_http import Hub, serve  # noqa: E402
from teleop_ssh import Teleop  # noqa: E402

IMAGE_TYPES = ("sensor_msgs/msg/Image", "sensor_msgs/msg/CompressedImage")
MAX_IMAGE_WIDTH = 640      # config.yaml camera_max_width 로 바뀐다


def to_dict(v):
    """ROS 메시지 → dict. 필드 이름과 값은 그대로 둔다(ros2 topic echo 와 같은 구조)."""
    if hasattr(v, "get_fields_and_field_types"):
        return {f: to_dict(getattr(v, f)) for f in v.get_fields_and_field_types()}
    if isinstance(v, array.array):
        return v.tolist()
    if isinstance(v, (bytes, bytearray)):
        return list(v)
    if hasattr(v, "tolist"):                       # numpy 배열
        return v.tolist()
    if isinstance(v, (list, tuple)):
        return [to_dict(x) for x in v]
    return v


def encode_image(msg):
    """sensor_msgs/Image 또는 CompressedImage → JPEG bytes."""
    if hasattr(msg, "format"):                     # CompressedImage
        return bytes(msg.data) if "jpeg" in msg.format or "jpg" in msg.format else None
    import numpy as np
    import cv2
    h, w, enc, step = msg.height, msg.width, msg.encoding, msg.step
    buf = np.frombuffer(bytes(msg.data), dtype=np.uint8)
    if enc in ("rgb8", "bgr8"):
        img = buf.reshape(h, step)[:, :w * 3].reshape(h, w, 3)
        if enc == "rgb8":
            img = img[:, :, ::-1]
    elif enc in ("rgba8", "bgra8"):
        img = buf.reshape(h, step)[:, :w * 4].reshape(h, w, 4)[:, :, :3]
        if enc == "rgba8":
            img = img[:, :, ::-1]
    elif enc == "mono8":
        img = buf.reshape(h, step)[:, :w]
    elif enc in ("16UC1", "mono16", "32FC1"):     # 깊이 영상: 보이는 범위로 펴서 회색조로
        dt = np.float32 if enc == "32FC1" else np.uint16
        d = np.frombuffer(bytes(msg.data), dtype=dt).reshape(h, step // np.dtype(dt).itemsize)[:, :w].astype(np.float32)
        valid = d[np.isfinite(d) & (d > 0)]
        hi = float(np.percentile(valid, 98)) if valid.size else 1.0
        img = cv2.applyColorMap(np.clip(d / max(hi, 1e-6) * 255, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    else:
        return None
    if img.shape[1] > MAX_IMAGE_WIDTH:
        s = MAX_IMAGE_WIDTH / img.shape[1]
        img = cv2.resize(img, (MAX_IMAGE_WIDTH, int(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", np.ascontiguousarray(img), [cv2.IMWRITE_JPEG_QUALITY, 70])
    return jpg.tobytes() if ok else None


class Relay(Node):
    def __init__(self, hub):
        super().__init__("web_topic_relay")
        self.hub = hub
        self.subs = {}
        self.wanted = set()
        self.lock = threading.Lock()
        self.create_timer(1.0, self._try_subscribe)

    def graph(self):
        return [(n, ts[0]) for n, ts in self.get_topic_names_and_types() if ts]

    def ensure(self, topic):
        with self.lock:
            if topic and topic not in self.subs:
                self.wanted.add(topic)

    def _qos(self, topic):
        """발행하는 쪽 QoS 에 맞춘다: 지도·TF static 처럼 latched 면 TRANSIENT_LOCAL + RELIABLE, 아니면 BEST_EFFORT."""
        infos = self.get_publishers_info_by_topic(topic)
        latched = any(i.qos_profile.durability == DurabilityPolicy.TRANSIENT_LOCAL for i in infos)
        if latched:
            return QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=10,
                              reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        return QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=5,
                          reliability=ReliabilityPolicy.BEST_EFFORT, durability=DurabilityPolicy.VOLATILE)

    def _try_subscribe(self):
        with self.lock:
            wanted = list(self.wanted)
        if not wanted:
            return
        types = dict(self.graph())
        for topic in wanted:
            type_name = types.get(topic)
            if not type_name:
                continue                           # 아직 그래프에 없다. 1초 뒤 다시 본다
            try:
                cls = get_message(type_name)
            except Exception as e:
                self.get_logger().warning(f"{topic}: 타입 {type_name} 을(를) 불러오지 못함 ({e})")
                with self.lock:
                    self.wanted.discard(topic)
                continue
            if type_name in IMAGE_TYPES:
                cb = (lambda m, t=topic, ty=type_name: self.hub.offer_image(t, ty, m, encode_image))
            else:
                cb = (lambda m, t=topic, ty=type_name: self.hub.offer(t, ty, m, to_dict))
            sub = self.create_subscription(cls, topic, cb, self._qos(topic))
            with self.lock:
                self.subs[topic] = sub
                self.wanted.discard(topic)
            self.get_logger().info(f"구독 시작: {topic} [{type_name}]")


def main():
    global MAX_IMAGE_WIDTH
    ap = argparse.ArgumentParser(description="실시간 조종 서버 (ROS 2 토픽 구독 + ssh teleop)")
    ap.add_argument("--config", default=str(settings.CONFIG_PATH), help="설정 파일 (기본 ros/config.yaml)")
    ap.add_argument("--host", help="config 의 server.host 대신")
    ap.add_argument("--port", type=int, help="config 의 server.port 대신")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="정적 파일 폴더(프로젝트 루트)")
    args = ap.parse_args()
    cfg = settings.load(args.config)
    MAX_IMAGE_WIDTH = int(cfg["camera_max_width"])

    rclpy.init(domain_id=int(cfg["ros_domain_id"]))
    holder = {}
    hub = Hub(cfg, ensure=lambda t: holder["node"].ensure(t), list_graph=lambda: holder["node"].graph())
    hub.teleop = Teleop(hub.set_teleop_state)
    node = holder["node"] = Relay(hub)
    for role, topic in cfg["topics"].items():     # 카메라만 빼고 처음부터 구독(카메라는 화면이 켤 때)
        if role != "camera" and topic:
            node.ensure(topic)
    ex = MultiThreadedExecutor()
    ex.add_node(node)
    threading.Thread(target=ex.spin, daemon=True).start()
    print(f"ROS_DOMAIN_ID={cfg['ros_domain_id']}", flush=True)
    try:
        serve(hub, args.root, args.host or cfg["server"]["host"], args.port or int(cfg["server"]["port"]))
    except KeyboardInterrupt:
        pass
    finally:
        hub.teleop.disconnect()
        ex.shutdown()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
