"""Claude Design 캔버스용 기업별 아트보드(.dc.html)와 canvas.json 을 만든다.

기업마다: {P}Analysis(분석글) · {P}Demo · {P}Teleop(3D 기체) · {P}Survey
스타일은 themes/base.css + themes/{기업}.css + themes/enhance.css 를 <helmet><style> 에 넣는다(다크 모드 블록은 뺀다).
"""
import html
from gen_canvas_robot import robot_board
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THEMES = ROOT / "tools" / "themes"
OUT = Path(sys.argv[1])  # 캔버스 root 폴더
PROJ = OUT / "project"
HEIGHTS = ROOT / ".shots" / "heights.json"

BLOB = {
    "three": "/_blob/fe33b41a4ab23f3f61d3eaa26f2a7bc0",
    "mesh": "/_blob/1fa7efd30b9214af9a8f827117bdc7bd",
    "poster": "/_blob/a4b370a6566ed13b9c27b62c0a132a06",
    "map": "/_blob/1624997dcd29fd0673e02bf5fbeee496",
    "qr": "/_blob/5070642424a65999a686a493839c89b3",
}

BRANDS = [
    ("samsung", "Samsung", "삼성", "#1259C3",
     '<header class="gnb"><div class="gnb-in"><span class="wordmark">TURTLEBOT3</span>'
     '<nav aria-label="화면 이동"><ul>%NAV%</ul></nav><span class="gnb-meta">ROS 2 · turtlebot3_manipulation</span></div></header>'),
    ("lg", "Lg", "LG", "#D0021B",
     '<header class="gnb"><div class="util"><div class="in"><span>ROS 2 · turtlebot3_manipulation</span></div></div>'
     '<div class="in main"><span class="wordmark">turtlebot3</span><nav aria-label="화면 이동"><ul>%NAV%</ul></nav></div></header>'),
    ("apple", "Apple", "애플", "#0071E3",
     '<header class="gnav"><div class="gnav-in"><span class="wordmark">turtlebot3</span>'
     '<nav aria-label="화면 이동"><ul>%NAV%</ul></nav></div></header>'),
    ("microsoft", "Microsoft", "마이크로소프트", "#0067B8",
     '<header class="mshead"><div class="in"><span class="wordmark">turtlebot3</span>'
     '<span class="sep" aria-hidden="true"></span><nav aria-label="화면 이동"><ul>%NAV%</ul></nav></div></header>'),
    ("amazon", "Amazon", "아마존", "#FF9900",
     '<header class="az"><div class="az-top"><div class="in"><span class="wordmark">turtlebot3</span>'
     '<span class="az-msg">ROS 2 · turtlebot3_manipulation</span></div></div>'
     '<nav class="az-sub" aria-label="화면 이동"><div class="in"><ul>%NAV%</ul></div></nav></header>'),
]

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&amp;family=JetBrains+Mono:wght@500;700&amp;display=swap" rel="stylesheet">')


def css_for(brand):
    parts = [(THEMES / "base.css").read_text(encoding="utf-8"),
             (THEMES / f"{brand}.css").read_text(encoding="utf-8"),
             (THEMES / "enhance.css").read_text(encoding="utf-8")]
    css = "\n".join(parts)
    css = re.sub(r"@media \(prefers-color-scheme: dark\) \{\s*[^{}]+\{[^}]*\}\s*\}", "", css)
    css = re.sub(r'(--font: [^;]*?)sans-serif;', r'\1"Noto Sans KR", sans-serif;', css)
    css = re.sub(r'(--mono: )', r'\1"JetBrains Mono", ', css)
    css = css.replace("body {\n  margin: 0;", ".dc-root {\n  margin: 0;")
    return "body{margin:0}\n" + css


def nav(prefix, current):
    items = [("Demo", "시연 영상"), ("Robot", "기체"), ("Teleop", "teleop"), ("Survey", "설문")]
    out = []
    for key, label in items:
        cur = ' aria-current="page"' if key == current else ""
        out.append(f'<li><a href="{prefix}{key}.dc.html"{cur}>{label}</a></li>')
    return "".join(out)


