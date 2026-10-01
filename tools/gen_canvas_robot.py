"""캔버스용 '기체 소개' 아트보드 템플릿. 정적 부분과 부품 데이터는 tools/pages/robot.* 에서 가져온다(gen_canvas.py 가 쓴다)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MARKUP = """<div class="dc-root">
%HEADER%
<div class="page">
<main>
%HEAD%
<div class="robot-layout">
<section class="card" aria-labelledby="t-robot3d">
<div class="card-head">
<h2 id="t-robot3d">3D 기체</h2>
<div class="robot-tools" role="group" aria-label="3D 보기 도구">
<button type="button" class="btn" aria-pressed="{{explodePressed}}" onClick="{{toggleExplode}}">분해 보기</button>
<button type="button" class="btn" onClick="{{home}}">기본 자세</button>
<button type="button" class="btn" onClick="{{reach}}">앞으로 뻗기</button>
</div>
</div>
<div class="robot-stage" tabindex="0" aria-label="3D 기체. 부품을 누르면 설명, 누른 뒤 키보드로 관절 조종" onKeyDown="{{onKeyDown}}" onKeyUp="{{onKeyUp}}" onBlur="{{onBlur}}">
<canvas ref="{{setCanvas}}" aria-hidden="true"></canvas>
<span class="v-hint">부품을 누르면 설명 · 끌어서 회전 · 휠로 확대 · 누른 뒤 키보드로 관절 조종</span>
<sc-if value="{{tagShow}}" hint-placeholder-val="{{ false }}"><span class="part-tag" style="left: {{tagX}}px; top: {{tagY}}px;">{{detail.name}}</span></sc-if>
<sc-if value="{{loading}}" hint-placeholder-val="{{ true }}"><div class="v-msg">3D 기체를 불러오는 중</div></sc-if>
<sc-if value="{{failed}}" hint-placeholder-val="{{ false }}"><div class="v-msg">3D 기체를 불러오지 못했습니다</div></sc-if>
</div>
</section>
<aside class="card part-panel" aria-labelledby="t-parts">
<div class="card-head"><h2 id="t-parts">부품</h2></div>
<ul class="part-list"><sc-for list="{{parts}}" as="p" hint-placeholder-count="10"><li><button type="button" aria-pressed="{{p.pressed}}" onClick="{{p.pick}}">{{p.label}}</button></li></sc-for></ul>
<div class="part-detail" aria-live="polite">
<sc-if value="{{hasSel}}" hint-placeholder-val="{{ false }}"><h3>{{detail.name}}</h3><p>{{detail.desc}}</p><dl><sc-for list="{{detail.spec}}" as="sp" hint-placeholder-count="3"><dt>{{sp.k}}</dt><dd>{{sp.v}}</dd></sc-for></dl></sc-if>
<sc-if value="{{noSel}}" hint-placeholder-val="{{ true }}"><h3>부품을 골라 보세요</h3><p>목록이나 3D 화면에서 부품을 누르면 역할과 사양이 여기에 나타나요.</p></sc-if>
</div>
</aside>
</div>
%STATIC%
</main>
</div>
</div>"""

SCRIPT = """class Component extends DCLogic {
  componentDidMount() {
    this._alive = true;
    const start = () => {
      if (!this._alive) return;
      if (!window.THREE || !this._canvas) { this._t = setTimeout(start, 120); return; }
      fetch('%MESH%').then((r) => r.json()).then((data) => {
        if (!this._alive) return;
        this._viewer = this.createTB3Viewer(window.THREE, this._canvas, data, {
          accent: this.props.accent ?? '%ACCENT%', body: '#3A3F47', arm: '#D9DCE1', tire: '#222428', grip: '#9AA0A8',
          ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666, arena: false, view: 'showcase',
          onPick: (p) => this._show(p === this._sel ? null : p),
          onFrame: () => this._frame()
        });
        this.setState({ loading: false });
      }).catch(() => this.setState({ loading: false, failed: true }));
    };
    start();
  }
  componentWillUnmount() { this._alive = false; clearTimeout(this._t); if (this._viewer) this._viewer.dispose(); }
  _frame() {
    if (!this._sel) return;
    this._fc = (this._fc || 0) + 1;
    if (this._fc % 3) return;
    this.setState({ tag: this._viewer.project(this._sel) });
  }
  _show(p) {
    this._sel = p;
    if (this._viewer) this._viewer.select(p);
    this.setState({ sel: p, tag: p && this._viewer ? this._viewer.project(p) : null });
  }
  _parts() {
    return %PARTS%;
  }
  renderVals() {
    const s = this.state || {};
    const KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'o', 'p'];
    if (!this._setCanvas) {
      this._setCanvas = (el) => { this._canvas = el; };
      const norm = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key);
      this._kd = (e) => { const k = norm(e); if (KEYS.indexOf(k) >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat && this._viewer) this._viewer.press(k); } };
      this._ku = (e) => { const k = norm(e); if (KEYS.indexOf(k) >= 0 && this._viewer) this._viewer.release(k); };
      this._bl = () => KEYS.forEach((k) => { if (this._viewer) this._viewer.release(k); });
    }
    const P = this._parts();
    const sel = s.sel || null;
    const d = sel ? P[sel] : null;
    const ORDER = %ORDER%;
    return {
      parts: ORDER.map((o) => ({ label: o[1], pressed: String(sel === o[0]), pick: () => this._show(sel === o[0] ? null : o[0]) })),
      hasSel: !!d, noSel: !d,
      detail: d ? { name: d.name, desc: d.desc, spec: d.spec.map((x) => ({ k: x[0], v: x[1] })) } : { name: '', desc: '', spec: [] },
      tagShow: !!(d && s.tag && s.tag.visible), tagX: s.tag ? s.tag.x.toFixed(0) : '0', tagY: s.tag ? s.tag.y.toFixed(0) : '0',
      explodePressed: String(!!s.explode),
      toggleExplode: () => { const on = !s.explode; if (this._viewer) this._viewer.setExplode(on); this.setState({ explode: on }); },
      home: () => { if (this._viewer) this._viewer.setPose([0, -1.05, 0.35, 0.70], 0.01); },
      reach: () => { if (this._viewer) this._viewer.setPose([0, 0.8, -0.6, 0], 0.019); },
      loading: s.loading !== false && !s.failed, failed: !!s.failed,
      setCanvas: this._setCanvas, onKeyDown: this._kd, onKeyUp: this._ku, onBlur: this._bl
    };
  }
%VIEWER%
}"""


def robot_board():
    pages = ROOT / "tools" / "pages"
    body = (pages / "robot.body.html").read_text(encoding="utf-8")
    js = (pages / "robot.js").read_text(encoding="utf-8")
    head = re.search(r'<div class="page-head">.*?</div>', body, re.S).group(0)
    static = "\n".join(re.findall(r'<section class="card spec-card".*?</section>|<section class="card" aria-labelledby="t-joints">.*?</section>', body, re.S))
    order = re.findall(r'data-part="(\w+)">([^<]+)</button>', body)
    parts = re.search(r"var PARTS = (\{.*?\n  \});", js, re.S).group(1)
    markup = MARKUP.replace("%HEAD%", head).replace("%STATIC%", static)
    script = SCRIPT.replace("%PARTS%", parts.replace("\n", "\n  ")).replace("%ORDER%", json.dumps([list(o) for o in order], ensure_ascii=False))
    css = (pages / "robot.css").read_text(encoding="utf-8")
    return markup, script, css
