import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExtensionManifest } from '../../../vite.config';

describe('extension manifest build input', () => {
  it('loads the manifest emitted to dist from the source manifest file', () => {
    const sourceManifest = readFileSync(
      resolve(process.cwd(), 'src/extension/manifest.json'),
      'utf8',
    );

    expect(loadExtensionManifest()).toBe(sourceManifest);
  });
});
