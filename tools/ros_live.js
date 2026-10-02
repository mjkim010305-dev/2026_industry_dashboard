// 중계 서버(ros/topic_relay.py 또는 ros/mock_relay.py)에서 raw ROS 메시지를 받는다. 구독 전용(로봇에 보내는 것 없음).
// TB3Live.connect(base, topics, { message(d), status(s) }) → { close() }   d = { topic, type, stamp, msg }
// TB3Live.TFBuffer() · jointState(msg) · gridToMap(msg) · scanPoints(msg, pose) · pathPoints(msg) · imageUrl(base, topic)
var TB3Live = (function () {
  function connect(base, topics, on) {
    var es = new EventSource(base.replace(/\/$/, "") + "/api/stream?topics=" + encodeURIComponent(topics.join(",")));
    es.addEventListener("open", function () { on.status("open"); });
    es.addEventListener("error", function () { on.status(es.readyState === 2 ? "closed" : "retry"); });
    es.addEventListener("msg", function (e) {
      var d;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      on.message(d);
    });
    return { close: function () { es.close(); on.status("closed"); } };
  }
  function listTopics(base) {
    return fetch(base.replace(/\/$/, "") + "/api/topics", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function imageUrl(base, topic) { return base.replace(/\/$/, "") + "/api/image?topic=" + encodeURIComponent(topic); }

  // ---------- TF (평면: x, y, yaw 만 쓴다) ----------
  function yawOf(q) { return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)); }
  function compose(a, b) {     // a ∘ b : b 를 a 프레임 안에 놓기
    var c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    return { x: a.x + c * b.x - s * b.y, y: a.y + s * b.x + c * b.y, yaw: a.yaw + b.yaw };
  }
  function TFBuffer() {
    var frames = {};   // child → { parent, x, y, yaw }
    function strip(f) { return (f || "").replace(/^\//, ""); }
    return {
      update: function (msg) {
        (msg.transforms || []).forEach(function (t) {
          var tr = t.transform.translation;
          frames[strip(t.child_frame_id)] = { parent: strip(t.header.frame_id), x: tr.x, y: tr.y, yaw: yawOf(t.transform.rotation) };
        });
      },
      // frame 의 자세를 fixed 프레임 기준으로. 이어지지 않으면 null
      lookup: function (frame, fixed) {
        var f = strip(frame), p = { x: 0, y: 0, yaw: 0 }, guard = 0;
        while (f !== fixed) {
          var t = frames[f];
          if (!t || guard++ > 32) return null;
          p = compose(t, p); f = t.parent;
        }
        return p;
      },
      has: function (f) { return !!frames[strip(f)]; },
      // 고정 프레임: map 이 이어져 있으면 map, 아니면 odom, 아니면 가장 위
      fixedFor: function (frame) {
        var f = strip(frame), chain = [f], guard = 0;
        while (frames[f] && guard++ < 32) { f = frames[f].parent; chain.push(f); }
        return chain.indexOf("map") >= 0 ? "map" : chain.indexOf("odom") >= 0 ? "odom" : f;
      },
      frames: function () { return frames; }
    };
  }

  // ---------- sensor_msgs/JointState ----------
  // 이름으로 찾는다(순서는 로봇마다 다르다). 없는 관절은 null
  function jointState(msg) {
    var idx = {};
    (msg.name || []).forEach(function (n, i) { idx[n] = i; });
    function pos(n) { return idx[n] === undefined ? null : msg.position[idx[n]]; }
    var wl = pos("wheel_left_joint"), wr = pos("wheel_right_joint");
    return {
      joints: [pos("joint1"), pos("joint2"), pos("joint3"), pos("joint4")],
      grip: pos("gripper_left_joint"),
      wheels: wl === null || wr === null ? null : [wl, wr]
    };
  }

  // ---------- nav_msgs/OccupancyGrid → TB3Map ----------
  // OccupancyGrid 는 아래 줄(원점)부터, TB3Map 은 그림처럼 위 줄부터. 값: -1 모름, 0~100 점유 확률(%)
  function gridToMap(msg, name, occupied) {
    var w = msg.info.width, h = msg.info.height, o = msg.info.origin, thr = occupied === undefined ? 65 : occupied;
    var cells = new Uint8Array(w * h), d = msg.data;
    for (var r = 0; r < h; r++) {
      var src = (h - 1 - r) * w, dst = r * w;
      for (var c = 0; c < w; c++) {
        var v = d[src + c];
        cells[dst + c] = v < 0 ? TB3Map.UNKNOWN : v >= thr ? TB3Map.OCC : TB3Map.FREE;
      }
    }
    return TB3Map.make(w, h, msg.info.resolution, [o.position.x, o.position.y, yawOf(o.orientation)], cells, name || "/map");
  }
  // 같은 지도를 다시 받았는지(다시 그릴 필요 없는지) 가볍게 확인
  function gridKey(msg) {
    var d = msg.data, s = 0, step = Math.max(1, Math.floor(d.length / 4096));
    for (var n = 0; n < d.length; n += step) s = (s * 31 + d[n] + 2) | 0;
    return [msg.info.width, msg.info.height, msg.info.resolution, msg.info.origin.position.x, msg.info.origin.position.y, s].join("|");
  }

  // ---------- sensor_msgs/LaserScan → 고정 프레임 점들 ----------
  function scanPoints(msg, pose) {
    var out = [], c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    for (var i = 0; i < msg.ranges.length; i++) {
      var r = msg.ranges[i];
      if (r === null || !(r >= msg.range_min && r <= msg.range_max)) continue;
      var a = msg.angle_min + i * msg.angle_increment, lx = r * Math.cos(a), ly = r * Math.sin(a);
      out.push(pose.x + c * lx - s * ly, pose.y + s * lx + c * ly);
    }
    return out;
  }

  // ---------- nav_msgs/Path → [x, y, ...] (경로 프레임 기준) ----------
  function pathPoints(msg) {
    var out = [];
    (msg.poses || []).forEach(function (p) { out.push(p.pose.position.x, p.pose.position.y); });
    return out;
  }

  return { connect: connect, listTopics: listTopics, imageUrl: imageUrl, TFBuffer: TFBuffer, yawOf: yawOf, compose: compose,
           jointState: jointState, gridToMap: gridToMap, gridKey: gridKey, scanPoints: scanPoints, pathPoints: pathPoints };
})();
