from fastapi import APIRouter, Request, HTTPException, Query, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from typing import Optional, List
from pydantic import BaseModel, Field
from pathlib import Path
import shutil
import uuid

import sys

sys.path.append('../DB')

import DB_utils

router = APIRouter()
templates = Jinja2Templates(directory="./templates")
CUSTOMER_PHOTO_BASE_DIR = Path(__file__).resolve().parent.parent / "photo"
CUSTOMER_IMAGE_SLOTS = {"profile", "card"}


def _get_kakao_js_app_key() -> str:
    try:
        settings = DB_utils._load_settings()
    except Exception:
        return ""
    app_settings = settings.get("app", {}) if isinstance(settings, dict) else {}
    return str(app_settings.get("kakao_js_app_key", "") or "").strip()


def _ensure_customer_image_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS customer_image_info (
            img_number BIGSERIAL PRIMARY KEY,
            customer_number INTEGER NOT NULL,
            slot VARCHAR(30) NOT NULL,
            root_path VARCHAR(255) NOT NULL,
            img_name VARCHAR(255) NOT NULL,
            create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delete_flag BOOLEAN DEFAULT FALSE
        );
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_customer_image_info_lookup
        ON customer_image_info (customer_number, slot, delete_flag, img_number DESC);
        """
    )


def _customer_photo_dir(customer_number: int) -> Path:
    return CUSTOMER_PHOTO_BASE_DIR / str(customer_number)


def _customer_image_url(customer_number: int, image_name: str) -> str:
    return f"/photo/{customer_number}/{image_name}"


def _get_customer_images_from_db(cur, customer_number: int) -> dict:
    cur.execute(
        """
        SELECT slot, img_name
        FROM customer_image_info
        WHERE customer_number = %s
          AND delete_flag = FALSE
        ORDER BY slot ASC, img_number ASC
        """,
        (customer_number,)
    )
    images = {"profile": [], "card": []}
    for slot, img_name in cur.fetchall():
        if slot in images and img_name:
            images[slot].append(_customer_image_url(customer_number, img_name))
    return images


def _insert_customer_image_record(cur, customer_number: int, slot: str, image_name: str):
    cur.execute(
        """
        INSERT INTO customer_image_info (customer_number, slot, root_path, img_name, delete_flag)
        VALUES (%s, %s, %s, %s, FALSE)
        """,
        (customer_number, slot, "photo", image_name)
    )


def _save_customer_photo(customer_number: int, slot: str, upload: UploadFile) -> str:
    if slot not in CUSTOMER_IMAGE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")

    folder = _customer_photo_dir(customer_number)
    folder.mkdir(parents=True, exist_ok=True)

    ext = Path(upload.filename or "").suffix.lower() or ".jpg"
    image_name = f"{slot}_{uuid.uuid4().hex}{ext}"
    target = folder / image_name

    with target.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    return image_name


def _delete_customer_photo_file(customer_number: int, image_name: Optional[str]):
    if not image_name:
        return
    target = _customer_photo_dir(customer_number) / image_name
    if not target.exists():
        return
    try:
        target.unlink()
    except Exception:
        pass


def _soft_delete_customer_image(cur, customer_number: int, slot: str, image_name: Optional[str] = None) -> Optional[str]:
    if image_name:
        cur.execute(
            """
            SELECT img_number, img_name
            FROM customer_image_info
            WHERE customer_number = %s
              AND slot = %s
              AND img_name = %s
              AND delete_flag = FALSE
            ORDER BY img_number DESC
            LIMIT 1
            """,
            (customer_number, slot, image_name)
        )
    else:
        cur.execute(
            """
            SELECT img_number, img_name
            FROM customer_image_info
            WHERE customer_number = %s
              AND slot = %s
              AND delete_flag = FALSE
            ORDER BY img_number DESC
            LIMIT 1
            """,
            (customer_number, slot)
        )
    row = cur.fetchone()
    if not row:
        return None

    img_number, image_name = row
    cur.execute(
        """
        UPDATE customer_image_info
        SET delete_flag = TRUE,
            update_time = CURRENT_TIMESTAMP
        WHERE img_number = %s
        """,
        (img_number,)
    )
    return image_name


class CustomerImageOrderPayload(BaseModel):
    image_names: List[str] = Field(default_factory=list)


def _reorder_customer_images(cur, customer_number: int, slot: str, image_names: List[str]):
    cur.execute(
        """
        SELECT img_name, root_path
        FROM customer_image_info
        WHERE customer_number = %s
          AND slot = %s
          AND delete_flag = FALSE
        ORDER BY img_number ASC
        """,
        (customer_number, slot),
    )
    rows = cur.fetchall()
    if not rows:
        return

    existing_order = [name for name, _ in rows]
    existing_roots = {name: root_path for name, root_path in rows}

    normalized_requested = []
    seen = set()
    for name in (image_names or []):
        n = (name or "").strip()
        if not n or n in seen:
            continue
        if n in existing_roots:
            normalized_requested.append(n)
            seen.add(n)

    for name in existing_order:
        if name not in seen:
            normalized_requested.append(name)
            seen.add(name)

    cur.execute(
        """
        UPDATE customer_image_info
        SET delete_flag = TRUE,
            update_time = CURRENT_TIMESTAMP
        WHERE customer_number = %s
          AND slot = %s
          AND delete_flag = FALSE
        """,
        (customer_number, slot),
    )

    for name in normalized_requested:
        cur.execute(
            """
            INSERT INTO customer_image_info (customer_number, slot, root_path, img_name, delete_flag)
            VALUES (%s, %s, %s, %s, FALSE)
            """,
            (customer_number, slot, existing_roots[name], name),
        )


def ensure_customer_intro_table(conn, cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS customer_intro_property (
            intro_id BIGSERIAL PRIMARY KEY,
            customer_number INTEGER NOT NULL,
            bd_number INTEGER NOT NULL,
            intro_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'customer_intro_property'
                  AND column_name = 'intro_date'
                  AND data_type = 'date'
            ) THEN
                ALTER TABLE customer_intro_property
                ALTER COLUMN intro_date TYPE TIMESTAMP
                USING intro_date::timestamp;
            END IF;
        END $$;
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_intro_property
        ALTER COLUMN intro_date SET DEFAULT CURRENT_TIMESTAMP;
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_info
        ADD COLUMN IF NOT EXISTS owned_properties_json TEXT;
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_info
        ADD COLUMN IF NOT EXISTS email VARCHAR(255);
        """
    )
    cur.execute(
        """
        ALTER TABLE customer_info
        ADD COLUMN IF NOT EXISTS desired_price_manwon VARCHAR(255);
        """
    )
    _ensure_customer_image_table(cur)
    conn.commit()


