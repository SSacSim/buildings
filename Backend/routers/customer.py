from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from typing import Optional, List
from pydantic import BaseModel, Field

import sys

sys.path.append('../DB')

import DB_utils

router = APIRouter()
templates = Jinja2Templates(directory="./templates")


def ensure_customer_intro_table(conn, cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS customer_intro_property (
            intro_id BIGSERIAL PRIMARY KEY,
            customer_number INTEGER NOT NULL,
            bd_number INTEGER NOT NULL,
            intro_date DATE DEFAULT CURRENT_DATE,
            progress_status VARCHAR(255),
            intro_cost VARCHAR(255),
            manager_name VARCHAR(255),
            address VARCHAR(255),
            bd_name VARCHAR(255),
            sale_price VARCHAR(255),
            price_per_pyeong VARCHAR(255),
            intro_note TEXT,
            create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delete_flag BOOLEAN DEFAULT FALSE
        );
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_intro_property
        ADD COLUMN IF NOT EXISTS manager_name VARCHAR(255);
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_intro_property
        ADD COLUMN IF NOT EXISTS intro_cost VARCHAR(255);
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_info
        ADD COLUMN IF NOT EXISTS owned_properties_json TEXT;
        """
    )
    conn.commit()


@router.get("/customer/new", response_class=HTMLResponse)
def new_detail(request: Request):
    return templates.TemplateResponse(
        "customer.html",
        {"request": request, "mode": "new"}
    )


@router.get("/customer/{customer_number:int}", response_class=HTMLResponse)
def detail_page(request: Request, customer_number: int):
    return templates.TemplateResponse(
        "customer.html",
        {"request": request, "customer_number": customer_number}
    )


@router.get("/api/customer/{customer_number:int}")
def get_customer_detail(customer_number: int):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        cur.execute(
            """
            SELECT customer_number, status, buyer_name, company_address, ceo_name,
                   home_address, phone, first_contact,
                   customer_state, business_area, building_preference,
                   main_interest_region, customer_note, match_conditions_json, owned_properties_json
            FROM customer_info
            WHERE customer_number = %s AND delete_flag = FALSE
            """,
            (customer_number,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Customer not found")

        columns = [desc[0] for desc in cur.description]
        data_detail = dict(zip(columns, row))

        cur.execute(
            """
            SELECT intro_id, customer_number, bd_number, intro_date,
                   progress_status, intro_cost, manager_name, address, bd_name, sale_price, price_per_pyeong, intro_note
            FROM customer_intro_property
            WHERE customer_number = %s AND delete_flag = FALSE
            ORDER BY intro_date DESC, intro_id DESC
            """,
            (customer_number,)
        )
        intro_cols = [desc[0] for desc in cur.description]
        intro_rows = [dict(zip(intro_cols, r)) for r in cur.fetchall()]

        return {
            "data_detail": data_detail,
            "intro_properties": intro_rows
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/api/customer/search")
def search_customer(
    q: str = Query(""),
    limit: int = Query(20, ge=1, le=100)
):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()

        keyword = (q or "").strip()

        if keyword:
            cur.execute(
                """
                SELECT customer_number, status, buyer_name, company_address, phone
                FROM customer_info
                WHERE delete_flag = FALSE
                  AND (
                        CAST(customer_number AS TEXT) ILIKE %s
                     OR buyer_name ILIKE %s
                     OR phone ILIKE %s
                     OR company_address ILIKE %s
                  )
                ORDER BY customer_number DESC
                LIMIT %s
                """,
                (f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", limit)
            )
        else:
            cur.execute(
                """
                SELECT customer_number, status, buyer_name, company_address, phone
                FROM customer_info
                WHERE delete_flag = FALSE
                ORDER BY customer_number DESC
                LIMIT %s
                """,
                (limit,)
            )

        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in rows]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/api/building/quick-search")
def quick_search_building(
    q: str = Query(""),
    limit: int = Query(20, ge=1, le=100)
):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()

        keyword = (q or "").strip()

        if keyword:
            cur.execute(
                """
                SELECT bd_number, address, bd_name, sale_price, price_per_pyeong
                FROM building_info
                WHERE delete_flag = FALSE
                  AND (
                        CAST(bd_number AS TEXT) ILIKE %s
                     OR address ILIKE %s
                     OR bd_name ILIKE %s
                  )
                ORDER BY update_time DESC, bd_number DESC
                LIMIT %s
                """,
                (f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", limit)
            )
        else:
            cur.execute(
                """
                SELECT bd_number, address, bd_name, sale_price, price_per_pyeong
                FROM building_info
                WHERE delete_flag = FALSE
                ORDER BY update_time DESC, bd_number DESC
                LIMIT %s
                """,
                (limit,)
            )

        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in rows]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@router.get("/api/customer/match-search")
def customer_match_search(
    address: str = Query(""),
    business_area: str = Query(""),
    station_keyword: str = Query(""),
    min_price: Optional[int] = Query(None),
    max_price: Optional[int] = Query(None),
    cash_hold_manwon: Optional[float] = Query(None),
    cash_hold_eok: Optional[float] = Query(None),  # backward compatibility
    cash_hold_percent: Optional[float] = Query(None),
    station_walk_min: Optional[float] = Query(None),
    station_walk_max: Optional[float] = Query(None),
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
    types: str = Query(""),
    limit: int = Query(30, ge=1, le=200)
):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()

        sql = """
            SELECT
                bi.bd_number, bi.bd_name, bi.address, bi.sale_price, bi.yield_rate,
                bi.is_new_site, bi.is_remodeling, bi.is_office_building, bi.is_investment, bi.is_development, bi.is_stable_holding
            FROM building_info bi
            LEFT JOIN building_memo bm
              ON bi.bd_number = bm.bd_number
            WHERE bi.delete_flag = FALSE
        """
        params: list = []

        if address.strip():
            sql += " AND (address ILIKE %s OR bd_name ILIKE %s)"
            params.extend([f"%{address.strip()}%", f"%{address.strip()}%"])
        if business_area.strip():
            sql += " AND COALESCE(site_location, '') ILIKE %s"
            params.append(f"%{business_area.strip()}%")
        if station_keyword.strip():
            sql += """
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
            params.extend([kw, kw, kw, kw])

        if min_price is not None:
            sql += " AND NULLIF(regexp_replace(COALESCE(sale_price, ''), '[^0-9]', '', 'g'), '')::bigint >= %s"
            params.append(min_price)
        if max_price is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(sale_price, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            params.append(max_price)

        effective_cash_hold_manwon = cash_hold_manwon
        if effective_cash_hold_manwon is None and cash_hold_eok is not None:
            effective_cash_hold_manwon = cash_hold_eok * 10000.0

        if effective_cash_hold_manwon is not None:
            leverage = 0.0 if cash_hold_percent is None else float(cash_hold_percent)
            if leverage >= 100:
                raise HTTPException(status_code=400, detail="현금보유액 %는 100 미만이어야 합니다.")
            if leverage < 0:
                raise HTTPException(status_code=400, detail="현금보유액 %는 0 이상이어야 합니다.")

            cash_ratio = 1 - (leverage / 100.0)
            if cash_ratio <= 0:
                raise HTTPException(status_code=400, detail="현금보유액 조건 계산이 올바르지 않습니다.")

            max_sale_price_manwon = effective_cash_hold_manwon / cash_ratio
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(sale_price, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            params.append(int(max_sale_price_manwon))

        if station_walk_min is not None:
            sql += """
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
            params.extend([station_walk_min, station_walk_min])
        if station_walk_max is not None:
            sql += """
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
            params.extend([station_walk_max, station_walk_max])

        if min_yield is not None:
            sql += """
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
            params.append(min_yield)

        if land_pp_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_pyeong, ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= %s"
            params.append(land_pp_min)
        if land_pp_max is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_pyeong, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            params.append(land_pp_max)

        if gross_pp_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_total_floor_area, ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= %s"
            params.append(gross_pp_min)
        if gross_pp_max is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(price_per_total_floor_area, ''), '[^0-9]', '', 'g'), '')::bigint, 0) <= %s"
            params.append(gross_pp_max)

        if land_area_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(land_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            params.append(land_area_min)
        if land_area_max is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(land_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            params.append(land_area_max)

        if gross_area_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(gross_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            params.append(gross_area_min)
        if gross_area_max is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(gross_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            params.append(gross_area_max)

        if usable_area_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(usable_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            params.append(usable_area_min)
        if usable_area_max is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(usable_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            params.append(usable_area_max)

        if approval_year_min is not None:
            sql += " AND COALESCE(NULLIF(SUBSTRING(COALESCE(approval_date, '') FROM '([0-9]{4})'), '')::int, 0) >= %s"
            params.append(approval_year_min)

        if road_width_min is not None:
            sql += """
                AND EXISTS (
                    SELECT 1
                    FROM regexp_split_to_table(COALESCE(road_access2, ''), '##') AS road_row
                    WHERE COALESCE(
                        NULLIF(
                            regexp_replace(
                                split_part(road_row, '|', 1),
                                '[^0-9.]',
                                '',
                                'g'
                            ),
                            ''
                        )::numeric,
                        0
                    ) >= %s
                )
            """
            params.append(road_width_min)

        normalized_elevator_option = (elevator_option or "").strip()
        if normalized_elevator_option == "있음":
            sql += """
                AND (
                    COALESCE(NULLIF(regexp_replace(COALESCE(elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
                    OR COALESCE(NULLIF(regexp_replace(COALESCE(emergency_elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
                )
            """
        elif normalized_elevator_option == "없음":
            sql += """
                AND (
                    COALESCE(NULLIF(regexp_replace(COALESCE(elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) = 0
                    AND COALESCE(NULLIF(regexp_replace(COALESCE(emergency_elevator, ''), '[^0-9]', '', 'g'), '')::int, 0) = 0
                )
            """

        normalized_building_status = (building_status or "").strip()
        if normalized_building_status and normalized_building_status != "전체":
            sql += " AND COALESCE(bm.status, '') = %s"
            params.append(normalized_building_status)

        if parking_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(parking_capacity, ''), '[^0-9]', '', 'g'), '')::int, 0) >= %s"
            params.append(parking_min)

        selected_zoning_categories = [c.strip() for c in zoning_categories.split(",") if c.strip()]
        if selected_zoning_categories:
            zoning_ors = []
            for category in selected_zoning_categories:
                if category == "상업":
                    zoning_ors.append("COALESCE(zoning_type::text, '') ILIKE %s")
                    params.append("%상업%")
                elif category == "공업":
                    zoning_ors.append("COALESCE(zoning_type::text, '') ILIKE %s")
                    params.append("%공업%")
                elif category == "주거":
                    zoning_ors.append("COALESCE(zoning_type::text, '') ILIKE %s")
                    params.append("%주거%")
                elif category == "기타":
                    zoning_ors.append(
                        "(COALESCE(zoning_type::text, '') NOT ILIKE %s AND COALESCE(zoning_type::text, '') NOT ILIKE %s AND COALESCE(zoning_type::text, '') NOT ILIKE %s)"
                    )
                    params.extend(["%상업%", "%공업%", "%주거%"])
            if zoning_ors:
                sql += " AND (" + " OR ".join(zoning_ors) + ")"

        selected_usage_categories = [c.strip() for c in usage_categories.split(",") if c.strip()]
        if selected_usage_categories:
            usage_ors = []
            for category in selected_usage_categories:
                if category == "근린":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    params.append("%근린%")
                elif category == "업무":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    params.append("%업무%")
                elif category == "숙박":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    params.append("%숙박%")
                elif category == "위락":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    params.append("%위락%")
                elif category == "주택":
                    usage_ors.append("COALESCE(building_usage::text, '') ILIKE %s")
                    params.append("%주택%")
                elif category == "기타":
                    usage_ors.append(
                        "(COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s AND COALESCE(building_usage::text, '') NOT ILIKE %s)"
                    )
                    params.extend(["%근린%", "%업무%", "%숙박%", "%위락%", "%주택%"])
            if usage_ors:
                sql += " AND (" + " OR ".join(usage_ors) + ")"

        selected_types = [t.strip() for t in types.split(",") if t.strip()]
        has_address = bool(address.strip())
        has_business_area = bool(business_area.strip())
        has_station_keyword = bool(station_keyword.strip())
        has_min_price = min_price is not None
        has_max_price = max_price is not None
        has_cash_hold = (effective_cash_hold_manwon is not None) or (cash_hold_percent is not None)
        has_station_walk = (station_walk_min is not None) or (station_walk_max is not None)
        has_min_yield = min_yield is not None
        has_land_pp = (land_pp_min is not None) or (land_pp_max is not None)
        has_gross_pp = (gross_pp_min is not None) or (gross_pp_max is not None)
        has_land_area = (land_area_min is not None) or (land_area_max is not None)
        has_gross_area = (gross_area_min is not None) or (gross_area_max is not None)
        has_usable_area = (usable_area_min is not None) or (usable_area_max is not None)
        has_approval_year = approval_year_min is not None
        has_road_width = road_width_min is not None
        has_elevator_option = normalized_elevator_option in ("있음", "없음")
        has_parking = parking_min is not None
        has_zoning_categories = len(selected_zoning_categories) > 0
        has_usage_categories = len(selected_usage_categories) > 0
        has_types = len(selected_types) > 0

        # 조건이 하나도 없으면 검색하지 않음
        if not (has_address or has_business_area or has_station_keyword or has_min_price or has_max_price or has_cash_hold or has_station_walk or has_min_yield or has_land_pp or has_gross_pp or has_land_area or has_gross_area or has_usable_area or has_approval_year or has_road_width or has_elevator_option or has_parking or has_zoning_categories or has_usage_categories or has_types):
            return []

        type_map = {
            "신축부지": "is_new_site",
            "리모델링": "is_remodeling",
            "사옥형": "is_office_building",
            "수익형": "is_investment",
            "개발/전환": "is_development",
            "보유안정": "is_stable_holding",
            "투자용": "is_investment",
            "개발": "is_development",
        }
        type_columns = [type_map[t] for t in selected_types if t in type_map]
        if type_columns:
            # 체크된 유형은 모두 충족해야 하므로 AND 조건으로 필터링
            sql += " AND (" + " AND ".join([f"COALESCE({col}, FALSE) = TRUE" for col in type_columns]) + ")"

        sql += " ORDER BY bi.update_time DESC, bi.bd_number DESC LIMIT %s"
        params.append(limit)

        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        result = []
        for row in rows:
            item = dict(zip(columns, row))
            score = 0
            if address.strip() and address.strip() in (item.get("address") or ""):
                score += 40
            score += 10 * sum(
                1 for c in type_columns if item.get(c) is True
            )
            item["match_score"] = min(score, 100)
            result.append(item)

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


class CustomerInfo(BaseModel):
    customer_number: Optional[str]
    status: Optional[str]
    buyer_name: Optional[str]
    company_address: Optional[str]
    ceo_name: Optional[str]
    home_address: Optional[str]
    phone: Optional[str]
    first_contact: Optional[str]
    customer_state: Optional[str]
    business_area: Optional[str]
    building_preference: Optional[str]
    main_interest_region: Optional[str]
    customer_note: Optional[str]
    match_conditions_json: Optional[str]
    owned_properties_json: Optional[str]


class CustomerIntroProperty(BaseModel):
    intro_id: Optional[int] = None
    intro_date: Optional[str] = None
    progress_status: Optional[str] = None
    intro_cost: Optional[str] = None
    manager_name: Optional[str] = None
    bd_number: int
    address: Optional[str] = None
    bd_name: Optional[str] = None
    sale_price: Optional[str] = None
    price_per_pyeong: Optional[str] = None
    intro_note: Optional[str] = None


class CustomerCreate(BaseModel):
    data_detail: CustomerInfo
    intro_properties: List[CustomerIntroProperty] = Field(default_factory=list)


def insert_intro_properties(cur, customer_number: int, intro_properties: List[CustomerIntroProperty]):
    for item in intro_properties:
        cur.execute(
            """
            INSERT INTO customer_intro_property (
                customer_number, bd_number, intro_date, progress_status, intro_cost, manager_name,
                address, bd_name, sale_price, price_per_pyeong, intro_note, delete_flag
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE)
            """,
            (
                customer_number,
                item.bd_number,
                item.intro_date,
                item.progress_status,
                item.intro_cost,
                item.manager_name,
                item.address,
                item.bd_name,
                item.sale_price,
                item.price_per_pyeong,
                item.intro_note,
            )
        )


@router.post("/api/customer")
async def create_customer(data: CustomerCreate):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        cur.execute(
            """
            INSERT INTO customer_id (register_id_number, delete_flag)
            VALUES (%s, %s)
            RETURNING customer_number
            """,
            ("0", False)
        )

        new_customer_number = cur.fetchone()[0]

        info = data.data_detail.dict()
        insert_data = {
            k: (v if v != "" else None)
            for k, v in info.items()
            if k != "customer_number"
        }

        columns = list(insert_data.keys())
        params = list(insert_data.values())
        columns.insert(0, "customer_number")
        params.insert(0, new_customer_number)

        col_names = ", ".join(columns)
        placeholders = ", ".join(["%s"] * len(columns))

        sql = f"INSERT INTO customer_info ({col_names}) VALUES ({placeholders})"
        cur.execute(sql, params)

        insert_intro_properties(cur, new_customer_number, data.intro_properties)

        conn.commit()
        return {"status": "created", "customer_number": new_customer_number}

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.put("/api/customer/{customer_number:int}")
async def update_customer(customer_number: int, data: CustomerCreate):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        info = data.data_detail.dict()
        update_data = {
            k: (v if v != "" else None)
            for k, v in info.items()
            if k != "customer_number"
        }

        set_clause = ", ".join([f"{column} = %s" for column in update_data.keys()])
        params = list(update_data.values())
        params.append(customer_number)

        sql = f"UPDATE customer_info SET {set_clause}, update_time = CURRENT_TIMESTAMP WHERE customer_number = %s"
        cur.execute(sql, params)

        cur.execute(
            """
            UPDATE customer_intro_property
            SET delete_flag = TRUE, update_time = CURRENT_TIMESTAMP
            WHERE customer_number = %s AND delete_flag = FALSE
            """,
            (customer_number,)
        )

        insert_intro_properties(cur, customer_number, data.intro_properties)

        conn.commit()

        return {"status": "updated", "customer_number": customer_number}
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
