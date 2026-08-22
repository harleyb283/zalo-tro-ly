/**
 * ═══════════════════════════════════════════════════════════════════════
 * NỐI DÂY TREO — `index.js` phải THẬT SỰ nạp đạn cho lá chắn B5.
 *
 * 🔴 VÌ SAO CẦN FILE RIÊNG: `test/cum5_don.test.js` đã canh rất kỹ HÀNH VI của
 *    `chayNhipTheoDuoi` khi CÓ và KHÔNG có `recordSources` — nhưng nó tự tay
 *    truyền closure vào. Cả bộ đó vẫn XANH 100% trong khi `index.js` không
 *    truyền gì cả, tức đường THẬT đang chạy ở thế fail-closed: không rò, nhưng
 *    lời nhắc mất giọng model đúng những ca chạm nhóm khác.
 *    ⇒ Đây là chỗ chỉ có "test đường dây" mới bắt được: nối phía PHÁT
 *      (`index.js`) với phía NHẬN (`bo_chay.js`), không kiểm mỗi một đầu.
 *
 * 🔴 Khối wiring nằm trong `main()` của `index.js`, chỉ chạy SAU khi đăng nhập
 *    Zalo thật — thứ pack này CẤM thử. `node --check` không với tới. Nên:
 *      · closure sản xuất được LÔI RA thành `noiGhiNhanNguon()` để nạp THẬT mà chạy
 *      · chỗ gọi trong `main()` thì canh bằng đọc mã nguồn
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { noiGhiNhanNguon } from '../src/index.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';
import { chotLich } from '../src/lich/lich_hen.js';
import { taoNhacTheoDuoi } from '../src/lich/theo_duoi.js';
import { HUONG_TRA_LOI } from '../src/lib/hang_so.js';
import { getSources, decideReplyRoute, createSourceLedger } from '../src/policy/leak_guard.js';
import { dongDb, moDb } from '../src/store/db.js';
import { ghiTin, taoHangDoi, upsertHoiThoai } from '../src/store/write.js';

const SRC_INDEX = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

const NHOM = '9990000000001';
const NHOM_KHAC = '111222333444';
const HOST = '555000111';
const TRONG = '9991000000000000001';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-noiday-'));
  RAC.push(d);
  const db = moDb(path.join(d, 'kho', 'lichsu.db'));
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm A', duocNghe: true });
  upsertHoiThoai(db, { chatId: NHOM_KHAC, loai: 'GROUP', ten: 'Nhóm B', duocNghe: true });
  ghiTin(db, {
    chatId: NHOM, msgId: 'm-trong', cliMsgId: null, userId: TRONG, tenLucGui: 'Trọng Nguyễn',
    msgType: 'chat.text', noiDung: 'ừ', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, coTagHost: false,
  });
  return db;
}

function nhacDaChot(db) {
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: TRONG, ma: 'NHAC',
  });
  chotLich(db, { id: 'NHAC', ma: 'NHAC', nguoiDat: HOST });
  const d = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get('NHAC');
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE id = ?').run(d.id);
  return d;
}

/** Bối cảnh CHẠM NHÓM KHÁC — ca "ai đó nới bối cảnh" mà B5 sinh ra để chặn. */
const chamNhomKhac = () => ({
  rows: [{ chat_id: NHOM_KHAC, user_id: TRONG, noi_dung: 'chuyện của nhóm B', ts_zalo: 1 }],
  nguonChatIds: [NHOM_KHAC],
});

/** Bối cảnh SẠCH — chỉ chạm đúng nhóm đích. */
const chiNhomMinh = () => ({
  rows: [{ chat_id: NHOM, user_id: TRONG, noi_dung: 'ừ', ts_zalo: 1 }],
  nguonChatIds: [NHOM],
});

