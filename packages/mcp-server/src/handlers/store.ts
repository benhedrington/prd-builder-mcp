/**
 * File-backed PRD store.
 *
 * PRDs are persisted as individual JSON files in a directory (one file per PRD,
 * named `${prd.id}.json`). This survives process restarts and container
 * redeploys as long as the directory is on a persistent volume.
 *
 * Env vars:
 *   PRD_STORE_DIR  — directory for PRD JSON files (default: ./data/prds)
 *
 * On startup the directory is created (if missing) and all existing .json files
 * are loaded into an in-memory Map for fast reads. Writes go through to disk
 * synchronously (write-through cache) so a crash between save and flush can't
 * lose data. For the prototype's single-writer workload sync I/O is fine.
 *
 * Interface is identical to the old in-memory store — handlers don't change.
 */

import type { PRDDocument } from '@prd-builder/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STORE_DIR = resolve(process.env.PRD_STORE_DIR || './data/prds');

// Ensure the directory exists on module load (happens once at startup).
if (!existsSync(STORE_DIR)) {
  mkdirSync(STORE_DIR, { recursive: true });
  console.error(`[store] Created PRD store directory: ${STORE_DIR}`);
}

export class PRDStore {
  private prds = new Map<string, PRDDocument>();

  constructor() {
    this.loadFromDisk();
  }

  /** Load all *.json files from STORE_DIR into the in-memory map. */
  private loadFromDisk(): void {
    let count = 0;
    for (const file of readdirSync(STORE_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(STORE_DIR, file), 'utf-8');
        const prd = JSON.parse(raw) as PRDDocument;
        this.prds.set(prd.id, prd);
        count++;
      } catch (err) {
        console.error(`[store] Failed to load ${file}:`, err);
      }
    }
    if (count > 0) {
      console.error(`[store] Loaded ${count} PRD(s) from ${STORE_DIR}`);
    }
  }

  save(prd: PRDDocument): void {
    this.prds.set(prd.id, prd);
    // Write-through to disk
    const filePath = join(STORE_DIR, `${prd.id}.json`);
    writeFileSync(filePath, JSON.stringify(prd, null, 2), 'utf-8');
  }

  get(id: string): PRDDocument | undefined {
    return this.prds.get(id);
  }

  getAll(): PRDDocument[] {
    return Array.from(this.prds.values());
  }

  delete(id: string): boolean {
    const existed = this.prds.delete(id);
    if (existed) {
      const filePath = join(STORE_DIR, `${id}.json`);
      try {
        unlinkSync(filePath);
      } catch {
        // File may not exist if it was never written — not an error
      }
    }
    return existed;
  }

  exists(id: string): boolean {
    return this.prds.has(id);
  }
}

// Singleton instance — shared across all tool handlers
export const prdStore = new PRDStore();