import type { Database as SqliteDatabase } from 'better-sqlite3';

declare global {
  namespace Express {
    interface Locals {
      db: SqliteDatabase;
      webhookSecret: string;
      publishableKey: string;
      idFactory: () => string;
    }
  }
}

export interface OrderRow {
  id: string;
  description: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed';
  payment_intent_id: string | null;
  processed_events_count: number;
  paid_at: string | null;
  created_at: string;
}
