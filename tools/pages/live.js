// 실시간 로봇: 중계 서버(ros/topic_relay.py)에서 받은 raw 토픽으로 3D 기체·지도·LiDAR·경로를 그린다. 구독 전용.
(function () {
  var BASE_TOPICS = ["/tf", "/tf_static", "/joint_states", "/odom", "/scan", "/map", "/plan"];
  var $ = function (id) { return document.getElementById(id); };
  var msgEl = $("lvMsg"), statusEl = $("lvStatus"), badge = $("lvBadge");
  if (!window.THREE || !window.TB3_MESHES || !window.createTB3Viewer || !window.TB3Map || !window.TB3Live) {
    msgEl.textContent = "3D 기체를 불러오지 못했습니다"; return;
  }
  var accent = getComputedStyle(document.documentElement).getPropertyValue("--robot-accent").trim() || "%ACCENT%";
  var viewer = createTB3Viewer(THREE, $("lvCanvas"), TB3_MESHES, {
    accent: accent, body: "#3A3F47", arm: "#D9DCE1", tire: "#222428", grip: "#9AA0A8",
    ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666, arena: false, floorGrid: false, maxDist: 30, external: true
  });
  msgEl.textContent = "중계 서버에 연결하면 로봇을 그려요";

  // ---------- 3D 층: 지도 · LiDAR 점 · 경로 ----------
  var world = viewer.world, mapGroup = null, mapKey = "";
  var MAXP = 4096;
  var scanGeo = new THREE.BufferGeometry();
  scanGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
  scanGeo.setDrawRange(0, 0);
  var scanPts = new THREE.Points(scanGeo, new THREE.PointsMaterial({ color: 0xFF4D4D, size: 0.035 }));
  scanPts.frustumCulled = false; world.add(scanPts);
  var planGeo = new THREE.BufferGeometry();
  planGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
  planGeo.setDrawRange(0, 0);
  var planLine = new THREE.Line(planGeo, new THREE.LineBasicMaterial({ color: 0x5FD08A }));
  planLine.frustumCulled = false; world.add(planLine);
  function fill(geo, pts, z) {
    var a = geo.attributes.position.array, n = Math.min(pts.length / 2, MAXP);
    for (var i = 0; i < n; i++) { a[i * 3] = pts[i * 2]; a[i * 3 + 1] = pts[i * 2 + 1]; a[i * 3 + 2] = z; }
    geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, n);
  }
  function layers() {
    if (mapGroup) mapGroup.visible = $("lyMap").checked;
    scanPts.visible = $("lyScan").checked; planLine.visible = $("lyPlan").checked;
  }
  ["lyMap", "lyScan", "lyPlan"].forEach(function (id) { $(id).addEventListener("change", layers); });

  // ---------- 받은 메시지 처리 ----------
  var tf = TB3Live.TFBuffer(), fixed = "map", last = {}, recvTimes = {}, odom = null, twist = { v: 0, w: 0 };
  var seen = { pose: false, joints: false };
  function poseOf(frame) {
    var fx = tf.fixedFor(frame);
    fixed = fx;
    return tf.lookup(frame, fx);
  }
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
    "/tf": function (m) { tf.update(m); },
    "/tf_static": function (m) { tf.update(m); },
    "/joint_states": function (m) { var j = TB3Live.jointState(m); viewer.setState(j); seen.joints = true; },
    "/odom": function (m) {
      var p = m.pose.pose;
      odom = { x: p.position.x, y: p.position.y, yaw: TB3Live.yawOf(p.orientation) };
      twist = { v: m.twist.twist.linear.x, w: m.twist.twist.angular.z };
    },
    "/scan": function (m) {
      var lp = poseOf(m.header.frame_id);
      if (lp) fill(scanGeo, TB3Live.scanPoints(m, lp), 0.13);
    },
    "/map": function (m) {
      var key = TB3Live.gridKey(m);
      if (key === mapKey) return;
      var map = TB3Live.gridToMap(m, "/map");
      mapKey = key;
      if (mapGroup) { world.remove(mapGroup); mapGroup.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
      mapGroup = TB3Map.build3D(THREE, map, { wallHeight: 0.15 });
      mapGroup.position.z = -0.002;
      world.add(mapGroup); layers();
    },
    "/plan": function (m) { fill(planGeo, toFixed(TB3Live.pathPoints(m), m.header.frame_id), 0.015); }
  };
  function onMessage(d) {
    var now = performance.now();
    (recvTimes[d.topic] = recvTimes[d.topic] || []).push(now);
    if (recvTimes[d.topic].length > 60) recvTimes[d.topic].shift();
    last[d.topic] = { at: now, d: d };
    if (d.error || !d.msg) return;
    var h = HANDLERS[d.topic];
    if (h) { try { h(d.msg); } catch (e) { console.warn(d.topic, e); } }
  }

  // 로봇 자세는 매 프레임 TF 에서 다시 계산한다(map→odom 과 odom→base_footprint 가 따로 오기 때문)
  setInterval(function () {
    var p = poseOf("base_footprint") || poseOf("base_link");
    if (!p && odom) { p = odom; fixed = "odom"; }
    if (p) { viewer.setState({ x: p.x, y: p.y, yaw: p.yaw, v: twist.v, w: twist.w }); seen.pose = true; }
    msgEl.hidden = seen.pose || seen.joints;
  }, 33);

  // ---------- 연결 ----------
  var conn = null, wanted = BASE_TOPICS.slice(), state = "closed";
  var urlInput = $("relayUrl");
  urlInput.value = /^https?:$/.test(location.protocol) && location.port === "8765" ? location.origin : "http://localhost:8765";
  function base() { return urlInput.value.trim().replace(/\/$/, ""); }
  function setState(s) {
    state = s;
    $("btnConn").textContent = conn ? "끊기" : "연결";
    var label = { open: "연결됨", retry: "다시 연결하는 중", closed: "연결 안 됨", stale: "수신 끊김" }[s];
    badge.dataset.state = s; badge.textContent = label;
  }
  function connect() {
    if (conn) conn.close();
    statusEl.className = "lv-status";
    conn = TB3Live.connect(base(), wanted, { message: onMessage, status: setState });
    setState("retry");
    refreshTopics();
  }
  function disconnect() {
    if (conn) { var c = conn; conn = null; c.close(); }
    stopCam(); setState("closed");
  }
  $("connForm").addEventListener("submit", function (e) { e.preventDefault(); if (conn) disconnect(); else connect(); });

  // ---------- 토픽 목록 ----------
  var tbody = $("topicBody"), rows = {}, rawTopic = null, graph = [];
  function hzOf(t) {
    var ts = recvTimes[t];
    if (!ts || ts.length < 3 || performance.now() - ts[ts.length - 1] > 3000) return 0;
    return (ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000);
  }
  function refreshTopics() {
    if (!conn) return;
    TB3Live.listTopics(base()).then(function (list) {
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
          b.addEventListener("click", function () { t.image ? pickCam(t.name) : showRaw(t.name); });
          tb.appendChild(b); tr.append(th, ty, hz, br, tb); tbody.appendChild(tr);
          r = rows[t.name] = { tr: tr, hz: hz, br: br };
        }
        r.hz.textContent = !t.subscribed ? "구독 안 함" : t.hz > 0 ? t.hz.toFixed(1) + " Hz" : "가끔 옴";   // /map, /tf_static 처럼 한 번만 오는 토픽
        r.tr.classList.toggle("on", !!t.subscribed);
      });
      Object.keys(rows).forEach(function (n) { if (!keep[n]) { rows[n].tr.remove(); delete rows[n]; } });
      syncCamTopics();
    }).catch(function (e) {
      statusEl.className = "lv-status error";
      statusEl.textContent = base() + " 에 연결하지 못했어요 (" + e.message + "). 중계 서버가 켜져 있는지 확인하세요.";
    });
  }
  setInterval(refreshTopics, 2000);

  // ---------- raw 보기 ----------
  function shorten(v, depth) {          // 긴 배열은 앞부분만 (전체 길이 표시)
    if (Array.isArray(v)) {
      var head = v.slice(0, 24).map(function (x) { return shorten(x, depth + 1); });
      if (v.length > 24) head.push("… 총 " + v.length + "개");
      return head;
    }
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = shorten(v[k], depth + 1); }); return o; }
    return typeof v === "number" && !Number.isInteger(v) ? +v.toFixed(5) : v;
  }
  function showRaw(topic) {
    rawTopic = topic;
    if (wanted.indexOf(topic) < 0) { wanted.push(topic); if (conn) connect(); }   // 새 토픽은 구독 목록에 넣고 다시 연결
    Object.keys(rows).forEach(function (n) { rows[n].tr.classList.toggle("sel", n === topic); });
    $("rawBox").hidden = false; $("rawTitle").textContent = topic;
    drawRaw();
  }
  function drawRaw() {
    if (!rawTopic) return;
    var l = last[rawTopic];
    $("rawMeta").textContent = l ? l.d.type + " · " + hzOf(rawTopic).toFixed(1) + " Hz · " + ((performance.now() - l.at) / 1000).toFixed(1) + " 초 전" : "메시지를 기다리는 중";
    if (l) $("rawPre").textContent = JSON.stringify(l.d.error ? { error: l.d.error } : shorten(l.d.msg, 0), null, 2);
  }

  // ---------- 상태 표시 (4 Hz) ----------
  var DEG = 180 / Math.PI;
  function cell(k, v) { return "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>"; }
  setInterval(function () {
    var r = viewer.readout(), now = performance.now(), newest = 0;
    Object.keys(last).forEach(function (t) { newest = Math.max(newest, last[t].at); });
    if (conn && state === "open" && newest && now - newest > 3000) setState("stale");
    else if (conn && state === "stale" && now - newest < 3000) setState("open");
    $("lvReadout").innerHTML =
      cell("프레임", fixed) + cell("x", r.x.toFixed(2) + " m") + cell("y", r.y.toFixed(2) + " m") + cell("yaw", (r.yaw * DEG).toFixed(0) + "°") +
      cell("v", twist.v.toFixed(2) + " m/s") + cell("ω", twist.w.toFixed(2) + " rad/s") +
      r.joints.map(function (q, n) { return cell("joint" + (n + 1), (q * DEG).toFixed(1) + "°"); }).join("") +
      cell("gripper", (r.grip * 1000).toFixed(1) + " mm");
    if (conn) {
      var total = 0; Object.keys(recvTimes).forEach(function (t) { total += hzOf(t); });
      if (statusEl.className.indexOf("error") < 0 || state === "open") {
        statusEl.className = "lv-status";
        statusEl.textContent = badge.textContent + " · " + base() + " · 초당 메시지 " + total.toFixed(0) + "개";
      }
    }
    Object.keys(rows).forEach(function (n) {
      var l = last[n];
      var hz = hzOf(n);
      rows[n].br.textContent = !l ? "—" : hz > 0 ? hz.toFixed(1) + " Hz" : ((performance.now() - l.at) / 1000).toFixed(0) + "초 전";
    });
    drawRaw();
  }, 250);

  // ---------- 카메라 (켤 때만 받는다) ----------
  var camSel = $("camTopic"), camBtn = $("btnCam"), camImg = $("camImg"), camMsg = $("camMsg"), camOn = false;
  function syncCamTopics() {
    var imgs = graph.filter(function (t) { return t.image || /Image$/.test(t.type); }).map(function (t) { return t.name; });
    var cur = camSel.value, have = Array.prototype.map.call(camSel.options, function (o) { return o.value; }).join(",");
    if (have === imgs.join(",")) return;
    camSel.textContent = "";
    if (!imgs.length) { camSel.innerHTML = '<option value="">영상 토픽 없음</option>'; }
    imgs.forEach(function (n) { var o = document.createElement("option"); o.value = o.textContent = n; camSel.appendChild(o); });
    camSel.value = imgs.indexOf(cur) >= 0 ? cur : (imgs.filter(function (n) { return /color/.test(n); })[0] || imgs[0] || "");
    camSel.disabled = camBtn.disabled = !imgs.length;
  }
  function startCam() {
    if (!camSel.value) return;
    camOn = true; camBtn.setAttribute("aria-pressed", "true"); camBtn.textContent = "영상 끄기";
    camMsg.textContent = "영상을 기다리는 중"; camMsg.hidden = false;
    camImg.onload = function () { camImg.hidden = false; camMsg.hidden = true; };
    camImg.onerror = function () { camImg.hidden = true; camMsg.hidden = false; camMsg.textContent = "영상을 받지 못했어요 (JPEG 으로 바꿀 수 없는 형식이거나 토픽이 없어요)"; };
    camImg.src = TB3Live.imageUrl(base(), camSel.value);
  }
  function stopCam() {
    camOn = false; camBtn.setAttribute("aria-pressed", "false"); camBtn.textContent = "영상 켜기";
    camImg.removeAttribute("src"); camImg.hidden = true; camMsg.hidden = false; camMsg.textContent = "영상은 켤 때만 받아요 (로봇 부하를 줄이려고)";
  }
  function pickCam(n) { camSel.value = n; startCam(); $("t-cam").scrollIntoView({ block: "nearest" }); }
  camBtn.addEventListener("click", function () { if (camOn) stopCam(); else startCam(); });
  camSel.addEventListener("change", function () { if (camOn) startCam(); });

  connect();
})();
