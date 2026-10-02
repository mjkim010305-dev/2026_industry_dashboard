# 실시간 조종 서버 (실시간 + teleop + 지도 추정)

웹 "실시간 조종" 탭(`live.html`)의 서버. 한 프로세스가 두 가지를 한다.

1. **보기** — ROS 2 토픽을 구독만 해서(발행 없음) 브라우저로 넘긴다. 팔·바퀴·위치·LiDAR·지도·경로·카메라.
2. **조종** — 로봇에 ssh 로 들어가 터미널에서 `turtlebot3_manipulation_teleop` 을 켜고, 화면의 키 글자를 그대로 넣는다
   (teleop 은 토픽이 아니라 터미널 입력으로 키를 읽는다. 예전 teleop 탭의 bridge 와 같은 방식).

```
로봇: hardware.launch.py + servo.launch.py (미리 켜 둠)  ←─ ssh 터미널: teleop (서버가 켬, 키 글자 입력)
  │ DDS (ROS_DOMAIN_ID)  ← RViz 로 보는 것과 같은 구독
WSL (ROS 2 Humble): python3 ros/topic_relay.py   ── ros/config.yaml
  │ localhost (HTTP · SSE · MJPEG)
브라우저: http://localhost:8765/redesign/live.html  (기업별: /samsung/live.html …)
```

## 설정: `ros/config.yaml` (서버 쪽에서만 바꾼다)

| 항목 | 뜻 |
|---|---|
| `ros_domain_id` | ROS 2 도메인. 로봇 `~/.bashrc` 와 같게 (지금 30) |
| `topics.*` | 화면 역할 → 실제 토픽 이름 (joint_states, tf, tf_static, odom, cmd_vel, scan, map, plan, camera) |
| `rates.*` | 역할별 최대 전송 주기(Hz) |
| `teleop.*` | ssh 접속 정보(호스트·포트·계정·키 파일)와 teleop 명령. 화면에서는 못 바꾼다. **비밀번호는 쓰지 않는다(ssh 키)** |
| `predict.*` | 추정에 쓰는 값(teleop 소스의 속도 단계, 팔 한 칸 처음 값, 느림·끊김 기준 시간) |
| `server.*` | 서버 주소·포트 |

바꾼 뒤 서버를 다시 켠다. 다른 파일을 쓰려면 `--config 경로`.

## 실행 (WSL)

```bash
source /opt/ros/humble/setup.bash
pip install paramiko            # 조종(ssh)용. 없으면 보기만 된다 (또는 sudo apt install python3-paramiko)
python3 ros/topic_relay.py      # 브라우저: http://localhost:8765/redesign/live.html
```

- 로봇에서 먼저: `ros2 launch turtlebot3_manipulation_bringup hardware.launch.py`, `ros2 launch turtlebot3_manipulation_moveit_config servo.launch.py`
- 화면 "조종 시작" → 서버가 config.yaml 의 teleop 접속 정보로 ssh 접속해 teleop 을 켠다. 인증은 ssh 키뿐이라,
  WSL 에서 한 번 `ssh-keygen` 후 `ssh-copy-id ubuntu@192.168.0.21` 로 키를 등록해 둔다.
- 안전: 조종을 끊으면 정지(space) 후 teleop 을 끝낸다. 화면이 모두 닫히면 2초 뒤 정지를 보낸다. 창을 닫을 때도 정지를 보낸다.
- 카메라 JPEG 변환에는 `cv2`(python3-opencv)가 필요하다.

### WSL 에서 로봇 토픽이 안 보일 때
- WSL 이 NAT 모드면 DDS 멀티캐스트가 로봇까지 닿지 않는다. `%UserProfile%\.wslconfig` 에 `networkingMode=mirrored` 를 쓰고 `wsl --shutdown`.
- Windows 방화벽이 WSL 로 들어오는 UDP 를 막을 수 있다 (저장소 README 의 주의 참고).

## 통신이 나쁠 때 (화면 동작)

- 위치·관절 값이 `predict.fresh_sec`(0.5초) 넘게 안 오면 **추정**으로 바꾼다. `lost_sec`(3초)를 넘으면 '끊김'.
- 위치: 마지막으로 받은 위치에서, 보낸 키로 계산한 teleop 속도 명령(`/cmd_vel` 이 오면 그 값)으로 이어 간다. 지도 벽에 닿으면 멈춘다.
- 팔: 키를 누르면 바로 한 칸 움직여 보이고, 실제 `/joint_states` 가 따라오면 그 값으로 맞춘다. 한 칸 크기는 실제 움직임으로 자동 보정한다.
- 마지막으로 받은 실제 위치는 노란 고리로 남긴다. 신호가 돌아오면 실제 값으로 부드럽게 돌아간다.
- `/map` 을 못 받으면 로봇의 `map.yaml` + `map.pgm` 을 화면에 올린다(올린 지도가 우선).
- 통신이 끊긴 채 로봇이 움직이는 명령 상태면 빨간 경고를 띄운다(space 로 정지).

## ROS 없이 시험

```bash
uv run --no-project --with pyyaml python ros/mock_relay.py     # 또는 pip install pyyaml 후 python ros/mock_relay.py
curl -X POST localhost:8765/api/mock/network -d '{"freeze": true}'   # 통신 끊김 흉내 (false 로 되돌림, "drop": 0~1 은 일부 버림)
```

같은 API·같은 config 로 가짜 raw 메시지를 보낸다. "조종 연결"하면 ssh 대신 가짜 teleop 이 붙고, 키가 실제 teleop 규칙대로 모의 기체를 움직인다.

## 파일
- `config.yaml` · `settings.py` — 설정과 읽기
- `relay_http.py` — HTTP(토픽별 최신값만 정한 주기로 보냄, SSE · MJPEG · 조종 요청 · 정적 파일). ROS 없이 동작
- `topic_relay.py` — 실제: rclpy 구독 + ssh teleop
- `teleop_ssh.py` — ssh 터미널 teleop (paramiko)
- `mock_relay.py` — 시험: 가짜 데이터 + 가짜 teleop + 통신 끊김 흉내
- 브라우저 쪽: `tools/ros_live.js`(구독 · TF · 변환), `tools/pages/live.*`(화면)

## HTTP API
- `GET /api/config` — 역할별 토픽, 추정 값, teleop 기본값(비밀번호 없음)
- `GET /api/topics` — `[{name, type, subscribed, hz, image}]`
- `GET /api/stream?topics=/a,/b` — SSE. `event: msg` `{topic, type, stamp, msg}` (inf/nan → null), `event: teleop` `{state, reason, label, dropped}`
- `GET /api/image?topic=/x` — MJPEG
- `GET /api/teleop` · `POST /api/teleop/connect` (config 사용) · `POST /api/teleop/key {key}` · `POST /api/teleop/disconnect`
