// 기체 소개: 3D 기체 + 부품 설명. 값은 ROBOTIS e-Manual 과 turtlebot3_manipulation_description URDF 에서 가져왔다.
(function () {
  var PARTS = {
    base: { name: "본체 (waffle pi)", desc: "판을 층층이 쌓은 몸체 안에 제어 보드와 컴퓨터, 배터리가 들어 있어요.",
      spec: [["SBC", "Raspberry Pi 4"], ["MCU", "32-bit ARM Cortex-M7 (216 MHz)"], ["배터리", "리튬 폴리머 11.1 V 1800 mAh"], ["크기", "281 × 306 × 141 mm"]] },
    wheels: { name: "바퀴 · 구동 모터", desc: "양쪽 바퀴의 속도 차이로 앞뒤로 가고 제자리에서 돌아요 (차동 구동).",
      spec: [["모터", "DYNAMIXEL XM430-W210 × 2"], ["최대 속도", "0.26 m/s"], ["최대 회전", "1.82 rad/s"], ["teleop 키", "i · j · k · l · space"]] },
    lidar: { name: "LiDAR", desc: "레이저로 주변 360° 거리를 재요. 지도를 만들고(SLAM) 경로를 찾을 때 써요.",
      spec: [["모델", "360° Laser Distance Sensor LDS-02"], ["위치", "본체 위 (base_link 기준 높이 0.122 m)"]] },
    camera: { name: "카메라", desc: "앞쪽을 비추는 카메라예요. teleop 화면에서 연결하면 이 영상이 보여요.",
      spec: [["모델", "Raspberry Pi Camera Module v2.1"], ["teleop", "camera topic 으로 받아 표시"]] },
    link1: { name: "팔 받침", desc: "OpenMANIPULATOR-X 를 본체 위에 고정하는 첫 마디예요.",
      spec: [["고정 위치", "base_link 기준 x −0.092 m, z +0.091 m"], ["팔 길이", "380 mm (reach)"], ["팔 무게", "0.70 kg"]] },
    joint1: { name: "joint1 · 허리", desc: "팔 전체를 세로축으로 좌우 회전해요.",
      spec: [["모터", "DYNAMIXEL XM430-W350-T"], ["범위", "−162° ~ +162°"], ["teleop 키", "1 · q"]] },
    joint2: { name: "joint2 · 어깨", desc: "팔을 앞뒤로 숙이고 세워요.",
      spec: [["모터", "DYNAMIXEL XM430-W350-T"], ["범위", "−102.6° ~ +90°"], ["teleop 키", "2 · w"]] },
    joint3: { name: "joint3 · 팔꿈치", desc: "아래팔을 접고 펴요.",
      spec: [["모터", "DYNAMIXEL XM430-W350-T"], ["범위", "−54° ~ +79.2°"], ["teleop 키", "3 · e"]] },
    joint4: { name: "joint4 · 손목", desc: "그리퍼의 기울기를 맞춰요.",
      spec: [["모터", "DYNAMIXEL XM430-W350-T"], ["범위", "−102.6° ~ +117°"], ["teleop 키", "4 · r"]] },
    gripper: { name: "그리퍼", desc: "두 손가락이 평행하게 벌어지고 닫혀서 물건을 집어요.",
      spec: [["벌림", "20 – 75 mm"], ["손가락 이동", "−10 ~ +19 mm (URDF)"], ["들 수 있는 무게", "500 g"], ["teleop 키", "o · p"]] }
  };
  var HOME = [0, -1.05, 0.35, 0.70], REACH = [0, 0.8, -0.6, 0];

  var canvas = document.getElementById("robotCanvas"), msg = document.getElementById("robotMsg");
  var tag = document.getElementById("partTag"), detail = document.getElementById("partDetail");
  var buttons = Array.prototype.slice.call(document.querySelectorAll("#partList button"));
  if (!window.THREE || !window.TB3_MESHES || !window.createTB3Viewer) { msg.textContent = "3D 기체를 불러오지 못했습니다"; return; }

  var selected = null, viewer;
  function show(part) {
    selected = part;
    viewer.select(part);
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.part === part)); });
    detail.textContent = "";
    var h = document.createElement("h3"), p = document.createElement("p");
    if (!part) {
      h.textContent = "부품을 골라 보세요";
      p.textContent = "목록이나 3D 화면에서 부품을 누르면 역할과 사양이 여기에 나타나요.";
      detail.append(h, p); tag.hidden = true; return;
    }
    var d = PARTS[part];
    h.textContent = d.name; p.textContent = d.desc;
    var dl = document.createElement("dl");
    d.spec.forEach(function (s) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = s[0]; dd.textContent = s[1]; dl.append(dt, dd);
    });
    detail.append(h, p, dl);
    tag.textContent = d.name;
  }

  viewer = createTB3Viewer(THREE, canvas, TB3_MESHES, {
    accent: getComputedStyle(document.documentElement).getPropertyValue("--robot-accent").trim() || "%ACCENT%",
    body: "#3A3F47", arm: "#D9DCE1", tire: "#222428", grip: "#9AA0A8",
    ground: 0x223344, grid: 0x2A3442, gridMajor: 0x4A5666,
    arena: false, view: "showcase",
    onPick: function (part) { show(part === selected ? null : part); },
    onFrame: function () {
      if (!selected) return;
      var p = viewer.project(selected);
      tag.hidden = !p || !p.visible;
      if (p) { tag.style.left = p.x + "px"; tag.style.top = p.y + "px"; }
    }
  });
  msg.hidden = true;

  buttons.forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.part === selected ? null : b.dataset.part); }); });
  var ex = document.getElementById("btnExplode");
  ex.addEventListener("click", function () {
    var on = ex.getAttribute("aria-pressed") !== "true";
    ex.setAttribute("aria-pressed", String(on)); viewer.setExplode(on);
  });
  document.getElementById("btnHome").addEventListener("click", function () { viewer.setPose(HOME, 0.01); });
  document.getElementById("btnReach").addEventListener("click", function () { viewer.setPose(REACH, 0.019); });

  // 키보드로 관절 조종 (teleop 과 같은 키, 이 페이지에서는 주행 키는 쓰지 않는다)
  var KEYS = ["1", "2", "3", "4", "q", "w", "e", "r", "o", "p"];
  function isField(t) { return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"); }
  document.addEventListener("keydown", function (e) {
    if (isField(e.target) || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    var k = e.key.toLowerCase();
    if (KEYS.indexOf(k) >= 0) viewer.press(k);
  });
  document.addEventListener("keyup", function (e) { var k = e.key.toLowerCase(); if (KEYS.indexOf(k) >= 0) viewer.release(k); });
  window.addEventListener("blur", function () { KEYS.forEach(function (k) { viewer.release(k); }); });
})();
