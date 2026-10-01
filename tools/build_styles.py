"""기업별 스타일 HTML 을 만든다.

redesign/*.html 의 본문 마크업과 기능 스크립트를 그대로 쓰고,
<style> 은 themes/base.css + themes/{기업}.css, 머리(header)는 기업별 마크업으로 바꾼다.
새 페이지(NEW_PAGES)는 tools/pages/{이름}.body.html · .css · .js 로 통합 버전(redesign/)과 기업별 폴더 모두에 만든다.
결과: {기업}/*.html, redesign/{새 페이지}.html  (데이터 경로 ../data/ 가 그대로 맞는 깊이)
"""
from pathlib import Path
import re

from inject_3d import inject_3d, strip_3d

ROOT = Path(__file__).resolve().parent.parent
THEMES = ROOT / "tools" / "themes"
PAGES = ["demo-video", "teleop", "survey"]
ACCENT = {"samsung": "#1259C3", "lg": "#D0021B", "apple": "#0071E3", "microsoft": "#0067B8", "amazon": "#FF9900"}  # 3D 강조색
NAV = [("demo-video.html", "시연 영상"), ("robot.html", "기체"), ("teleop.html", "teleop"), ("survey.html", "설문")]
NEW_PAGES = {"robot": "기체 소개 - ROS 2 + turtlebot3_manipulation"}
NL = "\n"
SCRIPTS_3D = ('<script src="../assets/three.r128.min.js"></script>' + NL
              + '<script src="../assets/tb3_viewer.js"></script>' + NL
              + '<script src="../assets/robot/tb3_meshes.js"></script>' + NL)

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


def page_parts(name):
    d = ROOT / "tools" / "pages"
    return tuple((d / f"{name}.{ext}").read_text(encoding="utf-8") for ext in ("body.html", "css", "js"))


def new_page(name, title, label, css, header, page_css, body, js, accent):
    return NL.join([
        "<!DOCTYPE html>", '<html lang="ko">', "<head>", '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">', f"<title>{title}</title>",
        f"<!-- {label}. 만든 방법: tools/build_styles.py (tools/pages/{name}.*) -->",
        "<style>", css, page_css, f":root {{ --robot-accent: {accent}; }}", "</style>", "</head>", "<body>",
        '<a class="skip" href="#main">본문 바로가기</a>', header, "", body + SCRIPTS_3D + "<script>",
        js.replace("%ACCENT%", accent) + "</script>", "</body>", "</html>", ""])


def update_integrated_nav():
    """redesign/ 의 기존 페이지 머리 메뉴를 NAV 로 맞춘다(기능 스크립트는 건드리지 않는다)."""
    for page in PAGES:
        f = ROOT / "redesign" / f"{page}.html"
        src = f.read_text(encoding="utf-8")
        head_end = src.index("</header>")
        items = "".join("        " + li + NL for li in re.findall(r"<li>.*?</li>", nav_html(page)))
        top = re.sub(r"<ul>.*?</ul>", lambda m: "<ul>" + NL + items + "      </ul>", src[:head_end], count=1, flags=re.S)
        f.write_text(top + src[head_end:], encoding="utf-8")


def build_integrated_pages():
    """통합 버전(redesign/)의 새 페이지. 공통 CSS 와 머리는 redesign/demo-video.html 에서 가져온다."""
    demo = (ROOT / "redesign" / "demo-video.html").read_text(encoding="utf-8")
    common = demo[demo.index("<style>") + len("<style>"):demo.index("/* ---------- 이 페이지 ---------- */")]
    common += ".lead { margin: 0; color: var(--text-2); font-size: 16px; }" + NL
    header = demo[demo.index('<header class="appbar">'):demo.index("</header>") + len("</header>")]
    for name, title in NEW_PAGES.items():
        body, page_css, js = page_parts(name)
        hdr = re.sub(r"<ul>.*?</ul>", lambda m: "<ul>" + nav_html(name) + "</ul>", header, flags=re.S)
        html = new_page(name, title, "통합 스타일", common, hdr, page_css, body, js, "#0071E3")
        (ROOT / "redesign" / f"{name}.html").write_text(html, encoding="utf-8")
        print("redesign", name, len(html))


def main():
    (ROOT / "assets" / "tb3_viewer.js").write_text((ROOT / "tools" / "tb3_viewer.js").read_text(encoding="utf-8"), encoding="utf-8")
    update_integrated_nav()
    build_integrated_pages()
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
        for name, title in NEW_PAGES.items():
            body, page_css, js = page_parts(name)
            html = new_page(name, title, f"{label} 스타일: design-refs/{brand}.md 참고", base + NL + skin,
                            header.format(nav=nav_html(name)), page_css, body, js, ACCENT[brand])
            (out_dir / f"{name}.html").write_text(html, encoding="utf-8")
            print(brand, name, len(html))


if __name__ == "__main__":
    main()
