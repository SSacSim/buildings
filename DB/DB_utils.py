import psycopg2
import re
import yaml
from pathlib import Path
from collections import defaultdict

SETTINGS_PATH = Path(__file__).resolve().parent.parent / "settings.yaml"


def _load_settings():
    if not SETTINGS_PATH.exists():
        return {}
    with SETTINGS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}

def join_db(ip = "0.0.0.0") :
    '''
        DB 접근 권한 return 

        return : DB 연결 객체 
    '''

    if ip not in ["0.0.0.0"]:
        raise "승인받지 않은 사용자 입니다."

    # 1️⃣ DB 접속 정보 설정
    settings = _load_settings()
    db = settings.get("db", {})
    DB_HOST = db.get("host", "localhost")
    DB_PORT = db.get("port", 5433)
    DB_NAME = db.get("name", "land")
    DB_USER = db.get("user", "postgres")
    DB_PASSWORD = db.get("password", "gkdustn1!")


    # 2️⃣ PostgreSQL 연결
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    
    return conn


# phone 형식만 추출 
def extract_all_phones(text: str):
    pattern = r'01[016789]-\d{3,4}-\d{4}'
    return re.findall(pattern, text)


## 모든 value를 다 뽑는건 너무 비효율 적, 페이지 마다 몇개를 보여줄 지 정한 후 
## 필요 갯수만큼만 보여주면 될 것 같음 
def extract_simple_info(conn, address :str ,page : int , category : str) -> dict:
    '''
        주소 검색 함수 
        input 
            address : 검색하고자 하는 주소
            page: 표현하고자 하는 페이지 

        return list[dict, ]
    '''
    limit = 15
    # 3️⃣ 커서 생성
    offset = (page - 1) * limit

    cur = conn.cursor()

    # 4️⃣ 검색할 address 값
    search_address = address
    #FLAG 필터링
    decide_columns = [
        "bi.location_decide",
        "bi.price_decide",
        "bi.yield_decide",
        "bi.vacancy_decide",
        "bi.limit_decide",
        "bi.loan_decide",
    ]

    decide_conditions = []
    decide_params = []

    if search_address:  # 예: "***acb", "a*cb*c"
        for i, ch in enumerate(search_address):
            if i >= len(decide_columns):
                break

            if ch != "*":
                decide_conditions.append(f"{decide_columns[i]} = %s")
                decide_params.append(ch)
    
    decide_sql = ""
    if decide_conditions:
        decide_sql = " OR (" + " AND ".join(decide_conditions) + ")"

    # phone 관련 필터링 
    # phone_search = extract_all_phones(address)
    # phone 필터 없이 진행 
    phone_search = [address]

    phone_conditions = []
    phone_params = []

    phone_columns = [
        "bi.client_name",
        "bi.mobile_phone",
        "bi.email",
        "bi.office_phone",
        "bi.home_phone",
        "bi.orientation",
        "bm.memo",
        "bm.etc_memo"
    ]

    for p in phone_search:
        sub_conditions = []
        for col in phone_columns:
            sub_conditions.append(f"{col} LIKE %s")
            phone_params.append(f"%{p}%")

        # (col1 LIKE %s OR col2 LIKE %s OR ...)
        phone_conditions.append("(" + " OR ".join(sub_conditions) + ")")

    phone_sql = ""
    if phone_conditions:
        phone_sql = " OR (" + " OR ".join(phone_conditions) + ")"
    
    # 3️⃣ SQL 작성
    ## postgresql은 sql문 순서에 상관없이 최적화하여 진행하므로 join 후 서칭해도 성능 하락 x 

    sql = f"""
            SELECT
                bi.bd_number, bi.bd_name, bi.address, bi.address_detail, bi.nearby_station,
                bi.deposit_price, bi.sale_price, bm.status,
                bi.location_decide, bi.price_decide, bi.yield_decide,
                bi.vacancy_decide, bi.limit_decide, bi.loan_decide,
                bi.yield_rate, bi.land_area_pyeong, bi.land_area_sqm,
                bi.zoning_type, bi.approval_date, bi.elevator,
                bi.parking_capacity, bi.building_usage, bi.building_structure , bm.memo, bm.etc_memo,
                bi.update_time
            FROM building_info bi
            LEFT JOIN building_memo bm
                ON bi.bd_number = bm.bd_number
            WHERE (
                    bi.address LIKE %s
                    OR bi.bd_name LIKE %s
                    OR bi.address_detail LIKE %s
                    OR bi.nearby_station LIKE %s
                    {phone_sql}
                    {decide_sql}
                )
                AND (%s = '' OR bm.status = %s) AND bi.delete_flag = FALSE
            ORDER BY
                CASE COALESCE(bm.status, '')
                    WHEN '완료' THEN 0
                    WHEN '준비' THEN 1
                    WHEN '보류' THEN 2
                    WHEN '매각' THEN 3
                    ELSE 99
                END,
                bi.update_time DESC,
                bi.bd_number ASC
            LIMIT %s OFFSET %s
            """

    params = [
        f"%{address}%", f"%{address}%", f"%{address}%", f"%{address}%"
    ] + phone_params + decide_params + [category, category, limit, offset]

    cur.execute(sql, params)

    # 5️⃣ 컬럼명 추출
    colnames = [desc[0] for desc in cur.description]

    # 6️⃣ 결과 fetch
    rows = cur.fetchall()

    results = []
    # 7️⃣ 출력 (dict 형태)
    for row in rows:
        record = dict(zip(colnames, row))
        results.append(record)
        # print(record)

    sql = f"""
        SELECT COUNT(*)
        FROM building_info bi
        LEFT JOIN building_memo bm
            ON bi.bd_number = bm.bd_number
        WHERE (
                bi.address LIKE %s
                OR bi.bd_name LIKE %s
                OR bi.address_detail LIKE %s
                OR bi.nearby_station LIKE %s
                {phone_sql}
                {decide_sql}
            )
        AND (%s = '' OR bm.status = %s) AND bi.delete_flag = FALSE
        """
    params = [
        f"%{address}%", f"%{address}%", f"%{address}%", f"%{address}%",
    ] + phone_params +decide_params + [category, category]

    cur.execute(sql, params)
    total_count = cur.fetchone()[0]
    results.insert(0, {"total_count": total_count})


    # 8️⃣ 종료
    cur.close()
    conn.close()

    return results



