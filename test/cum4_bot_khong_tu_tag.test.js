/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 4 — BOT KHÔNG BAO GIỜ LÀ THÀNH VIÊN NHÓM.
 *
 * Triệu chứng THẬT (Router đo trên DB thật 21/08/2026): chạy nguyên văn truy
 * vấn `dsNguoiTrongNhom` thì bot VẪN nằm trong danh sách:
 *     999200000000000002|Hảis Assistant   ← BOT
 *     9994000000000000004|Pham Quyet
 *     9991000000000000001|Trọng Nguyễn
 *     9993000000000000003|Minh Hải
 *
 * 🔴 VÌ SAO KHÔNG DỌN DỮ LIỆU MÀ SỬA TRUY VẤN:
 *    Hai bản vá đang đá nhau. Bản "lấp chữ bị mất" (20/08) CỐ Ý điền tên hiển
 *    thị của bot vào dòng `do_tro_ly_tao=1` để đọc lịch sử cho dễ; bản chống
 *    tự-tag lại muốn tên đó biến mất. Cả hai đều đúng ở chỗ của nó ⇒ xoá hôm
 *    nay thì mai bản kia điền lại. Luật phải nằm ở TẦNG ĐỌC.
 *
 * 🔴 VÌ SAO ĐÁNG SỬA: `dsNguoiTrongNhom` là nguồn tên cho `baoDamTag`. Bot còn
 *    trong đó ⇒ trợ lý có thể tự tag CHÍNH NÓ trong nhóm người thật ⇒ tự đánh
 *    thức chính nó ⇒ vòng lặp tự kích hoạt.
 *
 * ⛔ KHÔNG lọc theo `do_tro_ly_tao`: cột đó THUA CUỘC ĐUA 35,3% (18/51 dòng của
 *    bot mang cờ 0 vì listener ghi trước). Lọc theo UID.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import { ghiTin, upsertHoiThoai } from '../src/store/write.js';
import { dsNguoiTrongNhom, datUidTroLy, layUidTroLy } from '../src/store/query.js';
import { baoDamTag } from '../src/zalo/send.js';
import { registerTools } from '../src/mcp/tools.js';
import { thanHam } from './_cat_ma.js';

const NHOM = '9990000000001';
const BOT = '999200000000000002';
const QUYET = '9994000000000000004';
const TRONG = '9991000000000000001';
const HAI = '9993000000000000003';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

/**
 * Dựng lại ĐÚNG trạng thái DB thật hiện nay: bot có tin KÈM TÊN HIỂN THỊ, và
 * có cả dòng `do_tro_ly_tao=1` lẫn `do_tro_ly_tao=0` (cuộc đua listener).
 * Bài test dựng dữ liệu "sạch" sẽ xanh cả khi chưa vá gì — vô nghĩa.
 */
function dbTam({ uidBot = BOT } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum4-'));
  RAC.push(d);
  const db = moDb(path.join(d, 'kho', 'lichsu.db'));
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  const tin = (msgId, userId, ten, ts, tuyChon) => ghiTin(db, {
    chatId: NHOM, msgId, cliMsgId: null, userId, tenLucGui: ten,
    msgType: 'chat.text', noiDung: 'nói gì đó', contentRaw: null,
    tsZalo: ts, tuToi: false, coTagHost: false,
  }, tuyChon);
  tin('m-hai', HAI, 'Minh Hải', 1_700_000_000_000);
  tin('m-quyet', QUYET, 'Pham Quyet', 1_700_000_001_000);
  tin('m-trong', TRONG, 'Trọng Nguyễn', 1_700_000_002_000);
  // Bot: dòng do LISTENER ghi (thua cuộc đua -> cờ 0, CÒN NGUYÊN tên hiển thị)
  tin('m-bot-listener', uidBot, 'Hảis Assistant', 1_700_000_003_000);
  // Bot: dòng do chính trợ lý ghi, có tên (bản vá "lấp chữ bị mất" 20/08 điền)
  tin('m-bot-tuGui', uidBot, 'Hảis Assistant', 1_700_000_004_000, { doTroLyTao: true });
  return db;
}

const uids = (ds) => ds.map((n) => String(n.uid)).sort();

// ═══════════════════════════════════════════════════════════════════════
// 1. BIẾT uid bot -> bot BIẾN MẤT, ba người kia CÒN NGUYÊN
// ═══════════════════════════════════════════════════════════════════════

