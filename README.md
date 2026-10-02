"# 2026_industry_dashboard" 
# 주의!
window 환경에서 wsl를 통해서 접근할 경우, window -> wsl의 firewall inbound 설정 확인해야함

# MoNa 대시보드

탭: 시연 영상 · 기체 · 실시간 조종 · 설문. 통합 스타일은 `redesign/`, 기업별 스타일은 `samsung/ lg/ apple/ microsoft/ amazon/` 폴더에 있다.
페이지는 `tools/build_styles.py` 로 만든다(직접 고치지 말고 `tools/pages/*`, `redesign/demo-video.html`, `redesign/survey.html` 을 고친 뒤 다시 빌드).

## 실시간 조종 작동 방법

실시간 조종 탭은 서버(`ros/topic_relay.py`)가 있어야 동작한다. 서버는 ROS 2 토픽을 구독해서 화면에 보내고(로봇에 발행하지 않음),
"조종 시작"을 누르면 로봇에 ssh 로 들어가 터미널에서 `turtlebot3_manipulation_teleop` 을 켜고 화면의 키를 그대로 넣는다.
자세한 구조와 API 는 [ros/README.md](ros/README.md).

### 1. 로봇에서 먼저 켜 둘 것 (ssh ubuntu@192.168.0.21)

```bash
ros2 launch turtlebot3_manipulation_bringup hardware.launch.py
ros2 launch turtlebot3_manipulation_moveit_config servo.launch.py      # 팔 키(1~4, q~r)에 필요
# 있으면 화면이 더 풍부해진다(선택)
LD_PRELOAD=/lib/aarch64-linux-gnu/librealsense2.so.2.58 ros2 launch realsense2_camera rs_launch.py   # 카메라
ros2 launch nav2_bringup bringup_launch.py map:=/home/ubuntu/turtlebot3_ws/src/real.yaml \
  params_file:=/home/ubuntu/turtlebot3_ws/src/L_corridor_nav2.yaml                                   # /map, /plan, 지도 위 위치
```

teleop 은 켜 두지 않는다. 서버가 "조종 시작" 때 켠다.

### 2. WSL 준비 (처음 한 번)

1. ROS 2 Humble 이 설치된 WSL 을 쓴다.
2. 로봇 토픽이 보이게 네트워크를 맞춘다.
   - `%UserProfile%\.wslconfig` 에 `[wsl2]` 아래 `networkingMode=mirrored` 를 쓰고 `wsl --shutdown` 으로 다시 켠다.
   - 위의 "주의" 대로 Windows → WSL 방화벽 인바운드를 확인한다.
   - 확인: `source /opt/ros/humble/setup.bash && export ROS_DOMAIN_ID=30 && ros2 topic list` 에 `/joint_states` 가 보여야 한다.
3. 필요한 파이썬 패키지: `pip install paramiko pyyaml` (카메라를 보려면 `sudo apt install python3-opencv`).
4. ssh 키 등록(조종은 비밀번호 없이 키로만 접속한다): WSL 에서
   `ssh-keygen -t ed25519` → `ssh-copy-id ubuntu@192.168.0.21` → `ssh ubuntu@192.168.0.21 hostname` 이 비밀번호 없이 되면 끝.
   Windows 쪽에 등록한 키는 WSL 에서 쓰이지 않는다.

### 3. 설정 확인: `ros/config.yaml`

도메인(`ros_domain_id: 30`), 토픽 이름, 조종 접속 정보(`teleop.host/port/username/command`)가 실제와 맞는지 본다.
화면에서는 바꿀 수 없다. 바꾸면 서버를 다시 켠다.

### 4. 실행

```bash
source /opt/ros/humble/setup.bash
cd <이 저장소>
python3 ros/topic_relay.py
```

브라우저(WSL 과 같은 PC)에서 `http://localhost:8765/redesign/live.html` (기업별: `/samsung/live.html` 등).

### 5. 조종

1. 화면 위 배지가 **실시간** 이고 "통신 상태"가 모두 초록인지 본다.
2. **조종 시작** → "조종 중" 이 되면 키가 로봇으로 간다.
3. 키 (터미널 teleop 과 같다)

   | 키 | 동작 |
   |---|---|
   | i / k | 앞 / 뒤 속도 한 단계씩 (누를 때마다 ±0.01 m/s, 최대 0.26) |
   | j / l | 왼쪽 / 오른쪽 회전 속도 한 단계씩 (±0.1 rad/s, 최대 1.8) |
   | space | 정지 (속도 0) |
   | 1~4 / q~r | joint1~4 를 + / − 방향으로 한 칸 |
   | o / p | 그리퍼 열기 / 닫기 |

   **속도는 누른 만큼 쌓이고 유지된다.** 키를 떼도 멈추지 않으니 멈출 때는 space.
4. 끝나면 **조종 끊기**(정지를 보낸 뒤 teleop 을 끝낸다).
   화면을 모두 닫아도 서버가 2초 뒤 정지를 보낸다.

## 연결이 안 좋을 때 실시간 조종하는 법

화면 위 배지로 상태를 안다.

| 배지 | 뜻 | 3D 에 보이는 것 |
|---|---|---|
| 실시간 (초록) | 0.5초 안에 받은 실제 값 | 실제 위치 · 관절 |
| 추정 중 · 마지막 수신 n초 전 (노랑) | 0.5~3초 소식 없음 | 마지막 실제 위치(노란 고리)에서 보낸 키로 계산한 움직임 |
| 추정 중 · 신호 끊김 (빨강) | 3초 넘게 없음 | 위와 같음. 오래될수록 실제와 멀어진다 |

이렇게 한다.