/** Dựng tham số y như `index.js` dựng, chỉ thay phần chạm mạng bằng hàm giả. */
function chayNhuIndexJs(db, boTichLuy, truyVanLichSu, thu) {
  return chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi, truyVanLichSu,
    dsNguoiTrongNhom: () => [],
    guiVaoNhom: async (_a, _c, t) => { thu.daGuiThangVaoNhom.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    guiThongBao: async () => { thu.giaoModel += 1; return true; },
    // ★★★ ĐÂY LÀ THỨ ĐANG ĐƯỢC CANH: closure SẢN XUẤT, nạp thật từ `index.js`.
    recordSources: noiGhiNhanNguon(boTichLuy),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// N1-N2 — đường dây có tồn tại không
// ═══════════════════════════════════════════════════════════════════════

test('N1 ★ index.js export `noiGhiNhanNguon` và nó nhận ĐÚNG 2 đối số như bo_chay gọi', () => {
  // `bo_chay.js` gọi `p.recordSources(requestId, nguonChatIds)` — HAI đối số.
  // `leak_guard.recordSources()` cần BA (`boTichLuy` đứng trước). Quên `boTichLuy`
  // là lỗi ném ra, `bo_chay` nuốt vào catch, lời nhắc lặng lẽ rơi xuống câu dự
  // phòng — không có dấu hiệu nào ngoài log.
  assert.equal(typeof noiGhiNhanNguon, 'function', 'index.js không còn export noiGhiNhanNguon');
  const bo = createSourceLedger();
  const f = noiGhiNhanNguon(bo);
  assert.equal(typeof f, 'function');
  assert.equal(f.length, 2, 'closure phải nhận đúng (requestId, nguonChatIds)');

  f('r1', ['A', 'B']);
  assert.deepEqual(getSources(bo, 'r1').sort(), ['A', 'B'],
    'gọi bằng 2 đối số mà sổ nguồn vẫn rỗng -> boTichLuy chưa được đóng vào closure');
});

test('N2 ★★★ `main()` THẬT SỰ truyền closure đó vào chayNhipTheoDuoi', () => {
  // Bài N1/N3/N4 chạy trên closure lôi ra ngoài; nếu `main()` quên gọi nó thì cả
  // ba vẫn xanh mà đường thật vẫn chết. Chỗ gọi nằm trong `main()` (phải đăng
  // nhập Zalo mới chạy tới) nên canh bằng đọc mã nguồn — đây là cách DUY NHẤT.
  const i = SRC_INDEX.indexOf('chayNhipTheoDuoi({');
  assert.ok(i > 0, 'không tìm thấy chỗ gọi chayNhipTheoDuoi trong index.js');
  const khoiGoi = SRC_INDEX.slice(i, i + 1600);
  assert.match(khoiGoi, /recordSources:\s*noiGhiNhanNguon\(boTichLuy\)/,
    'index.js KHÔNG truyền recordSources -> bo_chay fail-closed, lời nhắc mất giọng model '
    + 'đúng những ca bối cảnh chạm nhóm khác');
  assert.match(SRC_INDEX, /import \{[^}]*\brecordSources\b[^}]*\} from '\.\/policy\/leak_guard\.js'/,
    'thiếu import thì ESM ném ngay lúc nạp module');
});

test('N3 ★★ MỘT sổ nguồn duy nhất: dangKyTool và bo_chay dùng CHUNG `boTichLuy`', () => {
  // Bẫy tinh vi nhất: dựng hai `createSourceLedger()` khác nhau. `mcp/tools.js` tra
  // một sổ, `bo_chay` ghi vào sổ kia -> `leak_guard` thấy nguồn = ∅ và cho gửi
  // thẳng vào nhóm. Đúng ca lá chắn sinh ra để chặn, mà lại im lặng.
  const soLanDung = (SRC_INDEX.match(/createSourceLedger\(\)/g) ?? []).length;
  assert.equal(soLanDung, 1, `index.js dựng ${soLanDung} bộ tích luỹ — phải đúng MỘT`);
  assert.match(SRC_INDEX, /\n\s*boTichLuy,\n/, 'dangKyTool không còn nhận boTichLuy');
});

// ═══════════════════════════════════════════════════════════════════════
// N4-N5 — HAI CHIỀU. Chỉ chiều thuận là vô nghĩa.
// ═══════════════════════════════════════════════════════════════════════

test('N4 ★★★ CHIỀU (a) bối cảnh SẠCH -> VẪN giao model + leak_guard cho gửi vào nhóm', async () => {
  // Chống vá quá tay: nối dây xong mà chặn nhầm cả ca sạch thì lời nhắc mất
  // giọng model vĩnh viễn — hỏng đúng thứ bản vá này sinh ra để cứu.
  const db = dbTam();
  nhacDaChot(db);
  const bo = createSourceLedger();
  const thu = { giaoModel: 0, daGuiThangVaoNhom: [] };

  const ra = await chayNhuIndexJs(db, bo, chiNhomMinh, thu);

  assert.equal(thu.giaoModel, 1, 'bối cảnh sạch mà không giao model -> vá quá tay');
  assert.equal(ra.giaoModel, 1);
  assert.equal(ra.duPhong, 0, 'không được rơi xuống câu dự phòng khi bối cảnh sạch');

  const rid = db.prepare('SELECT request_id FROM hang_doi_hoi LIMIT 1').get().request_id;
  const qd = decideReplyRoute({
    requestId: rid, chatIdHoi: NHOM, nguon: getSources(bo, rid), tonTaiHangDoi: true,
  });
  assert.notEqual(qd.huong, HUONG_TRA_LOI.DM_HOST,
    'bối cảnh chỉ trong nhóm mình mà vẫn bị đẩy sang DM host -> lá chắn bắt oan');
  assert.deepEqual(qd.nguonLa ?? [], []);
  dongDb(db);
});

