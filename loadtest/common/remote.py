"""Run commands on EC2-2 over the SSH alias from env.yaml, or locally.

`--generator-on-target` (orchestrator) or ssh_alias == "local" runs commands locally.
Every remote command is built from fixed templates; nothing here prints env VALUES.
"""
from __future__ import annotations

import shlex
import subprocess
from typing import IO, Sequence


class Remote:
    def __init__(self, ssh_alias: str | None, local: bool = False, dry_run: bool = False):
        self.alias = ssh_alias
        self.local = local or not ssh_alias or ssh_alias == "local"
        self.dry_run = dry_run

    def argv(self, command: str) -> list[str]:
        if self.local:
            return ["bash", "-c", command]
        return ["ssh", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", self.alias, command]

    def run(self, command: str, *, stdin: IO[bytes] | None = None, input_bytes: bytes | None = None,
            timeout: float | None = None, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
        if self.dry_run:
            print(f"[dry-run] {'local' if self.local else self.alias}: {command}")
            return subprocess.CompletedProcess(self.argv(command), 0, b"", b"")
        return subprocess.run(self.argv(command), stdin=stdin, input=input_bytes,
                              capture_output=capture, timeout=timeout, check=check)

    def text(self, command: str, timeout: float | None = 120, check: bool = True) -> str:
        res = self.run(command, timeout=timeout, check=check)
        return (res.stdout or b"").decode("utf-8", "replace")

    def popen(self, command: str, stdout: IO | int | None = None, stdin: int | None = None) -> subprocess.Popen:
        if self.dry_run:
            print(f"[dry-run popen] {command}")
            return subprocess.Popen(["true"])
        return subprocess.Popen(self.argv(command), stdout=stdout, stdin=stdin, stderr=subprocess.PIPE)

    def put(self, local_path: str, remote_path: str) -> None:
        if self.dry_run:
            print(f"[dry-run] put {local_path} -> {remote_path}")
            return
        if self.local:
            subprocess.run(["cp", local_path, remote_path], check=True)
        else:
            subprocess.run(["scp", "-q", "-o", "BatchMode=yes", local_path, f"{self.alias}:{remote_path}"], check=True)

    def get(self, remote_path: str, local_path: str) -> None:
        if self.dry_run:
            print(f"[dry-run] get {remote_path} -> {local_path}")
            return
        if self.local:
            subprocess.run(["cp", remote_path, local_path], check=True)
        else:
            subprocess.run(["scp", "-q", "-o", "BatchMode=yes", f"{self.alias}:{remote_path}", local_path], check=True)


def q(*parts: str) -> str:
    return " ".join(shlex.quote(p) for p in parts)


def psql_cmd(pg_container: str, user: str | None, db: str | None, extra: Sequence[str] = (),
             tuples: bool = False, read_only: bool = False) -> str:
    """docker exec psql with ON_ERROR_STOP.

    tuples    → quiet, unaligned, tab-separated, no header.
    read_only → the whole session runs with default_transaction_read_only=on (G6: monitoring
                and snapshots are SELECT/SHOW only and cannot write even by mistake).
    user/db None → use the postgres container's own $POSTGRES_USER/$POSTGRES_DB (never echoed).
    """
    flags = ["-X", "-v", "ON_ERROR_STOP=1"]
    if tuples:
        flags += ["-q", "-A", "-t", "-F", "\t"]
    flags += list(extra)
    env = ["-e", "PGOPTIONS=-c default_transaction_read_only=on"] if read_only else []
    if user and db and user != "PG_USER":
        return q("docker", "exec", "-i", *env, pg_container, "psql", *flags, "-U", user, "-d", db)
    inner = "psql " + " ".join(shlex.quote(f) for f in flags) + ' -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"'
    return q("docker", "exec", "-i", *env, pg_container, "sh", "-c", inner)


def remote_from_cfg(cfg: dict, local: bool = False, dry_run: bool = False) -> Remote:
    env = cfg.get("env") or {}
    return Remote((env.get("remote") or {}).get("ssh_alias"), local=local, dry_run=dry_run)
