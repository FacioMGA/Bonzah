import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const violations: string[] = [];
async function visit(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith('.ts')) {
      const text = await readFile(path, 'utf8');
      if (
        /['"`](?:abbeygate|attsure|altus|bonzah|ue|vuw(?:\.ai)?|deefa|polarisre)['"`]/i.test(text)
      )
        violations.push(path + ': customer literal in shared module');
      if (/(?:from\s+|import\s*\()['"][^'"]*(?:fixtures|tenant-packages)/.test(text))
        violations.push(path + ': shared runtime depends on fixture/customer package');
    }
  }
}
for (const dir of ['src/application', 'src/contracts', 'src/domain', 'src/server', 'src/storage'])
  await visit(dir);
if (violations.length) throw new Error(violations.join('\n'));
console.log('Shared runtime has no known customer literals or fixture/package imports.');