def page(title, css, head_extra, body, script, w, h):
    props = json.dumps(script[1], ensure_ascii=False).replace("&", "&amp;").replace("'", "&#39;")
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
{head_extra}</head>
<body>
<x-dc>
<helmet>
{FONTS}
<style>
{css}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props}'>
{script[0]}
</script>
</body>
</html>
"""


# ---------- 시연 영상 ----------
DEMO_BODY = """<div class="dc-root">
%HEADER%
<div class="page">
<main>
<section class="desc page-head">
<p class="eyebrow">DEMO</p>
<h1>프로젝트 시연 영상</h1>
<p>움직일 수 있는 장애물이 경로를 막고 있으면, 움직일 수 있는 장애물을 치우고 경로를 수행한다.</p>
<p class="sub">ROS 2 와 turtlebot3_manipulation 을 사용한 프로젝트입니다.</p>
</section>
<section class="story" aria-label="시연 흐름">
<div class="story-step"><span class="story-num">01</span><div><h3>장애물 확인</h3><p>경로를 막은 장애물이 움직일 수 있는 것인지 판단합니다.</p></div></div>
<div class="story-step"><span class="story-num">02</span><div><h3>장애물 치우기</h3><p>manipulator 로 장애물을 집어 경로 밖으로 옮깁니다.</p></div></div>
<div class="story-step"><span class="story-num">03</span><div><h3>경로 수행</h3><p>비워진 경로를 따라 목적지까지 주행합니다.</p></div></div>
</section>
<section class="player" aria-label="메인 플레이어">
<div class="main-wrap card">
<div class="frame poster">
<img src="%POSTER%" alt="시연 영상 {{main}} 첫 화면">
<span class="pl-play"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#FFFFFF"></path></svg></span>
<span class="pl-badge">{{main}}.mp4</span>
</div>
<div class="bar">
<button type="button" class="btn primary" onClick="{{toggle}}">{{toggleLabel}}</button>
<span class="state" role="status">{{stateLabel}}</span>
<span class="now">현재 영상: {{main}}</span>
<span class="live">지금 재생 중: {{main}}</span>
</div>
</div>
</section>
<section class="list-section">
<h2>영상 목록</h2>
<div class="cells">
<sc-for list="{{list}}" as="item" hint-placeholder-count="4">
<button type="button" class="cell" onClick="{{item.pick}}" aria-label="{{item.name}} 재생">
<span class="frame" style="display: block;"><img src="%POSTER%" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;"></span>
<span class="name">{{item.name}}</span>
</button>
</sc-for>
</div>
</section>
</main>
</div>
</div>"""

DEMO_JS = """class Component extends DCLogic {
  renderVals() {
    const s = this.state || {};
    const names = ['intro', 'data1', 'data2', 'data3', 'data4'];
    const main = s.main || 'intro';
    const playing = s.playing !== false;
    return {
      main: main,
      toggleLabel: playing ? '일시정지' : '재생',
      stateLabel: '상태: ' + (playing ? '재생 중' : '정지'),
      toggle: () => this.setState({ playing: !playing }),
      list: names.filter((n) => n !== main).map((n) => ({ name: n, pick: () => this.setState({ main: n, playing: true }) }))
    };
  }
}"""

# ---------- teleop ----------
KEYCAP = ('<button type="button" class="key {{key.cls}}" aria-label="{{key.label}}" onPointerDown="{{key.down}}" '
          'onPointerUp="{{key.up}}" onPointerLeave="{{key.up}}"><span class="k">{{key.k}}</span><span class="n">{{key.n}}</span></button>')
TELEOP_BODY = """<div class="dc-root">
%HEADER%
<div class="page">
<main>
<div class="page-head">
<p class="eyebrow">REMOTE CONTROL</p>
<h1>teleop</h1>
<p class="lead">로봇에 연결한 뒤 키보드로 이동 · manipulator · 그리퍼를 조종합니다.</p>
</div>
<div class="layout">
<section class="conn card" aria-labelledby="t-conn">
<div class="card-head">
<h2 id="t-conn">연결 설정</h2>
<div class="statusbox">
<div class="st" data-sig="{{sig}}" role="status">
<sc-if value="{{connected}}" hint-placeholder-val="{{ false }}"><svg class="ico-ok" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"></circle><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg></sc-if>
<sc-if value="{{disconnected}}" hint-placeholder-val="{{ true }}"><svg class="ico-off" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M7.5 12h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg></sc-if>
<span>{{statusLabel}}</span>
</div>
</div>
</div>
<form>
<div class="field f-host"><label for="d-host">호스트</label><input id="d-host" type="text" placeholder="[로봇 IP]"></div>
<div class="field f-port"><label for="d-port">포트</label><input id="d-port" type="text" value="22"></div>
<div class="field f-user"><label for="d-user">계정</label><input id="d-user" type="text"></div>
<div class="field f-pass"><label for="d-pass">비밀번호</label>
<div class="pass-wrap"><input id="d-pass" type="password"><button type="button" class="eye"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg><span>비밀번호 보기</span></button></div>
</div>
<div class="field f-cmd"><label for="d-cmd">teleop 실행 명령</label><input id="d-cmd" type="text" placeholder="[실행 명령]"></div>
<div class="field f-topic"><label for="d-topic">camera topic</label><input id="d-topic" type="text" placeholder="[topic 이름]"></div>
<div class="end"><button type="button" class="btn primary" onClick="{{toggle}}">{{btnLabel}}</button></div>
</form>
</section>