def extract_detail_info(conn, bd_number :str ) -> dict:
    '''
        주소 검색 함수 
        input 
            address : 검색하고자 하는 주소
            page: 표현하고자 하는 페이지 

        return list[dict, ]
    '''
   
    cur = conn.cursor()
    print("시작")
    # 3️⃣ SQL 작성
    ## postgresql은 sql문 순서에 상관없이 최적화하여 진행하므로 join 후 서칭해도 성능 하락 x 
    cur.execute("""
        SELECT
            bi.*,
            bm.memo, 
            bm.etc_memo, 
            bm.bd_feature, 
            bm.etc_feature, 
            bm.status
        FROM building_info bi
        LEFT JOIN building_memo bm
            ON bi.bd_number = bm.bd_number
        WHERE bi.bd_number = %s AND bi.delete_flag = FALSE
    """, (bd_number,))

    # 5️⃣ 컬럼명 추출
    colnames = [desc[0] for desc in cur.description]

    # 6️⃣ 결과 fetch
    rows = cur.fetchall()

    results = []
    # 7️⃣ 출력 (dict 형태)
    for row in rows:
        record = dict(zip(colnames, row))
        results.append(record)
        # print(record)

    # 8️⃣ 종료
    cur.close()
    # conn.close()
    # print("result")
    # print(results)
    return results[0]

