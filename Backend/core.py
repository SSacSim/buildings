import sys
import os 
import json
import re
import hmac
import hashlib
import secrets
import time
import threading
import requests
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from urllib.parse import quote, unquote
from xml.etree import ElementTree as ET

sys.path.append('../DB')

import DB_utils

from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from typing import Any, Dict, List, Optional
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.responses import RedirectResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
try:
    from starlette.middleware.sessions import SessionMiddleware as StarletteSessionMiddleware
except ModuleNotFoundError:
    StarletteSessionMiddleware = None

from routers import customer
from backup.auto_backup import start_backup_scheduler, stop_backup_scheduler

app = FastAPI(title="Building Search API")

BASE_DIR = Path(__file__).resolve().parent
mount_BASE_UPLOAD_DIR = BASE_DIR / "save_file"
mount_BASE_PHOTO_DIR = BASE_DIR / "photo"
NOTICE_IMAGE_UPLOAD_DIR = mount_BASE_PHOTO_DIR / "notice"
NOTICE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
# 📁 폴더 없으면 자동 생성
mount_BASE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
mount_BASE_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
NOTICE_IMAGE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 정적 파일 등록
app.mount("/statics", StaticFiles(directory="statics"), name="statics")
app.mount("/save_file",StaticFiles(directory=str(mount_BASE_UPLOAD_DIR)),name="save_file")
app.mount("/photo",StaticFiles(directory=str(mount_BASE_PHOTO_DIR)),name="photo")

# ✅ router 등록
app.include_router(customer.router)


# 템플릿 설정
templates = Jinja2Templates(directory="./templates")


@app.on_event("startup")
async def startup_background_jobs():
    start_backup_scheduler(
        settings_loader=DB_utils._load_settings,
        base_dir=BASE_DIR,
    )


@app.on_event("shutdown")
async def shutdown_background_jobs():
    stop_backup_scheduler()

app_settings = DB_utils._load_settings().get("app", {})
JUSO_ADDRLINK_URL = app_settings.get("juso_addrlink_url") or ""
BLDRGST_TITLE_URL = app_settings.get("bldrgst_title_url") or ""
BLDRGST_FLR_OULN_URL = app_settings.get("bldrgst_flr_ouln_url") or ""
VWORLD_LADFRL_URL = app_settings.get("vworld_ladfrl_url") or ""
VWORLD_LADFRL_KEY = (
    os.getenv("VWORLD_LADFRL_KEY")
    or app_settings.get("vworld_ladfrl_key")
    or ""
)
VWORLD_LADFRL_DOMAIN = (
    os.getenv("VWORLD_LADFRL_DOMAIN")
    or app_settings.get("vworld_ladfrl_domain")
    or ""
)
VWORLD_INDVD_LAND_PRICE_URL = (
    app_settings.get("vworld_indvd_land_price_url")
    or ""
)
VWORLD_INDVD_LAND_PRICE_KEY = (
    os.getenv("VWORLD_INDVD_LAND_PRICE_KEY")
    or app_settings.get("vworld_indvd_land_price_key")
    or VWORLD_LADFRL_KEY
)
VWORLD_INDVD_LAND_PRICE_DOMAIN = (
    os.getenv("VWORLD_INDVD_LAND_PRICE_DOMAIN")
    or app_settings.get("vworld_indvd_land_price_domain")
    or VWORLD_LADFRL_DOMAIN
    or ""
)
JUSO_CONFM_KEY = (
    os.getenv("JUSO_CONFM_KEY")
    or app_settings.get("juso_confm_key")
    or ""
)
BLDRGST_SERVICE_KEY = (
    os.getenv("BLDRGST_SERVICE_KEY")
    or app_settings.get("bldrgst_service_key")
    or ""
)
SESSION_SECRET = (
    os.getenv("APP_SESSION_SECRET")
    or app_settings.get("session_secret")
    or "change-me-session-secret"
)
AUTH_SESSION_KEY = "auth_user"
AUTH_SESSION_LAST_ACTIVITY_KEY = "auth_last_activity_ts"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{4,32}$")
PASSWORD_MIN_LENGTH = 8


def _read_positive_int(value, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


AUTH_SESSION_IDLE_TIMEOUT_SECONDS = _read_positive_int(
    os.getenv("AUTH_SESSION_IDLE_TIMEOUT_SECONDS")
    or app_settings.get("auth_session_idle_timeout_seconds"),
    60 * 60 * 2,
)

PUBLIC_PATH_PREFIXES = (
    "/statics",
    "/photo",
    "/save_file",
    "/login",
    "/signup",
    "/logout",
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/logout",
    "/docs",
    "/redoc",
    "/openapi.json",
)
PUBLIC_PATH_EXACT = {
    "/favicon.ico",
}

SESSION_COOKIE_NAME = "app_session_id"
SESSION_STORE_TTL_SECONDS = 60 * 60 * 24 * 7
_fallback_session_store = {}
_fallback_session_lock = threading.Lock()


def _prune_fallback_sessions(now_ts: float):
    expired_keys = [
        key
        for key, value in _fallback_session_store.items()
        if value.get("expires_at", 0) <= now_ts
    ]
    for key in expired_keys:
        _fallback_session_store.pop(key, None)


class InMemorySessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        now_ts = time.time()
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        session_data = {}

        with _fallback_session_lock:
            _prune_fallback_sessions(now_ts)
            if session_id:
                existing = _fallback_session_store.get(session_id)
                if existing:
                    session_data = dict(existing.get("data") or {})
                else:
                    session_id = None

        request.scope["session"] = session_data
        response = await call_next(request)

        current_session = request.scope.get("session") or {}
        if current_session:
            if not session_id:
                session_id = secrets.token_urlsafe(32)
            with _fallback_session_lock:
                _fallback_session_store[session_id] = {
                    "data": dict(current_session),
                    "expires_at": now_ts + SESSION_STORE_TTL_SECONDS,
                }
            response.set_cookie(
                SESSION_COOKIE_NAME,
                session_id,
                httponly=True,
                samesite="lax",
                secure=False,
                path="/",
            )
        else:
            if session_id:
                with _fallback_session_lock:
                    _fallback_session_store.pop(session_id, None)
            response.delete_cookie(SESSION_COOKIE_NAME, path="/")

        return response


def _normalize_next_path(next_path: Optional[str]) -> str:
    candidate = unquote((next_path or "").strip())
    if not candidate.startswith("/"):
        return "/"
    if candidate.startswith("//"):
        return "/"
    return candidate


def _is_public_path(path: str) -> bool:
    if path in PUBLIC_PATH_EXACT:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES)


