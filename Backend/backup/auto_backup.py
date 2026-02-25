import json
import logging
import os
import shutil
import subprocess
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, Optional


logger = logging.getLogger("backup.scheduler")

_scheduler_lock = threading.Lock()
_scheduler_thread: Optional[threading.Thread] = None
_scheduler_stop_event: Optional[threading.Event] = None


def _to_positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _to_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _resolve_path(raw_path: Optional[str], default_path: Path, base_dir: Path) -> Path:
    if not raw_path:
        return default_path
    path_obj = Path(raw_path)
    if not path_obj.is_absolute():
        path_obj = (base_dir / path_obj).resolve()
    return path_obj


def _load_config(settings_loader: Callable[[], Dict[str, Any]], base_dir: Path) -> Dict[str, Any]:
    settings = settings_loader() or {}
    app_settings = settings.get("app", {}) if isinstance(settings, dict) else {}
    backup_settings = app_settings.get("backup", {}) if isinstance(app_settings, dict) else {}
    db_settings = settings.get("db", {}) if isinstance(settings, dict) else {}

    default_output_dir = (base_dir / "backup" / "dumps").resolve()
    default_state_file = (base_dir / "backup" / "backup_state.json").resolve()

    interval_seconds = _to_positive_int(
        os.getenv("APP_BACKUP_INTERVAL_SECONDS")
        or backup_settings.get("interval_seconds"),
        60 * 60 * 2,
    )
    check_interval_seconds = _to_positive_int(
        os.getenv("APP_BACKUP_CHECK_INTERVAL_SECONDS")
        or backup_settings.get("check_interval_seconds"),
        30,
    )
    retention_days = _to_positive_int(
        os.getenv("APP_BACKUP_RETENTION_DAYS")
        or backup_settings.get("retention_days"),
        30,
    )

    compress_level = _to_positive_int(
        os.getenv("APP_BACKUP_COMPRESS_LEVEL")
        or backup_settings.get("compress_level"),
        9,
    )
    if compress_level > 9:
        compress_level = 9

    enabled = _to_bool(
        os.getenv("APP_BACKUP_ENABLED") if os.getenv("APP_BACKUP_ENABLED") is not None else backup_settings.get("enabled"),
        True,
    )

    config = {
        "enabled": enabled,
        "interval_seconds": interval_seconds,
        "check_interval_seconds": check_interval_seconds,
        "retention_days": retention_days,
        "pg_dump_path": os.getenv("APP_BACKUP_PG_DUMP_PATH")
        or backup_settings.get("pg_dump_path")
        or "pg_dump",
        "output_dir": _resolve_path(
            os.getenv("APP_BACKUP_OUTPUT_DIR") or backup_settings.get("output_dir"),
            default_output_dir,
            base_dir,
        ),
        "state_file": _resolve_path(
            os.getenv("APP_BACKUP_STATE_FILE") or backup_settings.get("state_file"),
            default_state_file,
            base_dir,
        ),
        "db": {
            "host": db_settings.get("host", "localhost"),
            "port": str(db_settings.get("port", 5432)),
            "name": db_settings.get("name", "postgres"),
            "user": db_settings.get("user", "postgres"),
            "password": db_settings.get("password", ""),
        },
        "compress_level": compress_level,
    }
    return config


def _load_last_backup_ts(state_file: Path) -> Optional[float]:
    if not state_file.exists():
        return None
    try:
        payload = json.loads(state_file.read_text(encoding="utf-8"))
        ts = payload.get("last_backup_epoch")
        if ts is None:
            return None
        return float(ts)
    except Exception:
        return None


def _save_state(state_file: Path, backup_file: Path, backup_ts: float) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "last_backup_epoch": backup_ts,
        "last_backup_at": datetime.fromtimestamp(backup_ts).isoformat(timespec="seconds"),
        "last_backup_file": str(backup_file),
    }
    state_file.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _cleanup_old_backups(output_dir: Path, retention_days: int) -> None:
    if retention_days <= 0:
        return
    cutoff = datetime.now() - timedelta(days=retention_days)
    for dump_file in output_dir.glob("*.dump"):
        try:
            modified_at = datetime.fromtimestamp(dump_file.stat().st_mtime)
            if modified_at < cutoff:
                dump_file.unlink(missing_ok=True)
        except Exception:
            logger.exception("Failed to delete old backup file: %s", dump_file)


