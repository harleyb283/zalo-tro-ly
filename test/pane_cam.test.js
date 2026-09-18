/**
 * ═══════════════════════════════════════════════════════════════════════
 * LƯỚI PHÁT HIỆN PANE CÂM — ca thật 18/09/2026.
 *
 * 🔴 HÌNH DẠNG CỦA CA HỎNG, viết lại cho rõ vì nó rất dễ bị nhầm với ca khác:
 *    Zalo THÔNG. Daemon SỐNG. Client SỐNG và vẫn đẩy được (dòng chuyển
 *    `da_day`). Chỉ có phiên Claude là ⛔ không nhận được gì, vì pane mở thiếu
 *    cờ dev-channel. ⛔ KHÔNG một lỗi nào nổ ra.
 *
 * ⇒ Mọi lưới cũ đều mù ở đây: watchdog soi websocket (vẫn tốt), lưới vớt thì
 *   đẩy lại vào đúng cái phiên đang điếc, `claimedButUnsent` soi đường GỬI RA.
 *
 * 🔴 BÀI NÀY PHẢI HỎI: *"thứ này có TỚI ĐƯỢC MẮT ANH không?"* — tức là có một
 *    lời nhắn ĐI RA, qua đường KHÁC với đường đang hỏng. Một bài chỉ khẳng
 *    định "hàm đếm đúng 3 dòng" là bài GIẢ: nó xanh y hệt cả khi ⛔ không ai
 *    được báo, mà im lặng chính là toàn bộ vấn đề.
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { closeDb, openDb } from '../src/store/db.js';
import { upsertConversation, enqueueQuestion, updateQueueState } from '../src/store/write.js';
import {
  dongDayMaKhongAiTraLoi, createMuteWatcher, NGUONG_CAM_MS,
} from '../src/ops/pane_cam.js';

const CHAT = '9990000000001';
const HOST = '555000111';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cam-'));
  RAC.push(d);
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: CHAT, loai: 'DM', ten: 'DM host', duocNghe: true });
  return db;
}

/** Ghi một câu hỏi rồi ép `ts_created` lùi về quá khứ `tuoiMs`. */
function hoiCu(db, rid, noiDung, tuoiMs, trangThai = 'da_day') {
  enqueueQuestion(db, {
    requestId: rid, chatIdHoi: CHAT, msgId: `m-${rid}`, userId: HOST,
    noiDung, tsTao: new Date(Date.now() - tuoiMs).toISOString(),
  });
  if (trangThai !== 'cho') updateQueueState(db, rid, trangThai);
}

// ═══════════════════════════════════════════════════════════════════════

test('A1 ★★★ tin ĐÃ ĐẨY mà quá lâu không ai trả lời -> bị phát hiện', () => {
  const db = dbTam();
  hoiCu(db, 'r1', 'Sửa xong chưa', NGUONG_CAM_MS + 60_000);
  hoiCu(db, 'r2', 'alo', NGUONG_CAM_MS + 30_000);

  const kq = dongDayMaKhongAiTraLoi(db);
  assert.equal(kq.so, 2);
  assert.equal(kq.viDu, 'Sửa xong chưa', 'phải nêu câu CŨ NHẤT để anh nhận ra ngay');
  assert.ok(kq.cuNhatMs >= NGUONG_CAM_MS);
  closeDb(db);
});

test('A2 ★★★ tin VỪA đẩy thì KHÔNG báo (chống báo động giả khi model đang nghĩ)', () => {
  const db = dbTam();
  hoiCu(db, 'r1', 'câu vừa hỏi', 5_000);
  assert.equal(dongDayMaKhongAiTraLoi(db).so, 0,
    'một lượt model đo thật 10–76 giây — báo ngay là mỗi lượt bình thường đều thành báo động');
  closeDb(db);
});

