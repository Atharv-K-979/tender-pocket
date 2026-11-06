"""Safety checks shared by every Python tool (G2, G3, G6).

* check_target_not_ec2_1  — resolve the target host; abort if any name/address is denied.
* path_is_denied          — endpoint deny-list matching (same rules as k6/lib/guards.js).
* in_forbidden_window     — IST forbidden windows.
* require_approved        — G6 gate for any write to the EC2-2 database.
"""
from __future__ import annotations

import datetime as _dt
import fnmatch
import ipaddress
import socket
import sys
from typing import Callable, Iterable
from urllib.parse import urlparse

IST = _dt.timezone(_dt.timedelta(hours=5, minutes=30), name="IST")


class SafetyError(RuntimeError):
    pass


# --------------------------------------------------------------------------- G2
def _norm(entry: str) -> str:
    return entry.strip().lower().rstrip(".")


def resolve_host(host: str, resolver: Callable[[str], Iterable[str]] | None = None) -> set[str]:
    """Return every address the host resolves to (plus the host itself if it is an IP)."""
    addrs: set[str] = set()
    try:
        ipaddress.ip_address(host)
        addrs.add(host)
        return addrs
    except ValueError:
        pass
    if resolver is not None:
        addrs.update(resolver(host))
        return addrs
    try:
        for info in socket.getaddrinfo(host, None):
            addrs.add(info[4][0])
    except socket.gaierror as exc:
        raise SafetyError(f"cannot resolve target host {host!r}: {exc}") from exc
    return addrs


def check_target_not_ec2_1(target_url: str, denylist: Iterable[str],
                           resolver: Callable[[str], Iterable[str]] | None = None,
                           require_nonempty: bool = True) -> dict:
    """Abort (raise SafetyError) if the target matches the EC2-1 deny-list.

    Matching is done on the hostname itself AND on every resolved address, and every
    deny-list hostname is resolved too, so an alias of EC2-1 is also caught.
    """
    deny = [_norm(d) for d in (denylist or []) if str(d).strip()]
    if require_nonempty and not deny:
        raise SafetyError("ec2_1_denylist in env.yaml is empty — refusing to run (G2)")
    parsed = urlparse(target_url)
    host = parsed.hostname
    if not host:
        raise SafetyError(f"target URL {target_url!r} has no host")
    host_n = _norm(host)
    target_addrs = {_norm(a) for a in resolve_host(host, resolver)}
    deny_addrs: set[str] = set()
    for d in deny:
        deny_addrs.add(d)
        if any(c.isalpha() for c in d) and "*" not in d:
            try:
                deny_addrs.update(_norm(a) for a in resolve_host(d, resolver))
            except SafetyError:
                pass  # unresolvable deny names still match by name
    hits = sorted(({host_n} | target_addrs) & deny_addrs)
    wild = [d for d in deny if "*" in d and (fnmatch.fnmatch(host_n, d) or any(fnmatch.fnmatch(a, d) for a in target_addrs))]
    if hits or wild:
        raise SafetyError(f"TARGET IS EC2-1 (deny-list match {hits + wild}) — aborting (G2)")
    return {"host": host, "resolved": sorted(target_addrs), "port": parsed.port}


def check_frontend_url(target_url: str, blocked_ports: Iterable[int]) -> None:
    port = urlparse(target_url).port
    if port is not None and port in set(blocked_ports or []):
        raise SafetyError(f"target URL uses blocked port {port} (direct backend access is forbidden, G3)")


# --------------------------------------------------------------------------- G3
def _strip(path: str) -> str:
    p = path.split("?", 1)[0].split("#", 1)[0]
    if "://" in p:
        p = urlparse(p).path
    return p.rstrip("/") or "/"


