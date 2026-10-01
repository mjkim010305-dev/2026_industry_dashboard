// 시나리오 엔진: 점유 격자 지도(TB3Map) 위의 질량 있는 장애물 · 밀기 · 집기 · 미션 판정.
// createTB3Scenario(viewer, def, on) → { collide, frame, setMap, addObstacle, moveObstacle, removeObstacle, setMass,
//                                        setGoal, setStart, reset, state, map }
// 물리는 바닥 평면 근사: 미는 데 필요한 힘 = μ·m·g. 기체의 미는 힘(def.pushForce)보다 크면 밀리지 않는다.
// 집기는 OpenMANIPULATOR-X 들 수 있는 무게(def.payload, 500 g)와 그리퍼 벌림 이하일 때만 된다.
function createTB3Scenario(viewer, def, on) {
  var THREE = viewer.THREE, G = 9.81;
  var R = 0.2, OFF = -0.064;                       // 기체 충돌 원: base 중심(base_link 에서 x −0.064 m), 반지름 0.2 m
  var COLORS = { movable: 0xF2B134, heavy: 0x8E6CCF, fixed: 0x6B7280 };
  on = on || {};

  var map = null, mapGroup = null, isDefault = true;
  var obs = [], nextId = 1;
  var goal = null, goalMesh = null, path = null, pathLine = null, start = null;
  var holding = null, blockedBy = null, steps = [false, false, false], lastGripHeld = false, lastOpenHeld = false;

  function say(text) { if (on.log) on.log(text); }
  // 받침에 맞는 조사: j("상자", "을", "를") → "상자를"
  function j(word, a, b) {
    var c = word.charCodeAt(word.length - 1);
    return word + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b);
  }
  function center(x, y, yaw) { return { x: x + Math.cos(yaw) * OFF, y: y + Math.sin(yaw) * OFF }; }
  function resist(o) { return o.fixed ? Infinity : o.mu * o.mass * G; }
  function kind(o) { return o.fixed ? "fixed" : resist(o) >= def.pushForce ? "heavy" : "movable"; }
  function graspable(o) { return !o.fixed && o.shape === "box" && Math.min(o.sx, o.sy) <= def.gripMax; }
  function hitCircle(cx, cy, r, o, px, py) {
    if (o.shape === "cyl") return Math.hypot(cx - px, cy - py) < r + o.r;
    var dx = Math.max(Math.abs(cx - px) - o.sx / 2, 0), dy = Math.max(Math.abs(cy - py) - o.sy / 2, 0);
    return dx * dx + dy * dy < r * r;
  }
  function obsFree(o, px, py) { return o.shape === "cyl" ? map.circleFree(px, py, o.r) : map.rectFree(px, py, o.sx, o.sy); }
  function obsOverlap(a, ax, ay, b) {
    if (a.shape === "box" && b.shape === "box") return Math.abs(ax - b.x) < (a.sx + b.sx) / 2 && Math.abs(ay - b.y) < (a.sy + b.sy) / 2;
    var ra = a.shape === "cyl" ? a.r : Math.hypot(a.sx, a.sy) / 2, rb = b.shape === "cyl" ? b.r : Math.hypot(b.sx, b.sy) / 2;
    return Math.hypot(ax - b.x, ay - b.y) < ra + rb - 0.01;
  }
  function distToPath(px, py) {
    if (!path) return Infinity;
    var best = Infinity;
    for (var n = 0; n < path.length - 1; n++) {
      var ax = path[n][0], ay = path[n][1], bx = path[n + 1][0], by = path[n + 1][1];
      var t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))));
    }
    return best;
  }

  // ---------- 장애물 ----------
  function makeObstacle(spec) {
    var o = {
      id: spec.id || ("O" + nextId++), name: spec.name || "장애물", shape: spec.shape === "cyl" ? "cyl" : "box",
      sx: +spec.sx || 0.2, sy: +spec.sy || 0.2, r: +spec.r || 0.1, h: +spec.h || 0.2,
      x: +spec.x, y: +spec.y, mass: spec.fixed ? 0 : Math.max(0.01, +spec.mass || 1), mu: spec.mu !== undefined ? +spec.mu : 0.5,
      fixed: !!spec.fixed, onPath: !!spec.onPath, held: false
    };
    o.x0 = o.x; o.y0 = o.y; o.mass0 = o.mass;
    return o;
  }
  function addMesh(o) {
    var geo = o.shape === "cyl" ? new THREE.CylinderGeometry(o.r, o.r, o.h, 28) : new THREE.BoxGeometry(o.sx, o.sy, o.h);
    o.mat = new THREE.MeshStandardMaterial({ color: COLORS[kind(o)], roughness: 0.6 });
    o.mesh = new THREE.Mesh(geo, o.mat);
    if (o.shape === "cyl") o.mesh.rotation.x = Math.PI / 2;
    o.mesh.position.set(o.x, o.y, o.h / 2);
    viewer.world.add(o.mesh);
  }
  function clearObstacles() {
    obs.forEach(function (o) { viewer.world.remove(o.mesh); o.mesh.geometry.dispose(); o.mat.dispose(); });
    obs = []; holding = null;
  }
  // 놓을 수 있는지 검사. 문제가 있으면 이유(문장), 없으면 null
  function placeError(o, px, py, ignore) {
    if (!isFinite(px) || !isFinite(py)) return "위치(x, y)를 숫자로 넣어 주세요";
    if (o.shape === "box" && !(o.sx > 0 && o.sy > 0 && o.h > 0)) return "크기는 0 보다 커야 해요";
    if (o.shape === "cyl" && !(o.r > 0 && o.h > 0)) return "반지름과 높이는 0 보다 커야 해요";
    if (!obsFree(o, px, py)) return "그 자리는 벽이나 지도 밖(모르는 영역)과 겹쳐요";
    for (var n = 0; n < obs.length; n++) if (obs[n] !== ignore && !obs[n].held && obsOverlap(o, px, py, obs[n])) return j(obs[n].name, "과", "와") + " 겹쳐요";
    var c = center(viewer.drive.x, viewer.drive.y, viewer.drive.yaw);
    if (hitCircle(c.x, c.y, R, o, px, py)) return "기체와 겹쳐요";
    return null;
  }
  function addObstacle(spec) {
    var o = makeObstacle(spec);
    var err = placeError(o, o.x, o.y, null);
    if (err) return err;
    if (!spec.name) o.name = (o.fixed ? "고정 " : "") + (o.shape === "cyl" ? "원기둥 " : "상자 ") + o.id.replace(/^O/, "");
    addMesh(o); obs.push(o);
    say(j(o.name, "을", "를") + " (" + o.x.toFixed(2) + ", " + o.y.toFixed(2) + ") 에 놓았어요");
    return null;
  }
  function moveObstacle(id, x, y) {
    var o = obs.filter(function (q) { return q.id === id; })[0];
    if (!o) return "장애물을 찾지 못했어요";
    if (o.held) return "집고 있는 장애물은 옮길 수 없어요";
    var err = placeError(o, x, y, o);
    if (err) return err;
    o.x = o.x0 = x; o.y = o.y0 = y; o.mesh.position.set(x, y, o.h / 2);
    return null;
  }
  function removeObstacle(id) {
    obs = obs.filter(function (o) {
      if (o.id !== id) return true;
      viewer.world.remove(o.mesh); o.mesh.geometry.dispose(); o.mat.dispose();
      if (holding === o) holding = null;
      return false;
    });
  }

  // ---------- 지도 ----------
  function setMap(m, isDef) {
    if (mapGroup) { viewer.world.remove(mapGroup); mapGroup.traverse(function (x) { if (x.geometry) x.geometry.dispose(); if (x.material) { if (x.material.map) x.material.map.dispose(); x.material.dispose(); } }); }
    map = m; isDefault = !!isDef;
    mapGroup = TB3Map.build3D(THREE, map, { wallHeight: 0.15 });
    viewer.world.add(mapGroup);
    clearObstacles();
    if (goalMesh) { viewer.world.remove(goalMesh); goalMesh = null; }
    if (pathLine) { viewer.world.remove(pathLine); pathLine = null; }
    goal = null; path = null;
    if (isDefault) {
      def.obstacles.forEach(function (d) { var o = makeObstacle(d); addMesh(o); obs.push(o); });
      setGoal(def.goal.x, def.goal.y, def.goal.r);
      path = def.path;
      var pts = path.map(function (p) { return new THREE.Vector3(p[0], p[1], 0.004); });
      pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x9DB4CF, dashSize: 0.06, gapSize: 0.05 }));
      pathLine.computeLineDistances(); viewer.world.add(pathLine);
      start = { x: def.start.x, y: def.start.y, yaw: def.start.yaw };
    } else {
      // SLAM 지도의 원점(0, 0)은 보통 로봇이 출발한 곳이다. 그 근처의 빈 자리에서 시작한다.
      var p = map.nearestFree(OFF, 0, R + 0.02);
      start = p ? { x: p.x - OFF, y: p.y, yaw: 0 } : { x: 0, y: 0, yaw: 0 };
    }
    var b = map.bounds();
    if (viewer.setDist) viewer.setDist(Math.min(isDefault ? 1.6 : 2.4, Math.max(b.maxX - b.minX, b.maxY - b.minY)));
    reset();
  }

  function setGoal(x, y, r) {
    if (goalMesh) viewer.world.remove(goalMesh);
    goal = { x: x, y: y, r: r || 0.25 };
    goalMesh = new THREE.Mesh(new THREE.RingGeometry(goal.r - 0.03, goal.r, 48), new THREE.MeshBasicMaterial({ color: 0x5FD08A, side: THREE.DoubleSide }));
    goalMesh.position.set(x, y, 0.003); viewer.world.add(goalMesh);
  }
  function setStart(x, y) {
    var c = center(x, y, 0);
    if (!map.circleFree(c.x, c.y, R)) return "그 자리는 기체가 들어가지 못해요 (벽 · 지도 밖과 0.2 m 안)";
    for (var n = 0; n < obs.length; n++) if (hitCircle(c.x, c.y, R, obs[n], obs[n].x, obs[n].y)) return j(obs[n].name, "과", "와") + " 겹쳐요";
    start = { x: x, y: y, yaw: viewer.drive.yaw };
    var d = viewer.drive; d.x = x; d.y = y; d.v = 0; d.w = 0;
    return null;
  }

  // ---------- 충돌 ----------
  function tryMove(nx, ny, x, y, yaw) {
    var c = center(nx, ny, yaw);
    if (!map.circleFree(c.x, c.y, R)) return { wallOnly: true };
    var dx = nx - x, dy = ny - y, moves = [], k = 1;
    for (var n = 0; n < obs.length; n++) {
      var o = obs[n];
      if (o.held || !hitCircle(c.x, c.y, R, o, o.x, o.y)) continue;
      var c0 = center(x, y, yaw);
      if (Math.hypot(c.x - o.x, c.y - o.y) >= Math.hypot(c0.x - o.x, c0.y - o.y)) continue;   // 떨어지는 방향은 막지 않는다
      if (kind(o) !== "movable") return { blocked: o };
      k = Math.min(k, 1 - resist(o) / def.pushForce);
      moves.push(o);
    }
    if (!moves.length) return { x: nx, y: ny, moves: [] };
    var mx = dx * k, my = dy * k;
    for (var m = 0; m < moves.length; m++) {
      var o2 = moves[m], px = o2.x + mx, py = o2.y + my;
      if (!obsFree(o2, px, py)) return { blocked: o2, wall: true };
      for (var q = 0; q < obs.length; q++) if (obs[q] !== o2 && !obs[q].held && obsOverlap(o2, px, py, obs[q])) return { blocked: obs[q] };
    }
    return { x: x + mx, y: y + my, moves: moves, dx: mx, dy: my };
  }

  function collide(nx, ny, x, y) {
    if (!map) return { x: x, y: y };
    var yaw = viewer.drive.yaw;
    if (nx === x && ny === y) return { x: x, y: y };
    var tries = [[nx, ny], [nx, y], [x, ny]], hit = null;
    for (var n = 0; n < tries.length; n++) {
      if (tries[n][0] === x && tries[n][1] === y) continue;          // 제자리는 '움직임'으로 치지 않는다
      var r = tryMove(tries[n][0], tries[n][1], x, y, yaw);
      if (r.blocked) { hit = hit || r; continue; }
      if (r.wallOnly) continue;
      r.moves.forEach(function (o) { o.x += r.dx; o.y += r.dy; o.mesh.position.set(o.x, o.y, o.h / 2); });
      if (r.moves.length && blockedBy !== "push:" + r.moves[0].id) {
        blockedBy = "push:" + r.moves[0].id;
        say(j(r.moves[0].name, "을", "를") + " 밀고 있어요 · 필요한 힘 " + resist(r.moves[0]).toFixed(1) + " N < " + def.pushForce + " N");
      }
      return { x: r.x, y: r.y };
    }
    if (hit && blockedBy !== "block:" + hit.blocked.id) {
      blockedBy = "block:" + hit.blocked.id;
      var b = hit.blocked;
      if (hit.wall) say(j(b.name, "이", "가") + " 벽에 막혀 더 밀리지 않아요");
      else if (b.fixed) say(j(b.name, "은", "는") + " 고정되어 있어요");
      else if (kind(b) === "heavy") say(j(b.name, "은", "는") + " 밀리지 않아요 · " + b.mass + " kg, 필요한 힘 " + resist(b).toFixed(1) + " N > " + def.pushForce + " N");
      else say(j(b.name, "에", "에") + " 막혔어요");
    }
    return { x: x, y: y };
  }

  // ---------- 매 프레임: 집기 · 놓기 · 미션 ----------
  function frame() {
    if (!map) return;
    var r = viewer.readout(), tip = viewer.tip();
    var gripHeld = r.held.indexOf("p") >= 0, openHeld = r.held.indexOf("o") >= 0;
    if (gripHeld && !lastGripHeld && !holding) {
      var cand = null;
      obs.forEach(function (o) {
        if (o.held) return;
        var near = o.shape === "cyl" ? Math.hypot(tip.x - o.x, tip.y - o.y) < o.r + 0.05
          : Math.abs(tip.x - o.x) < o.sx / 2 + 0.05 && Math.abs(tip.y - o.y) < o.sy / 2 + 0.05;
        if (near && tip.z < o.h + 0.03) cand = o;
      });
      if (cand) {
        if (!graspable(cand)) say(j(cand.name, "은", "는") + " 그리퍼로 잡기엔 너무 커요");
        else if (cand.mass > def.payload) say(j(cand.name, "은", "는") + " 너무 무거워요 · " + cand.mass + " kg > 들 수 있는 무게 " + def.payload + " kg");
        else { holding = cand; cand.held = true; say(j(cand.name, "을", "를") + " 집었어요"); }
      } else say("그리퍼 끝에 닿은 장애물이 없어요 · '집기 자세'로 팔을 내려 보세요");
    }
    if (openHeld && !lastOpenHeld && holding) {
      var o = holding; holding = null; o.held = false;
      var spot = obsFree(o, tip.x, tip.y) ? { x: tip.x, y: tip.y } : map.nearestFree(tip.x, tip.y, o.shape === "cyl" ? o.r : Math.hypot(o.sx, o.sy) / 2);
      if (spot) { o.x = spot.x; o.y = spot.y; }
      o.mesh.position.set(o.x, o.y, o.h / 2);
      say(j(o.name, "을", "를") + " 내려놓았어요");
    }
    lastGripHeld = gripHeld; lastOpenHeld = openHeld;
    if (holding) { holding.x = tip.x; holding.y = tip.y; holding.mesh.position.set(tip.x, tip.y, Math.max(holding.h / 2, tip.z)); }

    // 미션(기본 경기장만): 1 장애물 확인(움직일 수 있는 장애물 0.5 m 안) → 2 경로 위 장애물 치우기 → 3 목표 지점 도착
    if (isDefault) {
      var c = center(r.x, r.y, r.yaw);
      var blocking = obs.filter(function (q) { return q.onPath && !q.held && distToPath(q.x, q.y) < 0.2; });
      var next = [steps[0] || obs.some(function (q) { return kind(q) === "movable" && Math.hypot(c.x - q.x, c.y - q.y) < R + 0.5; }), false, false];
      next[1] = steps[1] || (next[0] && blocking.length === 0 && !holding);
      next[2] = steps[2] || (next[1] && goal && Math.hypot(r.x - goal.x, r.y - goal.y) < goal.r);
      for (var n = 0; n < 3; n++) if (next[n] && !steps[n]) { steps[n] = true; if (on.step) on.step(n); }
    }
    if (blockedBy && blockedBy.indexOf("push:") === 0 && !(r.v || r.w)) blockedBy = null;
  }

  function setMass(id, mass) {
    obs.forEach(function (o) {
      if (o.id !== id || o.fixed) return;
      o.mass = Math.max(0.01, mass);
      o.mat.color.setHex(COLORS[kind(o)]);
      if (o.held && o.mass > def.payload) { o.held = false; holding = null; o.mesh.position.set(o.x, o.y, o.h / 2); say(j(o.name, "이", "가") + " 무거워져서 놓쳤어요"); }
    });
    blockedBy = null;
  }

  // 장애물은 놓은 자리(또는 기본값)로, 기체는 시작 위치로
  function reset() {
    obs.forEach(function (o) {
      o.x = o.x0; o.y = o.y0; o.held = false; o.mass = o.mass0;
      o.mat.color.setHex(COLORS[kind(o)]); o.mesh.position.set(o.x, o.y, o.h / 2);
    });
    holding = null; blockedBy = null; steps = [false, false, false];
    var d = viewer.drive; d.x = start.x; d.y = start.y; d.yaw = start.yaw; d.v = 0; d.w = 0;
  }

  setMap(TB3Map.defaultArena(), true);

  return {
    collide: collide, frame: frame, setMap: setMap, addObstacle: addObstacle, moveObstacle: moveObstacle,
    removeObstacle: removeObstacle, setMass: setMass, setGoal: setGoal, setStart: setStart, reset: reset,
    map: function () { return map; },
    state: function () {
      return {
        isDefault: isDefault, mapName: map.name, steps: steps.slice(), holding: holding ? holding.id : null,
        goal: goal, path: path,
        obstacles: obs.map(function (o) {
          return { id: o.id, name: o.name, x: o.x, y: o.y, mass: o.mass, mu: o.mu, kind: kind(o), shape: o.shape,
            sx: o.sx, sy: o.sy, r: o.r, h: o.h, held: o.held, force: o.fixed ? null : resist(o), graspable: graspable(o) && o.mass <= def.payload };
        })
      };
    }
  };
}