test('A3 ★★ dòng `cho` KHÔNG tính: chưa ai nhận ⛔ khác đã nhận rồi biến mất', () => {
  const db = dbTam();
  hoiCu(db, 'r1', 'chưa ai nhận', NGUONG_CAM_MS + 60_000, 'cho');
  assert.equal(dongDayMaKhongAiTraLoi(db).so, 0);
  closeDb(db);
});

test('A4 ★★ đã trả lời rồi thì thôi (đối chứng — nếu không, A1 vô nghĩa)', () => {
  const db = dbTam();
  hoiCu(db, 'r1', 'đã đáp', NGUONG_CAM_MS + 60_000, 'da_tra_loi');
  assert.equal(dongDayMaKhongAiTraLoi(db).so, 0);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// B. THỨ ĐI TỚI MẮT ANH — phần quan trọng nhất của file này
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★★★ CÓ MỘT LỜI NHẮN ĐI RA, và nó CHỈ ĐÚNG cách sửa', () => {
  const db = dbTam();
  const daBao = [];
  const soi = createMuteWatcher((s) => daBao.push(s));

  hoiCu(db, 'r1', 'Sửa xong chưa', NGUONG_CAM_MS + 60_000);
  soi(db);

  assert.equal(daBao.length, 1, '🔴 phát hiện mà ⛔ không báo thì đúng bằng ⛔ không phát hiện');
  assert.match(daBao[0], /CÂM/);
  assert.match(daBao[0], /Sửa xong chưa/, 'phải dẫn câu thật để anh biết mình đã hỏi gì');
  assert.match(daBao[0], /dangerously-load-development-channels/,
    'phải chỉ ĐÚNG nguyên nhân thường gặp — báo "có gì đó hỏng" thì anh vẫn phải tự mò');
  closeDb(db);
});

test('B2 ★★★ báo ĐÚNG MỘT LẦN cho mỗi đợt, ⛔ không spam mỗi nhịp', () => {
  const db = dbTam();
  const daBao = [];
  const soi = createMuteWatcher((s) => daBao.push(s));

  hoiCu(db, 'r1', 'câu treo', NGUONG_CAM_MS + 60_000);
  for (let i = 0; i < 10; i += 1) soi(db);

  assert.equal(daBao.length, 1,
    'nhịp 60 giây mà báo mỗi nhịp là 60 tin/giờ vào DM của anh — cảnh báo thành rác thì bị tắt');
  closeDb(db);
});

test('B3 ★★★ HỒI PHỤC cũng phải báo — im lặng khoẻ lại vẫn là nói dối', () => {
  const db = dbTam();
  const daBao = [];
  const soi = createMuteWatcher((s) => daBao.push(s));

  hoiCu(db, 'r1', 'câu treo', NGUONG_CAM_MS + 60_000);
  soi(db);
  assert.equal(daBao.length, 1);

  updateQueueState(db, 'r1', 'da_tra_loi');   // pane mở lại đúng cách, việc được xử
  soi(db);
  assert.equal(daBao.length, 2);
  assert.match(daBao[1], /thông lại/, 'anh phải biết là hết hỏng, kẻo đi khởi động lại pane vô ích');

  // Và đợt mới thì lại được báo — ⛔ không bị khoá vĩnh viễn sau lần đầu.
  hoiCu(db, 'r2', 'câu treo lần hai', NGUONG_CAM_MS + 60_000);
  soi(db);
  assert.equal(daBao.length, 3);
  closeDb(db);
});

test('B4 ★★ DB hỏng thì lưới IM, ⛔ không tự biến thành nguồn lỗi mới', () => {
  const daBao = [];
  const soi = createMuteWatcher((s) => daBao.push(s));
  const dbHong = { prepare() { throw new Error('DB đóng rồi'); } };

  assert.doesNotThrow(() => soi(dbHong));
  assert.deepEqual(daBao, [], 'lưới an toàn mà ném lỗi thì nó kéo sập chính thứ nó canh');
});