## 임대현황 정보 서칭 
def extract_detail_management(conn, bd_number: str) -> dict:
    '''
    detail_management 테이블에서 특정 건물의 상세 리스트를 추출
    '''
    cur = None
    try:
        results = []
        cur = conn.cursor()
        
        # SQL 실행
        cur.execute("""
            SELECT 
                floor, business_type, deposit, maintenance_fee, area_pyeong, area_sqm, 
                monthly_rent_fee, remark, is_vacant
            FROM detail_management
            WHERE bd_number = %s AND delete_flag = FALSE
            ORDER BY
                CASE
                    WHEN floor IS NULL OR btrim(floor) = '' THEN 2
                    WHEN btrim(upper(floor)) ~ '^B[0-9]+$' THEN 0
                    WHEN btrim(floor) ~ '^-?[0-9]+$' THEN 0
                    WHEN regexp_replace(btrim(floor), '\s+', '', 'g') ~ '^-?[0-9]+' THEN 0
                    WHEN btrim(floor) ~ '^[0-9]+층$' THEN 0
                    ELSE 1
                END,
                CASE
                    WHEN btrim(upper(floor)) ~ '^B[0-9]+$'
                        THEN -CAST(substring(btrim(upper(floor)) from 2) AS INTEGER)
                    WHEN btrim(floor) ~ '^-?[0-9]+$'
                        THEN CAST(btrim(floor) AS INTEGER)
                    WHEN regexp_replace(btrim(floor), '\s+', '', 'g') ~ '^-?[0-9]+'
                        THEN CAST(substring(regexp_replace(btrim(floor), '\s+', '', 'g') from '^-?[0-9]+') AS INTEGER)
                    WHEN btrim(floor) ~ '^[0-9]+층$'
                        THEN CAST(regexp_replace(btrim(floor), '[^0-9-]', '', 'g') AS INTEGER)
                    ELSE NULL
                END ASC NULLS LAST,
                dm_number ASC
        """, (bd_number,))
    
        # 1. 컬럼명을 정확히 가져옵니다.
        colnames = [desc[0] for desc in cur.description]
        
        # 2. 결과 데이터를 가져옵니다.
        rows = cur.fetchall()

        # 3. 데이터가 있으면 dict로 변환, 없으면 빈 리스트 반환
        results = []
        for row in rows:
            # zip을 사용하여 컬럼명과 값을 매핑 (딕셔너리 생성)
            record = dict(zip(colnames, row))
            results.append(record)

        # 디버깅용 출력 (터미널에서 확인 가능)
        print(f"--- DB 상세 조회 완료: {len(results)}건 (bd_number: {bd_number}) ---")
        
        return results

    except Exception as e:
        # 에러 발생 시 정확한 메시지를 콘솔에 출력
        print(f"❌ [DB 에러] extract_detail_management 함수 내 발생: {e}")
        return ['error'] # 에러 시 빈 리스트를 반환해야 프론트 JS가 안 깨집니다.
    finally:
        if cur:
            cur.close()
            # conn.close()

## 작업내역 DB 정보 서칭 
def extract_working_history(conn, bd_number: str) -> dict:
    '''
    working_history 테이블에서 특정 건물의 상세 리스트를 추출
    '''
    cur = None
    try:
        results = []
        cur = conn.cursor()
        
        # SQL 실행
        cur.execute("""
            SELECT 
                writer, write_time,memo
            FROM working_history
            WHERE bd_number = %s AND delete_flag = FALSE
            ORDER BY wh_number ASC
        """, (bd_number,))
    
        # 1. 컬럼명을 정확히 가져옵니다.
        colnames = [desc[0] for desc in cur.description]
        
        # 2. 결과 데이터를 가져옵니다.
        rows = cur.fetchall()

        # 3. 데이터가 있으면 dict로 변환, 없으면 빈 리스트 반환
        results = []
        for row in rows:
            # zip을 사용하여 컬럼명과 값을 매핑 (딕셔너리 생성)
            record = dict(zip(colnames, row))
            results.append(record)

        # 디버깅용 출력 (터미널에서 확인 가능)
        print(f"--- DB 상세 조회 완료: {len(results)}건 (bd_number: {bd_number}) ---")
        
        return results

    except Exception as e:
        # 에러 발생 시 정확한 메시지를 콘솔에 출력
        print(f"❌ [DB 에러] working_history 함수 내 발생: {e}")
        return ['error'] # 에러 시 빈 리스트를 반환해야 프론트 JS가 안 깨집니다.
    finally:
        if cur:
            cur.close()
            # conn.close()


