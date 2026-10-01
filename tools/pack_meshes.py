"""turtlebot3_manipulation 공식 STL(assets/robot/*.stl)을 가벼운 JSON 하나로 묶는다.

- 꼭짓점 군집화(격자 크기 GRID mm)로 삼각형 수를 줄인다. 모양은 유지, 잔 곡면만 줄어든다.
- 좌표는 mm 단위 정수(Int16, 0.1 mm 정밀도)로, 인덱스는 Uint32 로 base64 인코딩한다.
출처: https://github.com/ROBOTIS-GIT/turtlebot3_manipulation (Apache-2.0)
"""
import base64
import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "robot"
OUT = ROOT / "assets" / "robot" / "tb3_meshes.json"
PARTS = {  # 이름: 격자 크기(mm)
    "base": 3.0, "ladar": 1.2, "left_tire": 1.5, "right_tire": 1.5,
    "link1": 1.0, "link2": 1.0, "link3": 1.0, "link4": 1.0, "link5": 1.0,
    "gripper_left_palm": 0.8, "gripper_right_palm": 0.8,
}


def read_stl(path):
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    if 84 + n * 50 == len(data):
        rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]), count=n, offset=84)
        return rec["v"].reshape(-1, 3).astype(np.float64)
    pts = [list(map(float, l.split()[1:4])) for l in data.decode("ascii", "ignore").splitlines() if l.strip().startswith("vertex")]
    return np.array(pts, dtype=np.float64)


def decimate(tri_pts, grid):
    q = np.round(tri_pts / grid).astype(np.int64)
    uniq, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    sums = np.zeros((len(uniq), 3)); cnt = np.zeros(len(uniq))
    np.add.at(sums, inv, tri_pts); np.add.at(cnt, inv, 1)
    verts = sums / cnt[:, None]
    tris = inv.reshape(-1, 3)
    ok = (tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])
    tris = np.unique(np.sort(tris[ok], axis=1), axis=0, return_index=True)[1]
    tris = inv.reshape(-1, 3)[ok][np.sort(tris)]
    used = np.unique(tris)
    remap = -np.ones(len(verts), dtype=np.int64); remap[used] = np.arange(len(used))
    return verts[used], remap[tris]


def main():
    out = {"source": "ROBOTIS-GIT/turtlebot3_manipulation (Apache-2.0)", "unit": "0.1mm", "parts": {}}
    for name, grid in PARTS.items():
        pts = read_stl(SRC / f"{name}.stl")
        verts, tris = decimate(pts, grid)
        v = np.round(verts * 10).astype(np.int32)
        assert np.abs(v).max() < 32767, name
        out["parts"][name] = {
            "v": base64.b64encode(v.astype("<i2").tobytes()).decode(),
            "i": base64.b64encode(tris.astype("<u4").tobytes()).decode(),
        }
        print(f"{name}: {len(pts)//3} -> {len(tris)} tris, {len(verts)} verts")
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