def _resolve_pg_dump_executable(raw_value: str) -> Optional[str]:
    candidate = (raw_value or "").strip() or "pg_dump"
    if Path(candidate).is_file():
        return candidate
    resolved = shutil.which(candidate)
    return resolved


def _run_backup_once(config: Dict[str, Any]) -> bool:
    state_file: Path = config["state_file"]
    interval_seconds = config["interval_seconds"]
    now_ts = time.time()
    last_backup_ts = _load_last_backup_ts(state_file)

    if last_backup_ts is not None and now_ts - last_backup_ts < interval_seconds:
        return False

    output_dir: Path = config["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)

    db_config = config["db"]
    db_name = str(db_config.get("name") or "postgres")
    ts_text = datetime.fromtimestamp(now_ts).strftime("%Y%m%d_%H%M%S")
    backup_file = output_dir / f"{db_name}_{ts_text}.dump"

    pg_dump_exe = _resolve_pg_dump_executable(config.get("pg_dump_path", "pg_dump"))
    if not pg_dump_exe:
        logger.error("pg_dump executable not found. Set app.backup.pg_dump_path or PATH.")
        return False

    cmd = [
        pg_dump_exe,
        "-h",
        str(db_config.get("host") or "localhost"),
        "-p",
        str(db_config.get("port") or "5432"),
        "-U",
        str(db_config.get("user") or "postgres"),
        "-d",
        db_name,
        "-F",
        "c",
        "-Z",
        str(config["compress_level"]),
        "-f",
        str(backup_file),
    ]

    env = os.environ.copy()
    password = str(db_config.get("password") or "").strip()
    if password:
        env["PGPASSWORD"] = password

    try:
        subprocess.run(cmd, check=True, env=env, capture_output=True, text=True)
        _save_state(state_file, backup_file, now_ts)
        _cleanup_old_backups(output_dir, config["retention_days"])
        logger.info("PostgreSQL backup completed: %s", backup_file)
        return True
    except subprocess.CalledProcessError as exc:
        logger.error("PostgreSQL backup failed (returncode=%s): %s", exc.returncode, exc.stderr)
        return False
    except Exception:
        logger.exception("Unexpected error while running PostgreSQL backup.")
        return False


def _scheduler_loop(
    settings_loader: Callable[[], Dict[str, Any]],
    base_dir: Path,
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set():
        try:
            config = _load_config(settings_loader, base_dir)
            if config["enabled"]:
                _run_backup_once(config)
            wait_seconds = config["check_interval_seconds"]
        except Exception:
            logger.exception("Backup scheduler loop error.")
            wait_seconds = 30
        stop_event.wait(wait_seconds)


def start_backup_scheduler(
    *,
    settings_loader: Callable[[], Dict[str, Any]],
    base_dir: Path,
) -> None:
    global _scheduler_thread, _scheduler_stop_event
    with _scheduler_lock:
        if _scheduler_thread and _scheduler_thread.is_alive():
            return

        _scheduler_stop_event = threading.Event()
        _scheduler_thread = threading.Thread(
            target=_scheduler_loop,
            args=(settings_loader, base_dir, _scheduler_stop_event),
            name="postgres-backup-scheduler",
            daemon=True,
        )
        _scheduler_thread.start()


def stop_backup_scheduler(join_timeout_seconds: int = 5) -> None:
    global _scheduler_thread, _scheduler_stop_event
    with _scheduler_lock:
        thread = _scheduler_thread
        stop_event = _scheduler_stop_event
        if not thread:
            return
        if stop_event:
            stop_event.set()

    if thread.is_alive():
        thread.join(timeout=join_timeout_seconds)

    with _scheduler_lock:
        _scheduler_thread = None
        _scheduler_stop_event = None
