import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 단일 봇 프로세스용 영속 저장소. 쓰기 작업은 동기적으로 완료됩니다. */
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,id));');
  }
  get<T>(namespace: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT payload FROM records WHERE namespace=? AND id=?').get(namespace, id);
    return row ? JSON.parse(String(row.payload)) as T : undefined;
  }
  set<T>(namespace: string, id: string, value: T): void {
    this.db.prepare('INSERT INTO records(namespace,id,payload) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET payload=excluded.payload').run(namespace, id, JSON.stringify(value));
  }
  delete(namespace: string, id: string): void { this.db.prepare('DELETE FROM records WHERE namespace=? AND id=?').run(namespace, id); }
  list<T>(namespace: string): T[] { return this.db.prepare('SELECT payload FROM records WHERE namespace=?').all(namespace).map(row => JSON.parse(String(row.payload)) as T); }
  close(): void { this.db.close(); }
}