def path_is_denied(path: str, patterns: Iterable[str]) -> str | None:
    """Return the matching pattern if `path` is on the endpoint deny-list."""
    p = _strip(path)
    for pat in patterns or []:
        pat = pat.rstrip("/")
        if pat.endswith("*"):
            prefix = pat[:-1]
            if "*" in prefix:
                if fnmatch.fnmatch(p, pat) or fnmatch.fnmatch(p + "/", pat):
                    return pat
            elif p.startswith(prefix) or (p + "/").startswith(prefix):
                return pat
        elif "*" in pat:
            if fnmatch.fnmatch(p, pat):
                return pat
        elif p == pat:
            return pat
    return None


# --------------------------------------------------------------------------- windows
def _hm(s: str) -> _dt.time:
    h, m = s.split(":")
    return _dt.time(int(h), int(m))


def in_forbidden_window(start_utc: _dt.datetime, end_utc: _dt.datetime,
                        windows_ist: Iterable[Iterable[str]]) -> list[str]:
    """Return forbidden windows (as 'HH:MM-HH:MM IST') that overlap [start, end]."""
    if start_utc.tzinfo is None:
        start_utc = start_utc.replace(tzinfo=_dt.timezone.utc)
    if end_utc.tzinfo is None:
        end_utc = end_utc.replace(tzinfo=_dt.timezone.utc)
    s, e = start_utc.astimezone(IST), end_utc.astimezone(IST)
    hits = []
    day = s.date() - _dt.timedelta(days=1)
    while day <= e.date():
        for w in windows_ist or []:
            a, b = _hm(w[0]), _hm(w[1])
            ws = _dt.datetime.combine(day, a, IST)
            we = _dt.datetime.combine(day if b > a else day + _dt.timedelta(days=1), b, IST)
            if ws < e and s < we:
                label = f"{w[0]}-{w[1]} IST"
                if label not in hits:
                    hits.append(label)
        day += _dt.timedelta(days=1)
    return hits


# --------------------------------------------------------------------------- G6
def require_approved(approved: bool, action_description: str, out=sys.stdout) -> None:
    """Print what will be done; refuse unless --approved was given (G6)."""
    print("=" * 78, file=out)
    print("DATABASE WRITE ON EC2-2 — planned action:", file=out)
    for line in action_description.strip().splitlines():
        print("  " + line, file=out)
    print("=" * 78, file=out)
    if not approved:
        raise SafetyError("refusing: this command writes to the EC2-2 database; re-run with --approved (G6)")


def preflight_target(cfg: dict) -> dict:
    """Common pre-flight used by every tool that talks to EC2-2."""
    env = cfg.get("env") or {}
    url = (env.get("target") or {}).get("frontend_url", "")
    if not url:
        raise SafetyError("env.yaml target.frontend_url is not set")
    safety = cfg.get("safety") or {}
    check_frontend_url(url, safety.get("blocked_ports", []))
    info = check_target_not_ec2_1(url, env.get("ec2_1_denylist") or [],
                                  require_nonempty=safety.get("require_ec2_1_denylist_nonempty", True))
    expected = [str(x) for x in ((env.get("target") or {}).get("expected_ips") or [])]
    if expected and not set(info["resolved"]) & set(expected):
        raise SafetyError(f"target resolves to {info['resolved']} which is not in target.expected_ips {expected}")
    return info


def preflight_ssh_alias(cfg: dict, resolver: Callable[[str], Iterable[str]] | None = None) -> None:
    """The SSH alias must not resolve to EC2-1 either (uses `ssh -G` HostName)."""
    import shutil
    import subprocess
    env = cfg.get("env") or {}
    alias = (env.get("remote") or {}).get("ssh_alias")
    if not alias or alias == "local":
        return
    hostname = alias
    if shutil.which("ssh"):
        try:
            out = subprocess.run(["ssh", "-G", alias], capture_output=True, text=True, timeout=10).stdout
            for line in out.splitlines():
                if line.lower().startswith("hostname "):
                    hostname = line.split(None, 1)[1].strip()
        except Exception:
            pass
    check_target_not_ec2_1(f"ssh://{hostname}", env.get("ec2_1_denylist") or [], resolver=resolver)