<section class="card" aria-labelledby="t-view">
<div class="card-head">
<h2 id="t-view">기체 3D · 조종 화면</h2>
<span class="chip">turtlebot3 waffle pi + OpenMANIPULATOR-X</span>
</div>
<div class="viewer" tabindex="0" aria-label="3D 기체. 누른 뒤 키보드로 조종, 끌어서 회전" onKeyDown="{{onKeyDown}}" onKeyUp="{{onKeyUp}}" onBlur="{{onBlur}}">
<canvas ref="{{setCanvas}}" aria-hidden="true"></canvas>
<span class="viewer-hint">누른 뒤 키보드로 조종 · 끌어서 회전 · 휠로 확대</span>
<sc-if value="{{loading}}" hint-placeholder-val="{{ true }}"><div class="viewer-loading">3D 기체를 불러오는 중</div></sc-if>
<sc-if value="{{failed}}" hint-placeholder-val="{{ false }}"><div class="viewer-loading">3D 기체를 불러오지 못했습니다</div></sc-if>
<div class="pip pip-arena">
<sc-if value="{{disconnected}}" hint-placeholder-val="{{ true }}"><svg viewBox="-1.7 -1.7 3.4 3.4" role="img" aria-label="경기장 3 m × 3 m 안의 기체 위치">
<path d="M-1.5 0 L-1.5 -1.5 L1.5 -1.5 L1.5 1.5 L0 1.5 L0 0 Z" fill="#1A222C" stroke="#C9CED6" stroke-width="0.04"></path>
<path d="M-1 -1.5 V0 M-0.5 -1.5 V0 M0 -1.5 V1.5 M0.5 -1.5 V1.5 M1 -1.5 V1.5 M-1.5 -1 H1.5 M-1.5 -0.5 H1.5 M0 0.5 H1.5 M0 1 H1.5" stroke="#2A3442" stroke-width="0.015" fill="none"></path>
<g transform="translate({{robot.tx}} {{robot.ty}}) rotate({{robot.deg}})"><circle r="0.14" fill="{{robot.color}}" stroke="#FFFFFF" stroke-width="0.04"></circle><path d="M0.1 -0.08 L0.26 0 L0.1 0.08 Z" fill="#FFFFFF"></path></g>
</svg></sc-if>
<sc-if value="{{connected}}" hint-placeholder-val="{{ false }}"><div class="pip-cam">[camera topic 영상]</div></sc-if>
<span class="pip-label">{{viewLabel}}</span>
</div>
</div>
<div class="readout" aria-label="관절 · 주행 값">
<sc-for list="{{readouts}}" as="r" hint-placeholder-count="7"><span class="{{r.cls}}"><b>{{r.k}}</b>{{r.v}}</span></sc-for>
</div>
</section>

