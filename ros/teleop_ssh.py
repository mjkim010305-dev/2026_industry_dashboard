"""실제 조종: ssh 로 로봇에 들어가 가상 터미널에서 teleop 을 실행하고, 화면에서 온 키 글자를 그대로 넣는다.

turtlebot3_manipulation_teleop 은 토픽이 아니라 터미널 입력으로 키를 읽기 때문에 이 방식을 쓴다
(dashboard/bridge 의 방식과 같다). 비밀번호는 저장·기록하지 않는다. 비밀번호가 비면 ssh 키로 접속한다.
"""
import socket
import threading

DISCONNECTED, CONNECTING, CONNECTED = "disconnected", "connecting", "connected"
LABELS = {"auth_failed": "인증 실패", "host_unreachable": "호스트에 접속할 수 없음", "no_paramiko": "서버에 paramiko 가 없음",
          "other": "그 밖의 오류"}
CONNECT_TIMEOUT = 10.0
KEEPALIVE = 5


class Teleop:
    def __init__(self, on_change):
        self.on_change = on_change
        self.lock = threading.Lock()
        self.state = {"state": DISCONNECTED, "reason": None, "dropped": False}
        self.client = self.channel = None
        self.closing = False

    def _set(self, state, reason=None, dropped=False):
        self.state = {"state": state, "reason": reason, "label": LABELS.get(reason), "dropped": dropped}
        self.on_change(dict(self.state))

    def connect(self, host, port, username, password, command, key_file=""):
        with self.lock:
            if self.state["state"] != DISCONNECTED:
                return 409, {"ok": False, "error": "already_connecting_or_connected"}
            self._set(CONNECTING)
        try:
            import paramiko
        except ImportError:
            self._set(DISCONNECTED, "no_paramiko")
            return 500, {"ok": False, "reason": "no_paramiko", "label": LABELS["no_paramiko"]}
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())   # 연구실 내부망 전제
        try:
            kw = {"password": password} if password else {"key_filename": key_file or None, "look_for_keys": True, "allow_agent": True}
            if password:
                kw.update(look_for_keys=False, allow_agent=False)
            client.connect(host, port=port, username=username, timeout=CONNECT_TIMEOUT, **kw)
        except Exception as e:      # 원문 메시지는 버리고 이유만 알린다
            client.close()
            reason = "auth_failed" if isinstance(e, paramiko.AuthenticationException) else \
                     "host_unreachable" if isinstance(e, (socket.timeout, TimeoutError, OSError)) else "other"
            self._set(DISCONNECTED, reason)
            return {"auth_failed": 401, "host_unreachable": 502}.get(reason, 500), {"ok": False, "reason": reason, "label": LABELS[reason]}
        try:
            client.get_transport().set_keepalive(KEEPALIVE)
            ch = client.invoke_shell(term="xterm", width=120, height=40)
            ch.sendall(command + "\n")
        except Exception:
            client.close()
            self._set(DISCONNECTED, "other")
            return 500, {"ok": False, "reason": "other", "label": LABELS["other"]}
        self.client, self.channel, self.closing = client, ch, False
        threading.Thread(target=self._drain, args=(ch,), daemon=True).start()
        self._set(CONNECTED)
        return 200, {"ok": True, "state": CONNECTED}

    def send(self, key):
        ch = self.channel
        if ch is None or self.state["state"] != CONNECTED:
            return 409, {"ok": False, "error": "not_connected"}
        if len(key) != 1:
            return 400, {"ok": False, "error": "invalid_field:key"}
        try:
            ch.sendall(key)
        except Exception:
            return 409, {"ok": False, "error": "not_connected"}
        return 200, {"ok": True}

    def stop_motion(self):
        """주행 정지(space). 화면이 모두 닫혔을 때 서버가 부른다."""
        if self.channel is not None and self.state["state"] == CONNECTED:
            try:
                self.channel.sendall(" ")
            except Exception:
                pass

    def disconnect(self):
        ch = self.channel
        if ch is not None:
            try:
                ch.sendall(" ")          # 먼저 세우고
                ch.sendall("\x1b")       # teleop 종료 키(ESC). 터미널이 raw 모드라 Ctrl-C 는 글자로 들어간다
                ch.sendall("\x03")
            except Exception:
                pass
        client, self.client, self.channel = self.client, None, None
        self.closing = True
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
        if self.state["state"] != DISCONNECTED:
            self._set(DISCONNECTED)
        return 200, {"ok": True, "state": DISCONNECTED}

    def _drain(self, ch):
        """터미널 출력은 읽어서 버린다. 채널이 닫히면 끊김으로 알린다."""
        while not ch.closed:
            try:
                if ch.recv(4096) == b"":
                    break
            except Exception:
                break
        if not self.closing and self.channel is ch:
            self.client = self.channel = None
            self._set(DISCONNECTED, dropped=True)
