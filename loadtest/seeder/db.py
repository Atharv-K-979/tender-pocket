"""Thin psql access to the EC2-2 database through `docker exec` (local or over SSH).

Read helpers run in a read-only session (default_transaction_read_only=on) so snapshots,
validation and monitoring can never write (G6). Writes go only through load.py / reset.sh,
which require --approved.
"""
from __future__ import annotations

import csv
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.remote import Remote, psql_cmd, remote_from_cfg  # noqa: E402


class Db:
    def __init__(self, cfg: dict, local: bool = False, remote: Remote | None = None):
        env = cfg.get("env") or {}
        self.container = (env.get("containers") or {}).get("postgres", "tender-pocket-postgres")
        pg = env.get("postgres") or {}
        self.user, self.db = pg.get("user"), pg.get("db")
        self.remote = remote or remote_from_cfg(cfg, local=local)

    def ro_cmd(self) -> str:
        return psql_cmd(self.container, self.user, self.db, tuples=True, read_only=True)

    def rw_cmd(self) -> str:
        return psql_cmd(self.container, self.user, self.db)

    def query(self, sql: str, timeout: float = 600) -> list[list[str]]:
        """Run a read-only query; return rows of tab-separated fields."""
        res = self.remote.run(self.ro_cmd(), input_bytes=(sql.strip().rstrip(";") + ";\n").encode(), timeout=timeout)
        out = (res.stdout or b"").decode("utf-8", "replace")
        return [line.split("\t") for line in out.splitlines() if line.strip() != ""]

    def query_raw(self, sql: str, timeout: float = 600) -> str:
        res = self.remote.run(self.ro_cmd(), input_bytes=(sql.strip() + "\n").encode(), timeout=timeout)
        return (res.stdout or b"").decode("utf-8", "replace")

    def copy_out(self, select_sql: str, timeout: float = 1800) -> list[dict]:
        """COPY (SELECT ...) TO STDOUT WITH CSV HEADER → list of dicts (read-only)."""
        sql = f"COPY ({select_sql.strip().rstrip(';')}) TO STDOUT WITH (FORMAT csv, HEADER true, NULL '\\N');\n"
        res = self.remote.run(self.ro_cmd(), input_bytes=sql.encode(), timeout=timeout)
        text = (res.stdout or b"").decode("utf-8", "replace")
        rdr = csv.DictReader(io.StringIO(text))
        rows = []
        for r in rdr:
            rows.append({k: (None if v == "\\N" else v) for k, v in r.items()})
        return rows

    def scalar(self, sql: str):
        rows = self.query(sql)
        return rows[0][0] if rows and rows[0] else None

    def table_exists(self, name: str) -> bool:
        return self.scalar(f"SELECT to_regclass('public.{name}') IS NOT NULL") == "t"

    def is_superuser(self) -> bool:
        return self.scalar("SELECT rolsuper FROM pg_roles WHERE rolname = current_user") == "t"

    def tracking_triggers(self) -> list[str]:
        rows = self.query("SELECT tgname || '@' || tgrelid::regclass FROM pg_trigger "
                          "WHERE NOT tgisinternal AND tgname LIKE 'trg_track_%' ORDER BY 1")
        return [r[0] for r in rows]
