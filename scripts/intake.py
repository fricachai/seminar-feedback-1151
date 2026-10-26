"""Read-only intake. Student data stays in ignored local files, never stdout."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / ".private"
ASSETS = ROOT / ".private-assets"


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def prepare(source):
    source = Path(source).resolve(strict=True)
    PRIVATE.mkdir(exist_ok=True)
    ASSETS.mkdir(exist_ok=True)
    sources = [p for p in source.glob("*.xlsx") if "修課名單" in p.name and not p.name.startswith("~$")]
    if len(sources) != 1:
        raise ValueError("Expected exactly one current roster workbook; no changes applied.")
    workbook_path = sources[0]
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    students = []
    for sheet in workbook:
        rows = iter(sheet.iter_rows(values_only=True))
        headers = next(rows)
        if "學號" not in headers or "姓名" not in headers:
            continue
        id_col, name_col = headers.index("學號"), headers.index("姓名")
        for row in rows:
            raw_id, raw_name = row[id_col], row[name_col]
            if raw_id is None and raw_name is None:
                continue
            sid = str(int(raw_id)) if isinstance(raw_id, (int, float)) else str(raw_id).strip()
            name = str(raw_name or "").strip()
            if not re.fullmatch(r"\d{8}", sid) or not name or name == "None":
                raise ValueError("Invalid roster row; no import applied.")
            students.append({"id": sid, "name": name})
    workbook.close()
    if not students or len({s["id"] for s in students}) != len(students):
        raise ValueError("Empty or duplicate roster; no import applied.")
    students.sort(key=lambda s: s["id"])
    by_id = {s["id"]: s for s in students}
    overrides_path = PRIVATE / "title-overrides.json"
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
    papers, warnings = [], []
    for folder in sorted(source.iterdir()):
        match = re.match(r"^(\d{8})\s+(.+)$", folder.name)
        if not folder.is_dir() or not match:
            continue
        sid, folder_name = match.groups()
        if sid not in by_id or folder_name.strip() != by_id[sid]["name"]:
            raise ValueError("Student-folder identity does not match the official roster; review required.")
        for pdf in sorted(folder.glob("*")):
            if not pdf.is_file() or pdf.suffix.lower() != ".pdf":
                continue
            data = pdf.read_bytes()
            if not data.startswith(b"%PDF-") or len(data) > 10 * 1024 * 1024:
                raise ValueError("Invalid PDF or upload exceeds the existing 10 MB course limit.")
            sha = hashlib.sha256(data).hexdigest()
            asset_key = sha + ".pdf"
            file_id = hashlib.sha256((sid + ":" + sha).encode("utf-8")).hexdigest()[:24]
            filename_title = re.sub(r"^\d{4}\s*_\s*", "", pdf.stem)
            filename_title = re.sub(r"(?:\.pdf)+$", "", filename_title, flags=re.IGNORECASE)
            for suffix in [" - " + by_id[sid]["name"], " - " + folder.name]:
                if filename_title.endswith(suffix):
                    filename_title = filename_title[:-len(suffix)]
            override = overrides.get(sha)
            title = override["title"] if override else filename_title.strip()
            title_source = override.get("source", "pdf_first_page_verified") if override else "student_filename"
            if not title or len(title) > 1000:
                raise ValueError("Article title needs review before synchronization.")
            if not override:
                warnings.append({"paperId": file_id, "reason": "Title uses the student filename; first-page verification not recorded."})
            target = ASSETS / asset_key
            if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != sha:
                shutil.copyfile(pdf, target)
            if hashlib.sha256(target.read_bytes()).hexdigest() != sha:
                raise ValueError("PDF copy hash mismatch; no import applied.")
            papers.append({"id": file_id, "studentId": sid, "title": title, "assetKey": asset_key,
                           "sha256": sha, "byteSize": len(data), "modifiedAt": datetime.fromtimestamp(pdf.stat().st_mtime, timezone.utc).isoformat(),
                           "titleSource": title_source, "sourcePath": str(pdf)})
    if len({p["id"] for p in papers}) != len(papers):
        raise ValueError("Duplicate PDF identity in one student folder; review required.")
    synced_at = datetime.now(timezone.utc).isoformat()
    manifest = {"sourceRoot": str(source), "rosterSource": str(workbook_path),
                "rosterSha256": hashlib.sha256(workbook_path.read_bytes()).hexdigest(),
                "syncedAt": synced_at, "students": students, "papers": papers, "warnings": warnings}
    (PRIVATE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (PRIVATE / "source.json").write_text(json.dumps({"sourceRoot": str(source)}, ensure_ascii=False, indent=2), encoding="utf-8")
    statements = ["PRAGMA foreign_keys = ON;", "UPDATE students SET active = 0;", "UPDATE papers SET active = 0;"]
    for s in students:
        statements.append(f"INSERT INTO students(id, name, active) VALUES({quote(s['id'])}, {quote(s['name'])}, 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, active=1;")
    for p in papers:
        values = [p["id"], p["studentId"], p["title"], p["assetKey"], p["sha256"], p["byteSize"], p["modifiedAt"], p["titleSource"]]
        statements.append("INSERT INTO papers(id,student_id,title,asset_key,sha256,byte_size,modified_at,title_source,active) VALUES("
                          + ",".join(quote(x) for x in values) + ",1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,asset_key=excluded.asset_key,sha256=excluded.sha256,byte_size=excluded.byte_size,modified_at=excluded.modified_at,title_source=excluded.title_source,active=1;")
    statements.append(f"INSERT INTO metadata(key,value) VALUES('synced_at',{quote(synced_at)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;")
    # D1's file import runs atomically. Never delete feedback during source synchronization.
    (PRIVATE / "seed.sql").write_text("\n".join(statements) + "\n", encoding="utf-8")
    print(json.dumps({"students": len(students), "papers": len(papers), "uploadedStudents": len({p['studentId'] for p in papers}), "titleWarnings": len(warnings), "pdfHashesVerified": True}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    args = parser.parse_args()
    try:
        prepare(args.source)
    except Exception as error:
        # Library exceptions may include a student's path. Keep details private.
        PRIVATE.mkdir(exist_ok=True)
        (PRIVATE / "intake-error.txt").write_text(str(error), encoding="utf-8")
        print("Intake failed. Private diagnostic saved; no database import performed.", file=sys.stderr)
        sys.exit(1)
