// turtlebot3_manipulation 3D 뷰어. 관절 구조와 mesh 위치는 공식 URDF(turtlebot3_manipulation_description)를 그대로 따른다.
// createTB3Viewer(THREE, canvas, data, theme) → { press, release, readout, dispose, select, setExplode, setPose, project, tip, world, drive }
// theme 선택 항목: arena(기본 true) · floorGrid(arena 가 false 일 때 바닥 격자, 기본 true) · view("follow" | "showcase")
//                  collide(nx, ny, x, y) → {x, y} · onFrame(dt) · onPick(part) · onFloorClick(x, y)
//                  external(true 면 키·주행 계산을 끄고 setState 로 받은 실제 값만 그린다)
function createTB3Viewer(THREE, canvas, data, theme) {
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 120);
  scene.add(new THREE.HemisphereLight(0xffffff, theme.ground, 0.85));
  var sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(1.2, 2.0, 1.0);
  scene.add(sun);

  var accent = new THREE.Color(theme.accent);
  var mats = [];
  function geom(name) {
    var p = data.parts[name];
    var vb = Uint8Array.from(atob(p.v), function (c) { return c.charCodeAt(0); });
    var ib = Uint8Array.from(atob(p.i), function (c) { return c.charCodeAt(0); });
    var v16 = new Int16Array(vb.buffer), pos = new Float32Array(v16.length);
    for (var n = 0; n < v16.length; n++) pos[n] = v16[n] * 0.0001;
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(ib.buffer), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }
  function mesh(name, color, part) {
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.1, flatShading: true });
    m.userData.base = new THREE.Color(color);
    mats.push(m);
    var o = new THREE.Mesh(geom(name), m);
    o.userData.part = part;
    return o;
  }
  function group(parent, x, y, z) {
    var g = new THREE.Group(); g.position.set(x, y, z); g.userData.pos0 = g.position.clone(); parent.add(g); return g;
  }

  // ROS(z 위) → three(y 위)
  var world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);

  // 경기장: 3 m × 3 m 정사각형 안의 ㄱ자 통로(폭 1.5 m). 원점은 정사각형 가운데, 위 = +y, 오른쪽 = +x.
  // 위쪽 띠 y ∈ [0, 1.5] (가로 3 m) + 오른쪽 띠 x ∈ [0, 1.5] (세로 3 m). 왼쪽 아래 1.5 m × 1.5 m 는 막혀 있다.
  var H = 1.5, ROBOT_R = 0.2;
  var ARENA = [[-H, 0], [-H, H], [H, H], [H, -H], [0, -H], [0, 0]];
  var useArena = theme.arena !== false;
  function inArena(x, y) {
    var m = ROBOT_R;
    if (x < -H + m || x > H - m || y < -H + m || y > H - m) return false;
    return y >= m || x >= m;
  }
  if (useArena) {
    var shape = new THREE.Shape();
    ARENA.forEach(function (p, n) { if (n) shape.lineTo(p[0], p[1]); else shape.moveTo(p[0], p[1]); });
    world.add(new THREE.Mesh(new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: theme.floor || 0x1A222C, roughness: 0.95, metalness: 0 })));
    var lines = [];
    for (var g = -H; g <= H + 1e-6; g += 0.5) {
      // 세로선 x = g, 가로선 y = g — ㄱ자 안쪽 구간만
      if (g < 0) { lines.push(g, 0, 0.001, g, H, 0.001); } else { lines.push(g, -H, 0.001, g, H, 0.001); }
      if (g < 0) { lines.push(0, g, 0.001, H, g, 0.001); } else { lines.push(-H, g, 0.001, H, g, 0.001); }
    }
    var lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lines), 3));
    world.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: theme.grid })));
    var wallMat = new THREE.MeshStandardMaterial({ color: theme.wall || 0xC9CED6, roughness: 0.7 });
    ARENA.forEach(function (a, n) {
      var b = ARENA[(n + 1) % ARENA.length];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.03, 0.03, 0.12), wallMat);
      wall.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.06);
      wall.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
      world.add(wall);
    });
  } else if (theme.floorGrid !== false) {
    var grid = new THREE.GridHelper(1.6, 16, theme.gridMajor, theme.grid);
    scene.add(grid);
  }

  var footprint = group(world, 0, 0, 0);
  var baseLink = group(footprint, 0, 0, 0.010);
  var baseMesh = mesh("base", theme.body, "base"); baseMesh.position.set(-0.064, 0, 0); baseLink.add(baseMesh);
  function wheel(y, name) {
    var j = group(baseLink, 0, y, 0.023); j.rotation.x = -1.57;
    var spin = group(j, 0, 0, 0);
    var m = mesh(name, theme.tire, "wheels"); m.rotation.x = 1.57; spin.add(m);
    return { joint: j, spin: spin, mesh: m };
  }
  var wl = wheel(0.144, "left_tire"), wr = wheel(-0.144, "right_tire");
  var ladar = group(baseLink, -0.024, 0, 0.122); var ladarMesh = mesh("ladar", theme.tire, "lidar"); ladar.add(ladarMesh);
  // camera_link(0.073, -0.011, 0.084) + 시각 원점(0.005, 0.011, 0.013). 본체 mesh 안에 있어 고르기·강조용 표식만 둔다.
  var cam = group(baseLink, 0.078, 0, 0.097);
  var camMat = new THREE.MeshStandardMaterial({ color: theme.accent, transparent: true, opacity: 0, roughness: 0.4 });
  camMat.userData.base = null;
  var camMesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), camMat); camMesh.userData.part = "camera"; cam.add(camMesh);
  camMesh.geometry.computeBoundingBox();
  var link1 = group(baseLink, -0.092, 0, 0.091); var l1 = mesh("link1", theme.arm, "link1"); link1.add(l1);
  var j1 = group(link1, 0.012, 0, 0.017); var l2 = mesh("link2", theme.arm, "joint1"); l2.position.z = 0.019; j1.add(l2);
  var j2 = group(j1, 0, 0, 0.0595); var l3 = mesh("link3", theme.arm, "joint2"); j2.add(l3);
  var j3 = group(j2, 0.024, 0, 0.128); var l4 = mesh("link4", theme.arm, "joint3"); j3.add(l4);
  var j4 = group(j3, 0.124, 0, 0); var l5 = mesh("link5", theme.arm, "joint4"); j4.add(l5);
  var gl = group(j4, 0.0817, 0.021, 0); var gL = mesh("gripper_left_palm", theme.grip, "gripper"); gl.add(gL);
  var gr = group(j4, 0.0817, -0.021, 0); var gR = mesh("gripper_right_palm", theme.grip, "gripper"); gr.add(gR);

  var PARTS = {
    base: [baseMesh], wheels: [wl.mesh, wr.mesh], lidar: [ladarMesh], camera: [camMesh], link1: [l1],
    joint1: [l2], joint2: [l3], joint3: [l4], joint4: [l5], gripper: [gL, gR]
  };
  var pickables = [];
  Object.keys(PARTS).forEach(function (k) { pickables = pickables.concat(PARTS[k]); });

  // 분해 보기: 각 묶음이 벌어지는 방향(부모 좌표계, m)
  var EXPLODE = [
    [ladar, 0, 0, 0.10], [cam, 0.08, 0, 0.02], [link1, -0.04, 0, 0.14], [j1, 0, 0, 0.03], [j2, 0, 0, 0.04],
    [j3, 0.04, 0, 0], [j4, 0.04, 0, 0], [wl.joint, 0, 0.09, 0], [wr.joint, 0, -0.09, 0]
  ];
  var explode = { e: 0, target: 0 };

  // 관절 상태 (OpenMANIPULATOR-X 기본 자세에서 시작) — 한도는 URDF 값
  var PI = Math.PI;
  var J = [
    { g: j1, axis: "z", q: 0, lo: -PI * 175 / 180, hi: PI * 175 / 180, parts: [l2], target: null },   // 실기체 URDF 수정값 ±175°
    { g: j2, axis: "y", q: -1.05, lo: -PI * 0.57, hi: PI * 0.5, parts: [l3], target: null },
    { g: j3, axis: "y", q: 0.35, lo: -PI * 0.3, hi: PI * 0.44, parts: [l4], target: null },
    { g: j4, axis: "y", q: 0.70, lo: -PI * 0.57, hi: PI * 0.65, parts: [l5], target: null }
  ];
  var grip = { q: 0.01, lo: -0.010, hi: 0.019, target: null };
  var drive = useArena ? { x: -1.0, y: 0.75, yaw: 0, v: 0, w: 0 }    // 시작: ㄱ자 왼쪽 끝, 오른쪽(+x) 방향
                       : { x: 0, y: 0, yaw: 0, v: 0, w: 0 };
  var KEYMAP = {
    "1": { joint: 0, dir: 1 }, q: { joint: 0, dir: -1 }, "2": { joint: 1, dir: 1 }, w: { joint: 1, dir: -1 },
    "3": { joint: 2, dir: 1 }, e: { joint: 2, dir: -1 }, "4": { joint: 3, dir: 1 }, r: { joint: 3, dir: -1 },
    o: { grip: 1 }, p: { grip: -1 }, i: { v: 0.05 }, k: { v: -0.05 }, j: { w: 0.3 }, l: { w: -0.3 }, " ": { stop: true }
  };
  var held = {};
  var ext = theme.external ? { x: drive.x, y: drive.y, yaw: drive.yaw, joints: [], grip: null, wheels: null } : null;
  var flash = 0, flashParts = [], selected = null;

  function partsFor(k) {
    var m = KEYMAP[k];
    if (!m) return [];
    if (m.joint !== undefined) return J[m.joint].parts;
    if (m.grip) return [gL, gR];
    if (m.stop) return [baseMesh];
    return [wl.mesh, wr.mesh];
  }
  function press(k) {
    var m = KEYMAP[k];
    if (!m || held[k]) return;
    held[k] = true;
    if (m.joint !== undefined) J[m.joint].target = null;
    if (m.grip) grip.target = null;
    if (m.v) drive.v = Math.max(-0.26, Math.min(0.26, drive.v + m.v));
    if (m.w) drive.w = Math.max(-1.82, Math.min(1.82, drive.w + m.w));
    if (m.stop) { drive.v = 0; drive.w = 0; }
    if (m.v || m.w || m.stop) { flash = 0.35; flashParts = partsFor(k); }
  }
  function release(k) { delete held[k]; }

  var yawView = theme.view === "showcase" ? 0.9 : 2.2, dist = theme.view === "showcase" ? 0.78 : 1.6;
  var dragging = null, idle = 0;
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  canvas.addEventListener("pointerdown", function (e) { dragging = { x: e.clientX, y: e.clientY, yaw: yawView, moved: false }; idle = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    if (Math.abs(e.clientX - dragging.x) + Math.abs(e.clientY - dragging.y) > 5) dragging.moved = true;
    yawView = dragging.yaw - (e.clientX - dragging.x) * 0.01; idle = 0;
  });
  var floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), floorHit = new THREE.Vector3();
  canvas.addEventListener("pointerup", function (e) {
    if (dragging && !dragging.moved && (theme.onPick || theme.onFloorClick)) {
      var r = canvas.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      var hit = ray.intersectObjects(pickables, false)[0];
      if (theme.onPick) theme.onPick(hit ? hit.object.userData.part : null);
      // 바닥(z = 0) 클릭 좌표를 ROS 좌표로 넘긴다: three (x, -, z) → ROS (x, −z)
      if (!hit && theme.onFloorClick && ray.ray.intersectPlane(floorPlane, floorHit)) theme.onFloorClick(floorHit.x, -floorHit.z);
    }
    dragging = null;
  });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault(); idle = 0;
    dist = Math.max(0.5, Math.min(theme.maxDist || 5.5, dist * (e.deltaY > 0 ? 1.1 : 0.9)));
  }, { passive: false });

  function resize() {
    var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }
  function approach(cur, target, step) { return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step; }

  var last = 0, raf = 0, alive = true;
  function tick(t) {
    if (!alive) return;
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0; last = t;
    idle += dt;
    Object.keys(held).forEach(function (k) {
      var m = KEYMAP[k];
      if (m.joint !== undefined) { var j = J[m.joint]; j.q = Math.max(j.lo, Math.min(j.hi, j.q + m.dir * 1.2 * dt)); }
      if (m.grip) grip.q = Math.max(grip.lo, Math.min(grip.hi, grip.q + m.grip * 0.03 * dt));
    });
    J.forEach(function (j) { if (j.target !== null) { j.q = approach(j.q, j.target, 1.5 * dt); if (j.q === j.target) j.target = null; } });
    if (grip.target !== null) { grip.q = approach(grip.q, grip.target, 0.04 * dt); if (grip.q === grip.target) grip.target = null; }

    if (ext) {
      // 받은 값을 부드럽게 따라간다(메시지 사이를 메움). 0.5 m 넘게 튀면 바로 옮긴다.
      var kk = 1 - Math.exp(-dt * 18);
      if (Math.hypot(ext.x - drive.x, ext.y - drive.y) > 0.5) { drive.x = ext.x; drive.y = ext.y; drive.yaw = ext.yaw; }
      drive.x += (ext.x - drive.x) * kk; drive.y += (ext.y - drive.y) * kk;
      drive.yaw += Math.atan2(Math.sin(ext.yaw - drive.yaw), Math.cos(ext.yaw - drive.yaw)) * kk;
      J.forEach(function (j, n) { var v = ext.joints[n]; if (v !== null && v !== undefined) j.q += (v - j.q) * kk; });
      if (ext.grip !== null && ext.grip !== undefined) grip.q += (ext.grip - grip.q) * kk;
      if (ext.wheels) { wl.spin.rotation.z = ext.wheels[0]; wr.spin.rotation.z = ext.wheels[1]; }   // URDF 바퀴 관절 각도 그대로
      footprint.position.set(drive.x, drive.y, 0); footprint.rotation.z = drive.yaw;
    } else {
    drive.yaw += drive.w * dt;
    var nx = drive.x + Math.cos(drive.yaw) * drive.v * dt, ny = drive.y + Math.sin(drive.yaw) * drive.v * dt;
    if (theme.collide) {
      var p = theme.collide(nx, ny, drive.x, drive.y);
      drive.x = p.x; drive.y = p.y;
    } else if (useArena) {
      if (inArena(nx, ny)) { drive.x = nx; drive.y = ny; }          // 벽에 닿으면 벽을 따라 미끄러진다
      else if (inArena(nx, drive.y)) { drive.x = nx; }
      else if (inArena(drive.x, ny)) { drive.y = ny; }
    } else {
      var rr = Math.hypot(nx, ny);
      if (rr < 0.6) { drive.x = nx; drive.y = ny; }
    }
    footprint.position.set(drive.x, drive.y, 0); footprint.rotation.z = drive.yaw;
    var spinL = (drive.v - drive.w * 0.144) / 0.033 * dt, spinR = (drive.v + drive.w * 0.144) / 0.033 * dt;
    wl.spin.rotation.z += spinL; wr.spin.rotation.z += spinR;      // 바퀴 관절 축은 +y(왼쪽): 전진이면 + 방향
    }
    J.forEach(function (j) { j.g.rotation.set(0, 0, 0); j.g.rotation[j.axis] = j.q; });

    explode.e = approach(explode.e, explode.target, 2.5 * dt);
    var e = explode.e * explode.e * (3 - 2 * explode.e);
    EXPLODE.forEach(function (x) { x[0].position.set(x[0].userData.pos0.x + x[1] * e, x[0].userData.pos0.y + x[2] * e, x[0].userData.pos0.z + x[3] * e); });
    gl.position.y = 0.021 + grip.q + 0.03 * e; gr.position.y = -0.021 - grip.q - 0.03 * e;

    var lit = [];
    Object.keys(held).forEach(function (k) { lit = lit.concat(partsFor(k)); });
    if (flash > 0) { flash -= dt; lit = lit.concat(flashParts); }
    if (drive.v || drive.w) lit = lit.concat([wl.mesh, wr.mesh]);
    if (selected) lit = lit.concat(PARTS[selected] || []);
    mats.forEach(function (m) { m.color.copy(m.userData.base); m.emissive.setRGB(0, 0, 0); });
    camMat.opacity = 0;
    lit.forEach(function (o) {
      if (o === camMesh) { camMat.opacity = 0.85; return; }
      o.material.color.copy(accent); o.material.emissive.copy(accent).multiplyScalar(0.25);
    });

    if (theme.onFrame) theme.onFrame(dt);
    resize();
    var cx = drive.x, cz = -drive.y;
    if (theme.view === "showcase") {
      if (idle > 4 && !dragging) yawView += 0.25 * dt;                 // 가만두면 천천히 돈다
      camera.position.set(cx + Math.cos(yawView) * dist, 0.16 + dist * 0.45, cz + Math.sin(yawView) * dist);
      camera.lookAt(cx - 0.02, 0.17 + 0.06 * e, cz);
    } else {
      camera.position.set(cx + Math.cos(yawView) * dist, 0.25 + dist * 0.55, cz + Math.sin(yawView) * dist);
      camera.lookAt(cx, 0.12, cz);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  var tmp = new THREE.Vector3();
  return {
    press: press,
    release: release,
    readout: function () {
      return {
        joints: J.map(function (j) { return j.q; }), grip: grip.q, v: drive.v, w: drive.w,
        x: drive.x, y: drive.y, yaw: drive.yaw,
        held: Object.keys(held)
      };
    },
    select: function (part) { selected = part && PARTS[part] ? part : null; },
    setExplode: function (on) { explode.target = on ? 1 : 0; },
    setDist: function (d) { dist = d; },
    setPose: function (joints, g) {
      joints.forEach(function (q, n) { var j = J[n]; j.target = Math.max(j.lo, Math.min(j.hi, q)); });
      if (g !== undefined && g !== null) grip.target = Math.max(grip.lo, Math.min(grip.hi, g));
    },
    // external 모드: 실제 로봇 상태. 모든 항목은 선택(주어진 것만 바꾼다)
    // { x, y, yaw (지도 좌표), joints: [joint1..4] (rad), grip: gripper_left_joint (m), wheels: [왼쪽, 오른쪽] (rad), v, w }
    setState: function (s) {
      if (!ext) return;
      if (s.x !== undefined) { ext.x = s.x; ext.y = s.y; ext.yaw = s.yaw; }
      if (s.joints) s.joints.forEach(function (q, n) { if (q !== null && q !== undefined) ext.joints[n] = q; });
      if (s.grip !== undefined) ext.grip = s.grip;
      if (s.wheels) ext.wheels = s.wheels;
      if (s.v !== undefined) drive.v = s.v;
      if (s.w !== undefined) drive.w = s.w;
    },
    // 부품 중심의 화면 좌표(캔버스 기준 px). 뒤쪽에 있으면 visible=false
    project: function (part) {
      var m = PARTS[part] && PARTS[part][0];
      if (!m) return null;
      m.geometry.boundingBox.getCenter(tmp); m.localToWorld(tmp); tmp.project(camera);
      return { x: (tmp.x + 1) / 2 * canvas.clientWidth, y: (1 - tmp.y) / 2 * canvas.clientHeight, visible: tmp.z < 1 };
    },
    // 그리퍼 끝(end_effector_link, link5 에서 0.126 m 앞)의 ROS 좌표
    tip: function () {
      world.updateMatrixWorld(true);                                 // 렌더 전에도 최신 관절 값으로 계산
      var v = new THREE.Vector3(0.126, 0, 0); j4.localToWorld(v); world.worldToLocal(v);
      return { x: v.x, y: v.y, z: v.z };
    },
    tipObject: j4,
    world: world,
    drive: drive,
    THREE: THREE,
    dispose: function () { alive = false; cancelAnimationFrame(raf); renderer.dispose(); }
  };
}