def _ensure_auth_user_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS app_user (
            user_number BIGSERIAL PRIMARY KEY,
            username VARCHAR(80) NOT NULL,
            password_salt VARCHAR(64) NOT NULL,
            password_hash VARCHAR(128) NOT NULL,
            display_name VARCHAR(80),
            create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delete_flag BOOLEAN DEFAULT FALSE
        );
        """
    )
    cur.execute(
        """
        ALTER TABLE app_user
        ADD COLUMN IF NOT EXISTS display_name VARCHAR(80);
        """
    )
    cur.execute(
        """
        ALTER TABLE app_user
        ADD COLUMN IF NOT EXISTS update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        """
    )
    cur.execute(
        """
        ALTER TABLE app_user
        ADD COLUMN IF NOT EXISTS delete_flag BOOLEAN DEFAULT FALSE;
        """
    )
    cur.execute(
        """
        ALTER TABLE app_user
        ADD COLUMN IF NOT EXISTS admin_flag BOOLEAN DEFAULT FALSE;
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_username_ci
        ON app_user (LOWER(username));
        """
    )


def _ensure_auth_config_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS app_auth_config (
            config_id SMALLINT PRIMARY KEY CHECK (config_id = 1),
            signup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    cur.execute(
        """
        INSERT INTO app_auth_config (config_id, signup_enabled)
        VALUES (1, TRUE)
        ON CONFLICT (config_id) DO NOTHING;
        """
    )


def _ensure_notice_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS app_notice (
            notice_id SMALLINT PRIMARY KEY CHECK (notice_id = 1),
            title VARCHAR(120) NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_by BIGINT
        );
        """
    )
    cur.execute(
        """
        INSERT INTO app_notice (notice_id, title, content, enabled)
        VALUES (1, '', '', FALSE)
        ON CONFLICT (notice_id) DO NOTHING;
        """
    )


def _get_notice_payload(cur) -> dict:
    _ensure_notice_table(cur)
    cur.execute(
        """
        SELECT notice_id, title, content, enabled, update_time, updated_by
        FROM app_notice
        WHERE notice_id = 1
        """
    )
    row = cur.fetchone()
    if not row:
        return {
            "notice_id": 1,
            "title": "",
            "content": "",
            "enabled": False,
            "update_time": None,
            "updated_by": None,
        }
    notice_id, title, content, enabled, update_time, updated_by = row
    return {
        "notice_id": notice_id,
        "title": title or "",
        "content": content or "",
        "enabled": bool(enabled),
        "update_time": update_time.isoformat() if update_time else None,
        "updated_by": updated_by,
    }


def _is_signup_enabled(cur) -> bool:
    _ensure_auth_config_table(cur)
    cur.execute(
        """
        SELECT signup_enabled
        FROM app_auth_config
        WHERE config_id = 1
        """
    )
    row = cur.fetchone()
    return bool(row[0]) if row else True


def _is_admin_session_user(user: Optional[dict]) -> bool:
    return bool(user and user.get("admin_flag"))


def _assert_admin_session_user(request: Request) -> dict:
    user = request.session.get(AUTH_SESSION_KEY)
    if not user:
        raise HTTPException(status_code=401, detail="authentication required")
    if not _is_admin_session_user(user):
        raise HTTPException(status_code=403, detail="admin permission required")
    return user


def _hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        200_000,
    )
    return digest.hex()


def _verify_password(password: str, salt: str, expected_hash: str) -> bool:
    computed = _hash_password(password, salt)
    return hmac.compare_digest(computed, expected_hash)


def _normalize_username(username: str) -> str:
    return (username or "").strip()


def _to_clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _resolve_notice_image_extension(file_name: str, content_type: str) -> str:
    suffix = Path(_to_clean_text(file_name)).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return suffix

    content_type = _to_clean_text(content_type).lower()
    content_type_to_ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }
    return content_type_to_ext.get(content_type, "")


def _compact_text(value: Any) -> str:
    return re.sub(r"\s+", "", _to_clean_text(value))


def _format_yyyymmdd(value: Any) -> str:
    digits = re.sub(r"[^0-9]", "", _to_clean_text(value))
    if len(digits) == 8:
        return f"{digits[:4]}.{digits[4:6]}.{digits[6:8]}"
    return _to_clean_text(value)


def _to_4digit_code(value: Any) -> str:
    digits = re.sub(r"[^0-9]", "", _to_clean_text(value))
    if not digits:
        return "0000"
    return digits.zfill(4)


def _build_pnu_from_juso_parts(adm_cd: str, lnbr_mnnm: Any, lnbr_slno: Any) -> str:
    adm_digits = re.sub(r"[^0-9]", "", _to_clean_text(adm_cd))[:10]
    if len(adm_digits) != 10:
        return ""
    return f"{adm_digits}1{_to_4digit_code(lnbr_mnnm)}{_to_4digit_code(lnbr_slno)}"


def _find_first_nested_key_value(payload: Any, key_name: str) -> str:
    if isinstance(payload, dict):
        direct = _to_clean_text(payload.get(key_name))
        if direct:
            return direct
        for value in payload.values():
            found = _find_first_nested_key_value(value, key_name)
            if found:
                return found
        return ""

    if isinstance(payload, list):
        for value in payload:
            found = _find_first_nested_key_value(value, key_name)
            if found:
                return found
        return ""

    return ""


def _normalize_land_category_text(value: Any) -> str:
    text = _to_clean_text(value)
    aliases = {
        "\ub300\uc9c0": "\ub300",
    }
    return aliases.get(text, text)


def _collect_price_item_candidates(payload: Any, output: List[Dict[str, Any]]) -> None:
    if isinstance(payload, dict):
        if ("stdrYear" in payload) or ("pblntfPclnd" in payload):
            output.append(payload)
        for value in payload.values():
            _collect_price_item_candidates(value, output)
        return

    if isinstance(payload, list):
        for value in payload:
            _collect_price_item_candidates(value, output)