test('N1 🔴 biết uid bot -> dsNguoiTrongNhom KHÔNG chứa bot, vẫn đủ 3 người kia', () => {
  const db = dbTam();
  try {
    // Trước hết CHỨNG MINH dữ liệu đúng là ca hỏng: chưa biết uid thì bot có mặt.
    datUidTroLy(null);
    assert.ok(uids(dsNguoiTrongNhom(db, NHOM)).includes(BOT),
      'dữ liệu dựng sai — bài test này chỉ có nghĩa khi bot THỰC SỰ lọt vào');

    datUidTroLy(BOT);
    const ds = dsNguoiTrongNhom(db, NHOM);
    assert.deepEqual(uids(ds), [QUYET, TRONG, HAI].sort());
    assert.equal(ds.some((n) => String(n.uid) === BOT), false, 'bot vẫn còn trong danh sách');
    // Tên vẫn tra được bình thường cho người thật — không phải "lọc sạch cả mâm".
    assert.equal(ds.find((n) => String(n.uid) === TRONG)?.ten, 'Trọng Nguyễn');
  } finally { datUidTroLy(null); dongDb(db); }
});

test('N2 truyền uidTroLy thẳng vào tham số cũng lọc được (không cần nhớ trước)', () => {
  const db = dbTam();
  try {
    datUidTroLy(null);
    assert.equal(uids(dsNguoiTrongNhom(db, NHOM, BOT)).includes(BOT), false);
  } finally { dongDb(db); }
});

test('N3 tham số THẮNG giá trị đã nhớ', () => {
  const db = dbTam();
  try {
    datUidTroLy(TRONG);                     // nhớ nhầm người khác
    const ds = uids(dsNguoiTrongNhom(db, NHOM, BOT));
    assert.equal(ds.includes(BOT), false, 'tham số phải thắng');
    assert.equal(ds.includes(TRONG), true, 'người bị nhớ nhầm phải quay lại');
  } finally { datUidTroLy(null); dongDb(db); }
});

// ═══════════════════════════════════════════════════════════════════════
// 2. KHÔNG BIẾT uid -> hành xử NHƯ CŨ, ⛔ không lọc bừa ai
// ═══════════════════════════════════════════════════════════════════════

test('N4 🔴 không biết uid (null/"0"/rỗng) -> KHÔNG lọc ai, giữ nguyên hành vi cũ', () => {
  const db = dbTam();
  try {
    const daDu = [QUYET, TRONG, HAI, BOT].sort();
    for (const v of [null, undefined, '', '   ', '0', 0]) {
      datUidTroLy(v);
      assert.equal(layUidTroLy(), null, `"${String(v)}" phải là KHÔNG BIẾT`);
      assert.deepEqual(uids(dsNguoiTrongNhom(db, NHOM)), daDu,
        `với uid=${String(v)} thì không được lọc ai`);
      assert.deepEqual(uids(dsNguoiTrongNhom(db, NHOM, v)), daDu);
    }
  } finally { datUidTroLy(null); dongDb(db); }
});

test('N5 🔴 uid "0" của NGƯỜI THẬT không bị xoá oan', () => {
  // getOwnId() trả "0" là giá trị mồi lúc chưa đăng nhập xong. Nếu coi "0" là
  // uid bot rồi lọc, một người thật mang uid "0" sẽ biến mất khỏi nhóm —
  // im lặng, không log, và không ai hiểu vì sao không tag được người đó nữa.
  const db = dbTam({ uidBot: '0' });
  try {
    datUidTroLy('0');
    assert.equal(uids(dsNguoiTrongNhom(db, NHOM)).includes('0'), true,
      'uid "0" phải còn nguyên vì "0" nghĩa là KHÔNG BIẾT, không phải "là bot"');
  } finally { datUidTroLy(null); dongDb(db); }
});

// ═══════════════════════════════════════════════════════════════════════
// 3. baoDamTag — LỚP CHẶN THỨ HAI
// ═══════════════════════════════════════════════════════════════════════

test('N6 🔴 baoDamTag biết uid bot -> KHÔNG dựng mention cho chính nó', () => {
  const dsNguoi = [
    { uid: BOT, ten: 'Hảis Assistant' },     // cố tình CHƯA lọc ở tầng trên
    { uid: TRONG, ten: 'Trọng Nguyễn' },
  ];
  const kq = baoDamTag('chốt giúp địa điểm nhé', dsNguoi, [BOT, TRONG], BOT);
  assert.equal(kq.daThem.includes(BOT), false, 'không được tự tag mình');
  assert.equal(kq.khongTraRa.includes(BOT), false, 'từ chối chứ không phải "tra không ra"');
  assert.deepEqual(kq.daThem, [TRONG], 'người thật vẫn phải được tag');
  assert.equal(kq.text.includes('Hảis Assistant'), false);
  assert.ok(kq.text.startsWith('@Trọng Nguyễn '));
});