def extract_intro_customers_by_building(conn, bd_number: str) -> dict:
    """
    특정 건물을 소개받은 고객 목록 조회
    """
    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                x.intro_id,
                x.customer_number,
                x.buyer_name,
                x.company_address,
                x.ceo_name,
                x.intro_date,
                x.progress_status,
                COALESCE(
                    NULLIF(TRIM(x.sale_price), ''),
                    (
                        SELECT cip2.sale_price
                        FROM customer_intro_property cip2
                        WHERE cip2.delete_flag = FALSE
                          AND cip2.bd_number = x.bd_number
                          AND cip2.customer_number = x.customer_number
                          AND NULLIF(TRIM(cip2.sale_price), '') IS NOT NULL
                        ORDER BY COALESCE(cip2.update_time, cip2.intro_date) DESC, cip2.intro_id ASC
                        LIMIT 1
                    )
                ) AS sale_price,
                COALESCE(
                    NULLIF(TRIM(x.intro_cost), ''),
                    (
                        SELECT cip3.intro_cost
                        FROM customer_intro_property cip3
                        WHERE cip3.delete_flag = FALSE
                          AND cip3.bd_number = x.bd_number
                          AND cip3.customer_number = x.customer_number
                          AND NULLIF(TRIM(cip3.intro_cost), '') IS NOT NULL
                        ORDER BY COALESCE(cip3.update_time, cip3.intro_date) DESC, cip3.intro_id ASC
                        LIMIT 1
                    )
                ) AS intro_cost,
                x.manager_name,
                x.intro_note
            FROM (
                SELECT DISTINCT ON (cip.customer_number)
                    cip.intro_id,
                    cip.bd_number,
                    cip.customer_number,
                    ci.buyer_name,
                    ci.company_address,
                    ci.ceo_name,
                    cip.intro_date,
                    cip.progress_status,
                    cip.sale_price,
                    cip.intro_cost,
                    cip.manager_name,
                    cip.intro_note
                FROM customer_intro_property cip
                LEFT JOIN customer_info ci
                  ON cip.customer_number = ci.customer_number
                WHERE cip.bd_number = %s
                  AND cip.delete_flag = FALSE
                  AND ci.delete_flag = FALSE
                ORDER BY cip.customer_number, COALESCE(cip.update_time, cip.intro_date) DESC, cip.intro_id ASC
            ) x
            ORDER BY COALESCE(x.intro_date, CURRENT_TIMESTAMP) DESC, x.intro_id ASC
            """,
            (bd_number,)
        )

        colnames = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        return [dict(zip(colnames, row)) for row in rows]
    except Exception:
        return []
    finally:
        if cur:
            cur.close()


####################### 이미지 등록 관련 함수 ###########################
###################### 1. image_register #############################
def image_register(
    conn, 
    bd_number: int,
    section: str, 
    index: int,
    BASE_UPLOAD_DIR: str,
    image_name: str
) -> dict:
    '''
        이미지 등록
        - 기존 동일 bd_number / section / section_index 데이터는 delete_flag = TRUE 처리
    '''

    update_sql = """
        UPDATE image_info
        SET delete_flag = TRUE
        WHERE bd_number = %s
          AND section = %s
          AND section_index = %s;
    """

    insert_sql = """
        INSERT INTO image_info (
            bd_number,
            section,
            section_index,
            root_path,
            img_name,
            delete_flag
        )
        VALUES (%s, %s, %s, %s, %s, FALSE)
        RETURNING img_number;
    """

    with conn.cursor() as cur:
        # 1️⃣ 기존 데이터 soft delete
        cur.execute(
            update_sql,
            (
                bd_number,
                section,
                index
            )
        )

        # 2️⃣ 새 이미지 등록
        cur.execute(
            insert_sql,
            (
                bd_number,
                section,
                index,
                BASE_UPLOAD_DIR,
                image_name
            )
        )
        img_number = cur.fetchone()[0]

    conn.commit()

    return {
        "img_number": img_number,
        "bd_number": bd_number,
        "section": section,
        "section_index": index,
        "img_name": image_name,
        "root_path": BASE_UPLOAD_DIR
    }

###################### 2. image_remove ###############################
def image_remove(
    conn, 
    bd_number :int ,
    section : str , 
    index : int) -> dict:
    '''
        이미지 제거 -> flag True 변경 
    '''
    sql = """
        UPDATE image_info
        SET delete_flag = TRUE
        WHERE bd_number = %s
          AND section = %s
          AND section_index = %s
          AND delete_flag = FALSE
    """

    with conn.cursor() as cur:
        cur.execute(sql, (bd_number, section, index))
        affected = cur.rowcount
        conn.commit()

    if affected == 0:
        return {
            "success": False,
            "message": "해당 이미지가 존재하지 않습니다."
        }

    return {
        "success": True,
        "message": "이미지가 삭제 처리되었습니다."
    }

###################### 3. image_search ###############################
def image_search(
    conn, 
    bd_number :int) -> dict:

    cur = conn.cursor()

    cur.execute("""
        SELECT
            section,
            section_index,
            img_name,
            root_path
        FROM image_info
        WHERE bd_number = %s
          AND delete_flag = FALSE
        ORDER BY section, section_index
    """, (bd_number,))

    rows = cur.fetchall()
    cur.close()

    images = defaultdict(list)

    for section, section_index, img_name, root_path in rows:
        images[section].append({
            "section_index": section_index,
            "img_name": img_name,
            "url": f"/{root_path}/{bd_number}/{section}_{section_index}_{img_name}"
        })

    return dict(images)




############## PPT를 위한 데이터 DB search ##############
def ppt_info_search(conn, bd_number :int) -> dict:
    cur = conn.cursor()

    result = {}

    # 1️⃣ building_info (단건)
    cur.execute("""
        SELECT *
        FROM building_info
        WHERE bd_number = %s
            AND delete_flag = FALSE
    """, (bd_number,))
    row = cur.fetchone()
    if row:
        result["building_info"] = dict(zip([d[0] for d in cur.description], row))
    else:
        result["building_info"] = None

    # 2️⃣ building_memo (복수)
    cur.execute("""
        SELECT *
        FROM building_memo
        WHERE bd_number = %s
            AND delete_flag = FALSE
    """, (bd_number,))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]

    result["building_memo"] = (
        dict(zip(cols, rows[0])) if rows else None
    )

    # 3️⃣ detail_management (단건)
    cur.execute("""
        SELECT *
        FROM detail_management
        WHERE bd_number = %s
            AND delete_flag = FALSE
    """, (bd_number,))
    row = cur.fetchone()
    if row:
        result["detail_management"] = dict(zip([d[0] for d in cur.description], row))
    else:
        result["detail_management"] = None

    # 4️⃣ image_info (section별 그룹)
    cur.execute("""
        SELECT
            section,
            section_index,
            img_name,
            root_path
        FROM image_info
        WHERE bd_number = %s
          AND delete_flag = FALSE
        ORDER BY section, section_index
    """, (bd_number,))

    images = defaultdict(list)
    for section, section_index, img_name, root_path in cur.fetchall():
        images[section].append({
            "section_index": section_index,
            "img_name": img_name,
            "url": f"/{root_path}/{bd_number}/{section}_{section_index}_{img_name}"
        })
    result["images"] = dict(images)

    # 5️⃣ working_history (복수)
    cur.execute("""
        SELECT *
        FROM working_history
        WHERE bd_number = %s
            AND delete_flag = FALSE
        ORDER BY update_time DESC
    """, (bd_number,))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    result["working_history"] = [dict(zip(cols, r)) for r in rows]

    cur.close()
    return result

############## delete ####################################
def delete_row(conn, bd_number :int) -> dict:
    cur = conn.cursor()
    try:
        TABLES_TO_DELETE = (
            "building_id",
            "building_info",
            "building_memo",
            "detail_management",
            "image_info",
            "working_history"
        )

        for table in TABLES_TO_DELETE:
            cur.execute(
                f"""
                UPDATE {table}
                SET delete_flag = TRUE
                WHERE bd_number = %s AND delete_flag = FALSE
                """,
                (bd_number,)
            )

        conn.commit()
        return {"result": "ok"}

    except Exception as e:
        conn.rollback()
        raise "error"

    finally:
        cur.close()
        conn.close()
        
