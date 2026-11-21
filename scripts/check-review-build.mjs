import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FREE_RULES_VERSION } from '../src/game/rules.ts';
import { execFileSync } from 'node:child_process';

const forbidden = /supabase\.co|sb_publishable_|__inubo|inubo:profile|inubo:outbox/;
function check(path) {
  for (const item of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, item.name);
    if (item.isDirectory()) check(full);
    else if (/\.(js|html|json)$/.test(item.name) && forbidden.test(readFileSync(full, 'utf8'))) throw new Error(`Production dependency in ${full}`);
  }
}
check('dist-review');
const info = JSON.parse(readFileSync('dist-review/review-info.json', 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (info.sourceCommit !== head || info.rulesVersion !== FREE_RULES_VERSION || info.stage !== 'interaction') throw new Error('Invalid review identity');
console.log('Review bundle: production dependencies absent; source identity verified.');