test('N7 baoDamTag KHÔNG biết uid bot -> hành xử như cũ', () => {
  const dsNguoi = [{ uid: BOT, ten: 'Hảis Assistant' }, { uid: TRONG, ten: 'Trọng Nguyễn' }];
  for (const v of [undefined, null, '', '0']) {
    const kq = baoDamTag('nội dung', dsNguoi, [BOT, TRONG], v);
    assert.deepEqual(kq.daThem.sort(), [BOT, TRONG].sort(),
      `uid=${String(v)} là KHÔNG BIẾT -> không được lọc ai`);
  }
});

test('N8 baoDamTag: bot đã được model tự tag sẵn thì cũng không tính là hợp lệ', () => {
  // `dungMentions` tra tên từ `dsNguoi`; bot đã bị gạt khỏi `dsNguoi` nên cụm
  // "@Hảis Assistant" model viết ra rơi vào `khongKhop` — CHỮ TRẦN, không phải
  // mention thật, nên không đánh thức được ai.
  const kq = baoDamTag('@Hảis Assistant xem hộ', [{ uid: BOT, ten: 'Hảis Assistant' }], [], BOT);
  assert.equal(kq.daCoSan.includes(BOT), false);
  assert.equal(kq.daThem.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. ĐƯỜNG KHÔNG CẦM `api` (bo_chay / index.js) — nhờ tầng nhớ
// ═══════════════════════════════════════════════════════════════════════

test('N9 🔴 registerTools ghi nhớ uid bot -> đường lời nhắc tự chạy cũng lọc được', () => {
  // `src/lich/bo_chay.js` gọi `dsNguoiTrongNhom(db, chatId)` với ĐÚNG 2 tham số
  // và không cầm `api`. Chỉ thêm tham số thì đường đó vẫn trả về bot — mà đó là
  // đường nguy hiểm nhất: lời nhắc tự chạy, không có người ngồi xem.
  const db = dbTam();
  try {
    datUidTroLy(null);
    const server = { setRequestHandler() {} };
    registerTools(server, {
      db,
      cauHinh: { cauTrungTinh: 'x', hosts: [], groups: [] },
      boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
      api: { getOwnId: () => BOT },
      docSucKhoe: () => ({ trangThai: 'OK' }),
    });
    assert.equal(layUidTroLy(), BOT, 'registerTools phải ghi nhớ uid bot');
    // Gọi ĐÚNG kiểu bo_chay gọi: 2 tham số, không truyền uid.
    assert.equal(uids(dsNguoiTrongNhom(db, NHOM)).includes(BOT), false);
  } finally { datUidTroLy(null); dongDb(db); }
});

test('N10 registerTools với getOwnId() = "0" -> KHÔNG nhớ bừa', () => {
  const db = dbTam();
  try {
    datUidTroLy(null);
    for (const v of ['0', null, undefined]) {
      registerTools({ setRequestHandler() {} }, {
        db,
        cauHinh: { cauTrungTinh: 'x', hosts: [], groups: [] },
        boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
        api: { getOwnId: () => v },
        docSucKhoe: () => ({ trangThai: 'OK' }),
      });
      assert.equal(layUidTroLy(), null, `getOwnId()=${String(v)} phải là KHÔNG BIẾT`);
    }
    // api ném lỗi cũng không được làm chết việc đăng ký tool.
    registerTools({ setRequestHandler() {} }, {
      db,
      cauHinh: { cauTrungTinh: 'x', hosts: [], groups: [] },
      boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
      api: { getOwnId() { throw new Error('chưa đăng nhập'); } },
      docSucKhoe: () => ({ trangThai: 'OK' }),
    });
    assert.equal(layUidTroLy(), null);
  } finally { datUidTroLy(null); dongDb(db); }
});

// ═══════════════════════════════════════════════════════════════════════
// 5. CHỐNG SÓT LẦN SAU — canh CẢ HỌ chỗ dùng danh sách người
// ═══════════════════════════════════════════════════════════════════════

test('N12 🔴 lọc bằng UID chứ không bằng cờ `do_tro_ly_tao` — bot chỉ có dòng cờ 0', () => {
  // Ca THẬT: 18/51 dòng của bot mang `do_tro_ly_tao = 0` vì listener ghi trước
  // (thua cuộc đua 35,3%). Ai "sửa" bằng cách thêm `AND do_tro_ly_tao = 0` vào
  // truy vấn sẽ để nguyên mấy dòng đó ⇒ bot vẫn lọt. Bài này dựng ca cực đoan:
  // TOÀN BỘ dòng của bot đều cờ 0.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum4b-'));
  RAC.push(d);
  const db = moDb(path.join(d, 'kho', 'lichsu.db'));
  try {
    upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
    for (const [msgId, uid, ten, ts] of [
      ['m-hai', HAI, 'Minh Hải', 1_700_000_000_000],
      ['m-bot-1', BOT, 'Hảis Assistant', 1_700_000_001_000],
      ['m-bot-2', BOT, 'Hảis Assistant', 1_700_000_002_000],
    ]) {
      ghiTin(db, {
        chatId: NHOM, msgId, cliMsgId: null, userId: uid, tenLucGui: ten,
        msgType: 'chat.text', noiDung: 'x', contentRaw: null,
        tsZalo: ts, tuToi: false, coTagHost: false,
      });   // KHÔNG truyền doTroLyTao -> cờ 0, đúng như listener ghi
    }
    const co1 = db.prepare('SELECT COUNT(*) c FROM tin_nhan WHERE user_id = ? AND do_tro_ly_tao = 1')
      .get(BOT).c;
    assert.equal(co1, 0, 'ca thử phải là: bot KHÔNG có dòng nào mang cờ 1');

    datUidTroLy(BOT);
    assert.equal(uids(dsNguoiTrongNhom(db, NHOM)).includes(BOT), false,
      'lọc theo cờ thì ca này thủng — phải lọc theo uid');
  } finally { datUidTroLy(null); dongDb(db); }
});

test('N13 truy vấn dsNguoiTrongNhom KHÔNG được dựa vào cờ `do_tro_ly_tao`', () => {
  // Chốt cứng ở mức MÃ NGUỒN, vì hành vi sai của cách-lọc-bằng-cờ chỉ lộ ra
  // trong đúng ca cuộc-đua — dễ "sửa" nhầm rồi thấy test vẫn xanh.
  const s = fs.readFileSync(new URL('../src/store/query.js', import.meta.url), 'utf8');
  // ⚠️ Bản cũ: `s.slice(i, s.indexOf('\\n}', i))` KHÔNG hề kiểm `i >= 0`. Đổi tên
  // hàm ⇒ i = -1 ⇒ cắt ra CHUỖI RỖNG ⇒ regex không khớp ⇒ bài test XANH VĨNH VIỄN
  // trong khi ⛔ không canh gì cả. `thanHam` NÉM khi mất neo.
  const than = thanHam(s, 'export function dsNguoiTrongNhom');
  assert.equal(/do_tro_ly_tao/.test(than), false,
    'dsNguoiTrongNhom dựa vào do_tro_ly_tao — cột đó thua cuộc đua 35,3%, phải lọc theo uid');
});

test('N11 mọi chỗ trong src/ đọc danh sách người đều đi qua dsNguoiTrongNhom', () => {
  // Nếu sau này ai viết truy vấn `ten_luc_gui` riêng để suy ra thành viên nhóm,
  // luật lọc bot ở đây không áp được cho nó. Bài này bắt đúng lúc đó, thay vì
  // chờ bot tự tag mình lần nữa trên hệ thật.
  const goc = new URL('../src/', import.meta.url);
  const nghiNgo = [];
  const duyet = (u) => {
    for (const e of fs.readdirSync(u, { withFileTypes: true })) {
      const con = new URL(e.name + (e.isDirectory() ? '/' : ''), u);
      if (e.isDirectory()) { duyet(con); continue; }
      if (!e.name.endsWith('.js')) continue;
      const s = fs.readFileSync(con, 'utf8');
      // Bỏ chú thích khỏi phép soi: chính file này bàn về `ten_luc_gui` rất nhiều.
      const ma = s.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      if (/GROUP BY\s+user_id/i.test(ma) && !con.pathname.endsWith('/store/query.js')) {
        nghiNgo.push(con.pathname.replace(goc.pathname, ''));
      }
    }
  };
  duyet(goc);
  assert.deepEqual(nghiNgo, [],
    `có chỗ tự suy danh sách thành viên ngoài dsNguoiTrongNhom -> phải lọc bot ở đó: ${nghiNgo.join(', ')}`);
});
