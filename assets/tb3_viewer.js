// turtlebot3_manipulation 3D 뷰어. 관절 구조와 mesh 위치는 공식 URDF(turtlebot3_manipulation_description)를 그대로 따른다.
// createTB3Viewer(THREE, canvas, data, theme) → { press(key), release(key), readout(), dispose() }
function createTB3Viewer(THREE, canvas, data, theme) {
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 40);
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
    return g;
  }
  function mesh(name, color) {
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.1, flatShading: true });
    m.userData.base = new THREE.Color(color);
    mats.push(m);
    return new THREE.Mesh(geom(name), m);
  }
  function group(parent, x, y, z) { var g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

  // ROS(z 위) → three(y 위)
  var world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);

  // 경기장: 3 m × 3 m 정사각형 안의 ㄱ자 통로(폭 1.5 m). 원점은 정사각형 가운데, 위 = +y, 오른쪽 = +x.
  // 위쪽 띠 y ∈ [0, 1.5] (가로 3 m) + 오른쪽 띠 x ∈ [0, 1.5] (세로 3 m). 왼쪽 아래 1.5 m × 1.5 m 는 막혀 있다.
  var H = 1.5, ROBOT_R = 0.2;
  var ARENA = [[-H, 0], [-H, H], [H, H], [H, -H], [0, -H], [0, 0]];
  function inArena(x, y) {
    var m = ROBOT_R;
    if (x < -H + m || x > H - m || y < -H + m || y > H - m) return false;
    return y >= m || x >= m;
  }
  var shape = new THREE.Shape();
  ARENA.forEach(function (p, n) { if (n) shape.lineTo(p[0], p[1]); else shape.moveTo(p[0], p[1]); });
  var floor = new THREE.Mesh(new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: theme.floor || 0x1A222C, roughness: 0.95, metalness: 0 }));
  world.add(floor);
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

  var footprint = group(world, 0, 0, 0);
  var baseLink = group(footprint, 0, 0, 0.010);
  var baseMesh = mesh("base", theme.body); baseMesh.position.set(-0.064, 0, 0); baseLink.add(baseMesh);
  function wheel(y, name) {
    var j = group(baseLink, 0, y, 0.023); j.rotation.x = -1.57;
    var spin = group(j, 0, 0, 0);
    var m = mesh(name, theme.tire); m.rotation.x = 1.57; spin.add(m);
    return { spin: spin, mesh: m };
  }
  var wl = wheel(0.144, "left_tire"), wr = wheel(-0.144, "right_tire");
  var ladar = group(baseLink, -0.024, 0, 0.122); ladar.add(mesh("ladar", theme.tire));
  var link1 = group(baseLink, -0.092, 0, 0.091); var l1 = mesh("link1", theme.arm); link1.add(l1);
  var j1 = group(link1, 0.012, 0, 0.017); var l2 = mesh("link2", theme.arm); l2.position.z = 0.019; j1.add(l2);
  var j2 = group(j1, 0, 0, 0.0595); var l3 = mesh("link3", theme.arm); j2.add(l3);
  var j3 = group(j2, 0.024, 0, 0.128); var l4 = mesh("link4", theme.arm); j3.add(l4);
  var j4 = group(j3, 0.124, 0, 0); var l5 = mesh("link5", theme.arm); j4.add(l5);
  var gl = group(j4, 0.0817, 0.021, 0); var gL = mesh("gripper_left_palm", theme.grip); gl.add(gL);
  var gr = group(j4, 0.0817, -0.021, 0); var gR = mesh("gripper_right_palm", theme.grip); gr.add(gR);

  // 관절 상태 (OpenMANIPULATOR-X 기본 자세에서 시작) — 한도는 URDF 값
  var PI = Math.PI;
  var J = [
    { g: j1, axis: "z", q: 0, lo: -PI * 0.9, hi: PI * 0.9, parts: [l2] },
    { g: j2, axis: "y", q: -1.05, lo: -PI * 0.57, hi: PI * 0.5, parts: [l3] },
    { g: j3, axis: "y", q: 0.35, lo: -PI * 0.3, hi: PI * 0.44, parts: [l4] },
    { g: j4, axis: "y", q: 0.70, lo: -PI * 0.57, hi: PI * 0.65, parts: [l5] }
  ];
  var grip = { q: 0.01, lo: -0.010, hi: 0.019 };
  var drive = { x: -1.0, y: 0.75, yaw: 0, v: 0, w: 0 };   // 시작: ㄱ자 왼쪽 끝, 오른쪽(+x) 방향
  var KEYMAP = {
    "1": { joint: 0, dir: 1 }, q: { joint: 0, dir: -1 }, "2": { joint: 1, dir: 1 }, w: { joint: 1, dir: -1 },
    "3": { joint: 2, dir: 1 }, e: { joint: 2, dir: -1 }, "4": { joint: 3, dir: 1 }, r: { joint: 3, dir: -1 },
    o: { grip: 1 }, p: { grip: -1 }, i: { v: 0.05 }, k: { v: -0.05 }, j: { w: 0.3 }, l: { w: -0.3 }, " ": { stop: true }
  };
  var held = {};
  var flash = 0, flashParts = [];

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
    if (m.v) drive.v = Math.max(-0.26, Math.min(0.26, drive.v + m.v));
    if (m.w) drive.w = Math.max(-1.8, Math.min(1.8, drive.w + m.w));
    if (m.stop) { drive.v = 0; drive.w = 0; }
    if (m.v || m.w || m.stop) { flash = 0.35; flashParts = partsFor(k); }
  }
  function release(k) { delete held[k]; }

  var yawView = 2.2, dist = 1.6, dragging = null;
  canvas.addEventListener("pointerdown", function (e) { dragging = { x: e.clientX, yaw: yawView }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", function (e) { if (dragging) yawView = dragging.yaw - (e.clientX - dragging.x) * 0.01; });
  canvas.addEventListener("pointerup", function () { dragging = null; });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    dist = Math.max(0.6, Math.min(5.5, dist * (e.deltaY > 0 ? 1.1 : 0.9)));
  }, { passive: false });

  function resize() {
    var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }

  var last = 0, raf = 0, alive = true;
  function tick(t) {
    if (!alive) return;
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0; last = t;
    Object.keys(held).forEach(function (k) {
      var m = KEYMAP[k];
      if (m.joint !== undefined) { var j = J[m.joint]; j.q = Math.max(j.lo, Math.min(j.hi, j.q + m.dir * 1.2 * dt)); }
      if (m.grip) grip.q = Math.max(grip.lo, Math.min(grip.hi, grip.q + m.grip * 0.03 * dt));
    });
    drive.yaw += drive.w * dt;
    var nx = drive.x + Math.cos(drive.yaw) * drive.v * dt, ny = drive.y + Math.sin(drive.yaw) * drive.v * dt;
    if (inArena(nx, ny)) { drive.x = nx; drive.y = ny; }          // 벽에 닿으면 벽을 따라 미끄러진다
    else if (inArena(nx, drive.y)) { drive.x = nx; }
    else if (inArena(drive.x, ny)) { drive.y = ny; }
    footprint.position.set(drive.x, drive.y, 0); footprint.rotation.z = drive.yaw;
    var spinL = (drive.v - drive.w * 0.144) / 0.033 * dt, spinR = (drive.v + drive.w * 0.144) / 0.033 * dt;
    wl.spin.rotation.z -= spinL; wr.spin.rotation.z -= spinR;
    J.forEach(function (j) { j.g.rotation.set(0, 0, 0); j.g.rotation[j.axis] = j.q; });
    gl.position.y = 0.021 + grip.q; gr.position.y = -0.021 - grip.q;

    var lit = [];
    Object.keys(held).forEach(function (k) { lit = lit.concat(partsFor(k)); });
    if (flash > 0) { flash -= dt; lit = lit.concat(flashParts); }
    if (drive.v || drive.w) lit = lit.concat([wl.mesh, wr.mesh]);
    mats.forEach(function (m) { m.color.copy(m.userData.base); m.emissive.setRGB(0, 0, 0); });
    lit.forEach(function (o) { o.material.color.copy(accent); o.material.emissive.copy(accent).multiplyScalar(0.25); });

    resize();
    var cx = drive.x, cz = -drive.y;                                 // 기체를 따라가는 카메라
    camera.position.set(cx + Math.cos(yawView) * dist, 0.25 + dist * 0.55, cz + Math.sin(yawView) * dist);
    camera.lookAt(cx, 0.12, cz);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

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
    dispose: function () { alive = false; cancelAnimationFrame(raf); renderer.dispose(); }
  };
}
