import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getConfig } from "../config";

let database: Database.Database | undefined;

export function getDatabase() {
  if (database) return database;
  const configured = getConfig().DATABASE_PATH;
  const absolutePath = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  database = new Database(absolutePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return database;
}

export function closeDatabase() {
  database?.close();
  database = undefined;
}
