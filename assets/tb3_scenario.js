// 시나리오 엔진: ㄱ자 경기장 위의 질량 있는 장애물 · 밀기 · 집기 · 미션 판정.
// createTB3Scenario(viewer, def, on) → { collide, frame, setMass, reset, state }
// 물리는 바닥 평면 근사: 미는 데 필요한 힘 = μ·m·g. 기체의 미는 힘(def.pushForce)보다 크면 밀리지 않는다.
// 집기는 OpenMANIPULATOR-X 들 수 있는 무게(def.payload, 500 g)와 그리퍼 벌림 이하일 때만 된다.
function createTB3Scenario(viewer, def, on) {
  var THREE = viewer.THREE, G = 9.81, H = 1.5;
  var R = 0.2, OFF = -0.064;                       // 기체 충돌 원: base 중심(base_link 에서 x −0.064 m), 반지름 0.2 m
  var COLORS = { movable: 0xF2B134, heavy: 0x8E6CCF, fixed: 0x6B7280 };
  on = on || {};

  function inL(x, y, m) {
    if (x < -H + m || x > H - m || y < -H + m || y > H - m) return false;
    return y >= m || x >= m;
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
  function obsInArena(o, px, py) {
    if (o.shape === "cyl") return inL(px, py, o.r);
    var hx = o.sx / 2, hy = o.sy / 2;
    return inL(px - hx, py - hy, 0.01) && inL(px + hx, py - hy, 0.01) && inL(px - hx, py + hy, 0.01) && inL(px + hx, py + hy, 0.01);
  }
  function obsOverlap(a, ax, ay, b) {
    var ra = a.shape === "cyl" ? a.r : Math.hypot(a.sx, a.sy) / 2, rb = b.shape === "cyl" ? b.r : Math.hypot(b.sx, b.sy) / 2;
    if (a.shape === "box" && b.shape === "box") return Math.abs(ax - b.x) < (a.sx + b.sx) / 2 && Math.abs(ay - b.y) < (a.sy + b.sy) / 2;
    return Math.hypot(ax - b.x, ay - b.y) < ra + rb - 0.01;
  }
  // 경로(점선)까지의 거리 — 미션 2 판정
  function distToPath(px, py) {
    var best = Infinity, P = def.path;
    for (var n = 0; n < P.length - 1; n++) {
      var ax = P[n][0], ay = P[n][1], bx = P[n + 1][0], by = P[n + 1][1];
      var t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))));
    }
    return best;
  }

  // 장애물 3D
  var obs = def.obstacles.map(function (d) {
    var o = JSON.parse(JSON.stringify(d));
    o.x0 = o.x; o.y0 = o.y; o.mass0 = o.mass; o.held = false;
    var geo = o.shape === "cyl" ? new THREE.CylinderGeometry(o.r, o.r, o.h, 28) : new THREE.BoxGeometry(o.sx, o.sy, o.h);
    o.mat = new THREE.MeshStandardMaterial({ color: COLORS[kind(o)], roughness: 0.6 });
    o.mesh = new THREE.Mesh(geo, o.mat);
    if (o.shape === "cyl") o.mesh.rotation.x = Math.PI / 2;
    o.mesh.position.set(o.x, o.y, o.h / 2);
    viewer.world.add(o.mesh);
    return o;
  });
  // 목표 지점과 경로
  var goalMesh = new THREE.Mesh(new THREE.RingGeometry(def.goal.r - 0.03, def.goal.r, 48),
    new THREE.MeshBasicMaterial({ color: 0x5FD08A, side: THREE.DoubleSide }));
  goalMesh.position.set(def.goal.x, def.goal.y, 0.003); viewer.world.add(goalMesh);
  var pathPts = def.path.map(function (p) { return new THREE.Vector3(p[0], p[1], 0.004); });
  var pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPts),
    new THREE.LineDashedMaterial({ color: 0x9DB4CF, dashSize: 0.06, gapSize: 0.05 }));
  pathLine.computeLineDistances(); viewer.world.add(pathLine);

  var holding = null, blockedBy = null, steps = [false, false, false], lastGripHeld = false, lastOpenHeld = false;

  function say(text) { if (on.log) on.log(text); }
  // 받침에 맞는 조사: j("상자", "을", "를") → "상자를"
  function j(word, a, b) {
    var c = word.charCodeAt(word.length - 1);
    return word + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b);
  }

  function tryMove(nx, ny, x, y, yaw) {
    var c = center(nx, ny, yaw);
    if (!inL(c.x, c.y, R)) return null;
    var dx = nx - x, dy = ny - y, moves = [], k = 1;
    for (var n = 0; n < obs.length; n++) {
      var o = obs[n];
      if (o.held || !hitCircle(c.x, c.y, R, o, o.x, o.y)) continue;
      var c0 = center(x, y, yaw);
      var approaching = Math.hypot(c.x - o.x, c.y - o.y) < Math.hypot(c0.x - o.x, c0.y - o.y);
      if (!approaching) continue;                                   // 떨어지는 방향은 막지 않는다
      if (kind(o) !== "movable") return { blocked: o };
      k = Math.min(k, 1 - resist(o) / def.pushForce);
      moves.push(o);
    }
    if (!moves.length) return { x: nx, y: ny, moves: [] };
    var mx = dx * k, my = dy * k;
    for (var m = 0; m < moves.length; m++) {
      var o2 = moves[m], px = o2.x + mx, py = o2.y + my;
      if (!obsInArena(o2, px, py)) return { blocked: o2, wall: true };
      for (var q = 0; q < obs.length; q++) if (obs[q] !== o2 && !obs[q].held && obsOverlap(o2, px, py, obs[q])) return { blocked: obs[q] };
    }
    return { x: x + mx, y: y + my, moves: moves, dx: mx, dy: my };
  }

  function collide(nx, ny, x, y) {
    var yaw = viewer.drive.yaw;
    if (nx === x && ny === y) return { x: x, y: y };
    var tries = [[nx, ny], [nx, y], [x, ny]], hit = null;
    for (var n = 0; n < tries.length; n++) {
      if (tries[n][0] === x && tries[n][1] === y) continue;          // 제자리는 '움직임'으로 치지 않는다
      var r = tryMove(tries[n][0], tries[n][1], x, y, yaw);
      if (r && r.blocked) { hit = hit || r; continue; }
      if (!r) continue;
      r.moves.forEach(function (o) { o.x += r.dx; o.y += r.dy; o.mesh.position.set(o.x, o.y, o.h / 2); });
      if (r.moves.length && blockedBy !== "push:" + r.moves[0].id) {
        blockedBy = "push:" + r.moves[0].id;
        say(j(r.moves[0].name, "을", "를") + " 밀고 있어요 · 필요한 힘 " + resist(r.moves[0]).toFixed(1) + " N < " + def.pushForce + " N");
      }
      return { x: r.x, y: r.y };
    }
    if (hit && hit.blocked && blockedBy !== "block:" + hit.blocked.id) {
      blockedBy = "block:" + hit.blocked.id;
      var b = hit.blocked;
      if (hit.wall) say(j(b.name, "이", "가") + " 벽에 막혀 더 밀리지 않아요");
      else if (b.fixed) say(j(b.name, "은", "는") + " 고정되어 있어요");
      else if (kind(b) === "heavy") say(j(b.name, "은", "는") + " 밀리지 않아요 · " + b.mass + " kg, 필요한 힘 " + resist(b).toFixed(1) + " N > " + def.pushForce + " N");
      else say(b.name + "에 막혔어요");
    }
    return { x: x, y: y };
  }

  function frame() {
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
      o.x = tip.x; o.y = tip.y;
      if (!obsInArena(o, o.x, o.y)) { o.x = Math.max(-H + o.sx, Math.min(H - o.sx, o.x)); o.y = Math.max(-H + o.sy, Math.min(H - o.sy, o.y)); }
      o.mesh.position.set(o.x, o.y, o.h / 2);
      say(j(o.name, "을", "를") + " 내려놓았어요");
    }
    lastGripHeld = gripHeld; lastOpenHeld = openHeld;
    if (holding) { holding.x = tip.x; holding.y = tip.y; holding.mesh.position.set(tip.x, tip.y, Math.max(holding.h / 2, tip.z)); }

    // 미션: 1 장애물 확인(움직일 수 있는 장애물 0.5 m 안) → 2 경로 위 장애물 치우기 → 3 목표 지점 도착
    var c = center(r.x, r.y, r.yaw);
    var blocking = obs.filter(function (o) { return o.onPath && !o.held && distToPath(o.x, o.y) < 0.2; });
    var next = [
      steps[0] || obs.some(function (o) { return kind(o) === "movable" && Math.hypot(c.x - o.x, c.y - o.y) < R + 0.5; }),
      false, false
    ];
    next[1] = steps[1] || (next[0] && blocking.length === 0 && !holding);
    next[2] = steps[2] || (next[1] && Math.hypot(r.x - def.goal.x, r.y - def.goal.y) < def.goal.r);
    for (var n = 0; n < 3; n++) if (next[n] && !steps[n]) { steps[n] = true; if (on.step) on.step(n); }
    if (blockedBy && blockedBy.indexOf("push:") === 0 && !(r.v || r.w)) blockedBy = null;
  }

  function setMass(id, mass) {
    obs.forEach(function (o) {
      if (o.id !== id) return;
      o.mass = Math.max(0.01, mass);
      o.mat.color.setHex(COLORS[kind(o)]);
      if (o.held && o.mass > def.payload) { o.held = false; holding = null; o.mesh.position.set(o.x, o.y, o.h / 2); say(j(o.name, "이", "가") + " 무거워져서 놓쳤어요"); }
    });
    blockedBy = null;
  }

  function reset() {
    obs.forEach(function (o) {
      o.x = o.x0; o.y = o.y0; o.held = false; o.mass = o.mass0;
      o.mat.color.setHex(COLORS[kind(o)]); o.mesh.position.set(o.x, o.y, o.h / 2);
    });
    holding = null; blockedBy = null; steps = [false, false, false];
    var d = viewer.drive; d.x = def.start.x; d.y = def.start.y; d.yaw = def.start.yaw; d.v = 0; d.w = 0;
  }

  return {
    collide: collide,
    frame: frame,
    setMass: setMass,
    reset: reset,
    state: function () {
      return {
        steps: steps.slice(), holding: holding ? holding.id : null,
        obstacles: obs.map(function (o) {
          return { id: o.id, name: o.name, x: o.x, y: o.y, mass: o.mass, mu: o.mu, kind: kind(o), shape: o.shape,
            sx: o.sx, sy: o.sy, r: o.r, held: o.held, force: o.fixed ? null : resist(o), graspable: graspable(o) && o.mass <= def.payload };
        })
      };
    }
  };
}
