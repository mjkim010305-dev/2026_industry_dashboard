"""teleop HTML 에 3D 기체 카드(ㄱ자 경기장 + 미니맵 + 관절 값)를 붙인다.

기존 기능 스크립트는 그대로 두고, 표시(<!-- 3d:... -->) 사이에 마크업 · 스타일 · 스크립트를 따로 넣는다.
같은 파일에 다시 돌려도 표시 사이를 지우고 새로 넣으므로 중복되지 않는다.
사용: uv run --no-project python tools/inject_3d.py   (redesign/teleop.html 을 제자리에서 갱신)
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

STYLE = """<!-- 3d:style -->
<style>
/* ---------- 3D 기체 카드 ---------- */
@media (min-width: 1100px) {
  .layout .viewer3d-card { grid-column: 1; grid-row: 2; }
  .layout section[aria-labelledby="t-view"] { grid-column: 1; grid-row: 3; }
  .layout section[aria-labelledby="t-kbd"] { grid-column: 2; grid-row: 2 / span 2; }
}
.viewer3d { position: relative; width: 100%; aspect-ratio: 16 / 10; border-radius: 12px; overflow: hidden; background: #0E131A; cursor: grab; }
.viewer3d canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.viewer3d .v-hint {
  position: absolute; left: 12px; top: 12px; padding: 6px 12px; border-radius: 999px; background: rgba(0, 0, 0, 0.55);
  color: #E8ECF1; font-size: 13px; pointer-events: none;
}
.viewer3d .v-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #E8ECF1; font-size: 14px; }
.viewer3d .v-mini {
  position: absolute; right: 12px; bottom: 12px; width: 24%; aspect-ratio: 1 / 1; border-radius: 10px; overflow: hidden;
  background: #0B0F14; border: 2px solid rgba(255, 255, 255, 0.85); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.viewer3d .v-mini svg { display: block; width: 100%; height: 100%; }
.viewer3d .v-mini span {
  position: absolute; left: 6px; top: 6px; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.6);
  color: #FFFFFF; font-size: 11px; font-weight: 700;
}
.v-readout { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.v-readout span {
  display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 10px; border-radius: 8px;
  background: var(--surface-2, #F7F8FA); border: 1px solid var(--line, #DEE1E5); font-size: 13px;
  font-family: ui-monospace, Consolas, monospace; color: inherit;
}
.v-readout b { font-family: inherit; font-size: 12px; font-weight: 600; opacity: 0.75; }
.v-readout span.on { outline: 2px solid %ACCENT%; outline-offset: -1px; }
</style>
<!-- 3d:style-end -->
"""

MARKUP = """<!-- 3d:markup -->
    <section class="card viewer3d-card" aria-labelledby="t-3d">
      <div class="card-head">
        <h2 id="t-3d">기체 3D</h2>
        <span class="chip">시뮬레이션 · turtlebot3 waffle pi + OpenMANIPULATOR-X</span>
      </div>
      <div class="viewer3d" id="viewer3d">
        <canvas id="tb3Canvas" aria-hidden="true"></canvas>
        <span class="v-hint">키보드로 조종하면 함께 움직여요 · 끌어서 회전 · 휠로 확대</span>
        <div class="v-msg" id="tb3Msg">3D 기체를 불러오는 중</div>
        <div class="v-mini">
          <svg viewBox="-1.7 -1.7 3.4 3.4" role="img" aria-label="경기장 3 m × 3 m 안의 기체 위치">
            <path d="M-1.5 0 L-1.5 -1.5 L1.5 -1.5 L1.5 1.5 L0 1.5 L0 0 Z" fill="#1A222C" stroke="#C9CED6" stroke-width="0.04"></path>
            <path d="M-1 -1.5 V0 M-0.5 -1.5 V0 M0 -1.5 V1.5 M0.5 -1.5 V1.5 M1 -1.5 V1.5 M-1.5 -1 H1.5 M-1.5 -0.5 H1.5 M0 0.5 H1.5 M0 1 H1.5" stroke="#2A3442" stroke-width="0.015" fill="none"></path>
            <g id="tb3Dot" transform="translate(-1 -0.75)"><circle r="0.14" fill="%ACCENT%" stroke="#FFFFFF" stroke-width="0.04"></circle><path d="M0.1 -0.08 L0.26 0 L0.1 0.08 Z" fill="#FFFFFF"></path></g>
          </svg>
          <span>경기장 3 m × 3 m</span>
        </div>
      </div>
      <div class="v-readout" id="tb3Readout" aria-live="off"></div>
    </section>
<!-- 3d:markup-end -->
"""

SCRIPT = """<!-- 3d:script -->
<script src="../assets/three.r128.min.js"></script>
<script src="../assets/tb3_viewer.js"></script>
<script src="../assets/robot/tb3_meshes.js"></script>
<script>
// 3D 기체: 위 기능 스크립트와 별도로 같은 키 입력을 받아 시뮬레이션만 움직인다(bridge 로 보내지 않는다).
(function () {
  var canvas = document.getElementById("tb3Canvas"), msg = document.getElementById("tb3Msg");
  if (!window.THREE || !window.TB3_MESHES || !window.createTB3Viewer) { msg.textContent = "3D 기체를 불러오지 못했습니다"; return; }
  var viewer = createTB3Viewer(THREE, canvas, TB3_MESHES, {
    accent: "%ACCENT%", body: "#3A3F47", arm: "#D9DCE1", tire: "#222428", grip: "#9AA0A8",
    ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666
  });
  msg.hidden = true;
  var KEYS = ["i", "j", "k", "l", " ", "1", "2", "3", "4", "q", "w", "e", "r", "o", "p"];
  function isField(t) { return !!t && t.tagName === "INPUT"; }
  document.addEventListener("keydown", function (e) {
    if (isField(e.target) || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS.indexOf(k) >= 0) viewer.press(k);
  });
  document.addEventListener("keyup", function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS.indexOf(k) >= 0) viewer.release(k);
  });
  window.addEventListener("blur", function () { KEYS.forEach(function (k) { viewer.release(k); }); });

  var out = document.getElementById("tb3Readout"), dot = document.getElementById("tb3Dot");
  var ITEMS = [["joint1", ["1", "q"]], ["joint2", ["2", "w"]], ["joint3", ["3", "e"]], ["joint4", ["4", "r"]],
               ["gripper", ["o", "p"]], ["v", ["i", "k", " "]], ["ω", ["j", "l", " "]], ["위치", []]];
  var cells = ITEMS.map(function (it) {
    var s = document.createElement("span"), b = document.createElement("b"), v = document.createElement("i");
    v.style.fontStyle = "normal"; b.textContent = it[0]; s.append(b, v); out.appendChild(s);
    return { el: s, val: v, keys: it[1] };
  });
  function deg(r) { return (r * 180 / Math.PI).toFixed(0) + "°"; }
  setInterval(function () {
    var r = viewer.readout();
    var vals = [deg(r.joints[0]), deg(r.joints[1]), deg(r.joints[2]), deg(r.joints[3]),
                (r.grip * 1000).toFixed(1) + " mm", r.v.toFixed(2) + " m/s", r.w.toFixed(2) + " rad/s",
                "(" + r.x.toFixed(2) + ", " + r.y.toFixed(2) + ") m"];
    cells.forEach(function (c, n) {
      c.val.textContent = vals[n];
      c.el.classList.toggle("on", c.keys.some(function (k) { return r.held.indexOf(k) >= 0; }));
    });
    dot.setAttribute("transform", "translate(" + r.x.toFixed(3) + " " + (-r.y).toFixed(3) + ") rotate(" + (-r.yaw * 180 / Math.PI).toFixed(1) + ")");
  }, 120);
})();
</script>
<!-- 3d:script-end -->
"""


def strip_3d(html):
    for name in ("style", "markup", "script"):
        html = re.sub(rf"<!-- 3d:{name} -->.*?<!-- 3d:{name}-end -->\n?", "", html, flags=re.S)
    return html


def inject_3d(html, accent):
    html = strip_3d(html)
    html = html.replace("</head>", STYLE.replace("%ACCENT%", accent) + "</head>", 1)
    anchor = '    <section class="card" aria-labelledby="t-view">'
    assert anchor in html, "teleop 마크업에서 조종 화면 카드를 찾지 못했다"
    html = html.replace(anchor, MARKUP.replace("%ACCENT%", accent) + anchor, 1)
    i = html.rindex("</body>")
    return html[:i] + SCRIPT.replace("%ACCENT%", accent) + html[i:]


if __name__ == "__main__":
    p = ROOT / "redesign" / "teleop.html"
    p.write_text(inject_3d(p.read_text(encoding="utf-8"), "#0071E3"), encoding="utf-8")
    print("redesign/teleop.html 갱신")
