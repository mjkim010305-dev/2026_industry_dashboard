"""캔버스 index(canvas.json) 갱신: 원격에서 읽은 index 의 기업별 아트보드·메모를 gen_canvas.py 결과로 바꾼다.

사용: uv run --no-project python tools/merge_canvas_index.py canvas/remote/project/canvas.json
결과: canvas/project/canvas.json  (통합 버전 페이지와 다른 키는 그대로 둔다)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
remote = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
new = json.loads((ROOT / "canvas" / "new_boards.json").read_text(encoding="utf-8"))
brand_pages = {b["page"] for b in new["boards"].values()}

keep = {k: v for k, v in remote["boards"].items() if v.get("page") not in brand_pages}
remote["boards"] = {**keep, **new["boards"]}
remote["order"] = [k for k in remote["order"] if k in keep] + new["order"]
notes = {k: v for k, v in remote.get("notes", {}).items() if v.get("page") not in brand_pages}
remote["notes"] = {**notes, **new["notes"]}
(ROOT / "canvas" / "project" / "canvas.json").write_text(json.dumps(remote, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(remote["boards"]), "boards")