def _extract_latest_indvd_land_price(payload: Any) -> Dict[str, str]:
    candidates: List[Dict[str, Any]] = []
    _collect_price_item_candidates(payload, candidates)
    if not candidates:
        return {}

    for candidate in reversed(candidates):
        stdr_year = _to_clean_text(candidate.get("stdrYear"))
        pblntf_price = _to_clean_text(candidate.get("pblntfPclnd"))
        if stdr_year or pblntf_price:
            return {
                "stdrYear": stdr_year,
                "pblntfPclnd": pblntf_price,
            }
    return {}


def _pick_first_non_empty(*values: Any) -> str:
    for value in values:
        cleaned = _to_clean_text(value)
        if cleaned:
            return cleaned
    return ""


def _truncate_decimal_text(value: Any, keep_decimal_places: int = 1) -> str:
    raw = _to_clean_text(value)
    if not raw:
        return ""

    cleaned = re.sub(r"[^0-9.\-]", "", raw)
    if cleaned in ("", "-", ".", "-."):
        return raw

    try:
        decimal_value = Decimal(cleaned)
    except InvalidOperation:
        return raw

    quant = Decimal("1").scaleb(-keep_decimal_places)
    truncated = decimal_value.quantize(quant, rounding=ROUND_DOWN)

    if "." in cleaned:
        return f"{truncated:.{keep_decimal_places}f}"
    return f"{truncated:.0f}"


