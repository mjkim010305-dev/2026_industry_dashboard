"""캔버스 아트보드(.dc.html)를 샘플 값으로 펼쳐 일반 HTML 미리보기로 만든다(레이아웃 점검용)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "canvas" / "project"
OUT = ROOT / ".shots" / "preview"

KEYS = lambda items: [{"k": k, "n": n, "label": k, "cls": c, "down": "", "up": ""} for k, n, c in items]
SAMPLE = {
    "main": "intro", "toggleLabel": "일시정지", "stateLabel": "상태: 재생 중",
    "list": [{"name": n, "pick": ""} for n in ["data1", "data2", "data3", "data4"]],
    "sig": "disconnected", "connected": False, "disconnected": True, "statusLabel": "연결 안 됨 · map 이미지",
    "btnLabel": "연결", "viewLabel": "map 이미지", "loading": False, "failed": False,
    "moveKeys": KEYS([("i", "전진", "k-i on"), ("j", "왼쪽 회전", ""), ("k", "후진", ""), ("l", "오른쪽 회전", ""), ("space", "정지", "k-space")]),
    "armKeys": KEYS([(k, f"joint{n} {d} 회전", "") for d, ks in [("왼쪽", "1234"), ("오른쪽", "qwer")] for n, k in enumerate(ks, 1)]),
    "gripKeys": KEYS([("o", "그리퍼 열기", ""), ("p", "그리퍼 닫기", "")]),
    "readouts": [{"k": k, "v": v, "cls": "ro"} for k, v in [("joint1", "0°"), ("joint2", "-60°"), ("joint3", "20°"), ("joint4", "40°"), ("gripper", "10.0 mm"), ("v", "0.00 m/s"), ("ω", "0.00 rad/s")]],
    "parts": [{"label": l, "pressed": str(l.startswith("joint2")).lower(), "pick": ""} for l in ["본체", "바퀴 · 구동 모터", "LiDAR", "카메라", "팔 받침", "joint1 · 허리", "joint2 · 어깨", "joint3 · 팔꿈치", "joint4 · 손목", "그리퍼"]],
    "hasSel": True, "noSel": False, "tagShow": False, "explodePressed": "false",
    "detail": {"name": "joint2 · 어깨", "desc": "팔을 앞뒤로 숙이고 세워요.", "spec": [{"k": "모터", "v": "DYNAMIXEL XM430-W350-T"}, {"k": "범위", "v": "−102.6° ~ +90°"}]},
    "zoom": False, "robot": {"tx": "-1.000", "ty": "-0.750", "deg": "0.0", "color": "#FF5500"},
}


def get(path, scope):
    cur = scope
    for p in path.split("."):
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            return ""
    return cur


def render(tpl, scope):
    def sc_for(m):
        lst = get(m.group(1).strip(), scope); var = m.group(2)
        return "".join(render(m.group(3), {**scope, var: it}) for it in (lst or []))
    tpl = re.sub(r'<sc-for list="\{\{\s*([^}]+?)\s*\}\}" as="(\w+)"[^>]*>(.*?)</sc-for>', sc_for, tpl, flags=re.S)
    tpl = re.sub(r'<sc-if value="\{\{\s*([^}]+?)\s*\}\}"[^>]*>(.*?)</sc-if>', lambda m: render(m.group(2), scope) if get(m.group(1), scope) else "", tpl, flags=re.S)
    tpl = re.sub(r'\s(on[A-Z]\w*|ref)="\{\{[^}]*\}\}"', "", tpl)
    return re.sub(r"\{\{\s*([^}]+?)\s*\}\}", lambda m: str(get(m.group(1), scope)), tpl)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in sorted(SRC.glob("*.dc.html")):
        t = f.read_text(encoding="utf-8")
        style = re.search(r"<style>(.*?)</style>", t, re.S).group(1)
        body = re.search(r"</helmet>(.*)</x-dc>", t, re.S).group(1)
        html = render(body, SAMPLE).replace('src="/_blob/1624997dcd29fd0673e02bf5fbeee496"', 'src="../../data/map.jpg"') \
            .replace('src="/_blob/5070642424a65999a686a493839c89b3"', 'src="../../data/qrcode.png"') \
            .replace('src="/_blob/a4b370a6566ed13b9c27b62c0a132a06"', 'src="../../assets/poster.jpg"')
        extra = ""
        if "Robot" in f.name:
            extra = ('<script src="../../assets/three.r128.min.js"></script><script src="../../tools/tb3_viewer.js"></script>'
                     '<script>fetch("../../assets/robot/tb3_meshes.json").then(r=>r.json()).then(d=>{const v=createTB3Viewer(THREE,document.querySelector(".robot-stage canvas"),d,'
                     '{accent:"#FF5500",body:"#3A3F47",arm:"#D9DCE1",tire:"#222428",grip:"#9AA0A8",ground:0x223344,grid:0x2A3442,gridMajor:0x4A5666,arena:false,view:"showcase"});v.select("joint2")})</script>')
        elif "Teleop" in f.name:
            extra = ('<script src="../../assets/three.r128.min.js"></script><script src="../../tools/tb3_viewer.js"></script>'
                     '<script>fetch("../../assets/robot/tb3_meshes.json").then(r=>r.json()).then(d=>{const v=createTB3Viewer(THREE,document.querySelector(".viewer canvas"),d,'
                     '{accent:"#FF5500",body:"#3A3F47",arm:"#D9DCE1",tire:"#222428",grip:"#9AA0A8",ground:0x223344,grid:0x2A3442,gridMajor:0x4A5666});v.press("2");v.press("o")})</script>')
        (OUT / f.name.replace(".dc.html", ".html")).write_text(
            f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{style}</style></head><body>{html}{extra}</body></html>', encoding="utf-8")
    print("ok")


if __name__ == "__main__":
    main()
