#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ HOOK `Stop` — CHẶN KẾT THÚC LƯỢT KHI CÂU HỎI ZALO CHƯA ĐƯỢC GỬI ĐI.
 *
 * Cắm trong `.claude/settings.json` của repo. Đọc JSON của hook qua stdin,
 * in JSON quyết định ra stdout. Xem `src/ops/reply_guard.js` để biết vì sao
 * chốt này tồn tại (sự cố 22/08/2026: pane soạn xong câu trả lời rồi quên gọi
 * tool gửi, trong nhóm ⛔ không có gì xuất hiện).
 *
 * 🔴 HỎNG THÌ MỞ, ⛔ KHÔNG ĐÓNG. Mọi lỗi -> im lặng thoát 0 -> lượt kết thúc
 *    bình thường. Hook lỗi mà chặn nhầm là pane KẸT VĨNH VIỄN; bỏ sót một lượt
 *    còn có lưới vớt lo, chứ pane kẹt thì ⛔ không ai cứu.
 *
 * ⚠️ Chỉ chặn dòng của ĐÚNG hội thoại pane này phụ trách (`ZTL_CHAT_ID`, hoặc
 *    `ZTL_TUYEN` với pane router). ⛔ Không khai gì ⇒ ⛔ KHÔNG chặn: pane ⛔
 *    không biết mình phụ trách chỗ nào thì ⛔ không có quyền phán ai còn nợ ai.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { decideBlock, blockMessage } from '../src/ops/reply_guard.js';

const thoatIm = () => process.exit(0);

async function docStdin() {
  if (process.stdin.isTTY) return {};
  const mieng = [];
  for await (const m of process.stdin) mieng.push(m);
  const tho = Buffer.concat(mieng).toString('utf8').trim();
  if (!tho) return {};
  try { return JSON.parse(tho); } catch { return {}; }
}

/** Đường dẫn kho: ưu tiên ZTL_DATA_DIR, rồi config, cuối cùng là mặc định. */
function duongDanDb() {
  if (process.env.ZTL_DATA_DIR) return path.join(process.env.ZTL_DATA_DIR, 'lichsu.db');
  try {
    const f = process.env.ZTL_CONFIG || path.join(os.homedir(), '.zalo-tro-ly', 'assistant.config.json');
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    const d = String(c?.duongDan?.db ?? '');
    if (d) return d.startsWith('~') ? path.join(os.homedir(), d.slice(1)) : d;
  } catch { /* nuốt */ }
  return path.join(os.homedir(), '.zalo-tro-ly', 'lichsu.db');
}

async function main() {
  const vao = await docStdin();

  // Pane này phụ trách chỗ nào? ⛔ Không rõ thì ⛔ không chặn.
  const chat = (process.env.ZTL_CHAT_ID ?? '').trim() || (process.env.ZTL_TUYEN ?? '').trim();
  if (!chat) thoatIm();

  const db2 = duongDanDb();
  if (!fs.existsSync(db2)) thoatIm();

  let dong = [];
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(db2, { readOnly: true });
    dong = db.prepare(
      `SELECT request_id, ts_created, content, listen_only
         FROM ask_queue
        WHERE asking_chat_id = ? AND status IN ('da_day', 'dang_xu_ly')
        ORDER BY ts_created DESC LIMIT 5`,
    ).all(chat);
    db.close();
  } catch { thoatIm(); }

  const kq = decideBlock({ dong, stopHookActive: vao?.stop_hook_active === true });
  if (!kq) thoatIm();

  process.stdout.write(`${JSON.stringify({
    decision: 'block',
    reason: blockMessage(kq),
    systemMessage: `⛔ Chặn kết thúc lượt: còn ${kq.soCau} câu hỏi Zalo chưa được gửi trả lời.`,
  })}\n`);
  process.exit(0);
}

main().catch(() => thoatIm());
