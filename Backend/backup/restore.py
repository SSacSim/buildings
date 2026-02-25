import os
import subprocess
import sys
from pathlib import Path

import psycopg2
from psycopg2 import sql
import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SETTINGS_PATH = PROJECT_ROOT / "settings.yaml"


def load_settings() -> dict:
    if not SETTINGS_PATH.exists():
        raise FileNotFoundError(f"settings.yaml not found: {SETTINGS_PATH}")
    with SETTINGS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def resolve_path(raw_path: str | None, base_dir: Path) -> Path | None:
    if not raw_path:
        return None
    p = Path(raw_path)
    if not p.is_absolute():
        p = (base_dir / p).resolve()
    return p


def resolve_pg_restore_executable(backup_cfg: dict) -> str:
    configured = (backup_cfg.get("pg_restore_path") or "").strip()
    if configured:
        return configured

    pg_dump_path = (backup_cfg.get("pg_dump_path") or "").strip()
    if pg_dump_path:
        dump_path_obj = Path(pg_dump_path)
        name = dump_path_obj.name.lower()
        if name in {"pg_dump", "pg_dump.exe"}:
            restore_name = "pg_restore.exe" if name.endswith(".exe") else "pg_restore"
            return str(dump_path_obj.with_name(restore_name))
        if dump_path_obj.is_dir():
            restore_name = "pg_restore.exe" if os.name == "nt" else "pg_restore"
            return str(dump_path_obj / restore_name)

    return "pg_restore"


def resolve_dump_file(cli_dump: str | None, backup_cfg: dict) -> Path:
    if cli_dump:
        dump_path = Path(cli_dump).expanduser().resolve()
        if not dump_path.exists():
            raise FileNotFoundError(f"dump file not found: {dump_path}")
        return dump_path

    state_file = resolve_path(backup_cfg.get("state_file"), PROJECT_ROOT / "Backend")
    if state_file and state_file.exists():
        try:
            import json

            payload = json.loads(state_file.read_text(encoding="utf-8"))
            candidate = payload.get("last_backup_file")
            if candidate:
                dump_path = Path(candidate).expanduser().resolve()
                if dump_path.exists():
                    return dump_path
        except Exception:
            pass

    output_dir = resolve_path(backup_cfg.get("output_dir"), PROJECT_ROOT / "Backend")
    if output_dir and output_dir.exists():
        dumps = sorted(output_dir.glob("*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
        if dumps:
            return dumps[0]

    raise FileNotFoundError(
        "No dump file was provided and no backup file was found. "
        "Pass dump path: python Backend/backup/restore.py <dump_file_path> [target_db]"
    )


def ensure_db_exists(db_cfg: dict, target_db: str) -> None:
    conn = psycopg2.connect(
        host=db_cfg.get("host", "localhost"),
        port=db_cfg.get("port", 5432),
        dbname="postgres",
        user=db_cfg.get("user", "postgres"),
        password=db_cfg.get("password", ""),
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
            if cur.fetchone() is None:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target_db)))
    finally:
        conn.close()


def restore(dump_file: Path, target_db: str) -> None:
    settings = load_settings()
    db_cfg = settings.get("db", {})
    app_cfg = settings.get("app", {})
    backup_cfg = app_cfg.get("backup", {}) if isinstance(app_cfg, dict) else {}

    pg_restore_exe = resolve_pg_restore_executable(backup_cfg)
    ensure_db_exists(db_cfg, target_db)

    cmd = [
        pg_restore_exe,
        "-h",
        str(db_cfg.get("host", "localhost")),
        "-p",
        str(db_cfg.get("port", 5432)),
        "-U",
        str(db_cfg.get("user", "postgres")),
        "-d",
        target_db,
        "--no-owner",
        "--no-privileges",
        str(dump_file),
    ]

    env = os.environ.copy()
    password = str(db_cfg.get("password", "") or "")
    if password:
        env["PGPASSWORD"] = password

    subprocess.run(cmd, check=True, env=env)


def main() -> None:
    settings = load_settings()
    db_cfg = settings.get("db", {})
    source_db_name = str(db_cfg.get("name", "postgres"))
    backup_cfg = (settings.get("app", {}) or {}).get("backup", {})

    cli_dump = sys.argv[1] if len(sys.argv) >= 2 else None
    cli_target_db = sys.argv[2] if len(sys.argv) >= 3 else None
    configured_restore_db = str(backup_cfg.get("restore_db_name", "") or "").strip()
    target_db = cli_target_db or configured_restore_db or f"{source_db_name}_restore"

    dump_file = resolve_dump_file(cli_dump, backup_cfg)

    print(f"[restore] dump: {dump_file}")
    print(f"[restore] target_db: {target_db}")
    restore(dump_file=dump_file, target_db=target_db)
    print("[restore] done")


if __name__ == "__main__":
    main()
