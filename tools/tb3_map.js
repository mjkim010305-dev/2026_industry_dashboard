// 점유 격자 지도: Nav2 map_server 형식(yaml + pgm/png) 읽기, 기본 ㄱ자 경기장 만들기, 충돌 조회, 3D·미니맵 그리기.
// 칸 값: 0 = 빈칸, 1 = 막힘, 2 = 모름. 좌표는 ROS map 프레임(m).
var TB3Map = (function () {
  var FREE = 0, OCC = 1, UNKNOWN = 2;

  // ---------- 읽기 ----------
  // map.yaml 의 필요한 키만 읽는다: image, resolution, origin, negate, occupied_thresh, free_thresh, mode
  function parseYaml(text) {
    var out = {};
    text.split(/\r?\n/).forEach(function (line) {
      var m = line.replace(/#.*$/, "").match(/^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/);
      if (!m) return;
      var v = m[2].replace(/^["']|["']$/g, "");
      if (/^\[.*\]$/.test(v)) out[m[1]] = v.slice(1, -1).split(",").map(function (s) { return parseFloat(s); });
      else if (!isNaN(parseFloat(v)) && /^[-+0-9.eE]+$/.test(v)) out[m[1]] = parseFloat(v);
      else out[m[1]] = v;
    });
    if (!(out.resolution > 0)) throw new Error("yaml 에 resolution 이 없어요");
    if (!out.origin || out.origin.length < 2) throw new Error("yaml 에 origin 이 없어요");
    if (!out.image) throw new Error("yaml 에 image 가 없어요");
    return {
      image: String(out.image), resolution: out.resolution, origin: [out.origin[0], out.origin[1], out.origin[2] || 0],
      negate: out.negate ? 1 : 0,
      occupied_thresh: out.occupied_thresh !== undefined ? out.occupied_thresh : 0.65,
      free_thresh: out.free_thresh !== undefined ? out.free_thresh : 0.25,
      mode: out.mode || "trinary"
    };
  }

  // PGM (P5 이진 / P2 글자) → { width, height, data: Uint8Array(0~255) }
  function parsePGM(buf) {
    var bytes = new Uint8Array(buf), pos = 0;
    function token() {
      for (;;) {
        while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++;
        if (bytes[pos] === 35) { while (pos < bytes.length && bytes[pos] !== 10) pos++; continue; }   // # 주석
        break;
      }
      var s = "";
      while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos]))) s += String.fromCharCode(bytes[pos++]);
      return s;
    }
    var magic = token();
    if (magic !== "P5" && magic !== "P2") throw new Error("PGM 형식(P5/P2)이 아니에요");
    var w = parseInt(token(), 10), h = parseInt(token(), 10), max = parseInt(token(), 10);
    if (!(w > 0 && h > 0 && max > 0)) throw new Error("PGM 머리글을 읽지 못했어요");
    var data = new Uint8Array(w * h);
    if (magic === "P5") {
      pos++;                                                     // 머리글 뒤 공백 한 칸
      var two = max > 255;
      for (var n = 0; n < w * h; n++) {
        var v = two ? (bytes[pos + 2 * n] << 8) | bytes[pos + 2 * n + 1] : bytes[pos + n];
        data[n] = Math.round(v * 255 / max);
      }
    } else {
      for (var k = 0; k < w * h; k++) data[k] = Math.round(parseInt(token(), 10) * 255 / max);
    }
    return { width: w, height: h, data: data };
  }

  // PNG 등 브라우저가 읽는 이미지 → 밝기 배열
  function decodeImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        var g = c.getContext("2d"); g.drawImage(img, 0, 0);
        var px = g.getImageData(0, 0, c.width, c.height).data, data = new Uint8Array(c.width * c.height);
        for (var n = 0; n < data.length; n++) data[n] = Math.round((px[4 * n] + px[4 * n + 1] + px[4 * n + 2]) / 3);
        URL.revokeObjectURL(url);
        resolve({ width: c.width, height: c.height, data: data });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("이미지를 읽지 못했어요")); };
      img.src = url;
    });
  }

  // map_server 와 같은 판정: p = (255 − v) / 255 (negate 면 v / 255), p > occupied → 막힘, p < free → 빈칸, 사이 → 모름
  function fromImage(meta, img, name) {
    var cells = new Uint8Array(img.width * img.height);
    for (var n = 0; n < cells.length; n++) {
      var v = img.data[n], p = meta.negate ? v / 255 : (255 - v) / 255;
      cells[n] = p > meta.occupied_thresh ? OCC : p < meta.free_thresh ? FREE : UNKNOWN;
    }
    return make(img.width, img.height, meta.resolution, meta.origin, cells, name || meta.image);
  }

  // 파일 목록(yaml + 이미지)에서 지도 만들기
  function fromFiles(files) {
    var list = Array.prototype.slice.call(files);
    var yamlFile = list.filter(function (f) { return /\.ya?ml$/i.test(f.name); })[0];
    if (!yamlFile) return Promise.reject(new Error("map.yaml 을 함께 골라 주세요"));
    return yamlFile.text().then(function (text) {
      var meta = parseYaml(text);
      var base = meta.image.split(/[\\/]/).pop();
      var imgFile = list.filter(function (f) { return f.name === base; })[0]
        || list.filter(function (f) { return /\.(pgm|png|jpe?g|bmp)$/i.test(f.name); })[0];
      if (!imgFile) throw new Error("yaml 의 image(" + base + ") 파일을 함께 골라 주세요");
      var read = /\.pgm$/i.test(imgFile.name) ? imgFile.arrayBuffer().then(parsePGM) : decodeImage(imgFile);
      return read.then(function (img) { return fromImage(meta, img, yamlFile.name); });
    });
  }

  // ---------- 기본 경기장: 3 m × 3 m 안의 ㄱ자(폭 1.5 m) ----------
  function defaultArena() {
    var res = 0.05, H = 1.5, pad = 2, n = Math.round(2 * H / res) + 2 * pad;
    var origin = [-H - pad * res, -H - pad * res, 0], cells = new Uint8Array(n * n);
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var x = origin[0] + (c + 0.5) * res, y = origin[1] + (n - r - 0.5) * res;
      var inside = Math.abs(x) < H && Math.abs(y) < H && (y > 0 || x > 0);
      cells[r * n + c] = inside ? FREE : UNKNOWN;
    }
    // 빈칸과 닿은 바깥 칸을 벽(막힘)으로
    var out = cells.slice();
    for (var r2 = 0; r2 < n; r2++) for (var c2 = 0; c2 < n; c2++) {
      if (cells[r2 * n + c2] === FREE) continue;
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
        var rr = r2 + dr, cc = c2 + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && cells[rr * n + cc] === FREE) out[r2 * n + c2] = OCC;
      }
    }
    return make(n, n, res, origin, out, "기본 경기장 (ㄱ자 3 m × 3 m)");
  }

  function make(width, height, res, origin, cells, name) {
    var cy = Math.cos(origin[2]), sy = Math.sin(origin[2]);
    var map = { width: width, height: height, res: res, origin: origin, cells: cells, name: name };
    // ROS 좌표 → 칸 (밖이면 null)
    map.cellAt = function (x, y) {
      var dx = x - origin[0], dy = y - origin[1];
      var lx = cy * dx + sy * dy, ly = -sy * dx + cy * dy;
      var c = Math.floor(lx / res), r = height - 1 - Math.floor(ly / res);
      if (c < 0 || r < 0 || c >= width || r >= height) return null;
      return r * width + c;
    };
    map.valueAt = function (x, y) { var i = map.cellAt(x, y); return i === null ? UNKNOWN : cells[i]; };
    map.isFree = function (x, y) { return map.valueAt(x, y) === FREE; };
    // 원(중심, 반지름) 안이 모두 빈칸인지
    map.circleFree = function (x, y, rad) {
      var step = res * 0.7;
      for (var ox = -rad; ox <= rad + 1e-9; ox += step) for (var oy = -rad; oy <= rad + 1e-9; oy += step) {
        if (ox * ox + oy * oy > rad * rad) continue;
        if (!map.isFree(x + ox, y + oy)) return false;
      }
      return map.isFree(x, y);
    };
    map.rectFree = function (x, y, sx, sy) {
      var step = res * 0.7;
      for (var ox = -sx / 2; ox <= sx / 2 + 1e-9; ox += step) for (var oy = -sy / 2; oy <= sy / 2 + 1e-9; oy += step)
        if (!map.isFree(x + ox, y + oy)) return false;
      return map.isFree(x + sx / 2, y + sy / 2) && map.isFree(x - sx / 2, y - sy / 2);
    };
    // 칸 중심의 ROS 좌표
    map.cellCenter = function (c, r) {
      var lx = (c + 0.5) * res, ly = (height - r - 0.5) * res;
      return { x: origin[0] + cy * lx - sy * ly, y: origin[1] + sy * lx + cy * ly };
    };
    // 네 귀퉁이 (ROS 좌표) — 화면 맞춤용
    map.bounds = function () {
      var pts = [[0, 0], [width, 0], [0, height], [width, height]].map(function (p) {
        var lx = p[0] * res, ly = p[1] * res; return [origin[0] + cy * lx - sy * ly, origin[1] + sy * lx + cy * ly];
      });
      var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      return { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) };
    };
    // (x, y) 가까이에서 반지름 rad 원이 들어가는 빈 자리 찾기
    map.nearestFree = function (x, y, rad) {
      if (map.circleFree(x, y, rad)) return { x: x, y: y };
      for (var ring = 1; ring < 400; ring++) {
        var d = ring * res;
        for (var a = 0; a < 16 + ring; a++) {
          var t = a / (16 + ring) * Math.PI * 2, px = x + Math.cos(t) * d, py = y + Math.sin(t) * d;
          if (map.circleFree(px, py, rad)) return { x: px, y: py };
        }
      }
      return null;
    };
    return map;
  }

  // ---------- 3D ----------
  // 막힌 칸을 큰 직사각형으로 묶어(greedy) 벽 높이만큼 세운다. 바닥은 지도 그림(빈칸 = 바닥색, 0.5 m 바둑판).
  function build3D(THREE, map, opts) {
    var group = new THREE.Group(), W = map.width, Hh = map.height, res = map.res;
    group.position.set(map.origin[0], map.origin[1], 0);
    group.rotation.z = map.origin[2];
    // 바닥 텍스처
    var cnv = document.createElement("canvas"); cnv.width = W; cnv.height = Hh;
    var g = cnv.getContext("2d"), img = g.createImageData(W, Hh), checker = Math.max(1, Math.round(0.5 / res));
    for (var r = 0; r < Hh; r++) for (var c = 0; c < W; c++) {
      var i = r * W + c, v = map.cells[i], o = 4 * i;
      var col = v === FREE ? (((Math.floor(c / checker) + Math.floor((Hh - 1 - r) / checker)) % 2) ? [38, 48, 60] : [31, 40, 51])
              : v === OCC ? [150, 158, 170] : [11, 15, 20];
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cnv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter;
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(W * res, Hh * res), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    floor.position.set(W * res / 2, Hh * res / 2, 0);
    group.add(floor);
    // 벽: greedy 직사각형
    var done = new Uint8Array(W * Hh), rects = [];
    for (var rr = 0; rr < Hh; rr++) for (var cc = 0; cc < W; cc++) {
      var k = rr * W + cc;
      if (map.cells[k] !== OCC || done[k]) continue;
      var w = 1;
      while (cc + w < W && map.cells[k + w] === OCC && !done[k + w]) w++;
      var h = 1, ok = true;
      while (ok && rr + h < Hh) {
        for (var q = 0; q < w; q++) { var kk = (rr + h) * W + cc + q; if (map.cells[kk] !== OCC || done[kk]) { ok = false; break; } }
        if (ok) h++;
      }
      for (var a = 0; a < h; a++) for (var b = 0; b < w; b++) done[(rr + a) * W + cc + b] = 1;
      rects.push([cc, rr, w, h]);
    }
    var wallH = opts.wallHeight || 0.15;
    var inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: opts.wall || 0xC9CED6, roughness: 0.7 }), Math.max(rects.length, 1));
    var m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    rects.forEach(function (rc, n) {
      p3.set((rc[0] + rc[2] / 2) * res, (Hh - rc[1] - rc[3] / 2) * res, wallH / 2);
      s3.set(rc[2] * res, rc[3] * res, wallH);
      inst.setMatrixAt(n, m4.compose(p3, q4, s3));
    });
    inst.count = rects.length;
    group.add(inst);
    group.userData.walls = rects.length;
    return group;
  }

  // ---------- 미니맵 ----------
  function minimapBase(map, size) {
    var b = map.bounds(), span = Math.max(b.maxX - b.minX, b.maxY - b.minY), pad = span * 0.04;
    var scale = (size - 2) / (span + 2 * pad);
    var cnv = document.createElement("canvas"); cnv.width = size; cnv.height = size;
    var g = cnv.getContext("2d");
    g.fillStyle = "#0B0F14"; g.fillRect(0, 0, size, size);
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    function toPx(x, y) { return [size / 2 + (x - cx) * scale, size / 2 - (y - cy) * scale]; }
    var step = Math.max(1, Math.floor(map.width / size));
    var cell = Math.max(1, map.res * scale * step + 0.6);
    for (var r = 0; r < map.height; r += step) for (var c = 0; c < map.width; c += step) {
      var v = map.cells[r * map.width + c];
      if (v === UNKNOWN) continue;
      var p = map.cellCenter(c, r), q = toPx(p.x, p.y);
      g.fillStyle = v === FREE ? "#1A222C" : "#C9CED6";
      g.fillRect(q[0] - cell / 2, q[1] - cell / 2, cell, cell);
    }
    return { canvas: cnv, toPx: toPx, scale: scale };
  }

  return { FREE: FREE, OCC: OCC, UNKNOWN: UNKNOWN, parseYaml: parseYaml, parsePGM: parsePGM, fromImage: fromImage,
    fromFiles: fromFiles, defaultArena: defaultArena, build3D: build3D, minimapBase: minimapBase };
})();
