import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "../src/server/db/client";

const migrationsDir = path.join(process.cwd(), "src", "server", "db", "migrations");
const db = getDatabase();
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");

const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((row) => (row as { name: string }).name));
const migrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

for (const name of migrations) {
  if (applied.has(name)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
  const apply = db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
  });
  apply();
  console.log(`Applied ${name}`);
}

db.close();
