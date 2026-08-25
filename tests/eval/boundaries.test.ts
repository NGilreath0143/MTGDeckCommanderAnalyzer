import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Architectural guard: src/eval/ is developer-only tooling and must never be
 * reachable from a production request path.
 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const PRODUCTION_DIRS = ['src/app', 'src/pipeline', 'src/infra', 'src/domain'];

describe('src/eval boundary', () => {
  it('is never imported by production code', () => {
    const offenders: string[] = [];
    for (const dir of PRODUCTION_DIRS) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, 'utf8');
        if (/from\s+['"](@\/eval\/|\.\.?\/eval\/)/.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the domain layer free of infra and eval imports', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/domain')) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"]@\/(infra|eval|app|pipeline)\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    'src/domain/roles.ts',
    'src/domain/tags.ts',
    'src/domain/cardText.ts',
    'src/domain/strategy.ts',
    'src/domain/archetypes.ts',
    'src/domain/powerCards.ts',
    'src/domain/knownCombos.ts',
    'src/domain/manaBase.ts',
    'src/domain/powerEvidence.ts',
    'src/domain/tutorRelevance.ts',
    'src/domain/speed.ts',
    'src/domain/consistency.ts',
  ])(
    'keeps %s depending only on other domain modules',
    (file) => {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/|^@\/domain\//);
      }
    },
  );
});
