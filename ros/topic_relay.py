#!/usr/bin/env python3
"""ROS 2 토픽을 구독해서 브라우저로 넘기는 중계 노드 (구독 전용, 발행하지 않는다).

실행 (ROS 2 Humble 이 있는 WSL/리눅스, 로봇과 같은 ROS_DOMAIN_ID):
    source /opt/ros/humble/setup.bash
    export ROS_DOMAIN_ID=30
    python3 ros/topic_relay.py                 # http://localhost:8765/redesign/live.html
    python3 ros/topic_relay.py --host 0.0.0.0  # 다른 PC 브라우저에서도 보려면

토픽은 브라우저가 요청할 때 처음 구독한다(타입은 ROS 그래프에서 찾는다). 카메라(sensor_msgs/Image)는
보는 화면이 있을 때만 JPEG 으로 줄여 보내고, CompressedImage(jpeg)는 그대로 넘긴다.
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
from relay_http import Hub, serve  # noqa: E402

IMAGE_TYPES = ("sensor_msgs/msg/Image", "sensor_msgs/msg/CompressedImage")
MAX_IMAGE_WIDTH = 640


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
    ap = argparse.ArgumentParser(description="ROS 2 토픽 → 브라우저 중계 (구독 전용)")
    ap.add_argument("--host", default="127.0.0.1", help="기본 127.0.0.1 (이 PC 에서만 접속)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="정적 파일 폴더(프로젝트 루트)")
    ap.add_argument("--topics", default="", help="처음부터 구독할 토픽(쉼표로 구분). 비우면 브라우저가 요청할 때 구독")
    args = ap.parse_args()

    rclpy.init()
    holder = {}
    hub = Hub(ensure=lambda t: holder["node"].ensure(t), list_graph=lambda: holder["node"].graph())
    node = holder["node"] = Relay(hub)
    for t in filter(None, args.topics.split(",")):
        node.ensure(t)
    ex = MultiThreadedExecutor()
    ex.add_node(node)
    threading.Thread(target=ex.spin, daemon=True).start()
    try:
        serve(hub, args.root, args.host, args.port)
    except KeyboardInterrupt:
        pass
    finally:
        ex.shutdown()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