test('N5 ★★★ CHIỀU (b) bối cảnh chạm nhóm LẠ -> leak_guard BẬT, KHÔNG gửi thẳng vào nhóm', async () => {
  const db = dbTam();
  nhacDaChot(db);
  const bo = createSourceLedger();
  const thu = { giaoModel: 0, daGuiThangVaoNhom: [] };

  const ra = await chayNhuIndexJs(db, bo, chamNhomKhac, thu);

  // Đã nối dây nên KHÔNG còn fail-closed: model vẫn được giao việc viết câu...
  assert.equal(thu.giaoModel, 1,
    'nối dây rồi mà vẫn rơi xuống câu dự phòng -> closure chưa tới được bo_chay');
  assert.equal(ra.duPhong, 0);

  // ...nhưng đáp án của nó KHÔNG được đi thẳng vào nhóm.
  const rid = db.prepare('SELECT request_id FROM hang_doi_hoi LIMIT 1').get().request_id;
  const nguon = getSources(bo, rid);
  assert.ok(nguon.includes(NHOM_KHAC),
    `sổ nguồn là [${nguon}] — thiếu nhóm B thì leak_guard tưởng đáp án sạch`);

  const qd = decideReplyRoute({
    requestId: rid, chatIdHoi: NHOM, nguon, tonTaiHangDoi: true,
  });
  assert.equal(qd.huong, HUONG_TRA_LOI.DM_HOST,
    'đáp án mang dữ liệu nhóm B mà vẫn gửi thẳng vào nhóm A -> đúng ca lá chắn phải chặn');
  assert.deepEqual(qd.nguonLa, [NHOM_KHAC]);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// N7-N8 — DÂY TREO THỨ HAI, tìm thấy khi rà `p.*`
// ═══════════════════════════════════════════════════════════════════════

test('N7 ★★★ HẾT LƯỢT phải DM được host — `dmHostChatId` có tới bo_chay không', async () => {
  // `_baoHetLuot()` chỉ được gọi từ CHÍNH `chayNhipTheoDuoi`, và nó cần
  // `p.dmHostChatId`. Thiếu ⇒ lời nhắc tiêu đủ trần rồi TỰ ĐÓNG trong im lặng,
  // host tưởng việc đã xong. Không có ngoại lệ nào ở đây: đã tự đóng thì BẮT
  // BUỘC phải có người được báo.
  const db = dbTam();
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'việc sắp hết lượt',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: TRONG, ma: 'HET', tranSoLan: 1,
  });
  chotLich(db, { id: 'HET', ma: 'HET', nguoiDat: HOST });
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE ma_xac_nhan = ?').run('HET');

  const dm = [];
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi, truyVanLichSu: chiNhomMinh,
    dsNguoiTrongNhom: () => [],
    guiVaoNhom: async () => ({ msgId: 'x' }),
    guiDmHost: async (_a, chatId, t) => { dm.push({ chatId, t }); return { msgId: 'y' }; },
    guiThongBao: async () => true,
    recordSources: noiGhiNhanNguon(createSourceLedger()),
    dmHostChatId: HOST,          // ★ thứ index.js trước đây KHÔNG truyền
  });
  await new Promise((r) => setTimeout(r, 20));   // _baoHetLuot chạy nền, không chặn vòng nhắc

  assert.equal(dm.length, 1, 'lời nhắc tự đóng vì HẾT LƯỢT mà host không được báo -> im lặng tắt');
  assert.equal(dm[0].chatId, HOST);
  assert.match(dm[0].t, /HẾT LƯỢT/, 'câu báo phải nói rõ dừng vì hết lượt, KHÔNG phải vì xong việc');
  dongDb(db);
});

test('N8 ★★ index.js truyền `dmHostChatId` cho CẢ HAI bộ chạy, không chỉ lịch một lần', () => {
  const i = SRC_INDEX.indexOf('chayNhipTheoDuoi({');
  const khoiGoi = SRC_INDEX.slice(i, i + 2600);
  assert.match(khoiGoi, /dmHostChatId:\s*dmHostChinh\(cauHinh\)/,
    'chayNhipTheoDuoi vẫn thiếu dmHostChatId -> câu báo HẾT LƯỢT rơi vào nhánh '
    + '"host sẽ không biết" (chayMotNhip ngay trên đã có từ đầu)');
});

test('N6 ★★ nếu ai đó gỡ dây: chiều (b) PHẢI đổi hành vi (bài N5 không tự xanh)', async () => {
  // Chốt chặn cuối: chứng minh N5 thật sự đang ĐO closure, chứ không phải xanh
  // nhờ một lý do khác. Bỏ `recordSources` ra -> bo_chay fail-closed, không giao
  // model. Hai kết quả khác nhau ⇒ bài N5 có sức phân biệt thật.
  const db = dbTam();
  nhacDaChot(db);
  let giaoModel = 0;
  const daGui = [];
  const ra = await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi, truyVanLichSu: chamNhomKhac,
    dsNguoiTrongNhom: () => [],
    guiVaoNhom: async (_a, _c, t) => { daGui.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    guiThongBao: async () => { giaoModel += 1; return true; },
    // ★ CỐ Ý gỡ dây
  });
  assert.equal(giaoModel, 0);
  assert.equal(ra.duPhong, 1);
  assert.doesNotMatch(daGui[0] ?? '', /nhóm B/,
    'câu dự phòng KHÔNG được mang nội dung nhóm khác');
  dongDb(db);
});