@router.get("/customer/new", response_class=HTMLResponse)
def new_detail(request: Request):
    return templates.TemplateResponse(
        "customer.html",
        {
            "request": request,
            "mode": "new",
            "kakao_js_app_key": _get_kakao_js_app_key(),
        }
    )


@router.get("/customer/{customer_number:int}", response_class=HTMLResponse)
def detail_page(request: Request, customer_number: int):
    return templates.TemplateResponse(
        "customer.html",
        {
            "request": request,
            "customer_number": customer_number,
            "kakao_js_app_key": _get_kakao_js_app_key(),
        }
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
                   home_address, phone, first_contact, email, desired_price_manwon,
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
                SELECT
                    customer_number,
                    status,
                    buyer_name,
                    ceo_name,
                    phone,
                    email,
                    customer_state,
                    first_contact,
                    desired_price_manwon,
                    business_area,
                    building_preference,
                    main_interest_region
                FROM customer_info
                WHERE delete_flag = FALSE
                  AND (
                        CAST(customer_number AS TEXT) ILIKE %s
                     OR buyer_name ILIKE %s
                     OR ceo_name ILIKE %s
                     OR phone ILIKE %s
                     OR email ILIKE %s
                     OR first_contact ILIKE %s
                     OR business_area ILIKE %s
                     OR building_preference ILIKE %s
                     OR main_interest_region ILIKE %s
                   )
                ORDER BY update_time DESC, customer_number DESC
                LIMIT %s
                """,
                (
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    f"%{keyword}%",
                    limit,
                )
            )
        else:
            cur.execute(
                """
                SELECT
                    customer_number,
                    status,
                    buyer_name,
                    ceo_name,
                    phone,
                    email,
                    customer_state,
                    first_contact,
                    desired_price_manwon,
                    business_area,
                    building_preference,
                    main_interest_region
                FROM customer_info
                WHERE delete_flag = FALSE
                ORDER BY update_time DESC, customer_number DESC
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


@router.get("/api/customer/{customer_number:int}/images")
def get_customer_images(customer_number: int):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        return _get_customer_images_from_db(cur, customer_number)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/api/customer/{customer_number:int}/images")
async def upload_customer_images(
    customer_number: int,
    profile: Optional[List[UploadFile]] = File(None),
    card: Optional[List[UploadFile]] = File(None),
):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        uploads = {
            "profile": profile,
            "card": card,
        }
        for slot, upload_list in uploads.items():
            if not upload_list:
                continue
            for upload in upload_list:
                image_name = _save_customer_photo(customer_number, slot, upload)
                _insert_customer_image_record(cur, customer_number, slot, image_name)

        conn.commit()
        return {
            "status": "ok",
            "images": _get_customer_images_from_db(cur, customer_number)
        }
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.delete("/api/customer/{customer_number:int}/images/{slot}")
def delete_customer_image(
    customer_number: int,
    slot: str,
    image_name: Optional[str] = Query(None),
):
    normalized_slot = (slot or "").strip().lower()
    if normalized_slot not in CUSTOMER_IMAGE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")

    conn = None
    cur = None
    deleted_image_name = None

    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        normalized_image_name = (image_name or "").strip() or None
        deleted_image_name = _soft_delete_customer_image(
            cur,
            customer_number,
            normalized_slot,
            normalized_image_name,
        )
        conn.commit()

        images = _get_customer_images_from_db(cur, customer_number)
        return {
            "status": "ok",
            "deleted": deleted_image_name is not None,
            "images": images,
        }
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if deleted_image_name:
            _delete_customer_photo_file(customer_number, deleted_image_name)
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.put("/api/customer/{customer_number:int}/images/{slot}/order")
def reorder_customer_images(
    customer_number: int,
    slot: str,
    payload: CustomerImageOrderPayload,
):
    normalized_slot = (slot or "").strip().lower()
    if normalized_slot not in CUSTOMER_IMAGE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        _reorder_customer_images(cur, customer_number, normalized_slot, payload.image_names or [])
        conn.commit()
        return {
            "status": "ok",
            "images": _get_customer_images_from_db(cur, customer_number),
        }
    except Exception as e:
        if conn:
            conn.rollback()
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
    building_area_min: Optional[int] = Query(None),
    building_area_max: Optional[int] = Query(None),
    approval_year_min: Optional[int] = Query(None),
    road_width_min: Optional[float] = Query(None),
    elevator_option: str = Query(""),
    building_status: str = Query(""),
    location_decide: str = Query(""),
    price_decide: str = Query(""),
    yield_decide: str = Query(""),
    vacancy_decide: str = Query(""),
    limit_decide: str = Query(""),
    loan_decide: str = Query(""),
    parking_min: Optional[int] = Query(None),
    zoning_categories: str = Query(""),
    usage_categories: str = Query(""),
    types: str = Query(""),
    customer_number: Optional[int] = Query(None),
    exclude_intro: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        sql = """
            SELECT
                bi.bd_number, bi.bd_name, bi.address, bi.sale_price, bi.yield_rate,
                bm.status,
                bi.location_decide, bi.price_decide, bi.yield_decide, bi.vacancy_decide, bi.limit_decide, bi.loan_decide,
                bi.land_area_pyeong, bi.gross_area_pyeong, bi.zoning_type, bi.approval_date, bi.elevator, bi.parking_capacity,
                bi.is_new_site, bi.is_remodeling, bi.is_office_building, bi.is_investment, bi.is_development, bi.is_stable_holding
            FROM building_info bi
            LEFT JOIN building_memo bm
              ON bi.bd_number = bm.bd_number
            WHERE bi.delete_flag = FALSE
        """
        params: list = []
        address_terms = [term.strip() for term in (address or "").split(",") if term.strip()]
        business_area_terms = [term.strip() for term in (business_area or "").split(",") if term.strip()]
        station_terms = [term.strip() for term in (station_keyword or "").split(",") if term.strip()]

        if address_terms:
            address_ors = []
            for term in address_terms:
                address_ors.append("(COALESCE(address, '') ILIKE %s OR COALESCE(address_detail, '') ILIKE %s)")
                params.extend([f"%{term}%", f"%{term}%"])
            sql += " AND (" + " OR ".join(address_ors) + ")"
        if business_area_terms:
            business_ors = []
            for term in business_area_terms:
                business_ors.append("COALESCE(site_location, '') ILIKE %s")
                params.append(f"%{term}%")
            sql += " AND (" + " OR ".join(business_ors) + ")"
        if station_terms:
            station_ors = []
            for term in station_terms:
                station_ors.append(
                    """
                    (
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
                )
                kw = f"%{term}%"
                params.extend([kw, kw, kw, kw])
            sql += " AND (" + " OR ".join(station_ors) + ")"

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
        if building_area_min is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(building_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            params.append(building_area_min)
        if building_area_max is not None:
            sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(building_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            params.append(building_area_max)

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

        normalized_location_decide = (location_decide or "").strip().lower()
        if normalized_location_decide:
            sql += " AND LOWER(COALESCE(bi.location_decide, '')) = %s"
            params.append(normalized_location_decide)

        normalized_price_decide = (price_decide or "").strip().lower()
        if normalized_price_decide:
            sql += " AND LOWER(COALESCE(bi.price_decide, '')) = %s"
            params.append(normalized_price_decide)

        normalized_yield_decide = (yield_decide or "").strip().lower()
        if normalized_yield_decide:
            sql += " AND LOWER(COALESCE(bi.yield_decide, '')) = %s"
            params.append(normalized_yield_decide)

        normalized_vacancy_decide = (vacancy_decide or "").strip().lower()
        if normalized_vacancy_decide:
            sql += " AND LOWER(COALESCE(bi.vacancy_decide, '')) = %s"
            params.append(normalized_vacancy_decide)

        normalized_limit_decide = (limit_decide or "").strip().lower()
        if normalized_limit_decide:
            sql += " AND LOWER(COALESCE(bi.limit_decide, '')) = %s"
            params.append(normalized_limit_decide)

        normalized_loan_decide = (loan_decide or "").strip().lower()
        if normalized_loan_decide:
            sql += " AND LOWER(COALESCE(bi.loan_decide, '')) = %s"
            params.append(normalized_loan_decide)

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
        has_address = bool(address_terms)
        has_business_area = bool(business_area_terms)
        has_station_keyword = bool(station_terms)
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
        has_building_area = (building_area_min is not None) or (building_area_max is not None)
        has_approval_year = approval_year_min is not None
        has_road_width = road_width_min is not None
        has_elevator_option = normalized_elevator_option in ("있음", "없음")
        has_building_status = normalized_building_status and normalized_building_status != "전체"
        has_location_decide = bool(normalized_location_decide)
        has_price_decide = bool(normalized_price_decide)
        has_yield_decide = bool(normalized_yield_decide)
        has_vacancy_decide = bool(normalized_vacancy_decide)
        has_limit_decide = bool(normalized_limit_decide)
        has_loan_decide = bool(normalized_loan_decide)
        has_parking = parking_min is not None
        has_zoning_categories = len(selected_zoning_categories) > 0
        has_usage_categories = len(selected_usage_categories) > 0
        has_types = len(selected_types) > 0

        # 조건이 하나도 없으면 검색하지 않음
        if not (
            has_address
            or has_business_area
            or has_station_keyword
            or has_min_price
            or has_max_price
            or has_cash_hold
            or has_station_walk
            or has_min_yield
            or has_land_pp
            or has_gross_pp
            or has_land_area
            or has_gross_area
            or has_usable_area
            or has_building_area
            or has_approval_year
            or has_road_width
            or has_elevator_option
            or has_building_status
            or has_location_decide
            or has_price_decide
            or has_yield_decide
            or has_vacancy_decide
            or has_limit_decide
            or has_loan_decide
            or has_parking
            or has_zoning_categories
            or has_usage_categories
            or has_types
        ):
            return {"items": [], "total_count": 0, "page": 1, "page_size": page_size, "total_pages": 0}

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
            sql += " AND (" + " OR ".join([f"COALESCE({col}, FALSE) = TRUE" for col in type_columns]) + ")"

        if exclude_intro and customer_number is not None:
            sql += """
                AND NOT EXISTS (
                    SELECT 1
                    FROM customer_intro_property cip
                    WHERE cip.delete_flag = FALSE
                      AND cip.customer_number = %s
                      AND (
                          (cip.bd_number IS NOT NULL AND cip.bd_number = bi.bd_number)
                          OR (
                              COALESCE(NULLIF(TRIM(cip.address), ''), '__NO_ADDR__') =
                              COALESCE(NULLIF(TRIM(bi.address), ''), '__NO_ADDR__')
                          )
                      )
                )
            """
            params.append(customer_number)

        count_sql = f"SELECT COUNT(*) FROM ({sql}) AS matched_buildings"
        cur.execute(count_sql, tuple(params))
        total_count = cur.fetchone()[0] or 0

        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
        safe_page = min(page, total_pages) if total_pages > 0 else 1
        offset = (safe_page - 1) * page_size

        sql += " ORDER BY bi.update_time DESC, bi.bd_number DESC LIMIT %s OFFSET %s"
        page_params = list(params) + [page_size, offset]

        cur.execute(sql, tuple(page_params))
        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        items = []
        for row in rows:
            item = dict(zip(columns, row))
            score = 0
            if address.strip() and address.strip() in (item.get("address") or ""):
                score += 40
            score += 10 * sum(
                1 for c in type_columns if item.get(c) is True
            )
            item["match_score"] = min(score, 100)
            items.append(item)

        return {
            "items": items,
            "total_count": total_count,
            "page": safe_page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
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
    email: Optional[str]
    desired_price_manwon: Optional[str]
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


class CustomerDeleteRequest(BaseModel):
    customer_number: int


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


@router.post("/api/customer/delete")
def delete_customer(req: CustomerDeleteRequest):
    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        ensure_customer_intro_table(conn, cur)

        customer_number = req.customer_number

        cur.execute(
            """
            UPDATE customer_info
            SET delete_flag = TRUE, update_time = CURRENT_TIMESTAMP
            WHERE customer_number = %s
            """,
            (customer_number,)
        )

        cur.execute(
            """
            UPDATE customer_intro_property
            SET delete_flag = TRUE, update_time = CURRENT_TIMESTAMP
            WHERE customer_number = %s AND delete_flag = FALSE
            """,
            (customer_number,)
        )

        # customer_id 테이블이 있으면 함께 soft-delete
        cur.execute(
            """
            UPDATE customer_id
            SET delete_flag = TRUE
            WHERE customer_number = %s
            """,
            (customer_number,)
        )

        cur.execute(
            """
            UPDATE customer_image_info
            SET delete_flag = TRUE, update_time = CURRENT_TIMESTAMP
            WHERE customer_number = %s AND delete_flag = FALSE
            """,
            (customer_number,)
        )

        conn.commit()
        return {"status": "deleted", "customer_number": customer_number}
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
