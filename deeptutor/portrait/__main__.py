"""Initialize and inspect the isolated database: python -m deeptutor.portrait."""
import argparse
import json

from .database import PortraitDatabase


def main():
    parser = argparse.ArgumentParser(description="Initialize the independent portrait database")
    parser.add_argument("--db", help="Explicit database path; defaults to data/portrait/portrait.db")
    args = parser.parse_args()
    db = PortraitDatabase(args.db)
    db.initialize()
    with db.connect() as conn:
        report = {
            "path": str(db.path.resolve()),
            "schema_version": conn.execute("PRAGMA user_version").fetchone()[0],
            "journal_mode": conn.execute("PRAGMA journal_mode").fetchone()[0],
            "foreign_keys": bool(conn.execute("PRAGMA foreign_keys").fetchone()[0]),
            "integrity": conn.execute("PRAGMA integrity_check").fetchone()[0],
            "foreign_key_errors": len(conn.execute("PRAGMA foreign_key_check").fetchall()),
            "tables": [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")],
            "tags": {r[0]: r[1] for r in conn.execute("SELECT scope,count(*) FROM tag_definitions GROUP BY scope")},
        }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
