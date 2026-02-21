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

        count = min(limit, len(all_ids))
        return random.sample(all_ids, count)
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
