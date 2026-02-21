import sys
from pathlib import Path
from datetime import datetime
import uuid

import yaml
from PIL import Image, ImageOps
from pptx import Presentation
from pptx.util import Pt

sys.path.append("../../../DB")
import DB_utils  # noqa: E402


BASE_DIR = Path(__file__).resolve().parent
PPT_DIR = BASE_DIR.parent
CONFIG_PATH = BASE_DIR / "configuration.yaml"

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    cfg = yaml.safe_load(f)


ROW_FIELD_MAP = [
    ("address", "address"),
    ("zoning_type", "zoning_type"),
    ("land_area", "land_area"),
    ("gross_area", "gross_area"),
    ("building_area", "building_area"),
    ("floors", "floors"),
    ("parking_elevator", "parking_elevator"),
    ("approval_date", "approval_date"),
    ("official_price", "official_price"),
    ("sale_price", "sale_price"),
    ("price_per_pyeong", "price_per_pyeong"),
    ("price_per_total", "price_per_total"),
    ("usable_area", "usable_area"),
    ("yield_rate", "yield_rate"),
]


def _safe(value):
    if value is None:
        return "-"
    text = str(value).strip()
    return text if text else "-"


def _approval_date(value):
    text = _safe(value)
    if text == "-":
        return text
    return text.split(" ")[0]


def _build_rows(building_info: dict) -> list[str]:
    above = _safe(building_info.get("aboveground_floors"))
    below = _safe(building_info.get("underground_floors"))
    floor_text = f"지상 {above}층 / 지하 {below}층"
    if above == "-" and below == "-":
        floor_text = "-"

    parking = _safe(building_info.get("parking_capacity"))
    elevator = _safe(building_info.get("elevator"))
    parking_elevator = f"{parking} / {elevator}" if (parking != "-" or elevator != "-") else "-"

    raw = {
        "address": _safe(building_info.get("address")),
        "zoning_type": _safe(building_info.get("zoning_type")),
        "land_area": _safe(building_info.get("land_area_pyeong")),
        "gross_area": _safe(building_info.get("gross_area_pyeong")),
        "building_area": _safe(building_info.get("building_area_pyeong")),
        "floors": floor_text,
        "parking_elevator": parking_elevator,
        "approval_date": _approval_date(building_info.get("approval_date")),
        "official_price": _safe(building_info.get("official_price_per_pyeong_million")),
        "sale_price": _safe(building_info.get("sale_price")),
        "price_per_pyeong": _safe(building_info.get("price_per_pyeong")),
        "price_per_total": _safe(building_info.get("price_per_total_floor_area")),
        "usable_area": _safe(building_info.get("usable_area_pyeong")),
        "yield_rate": _safe(building_info.get("yield_rate")),
    }
    return [raw[key] for _, key in ROW_FIELD_MAP]


def _set_shape_text(shape, text: str, font_size_pt: int):
    tf = shape.text_frame
    tf.clear()
    p = tf.paragraphs[0]
    p.text = text
    for run in p.runs:
        run.font.name = "NanumGothic"
        run.font.size = Pt(font_size_pt)


def _set_cell_text(cell, text: str, font_size_pt: int):
    cell.text = str(text)
    tf = cell.text_frame
    for p in tf.paragraphs:
        for run in p.runs:
            run.font.name = "NanumGothic"
            run.font.size = Pt(font_size_pt)


def _fix_image_orientation(img_path: str) -> Path:
    img = Image.open(img_path)
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA"):
        img = img.convert("RGB")

    tmp_name = BASE_DIR / f"_tmp_{uuid.uuid4().hex}{Path(img_path).suffix}"
    img.save(tmp_name)
    return tmp_name


def _replace_picture(slide, placeholder_shape, image_path: str):
    fixed_path = _fix_image_orientation(image_path)
    try:
        new_pic = slide.shapes.add_picture(
            str(fixed_path),
            placeholder_shape.left,
            placeholder_shape.top,
            width=placeholder_shape.width,
            height=placeholder_shape.height,
        )
        # Keep z-order close to original
        sp_tree = slide.shapes._spTree
        sp_tree.remove(new_pic._element)
        sp_tree.insert(sp_tree.index(placeholder_shape._element), new_pic._element)
        sp_tree.remove(placeholder_shape._element)
    finally:
        try:
            fixed_path.unlink(missing_ok=True)
        except Exception:
            pass


def _to_local_image_path(url: str) -> str:
    # url example: /photo/123/main_0_xxx.jpg
    backend_root = Path(cfg.get("path", "")).resolve()
    return str((backend_root / url.lstrip("/")).resolve())


def run(bd_numbers: list[int]):
    if not bd_numbers:
        raise ValueError("bd_numbers is empty")

    bd_numbers = [int(x) for x in bd_numbers[:7]]
    conn = DB_utils.join_db()
    try:
        infos = [DB_utils.ppt_info_search(conn, bd) for bd in bd_numbers]
    finally:
        conn.close()

    template_path = PPT_DIR / "statics" / "template2.pptx"
    prs = Presentation(str(template_path))
    slide = prs.slides[0]

    # n1~n7 : building name
    for i in range(1, 8):
        target_name = f"n{i}"
        shape = next((s for s in slide.shapes if s.name == target_name), None)
        if not shape:
            continue
        if i <= len(infos):
            bd_name = _safe((infos[i - 1].get("building_info") or {}).get("bd_name"))
            _set_shape_text(shape, bd_name, 18)
        else:
            _set_shape_text(shape, "-", 18)

    # p1~p7 : main image index 0
    for i in range(1, 8):
        target_name = f"p{i}"
        shape = next((s for s in slide.shapes if s.name == target_name), None)
        if not shape or i > len(infos):
            continue

        main_images = (infos[i - 1].get("images") or {}).get("main", [])
        if not main_images:
            continue

        image_url = main_images[0].get("url", "")
        if not image_url:
            continue

        image_path = _to_local_image_path(image_url)
        if Path(image_path).exists():
            _replace_picture(slide, shape, image_path)

    # table : col0 labels, col1~col7 values
    table_shape = next((s for s in slide.shapes if s.name == "table"), None)
    if table_shape is not None and getattr(table_shape, "has_table", False):
        table = table_shape.table
        max_rows = min(len(ROW_FIELD_MAP), len(table.rows))
        max_cols = max((len(r.cells) for r in table.rows), default=0)
        target_cols = min(8, max_cols)  # 0=label, 1~7=data

        for col_idx in range(1, target_cols):
            info_idx = col_idx - 1
            values = []
            if info_idx < len(infos):
                building_info = infos[info_idx].get("building_info") or {}
                values = _build_rows(building_info)

            for row_idx in range(max_rows):
                val = values[row_idx] if row_idx < len(values) else "-"
                row_cells = table.rows[row_idx].cells
                if col_idx >= len(row_cells):
                    continue
                _set_cell_text(row_cells[col_idx], val, 8)

    today = datetime.now().strftime("%Y%m%d")
    out_name = f"compare_{today}_{uuid.uuid4().hex[:6]}.pptx"
    out_path = PPT_DIR / "statics" / out_name
    prs.save(str(out_path))

    return str(out_path), out_name


if __name__ == "__main__":
    # Example: python make_ppt_template2.py 12 13 14
    args = [int(x) for x in sys.argv[1:]]
    ppt_path, file_name = run(args)
    print(ppt_path)
    print(file_name)
