import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
// ゲームが今使っている自由操作のルールの版（src/game/free-motion.ts の FREE_RULES_VERSION）と照らし合わせる。
const FREE_RULES_VERSION = /export const FREE_RULES_VERSION = '([^']+)'/.exec(readFileSync('src/game/free-motion.ts', 'utf8'))?.[1];
if (!FREE_RULES_VERSION) throw new Error('FREE_RULES_VERSION not found');
if (info.sourceCommit !== head || info.rulesVersion !== FREE_RULES_VERSION || info.stage !== 'interaction') throw new Error(`Invalid review identity: ${JSON.stringify(info)}`);
// 画面に出す版の情報（ビルドに埋め込む値）も review-info.json と同じであること。
const bundle = readdirSync('dist-review/assets').filter(f => f.endsWith('.js')).map(f => readFileSync(join('dist-review/assets', f), 'utf8')).join('\n');
if (!bundle.includes(info.sourceCommit) || !bundle.includes(JSON.stringify(info.buildId).slice(1, -1))) throw new Error('Review bundle does not embed the same source/build identity');
console.log(`Review bundle: production dependencies absent; source identity verified (${info.rulesVersion}, ${info.buildId}).`);