1. **지도를 올린다.** `/map` 을 못 받으면 3D 에 벽이 없어서 추정이 벽을 뚫고 간다.
   "지도" 칸에 로봇의 `map.yaml` + `map.pgm` 을 함께 올린다(이 저장소의 `data/real.yaml`, `data/real.pgm` 이 지금 로봇 지도).
   올린 지도가 우선이고, 추정 위치는 벽에서 멈춘다.
2. **짧게 끊어서 조종한다.** 속도 명령은 유지되므로, 통신이 끊긴 사이에도 로봇은 마지막 속도로 계속 간다.
   조금 움직이고 space 로 세운 뒤 배지가 다시 **실시간** 이 되어 실제 위치를 확인하고 다음 동작을 한다.
   끊긴 채로 움직이는 명령이 남아 있으면 3D 아래에 빨간 경고가 뜬다.
3. **팔은 한 칸씩.** 팔 키는 누르는 즉시 화면에 한 칸 움직여 보이고, 실제 값이 오면 그 값으로 맞춘다.
   추정 중에는 노란 테두리 값이 추정이다.
4. **받는 양을 줄인다.** 카메라를 끈다(가장 크다). 그래도 나쁘면 `ros/config.yaml` 의 `rates`(예: scan 5, joint_states 15, tf 15)를
   낮추고 서버를 다시 켠다.
5. **오래 끊기면 멈춘다.** space(키가 닿으면) 또는 조종 끊기. 키도 안 닿으면 현장에서 로봇을 세운다.
   조종(ssh)과 화면 데이터(DDS)는 다른 길이라, 화면이 끊겨도 키는 닿을 수 있고 그 반대도 있다.

## 실기체 검증이 필요한 것

아래는 아직 **실제 로봇에서 확인하지 않았다.** 모의 서버(`ros/mock_relay.py`)로만 시험했다. 시연 전에 꼭 맞춰 본다.

### 1. turtlebot3_manipulation_teleop 실제 속도와 화면 추정 맞추기

화면은 통신이 나쁠 때 아래 값으로 움직임을 추정한다(`ros/config.yaml` 의 `predict`). 값은 로봇의 teleop 소스와 컨트롤러 설정에서 읽었지만,
실제 로봇이 그대로 움직이는지는 재 보지 않았다.

| 값 | 지금 | 출처 | 확인 방법 |
|---|---|---|---|
| `linear_step` / `linear_max` | 0.01 / 0.26 m/s | teleop 소스 BASE_LINEAR_VEL_STEP/MAX | i 를 n번 → `ros2 topic echo /cmd_vel` 이 0.01×n 인지, `/odom` twist 가 따라오는지 |
| `angular_step` / `angular_max` | 0.1 / 1.8 rad/s | teleop 소스 (컨트롤러 한도는 1.82) | j 를 n번 → `/cmd_vel`, `/odom` |
| `linear_accel` / `angular_accel` | 1.0 m/s² / 4.0 rad/s² | hardware_controller_manager.yaml | 정지에서 i 여러 번 → `/odom` 속도가 오르는 기울기 |
| `arm_step` | 0.05 rad (처음 값) | 추정. MoveIt Servo(joint 0.5, timeout 0.1 s)로 한 번에 얼마나 도는지 모름 | 팔 키 한 번 → `/joint_states` 변화량. 화면 "통신 상태 → 팔 한 칸" 이 실제 값으로 보정되는지 |
| `gripper_open` / `gripper_close` | 0.019 / −0.010 m | teleop 은 0.025 / −0.015 를 보냄, 관절 한도로 자름 | o/p 뒤 `/joint_states` 의 gripper_left_joint |

다르면 `ros/config.yaml` 의 `predict` 를 고치고 서버를 다시 켠다. 추정이 실제와 맞는지는 모의 서버의 통신 끊김 흉내로도 볼 수 있다:
`curl -X POST localhost:8765/api/mock/network -d '{"freeze": true}'` (되돌리기 `false`).

### 2. 키 매핑이 실제 teleop 과 맞는지

화면 키는 로봇의 `turtlebot3_manipulation_teleop.cpp` 를 읽고 맞췄다(i/k 앞뒤, j/l 좌우 회전, space 정지, 1~4 +, q~r −, o 열기, p 닫기).
실제 로봇에서 하나씩 눌러 다음을 확인한다.

- j 가 왼쪽(반시계), l 이 오른쪽으로 도는지. 3D 기체도 같은 쪽으로 도는지.
- 1~4 가 joint1~4 를 + 방향, q~r 이 − 방향으로 움직이는지, 3D 팔이 같은 방향으로 움직이는지.
- o 가 열고 p 가 닫는지.
- 키를 누르고 있을 때(반복 입력) 터미널 teleop 과 같은 속도로 쌓이는지. 화면은 반복 입력을 그대로 보낸다.
- teleop 시작 직후(MoveIt Servo 연결 전) 팔 키가 무시되는지. 이때는 화면만 한 칸 움직였다가 1초 뒤 실제 값으로 돌아간다.

다르면 `tools/pages/live.js` 의 `applyLocal`(화면 추정)과 `tools/pages/live.body.html` 의 키 표시를 고친다.
서버는 키 글자를 바꾸지 않고 그대로 teleop 에 넣는다.

### 3. 그 밖에 실제로 안 돌려 본 것

- `ros/topic_relay.py`(실제 ROS 구독)와 `ros/teleop_ssh.py`(ssh 조종)를 WSL + 실기체에서 처음부터 끝까지.
- 실제 `/scan`, `/map` 위치가 3D 에서 벽과 맞는지(TF 프레임 이름: map → odom → base_footprint, base_scan).
- 카메라(`/camera/camera/color/image_raw`) JPEG 변환과 속도.