def _normalize_building_usage_text(value: Any) -> str:
    text = _to_clean_text(value)
    if not text:
        return ""

    # e.g. "\uC81C1\uC885\uADFC\uB9B0\uC0DD\uD65C\uC2DC\uC124" -> "\uC81C1\uC885 \uADFC\uB9B0\uC0DD\uD65C\uC2DC\uC124"
    text = re.sub(
        r"(\uC81C\s*\d+\s*\uC885)\s*(?=[\uAC00-\uD7A3A-Za-z])",
        lambda m: re.sub(r"\s+", "", m.group(1)) + " ",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _select_best_juso_item(keyword: str, juso_items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not juso_items:
        return None

    compact_keyword = _compact_text(keyword)
    if compact_keyword:
        for item in juso_items:
            road_addr = _compact_text(item.get("roadAddrPart1") or item.get("roadAddr"))
            jibun_addr = _compact_text(item.get("jibunAddr"))
            if compact_keyword in road_addr or compact_keyword in jibun_addr:
                return item

    return juso_items[0]


def _parse_bldrgst_xml_response(xml_text: str) -> Optional[Dict[str, Any]]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    result_code = _to_clean_text(root.findtext(".//resultCode"))
    if result_code not in ("00", "0"):
        return None

    item_node = root.find(".//item")
    if item_node is None:
        return None

    return {child.tag: _to_clean_text(child.text) for child in list(item_node)}


def _extract_bldrgst_items_from_json_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []

    header = payload.get("response", {}).get("header", {})
    result_code = _to_clean_text(header.get("resultCode"))
    if result_code not in ("00", "0"):
        return []

    body = payload.get("response", {}).get("body", {})
    raw_items = body.get("items", {}).get("item", [])
    if isinstance(raw_items, dict):
        return [raw_items]
    if isinstance(raw_items, list):
        return [row for row in raw_items if isinstance(row, dict)]
    return []


def _parse_bldrgst_xml_items(xml_text: str) -> List[Dict[str, str]]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    result_code = _to_clean_text(root.findtext(".//resultCode"))
    if result_code not in ("00", "0"):
        return []

    item_nodes = root.findall(".//item")
    rows: List[Dict[str, str]] = []
    for node in item_nodes:
        row = {child.tag: _to_clean_text(child.text) for child in list(node)}
        if row:
            rows.append(row)
    return rows


def _build_floor_label(floor_kind_name: Any, floor_no: Any) -> str:
    floor_kind = _to_clean_text(floor_kind_name)
    floor_text = _to_clean_text(floor_no)
    floor_number = floor_text.lstrip("+-").strip()

    if floor_kind.startswith("지하"):
        return f"-{floor_number}" if floor_number else "-"
    return floor_number or floor_text


def _to_pyeong_text_from_sqm(value: Any) -> str:
    raw = _to_clean_text(value)
    if not raw:
        return ""

    cleaned = re.sub(r"[^0-9.\-]", "", raw)
    if cleaned in ("", "-", ".", "-."):
        return ""

    try:
        sqm = Decimal(cleaned)
    except InvalidOperation:
        return ""

    if sqm <= 0:
        return ""

    pyeong = sqm / Decimal("3.305785")
    rounded = pyeong.quantize(Decimal("0.1"))
    if rounded == rounded.to_integral():
        return f"{rounded:.0f}"
    return f"{rounded:.1f}"


def _build_lease_details_from_floor_items(floor_items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    lease_details: List[Dict[str, str]] = []
    for row in floor_items:
        floor = _build_floor_label(row.get("flrGbCdNm"), row.get("flrNo"))
        business_type = _to_clean_text(row.get("etcPurps"))
        area_sqm = _to_clean_text(row.get("area"))
        area_pyeong = _to_pyeong_text_from_sqm(area_sqm)

        if not (floor or business_type or area_sqm):
            continue

        lease_details.append(
            {
                "floor": floor,
                "business_type": business_type,
                "area_sqm": area_sqm,
                "area_pyeong": area_pyeong,
                "deposit": "",
                "monthly_rent_fee": "",
                "maintenance_fee": "",
                "remark": "",
                "is_vacant": "-",
            }
        )

    return lease_details


def _fetch_struct_info_call_data(address: str, address_detail: str = "") -> Dict[str, Any]:
    if not JUSO_ADDRLINK_URL or not BLDRGST_TITLE_URL or not JUSO_CONFM_KEY or not BLDRGST_SERVICE_KEY:
        return {}

    # 상세주소는 JUSO 검색 정확도를 떨어뜨릴 수 있어 검색 키워드에서 제외한다.
    keyword = _to_clean_text(address)
    if not keyword:
        return {}

    try:
        juso_response = requests.get(
            JUSO_ADDRLINK_URL,
            params={
                "currentPage": "1",
                "countPerPage": "10",
                "keyword": keyword,
                "confmKey": JUSO_CONFM_KEY,
                "hstryYn": "Y",
                "resultType": "json",
            },
            timeout=8,
        )
        juso_response.raise_for_status()
        juso_payload = juso_response.json()
    except Exception as exc:
        print(f"[struct_info_call] juso request failed: {exc}")
        return {}

    juso_results = juso_payload.get("results", {})
    juso_common = juso_results.get("common", {})
    if _to_clean_text(juso_common.get("errorCode")) != "0":
        return {}

    raw_juso_items = juso_results.get("juso") or []
    juso_items = raw_juso_items if isinstance(raw_juso_items, list) else []
    juso_item = _select_best_juso_item(keyword, juso_items)
    if not juso_item:
        return {}

    adm_cd = _to_clean_text(juso_item.get("admCd"))
    if len(adm_cd) < 10:
        return {}

    bun_code = _to_4digit_code(juso_item.get("lnbrMnnm"))
    ji_code = _to_4digit_code(juso_item.get("lnbrSlno"))
    pnu_code = _build_pnu_from_juso_parts(
        adm_cd,
        juso_item.get("lnbrMnnm"),
        juso_item.get("lnbrSlno"),
    )

    bld_common_params = {
        "serviceKey": BLDRGST_SERVICE_KEY,
        "sigunguCd": adm_cd[:5],
        "bjdongCd": adm_cd[5:10],
        "platGbCd": _to_clean_text(juso_item.get("mtYn")) or "0",
        "bun": bun_code,
        "ji": ji_code,
        "pageNo": "1",
        "_type": "json",
    }

    bld_response = None
    try:
        bld_response = requests.get(
            BLDRGST_TITLE_URL,
            params={
                **bld_common_params,
                "numOfRows": "10",
            },
            timeout=8,
        )
        bld_response.raise_for_status()
    except Exception as exc:
        print(f"[struct_info_call] bld request failed: {exc}")

    item_data: Dict[str, Any] = {}
    if bld_response is not None:
        try:
            bld_payload = bld_response.json()
            title_items = _extract_bldrgst_items_from_json_payload(bld_payload)
            if title_items:
                item_data = title_items[0]
        except ValueError:
            parsed_items = _parse_bldrgst_xml_items(bld_response.text)
            if parsed_items:
                item_data = parsed_items[0]

    lease_details: List[Dict[str, str]] = []
    if BLDRGST_FLR_OULN_URL:
        try:
            floor_response = requests.get(
                BLDRGST_FLR_OULN_URL,
                params={
                    **bld_common_params,
                    "numOfRows": "200",
                },
                timeout=8,
            )
            floor_response.raise_for_status()

            floor_items: List[Dict[str, Any]] = []
            try:
                floor_payload = floor_response.json()
                floor_items = _extract_bldrgst_items_from_json_payload(floor_payload)
            except ValueError:
                floor_items = _parse_bldrgst_xml_items(floor_response.text)

            lease_details = _build_lease_details_from_floor_items(floor_items)
        except Exception as exc:
            print(f"[struct_info_call] floor request failed: {exc}")

    bd_name = _pick_first_non_empty(
        item_data.get("bldNm"),
        juso_item.get("bdNm"),
        juso_item.get("detBdNmList"),
    )
    jibun_address = _to_clean_text(item_data.get("platPlc"))
    if not jibun_address:
        jibun_address = _to_clean_text(juso_item.get("jibunAddr"))
    if not jibun_address:
        jibun_address = _to_clean_text(juso_item.get("roadAddrPart1"))
    if not jibun_address:
        # roadAddr may include trailing reference text in parentheses.
        road_addr = _to_clean_text(juso_item.get("roadAddr"))
        jibun_address = re.sub(r"\s*\([^)]*\)\s*$", "", road_addr).strip()

    land_category = ""
    if VWORLD_LADFRL_URL and VWORLD_LADFRL_KEY and pnu_code:
        try:
            vworld_response = requests.get(
                VWORLD_LADFRL_URL,
                params={
                    "pnu": pnu_code,
                    "key": VWORLD_LADFRL_KEY,
                    "domain": VWORLD_LADFRL_DOMAIN,
                },
                timeout=8,
            )
            vworld_response.raise_for_status()
            vworld_payload = vworld_response.json()
            land_category = _normalize_land_category_text(
                _find_first_nested_key_value(vworld_payload, "lndcgrCodeNm")
            )
        except Exception as exc:
            print(f"[struct_info_call] vworld ladfrlList request failed: {exc}")

    official_price_per_sqm_won = ""
    official_price_per_pyeong_million_date = ""
    if VWORLD_INDVD_LAND_PRICE_URL and VWORLD_INDVD_LAND_PRICE_KEY and pnu_code:
        try:
            vworld_price_response = requests.get(
                VWORLD_INDVD_LAND_PRICE_URL,
                params={
                    "pnu": pnu_code,
                    "key": VWORLD_INDVD_LAND_PRICE_KEY,
                    "domain": VWORLD_INDVD_LAND_PRICE_DOMAIN,
                    "format": "json",
                },
                timeout=8,
            )
            vworld_price_response.raise_for_status()
            vworld_price_payload = vworld_price_response.json()
            latest_price = _extract_latest_indvd_land_price(vworld_price_payload)
            official_price_per_pyeong_million_date = _to_clean_text(latest_price.get("stdrYear"))
            official_price_per_sqm_won = _to_clean_text(latest_price.get("pblntfPclnd"))
        except Exception as exc:
            print(f"[struct_info_call] vworld getIndvdLandPriceAttr request failed: {exc}")

    autofill_data = {
        "address": jibun_address,
        "bd_name": bd_name,
        "building_name": bd_name,
        "land_category": land_category,
        "official_price_per_sqm_won": official_price_per_sqm_won,
        "official_price_per_pyeong_million_date": official_price_per_pyeong_million_date,
        "approval_date": _format_yyyymmdd(item_data.get("useAprDay")),
        "building_usage": _normalize_building_usage_text(item_data.get("mainPurpsCdNm")),
        "building_structure": _to_clean_text(item_data.get("strctCdNm")),
        "gross_area_sqm": _to_clean_text(item_data.get("totArea")),
        "building_area_sqm": _to_clean_text(item_data.get("archArea")),
        "aboveground_floors": _to_clean_text(item_data.get("grndFlrCnt")),
        "underground_floors": _to_clean_text(item_data.get("ugrndFlrCnt")),
        "elevator": _to_clean_text(item_data.get("rideUseElvtCnt")),
        "emergency_elevator": _to_clean_text(item_data.get("emgenUseElvtCnt")),
        "building_coverage_ratio": _truncate_decimal_text(item_data.get("bcRat"), keep_decimal_places=1),
        "floor_area_ratio": _truncate_decimal_text(item_data.get("vlRat"), keep_decimal_places=1),
        "parking_outdoor_mechanical": _to_clean_text(item_data.get("oudrMechUtcnt")),
        "parking_outdoor_self": _to_clean_text(item_data.get("oudrAutoUtcnt")),
        "parking_indoor_mechanical": _to_clean_text(item_data.get("indrMechUtcnt")),
        "parking_indoor_self": _to_clean_text(item_data.get("indrAutoUtcnt")),
        "land_area_sqm": _to_clean_text(item_data.get("platArea")),
    }

    parking_total = 0
    has_parking_value = False
    for key in (
        "parking_outdoor_mechanical",
        "parking_outdoor_self",
        "parking_indoor_mechanical",
        "parking_indoor_self",
    ):
        raw = _to_clean_text(autofill_data.get(key))
        if not raw:
            continue
        try:
            parking_total += int(float(raw))
            has_parking_value = True
        except (TypeError, ValueError):
            continue

    if has_parking_value:
        autofill_data["parking_capacity"] = str(parking_total)

    if lease_details:
        autofill_data["lease_details"] = lease_details

    return {
        key: value
        for key, value in autofill_data.items()
        if _to_clean_text(value) != ""
    }


@app.middleware("http")
async def require_authentication(request: Request, call_next):
    path = request.url.path or "/"
    is_public_path = _is_public_path(path)

    auth_user = request.session.get(AUTH_SESSION_KEY)
    if auth_user:
        now_ts = int(time.time())
        last_activity = request.session.get(AUTH_SESSION_LAST_ACTIVITY_KEY)
        if last_activity is None:
            request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = now_ts
        else:
            try:
                last_activity_ts = int(last_activity)
            except (TypeError, ValueError):
                request.session.clear()
                auth_user = None
            else:
                if now_ts - last_activity_ts > AUTH_SESSION_IDLE_TIMEOUT_SECONDS:
                    request.session.clear()
                    auth_user = None
                elif not is_public_path:
                    request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = now_ts

    if is_public_path:
        return await call_next(request)

    if auth_user:
        return await call_next(request)

    accepts = (request.headers.get("accept") or "").lower()
    content_type = (request.headers.get("content-type") or "").lower()
    wants_json = (
        path.startswith("/api/")
        or "application/json" in accepts
        or "application/json" in content_type
    )
    if wants_json:
        return JSONResponse(
            status_code=401,
            content={"detail": "authentication required"},
        )

    query_part = f"?{request.url.query}" if request.url.query else ""
    safe_next = _normalize_next_path(f"{path}{query_part}")
    return RedirectResponse(url=f"/login?next={quote(safe_next, safe='/:?=&')}", status_code=302)


if StarletteSessionMiddleware is not None:
    app.add_middleware(
        StarletteSessionMiddleware,
        secret_key=SESSION_SECRET,
        max_age=None,
        same_site="lax",
        https_only=False,
    )
else:
    app.add_middleware(InMemorySessionMiddleware)


class AuthSignupPayload(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None


class AuthLoginPayload(BaseModel):
    username: str
    password: str


class AuthProfileUpdatePayload(BaseModel):
    display_name: Optional[str] = None


class AuthSignupControlUpdatePayload(BaseModel):
    signup_enabled: bool


class AdminNoticeUpdatePayload(BaseModel):
    title: Optional[str] = ""
    content: str
    enabled: bool = True


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, next: str = "/"):
    if request.session.get(AUTH_SESSION_KEY):
        return RedirectResponse(url="/", status_code=302)
    return templates.TemplateResponse(
        "login.html",
        {"request": request, "next": _normalize_next_path(next)},
    )


@app.get("/signup", response_class=HTMLResponse)
def signup_page(request: Request, next: str = "/"):
    if request.session.get(AUTH_SESSION_KEY):
        return RedirectResponse(url="/", status_code=302)
    safe_next = _normalize_next_path(next)

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        signup_enabled = _is_signup_enabled(cur)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

    if not signup_enabled:
        return RedirectResponse(
            url=f"/login?signup_closed=1&next={quote(safe_next, safe='/:?=&')}",
            status_code=302,
        )

    return templates.TemplateResponse(
        "signup.html",
        {"request": request, "next": safe_next},
    )


@app.get("/account", response_class=HTMLResponse)
def account_page(request: Request):
    return templates.TemplateResponse(
        "account.html",
        {"request": request},
    )


@app.get("/logout")
def logout_page(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=302)


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = request.session.get(AUTH_SESSION_KEY)
    if not user:
        raise HTTPException(status_code=401, detail="authentication required")

    # Backfill missing admin_flag for old sessions created before admin support.
    if "admin_flag" not in user:
        conn = None
        cur = None
        try:
            conn = DB_utils.join_db()
            cur = conn.cursor()
            _ensure_auth_user_table(cur)
            cur.execute(
                """
                SELECT user_number, username, display_name, admin_flag
                FROM app_user
                WHERE user_number = %s
                  AND delete_flag = FALSE
                LIMIT 1
                """,
                (user.get("user_number"),),
            )
            row = cur.fetchone()
            if row:
                user_number, username, display_name, admin_flag = row
                resolved_admin_flag = bool(admin_flag) or (username or "").lower() == "admin"
                if resolved_admin_flag and not bool(admin_flag):
                    cur.execute(
                        """
                        UPDATE app_user
                        SET admin_flag = TRUE,
                            update_time = CURRENT_TIMESTAMP
                        WHERE user_number = %s
                        """,
                        (user_number,),
                    )
                    conn.commit()

                request.session[AUTH_SESSION_KEY] = {
                    "user_number": user_number,
                    "username": username,
                    "display_name": display_name,
                    "admin_flag": resolved_admin_flag,
                }
                request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
                user = request.session[AUTH_SESSION_KEY]
        except Exception:
            # Keep serving existing session payload on backfill failure.
            pass
        finally:
            if cur:
                cur.close()
            if conn:
                conn.close()

    return {"user": user}


@app.get("/api/auth/signup-control")
def auth_get_signup_control(request: Request):
    _assert_admin_session_user(request)

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        signup_enabled = _is_signup_enabled(cur)
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
        return {"signup_enabled": signup_enabled}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.patch("/api/auth/signup-control")
def auth_update_signup_control(payload: AuthSignupControlUpdatePayload, request: Request):
    _assert_admin_session_user(request)

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        _ensure_auth_config_table(cur)

        cur.execute(
            """
            UPDATE app_auth_config
            SET signup_enabled = %s,
                update_time = CURRENT_TIMESTAMP
            WHERE config_id = 1
            """,
            (payload.signup_enabled,),
        )
        conn.commit()
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
        return {
            "status": "ok",
            "signup_enabled": payload.signup_enabled,
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.get("/api/admin/notice")
def admin_get_notice(request: Request):
    _assert_admin_session_user(request)

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        notice = _get_notice_payload(cur)
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
        return {"notice": notice}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.post("/api/admin/notice/image")
async def admin_upload_notice_image(request: Request, file: UploadFile = File(...)):
    _assert_admin_session_user(request)

    if file is None:
        raise HTTPException(status_code=400, detail="image file is required")

    content_type = _to_clean_text(file.content_type).lower()
    if content_type and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="only image files are allowed")

    extension = _resolve_notice_image_extension(file.filename or "", content_type)
    if not extension:
        raise HTTPException(status_code=400, detail="unsupported image format")

    try:
        raw_bytes = await file.read()
    finally:
        await file.close()

    if not raw_bytes:
        raise HTTPException(status_code=400, detail="empty image file")
    if len(raw_bytes) > NOTICE_IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"image size must be {NOTICE_IMAGE_MAX_BYTES // (1024 * 1024)}MB or less",
        )

    saved_name = f"notice_{int(time.time())}_{secrets.token_hex(8)}{extension}"
    saved_path = NOTICE_IMAGE_UPLOAD_DIR / saved_name
    try:
        with open(saved_path, "wb") as writer:
            writer.write(raw_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"failed to save image: {exc}")

    request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
    return {
        "status": "ok",
        "url": f"/photo/notice/{saved_name}",
    }


@app.patch("/api/admin/notice")
def admin_update_notice(payload: AdminNoticeUpdatePayload, request: Request):
    user = _assert_admin_session_user(request)

    title = (payload.title or "").strip()
    content = (payload.content or "").strip()
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="title must be 120 characters or fewer")
    if len(content) > 10000:
        raise HTTPException(status_code=400, detail="content must be 10000 characters or fewer")

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        _ensure_notice_table(cur)

        cur.execute(
            """
            UPDATE app_notice
            SET title = %s,
                content = %s,
                enabled = %s,
                updated_by = %s,
                update_time = CURRENT_TIMESTAMP
            WHERE notice_id = 1
            """,
            (
                title,
                content,
                payload.enabled,
                user.get("user_number"),
            ),
        )
        conn.commit()

        notice = _get_notice_payload(cur)
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
        return {"status": "ok", "notice": notice}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.get("/api/notice/current")
def get_current_notice(request: Request):
    user = request.session.get(AUTH_SESSION_KEY)
    if not user:
        raise HTTPException(status_code=401, detail="authentication required")

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        notice = _get_notice_payload(cur)
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
        return {"notice": notice}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.patch("/api/auth/me")
def auth_update_me(payload: AuthProfileUpdatePayload, request: Request):
    user = request.session.get(AUTH_SESSION_KEY)
    if not user:
        raise HTTPException(status_code=401, detail="authentication required")

    display_name_raw = (payload.display_name or "").strip()
    display_name = display_name_raw or None
    if display_name_raw and len(display_name_raw) > 80:
        raise HTTPException(
            status_code=400,
            detail="display_name must be 80 characters or fewer",
        )

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)

        cur.execute(
            """
            UPDATE app_user
            SET display_name = %s,
                update_time = CURRENT_TIMESTAMP
            WHERE user_number = %s
              AND delete_flag = FALSE
            RETURNING user_number, username, display_name, admin_flag
            """,
            (display_name, user.get("user_number")),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="user not found")

        user_number, username, updated_display_name, admin_flag = row
        request.session[AUTH_SESSION_KEY] = {
            "user_number": user_number,
            "username": username,
            "display_name": updated_display_name,
            "admin_flag": bool(admin_flag),
        }
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())

        conn.commit()
        return {
            "status": "ok",
            "user": request.session[AUTH_SESSION_KEY],
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.post("/api/auth/signup")
def auth_signup(payload: AuthSignupPayload):
    username = _normalize_username(payload.username)
    password = payload.password or ""
    display_name = (payload.display_name or "").strip() or None

    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(
            status_code=400,
            detail="username must be 4-32 chars using letters, numbers, ., _, -",
        )
    if len(password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"password must be at least {PASSWORD_MIN_LENGTH} characters",
        )

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)
        signup_enabled = _is_signup_enabled(cur)

        cur.execute(
            """
            SELECT user_number, delete_flag
            FROM app_user
            WHERE LOWER(username) = LOWER(%s)
            ORDER BY user_number DESC
            LIMIT 1
            """,
            (username,),
        )
        existing = cur.fetchone()
        if existing and not existing[1]:
            raise HTTPException(status_code=409, detail="username already exists")

        cur.execute(
            """
            SELECT COUNT(*)
            FROM app_user
            WHERE delete_flag = FALSE
            """
        )
        active_user_count = int(cur.fetchone()[0] or 0)
        if not signup_enabled and active_user_count > 0:
            raise HTTPException(status_code=403, detail="signup is currently disabled")

        grant_admin = active_user_count == 0
        salt = secrets.token_hex(16)
        password_hash = _hash_password(password, salt)

        if existing:
            user_number = existing[0]
            cur.execute(
                """
                UPDATE app_user
                SET username = %s,
                    password_salt = %s,
                    password_hash = %s,
                    display_name = %s,
                    admin_flag = CASE
                        WHEN %s THEN TRUE
                        ELSE COALESCE(admin_flag, FALSE)
                    END,
                    delete_flag = FALSE,
                    update_time = CURRENT_TIMESTAMP
                WHERE user_number = %s
                """,
                (username, salt, password_hash, display_name, grant_admin, user_number),
            )
        else:
            cur.execute(
                """
                INSERT INTO app_user (
                    username,
                    password_salt,
                    password_hash,
                    display_name,
                    admin_flag,
                    delete_flag
                )
                VALUES (%s, %s, %s, %s, %s, FALSE)
                """,
                (username, salt, password_hash, display_name, grant_admin),
            )

        conn.commit()
        return {"status": "created", "username": username}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.post("/api/auth/login")
