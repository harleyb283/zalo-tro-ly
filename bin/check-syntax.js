#!/usr/bin/env node
/**
 * G0 — chạy `node --check` trên MỌI file .js của pack.
 * Dùng: npm run check
 *
 * Có script này để 7 gói sau tự nghiệm thu ngay mà không phải nhớ lệnh find.
 * Script chạy tay ⇒ ĐƯỢC in stdout.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BO_QUA = new Set(['node_modules', '.git', 'data']);

function quet(thuMuc) {
  /** @type {string[]} */
  const ra = [];
  for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
    if (BO_QUA.has(m.name)) continue;
    const p = path.join(thuMuc, m.name);
    if (m.isDirectory()) ra.push(...quet(p));
    else if (m.name.endsWith('.js')) ra.push(p);
  }
  return ra;
}

const files = quet(GOC).sort();
let hong = 0;
for (const f of files) {
  const ten = path.relative(GOC, f);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    process.stdout.write(`  PASS  ${ten}\n`);
  } catch (e) {
    hong += 1;
    process.stdout.write(`  FAIL  ${ten}\n${e.stderr?.toString() ?? ''}\n`);
  }
}
process.stdout.write(`\n${files.length - hong}/${files.length} file PASS node --check\n`);
process.exitCode = hong === 0 ? 0 : 1;
