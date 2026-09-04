import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export { Database as SqliteDatabase };

/**
 * Inicializa a conexão com o SQLite e aplica a estrutura das tabelas.
 * A persistência é organizada em duas tabelas principais:
 *
 * 1. orders: armazena os dados e o status de cada pedido. O valor cobrado é sempre
 *    consultado a partir do registro interno, e a transição para 'paid' exige que o
 *    pedido esteja em estado pendente, garantindo proteção contra alterações indevidas.
 *
 * 2. processed_events: registra os identificadores de eventos já processados (event_id).
 *    A restrição de chave primária atua como barreira de idempotência, bloqueando o
 *    reprocessamento de eventos duplicados antes da execução de qualquer regra de negócio.
 */
export function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      description   TEXT NOT NULL,
      amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
      currency      TEXT NOT NULL DEFAULT 'brl',
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
      payment_intent_id TEXT,
      processed_events_count INTEGER NOT NULL DEFAULT 0,
      paid_at       TEXT,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      event_id     TEXT PRIMARY KEY,
      event_type   TEXT NOT NULL,
      received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  return db;
}
