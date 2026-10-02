// 실시간 조종: 실시간 화면(ROS 토픽) + 실제 조종(teleop) + 통신이 나쁠 때 지도와 보낸 키로 움직임 추정.
// 서버(ros/topic_relay.py · ros/mock_relay.py)가 토픽 이름·도메인을 정한다(ros/config.yaml). 화면은 /api/config 로 받아 쓴다.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var msgEl = $("lvMsg");
  if (!window.THREE || !window.TB3_MESHES || !window.createTB3Viewer || !window.TB3Map || !window.TB3Live) {
    msgEl.textContent = "3D 기체를 불러오지 못했습니다"; return;
  }
  var qs = new URLSearchParams(location.search);
  var BASE = (qs.get("server") || (/^https?:$/.test(location.protocol) && location.port === "8765" ? location.origin : "http://localhost:8765")).replace(/\/$/, "");
  $("srvUrl").textContent = BASE;

  // 서버 설정이 오기 전에 쓰는 값 (ros/settings.py DEFAULTS 와 같다)
  var CFG = {
    topics: { joint_states: "/joint_states", tf: "/tf", tf_static: "/tf_static", odom: "/odom", cmd_vel: "/cmd_vel", scan: "/scan",
              map: "/map", plan: "/plan", camera: "/camera/camera/color/image_raw" },
    predict: { linear_step: 0.01, linear_max: 0.26, angular_step: 0.1, angular_max: 1.8, arm_step: 0.05,
               gripper_open: 0.019, gripper_close: -0.010, fresh_sec: 0.5, lost_sec: 3.0 },
    teleop: {}, mock: false, loaded: false
  };
  var P = CFG.predict, ROLE = {};
  var LIM = [[-Math.PI * 175 / 180, Math.PI * 175 / 180], [-Math.PI * 0.57, Math.PI * 0.5], [-Math.PI * 0.3, Math.PI * 0.44], [-Math.PI * 0.57, Math.PI * 0.65]];
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

  var accent = getComputedStyle(document.documentElement).getPropertyValue("--robot-accent").trim() || "%ACCENT%";
  var viewer = createTB3Viewer(THREE, $("lvCanvas"), TB3_MESHES, {
    accent: accent, body: "#3A3F47", arm: "#D9DCE1", tire: "#222428", grip: "#9AA0A8",
    ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666, arena: false, floorGrid: false, maxDist: 30, external: true,
    // 기본 시점: 기체와 주변 지도를 함께. 화면 위쪽 = 지도 +y (지도 그림과 같은 방향), 기체 앞 0.5 m 를 본다
    viewYaw: Math.PI / 2 + 0.25, viewDist: 2.8, followPitch: 0.98, lookAhead: 0.5
  });
  msgEl.textContent = "서버에 연결하는 중";

  // ---------- 3D 층: 지도 · 바닥 격자 · LiDAR · 경로 · 마지막 수신 위치 ----------
  var world = viewer.world, mapGroup = null, MAXP = 4096;
  var grid = new THREE.GridHelper(10, 20, 0x4A5666, 0x2A3442); grid.rotation.x = Math.PI / 2; world.add(grid);
  function buffer() {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3)); g.setDrawRange(0, 0);
    return g;
  }
  var scanGeo = buffer(), planGeo = buffer();
  var scanPts = new THREE.Points(scanGeo, new THREE.PointsMaterial({ color: 0xFF4D4D, size: 0.035 }));
  var planLine = new THREE.Line(planGeo, new THREE.LineBasicMaterial({ color: 0x5FD08A }));
  scanPts.frustumCulled = planLine.frustumCulled = false; world.add(scanPts); world.add(planLine);
  function fill(geo, pts, z) {
    var a = geo.attributes.position.array, n = Math.min(pts.length / 2, MAXP);
    for (var i = 0; i < n; i++) { a[i * 3] = pts[i * 2]; a[i * 3 + 1] = pts[i * 2 + 1]; a[i * 3 + 2] = z; }
    geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, n);
  }
  // 추정 중에 보이는 '마지막으로 받은 실제 위치' 표시(노란 고리 + 화살표)
  var ghost = new THREE.Group(), gMat = new THREE.MeshBasicMaterial({ color: 0xF2B134, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  ghost.add(new THREE.Mesh(new THREE.RingGeometry(0.17, 0.205, 40), gMat));
  var tri = new THREE.Shape(); tri.moveTo(0.31, 0); tri.lineTo(0.21, 0.05); tri.lineTo(0.21, -0.05); tri.lineTo(0.31, 0);
  ghost.add(new THREE.Mesh(new THREE.ShapeGeometry(tri), gMat));
  ghost.position.z = 0.012; ghost.visible = false; world.add(ghost);
  function layers() {
    if (mapGroup) mapGroup.visible = $("lyMap").checked;
    grid.visible = !mapGroup;
    scanPts.visible = $("lyScan").checked; planLine.visible = $("lyPlan").checked;
  }
  ["lyMap", "lyScan", "lyPlan"].forEach(function (id) { $(id).addEventListener("change", layers); });

  // ---------- 지도: 받은 /map 또는 올린 파일(올린 것이 우선) ----------
  var recvMap = null, upMap = null, activeMap = null, mapKey = "";
  function useMap() {
    var m = upMap || recvMap;
    if (m === activeMap) return;
    activeMap = m;
    if (mapGroup) { world.remove(mapGroup); mapGroup.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); mapGroup = null; }
    if (m) { mapGroup = TB3Map.build3D(THREE, m, { wallHeight: 0.15 }); mapGroup.position.z = -0.002; world.add(mapGroup); }
    layers();
    $("mapChip").textContent = upMap ? "올린 파일" : recvMap ? "/map 수신" : "없음";
    $("btnMapClear").hidden = !upMap;
    var info = $("mapInfo"); info.className = "map-info";
    info.textContent = m ? m.name + " · " + m.width + " × " + m.height + " 칸, " + m.res + " m, 원점 (" +
      m.origin.map(function (v) { return +v.toFixed(2); }).join(", ") + ")" + (upMap && recvMap ? " · /map 도 받고 있지만 올린 지도를 써요" : "")
      : "/map 을 기다리는 중. 통신이 나쁘면 로봇의 map.yaml 과 map.pgm 을 올리세요.";
    if (!est.init) initEstimate();
  }
  function loadFiles(files) {
    if (!files || !files.length) return;
    $("mapInfo").textContent = "지도를 읽는 중…";
    TB3Map.fromFiles(files).then(function (m) { upMap = m; useMap(); })
      .catch(function (e) { var i = $("mapInfo"); i.className = "map-info error"; i.textContent = e.message; });
  }
  $("mapFiles").addEventListener("change", function (e) { loadFiles(e.target.files); e.target.value = ""; });
  var dz = $("dropzone");
  ["dragenter", "dragover"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { dz.addEventListener(t, function () { dz.classList.remove("over"); }); });
  dz.addEventListener("drop", function (e) { e.preventDefault(); loadFiles(e.dataTransfer.files); });
  $("btnMapClear").addEventListener("click", function () { upMap = null; useMap(); });

  // ---------- 실제 값(받은 것)과 화면 값(추정 포함) ----------
  var tf = TB3Live.TFBuffer(), fixed = "map";
  var real = { pose: null, poseT: 0, joints: null, grip: null, wheels: null, jointsT: 0, twist: null, twistT: 0, cmd: null, cmdT: 0 };
  var est = { init: false, x: 0, y: 0, yaw: 0, v: 0, w: 0, joints: [0, -1.05, 0.35, 0.70], grip: 0.01, gripTarget: null, wheels: [0, 0] };
  var cmd = { v: 0, w: 0 };                 // 로봇 teleop 안의 속도 명령(키로 따라 계산, /cmd_vel 이 오면 그 값)
  var pend = [0, 0, 0, 0], lastArmKey = 0;  // 키로 넣었지만 아직 실제 관절에 안 보인 변화
  var armStep = P.arm_step, calibN = 0, calib = [0, 1, 2, 3].map(function () { return { keys: 0, base: null, last: 0 }; });
  var probe = null, latency = null;         // 키 → /cmd_vel 반영 시간
  var mode = "wait";                        // wait | live | stale | lost | practice

  function initEstimate() {
    var start = { x: 0, y: 0 };
    if (activeMap) { var c = activeMap.nearestFree(0.064, 0, 0.2); if (c) start = c; }
    est.x = start.x; est.y = start.y; est.yaw = 0; est.init = true;
  }
  function poseOf(frame) { var fx = tf.fixedFor(frame); fixed = fx; return tf.lookup(frame, fx); }
  function toFixed(pts, frame) {
    var f = (frame || "").replace(/^\//, "");
    if (!f || f === fixed) return pts;
    var p = tf.lookup(f, fixed);
    if (!p) return pts;
    var c = Math.cos(p.yaw), s = Math.sin(p.yaw), out = [];
    for (var i = 0; i < pts.length; i += 2) out.push(p.x + c * pts[i] - s * pts[i + 1], p.y + s * pts[i] + c * pts[i + 1]);
    return out;
  }

  var HANDLERS = {
    tf: function (m) {
      tf.update(m);
      var p = poseOf("base_footprint") || poseOf("base_link");
      if (p) { real.pose = p; real.poseT = performance.now(); }
    },
    tf_static: function (m) { tf.update(m); },
    joint_states: function (m) {
      var j = TB3Live.jointState(m), now = performance.now();
      if (real.joints) j.joints.forEach(function (q, n) {           // 실제로 움직인 만큼 '아직 안 보인 변화'를 줄인다
        if (q === null || real.joints[n] === null) return;
        var d = q - real.joints[n];
        if (pend[n] && Math.sign(d) === Math.sign(pend[n])) pend[n] -= Math.sign(pend[n]) * Math.min(Math.abs(pend[n]), Math.abs(d));
      });
      real.joints = j.joints; real.grip = j.grip; real.wheels = j.wheels; real.jointsT = now;
    },
    odom: function (m) {
      real.twist = { v: m.twist.twist.linear.x, w: m.twist.twist.angular.z }; real.twistT = performance.now();
      if (!real.pose && !tf.has("base_footprint")) {                // TF 가 없으면 odom 자세라도
        var p = m.pose.pose; real.pose = { x: p.position.x, y: p.position.y, yaw: TB3Live.yawOf(p.orientation) }; real.poseT = real.twistT; fixed = "odom";
      }
    },
    cmd_vel: function (m) {
      var now = performance.now();
      real.cmd = { v: m.linear.x, w: m.angular.z }; real.cmdT = now;
      if (probe && Math.abs(real.cmd.v - probe.v) < 1e-4 && Math.abs(real.cmd.w - probe.w) < 1e-4) { latency = now - probe.t; probe = null; }
    },
    scan: function (m) { var lp = poseOf(m.header.frame_id); if (lp) fill(scanGeo, TB3Live.scanPoints(m, lp), 0.13); },
    map: function (m) {
      var key = TB3Live.gridKey(m);
      if (key === mapKey) return;
      recvMap = TB3Live.gridToMap(m, CFG.topics.map); mapKey = key; useMap();
    },
    plan: function (m) { fill(planGeo, toFixed(TB3Live.pathPoints(m), m.header.frame_id), 0.015); }
  };
  var last = {}, recvTimes = {};
  function onMessage(d) {
    var now = performance.now();
    (recvTimes[d.topic] = recvTimes[d.topic] || []).push(now);
    if (recvTimes[d.topic].length > 60) recvTimes[d.topic].shift();
    last[d.topic] = { at: now, d: d };
    if (d.error || !d.msg) return;
    var h = HANDLERS[ROLE[d.topic]];
    if (h) { try { h(d.msg); } catch (e) { console.warn(d.topic, e); } }
  }
  function hzOf(t) {
    var ts = recvTimes[t];
    if (!ts || ts.length < 3 || performance.now() - ts[ts.length - 1] > 3000) return 0;
    return (ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000);
  }

  // ---------- 매 프레임: 실제 값이 새로우면 그대로, 아니면 추정 ----------
  var lastStep = performance.now();
  function step() {
    var now = performance.now(), dt = Math.min((now - lastStep) / 1000, 0.1); lastStep = now;
    var fresh = P.fresh_sec * 1000, lost = P.lost_sec * 1000;
    var poseAge = real.pose ? now - real.poseT : Infinity, jAge = real.joints ? now - real.jointsT : Infinity;
    if (real.cmd && now - real.cmdT < fresh) { cmd.v = real.cmd.v; cmd.w = real.cmd.w; }
    if (!est.init && (real.pose || CFG.loaded)) { if (real.pose) { est.x = real.pose.x; est.y = real.pose.y; est.yaw = real.pose.yaw; est.init = true; } else initEstimate(); }

    // 위치
    if (poseAge < fresh) {
      est.x = real.pose.x; est.y = real.pose.y; est.yaw = real.pose.yaw;
      var tw = real.twist && now - real.twistT < fresh ? real.twist : cmd;
      est.v = tw.v; est.w = tw.w;
      mode = "live";
    } else {
      // 받은 마지막 위치에서 teleop 명령 속도로 이어 간다(가속 제한). 지도 벽에 막히면 멈춘다.
      est.v += clamp(cmd.v - est.v, -2.5 * dt, 2.5 * dt);
      est.w += clamp(cmd.w - est.w, -3.2 * dt, 3.2 * dt);
      var yaw = wrap(est.yaw + est.w * dt), nx = est.x + Math.cos(yaw) * est.v * dt, ny = est.y + Math.sin(yaw) * est.v * dt;
      if (activeMap && est.v && !activeMap.circleFree(nx - 0.064 * Math.cos(yaw), ny - 0.064 * Math.sin(yaw), 0.18)) { est.v = 0; }
      else { est.x = nx; est.y = ny; }
      est.yaw = yaw;
      mode = !real.pose ? (sse === "open" ? "wait" : "practice") : poseAge < lost && sse === "open" ? "stale" : "lost";
      if (!real.pose && teleop.state !== "connected" && sse !== "open") mode = "practice";
    }

    // 팔: 받은 값 + 아직 안 보인 키 변화. 새 값이 계속 오는데도 1초 동안 안 따라오면 키 변화를 버린다(로봇이 안 움직인 것)
    var armBase = real.joints && jAge < lost ? real.joints : est.joints.map(function (q, n) { return q - pend[n]; });
    if (jAge < fresh && now - lastArmKey > 1000) pend = pend.map(function (p) { return p * Math.exp(-dt * 4); });
    est.joints = armBase.map(function (q, n) { return q === null ? est.joints[n] : clamp(q + pend[n], LIM[n][0], LIM[n][1]); });
    if (jAge < fresh && real.grip !== null) { est.grip = real.grip; est.gripTarget = null; }
    else if (est.gripTarget !== null) est.grip += clamp(est.gripTarget - est.grip, -0.03 * dt, 0.03 * dt);
    if (jAge < fresh && real.wheels) est.wheels = real.wheels.slice();
    else { est.wheels[0] += (est.v - est.w * 0.1435) / 0.033 * dt; est.wheels[1] += (est.v + est.w * 0.1435) / 0.033 * dt; }

    // 팔 한 칸 자동 보정: 키를 멈춘 뒤 0.7초, 실제로 움직인 양 ÷ 누른 횟수
    calib.forEach(function (c, n) {
      if (!c.keys || now - c.last < 700) return;
      if (c.base !== null && real.joints && jAge < fresh && real.joints[n] !== null) {
        var moved = Math.abs(real.joints[n] - c.base) / c.keys;
        if (moved > 0.003 && moved < 0.5) { armStep = armStep * 0.6 + moved * 0.4; calibN++; }
      }
      c.keys = 0; c.base = null;
    });

    viewer.setState({ x: est.x, y: est.y, yaw: est.yaw, v: est.v, w: est.w, joints: est.joints, grip: est.grip, wheels: est.wheels });
    var showGhost = (mode === "stale" || mode === "lost") && real.pose;
    ghost.visible = !!showGhost;
    if (showGhost) { ghost.position.x = real.pose.x; ghost.position.y = real.pose.y; ghost.rotation.z = real.pose.yaw; }
    msgEl.hidden = est.init;
  }
  setInterval(step, 33);

  // ---------- 서버 연결 (설정 → 구독) ----------
  var conn = null, sse = "closed", wanted = [];
  function loadConfig() {
    fetch(BASE + "/api/config", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (c) {
      CFG.topics = c.topics; CFG.predict = P = c.predict; CFG.teleop = c.teleop || {}; CFG.mock = !!c.mock; CFG.loaded = true;
      armStep = P.arm_step;
      ROLE = {}; Object.keys(c.topics).forEach(function (r) { if (c.topics[r]) ROLE[c.topics[r]] = r; });
      $("srvChip").textContent = c.mock ? "모의 서버" : "ROS 도메인 " + c.ros_domain_id;
      var t = CFG.teleop, tgt = $("ctrlTarget");
      tgt.innerHTML = "<dt>로봇</dt><dd></dd>";
      tgt.children[1].textContent = c.mock ? "모의 기체 (ssh 없음)" : (t.username || "?") + "@" + (t.host || "?") + ":" + (t.port || 22);
      tgt.title = "teleop 명령: " + (t.command || "(비어 있음)");
      $("cmdText").textContent = t.command || "(비어 있음)";
      $("btnCtrl").disabled = false;
      wanted = Object.keys(c.topics).filter(function (r) { return r !== "camera" && c.topics[r]; }).map(function (r) { return c.topics[r]; });
      connect();
    }).catch(function () {
      $("srvChip").textContent = "서버 없음";
      msgEl.textContent = "서버(" + BASE + ")에 연결하지 못했어요. 지도를 올리면 키로 연습할 수 있어요";
      if (!est.init) initEstimate();
      setTimeout(loadConfig, 3000);
    });
  }
  function connect() {
    if (conn) conn.close();
    conn = TB3Live.connect(BASE, wanted, {
      message: onMessage,
      status: function (s) { sse = s; },
      teleop: setTeleop
    });
    refreshTopics();
  }
  function addTopic(t) { if (wanted.indexOf(t) < 0) { wanted.push(t); connect(); } }

  // ---------- 조종 연결 (ssh teleop) ----------
  var teleop = { state: "disconnected", label: null };
  var ERR = { already_connecting_or_connected: "이미 연결 중이에요", teleop_unavailable: "이 서버는 조종을 지원하지 않아요" };
  function setTeleop(st) {
    var prev = teleop.state;
    teleop = st;
    var s = $("ctrlStatus");
    s.className = "lv-status" + (st.state === "disconnected" && (st.reason || st.dropped) ? " error" : "");
    s.textContent = st.state === "connected" ? "조종 중 · 키가 로봇 teleop 으로 가요" : st.state === "connecting" ? "연결 중…" :
      st.dropped ? "연결이 끊겼어요" : st.label ? "연결 실패: " + st.label : "연결 안 됨";
    $("btnCtrl").textContent = st.state === "disconnected" ? "조종 시작" : "조종 끊기";
    $("keyMode").textContent = st.state === "connected" ? "로봇으로 보냄" : "로봇에 안 보냄";
    if (st.state === "connected" && prev !== "connected") { cmd.v = cmd.w = 0; }
  }
  function post(path, body) {
    return fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }
  $("btnCtrl").addEventListener("click", function () {
    if (teleop.state !== "disconnected") { post("/api/teleop/disconnect"); return; }
    setTeleop({ state: "connecting" });
    post("/api/teleop/connect", {})                            // 접속 정보는 서버 config.yaml
      .then(function (r) {
        if (!r.body.ok) setTeleop({ state: "disconnected", reason: r.body.reason || "other", label: r.body.label || ERR[r.body.error] || r.body.error });
      })
      .catch(function () { setTeleop({ state: "disconnected", reason: "other", label: "서버에 닿지 않음" }); });
  });
  // 창을 닫으면 정지(space)를 보낸다. 서버도 보는 화면이 없으면 멈춘다.
  window.addEventListener("pagehide", function () {
    if (teleop.state === "connected" && navigator.sendBeacon) navigator.sendBeacon(BASE + "/api/teleop/key", JSON.stringify({ key: " " }));
  });

  // ---------- 키 ----------
  var KEYS = ["i", "j", "k", "l", " ", "1", "2", "3", "4", "q", "w", "e", "r", "o", "p"];
  var cells = {};
  document.querySelectorAll("#lvKeys [data-key]").forEach(function (b) { cells[b.dataset.key] = b; });
  function applyLocal(k) {
    var now = performance.now();
    if (k === "i") cmd.v = Math.min(cmd.v + P.linear_step, P.linear_max);
    else if (k === "k") cmd.v = Math.max(cmd.v - P.linear_step, -P.linear_max);
    else if (k === "j") cmd.w = Math.min(cmd.w + P.angular_step, P.angular_max);
    else if (k === "l") cmd.w = Math.max(cmd.w - P.angular_step, -P.angular_max);
    else if (k === " ") { cmd.v = 0; cmd.w = 0; }
    else if (k === "o") est.gripTarget = P.gripper_open;
    else if (k === "p") est.gripTarget = P.gripper_close;
    else {
      var n = "1234".indexOf(k), dir = 1;
      if (n < 0) { n = "qwer".indexOf(k); dir = -1; }
      pend[n] += dir * armStep; lastArmKey = now;
      var c = calib[n];
      if (!c.keys) c.base = real.joints && now - real.jointsT < P.fresh_sec * 1000 ? real.joints[n] : null;
      c.keys++; c.last = now;
      return;
    }
    if ("ijkl ".indexOf(k) >= 0 && teleop.state === "connected") probe = { t: now, v: cmd.v, w: cmd.w };
  }
  function press(k, repeat) {
    if (cells[k]) cells[k].classList.add("on");
    if (!repeat) viewer.press(k);
    applyLocal(k);
    if (teleop.state === "connected") post("/api/teleop/key", { key: k }).catch(function () {});
  }
  function release(k) { if (cells[k]) cells[k].classList.remove("on"); viewer.release(k); }
  function isField(t) { return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"); }
  document.addEventListener("keydown", function (e) {
    if (isField(e.target) || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS.indexOf(k) < 0) return;
    e.preventDefault();
    press(k, e.repeat);      // 누르고 있으면 반복해서 보낸다(터미널 teleop 과 같은 동작)
  });
  document.addEventListener("keyup", function (e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (KEYS.indexOf(k) >= 0) release(k); });
  window.addEventListener("blur", function () { KEYS.forEach(release); });
  Object.keys(cells).forEach(function (k) {
    var b = cells[k];
    b.addEventListener("click", function (e) { e.preventDefault(); press(k, false); setTimeout(function () { release(k); }, 150); });
  });

  // ---------- 표시 (4 Hz) ----------
  var DEG = 180 / Math.PI;
  function cell(k, v, isEst) { return "<div" + (isEst ? ' class="est"' : "") + "><dt>" + k + "</dt><dd>" + v + "</dd></div>"; }
  function ageText(ms) { return ms === Infinity ? "—" : ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(1) + " 초"; }
  var LINK = [["tf", "위치 (TF)"], ["joint_states", "팔 · 바퀴"], ["odom", "속도"], ["cmd_vel", "조종 명령"], ["scan", "LiDAR"], ["map", "지도"]];
  function badge(el, tone, text) { el.dataset.tone = tone; el.textContent = text; }
  setInterval(function () {
    var now = performance.now(), fresh = P.fresh_sec * 1000, lost = P.lost_sec * 1000;
    var poseAge = real.pose ? now - real.poseT : Infinity, jAge = real.joints ? now - real.jointsT : Infinity;
    var estPose = mode !== "live", estArm = jAge >= fresh;
    // 상태 배지
    var mb = $("modeBadge");
    if (mode === "live") badge(mb, "good", "실시간 · " + ageText(poseAge) + " 전 수신");
    else if (mode === "stale") badge(mb, "warn", "추정 중 · 마지막 수신 " + ageText(poseAge) + " 전");
    else if (mode === "lost") badge(mb, "bad", "추정 중 · 신호 끊김 " + ageText(poseAge));
    else if (mode === "practice") badge(mb, "off", "서버 없음 · 키로 연습");
    else badge(mb, sse === "open" ? "warn" : "off", sse === "open" ? "토픽 기다리는 중" : "서버 연결 중");
    var cb = $("ctrlBadge");
    if (teleop.state === "connected") badge(cb, "good", "조종 중" + (CFG.mock ? " (모의)" : ""));
    else if (teleop.state === "connecting") badge(cb, "warn", "조종 연결 중");
    else badge(cb, "off", "조종 안 함");
    var moving = Math.abs(cmd.v) > 1e-6 || Math.abs(cmd.w) > 1e-6, warn = $("lvWarn");
    warn.hidden = !(teleop.state === "connected" && moving && (mode === "lost" || sse !== "open"));
    if (!warn.hidden) warn.textContent = "통신이 끊겼어요. 로봇은 마지막 속도 명령(" + cmd.v.toFixed(2) + " m/s, " + cmd.w.toFixed(1) + " rad/s)으로 계속 움직이고 있을 수 있어요. space 로 멈추세요.";
    // 읽기 값
    $("lvReadout").innerHTML =
      cell("프레임", fixed) + cell("x", est.x.toFixed(2) + " m", estPose) + cell("y", est.y.toFixed(2) + " m", estPose) +
      cell("yaw", (est.yaw * DEG).toFixed(0) + "°", estPose) + cell("v", est.v.toFixed(2) + " m/s", estPose) + cell("ω", est.w.toFixed(2) + " rad/s", estPose) +
      cell("명령 v", cmd.v.toFixed(2) + " m/s") + cell("명령 ω", cmd.w.toFixed(1) + " rad/s") +
      est.joints.map(function (q, n) { return cell("joint" + (n + 1), (q * DEG).toFixed(1) + "°", estArm || Math.abs(pend[n]) > 0.002); }).join("") +
      cell("gripper", (est.grip * 1000).toFixed(1) + " mm", estArm);
    // 통신 상태 표
    $("linkBody").innerHTML = LINK.map(function (r) {
      var t = CFG.topics[r[0]], l = last[t], age = l ? now - l.at : Infinity, hz = hzOf(t);
      var cls = r[0] === "map" ? (l ? "good" : "warn") : age < fresh ? "good" : age < lost ? "warn" : "bad";
      return "<tr><th scope=\"row\">" + r[1] + "</th><td class=\"" + cls + "\">" + (l ? ageText(age) + " 전" : "아직 없음") + "</td><td>" + (hz ? hz.toFixed(1) + " Hz" : "—") + "</td></tr>";
    }).join("");
    var q = sse !== "open" ? ["bad", "서버 끊김"] : poseAge < fresh && jAge < fresh ? ["good", "좋음"] : poseAge < lost ? ["warn", "느림"] : ["bad", "나쁨"];
    $("linkChip").textContent = q[1];
    $("linkKv").innerHTML = "<dt>명령 반영</dt><dd>" + (latency === null ? "키를 보내면 재요" : Math.round(latency) + " ms (키 → /cmd_vel)") + "</dd>" +
      "<dt>팔 한 칸</dt><dd>" + armStep.toFixed(3) + " rad " + (calibN ? "(실제 값으로 " + calibN + "번 보정)" : "(설정값)") + "</dd>" +
      "<dt>추정 기준</dt><dd>" + (upMap ? "올린 지도" : recvMap ? "/map" : "지도 없음 (벽 무시)") + "</dd>";
    // 토픽 표
    Object.keys(rows).forEach(function (n) {
      var l = last[n], hz = hzOf(n);
      rows[n].br.textContent = !l ? "—" : hz > 0 ? hz.toFixed(1) + " Hz" : ((now - l.at) / 1000).toFixed(0) + "초 전";
    });
    drawRaw();
  }, 250);

  // ---------- 토픽 목록 · raw 보기 ----------
  var tbody = $("topicBody"), rows = {}, rawTopic = null, graph = [];
  function refreshTopics() {
    TB3Live.listTopics(BASE).then(function (list) {
      graph = list;
      $("topicChip").textContent = list.length + "개";
      $("topicEmpty").hidden = list.length > 0;
      var keep = {};
      list.forEach(function (t) {
        keep[t.name] = true;
        var r = rows[t.name];
        if (!r) {
          var tr = document.createElement("tr"), th = document.createElement("th"), ty = document.createElement("td"),
              hz = document.createElement("td"), br = document.createElement("td"), tb = document.createElement("td"), b = document.createElement("button");
          th.scope = "row"; th.textContent = t.name; ty.innerHTML = "<code></code>"; ty.firstChild.textContent = t.type;
          b.type = "button"; b.className = "raw"; b.textContent = t.image ? "영상" : "raw 보기";
          b.setAttribute("aria-label", t.name + (t.image ? " 영상 보기" : " raw 메시지 보기"));
          b.addEventListener("click", function () { if (t.image) pickCam(t.name); else showRaw(t.name); });
          tb.appendChild(b); tr.append(th, ty, hz, br, tb); tbody.appendChild(tr);
          r = rows[t.name] = { tr: tr, hz: hz, br: br };
        }
        r.hz.textContent = !t.subscribed ? "구독 안 함" : t.hz > 0 ? t.hz.toFixed(1) + " Hz" : "가끔 옴";
        r.tr.classList.toggle("on", !!t.subscribed);
      });
      Object.keys(rows).forEach(function (n) { if (!keep[n]) { rows[n].tr.remove(); delete rows[n]; } });
      syncCamTopics();
    }).catch(function () {});
  }
  setInterval(function () { if (CFG.loaded) refreshTopics(); }, 2000);
  function shorten(v) {
    if (Array.isArray(v)) {
      var head = v.slice(0, 24).map(shorten);
      if (v.length > 24) head.push("… 총 " + v.length + "개");
      return head;
    }
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = shorten(v[k]); }); return o; }
    return typeof v === "number" && !Number.isInteger(v) ? +v.toFixed(5) : v;
  }
  function showRaw(topic) {
    rawTopic = topic; addTopic(topic);
    Object.keys(rows).forEach(function (n) { rows[n].tr.classList.toggle("sel", n === topic); });
    $("rawBox").hidden = false; $("rawTitle").textContent = topic;
    drawRaw();
  }
  function drawRaw() {
    if (!rawTopic) return;
    var l = last[rawTopic];
    $("rawMeta").textContent = l ? l.d.type + " · " + hzOf(rawTopic).toFixed(1) + " Hz · " + ((performance.now() - l.at) / 1000).toFixed(1) + " 초 전" : "메시지를 기다리는 중";
    if (l) $("rawPre").textContent = JSON.stringify(l.d.error ? { error: l.d.error } : shorten(l.d.msg), null, 2);
  }

  // ---------- 카메라 (켤 때만 받는다) ----------
  var camSel = $("camTopic"), camBtn = $("btnCam"), camImg = $("camImg"), camMsg = $("camMsg"), camOn = false;
  function syncCamTopics() {
    var imgs = graph.filter(function (t) { return t.image; }).map(function (t) { return t.name; });
    var have = Array.prototype.map.call(camSel.options, function (o) { return o.value; }).join(",");
    if (have === imgs.join(",")) return;
    var cur = camSel.value;
    camSel.textContent = "";
    if (!imgs.length) camSel.innerHTML = '<option value="">영상 토픽 없음</option>';
    imgs.forEach(function (n) { var o = document.createElement("option"); o.value = o.textContent = n; camSel.appendChild(o); });
    camSel.value = imgs.indexOf(cur) >= 0 ? cur : imgs.indexOf(CFG.topics.camera) >= 0 ? CFG.topics.camera : imgs[0] || "";
    camSel.disabled = camBtn.disabled = !imgs.length;
  }
  function startCam() {
    if (!camSel.value) return;
    camOn = true; camBtn.setAttribute("aria-pressed", "true"); camBtn.textContent = "끄기";
    camMsg.textContent = "영상을 기다리는 중"; camMsg.hidden = false;
    camImg.onload = function () { camImg.hidden = false; camMsg.hidden = true; };
    camImg.onerror = function () { camImg.hidden = true; camMsg.hidden = false; camMsg.textContent = "영상을 받지 못했어요 (JPEG 으로 바꿀 수 없는 형식이거나 토픽이 없어요)"; };
    camImg.src = TB3Live.imageUrl(BASE, camSel.value);
  }
  function stopCam() {
    camOn = false; camBtn.setAttribute("aria-pressed", "false"); camBtn.textContent = "켜기";
    camImg.removeAttribute("src"); camImg.hidden = true; camMsg.hidden = false; camMsg.textContent = "영상은 켤 때만 받아요 (로봇 부하를 줄이려고)";
  }
  function pickCam(n) { camSel.value = n; startCam(); $("t-cam").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  camBtn.addEventListener("click", function () { if (camOn) stopCam(); else startCam(); });
  camSel.addEventListener("change", function () { if (camOn) startCam(); });

  // ---------- 한 화면 맞춤: 3D 와 카메라 높이를 남은 화면 높이에 맞춘다(머리 높이가 스타일마다 달라서) ----------
  var stageEl = $("lvStage"), keyCard = document.querySelector(".lv-keycard"), camEl = $("lvCam"), stateCard = document.querySelector(".lv-statecard");
  function fit() {
    if (innerWidth < 1100) { stageEl.style.height = ""; camEl.style.height = ""; return; }
    var y0 = window.scrollY, pad = 12;
    var stTop = stageEl.getBoundingClientRect().top + y0;
    stageEl.style.height = clamp(innerHeight - stTop - (keyCard.offsetHeight + 10 + 8) - pad, 260, 760) + "px";
    var camTop = camEl.getBoundingClientRect().top + y0;
    camEl.style.height = clamp(innerHeight - camTop - (stateCard.offsetHeight + 10 + 12) - pad, 150, 520) + "px";
  }
  window.addEventListener("resize", fit);
  fit(); setTimeout(fit, 300); setTimeout(fit, 1500);

  useMap();
  loadConfig();
})();
