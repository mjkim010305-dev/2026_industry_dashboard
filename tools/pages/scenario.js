// 시나리오 시뮬레이터: 경기장(ㄱ자 3 m × 3 m) 위의 장애물 정의와 화면 연결.
// 장애물 값은 예시다. 실제 장애물의 크기·질량·위치를 알면 이 목록만 고치면 된다.
(function () {
  var SCENARIO = {
    start: { x: -1.1, y: 0.75, yaw: 0 },
    goal: { x: 0.75, y: -1.1, r: 0.25 },
    path: [[-1.1, 0.75], [0.75, 0.75], [0.75, -1.1]],
    pushForce: 12,        // N — 가정: 기체가 바닥 장애물을 미는 최대 힘
    payload: 0.5,         // kg — OpenMANIPULATOR-X 들 수 있는 무게(사양)
    gripMax: 0.07,        // m — 이 폭 이하 상자만 그리퍼로 잡는다(가정)
    obstacles: [
      { id: "A", name: "가벼운 상자", shape: "box", sx: 0.06, sy: 0.06, h: 0.10, x: -0.35, y: 0.75, mass: 0.2, mu: 0.4, onPath: true },
      { id: "B", name: "밀 수 있는 상자", shape: "box", sx: 0.25, sy: 0.25, h: 0.20, x: 0.75, y: -0.35, mass: 1.5, mu: 0.5, onPath: true },
      { id: "C", name: "무거운 상자", shape: "box", sx: 0.30, sy: 0.30, h: 0.30, x: 0.30, y: 1.15, mass: 8, mu: 0.6 },
      { id: "D", name: "고정 기둥", shape: "cyl", r: 0.08, h: 0.40, x: 1.20, y: 0.05, mass: 0, mu: 0, fixed: true }
    ]
  };
  var HOME = [0, -1.05, 0.35, 0.70], PICK = [0, 1.118, -0.836, 0.921];   // PICK: 그리퍼 끝이 앞 0.21 m, 높이 0.06 m (URDF 정기구학)

  var canvas = document.getElementById("scCanvas"), msg = document.getElementById("scMsg");
  var logEl = document.getElementById("scLog"), chip = document.getElementById("missionChip");
  if (!window.THREE || !window.TB3_MESHES || !window.createTB3Viewer || !window.createTB3Scenario) { msg.textContent = "3D 기체를 불러오지 못했습니다"; return; }

  var scen = null;
  var viewer = createTB3Viewer(THREE, canvas, TB3_MESHES, {
    accent: getComputedStyle(document.documentElement).getPropertyValue("--robot-accent").trim() || "%ACCENT%",
    body: "#3A3F47", arm: "#D9DCE1", tire: "#222428", grip: "#9AA0A8",
    ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666,
    collide: function (nx, ny, x, y) { return scen ? scen.collide(nx, ny, x, y) : { x: x, y: y }; },
    onFrame: function () { if (scen) scen.frame(); }
  });
  scen = createTB3Scenario(viewer, SCENARIO, {
    log: function (t) { logEl.textContent = t; },
    step: function (n) {
      var names = ["장애물 확인", "장애물 치우기", "경로 수행"];
      logEl.textContent = "미션 " + (n + 1) + " 완료: " + names[n] + (n === 2 ? " — 모든 미션을 끝냈어요!" : "");
    }
  });
  scen.reset();
  msg.hidden = true;

  // 미니맵 고정 요소
  document.getElementById("miniPath").setAttribute("points", SCENARIO.path.map(function (p) { return p[0] + "," + (-p[1]); }).join(" "));
  var goal = document.getElementById("miniGoal");
  goal.setAttribute("cx", SCENARIO.goal.x); goal.setAttribute("cy", -SCENARIO.goal.y); goal.setAttribute("r", SCENARIO.goal.r);
  document.getElementById("assume").textContent =
    "가정: 기체가 미는 최대 힘 " + SCENARIO.pushForce + " N, 필요한 힘 = 마찰 계수 × 질량 × 9.81. 집기는 " +
    Math.round(SCENARIO.payload * 1000) + " g 이하, 폭 " + Math.round(SCENARIO.gripMax * 100) + " cm 이하 상자만 (OpenMANIPULATOR-X 사양 기준). 장애물 값은 예시예요.";

  // 장애물 표
  var tbody = document.getElementById("obsBody"), rows = {};
  var KIND = { movable: "밀 수 있음", heavy: "무거움", fixed: "고정" };
  scen.state().obstacles.forEach(function (o) {
    var tr = document.createElement("tr");
    var name = document.createElement("th"); name.scope = "row"; name.textContent = o.name;
    var tdm = document.createElement("td"), inp = document.createElement("input");
    inp.type = o.kind === "fixed" ? "text" : "number"; inp.min = "0.05"; inp.step = "0.1";
    inp.value = o.kind === "fixed" ? "—" : o.mass; inp.disabled = o.kind === "fixed";
    inp.setAttribute("aria-label", o.name + " 질량 (kg)");
    inp.addEventListener("change", function () { var v = parseFloat(inp.value); if (v > 0) scen.setMass(o.id, v); });
    tdm.appendChild(inp);
    var tdf = document.createElement("td"), tds = document.createElement("td"), st = document.createElement("span");
    tds.appendChild(st);
    tr.append(name, tdm, tdf, tds); tbody.appendChild(tr);
    rows[o.id] = { input: inp, force: tdf, status: st };
  });
  var miniObs = document.getElementById("miniObs"), miniEls = {};
  var FILL = { movable: "#F2B134", heavy: "#8E6CCF", fixed: "#6B7280" };
  scen.state().obstacles.forEach(function (o) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", o.shape === "cyl" ? "circle" : "rect");
    if (o.shape === "cyl") el.setAttribute("r", o.r);
    else { el.setAttribute("width", Math.max(o.sx, 0.07)); el.setAttribute("height", Math.max(o.sy, 0.07)); }
    miniObs.appendChild(el); miniEls[o.id] = el;
  });

  function refresh() {
    var s = scen.state(), r = viewer.readout();
    s.obstacles.forEach(function (o) {
      var row = rows[o.id];
      row.force.textContent = o.force === null ? "—" : o.force.toFixed(1) + " N";
      row.status.className = "st-chip " + o.kind;
      row.status.textContent = o.held ? "집는 중" : KIND[o.kind] + (o.graspable ? " · 집기 가능" : "");
      if (document.activeElement !== row.input && o.kind !== "fixed") row.input.value = o.mass;
      var el = miniEls[o.id];
      el.setAttribute("fill", FILL[o.kind]);
      if (o.shape === "cyl") { el.setAttribute("cx", o.x); el.setAttribute("cy", -o.y); }
      else { var w = Math.max(o.sx, 0.07), h = Math.max(o.sy, 0.07); el.setAttribute("x", o.x - w / 2); el.setAttribute("y", -o.y - h / 2); }
    });
    document.querySelectorAll("#mission li").forEach(function (li) { li.classList.toggle("done", s.steps[+li.dataset.step]); });
    chip.textContent = s.steps.filter(Boolean).length + " / 3";
    document.getElementById("miniBot").setAttribute("transform",
      "translate(" + r.x.toFixed(3) + " " + (-r.y).toFixed(3) + ") rotate(" + (-r.yaw * 180 / Math.PI).toFixed(1) + ")");
  }
  setInterval(refresh, 120);
  refresh();

  document.getElementById("btnPick").addEventListener("click", function () { viewer.setPose(PICK, 0.019); });
  document.getElementById("btnHome").addEventListener("click", function () { viewer.setPose(HOME); });
  document.getElementById("btnReset").addEventListener("click", function () {
    scen.reset(); viewer.setPose(HOME, 0.01); logEl.textContent = "처음부터 다시 시작해요. i 키로 출발해 보세요.";
  });

  // 키보드 조종 (teleop 과 같은 키)
  var KEYS = ["i", "j", "k", "l", " ", "1", "2", "3", "4", "q", "w", "e", "r", "o", "p"];
  function isField(t) { return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"); }
  document.addEventListener("keydown", function (e) {
    if (isField(e.target) || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS.indexOf(k) >= 0) { if (k === " ") e.preventDefault(); viewer.press(k); }
  });
  document.addEventListener("keyup", function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS.indexOf(k) >= 0) viewer.release(k);
  });
  window.addEventListener("blur", function () { KEYS.forEach(function (k) { viewer.release(k); }); });
})();
