# ROS 2 토픽 → 웹 "실시간" 탭

로봇의 ROS 2 토픽을 **구독만** 해서 브라우저(`live.html`)에 보여준다. 로봇에 아무것도 발행하지 않는다.

```
로봇 (bringup · teleop 은 지금처럼)
  │ DDS, ROS_DOMAIN_ID=30  ← RViz 로 보는 것과 같은 구독
WSL (ROS 2 Humble): python3 ros/topic_relay.py   (http://localhost:8765)
  │ localhost (HTTP, Server-Sent Events · MJPEG)
브라우저: http://localhost:8765/redesign/live.html  (기업별: /samsung/live.html …)
```

브라우저는 DDS 를 직접 쓸 수 없어서 중계 노드가 대신 구독해 JSON 으로 넘긴다. 메시지 필드는 `ros2 topic echo` 와 같은 구조 그대로다.
중계 노드는 로봇이 아닌 WSL(브라우저와 같은 PC)에서 돌린다. 로봇 쪽 부담은 RViz 를 하나 더 띄운 정도다.

## 실행 (WSL)

```bash
source /opt/ros/humble/setup.bash
export ROS_DOMAIN_ID=30                      # 로봇 ~/.bashrc 와 같게
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
cd <이 저장소>
python3 ros/topic_relay.py                   # 브라우저: http://localhost:8765/redesign/live.html
```

- 추가 설치 없음: `rclpy`, `rosidl_runtime_py` 는 ROS 에 들어 있다. 카메라 JPEG 변환에만 `cv2`(python3-opencv)가 필요하다.
- 토픽은 브라우저가 요청할 때 처음 구독한다. 화면 기본 목록: `/tf /tf_static /joint_states /odom /scan /map /plan`.
  토픽 표에서 "raw 보기"를 누르면 그 토픽도 구독한다.
- 카메라는 "영상 켜기"를 눌렀을 때만 구독하고, 640 px 폭 JPEG(10 fps 이하)으로 줄여 보낸다.
- 다른 PC 브라우저에서 보려면 `--host 0.0.0.0`. 인증이 없으니 연구실 내부망에서만 쓴다.

### WSL 에서 로봇 토픽이 안 보일 때
- WSL 이 NAT 모드면 DDS 멀티캐스트가 로봇까지 닿지 않는다. `%UserProfile%\.wslconfig` 에 `networkingMode=mirrored` 를 쓰고 `wsl --shutdown`.
- Windows 방화벽이 WSL 로 들어오는 UDP 를 막을 수 있다 (저장소 README 의 주의 참고).
- 먼저 `ros2 topic list` 로 로봇 토픽이 보이는지 확인한다.

## ROS 없이 시험

```bash
python ros/mock_relay.py      # 표준 라이브러리만. 같은 API 로 가짜 raw 메시지를 보낸다
```

`data/real.yaml`(없으면 `samples/nav2_map/map.yaml`) 지도 안을 기체가 돌아다니고, 팔·그리퍼가 움직이고,
지도 벽으로 만든 `/scan`, `/plan`, 카메라(포스터 그림)를 보낸다.

## 화면에 쓰는 토픽 (실기체에서 확인한 이름)

| 화면 | 토픽 | 비고 |
|---|---|---|
| 팔 4관절 · 그리퍼 · 바퀴 회전 | `/joint_states` | joint1~4, gripper_left_joint, wheel_left/right_joint (이름으로 찾음) |
| 지도 위 위치 | `/tf`, `/tf_static` | map → odom → base_footprint. map 이 없으면 odom 기준 |
| 속도 | `/odom` | diff_drive_controller (엔코더 기반) |
| 지도 | `/map` | OccupancyGrid, 65 이상 = 막힘 |
| LiDAR | `/scan` | 프레임은 TF 로 찾음 |
| 경로 | `/plan` | Nav2 |
| 카메라 | `/camera/camera/color/image_raw` | RealSense D555 |

## 파일
- `relay_http.py` — HTTP 부분(토픽별 최신값만 정한 주기로 보냄, SSE · MJPEG · 정적 파일). ROS 없이 동작
- `topic_relay.py` — rclpy 구독(실제)
- `mock_relay.py` — 가짜 데이터(시험)
- 브라우저 쪽: `tools/ros_live.js`(구독 · TF · 변환), `tools/pages/live.*`(화면)

## HTTP API
- `GET /api/topics` — `[{name, type, subscribed, hz, image}]`
- `GET /api/stream?topics=/a,/b` — SSE, `event: msg`, `data: {topic, type, stamp, msg}` (inf/nan 은 null)
- `GET /api/image?topic=/x` — MJPEG
