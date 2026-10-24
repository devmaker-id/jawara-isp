import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('database schema config seed', () => {
  it('does not leave a trailing comma before the INSERT statement terminator', () => {
    const schemaPath = resolve(__dirname, '../schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    const configSeed = schema.match(/INSERT IGNORE INTO config[\s\S]*?;/)?.[0];

    expect(configSeed).toBeDefined();
    expect(configSeed).not.toMatch(/,\s*\);\s*$/);
  });
});