def auth_login(payload: AuthLoginPayload, request: Request):
    username = _normalize_username(payload.username)
    password = payload.password or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required")

    conn = None
    cur = None
    try:
        conn = DB_utils.join_db()
        cur = conn.cursor()
        _ensure_auth_user_table(cur)

        cur.execute(
            """
            SELECT user_number, username, password_salt, password_hash, display_name, admin_flag
            FROM app_user
            WHERE LOWER(username) = LOWER(%s)
              AND delete_flag = FALSE
            ORDER BY user_number DESC
            LIMIT 1
            """,
            (username,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="invalid username or password")

        user_number, resolved_username, password_salt, password_hash, display_name, admin_flag = row
        if not _verify_password(password, password_salt, password_hash):
            raise HTTPException(status_code=401, detail="invalid username or password")

        resolved_admin_flag = bool(admin_flag)
        if not resolved_admin_flag and (resolved_username or "").lower() == "admin":
            cur.execute(
                """
                UPDATE app_user
                SET admin_flag = TRUE,
                    update_time = CURRENT_TIMESTAMP
                WHERE user_number = %s
                """,
                (user_number,),
            )
            conn.commit()
            resolved_admin_flag = True

        request.session[AUTH_SESSION_KEY] = {
            "user_number": user_number,
            "username": resolved_username,
            "display_name": display_name,
            "admin_flag": resolved_admin_flag,
        }
        request.session[AUTH_SESSION_LAST_ACTIVITY_KEY] = int(time.time())
        return {
            "status": "ok",
            "user": request.session[AUTH_SESSION_KEY],
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


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return {"status": "ok"}

# 👉 화면 렌더링
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "main.html",
        {
            "request": request,
            "kakao_js_app_key": customer._get_kakao_js_app_key(),
        }
    )


@app.get("/insight", response_class=HTMLResponse)
def insight_page(request: Request):
    return templates.TemplateResponse(
        "insight.html",
        {
            "request": request,
            "kakao_js_app_key": customer._get_kakao_js_app_key(),
        }
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
    building_area_min: Optional[int] = Query(None),
    building_area_max: Optional[int] = Query(None),
    approval_year_min: Optional[int] = Query(None),
    road_width_min: Optional[float] = Query(None),
    elevator_option: str = Query(""),
    building_status: str = Query(""),
    violation_flag: str = Query(""),
    customer_status: str = Query(""),
    location_decide: str = Query(""),
    price_decide: str = Query(""),
    yield_decide: str = Query(""),
    vacancy_decide: str = Query(""),
    limit_decide: str = Query(""),
    loan_decide: str = Query(""),
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
                status,
                customer_state,
                buyer_name,
                ceo_name,
                phone,
                email,
                first_contact,
                desired_price_manwon,
                company_address,
                business_area,
                building_preference,
                main_interest_region,
                customer_note,
                match_conditions_json
            FROM customer_info
            WHERE delete_flag = FALSE
        """
        customer_params: list = []
        address_terms = [term.strip() for term in (address or "").split(",") if term.strip()]
        site_location_terms = [term.strip() for term in (site_location or "").split(",") if term.strip()]
        station_terms = [term.strip() for term in (station_keyword or "").split(",") if term.strip()]

        customer_sql += " ORDER BY update_time DESC, customer_number DESC"

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
        selected_types_customer = [type_code_to_kor[c] for c in selected_types_codes if c in type_code_to_kor]

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

        range_keys = [
            # Insight customer matching uses only type and sale price range.
            ("min_price", "max_price", min_price, max_price),
        ]

        customers = []
        for row in customers_raw:
            cond = parse_json(row.get("match_conditions_json"))

            cond_types = cond.get("types") if isinstance(cond.get("types"), list) else []

            if selected_types_customer and not (set(selected_types_customer) & set(cond_types)):
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

            row.pop("match_conditions_json", None)
            customers.append(row)

        status_priority = {
            "집중": 0,
            "검토": 1,
            "보류": 2,
            "완료": 3,
        }
        # Keep existing order within each status group (stable sort).
        customers.sort(key=lambda row: status_priority.get(str(row.get("status") or "").strip(), 99))

        building_sql = """
            SELECT
                bi.bd_number,
                bi.bd_name,
                bi.address,
                bi.sale_price,
                bi.yield_rate,
                bm.status,
                bi.location_decide,
                bi.price_decide,
                bi.yield_decide,
                bi.vacancy_decide,
                bi.limit_decide,
                bi.loan_decide,
                bi.land_area_pyeong,
                bi.gross_area_pyeong,
                bi.zoning_type,
                bi.approval_date,
                bi.elevator,
                bi.parking_capacity
            FROM building_info bi
            LEFT JOIN building_memo bm
              ON bi.bd_number = bm.bd_number
            WHERE bi.delete_flag = FALSE
        """
        building_params: list = []

        if address_terms:
            address_ors = []
            for term in address_terms:
                address_ors.append("(COALESCE(address, '') ILIKE %s OR COALESCE(address_detail, '') ILIKE %s)")
                building_params.extend([f"%{term}%", f"%{term}%"])
            building_sql += " AND (" + " OR ".join(address_ors) + ")"

        if site_location_terms:
            site_ors = []
            for term in site_location_terms:
                site_ors.append("COALESCE(site_location, '') ILIKE %s")
                building_params.append(f"%{term}%")
            building_sql += " AND (" + " OR ".join(site_ors) + ")"

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
                building_params.extend([kw, kw, kw, kw])
            building_sql += " AND (" + " OR ".join(station_ors) + ")"

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
                                        regexp_replace(
                                            SUBSTRING(COALESCE(yield_rate::text, '') FROM '([+-]?[[:space:]]*[0-9]+([.,][0-9]+)?)'),
                                            '[[:space:]]+',
                                            '',
                                            'g'
                                        ),
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
        if building_area_min is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(building_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) >= %s"
            building_params.append(building_area_min)
        if building_area_max is not None:
            building_sql += " AND COALESCE(NULLIF(regexp_replace(COALESCE(building_area_pyeong, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) <= %s"
            building_params.append(building_area_max)

        if approval_year_min is not None:
            building_sql += " AND COALESCE(NULLIF(SUBSTRING(COALESCE(approval_date, '') FROM '([0-9]{4})'), '')::int, 0) >= %s"
            building_params.append(approval_year_min)

        if road_width_min is not None:
            building_sql += """
                AND (
                    COALESCE((
                        SELECT MIN((width_match[1])::numeric)
                        FROM regexp_matches(
                            CONCAT(COALESCE(road_access2, ''), ' ', COALESCE(road_access, '')),
                            '([0-9]+(?:\\.[0-9]+)?)\\s*[mM]',
                            'g'
                        ) AS width_match
                    ), 0) >= %s
                    OR EXISTS (
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
                )
            """
            building_params.extend([road_width_min, road_width_min])

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

        normalized_violation_flag = (violation_flag or "").strip().upper()
        if normalized_violation_flag == "O":
            building_sql += " AND COALESCE(bi.is_violation_checked, FALSE) = TRUE"
        elif normalized_violation_flag == "X":
            building_sql += " AND COALESCE(bi.is_violation_checked, FALSE) = FALSE"

        normalized_location_decide = (location_decide or "").strip().lower()
        if normalized_location_decide:
            building_sql += " AND LOWER(COALESCE(bi.location_decide, '')) = %s"
            building_params.append(normalized_location_decide)

        normalized_price_decide = (price_decide or "").strip().lower()
        if normalized_price_decide:
            building_sql += " AND LOWER(COALESCE(bi.price_decide, '')) = %s"
            building_params.append(normalized_price_decide)

        normalized_yield_decide = (yield_decide or "").strip().lower()
        if normalized_yield_decide:
            building_sql += " AND LOWER(COALESCE(bi.yield_decide, '')) = %s"
            building_params.append(normalized_yield_decide)

        normalized_vacancy_decide = (vacancy_decide or "").strip().lower()
        if normalized_vacancy_decide:
            building_sql += " AND LOWER(COALESCE(bi.vacancy_decide, '')) = %s"
            building_params.append(normalized_vacancy_decide)

        normalized_limit_decide = (limit_decide or "").strip().lower()
        if normalized_limit_decide:
            building_sql += " AND LOWER(COALESCE(bi.limit_decide, '')) = %s"
            building_params.append(normalized_limit_decide)

        normalized_loan_decide = (loan_decide or "").strip().lower()
        if normalized_loan_decide:
            building_sql += " AND LOWER(COALESCE(bi.loan_decide, '')) = %s"
            building_params.append(normalized_loan_decide)
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
            building_sql += " AND (" + " OR ".join([f"COALESCE({col}, FALSE) = TRUE" for col in type_columns]) + ")"

        building_sql += """
            ORDER BY
                CASE COALESCE(bm.status, '')
                    WHEN '완료' THEN 0
                    WHEN '준비' THEN 1
                    WHEN '보류' THEN 2
                    WHEN '매각' THEN 3
                    ELSE 99
                END,
                bi.update_time DESC,
                bi.bd_number DESC
        """

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


class HistoryUpdate(BaseModel):
    history_data: List[historyDetail]


class StructInfoCallRequest(BaseModel):
    address: str
    address_detail: Optional[str] = ""


@app.post("/api/building/struct-info-call")
def struct_info_call(req: StructInfoCallRequest):
    data = _fetch_struct_info_call_data(req.address, req.address_detail or "")
    return {"status": "ok", "data": data}


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
    is_violation_checked :bool = False

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
        'is_stable_holding' :data.is_stable_holding,
        'is_violation_checked' :data.is_violation_checked
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
        'is_stable_holding' :data.is_stable_holding,
        'is_violation_checked' :data.is_violation_checked
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


@app.put("/api/building/{bd_id:int}/history")
async def update_building_history(bd_id: int, data: HistoryUpdate):
    conn = DB_utils.join_db()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM working_history WHERE bd_number = %s", (bd_id,))

        for item in data.history_data:
            detail_dict = item.dict()
            detail_dict = {k: (v if v != "" else "0") for k, v in detail_dict.items()}

            columns = list(detail_dict.keys())
            params = list(detail_dict.values())
            columns.insert(0, "bd_number")
            params.insert(0, bd_id)

            col_names = ", ".join(columns)
            placeholders = ", ".join(["%s"] * len(columns))
            insert_sql = f"INSERT INTO working_history ({col_names}) VALUES ({placeholders})"
            cur.execute(insert_sql, params)

        conn.commit()
        return {"status": "updated", "bd_number": bd_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"history update error: {str(e)}")
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
        index = int(index)
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
import make_ppt_template2


class ComparePptRequest(BaseModel):
    bd_numbers: List[int]
    pin_first: bool = False

@app.post("/api/building/{bd_id}/ppt")
async def generate_ppt(bd_id: int):
    ppt_path, filename  = make_ppt.run(bd_id)  # ← ppt 파일 경로 반환

    return FileResponse(
        ppt_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=filename
    )


@app.post("/api/building/compare-ppt")
async def generate_compare_ppt(data: ComparePptRequest):
    bd_numbers = [int(x) for x in (data.bd_numbers or []) if x is not None]
    if not bd_numbers:
        raise HTTPException(status_code=400, detail="bd_numbers is empty")

    ppt_path, filename = make_ppt_template2.run(bd_numbers, pin_first=data.pin_first)
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
