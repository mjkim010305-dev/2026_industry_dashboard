"""ros/config.yaml 읽기. 빠진 값은 아래 기본값으로 채운다."""
import copy
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"

DEFAULTS = {
    "ros_domain_id": 0,
    "server": {"host": "127.0.0.1", "port": 8765},
    "topics": {
        "joint_states": "/joint_states", "tf": "/tf", "tf_static": "/tf_static", "odom": "/odom", "cmd_vel": "/cmd_vel",
        "scan": "/scan", "map": "/map", "plan": "/plan", "camera": "/camera/camera/color/image_raw",
    },
    "rates": {"joint_states": 30, "tf": 30, "odom": 20, "cmd_vel": 10, "scan": 10, "plan": 4, "map": 1, "camera": 10},
    "camera_max_width": 640,
    "teleop": {"host": "", "port": 22, "username": "", "key_file": "", "command": ""},
    "predict": {"linear_step": 0.01, "linear_max": 0.26, "angular_step": 0.1, "angular_max": 1.8,
                "linear_accel": 1.0, "angular_accel": 4.0, "arm_step": 0.05,
                "gripper_open": 0.019, "gripper_close": -0.010, "fresh_sec": 0.5, "lost_sec": 3.0},
}


def _merge(base, over):
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load(path=None):
    import yaml   # ROS 2 에 들어 있다(python3-yaml). ROS 없는 PC 는 pip install pyyaml
    p = Path(path) if path else CONFIG_PATH
    data = yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else {}
    cfg = _merge(copy.deepcopy(DEFAULTS), data)
    cfg["_path"] = str(p)
    return cfg


def public(cfg, mock=False):
    """화면에 주는 값(비밀은 없다)."""
    t = cfg["teleop"]
    return {"topics": cfg["topics"], "predict": cfg["predict"], "mock": mock, "ros_domain_id": cfg["ros_domain_id"],
            "teleop": {"host": t["host"], "port": t["port"], "username": t["username"], "command": t["command"]}}
