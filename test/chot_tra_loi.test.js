/**
 * ═══════════════════════════════════════════════════════════════════════
 * CHỐT "PHẢI GỬI THẬT" (22/08/2026)
 *
 * 🔴 SỰ CỐ: 11:20 anh hỏi trong nhóm Haceco. Pane nhận được, SOẠN câu trả lời
 *    trong cửa sổ của nó, rồi kết thúc lượt mà ⛔ KHÔNG gọi tool gửi. Trong
 *    nhóm ⛔ không có gì xuất hiện. 11:22 chính pane đó thừa nhận: "em quên
 *    gọi gửi thật".
 *
 * 🔴 Bản luật ĐÃ dặn "chữ viết ra ⛔ không tới người nhắn, phải gọi tool" — và
 *    model vẫn quên, vì soạn xong CẢM GIÁC như đã xong việc. ⇒ Cần chốt CƠ
 *    HỌC, ⛔ không phải lời dặn kỹ hơn.
 *
 * 🔴 NHƯNG CHỐT NÀY NGUY HIỂM THEO CHIỀU NGƯỢC LẠI: chặn nhầm là pane KẸT
 *    VĨNH VIỄN. Vì vậy phần lớn bài dưới đây canh các đường THOÁT, ⛔ không
 *    phải đường chặn.
 *
 *     node --test test/chot_tra_loi.test.js
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { CUA_SO_MS, cauChan, quyetDinhChan } from '../src/ops/chot_tra_loi.js';
import { moDb, dongDb } from '../src/store/db.js';
import { taoHangDoi, capNhatHangDoi } from '../src/store/write.js';

const moi = (truMs = 5_000, them = {}) => ({
  request_id: 'r-moi',
  ts_tao: new Date(Date.now() - truMs).toISOString(),
  noi_dung: 'anh hỏi một câu',
  chi_nghe: 0,
  ...them,
});

// ═══════════════════════════════════════════════════════════════════════
// A · ĐƯỜNG CHẶN — đúng cái đã hỏng
// ═══════════════════════════════════════════════════════════════════════

test('A1 ★★★ còn lượt chưa gửi đi -> CHẶN kết thúc', () => {
  const kq = quyetDinhChan({ dong: [moi()] });
  assert.ok(kq, '🔴 ⛔ không chặn = dựng lại đúng lỗi 11:20 nhóm Haceco');
  assert.equal(kq.soCau, 1);
  assert.equal(kq.ds[0].requestId, 'r-moi');
});

test('A2 ★★ câu chặn phải nêu ĐÍCH DANH tool và request_id', () => {
  // Nhắc chung chung ("nhớ trả lời nhé") là mời model quên lần nữa.
  const s = cauChan(quyetDinhChan({ dong: [moi()] }));
  assert.match(s, /tra_loi/, 'phải nêu tên tool');
  assert.match(s, /r-moi/, 'phải nêu request_id');
  assert.match(s, /KHÔNG tới người nhắn/, 'phải nói vì sao viết ra là chưa đủ');
});

test('A3 ★ lượt CHỈ NGHE thì chỉ đường sang bo_qua, ⛔ không bắt trả lời', () => {
  const s = cauChan(quyetDinhChan({ dong: [moi(5_000, { chi_nghe: 1 })] }));
  assert.match(s, /bo_qua/);
  assert.match(s, /CHỈ NGHE/);
});

// ═══════════════════════════════════════════════════════════════════════
// B · ĐƯỜNG THOÁT — chặn nhầm còn tệ hơn bỏ sót
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★★★ `stop_hook_active` -> THÔI chặn (cửa thoát vòng lặp vô hạn)', () => {
  // Thiếu cửa này: hook chặn -> model chạy -> hook chặn -> … pane kẹt mãi mãi.
  assert.equal(quyetDinhChan({ dong: [moi()], stopHookActive: true }), null);
});

test('B2 ★★★ dòng CŨ hơn cửa sổ -> ⛔ KHÔNG chặn', () => {
  // Dòng cũ là của lượt trước — đã hết hạn hoặc đã có lưới vớt lo. Chặn ở đây
  // là chặn oan, mà chặn oan thì lần sau ⛔ không ai tin cái chốt này nữa.
  assert.equal(quyetDinhChan({ dong: [moi(CUA_SO_MS + 60_000)] }), null);
});

test('B3 ★ ⛔ không còn dòng nào -> cho đi tiếp', () => {
  assert.equal(quyetDinhChan({ dong: [] }), null);
  assert.equal(quyetDinhChan({}), null);
});

test('B4 ★★ mốc thời gian hỏng -> ⛔ KHÔNG chặn (hỏng thì MỞ)', () => {
  assert.equal(quyetDinhChan({ dong: [moi(0, { ts_tao: 'không-phải-ngày' })] }), null);
  assert.equal(quyetDinhChan({ dong: [moi(0, { ts_tao: null })] }), null);
});

test('B5 ★ mốc ở TƯƠNG LAI (lệch giờ máy) -> ⛔ không chặn', () => {
  assert.equal(quyetDinhChan({ dong: [moi(-60_000)] }), null);
});

// ═══════════════════════════════════════════════════════════════════════
// C · CHẠY THẬT cả file hook, qua stdin/stdout như Claude Code gọi
// ═══════════════════════════════════════════════════════════════════════

function moiTruong() {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-hook-'));
  const db = moDb(path.join(thuMuc, 'lichsu.db'));
  return { thuMuc, db };
}

function chayHook(thuMuc, chatId, vao = '{}') {
  return execFileSync(process.execPath, [path.join(process.cwd(), 'bin', 'hook-chua-tra-loi.js')], {
    input: vao,
    encoding: 'utf8',
    env: { ...process.env, ZTL_DATA_DIR: thuMuc, ZTL_CHAT_ID: chatId, ZTL_TUYEN: '' },
  });
}

test('C1 ★★★ ĐẦU-CUỐI: dòng `da_day` mới -> hook in JSON chặn', () => {
  const { thuMuc, db } = moiTruong();
  try {
    taoHangDoi(db, {
      requestId: 'e2e-1', chatIdHoi: '111', msgId: 'm1', userId: '900',
      noiDung: 'anh hỏi gì đó', tsTao: new Date().toISOString(),
    });
    capNhatHangDoi(db, 'e2e-1', 'da_day');
    dongDb(db);

    const ra = JSON.parse(chayHook(thuMuc, '111'));
    assert.equal(ra.decision, 'block');
    assert.match(ra.reason, /e2e-1/);
    assert.match(ra.systemMessage, /Chặn kết thúc lượt/);
  } finally { fs.rmSync(thuMuc, { recursive: true, force: true }); }
});

test('C2 ★★★ đã trả lời rồi -> hook im, lượt kết thúc bình thường', () => {
  const { thuMuc, db } = moiTruong();
  try {
    taoHangDoi(db, {
      requestId: 'e2e-2', chatIdHoi: '111', msgId: 'm2', userId: '900',
      noiDung: 'câu đã đáp', tsTao: new Date().toISOString(),
    });
    capNhatHangDoi(db, 'e2e-2', 'da_tra_loi');
    dongDb(db);

    assert.equal(chayHook(thuMuc, '111').trim(), '', '⛔ không được chặn khi đã trả lời');
  } finally { fs.rmSync(thuMuc, { recursive: true, force: true }); }
});

test('C3 ★★ dòng của NHÓM KHÁC ⛔ không chặn pane này', () => {
  const { thuMuc, db } = moiTruong();
  try {
    taoHangDoi(db, {
      requestId: 'e2e-3', chatIdHoi: '999', msgId: 'm3', userId: '900',
      noiDung: 'câu của nhóm khác', tsTao: new Date().toISOString(),
    });
    capNhatHangDoi(db, 'e2e-3', 'da_day');
    dongDb(db);

    assert.equal(chayHook(thuMuc, '111').trim(), '', 'pane chỉ chịu trách nhiệm chỗ của mình');
  } finally { fs.rmSync(thuMuc, { recursive: true, force: true }); }
});

test('C4 ★★★ HOOK PHẢI ĐƯỢC CẮM trong .claude/settings.json', () => {
  // Script đúng mà ⛔ không ai gọi thì tính năng ⛔ không tồn tại — đúng loại
  // lỗi "code đúng, dây không nối" đã mất cả buổi chiều 21/08.
  const st = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.claude', 'settings.json'), 'utf8'));
  const lenh = (st?.hooks?.Stop ?? []).flatMap((m) => m.hooks ?? []).map((h) => h.command).join(' ');
  assert.match(lenh, /hook-chua-tra-loi\.js/, '🔴 hook chưa được cắm vào settings');
});
