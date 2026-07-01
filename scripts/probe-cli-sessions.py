#!/usr/bin/env python3
"""Probe local CLI agent session storage for a given project cwd."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def home() -> Path:
    return Path.home()


def normalize_cwd(cwd: str) -> str:
    return str(Path(cwd).resolve())


def encode_claude_cwd(cwd: str) -> str:
    return re.sub(r"[/\\: _]", "-", normalize_cwd(cwd))


def encode_cursor_project(cwd: str) -> str:
    return normalize_cwd(cwd).replace("/", "-").lstrip("-")


def extract_claude_text(content: Any) -> str | None:
    if isinstance(content, str):
        if content.startswith("<") and content.endswith(">"):
            return None
        return content.strip() or None
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                text = item.get("text", "")
                if isinstance(text, str) and text and not text.startswith("<"):
                    parts.append(text)
        return "\n".join(parts).strip() or None
    return None


def summarize_claude_session(path: Path, limit: int) -> dict[str, Any]:
    types: dict[str, int] = {}
    messages: list[dict[str, str]] = []
    session_id = path.stem
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()

    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = row.get("type", "?")
        types[t] = types.get(t, 0) + 1
        if row.get("isMeta"):
            continue
        if t not in ("user", "assistant"):
            continue
        msg = row.get("message") or {}
        text = extract_claude_text(msg.get("content"))
        if text:
            messages.append({"role": t, "text": text[:500]})

    return {
        "provider": "claude",
        "sessionId": session_id,
        "path": str(path),
        "mtime": mtime,
        "entryTypes": types,
        "messages": messages[:limit],
        "messageCount": len(messages),
    }


def decode_cursor_meta_value(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        if re.fullmatch(r"[0-9a-fA-F]+", raw) and len(raw) % 2 == 0:
            return json.loads(bytes.fromhex(raw))
    except (json.JSONDecodeError, ValueError):
        pass
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def extract_cursor_text(content: Any) -> str | None:
    if isinstance(content, str):
        m = re.search(r"<user_query>\s*(.*?)\s*</user_query>", content, re.S)
        if m:
            return m.group(1).strip()
        if content.startswith("<"):
            return None
        return content.strip() or None
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                text = item["text"]
                if text and not text.startswith("<"):
                    parts.append(text)
        return "\n".join(parts).strip() or None
    return None


def summarize_cursor_acp_session(session_dir: Path, limit: int) -> dict[str, Any]:
    meta_path = session_dir / "meta.json"
    db_path = session_dir / "store.db"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    mtime = datetime.fromtimestamp(session_dir.stat().st_mtime, tz=timezone.utc).isoformat()

    messages: list[dict[str, str]] = []
    blob_roles: dict[str, int] = {}
    meta_row: dict[str, Any] | None = None

    if db_path.exists():
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            for key, value in conn.execute("SELECT key, value FROM meta"):
                decoded = decode_cursor_meta_value(value)
                if decoded:
                    meta_row = decoded
            for _id, data in conn.execute("SELECT id, data FROM blobs"):
                if isinstance(data, memoryview):
                    data = data.tobytes()
                if isinstance(data, bytes):
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        continue
                else:
                    text = data
                try:
                    payload = json.loads(text)
                except (json.JSONDecodeError, TypeError):
                    continue
                role = payload.get("role")
                if role:
                    blob_roles[role] = blob_roles.get(role, 0) + 1
                if role in ("user", "assistant"):
                    text = extract_cursor_text(payload.get("content"))
                    if text:
                        messages.append({"role": role, "text": text[:500]})
        finally:
            conn.close()

    return {
        "provider": "cursor-acp",
        "sessionId": session_dir.name,
        "title": meta.get("title") or (meta_row or {}).get("name"),
        "cwd": meta.get("cwd"),
        "path": str(session_dir),
        "mtime": mtime,
        "blobRoles": blob_roles,
        "messages": messages[:limit],
        "messageCount": len(messages),
    }


def summarize_cursor_ide_transcript(path: Path, limit: int) -> dict[str, Any]:
    messages: list[dict[str, str]] = []
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        role = row.get("role")
        if role not in ("user", "assistant"):
            continue
        content = (row.get("message") or {}).get("content")
        text = extract_claude_text(content)
        if text:
            messages.append({"role": role, "text": text[:500]})
    return {
        "provider": "cursor-ide",
        "sessionId": path.stem,
        "path": str(path),
        "mtime": mtime,
        "messages": messages[:limit],
        "messageCount": len(messages),
    }


def grep_codex_sessions(cwd: str, codex_home: Path, limit: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    sessions_root = codex_home / "sessions"
    if not sessions_root.exists():
        return out
    for path in sorted(sessions_root.rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            if cwd not in path.read_text(encoding="utf-8", errors="replace")[:20000]:
                continue
        except OSError:
            continue
        messages: list[dict[str, str]] = []
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines()[:400]:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("type") == "user_message" and isinstance(row.get("message"), str):
                messages.append({"role": "user", "text": row["message"][:500]})
            elif row.get("type") == "assistant_message" and isinstance(row.get("message"), str):
                messages.append({"role": "assistant", "text": row["message"][:500]})
        out.append({
            "provider": "codex",
            "sessionId": path.stem,
            "path": str(path),
            "mtime": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
            "messages": messages[:limit],
            "messageCount": len(messages),
        })
    return out


def probe(cwd: str, limit: int) -> dict[str, Any]:
    cwd = normalize_cwd(cwd)
    result: dict[str, Any] = {"cwd": cwd, "sessions": []}

    claude_dir = home() / ".claude" / "projects" / encode_claude_cwd(cwd)
    if claude_dir.is_dir():
        for path in sorted(claude_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
            result["sessions"].append(summarize_claude_session(path, limit))

    acp_root = home() / ".cursor" / "acp-sessions"
    if acp_root.is_dir():
        for session_dir in acp_root.iterdir():
            if not session_dir.is_dir():
                continue
            meta_path = session_dir / "meta.json"
            if not meta_path.exists():
                continue
            try:
                meta = json.loads(meta_path.read_text())
            except json.JSONDecodeError:
                continue
            if normalize_cwd(meta.get("cwd", "")) != cwd:
                continue
            result["sessions"].append(summarize_cursor_acp_session(session_dir, limit))

    legacy_chats = home() / ".cursor" / "chats"
    if legacy_chats.is_dir():
        for store in legacy_chats.rglob("store.db"):
            session_dir = store.parent
            meta_path = session_dir / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text())
                    if normalize_cwd(meta.get("cwd", "")) != cwd:
                        continue
                except json.JSONDecodeError:
                    pass
            result["sessions"].append(summarize_cursor_acp_session(session_dir, limit))

    ide_dir = home() / ".cursor" / "projects" / encode_cursor_project(cwd) / "agent-transcripts"
    if ide_dir.is_dir():
        for path in sorted(ide_dir.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
            result["sessions"].append(summarize_cursor_ide_transcript(path, limit))

    codex_home = Path.home() / ".codex"
    result["sessions"].extend(grep_codex_sessions(cwd, codex_home, limit))

    gemini_tmp = home() / ".gemini" / "tmp"
    if gemini_tmp.is_dir():
        for path in gemini_tmp.rglob("*.json"):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if cwd not in text:
                continue
            result["sessions"].append({
                "provider": "gemini",
                "sessionId": path.stem,
                "path": str(path),
                "mtime": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
                "note": "checkpoint/log json — inspect manually",
            })

    opencode_root = home() / ".local" / "share" / "opencode" / "storage"
    if opencode_root.is_dir():
        for path in opencode_root.rglob("*.json"):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if cwd not in text:
                continue
            result["sessions"].append({
                "provider": "opencode",
                "sessionId": path.stem,
                "path": str(path),
                "mtime": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
                "note": "session/message json — inspect manually",
            })

    result["sessions"].sort(key=lambda s: s.get("mtime", ""), reverse=True)
    result["counts"] = {
        "total": len(result["sessions"]),
        "byProvider": {},
    }
    for s in result["sessions"]:
        p = s["provider"]
        result["counts"]["byProvider"][p] = result["counts"]["byProvider"].get(p, 0) + 1
    return result


def print_human(data: dict[str, Any]) -> None:
    print(f"cwd: {data['cwd']}")
    print(f"sessions: {data['counts']['total']} ({data['counts']['byProvider']})")
    print()
    for s in data["sessions"]:
        title = s.get("title")
        label = f"{s['provider']} {s['sessionId'][:8]}..."
        if title:
            label += f" ({title})"
        print(f"## {label}")
        print(f"   path: {s['path']}")
        print(f"   mtime: {s.get('mtime')}")
        if "entryTypes" in s:
            print(f"   entryTypes: {s['entryTypes']}")
        if "blobRoles" in s:
            print(f"   blobRoles: {s['blobRoles']}")
        if s.get("messageCount"):
            print(f"   messages: {s['messageCount']}")
            for m in s.get("messages", [])[:6]:
                text = m["text"].replace("\n", " ")
                print(f"     [{m['role']}] {text[:120]}")
        if s.get("note"):
            print(f"   note: {s['note']}")
        print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe local CLI session storage for a cwd")
    parser.add_argument("cwd", nargs="?", default=".", help="Project directory (default: cwd)")
    parser.add_argument("--json", action="store_true", help="Print JSON")
    parser.add_argument("--limit", type=int, default=20, help="Max messages per session")
    args = parser.parse_args()

    data = probe(args.cwd, args.limit)
    if args.json:
        json.dump(data, sys.stdout, indent=2)
        print()
    else:
        print_human(data)


if __name__ == "__main__":
    main()
