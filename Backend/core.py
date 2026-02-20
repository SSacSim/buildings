import sys
import os 
import json

sys.path.append('../DB')

import DB_utils

from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from typing import List, Optional
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from fastapi.responses import FileResponse

from routers import customer

app = FastAPI(title="Building Search API")

BASE_DIR = Path(__file__).resolve().parent
mount_BASE_UPLOAD_DIR = BASE_DIR / "save_file"
# 📁 폴더 없으면 자동 생성
mount_BASE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 정적 파일 등록
app.mount("/statics", StaticFiles(directory="statics"), name="statics")
app.mount("/save_file",StaticFiles(directory=str(mount_BASE_UPLOAD_DIR)),name="save_file")

# ✅ router 등록
app.include_router(customer.router)


# 템플릿 설정
templates = Jinja2Templates(directory="./templates")

# 👉 화면 렌더링
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "main.html",
        {"request": request}
    )


@app.get("/insight", response_class=HTMLResponse)
def insight_page(request: Request):
    return templates.TemplateResponse(
        "insight.html",
        {"request": request}
    )


@app.get("/api/insight/overview")
def get_insight_overview(
    address: str = Query(""),
    site_location: str = Query(""),
    types: str = Query(""),
    min_price: Optional[int] = Query(None),
    max_price: Optional[int] = Query(None),
    station_keyword: str = Query(""),
    station_walk_min: Optional[float] = Query(None),
    station_walk_max: Optional[float] = Query(None),
    cash_hold_manwon: Optional[float] = Query(None),
    cash_hold_percent: Optional[float] = Query(None),
    min_yield: Optional[float] = Query(None),
    land_pp_min: Optional[int] = Query(None),
    land_pp_max: Optional[int] = Query(None),
    gross_pp_min: Optional[int] = Query(None),
    gross_pp_max: Optional[int] = Query(None),
    land_area_min: Optional[int] = Query(None),
    land_area_max: Optional[int] = Query(None),
    gross_area_min: Optional[int] = Query(None),
    gross_area_max: Optional[int] = Query(None),
    usable_area_min: Optional[int] = Query(None),
    usable_area_max: Optional[int] = Query(None),
    approval_year_min: Optional[int] = Query(None),
    road_width_min: Optional[float] = Query(None),
    elevator_option: str = Query(""),
    building_status: str = Query(""),
    parking_min: Optional[int] = Query(None),
    zoning_categories: str = Query(""),
    usage_categories: str = Query(""),
    customer_page: int = Query(1, ge=1),
    building_page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()

        type_map = {
            "NEW_SITE": "is_new_site",
            "REMODELING": "is_remodeling",
            "OFFICE": "is_office_building",
            "INVESTMENT": "is_investment",
            "DEVELOPMENT": "is_development",
            "STABLE": "is_stable_holding",
        }

        customer_sql = """
            SELECT
                customer_number,
                buyer_name,
                phone,
                company_address,
                business_area,
                building_preference,
                customer_state,
                main_interest_region,
                customer_note,
                match_conditions_json
            FROM customer_info
            WHERE delete_flag = FALSE
        """
        customer_params: list = []

        if address.strip():
            customer_sql += """
                AND (
                    COALESCE(company_address, '') ILIKE %s
                    OR COALESCE(home_address, '') ILIKE %s
                    OR COALESCE(main_interest_region, '') ILIKE %s
                    OR COALESCE(buyer_name, '') ILIKE %s
                )
            """
            customer_params.extend([f"%{address.strip()}%"] * 4)

        if site_location.strip():
            customer_sql += " AND COALESCE(business_area, '') ILIKE %s"
            customer_params.append(f"%{site_location.strip()}%")

        customer_sql += " ORDER BY customer_number DESC"

        cur.execute(customer_sql, tuple(customer_params))
        customer_rows = cur.fetchall()
        customer_cols = [desc[0] for desc in cur.description]
        customers_raw = [dict(zip(customer_cols, row)) for row in customer_rows]

        selected_types_codes = [t.strip() for t in types.split(",") if t.strip()]
        selected_zoning_codes = [c.strip() for c in zoning_categories.split(",") if c.strip()]
        selected_usage_codes = [c.strip() for c in usage_categories.split(",") if c.strip()]

        type_code_to_kor = {
            "NEW_SITE": "신축부지",
            "REMODELING": "리모델링",
            "OFFICE": "사옥형",
            "INVESTMENT": "수익형",
            "DEVELOPMENT": "개발/전환",
            "STABLE": "보유안정",
        }
        zoning_code_to_kor = {
            "COMMERCIAL": "상업",
            "INDUSTRIAL": "공업",
            "RESIDENTIAL": "주거",
            "OTHER": "기타",
        }
        usage_code_to_kor = {
            "NEIGHBORHOOD": "근린",
            "OFFICE_USE": "업무",
            "LODGING": "숙박",
            "ENTERTAINMENT": "위락",
            "HOUSING": "주택",
            "OTHER": "기타",
        }
        selected_types_customer = [type_code_to_kor[c] for c in selected_types_codes if c in type_code_to_kor]
        selected_zoning_customer = [zoning_code_to_kor[c] for c in selected_zoning_codes if c in zoning_code_to_kor]
        selected_usage_customer = [usage_code_to_kor[c] for c in selected_usage_codes if c in usage_code_to_kor]

        def to_num(value):
            if value is None:
                return None
            cleaned = "".join(ch for ch in str(value) if ch.isdigit() or ch == ".")
            if cleaned == "":
                return None
            try:
                return float(cleaned)
            except Exception:
                return None

        def parse_json(raw):
            if not raw:
                return {}
            try:
                parsed = json.loads(raw)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}

        def range_overlap(qmin, qmax, cmin, cmax):
            if qmin is None and qmax is None:
                return True
            if cmin is None and cmax is None:
                return False
            left = qmin if qmin is not None else float("-inf")
            right = qmax if qmax is not None else float("inf")
            c_left = cmin if cmin is not None else float("-inf")
            c_right = cmax if cmax is not None else float("inf")
            return max(left, c_left) <= min(right, c_right)

        def calc_cash_max_price_manwon(cash_manwon, percent):
            if cash_manwon is None:
                return None
            p = 0.0 if percent is None else percent
            if p < 0 or p >= 100:
                return None
            ratio = 1 - (p / 100.0)
            if ratio <= 0:
                return None
            return cash_manwon / ratio

        range_keys = [
            ("min_price", "max_price", min_price, max_price),
            ("land_pp_min", "land_pp_max", land_pp_min, land_pp_max),
            ("gross_pp_min", "gross_pp_max", gross_pp_min, gross_pp_max),
            ("land_area_min", "land_area_max", land_area_min, land_area_max),
            ("gross_area_min", "gross_area_max", gross_area_min, gross_area_max),
            ("usable_area_min", "usable_area_max", usable_area_min, usable_area_max),
        ]

        customers = []
        for row in customers_raw:
            cond = parse_json(row.get("match_conditions_json"))

            cond_types = cond.get("types") if isinstance(cond.get("types"), list) else []
            cond_zoning = cond.get("zoning_categories") if isinstance(cond.get("zoning_categories"), list) else []
            cond_usage = cond.get("usage_categories") if isinstance(cond.get("usage_categories"), list) else []

            if selected_types_customer and not set(selected_types_customer).issubset(set(cond_types)):
                continue
            if selected_zoning_customer and not set(selected_zoning_customer).issubset(set(cond_zoning)):
                continue
            if selected_usage_customer and not set(selected_usage_customer).issubset(set(cond_usage)):
                continue

            range_ok = True
            for cmin_key, cmax_key, qmin, qmax in range_keys:
                cmin = to_num(cond.get(cmin_key))
                cmax = to_num(cond.get(cmax_key))
                if not range_overlap(qmin, qmax, cmin, cmax):
                    range_ok = False
                    break
            if not range_ok:
                continue

            if station_keyword.strip():
                cond_station_keyword = str(cond.get("station_keyword") or "").strip()
                if not cond_station_keyword or station_keyword.strip() not in cond_station_keyword:
                    continue

            if not range_overlap(
                station_walk_min,
                station_walk_max,
                to_num(cond.get("station_walk_min")),
                to_num(cond.get("station_walk_max")),
            ):
                continue

            if (cash_hold_manwon is not None) or (cash_hold_percent is not None):
                q_cash_max = calc_cash_max_price_manwon(cash_hold_manwon, cash_hold_percent)
                if q_cash_max is None:
                    continue
                c_cash_max = calc_cash_max_price_manwon(
                    to_num(cond.get("cash_hold_manwon")),
                    to_num(cond.get("cash_hold_percent")),
                )
                if c_cash_max is None or c_cash_max < q_cash_max:
                    continue

            row.pop("match_conditions_json", None)
            customers.append(row)

        building_sql = """
            SELECT
                bi.bd_number,
                bi.bd_name,
                bi.address,
                bi.site_location,
                bi.sale_price,
                bi.yield_rate,
                bi.price_per_pyeong,
                bi.gross_area_pyeong,
                bi.usable_area_pyeong
            FROM building_info bi
            LEFT JOIN building_memo bm
              ON bi.bd_number = bm.bd_number
            WHERE bi.delete_flag = FALSE
        """
        building_params: list = []

        if address.strip():
            building_sql += " AND (COALESCE(address, '') ILIKE %s OR COALESCE(bd_name, '') ILIKE %s)"
            building_params.extend([f"%{address.strip()}%", f"%{address.strip()}%"])

        if site_location.strip():
            building_sql += " AND COALESCE(site_location, '') ILIKE %s"
            building_params.append(f"%{site_location.strip()}%")

        if station_keyword.strip():
            building_sql += """
                AND (
                    COALESCE(nearby_station, '') ILIKE %s
                    OR EXISTS (
                        SELECT 1
                        FROM regexp_split_to_table(COALESCE(nearby_station2, ''), '##') AS station_row
                        WHERE
                            split_part(station_row, '|', 1) ILIKE %s
                            OR split_part(station_row, '|', 2) ILIKE %s
                            OR split_part(station_row, '|', 3) ILIKE %s
                    )
                )
            """
            kw = f"%{station_keyword.strip()}%"
            building_params.extend([kw, kw, kw, kw])

        if min_price is not None:
            building_sql += " AND NULLIF(regexp_replace(COALESCE(sale_price, ''), '[^0-9]', '', 'g'), '')::bigint >= %s"
            building_params.append(min_price)
        if max_price is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(sale_price, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            building_params.append(max_price)

        if cash_hold_manwon is not None:
            leverage = 0.0 if cash_hold_percent is None else float(cash_hold_percent)
            if leverage < 0 or leverage >= 100:
                raise HTTPException(status_code=400, detail="현금보유액 %는 0 이상 100 미만이어야 합니다.")
            cash_ratio = 1 - (leverage / 100.0)
            max_sale_price_manwon = cash_hold_manwon / cash_ratio
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(sale_price, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            building_params.append(int(max_sale_price_manwon))

        if station_walk_min is not None:
            building_sql += """
                AND (
                    (
                        NULLIF(
                            REPLACE(
                                SUBSTRING(COALESCE(nearby_station, '') FROM '([0-9]+([.,][0-9]+)?)\\s*분'),
                                ',',
                                '.'
                            ),
                            ''
                        )::numeric IS NOT NULL
                        AND NULLIF(
                            REPLACE(
                                SUBSTRING(COALESCE(nearby_station, '') FROM '([0-9]+([.,][0-9]+)?)\\s*분'),
                                ',',
                                '.'
                            ),
                            ''
                        )::numeric >= %s
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM regexp_split_to_table(COALESCE(nearby_station2, ''), '##') AS station_row
                        WHERE
                            NULLIF(
                                REPLACE(
                                    regexp_replace(split_part(station_row, '|', 4), '[^0-9.,]', '', 'g'),
                                    ',',
                                    '.'
                                ),
                                ''
                            )::numeric IS NOT NULL
                            AND NULLIF(
                                REPLACE(
                                    regexp_replace(split_part(station_row, '|', 4), '[^0-9.,]', '', 'g'),
                                    ',',
                                    '.'
                                ),
                                ''
                            )::numeric >= %s
                    )
                )
            """
            building_params.extend([station_walk_min, station_walk_min])
        if station_walk_max is not None:
            building_sql += """
                AND (
                    (
                        NULLIF(
                            REPLACE(
                                SUBSTRING(COALESCE(nearby_station, '') FROM '([0-9]+([.,][0-9]+)?)\\s*분'),
                                ',',
                                '.'
                            ),
                            ''
                        )::numeric IS NOT NULL
                        AND NULLIF(
                            REPLACE(
                                SUBSTRING(COALESCE(nearby_station, '') FROM '([0-9]+([.,][0-9]+)?)\\s*분'),
                                ',',
                                '.'
                            ),
                            ''
                        )::numeric <= %s
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM regexp_split_to_table(COALESCE(nearby_station2, ''), '##') AS station_row
                        WHERE
                            NULLIF(
                                REPLACE(
                                    regexp_replace(split_part(station_row, '|', 4), '[^0-9.,]', '', 'g'),
                                    ',',
                                    '.'
                                ),
                                ''
                            )::numeric IS NOT NULL
                            AND NULLIF(
                                REPLACE(
                                    regexp_replace(split_part(station_row, '|', 4), '[^0-9.,]', '', 'g'),
                                    ',',
                                    '.'
                                ),
                                ''
                            )::numeric <= %s
                    )
                )
            """
            building_params.extend([station_walk_max, station_walk_max])
        if min_yield is not None:
            building_sql += """
                AND (
                    CASE
                        WHEN COALESCE(yield_rate::text, '') ~ '[0-9]'
                            THEN COALESCE(
                                NULLIF(
                                    REPLACE(
                                        SUBSTRING(COALESCE(yield_rate::text, '') FROM '([0-9]+([.,][0-9]+)?)'),
                                        ',',
                                        '.'
                                    ),
                                    ''
                                )::numeric,
                                0
                            )
                        ELSE 0
                    END
                ) >= %s
            """
            building_params.append(min_yield)

        if land_pp_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_pyeong, ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= %s"
            building_params.append(land_pp_min)
        if land_pp_max is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_pyeong, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            building_params.append(land_pp_max)
        if gross_pp_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_total_floor_area, ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= %s"
            building_params.append(gross_pp_min)
        if gross_pp_max is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_total_floor_area, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            building_params.append(gross_pp_max)

        if land_area_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(land_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            building_params.append(land_area_min)
        if land_area_max is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(land_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            building_params.append(land_area_max)
        if gross_area_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(gross_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            building_params.append(gross_area_min)
        if gross_area_max is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(gross_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            building_params.append(gross_area_max)
        if usable_area_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(usable_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            building_params.append(usable_area_min)
        if usable_area_max is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(usable_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            building_params.append(usable_area_max)

        if approval_year_min is not None:
            building_sql += " AND COALESCE(NULLIF(SUBSTRING(COALESCE(approval_date, '') FROM '([0-9]{4})'), '')::int, 0) >= %s"
            building_params.append(approval_year_min)

        if road_width_min is not None:
            building_sql += """
                AND EXISTS (
                    SELECT 1
                    FROM regexp_split_to_table(COALESCE(road_access2, ''), '##') AS road_row
                    WHERE COALESCE(
                        NULLIF(
                            regexp_replace(split_part(road_row, '|', 1), '[^0-9.]', '', 'g'),
                            ''
                        )::numeric,
                        0
                    ) >= %s
                )
            """
            building_params.append(road_width_min)

        normalized_elevator_option = (elevator_option or "").strip()
        if normalized_elevator_option == "HAS":
            building_sql += """
                AND (
                    COALESCE(NULLIF(regexp_replace(COALESCE(elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
                    OR COALESCE(NULLIF(regexp_replace(COALESCE(emergency_elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
                )
            """

        normalized_building_status = (building_status or "").strip()
        if normalized_building_status not in ("", "전체"):
            building_sql += " AND COALESCE(bm.status, '') = %s"
            building_params.append(normalized_building_status)
        if normalized_elevator_option == "NONE":
            building_sql += """
                AND (
                    COALESCE(NULLIF(regexp_replace(COALESCE(elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) = 0
                    AND COALESCE(NULLIF(regexp_replace(COALESCE(emergency_elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) = 0
                )
            """

        if parking_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(parking_capacity, ''), '[^0-9]', '', 'g'), '')::int, 0) >= %s"
            building_params.append(parking_min)

        if selected_zoning_codes:
            zoning_ors = []
            for category in selected_zoning_codes:
                if category == "COMMERCIAL":
                    zoning_ors.append("COALESCE(zoning_type::text, '') ILIKE %s")
                    building_params.append("%\uC0C1\uC5C5%")
                elif category == "INDUSTRIAL":
                    zoning_ors.append("COALESCE(zoning_type::text, '') ILIKE %s")
                    building_params.append("%\uACF5\uC5C5%")
                elif category == "RESIDENTIAL":
                    zoning_ors.append("COALESCE(zoning_type::text, '') ILIKE %s")
                    building_params.append("%\uC8FC\uAC70%")
                elif category == "OTHER":
                    zoning_ors.append("(COALESCE(zoning_type::text, '') NOT ILIKE %s AND COALESCE(zoning_type::text, '') NOT ILIKE %s AND COALESCE(zoning_type::text, '') NOT ILIKE %s)")
                    building_params.extend(["%\uC0C1\uC5C5%", "%\uACF5\uC5C5%", "%\uC8FC\uAC70%"])
            if zoning_ors:
                building_sql += " AND (" + " OR ".join(zoning_ors) + ")"

        if selected_usage_codes:
            usage_ors = []
            for category in selected_usage_codes:
                if category == "NEIGHBORHOOD":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    building_params.append("%\uADFC\uB9B0%")
                elif category == "OFFICE_USE":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    building_params.append("%\uC5C5\uBB34%")
                elif category == "LODGING":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    building_params.append("%\uC219\uBC15%")
                elif category == "ENTERTAINMENT":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    building_params.append("%\uC704\uB77D%")
                elif category == "HOUSING":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    building_params.append("%\uC8FC\uD0DD%")
                elif category == "OTHER":
                    usage_ors.append("(COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s)")
                    building_params.extend(["%\uADFC\uB9B0%", "%\uC5C5\uBB34%", "%\uC219\uBC15%", "%\uC704\uB77D%", "%\uC8FC\uD0DD%"])
            if usage_ors:
                building_sql += " AND (" + " OR ".join(usage_ors) + ")"

        type_columns = [type_map[t] for t in selected_types_codes if t in type_map]
        if type_columns:
            building_sql += " AND (" + " AND ".join([f"COALESCE({col}, FALSE) = TRUE" for col in type_columns]) + ")"

        building_sql += " ORDER BY bi.bd_number DESC"

        cur.execute(building_sql, tuple(building_params))
        building_rows = cur.fetchall()
        building_cols = [desc[0] for desc in cur.description]
        buildings = [dict(zip(building_cols, row)) for row in building_rows]

        customers_total_count = len(customers)
        buildings_total_count = len(buildings)

        customers_total_pages = (customers_total_count + page_size - 1) // page_size if customers_total_count > 0 else 0
        buildings_total_pages = (buildings_total_count + page_size - 1) // page_size if buildings_total_count > 0 else 0

        safe_customer_page = min(customer_page, customers_total_pages) if customers_total_pages > 0 else 1
        safe_building_page = min(building_page, buildings_total_pages) if buildings_total_pages > 0 else 1

        customer_start = (safe_customer_page - 1) * page_size
        building_start = (safe_building_page - 1) * page_size

        paged_customers = customers[customer_start:customer_start + page_size]
        paged_buildings = buildings[building_start:building_start + page_size]

        return {
            "customers": paged_customers,
            "buildings": paged_buildings,
            "customers_total_count": customers_total_count,
            "buildings_total_count": buildings_total_count,
            "customers_page": safe_customer_page,
            "buildings_page": safe_building_page,
            "customers_total_pages": customers_total_pages,
            "buildings_total_pages": buildings_total_pages,
            "page_size": page_size,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


class SearchRequest(BaseModel):
    address: str
    page : int 
    category : str




@app.post("/search")
def search_building(
    req: SearchRequest
):
    """
    building_info + building_memo 를 bd_number 기준으로 JOIN
    address 기준으로 검색

    return : List[dict,] 
        해당 건물의 모든 정보 데이터를 dict 형태로 가져옴 

    
    의문 --> 해당 search는 간단 정보만 가져오면 되는 부분이라, 모든 정보 필요 x
        --> 모든 정보는 해당 카드를 클릭했을때 받아오는 것으로 하는게 합리적이여 보임
        --> ㅁ bd_number, address, deposit_price, sale_price, status 표현 
        --> ㅁ 상세 주소를 서칭할 수 있는 함수를 추가적으로 제작
        --> ㅁ bd_number를 이용하여 검색할 수 있도록 제작 
    """
    print(req)
    conn = None 
    try:
        if conn is None:
            conn = DB_utils.join_db()
        
        search_list = DB_utils.extract_simple_info(conn,req.address , req.page, req.category)
        return search_list

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if conn:
            conn.close()

## 건물 추가 POST
@app.post("/create")
def create_building(
    req: SearchRequest
):
    """
    building_info + building_memo 를 bd_number 기준으로 JOIN
    address 기준으로 검색
    """
    print(req)
    conn = None 
    try:
        if conn is None:
            conn = DB_utils.join_db()
        
        search_list = DB_utils.search_address(conn,req.address)

        return search_list

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if conn:
            conn.close()

# 1. 상세 페이지 렌더링 (HTML 파일을 보여줌)
@app.get("/detail/{bd_number}", response_class=HTMLResponse)
def detail_page(request: Request, bd_number: str):
    return templates.TemplateResponse(
        "detail.html", 
        {"request": request, "bd_number": bd_number}
    )

# 2. 상세 데이터 제공 API (프론트엔드 JS에서 호출)
@app.get("/api/building/{bd_number:int}")
def get_building_detail(bd_number: int):
    conn = None 
    result ={}
    try:
        conn = DB_utils.join_db()
        # 주의: DB_utils에 특정 ID로 1건만 조회하는 함수가 필요합니다.
        # 예시: search_address와 비슷하지만 단일 객체를 반환하는 함수
        building_data = DB_utils.extract_detail_info(conn, bd_number)
        result['info_data'] =  building_data
        detail_management_data = DB_utils.extract_detail_management(conn, bd_number) 
        result['lease_details'] = detail_management_data
        working_history_data = DB_utils.extract_working_history(conn, bd_number) 
        result['history_details'] = working_history_data

        image_info_data = DB_utils.image_search(conn, bd_number) 
        result['image_info'] = image_info_data

        intro_customer_data = DB_utils.extract_intro_customers_by_building(conn, bd_number)
        result['intro_customers'] = intro_customer_data

        if not result:
            raise HTTPException(status_code=404, detail="Building not found")
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()

# 1. 임대 상세 관리 항목을 위한 서브 모델 정의
class LeaseDetail(BaseModel):
    floor: Optional[str] = ""
    business_type: Optional[str] = "0"
    area_sqm: Optional[str] = "0"
    area_pyeong: Optional[str] = "0"
    deposit: Optional[str] = "0"
    monthly_rent_fee: Optional[str] = "0"
    maintenance_fee: Optional[str] = "0"
    remark: Optional[str] = ""
    is_vacant: Optional[str] = "-"
    


class historyDetail(BaseModel):
    writer: Optional[str] = ""
    write_time: Optional[str] = ""
    memo: Optional[str] = ""

class BuildingCreate(BaseModel):
    bd_number : str
    address: str
    bd_name: str
    address_detail : str
    nearby_station : str
    nearby_station2 : str
    site_location : str
    deposit_price :str
    other_sale_price :str
    sale_price :str
    yield_rate :str
    security_deposit :str
    price_per_pyeong :str
    monthly_rent_fee :str
    maintenance_expense :str
    maintenance_fee :str
    price_per_total_floor_area :str
    loan_status :str
    land_category :str
    zoning_type :str
    land_area_pyeong :str
    land_area_sqm :str
    official_price_per_sqm_won :str
    official_price_per_pyeong_million :str
    official_price_per_pyeong_million_date : str
    official_price_total_million :str
    approval_date :str
    heating_cooling :str
    violation_info : str
    gross_area_pyeong :str
    gross_area_sqm :str
    usable_area_pyeong : str

    building_area_pyeong : str
    building_area_sqm : str
    underground_floors :str
    aboveground_floors :str
    floor_height : str
    beam_clearance_height : str
    elevator :str
    emergency_elevator : str
    building_coverage_ratio :str
    floor_area_ratio :str
    parking_capacity :str
    parking_outdoor_mechanical : str
    parking_outdoor_self : str
    parking_indoor_mechanical : str
    parking_indoor_self : str

    client_name :str
    mobile_phone :str
    email :str
    office_phone :str
    home_phone :str
    road_access : str
    road_access2 : str
    orientation :str
    building_usage : str
    building_structure : str
    

    location_decide : str
    price_decide : str
    yield_decide : str
    vacancy_decide : str
    limit_decide : str
    loan_decide : str

    direction_basis : str 
    direction : str
    room_count : str
    bathroom_count : str

    is_new_site :bool 
    is_remodeling :bool
    is_office_building :bool 
    is_investment :bool
    is_development :bool
    is_stable_holding :bool

    memo :str 
    etc_memo :str 
    bd_feature :str 
    etc_feature :str 
    status :str
    lease_details: List[LeaseDetail]
    history_data: List[historyDetail]
    

# 새로운 데이터 등록 
@app.post("/api/building")
async def create_building(data: BuildingCreate):
    print("dddd")
    conn = DB_utils.join_db()
    cur = conn.cursor()
    
    insert_data = {
        'address' :data.address,
        'bd_name' :data.bd_name,
        'address_detail' :data.address_detail,
        'nearby_station':data.nearby_station,
        'nearby_station2':data.nearby_station2,
        'site_location' : data.site_location,
        'deposit_price':data.deposit_price,
        'other_sale_price' :data.other_sale_price,
        'sale_price' :data.sale_price,
        'yield_rate' :data.yield_rate,
        'security_deposit':data.security_deposit,
        'price_per_pyeong' :data.price_per_pyeong,
        'monthly_rent_fee' :data.monthly_rent_fee,
        'maintenance_expense' :data.maintenance_expense,
        'maintenance_fee' :data.maintenance_fee,
        'price_per_total_floor_area':data.price_per_total_floor_area,
        'loan_status' :data.loan_status,
        'land_category' :data.land_category,
        'zoning_type' :data.zoning_type,
        'land_area_pyeong' :data.land_area_pyeong,
        'land_area_sqm' :data.land_area_sqm,
        'official_price_per_sqm_won' :data.official_price_per_sqm_won,
        'official_price_per_pyeong_million' :data.official_price_per_pyeong_million,
        'official_price_per_pyeong_million_date' : data.official_price_per_pyeong_million_date,
        'official_price_total_million' :data.official_price_total_million,
        'approval_date' :data.approval_date,
        'heating_cooling' :data.heating_cooling,
        'violation_info' :data.violation_info,
        'gross_area_pyeong' :data.gross_area_pyeong,
        'gross_area_sqm':data.gross_area_sqm,
        'usable_area_pyeong':data.usable_area_pyeong,
        'building_area_pyeong' :data.building_area_pyeong,
        'building_area_sqm':data.building_area_sqm,
        'underground_floors' :data.underground_floors,
        'aboveground_floors' :data.aboveground_floors,
        'floor_height' :data.floor_height,
        'beam_clearance_height' :data.beam_clearance_height,
        'elevator' :data.elevator,
        'emergency_elevator' : data.emergency_elevator,
        'building_coverage_ratio' :data.building_coverage_ratio,
        'floor_area_ratio' :data.floor_area_ratio,
        
        'parking_capacity' :data.parking_capacity,
        'parking_outdoor_mechanical' :data.parking_outdoor_mechanical,
        'parking_outdoor_self' :data.parking_outdoor_self,
        'parking_indoor_mechanical' :data.parking_indoor_mechanical,
        'parking_indoor_self' :data.parking_indoor_self,
        'client_name' :data.client_name,
        'mobile_phone' :data.mobile_phone,
        'email' :data.email,
        'office_phone' :data.office_phone,
        'home_phone' :data.home_phone,
        'orientation' :data.orientation,
        'road_access' : data.road_access,
        'road_access2' : data.road_access2,
        'location_decide' : data.location_decide,
        'price_decide' : data.price_decide,
        'yield_decide' : data.yield_decide,
        'vacancy_decide' : data.vacancy_decide,
        'limit_decide' : data.limit_decide,
        'loan_decide' : data.loan_decide,
        'building_usage' : data.building_usage,
        'building_structure' : data.building_structure,

        'direction_basis':data.direction_basis,
        'direction':data.direction,
        'room_count':data.room_count,
        'bathroom_count':data.bathroom_count,

        'is_new_site' : data.is_new_site, 
        'is_remodeling' :data.is_remodeling,
        'is_office_building' :data.is_office_building,
        'is_investment' :data.is_investment,
        'is_development' :data.is_development,
        'is_stable_holding' :data.is_stable_holding
    }

    insert_data_memo = {
        'memo' :data.memo,
        'etc_memo' :data.etc_memo,
        'bd_feature' :data.bd_feature,
        'etc_feature' :data.etc_feature,
        'status' :data.status,
    }

    detail_mg = {
        'lease_details' : data.lease_details,
    }

    history_mg = {
        'history_data' : data.history_data,
    }

    try:
        # 1. building_info 테이블에 주소 저장 (bd_number는 자동 생성됨)
        # RETURNING bd_number를 통해 생성된 ID를 즉시 가져옵니다.
        cur.execute("""
            INSERT INTO building_id (register_id_number,delete_flag) 
            VALUES (%s,%s) 
            RETURNING bd_number
        """, ("0",False))
        # 모든 쿼리가 성공하면 확정
        # conn.commit()
        
        new_bd_id = cur.fetchone()[0]
        print("new_bd_id",new_bd_id)
    
        # 기본정보 넣기 
        insert_data = {k: (v if v != "" else None) for k, v in insert_data.items()}
       
        columns = list(insert_data.keys())
        params = list(insert_data.values())

        # 3. 맨 앞에 bd_number 추가
        columns.insert(0, "bd_number")
        params.insert(0, new_bd_id)

        col_names = ", ".join(columns)
        placeholders = ", ".join(["%s"] * len(columns))

        sql = f"INSERT INTO building_info ({col_names}) VALUES ({placeholders})"
        cur.execute(sql, params)
        # conn.commit()

        # 5. 메모 부분 DB 넣기
        insert_data_memo = {k: (v if v != "" else None) for k, v in insert_data_memo.items()}
        # 2. 컬럼명 리스트와 값 리스트 생성
        columns = list(insert_data_memo.keys())
        params = list(insert_data_memo.values())

        # 3. 맨 앞에 bd_number 추가
        columns.insert(0, "bd_number")
        params.insert(0, new_bd_id)

        # 4. 동적 쿼리 생성
        # 결과 예: INSERT INTO building_memo (bd_number, memo, status) VALUES (%s, %s, %s)
        col_names = ", ".join(columns)
        placeholders = ", ".join(["%s"] * len(columns))

        sql = f"INSERT INTO building_memo ({col_names}) VALUES ({placeholders})"
        cur.execute(sql, params)
        # 모든 쿼리가 성공하면 확정
        # conn.commit()

        # detail_management 정보 수정
        # 기존에 있던 것 모두 삭제 
        cur.execute("DELETE FROM detail_management WHERE bd_number = %s", (new_bd_id,))

        # 2. 새로운 상세 정보 저장 (Insert)
        # lease_details는 Pydantic 모델을 통해 들어온 리스트 데이터입니다.
        for item in data.lease_details:
            # Pydantic 모델 객체를 딕셔너리로 변환
            detail_dict = item.dict()
            
            # 빈 값 처리 (PostgreSQL 표준)
            detail_dict = {k: (v if v != "" else "0") for k, v in detail_dict.items()}
            
            columns = list(detail_dict.keys())
            params = list(detail_dict.values())
            
            # bd_number를 리스트 맨 앞에 추가
            columns.insert(0, "bd_number")
            params.insert(0, new_bd_id)
            
            col_names = ", ".join(columns)
            placeholders = ", ".join(["%s"] * len(columns))
            
            insert_sql = f"INSERT INTO detail_management ({col_names}) VALUES ({placeholders})"
            cur.execute(insert_sql, params)

        # ------------------------------------------

        ##### working_history 저장 
        # 기존에 있던 것 모두 삭제 
        cur.execute("DELETE FROM working_history WHERE bd_number = %s", (new_bd_id,))
        for item in data.history_data:
            detail_dict = item.dict()
            
            # 빈 값 처리 (PostgreSQL 표준)
            detail_dict = {k: (v if v != "" else "0") for k, v in detail_dict.items()}
            
            columns = list(detail_dict.keys())
            params = list(detail_dict.values())
            
            # bd_number를 리스트 맨 앞에 추가
            columns.insert(0, "bd_number")
            params.insert(0, new_bd_id)
            
            col_names = ", ".join(columns)
            placeholders = ", ".join(["%s"] * len(columns))
            
            
            insert_sql = f"INSERT INTO working_history ({col_names}) VALUES ({placeholders})"
            cur.execute(insert_sql, params)
        # ------------------------------------------

        # 모든 쿼리가 성공하면 최종 확정
        conn.commit()





        print(f"새로운 건물 등록 완료: ID {new_bd_id}")
        
        return {"status": "created", "bd_number": new_bd_id}
        
    except Exception as e:
        # 하나라도 실패하면 전체 취소(Rollback)하여 데이터가 꼬이는 것을 방지
        conn.rollback()
        print(f"등록 중 오류 발생: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        cur.close()
        conn.close()

# [PUT] 기존 데이터 수정
@app.put("/api/building/{bd_id:int}")
async def update_building(bd_id: int, data: BuildingCreate):
    conn = DB_utils.join_db()
    cur = conn.cursor()

    update_data = {
        'address' :data.address,
        'bd_name' :data.bd_name,
        'address_detail' :data.address_detail,
        'nearby_station':data.nearby_station,
        'nearby_station2':data.nearby_station2,
        'site_location' : data.site_location,
        'deposit_price':data.deposit_price,
        'other_sale_price' :data.other_sale_price,
        'sale_price' :data.sale_price,
        'yield_rate' :data.yield_rate,
        'security_deposit':data.security_deposit,
        'price_per_pyeong' :data.price_per_pyeong,
        'monthly_rent_fee' :data.monthly_rent_fee,
        'maintenance_expense' :data.maintenance_expense,
        'maintenance_fee' :data.maintenance_fee,
        'price_per_total_floor_area':data.price_per_total_floor_area,
        'loan_status' :data.loan_status,
        'land_category' :data.land_category,
        'zoning_type' :data.zoning_type,
        'land_area_pyeong' :data.land_area_pyeong,
        'land_area_sqm' :data.land_area_sqm,
        'official_price_per_sqm_won' :data.official_price_per_sqm_won,
        'official_price_per_pyeong_million' :data.official_price_per_pyeong_million,
        'official_price_per_pyeong_million_date' : data.official_price_per_pyeong_million_date,
        'official_price_total_million' :data.official_price_total_million,
        'approval_date' :data.approval_date,
        'heating_cooling' :data.heating_cooling,
        'violation_info' :data.violation_info,
        'gross_area_pyeong' :data.gross_area_pyeong,
        'gross_area_sqm':data.gross_area_sqm,
        'usable_area_pyeong':data.usable_area_pyeong,
        'building_area_pyeong' :data.building_area_pyeong,
        'building_area_sqm':data.building_area_sqm,

        'underground_floors' :data.underground_floors,
        'aboveground_floors' :data.aboveground_floors,
        'floor_height' :data.floor_height,
        'beam_clearance_height' :data.beam_clearance_height,
        'elevator' :data.elevator,
        'emergency_elevator' : data.emergency_elevator,
        'building_coverage_ratio' :data.building_coverage_ratio,
        'floor_area_ratio' :data.floor_area_ratio,
        
        'parking_capacity' :data.parking_capacity,
        'parking_outdoor_mechanical' :data.parking_outdoor_mechanical,
        'parking_outdoor_self' :data.parking_outdoor_self,
        'parking_indoor_mechanical' :data.parking_indoor_mechanical,
        'parking_indoor_self' :data.parking_indoor_self,
        
        'client_name' :data.client_name,
        'mobile_phone' :data.mobile_phone,
        'email' :data.email,
        'office_phone' :data.office_phone,
        'home_phone' :data.home_phone,
        'orientation' :data.orientation,
        'road_access' : data.road_access,
        'road_access2' : data.road_access2,
        'location_decide' : data.location_decide,
        'price_decide' : data.price_decide,
        'yield_decide' : data.yield_decide,
        'vacancy_decide' : data.vacancy_decide,
        'limit_decide' : data.limit_decide,
        'loan_decide' : data.loan_decide,
        'building_usage' : data.building_usage,
        'building_structure' : data.building_structure,

        'direction_basis':data.direction_basis,
        'direction':data.direction,
        'room_count':data.room_count,
        'bathroom_count':data.bathroom_count,

        'is_new_site' : data.is_new_site, 
        'is_remodeling' :data.is_remodeling,
        'is_office_building' :data.is_office_building,
        'is_investment' :data.is_investment,
        'is_development' :data.is_development,
        'is_stable_holding' :data.is_stable_holding
    }

    update_data_memo = {
        'memo' :data.memo,
        'etc_memo' :data.etc_memo,
        'bd_feature' :data.bd_feature,
        'etc_feature' :data.etc_feature,
        'status' :data.status,
    }

    detail_mg = {
        'lease_details' : data.lease_details,
    }

    history_mg = {
        'history_data' : data.history_data,
    }
    try: 

        #############33 info 관련 정보 
        # 쿼리생성 
        update_data = {k: (v if v != "" else None) for k, v in update_data.items()}
        set_clause = ", ".join([f"{column} = %s" for column in update_data.keys()])
        params = list(update_data.values())
        params.append(bd_id)
        sql = f"UPDATE building_info SET {set_clause} WHERE bd_number = %s"
        cur.execute(sql, params)

        ####################### memo 관련 정보 
        update_data_memo = {k: (v if v != "" else None) for k, v in update_data_memo.items()}
        set_clause = ", ".join([f"{column} = %s" for column in update_data_memo.keys()])
        params = list(update_data_memo.values())
        params.append(bd_id)
        sql = f"UPDATE building_memo SET {set_clause} WHERE bd_number = %s"
        cur.execute(sql, params)


        ####################### detail_management 관련 정보 
        # 기존에 있던 것 모두 삭제 
        
        cur.execute("DELETE FROM detail_management WHERE bd_number = %s", (bd_id,))
        for item in data.lease_details:
            detail_dict = item.dict()
            
            # 빈 값 처리 (PostgreSQL 표준)
            detail_dict = {k: v for k, v in detail_dict.items()}
            
            columns = list(detail_dict.keys())
            params = list(detail_dict.values())
            
            # bd_number를 리스트 맨 앞에 추가
            columns.insert(0, "bd_number")
            params.insert(0, bd_id)
            
            col_names = ", ".join(columns)
            placeholders = ", ".join(["%s"] * len(columns))
            
            insert_sql = f"INSERT INTO detail_management ({col_names}) VALUES ({placeholders})"
            cur.execute(insert_sql, params)

        # ------------------------------------------

        ####################### working_history 관련 정보 
        # 기존에 있던 것 모두 삭제 
        cur.execute("DELETE FROM working_history WHERE bd_number = %s", (bd_id,))
        for item in data.history_data:
            detail_dict = item.dict()
            
            # 빈 값 처리 (PostgreSQL 표준)
            detail_dict = {k: (v if v != "" else "0") for k, v in detail_dict.items()}
            
            columns = list(detail_dict.keys())
            params = list(detail_dict.values())
            
            # bd_number를 리스트 맨 앞에 추가
            columns.insert(0, "bd_number")
            params.insert(0, bd_id)
            
            col_names = ", ".join(columns)
            placeholders = ", ".join(["%s"] * len(columns))
            
            
            insert_sql = f"INSERT INTO working_history ({col_names}) VALUES ({placeholders})"
            cur.execute(insert_sql, params)
        # ------------------------------------------

        # 모든 쿼리가 성공하면 최종 확정
        conn.commit()


        print(f"건물 정보 수정 완료: ID {bd_id}")
        
        return {"status": "updated", "bd_number": bd_id}
        
    except Exception as e:
        conn.rollback()
        print(f"수정 중 오류 발생: {e}")
        print(data.lease_details)
        raise HTTPException(status_code=500, detail=f"수정 오류: {str(e)}")
        
    finally:
        cur.close()
        conn.close()






from fastapi import UploadFile, File, Form, HTTPException
from collections import defaultdict
from typing import Optional
import uuid, shutil

BASE_UPLOAD_DIR = Path("./save_file")

############################### Image save Api
@app.post("/api/building/{bd_id}/images")
async def upload_building_images(
    bd_id: int,
    images: Optional[list[UploadFile]] = File(None),
    sections: Optional[list[str]] = Form(...),
    indices: list[int] = Form(...),
    actions: list[str] = Form(...)
):
    # DB 연결 
    conn = None 
    try:
        if conn is None:
            conn = DB_utils.join_db()
        
    except Exception as e:
        if conn:
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

   
    # if not images or not sections:
    #     return {
    #         "message": "업로드할 이미지 없음",
    #         "files": []
    #     }
    
    building_dir = BASE_UPLOAD_DIR / str(bd_id)
    building_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []

    img_i = 0

    # ✅ section별 업로드 개수 카운트
    for action, section, index in zip(actions, sections, indices):
        print(action, section, index)
        if action == "D":
            ## Image DB 업데이트 flag True 변경  
            DB_utils.image_remove(conn, bd_id, section,index)
        else:
            image = images[img_i]
            img_i += 1

            # 🖼 확장자 유지
            ext = Path(image.filename).suffix or ".jpg"

            # 🔢 section_번호_파일명
            index = image.filename.split("_")[1].split(".jpg")[0]
            image_name= f"{uuid.uuid4().hex}{ext}"
            filename = f"{section}_{index}_{image_name}"

            # 📁 저장 경로
            file_path = building_dir / filename

            # 💾 파일 저장
            with file_path.open("wb") as buffer:
                shutil.copyfileobj(image.file, buffer)

            saved_files.append({
                "section": section,
                "index": index,
                "filename": filename,
                "path": str(file_path)
            })
            ########### Insert Image DB
            DB_utils.image_register(conn, bd_id, section,index,str(BASE_UPLOAD_DIR), str(image_name))

    if conn:
        conn.close()

    return {
        "message": "이미지 업로드 완료",
        "files": saved_files
    }


############################### make ppt 

sys.path.append('./ppt/module')
import make_ppt

@app.post("/api/building/{bd_id}/ppt")
async def generate_ppt(bd_id: int):
    ppt_path, filename  = make_ppt.run(bd_id)  # ← ppt 파일 경로 반환

    return FileResponse(
        ppt_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=filename
    )
    


##################### delete object
class DeleteRequest(BaseModel):
    bd_number: int

@app.post("/api/building/delete")
def delete_building(req: DeleteRequest):
    bd_number = req.bd_number
    # DB 연결 
    conn = None 
    try:
        if conn is None:
            conn = DB_utils.join_db()
        DB_utils.delete_row(conn,bd_number)
    except Exception as e:
        if conn:
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "delete", "bd_number": bd_number}
        
import uvicorn
# ✅ 여기 중요
if __name__ == "__main__":
    settings = DB_utils._load_settings()
    app_settings = settings.get("app", {})
    uvicorn.run(
        "core:app",
        host=app_settings.get("host", "0.0.0.0"),
        port=app_settings.get("port", 8000),
        reload=app_settings.get("reload", True)
    )
