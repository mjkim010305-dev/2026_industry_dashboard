"""기업별 스타일 HTML 15개를 만든다.

redesign/*.html 의 본문 마크업과 기능 스크립트를 그대로 쓰고,
<style> 은 themes/base.css + themes/{기업}.css, 머리(header)는 기업별 마크업으로 바꾼다.
결과: {기업}/{demo-video,teleop,survey}.html  (데이터 경로 ../data/ 가 그대로 맞는 깊이)
"""
from pathlib import Path
import re

from inject_3d import inject_3d, strip_3d

ROOT = Path(__file__).resolve().parent.parent
THEMES = ROOT / "tools" / "themes"
PAGES = ["demo-video", "teleop", "survey"]
ACCENT = {"samsung": "#1259C3", "lg": "#D0021B", "apple": "#0071E3", "microsoft": "#0067B8", "amazon": "#FF9900"}  # 3D 강조색
NAV = [("demo-video.html", "시연 영상"), ("teleop.html", "teleop"), ("survey.html", "설문")]

BRANDS = {
    "samsung": ("삼성", '<header class="gnb"><div class="gnb-in"><span class="wordmark">TURTLEBOT3</span>'
                '<nav aria-label="화면 이동"><ul>{nav}</ul></nav><span class="gnb-meta">ROS 2 · turtlebot3_manipulation</span></div></header>'),
    "lg": ("LG", '<header class="gnb"><div class="util"><div class="in"><span>ROS 2 · turtlebot3_manipulation</span></div></div>'
           '<div class="in main"><span class="wordmark">turtlebot3</span><nav aria-label="화면 이동"><ul>{nav}</ul></nav></div></header>'),
    "apple": ("애플", '<header class="gnav"><div class="gnav-in"><span class="wordmark">turtlebot3</span>'
              '<nav aria-label="화면 이동"><ul>{nav}</ul></nav></div></header>'),
    "microsoft": ("마이크로소프트", '<header class="mshead"><div class="in"><span class="wordmark">turtlebot3</span>'
                  '<span class="sep" aria-hidden="true"></span><nav aria-label="화면 이동"><ul>{nav}</ul></nav></div></header>'),
    "amazon": ("아마존", '<header class="az"><div class="az-top"><div class="in"><span class="wordmark">turtlebot3</span>'
               '<span class="az-msg">ROS 2 · turtlebot3_manipulation</span></div></div>'
               '<nav class="az-sub" aria-label="화면 이동"><div class="in"><ul>{nav}</ul></div></nav></header>'),
}


def nav_html(page):
    items = []
    for href, label in NAV:
        if href == page + ".html":
            items.append(f'<li><a href="{href}" aria-current="page">{label}<span class="vh"> (현재 탭)</span></a></li>')
        else:
            items.append(f'<li><a href="{href}">{label}</a></li>')
    return "".join(items)


def split_source(src):
    head_end = src.index("<style>")
    head = src[:head_end]
    body_start = src.index('<div class="page">')
    m = re.search(r"^(<!-- 기본값 지정 가능: QR.*|<script>)", src, re.M)
    body = src[body_start:m.start()]
    tail = src[m.start():]
    return head, body, tail


def main():
    base = (THEMES / "base.css").read_text(encoding="utf-8")
    for brand, (label, header) in BRANDS.items():
        skin = (THEMES / f"{brand}.css").read_text(encoding="utf-8")
        out_dir = ROOT / brand
        out_dir.mkdir(exist_ok=True)
        for page in PAGES:
            src = strip_3d((ROOT / "redesign" / f"{page}.html").read_text(encoding="utf-8"))
            head, body, tail = split_source(src)
            head = re.sub(r"<!-- 리뉴얼:.*?-->",
                          f"<!-- {label} 스타일: design-refs/{brand}.md 참고. 기능 스크립트는 원본(original/{page}.html)과 같다. -->",
                          head)
            html = (head + "<style>\n" + base + "\n" + skin + "</style>\n</head>\n<body>\n"
                    + '<a class="skip" href="#main">본문 바로가기</a>\n'
                    + header.format(nav=nav_html(page)) + "\n\n" + body + tail)
            if page == "teleop":
                html = inject_3d(html, ACCENT[brand])
            (out_dir / f"{page}.html").write_text(html, encoding="utf-8")
            print(brand, page, len(html))


if __name__ == "__main__":
    main()