<section class="card" aria-labelledby="t-kbd">
<div class="card-head"><h2 id="t-kbd">키보드 그림</h2></div>
<div class="hint-row">연결 전에는 3D 기체로 미리 움직여 볼 수 있어요. 키 그림을 눌러도 됩니다.</div>
<div class="kbd">
<div class="group" role="group" aria-labelledby="g-move"><h3 id="g-move">이동 키</h3>
<div class="keys move"><sc-for list="{{moveKeys}}" as="key" hint-placeholder-count="5">%KEYCAP%</sc-for></div></div>
<div class="group" role="group" aria-labelledby="g-arm"><h3 id="g-arm">manipulator 키</h3>
<div class="keys arm"><sc-for list="{{armKeys}}" as="key" hint-placeholder-count="8">%KEYCAP%</sc-for></div></div>
<div class="group" role="group" aria-labelledby="g-grip"><h3 id="g-grip">그리퍼 키</h3>
<div class="keys grip"><sc-for list="{{gripKeys}}" as="key" hint-placeholder-count="2">%KEYCAP%</sc-for></div></div>
</div>
</section>
</div>
</main>
</div>
</div>"""

TELEOP_JS = """class Component extends DCLogic {
  componentDidMount() {
    this._alive = true;
    const start = () => {
      if (!this._alive) return;
      if (!window.THREE || !this._canvas) { this._t = setTimeout(start, 120); return; }
      fetch('%MESH%').then((r) => r.json()).then((data) => {
        if (!this._alive) return;
        const accent = this.props.accent ?? '%ACCENT%';
        this._viewer = this.createTB3Viewer(window.THREE, this._canvas, data, {
          accent: accent, body: '#3A3F47', arm: '#D9DCE1', tire: '#222428', grip: '#9AA0A8',
          ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666
        });
        this.setState({ loading: false, ro: this._viewer.readout() });
        this._iv = setInterval(() => { if (this._viewer) this.setState({ ro: this._viewer.readout() }); }, 120);
      }).catch(() => this.setState({ loading: false, failed: true }));
    };
    start();
  }
  componentWillUnmount() {
    this._alive = false;
    clearTimeout(this._t);
    clearInterval(this._iv);
    if (this._viewer) this._viewer.dispose();
  }
  _press(k) { if (this._viewer) { this._viewer.press(k); this.setState({ ro: this._viewer.readout() }); } }
  _release(k) { if (this._viewer) { this._viewer.release(k); this.setState({ ro: this._viewer.readout() }); } }
  renderVals() {
    const s = this.state || {};
    const KEYS = ['i', 'j', 'k', 'l', ' ', '1', '2', '3', '4', 'q', 'w', 'e', 'r', 'o', 'p'];
    if (!this._setCanvas) this._setCanvas = (el) => { this._canvas = el; };
    if (!this._kd) {
      const norm = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key);
      this._kd = (e) => { const k = norm(e); if (KEYS.indexOf(k) >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) this._press(k); } };
      this._ku = (e) => { const k = norm(e); if (KEYS.indexOf(k) >= 0) { e.preventDefault(); this._release(k); } };
      this._bl = () => KEYS.forEach((k) => this._release(k));
    }
    const connected = !!s.connected;
    const ro = s.ro || { joints: [0, -1.05, 0.35, 0.7], grip: 0.01, v: 0, w: 0, held: [] };
    const held = ro.held || [];
    const on = (ks) => ks.some((k) => held.indexOf(k) >= 0);
    const mk = (k, n, extra) => ({
      k: k === ' ' ? 'space' : k, n: n, label: (k === ' ' ? 'space' : k) + ' ' + n,
      cls: (extra || '') + (on([k]) ? ' on' : ''),
      down: (e) => { if (e && e.preventDefault) e.preventDefault(); this._press(k); },
      up: () => this._release(k)
    });
    const deg = (r) => (r * 180 / Math.PI).toFixed(0) + '°';
    const roItem = (k, v, ks) => ({ k: k, v: v, cls: 'ro' + (on(ks) ? ' is-on' : '') });
    return {
      sig: connected ? 'connected' : 'disconnected',
      connected: connected, disconnected: !connected,
      statusLabel: connected ? '연결됨 · 로봇 camera 영상' : '연결 안 됨 · map 이미지',
      btnLabel: connected ? '연결 해제' : '연결',
      viewLabel: connected ? 'camera 영상' : '경기장 3 m × 3 m',
      robot: { tx: (ro.x ?? -1).toFixed(3), ty: (-(ro.y ?? 0.75)).toFixed(3), deg: (-(ro.yaw || 0) * 180 / Math.PI).toFixed(1), color: this.props.accent ?? '%ACCENT%' },
      toggle: () => this.setState({ connected: !connected }),
      loading: s.loading !== false && !s.failed, failed: !!s.failed,
      setCanvas: this._setCanvas, onKeyDown: this._kd, onKeyUp: this._ku, onBlur: this._bl,
      moveKeys: [mk('i', '전진', 'k-i'), mk('j', '왼쪽 회전'), mk('k', '후진'), mk('l', '오른쪽 회전'), mk(' ', '정지', 'k-space')],
      armKeys: [mk('1', 'joint1 왼쪽 회전'), mk('2', 'joint2 왼쪽 회전'), mk('3', 'joint3 왼쪽 회전'), mk('4', 'joint4 왼쪽 회전'),
        mk('q', 'joint1 오른쪽 회전'), mk('w', 'joint2 오른쪽 회전'), mk('e', 'joint3 오른쪽 회전'), mk('r', 'joint4 오른쪽 회전')],
      gripKeys: [mk('o', '그리퍼 열기'), mk('p', '그리퍼 닫기')],
      readouts: [
        roItem('joint1', deg(ro.joints[0]), ['1', 'q']), roItem('joint2', deg(ro.joints[1]), ['2', 'w']),
        roItem('joint3', deg(ro.joints[2]), ['3', 'e']), roItem('joint4', deg(ro.joints[3]), ['4', 'r']),
        roItem('gripper', (ro.grip * 1000).toFixed(1) + ' mm', ['o', 'p']),
        roItem('v', ro.v.toFixed(2) + ' m/s', ['i', 'k', ' ']), roItem('ω', ro.w.toFixed(2) + ' rad/s', ['j', 'l', ' ']),
        roItem('위치', '(' + (ro.x ?? -1).toFixed(2) + ', ' + (ro.y ?? 0.75).toFixed(2) + ') m', [])
      ]
    };
  }
