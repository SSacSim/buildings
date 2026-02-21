import random
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent.parent

sys.path.append(str(PROJECT_ROOT / "DB"))
sys.path.append(str(PROJECT_ROOT / "Backend" / "ppt" / "module"))

import DB_utils  # noqa: E402
import make_ppt_template2  # noqa: E402


def pick_random_buildings(conn, limit=7, seed=None):
    cur = conn.cursor()
    try:
        required_id = None
        cur.execute(
            """
            SELECT bi.bd_number
            FROM building_info bi
            JOIN building_id bid ON bid.bd_number = bi.bd_number
            WHERE bi.delete_flag = FALSE
              AND bid.delete_flag = FALSE
              AND bi.address LIKE %s
            ORDER BY bi.update_time DESC NULLS LAST, bi.bd_number DESC
            LIMIT 1
            """,
            ("%아시아333%",),
        )
        row = cur.fetchone()
        if row:
            required_id = int(row[0])

        cur.execute(
            """
            SELECT bd_number
            FROM building_id
            WHERE delete_flag = FALSE
            """
        )
        rows = cur.fetchall()
        all_ids = [int(r[0]) for r in rows]
        if not all_ids:
            return []

        if seed is not None:
            random.seed(seed)

        selected = []
        if required_id is not None and required_id in all_ids:
            selected.append(required_id)
            all_ids.remove(required_id)

        remain = max(0, limit - len(selected))
        if remain > 0 and all_ids:
            selected.extend(random.sample(all_ids, min(remain, len(all_ids))))

        return selected
    finally:
        cur.close()


def main():
    conn = DB_utils.join_db()
    try:
        bd_numbers = pick_random_buildings(conn, limit=7)
    finally:
        conn.close()

    if not bd_numbers:
        print("No building rows found.")
        return

    print("Selected bd_numbers:", bd_numbers)
    ppt_path, filename = make_ppt_template2.run(bd_numbers)
    print("Generated:", filename)
    print("Path:", ppt_path)


if __name__ == "__main__":
    main()
