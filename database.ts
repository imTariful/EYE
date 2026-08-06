import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ScanSession } from './src/types';

const DEFAULT_DATABASE_PATH = path.join(process.cwd(), 'data', 'ocurisk.db');

let database: Database.Database | null = null;
let databasePath = DEFAULT_DATABASE_PATH;
let databaseError: string | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS scan_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_age INTEGER NOT NULL,
    spherical_equivalent REAL,
    overall_risk_percent INTEGER,
    risk_category TEXT,
    demo_mode INTEGER NOT NULL DEFAULT 0,
    session_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_scan_sessions_created_at
    ON scan_sessions(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_scan_sessions_patient_name
    ON scan_sessions(patient_name);
`;

function resolveDatabasePath(): string {
  const configuredPath = process.env.SQLITE_DB_PATH?.trim();
  return configuredPath ? path.resolve(configuredPath) : DEFAULT_DATABASE_PATH;
}

export function initializeDatabase(): void {
  if (database) return;

  databasePath = resolveDatabasePath();

  try {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    const connection = new Database(databasePath);
    connection.pragma('journal_mode = WAL');
    connection.pragma('foreign_keys = ON');
    connection.pragma('busy_timeout = 5000');
    connection.exec(SCHEMA_SQL);

    database = connection;
    databaseError = null;
    console.log(`OcuRisk SQLite database ready at ${databasePath}`);
  } catch (error) {
    database = null;
    databaseError = error instanceof Error ? error.message : String(error);
    console.error(`OcuRisk SQLite database initialization failed: ${databaseError}`);
  }
}

function requireDatabase(): Database.Database {
  if (!database) initializeDatabase();
  if (!database) {
    throw new Error(databaseError || 'SQLite database is unavailable.');
  }
  return database;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function saveScanSession(session: ScanSession): void {
  const connection = requireDatabase();
  const now = new Date().toISOString();

  connection.prepare(`
    INSERT INTO scan_sessions (
      id,
      created_at,
      updated_at,
      patient_name,
      patient_age,
      spherical_equivalent,
      overall_risk_percent,
      risk_category,
      demo_mode,
      session_json,
      schema_version
    ) VALUES (
      @id,
      @createdAt,
      @updatedAt,
      @patientName,
      @patientAge,
      @sphericalEquivalent,
      @overallRiskPercent,
      @riskCategory,
      @demoMode,
      @sessionJson,
      1
    )
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      patient_name = excluded.patient_name,
      patient_age = excluded.patient_age,
      spherical_equivalent = excluded.spherical_equivalent,
      overall_risk_percent = excluded.overall_risk_percent,
      risk_category = excluded.risk_category,
      demo_mode = excluded.demo_mode,
      session_json = excluded.session_json,
      schema_version = excluded.schema_version
  `).run({
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: now,
    patientName: session.patient.patientName,
    patientAge: session.patient.age,
    sphericalEquivalent: finiteNumberOrNull(session.photorefraction.sphericalEquivalentDiopters),
    overallRiskPercent: finiteNumberOrNull(session.riskResult.overallRiskPercent),
    riskCategory: session.riskResult.riskCategory,
    demoMode: session.demoMode ? 1 : 0,
    sessionJson: JSON.stringify(session),
  });
}

export function listScanSessions(limit = 100): ScanSession[] {
  const connection = requireDatabase();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
  const rows = connection
    .prepare('SELECT session_json FROM scan_sessions ORDER BY created_at DESC LIMIT ?')
    .all(safeLimit) as Array<{ session_json: string }>;

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.session_json) as ScanSession];
    } catch (error) {
      console.warn('Skipping malformed SQLite scan session:', error);
      return [];
    }
  });
}

export function getScanSession(id: string): ScanSession | null {
  const connection = requireDatabase();
  const row = connection
    .prepare('SELECT session_json FROM scan_sessions WHERE id = ?')
    .get(id) as { session_json: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.session_json) as ScanSession;
}

export function deleteScanSession(id: string): boolean {
  const result = requireDatabase().prepare('DELETE FROM scan_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function clearScanSessions(): number {
  const result = requireDatabase().prepare('DELETE FROM scan_sessions').run();
  return result.changes;
}

export function getDatabaseStatus() {
  let sessionCount = 0;

  if (database) {
    const row = database.prepare('SELECT COUNT(*) AS count FROM scan_sessions').get() as { count: number };
    sessionCount = row.count;
  }

  return {
    connected: database !== null,
    databasePath,
    journalMode: database ? String(database.pragma('journal_mode', { simple: true })) : null,
    sessionCount,
    error: databaseError,
  };
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = null;
  }
}