%VIEWER%
}"""

# ---------- 설문 ----------
SURVEY_BODY = """<div class="dc-root" style="position: relative;">
%HEADER%
<div class="page">
<main class="survey-card">
<p class="eyebrow">SURVEY</p>
<h1>설문</h1>
<p class="guide">QR 코드를 스캔해 설문에 참여해 주세요</p>
<div class="slot">
<button type="button" class="qrcard qr-scan" onClick="{{open}}" aria-label="설문 QR 확대 보기" aria-haspopup="dialog">
<img src="%QR%" alt="설문 참여용 QR 코드">
<span class="scanline" aria-hidden="true"></span>
<span class="corner tl" aria-hidden="true"></span><span class="corner tr" aria-hidden="true"></span>
<span class="corner bl" aria-hidden="true"></span><span class="corner br" aria-hidden="true"></span>
</button>
</div>
<p class="zoom-hint">QR 을 누르면 크게 볼 수 있어요</p>
<ol class="steps">
<li><b>1</b>휴대폰 카메라를 열어요</li>
<li><b>2</b>QR 을 화면에 비춰요</li>
<li><b>3</b>열린 설문에 응답해요</li>
</ol>
</main>
</div>
<sc-if value="{{zoom}}" hint-placeholder-val="{{ false }}">
<div class="dc-overlay" role="dialog" aria-modal="true" aria-label="설문 QR 확대 보기">
<button type="button" class="closebtn" onClick="{{close}}">닫기</button>
<div class="zoomcard"><img src="%QR%" alt="설문 참여용 QR 코드"></div>
</div>
</sc-if>
</div>"""

SURVEY_JS = """class Component extends DCLogic {
  renderVals() {
    const s = this.state || {};
    return { zoom: !!s.zoom, open: () => this.setState({ zoom: true }), close: () => this.setState({ zoom: false }) };
  }
}"""


# ---------- 분석글: 마크다운 → 마크업 ----------
def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(#[0-9A-Fa-f]{6})\b", r'<span class="chipcolor" style="background: \1;"></span>\1', t)
    return t.replace("{{", "{ {")


def md_to_html(md):
    lines = md.splitlines()
    out, i = [], 0
    while i < len(lines):
        l = lines[i]
        if not l.strip():
            i += 1; continue
        m = re.match(r"^(#{1,3}) (.*)", l)
        if m:
            n = len(m.group(1)); out.append(f"<h{n}>{inline(m.group(2))}</h{n}>"); i += 1; continue
        if l.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            head, body = rows[0], rows[1:]
            t = "<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
            t += "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
            out.append(t + "</tbody></table>"); continue
        if re.match(r"^\s*(- |\d+\. )", l):
            ordered = bool(re.match(r"^\s*\d+\. ", l))
            items = []
            while i < len(lines) and re.match(r"^\s*(- |\d+\. )", lines[i]):
                text = re.sub(r"^\s*(- |\d+\. )", "", lines[i]); i += 1
                while i < len(lines) and lines[i].startswith("  ") and not re.match(r"^\s*(- |\d+\. )", lines[i]):
                    text += " " + lines[i].strip(); i += 1
                sub = []
                while i < len(lines) and re.match(r"^\s{2,}- ", lines[i]):
                    sub.append(re.sub(r"^\s*- ", "", lines[i])); i += 1
                li = inline(text)
                if sub:
                    li += "<ul>" + "".join(f"<li>{inline(s)}</li>" for s in sub) + "</ul>"
                items.append(f"<li>{li}</li>")
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(items) + f"</{tag}>"); continue
        if l.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ").strip()); i += 1
            out.append("<blockquote><p>" + inline(" ".join(buf)) + "</p></blockquote>"); continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||>|\s*- |\s*\d+\. )", lines[i]):
            buf.append(lines[i].strip()); i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(out)


def analysis_body(brand, label, md):
    hexes = []
    for h in re.findall(r"#[0-9A-Fa-f]{6}", md.split("## 4. 색")[1].split("## 5.")[0] if "## 4. 색" in md else md):
        if h.upper() not in hexes:
            hexes.append(h.upper())
    sw = "".join(f'<span style="background: {h};" title="{h}"></span>' for h in hexes[:8])
    return (f'<article class="doc">\n<div class="doc-band"><span class="doc-brand">UI/UX ANALYSIS · {html.escape(label)}</span>'
            f'<div class="swatches" aria-label="주요 색">{sw}</div></div>\n{md_to_html(md)}\n</article>')


def viewer_method():
    src = (ROOT / "tools" / "tb3_viewer.js").read_text(encoding="utf-8")
    src = src.split("\n", 2)[2]  # 머리 주석 두 줄 제거
    src = src.replace("function createTB3Viewer(THREE, canvas, data, theme) {", "createTB3Viewer(THREE, canvas, data, theme) {", 1)
    return "\n".join("  " + l if l else l for l in src.splitlines())


def main():
    heights = json.loads(HEIGHTS.read_text()) if HEIGHTS.exists() else {}
    PROJ.mkdir(parents=True, exist_ok=True)
    preview_dir = ROOT / ".shots" / "preview"; preview_dir.mkdir(parents=True, exist_ok=True)
    boards, order, notes, written = {}, [], {}, []
    viewer = viewer_method()
    robot_markup, robot_script, robot_css = robot_board()
    for brand, P, label, accent, header in BRANDS:
        css = css_for(brand)
        md = (ROOT / "design-refs" / f"{brand}.md").read_text(encoding="utf-8")
        doc = analysis_body(brand, label, md)
        ah = heights.get(f"{P}Analysis", 2600)
        files = {
            f"{P}Analysis.dc.html": page(f"{label} UI/UX 분석", css, "", doc,
                                         ("class Component extends DCLogic {\n  renderVals() { return {}; }\n}", {"$preview": {"width": 1000, "height": ah}}), 1000, ah),
            f"{P}Demo.dc.html": page(f"{label} 스타일 · 시연 영상", css, "",
                                     DEMO_BODY.replace("%HEADER%", header.replace("%NAV%", nav(P, "Demo"))).replace("%POSTER%", BLOB["poster"]),
                                     (DEMO_JS, {"$preview": {"width": 1440, "height": 1520}}), 1440, 1520),
            f"{P}Robot.dc.html": page(f"{label} 스타일 · 기체 소개", css + "\n" + robot_css, f'<script src="{BLOB["three"]}"></script>\n',
                                      robot_markup.replace("%HEADER%", header.replace("%NAV%", nav(P, "Robot"))),
                                      (robot_script.replace("%MESH%", BLOB["mesh"]).replace("%ACCENT%", accent).replace("%VIEWER%", viewer),
                                       {"accent": {"editor": "color", "default": accent}, "$preview": {"width": 1440, "height": 2000}}), 1440, 2000),
            f"{P}Teleop.dc.html": page(f"{label} 스타일 · teleop", css, f'<script src="{BLOB["three"]}"></script>\n',
                                       TELEOP_BODY.replace("%HEADER%", header.replace("%NAV%", nav(P, "Teleop"))).replace("%KEYCAP%", KEYCAP).replace("%MAP%", BLOB["map"]),
                                       (TELEOP_JS.replace("%MESH%", BLOB["mesh"]).replace("%ACCENT%", accent).replace("%VIEWER%", viewer),
                                        {"accent": {"editor": "color", "default": accent}, "$preview": {"width": 1440, "height": 1420}}), 1440, 1420),
            f"{P}Survey.dc.html": page(f"{label} 스타일 · 설문", css, "",
                                       SURVEY_BODY.replace("%HEADER%", header.replace("%NAV%", nav(P, "Survey"))).replace("%QR%", BLOB["qr"]),
                                       (SURVEY_JS, {"$preview": {"width": 1440, "height": 980}}), 1440, 1120),
        }
        for name, text in files.items():
            (PROJ / name).write_text(text, encoding="utf-8")
            written.append(name)
        # 분석글 높이 측정용 미리보기
        (preview_dir / f"{P}Analysis.html").write_text(
            f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{doc}'
            f'<script>document.title=String(document.querySelector(".doc").offsetHeight)</script></body></html>', encoding="utf-8")
        x = 0
        for kind, w, h, title in [("Analysis", 1000, ah, f"{label} · UI/UX 분석"), ("Demo", 1440, 1520, f"{label} 스타일 · 시연 영상"),
                                  ("Robot", 1440, 2000, f"{label} 스타일 · 기체 소개 (3D)"),
                                  ("Teleop", 1440, 1420, f"{label} 스타일 · teleop (3D 기체)"), ("Survey", 1440, 980, f"{label} 스타일 · 설문")]:
            entry = {"x": x, "y": 0, "w": w, "h": h, "title": title, "page": brand}
            if kind != "Analysis":
                entry.update({"expand": "fill", "is_interactive": True})
            boards[f"{P}{kind}.dc.html"] = entry
            order.append(f"{P}{kind}.dc.html")
            x += w + 80
        notes[f"{brand}-title"] = {"x": 0, "y": -300, "text": f"{label} 스타일 — 분석글 · 시연 영상 · 기체 · teleop · 설문", "kind": "title1", "maxW": x - 80, "page": brand}
    (OUT / "new_boards.json").write_text(json.dumps({"boards": boards, "order": order, "notes": notes, "files": written}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(written), "files")


if __name__ == "__main__":
    main()
