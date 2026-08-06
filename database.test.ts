import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ScanSession } from './src/types';
import {
  closeDatabase,
  deleteScanSession,
  getDatabaseStatus,
  getScanSession,
  initializeDatabase,
  listScanSessions,
  saveScanSession,
} from './database';

let temporaryDirectory = '';

const testSession = {
  id: 'sqlite-test-session',
  createdAt: '2026-08-06T12:00:00.000Z',
  patient: {
    patientName: 'SQLite Test',
    age: 10,
  },
  photorefraction: {
    sphericalEquivalentDiopters: -2.5,
  },
  accommodative: {
    npcCm: 8,
    accommodativeLagDiopters: 0.75,
  },
  microsaccade: {
    bceaDeg2: 0.5,
  },
  riskResult: {
    overallRiskPercent: 50,
    riskCategory: 'ELEVATED',
  },
  demoMode: true,
} as ScanSession;

beforeAll(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocurisk-sqlite-test-'));
  process.env.SQLITE_DB_PATH = path.join(temporaryDirectory, 'test.db');
  initializeDatabase();
});

afterAll(() => {
  closeDatabase();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('SQLite scan persistence', () => {
  test('creates the database with WAL enabled', () => {
    const status = getDatabaseStatus();
    expect(status.connected).toBe(true);
    expect(status.journalMode.toLowerCase()).toBe('wal');
    expect(fs.existsSync(status.databasePath)).toBe(true);
  });

  test('saves, reads, lists, updates, and deletes a completed session', () => {
    saveScanSession(testSession);

    expect(getScanSession(testSession.id)?.patient.patientName).toBe('SQLite Test');
    expect(listScanSessions().some((session) => session.id === testSession.id)).toBe(true);

    saveScanSession({
      ...testSession,
      riskResult: { ...testSession.riskResult, overallRiskPercent: 65 },
    });
    expect(getScanSession(testSession.id)?.riskResult.overallRiskPercent).toBe(65);

    expect(deleteScanSession(testSession.id)).toBe(true);
    expect(getScanSession(testSession.id)).toBeNull();
  });
});
