// 시나리오 시뮬레이터: 지도(기본 ㄱ자 경기장 또는 Nav2 map.yaml + map.pgm) 위에 장애물을 놓고 조종한다.
// 기본 경기장의 장애물 값은 예시다. 실제 장애물의 크기·질량·위치를 알면 이 목록을 고치거나 화면에서 만들면 된다.
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
      { id: "D", name: "고정 기둥", shape: "cyl", r: 0.08, h: 0.40, x: 1.20, y: 0.05, fixed: true }
    ]
  };
  var HOME = [0, -1.05, 0.35, 0.70], PICK = [0, 1.118, -0.836, 0.921];   // PICK: 그리퍼 끝이 기체 앞 바닥 가까이
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("scCanvas"), msg = $("scMsg"), logEl = $("scLog");
  if (!window.THREE || !window.TB3_MESHES || !window.createTB3Viewer || !window.createTB3Scenario || !window.TB3Map) {
    msg.textContent = "3D 기체를 불러오지 못했습니다"; return;
  }

  var scen = null, placing = null;     // placing: "obstacle" | "goal" | "start" | null
  var viewer = createTB3Viewer(THREE, canvas, TB3_MESHES, {
    accent: getComputedStyle(document.documentElement).getPropertyValue("--robot-accent").trim() || "%ACCENT%",
    body: "#3A3F47", arm: "#D9DCE1", tire: "#222428", grip: "#9AA0A8",
    ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666,
    arena: false, floorGrid: false, maxDist: 30,
    collide: function (nx, ny, x, y) { return scen ? scen.collide(nx, ny, x, y) : { x: x, y: y }; },
    onFrame: function () { if (scen) scen.frame(); },
    onFloorClick: function (x, y) { if (placing) placeAt(x, y); }
  });
  scen = createTB3Scenario(viewer, SCENARIO, {
    log: function (t) { logEl.textContent = t; },
    step: function (n) {
      var names = ["장애물 확인", "장애물 치우기", "경로 수행"];
      logEl.textContent = "미션 " + (n + 1) + " 완료: " + names[n] + (n === 2 ? " — 모든 미션을 끝냈어요!" : "");
    }
  });
  msg.hidden = true;
  $("assume").textContent =
    "가정: 기체가 미는 최대 힘 " + SCENARIO.pushForce + " N, 필요한 힘 = 마찰 계수 × 질량 × 9.81. 집기는 " +
    Math.round(SCENARIO.payload * 1000) + " g 이하, 폭 " + Math.round(SCENARIO.gripMax * 100) +
    " cm 이하 상자만 (OpenMANIPULATOR-X 사양 기준). 좌표는 지도(map) 프레임, 단위 m.";

  // ---------- 지도 불러오기 ----------
  var mapInfo = $("mapInfo"), mini = null;
  function afterMapChange() {
    var s = scen.state(), m = scen.map();
    $("mapTitle").textContent = s.mapName;
    $("mapChip").textContent = s.isDefault ? "기본" : "불러온 지도";
    $("btnDefaultMap").hidden = s.isDefault;
    $("missionCard").hidden = !s.isDefault;
    mini = TB3Map.minimapBase(m, $("miniCanvas").width);
    rebuildTable();
    var c = m.nearestFree(viewer.drive.x + 0.5, viewer.drive.y, 0.15);
    if (c) { form.x.value = c.x.toFixed(2); form.y.value = c.y.toFixed(2); }
  }
  function loadFiles(files) {
    if (!files || !files.length) return;
    mapInfo.className = "map-info"; mapInfo.textContent = "지도를 읽는 중…";
    TB3Map.fromFiles(files).then(function (m) {
      scen.setMap(m, false);
      var free = 0; for (var n = 0; n < m.cells.length; n++) if (m.cells[n] === TB3Map.FREE) free++;
      mapInfo.textContent = m.name + " · " + m.width + " × " + m.height + " 칸, 해상도 " + m.res + " m (" +
        (m.width * m.res).toFixed(1) + " × " + (m.height * m.res).toFixed(1) + " m), 원점 (" +
        m.origin.map(function (v) { return +v.toFixed(3); }).join(", ") + "), 빈칸 " + Math.round(free * m.res * m.res * 10) / 10 + " m²";
      logEl.textContent = "지도를 불러왔어요. 장애물을 놓고 i 키로 출발해 보세요.";
      afterMapChange();
    }).catch(function (e) { mapInfo.className = "map-info error"; mapInfo.textContent = e.message; });
  }
  $("mapFiles").addEventListener("change", function (e) { loadFiles(e.target.files); e.target.value = ""; });
  var dz = $("dropzone");
  ["dragenter", "dragover"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { dz.addEventListener(t, function () { dz.classList.remove("over"); }); });
  dz.addEventListener("drop", function (e) { e.preventDefault(); loadFiles(e.dataTransfer.files); });
  $("btnDefaultMap").addEventListener("click", function () {
    scen.setMap(TB3Map.defaultArena(), true);
    mapInfo.className = "map-info"; mapInfo.textContent = "지도를 올리지 않으면 기본 ㄱ자 경기장을 써요.";
    afterMapChange();
  });

  // ---------- 장애물 만들기 · 위치 고르기 ----------
  var form = $("addForm"), addMsg = $("addMsg");
  function syncShape() { var cyl = form.shape.value === "cyl"; form.classList.toggle("cyl", cyl); form.classList.toggle("box", !cyl); }
  Array.prototype.forEach.call(form.shape, function (r) { r.addEventListener("change", syncShape); });
  syncShape();
  form.fixed.addEventListener("change", function () { form.mass.disabled = form.fixed.checked; form.mu.disabled = form.fixed.checked; });
  function note(text, isError) { addMsg.textContent = text; addMsg.className = "form-msg" + (isError ? " error" : ""); }
  function spec() {
    return { shape: form.shape.value, sx: +form.sx.value, sy: +form.sy.value, r: +form.r.value, h: +form.h.value,
      mass: +form.mass.value, mu: +form.mu.value, fixed: form.fixed.checked, x: parseFloat(form.x.value), y: parseFloat(form.y.value) };
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = scen.addObstacle(spec());
    if (err) note(err, true); else { note("놓았어요.", false); rebuildTable(); }
  });
  var modeButtons = { obstacle: $("btnPickSpot"), goal: $("btnPlaceGoal"), start: $("btnPlaceStart") };
  var HINT = { obstacle: "바닥을 누르면 그 자리에 장애물을 놓아요", goal: "바닥을 누르면 목표 지점이 돼요", start: "바닥을 누르면 기체를 그 자리로 옮겨요" };
  function setPlacing(mode) {
    placing = placing === mode ? null : mode;
    Object.keys(modeButtons).forEach(function (k) { modeButtons[k].setAttribute("aria-pressed", String(placing === k)); });
    $("scStage").classList.toggle("placing", !!placing);
    $("scHint").textContent = placing ? HINT[placing] + " · Esc 로 취소" : "키보드로 조종 · 끌어서 회전 · 휠로 확대";
  }
  Object.keys(modeButtons).forEach(function (k) { modeButtons[k].addEventListener("click", function () { setPlacing(k); }); });
  function placeAt(x, y) {
    if (placing === "obstacle") {
      form.x.value = x.toFixed(2); form.y.value = y.toFixed(2);
      var err = scen.addObstacle(spec());
      if (err) note(err, true); else { note("놓았어요. 계속 누르면 같은 장애물을 더 놓아요.", false); rebuildTable(); }
    } else if (placing === "goal") {
      scen.setGoal(x, y, 0.25); logEl.textContent = "목표 지점을 (" + x.toFixed(2) + ", " + y.toFixed(2) + ") 로 정했어요."; setPlacing("goal");
    } else if (placing === "start") {
      var e2 = scen.setStart(x, y);
      logEl.textContent = e2 || "기체를 (" + x.toFixed(2) + ", " + y.toFixed(2) + ") 로 옮겼어요. '처음부터'를 누르면 여기서 다시 시작해요.";
      if (!e2) setPlacing("start");
    }
  }

  // ---------- 장애물 목록 ----------
  var tbody = $("obsBody"), rows = {};
  var KIND = { movable: "밀 수 있음", heavy: "무거움", fixed: "고정" };
  function cellInput(type, value, label, onChange, disabled) {
    var inp = document.createElement("input");
    inp.type = type; inp.value = value; inp.disabled = !!disabled; inp.setAttribute("aria-label", label);
    if (type === "number") inp.step = "any";
    inp.addEventListener("change", onChange);
    return inp;
  }
  function rebuildTable() {
    tbody.textContent = ""; rows = {};
    var list = scen.state().obstacles;
    $("obsEmpty").hidden = list.length > 0;
    list.forEach(function (o) {
      var tr = document.createElement("tr"), name = document.createElement("th");
      name.scope = "row"; name.textContent = o.name;
      var ix, iy, im;
      var move = function () {
        var px = parseFloat(ix.value), py = parseFloat(iy.value), err = scen.moveObstacle(o.id, px, py);
        logEl.textContent = err ? o.name + ": " + err : o.name + " 위치를 (" + px.toFixed(2) + ", " + py.toFixed(2) + ") 로 바꿨어요.";
      };
      ix = cellInput("number", o.x.toFixed(2), o.name + " x", move);
      iy = cellInput("number", o.y.toFixed(2), o.name + " y", move);
      var size = document.createElement("td");
      size.textContent = o.shape === "cyl" ? "⌀" + (o.r * 2).toFixed(2) + " × " + o.h.toFixed(2) : o.sx.toFixed(2) + " × " + o.sy.toFixed(2) + " × " + o.h.toFixed(2);
      im = cellInput(o.kind === "fixed" ? "text" : "number", o.kind === "fixed" ? "—" : o.mass, o.name + " 질량 (kg)",
        function () { var v = parseFloat(im.value); if (v > 0) scen.setMass(o.id, v); }, o.kind === "fixed");
      var tdf = document.createElement("td"), tds = document.createElement("td"), st = document.createElement("span"), tdd = document.createElement("td");
      var del = document.createElement("button");
      del.type = "button"; del.className = "del"; del.textContent = "삭제"; del.setAttribute("aria-label", o.name + " 삭제");
      del.addEventListener("click", function () { scen.removeObstacle(o.id); rebuildTable(); logEl.textContent = o.name + " 지웠어요."; });
      tds.appendChild(st); tdd.appendChild(del);
      var tx = document.createElement("td"), ty = document.createElement("td"), tm = document.createElement("td");
      tx.appendChild(ix); ty.appendChild(iy); tm.appendChild(im);
      tr.append(name, tx, ty, size, tm, tdf, tds, tdd); tbody.appendChild(tr);
      rows[o.id] = { x: ix, y: iy, mass: im, force: tdf, status: st };
    });
  }

  // ---------- 주기 갱신: 표 · 미션 · 미니맵 ----------
  var FILL = { movable: "#F2B134", heavy: "#8E6CCF", fixed: "#6B7280" };
  var accent = getComputedStyle(document.documentElement).getPropertyValue("--robot-accent").trim() || "%ACCENT%";
  function refresh() {
    var s = scen.state(), r = viewer.readout();
    s.obstacles.forEach(function (o) {
      var row = rows[o.id];
      if (!row) return;
      row.force.textContent = o.force === null ? "—" : o.force.toFixed(1) + " N";
      row.status.className = "st-chip " + o.kind;
      row.status.textContent = o.held ? "집는 중" : KIND[o.kind] + (o.graspable ? " · 집기 가능" : "");
      if (document.activeElement !== row.x) row.x.value = o.x.toFixed(2);
      if (document.activeElement !== row.y) row.y.value = o.y.toFixed(2);
      if (document.activeElement !== row.mass && o.kind !== "fixed") row.mass.value = o.mass;
    });
    document.querySelectorAll("#mission li").forEach(function (li) { li.classList.toggle("done", s.steps[+li.dataset.step]); });
    $("missionChip").textContent = s.steps.filter(Boolean).length + " / 3";
    if (!mini) return;
    var g = $("miniCanvas").getContext("2d"), P = mini.toPx, k = mini.scale;
    g.drawImage(mini.canvas, 0, 0);
    if (s.path) {
      g.setLineDash([6, 5]); g.strokeStyle = "#9DB4CF"; g.lineWidth = 2; g.beginPath();
      s.path.forEach(function (p, n) { var q = P(p[0], p[1]); if (n) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      g.stroke(); g.setLineDash([]);
    }
    if (s.goal) { var gq = P(s.goal.x, s.goal.y); g.strokeStyle = "#5FD08A"; g.lineWidth = 2.5; g.beginPath(); g.arc(gq[0], gq[1], Math.max(4, s.goal.r * k), 0, Math.PI * 2); g.stroke(); }
    s.obstacles.forEach(function (o) {
      var q = P(o.x, o.y); g.fillStyle = FILL[o.kind];
      if (o.shape === "cyl") { g.beginPath(); g.arc(q[0], q[1], Math.max(2.5, o.r * k), 0, Math.PI * 2); g.fill(); }
      else { var w = Math.max(5, o.sx * k), h = Math.max(5, o.sy * k); g.fillRect(q[0] - w / 2, q[1] - h / 2, w, h); }
    });
    var b = P(r.x, r.y), rad = Math.max(5, 0.14 * k);
    g.save(); g.translate(b[0], b[1]); g.rotate(-r.yaw);
    g.fillStyle = accent; g.strokeStyle = "#FFFFFF"; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#FFFFFF"; g.beginPath(); g.moveTo(rad * 1.8, 0); g.lineTo(rad * 0.7, -rad * 0.6); g.lineTo(rad * 0.7, rad * 0.6); g.fill();
    g.restore();
  }
  afterMapChange();
  setInterval(refresh, 120);
  refresh();

  $("btnPick").addEventListener("click", function () { viewer.setPose(PICK, 0.019); });
  $("btnHome").addEventListener("click", function () { viewer.setPose(HOME); });
  $("btnReset").addEventListener("click", function () {
    scen.reset(); viewer.setPose(HOME, 0.01); logEl.textContent = "처음부터 다시 시작해요. i 키로 출발해 보세요.";
  });

  // 키보드 조종 (teleop 과 같은 키). Esc 는 위치 고르기 취소
  var KEYS = ["i", "j", "k", "l", " ", "1", "2", "3", "4", "q", "w", "e", "r", "o", "p"];
  function isField(t) { return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"); }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && placing) { setPlacing(placing); return; }
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
