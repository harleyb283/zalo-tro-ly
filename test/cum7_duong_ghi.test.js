/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 7 — CHỮA ĐƯỜNG GHI. "Đã NÓI xong" ≠ "đã LÀM xong".
 *
 * 🔴 CA HỎNG THẬT 08:03:34 ngày 21/08/2026 — host nhắn vào nhóm:
 *      "chốt lịch t7, 7h30 đi ăn lòng rồi nhé. Lưu lại"
 *    Trợ lý đáp "Dạ em ghi nhận rồi ạ" rồi KHÔNG GHI GÌ. `lich_hen` không sinh
 *    dòng nào. Router phải vào DB sửa tay.
 *
 * 🔴 HAI nguyên nhân, và cái thứ hai mới là cái đắt:
 *    1. Trong 12 tool KHÔNG tool nào đáp được chữ "lưu lại".
 *    2. `tra_loi` gửi được mà KHÔNG cần bất kỳ tool ghi nào chạy trước ⇒ không
 *       có gì trong hệ phân biệt "đã nói xong" với "đã làm xong".
 *    Vá (1) mà bỏ (2) thì lần sau model chọn nhầm tool khác là hỏng y hệt.
 *
 * ⚠️ Bài T7-NGHIEM-THU dưới đây diễn lại NGUYÊN VĂN câu đó, đúng bộ nghiệm thu
 *    Router đặt ra. Nó là bài quan trọng nhất file này.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, enqueueQuestion, upsertConversation, writeMemo } from '../src/store/write.js';
import { readMemos } from '../src/store/query.js';
import {
  HUONG_TRA_LOI, MA_LOI, TEN_TOOL, TEN_TOOL_GHI, TEN_TOOL_LICH, TEN_TOOL_NHAC,
  TRANG_THAI_TD, PHIEN_BAN_SCHEMA,
} from '../src/lib/hang_so.js';
import { chotLich } from '../src/lich/lich_hen.js';
import { taoNhacTheoDuoi } from '../src/lich/theo_duoi.js';
import { registerTools } from '../src/mcp/tools.js';

const NHOM = '9990000000001';
const HOST = '555000111';
const NGUOI_LA = '9991000000000000001';

/** NGUYÊN VĂN câu host gõ lúc 08:03:34 ngày 21/08/2026. ⛔ Đừng sửa chữ nào. */
const CAU_0803 = 'chốt lịch t7, 7h30 đi ăn lòng rồi nhé. Lưu lại';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum7-'));
  RAC.push(d);
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  return db;
}

function phien(db, { requestId = 'r1', noiDung = 'xin chào', userId = HOST, msgId = 'm1' } = {}) {
  enqueueQuestion(db, {
    requestId, chatIdHoi: NHOM, msgId, userId, noiDung, tsTao: new Date().toISOString(),
  });
  return requestId;
}

function dungTool(db, { cueGhiNho } = {}) {
  const daGui = [];
  let xuLy;
  registerTools({
    setRequestHandler(schema, fn) { if (schema?.shape?.method?.value === 'tools/call') xuLy = fn; },
  }, {
    db,
    cauHinh: {
      cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: 'dm-host' }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
      ...(cueGhiNho ? { cueGhiNho } : {}),
    },
    boTichLuy: { ghiNhan() {}, lay: () => [NHOM], xoa() {}, soPhien: () => 0 },
    api: { getOwnId: () => 'uid-bot' },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    guiTin: {
      sendToGroup: async (_a, c, t) => { daGui.push({ c, t }); return { msgId: `m${daGui.length}` }; },
      sendHostDm: async (_a, c, t) => { daGui.push({ c, t }); return { msgId: `d${daGui.length}` }; },
    },
    chinhSach: {
      decideReplyRoute: () => ({ huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' }),
    },
  });
  return {
    daGui,
    goi: async (name, args) => JSON.parse((await xuLy({ params: { name, arguments: args } })).content[0].text),
  };
}

function demCongGhi(db, suKien) {
  return db.prepare('SELECT count(*) c FROM nhat_ky_cong_ghi WHERE su_kien = ?').get(suKien).c;
}

// ═══════════════════════════════════════════════════════════════════════
// T7-NGHIEM-THU — diễn lại NGUYÊN VĂN ca 08:03
// ═══════════════════════════════════════════════════════════════════════

test('★★★ T7-NGHIEM-THU: diễn lại NGUYÊN VĂN ca 08:03 — nói mà không ghi thì KHÔNG gửi được', async () => {
  const db = dbTam();
  // Lời nhắc theo đuổi vụ "chốt địa điểm" đang chạy — đúng bối cảnh sáng 21/08.
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, ma: 'DIADIEM',
  });
  chotLich(db, { id: 'DIADIEM', ma: 'DIADIEM', nguoiDat: HOST });

  const req = phien(db, { noiDung: CAU_0803 });
  const { goi, daGui } = dungTool(db);

  // ① Trợ lý làm ĐÚNG NHƯ 08:03 — đáp bằng lời, không gọi tool ghi nào.
  const l1 = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'Dạ em ghi nhận rồi ạ' });
  assert.equal(l1.ok, false,
    '🔴 ĐÂY LÀ CA 08:03 — "đã nói xong" đi qua như "đã làm xong", việc mất trắng');
  assert.equal(l1.ma, MA_LOI.CAN_GHI_TRUOC);
  assert.equal(daGui.length, 0, 'chưa ghi gì mà đã gửi tin ra nhóm');
  assert.match(l1.thongDiep, /Lưu lại|lưu lại/, 'phải nói rõ CUE nào đã kích hoạt');
  assert.match(l1.thongDiep, new RegExp(TEN_TOOL_GHI.GHI_NHO), 'phải chỉ đường đi tiếp');
  assert.match(l1.thongDiep, /khongCanGhi/, 'phải nêu cả đường thoát');

  // ② Trợ lý sửa lại: ghi trước.
  const g = await goi(TEN_TOOL_GHI.GHI_NHO, {
    request_id: req,
    noiDung: 'T7 07:30 đi ăn lòng — đã chốt',
    nguyenVan: CAU_0803,
    loai: 'su_kien',
  });
  assert.equal(g.ok, true, JSON.stringify(g));

  // ③ Giờ mới gửi được.
  const l2 = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'Dạ em lưu rồi ạ' });
  assert.equal(l2.ok, true, JSON.stringify(l2));
  assert.equal(daGui.length, 1);

  // ═══ NGHIỆM THU ①: DB có ĐÚNG MỘT dòng ghi_nho ═══
  const rows = db.prepare('SELECT * FROM ghi_nho').all();
  assert.equal(rows.length, 1, 'phải có ĐÚNG 1 dòng ghi_nho');
  assert.equal(rows[0].nguyen_van, CAU_0803, 'nguyên văn phải đúng TỪNG CHỮ');
  assert.equal(rows[0].chat_id, NHOM);
  assert.equal(rows[0].request_id, req);
  closeDb(db);
});

test('★★★ T7-NGHIEM-THU-3: dong_nhac -> mo_lai_nhac -> xem_nhac thấy lại dang_theo_duoi', async () => {
  const db = dbTam();
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, ma: 'DIADIEM',
  });
  chotLich(db, { id: 'DIADIEM', ma: 'DIADIEM', nguoiDat: HOST });
  const req = phien(db, { noiDung: 'xong rồi nhé' });
  const { goi } = dungTool(db);

  const d = await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: req, id: 'DIADIEM' });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.duLieu.trangThaiTd, TRANG_THAI_TD.DA_XONG);

  const m = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req, id: 'DIADIEM' });
  assert.equal(m.ok, true, JSON.stringify(m));

  const x = await goi(TEN_TOOL_NHAC.XEM_NHAC, { request_id: req, trangThaiTd: TRANG_THAI_TD.DANG_THEO_DUOI });
  assert.equal(x.ok, true, JSON.stringify(x));
  assert.equal(x.duLieu.soLuong, 1, 'mở lại rồi mà xem_nhac không thấy = mở hụt');
  assert.equal(x.duLieu.danhSach[0].maXacNhan, 'DIADIEM');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// A. ghi_nho — CHẠM DB THẬT, canh KIỂU từng cột
// ═══════════════════════════════════════════════════════════════════════

test('★★★ A1 CHẠM DB THẬT: kiểu của TỪNG CỘT đúng như schema khai', () => {
  // 🔴 Bài học `ref_test_hang_gia_khong_bat_duoc_loi_kieu_o_tang_db`: tiêm hàng
  // giả cho tầng ghi DB thì lỗi SAI KIỂU KHÔNG LỘ — 715 test xanh mà tính năng
  // chưa từng tạo nổi một dòng thật. Bài này dùng DB THẬT (file tạm) và canh
  // `typeof`, vì SQLite có "type affinity": nhét chuỗi "1755..." vào cột INTEGER
  // thì nó tự đổi và KHÔNG BÁO GÌ, còn nhét "thứ bảy" thì nó giữ nguyên TEXT
  // trong một cột khai là INTEGER — cũng không báo gì.
  const db = dbTam();
  const khi = Date.UTC(2026, 7, 22, 0, 30);
  const { dong } = writeMemo(db, {
    chatId: NHOM, requestId: 'r1', nguoiGhi: HOST, loai: 'su_kien',
    noiDung: 'T7 07:30 đi ăn lòng', nguyenVan: CAU_0803,
    khiNaoMs: khi, aiLienQuan: [NGUOI_LA],
  });

  assert.equal(typeof dong.id, 'string');
  assert.equal(typeof dong.chat_id, 'string', 'chat_id là TEXT — số hoá là mất chữ số ID Zalo');
  assert.equal(typeof dong.nguoi_ghi, 'string');
  assert.equal(typeof dong.loai, 'string');
  assert.equal(typeof dong.noi_dung, 'string');
  assert.equal(typeof dong.nguyen_van, 'string');
  assert.equal(typeof dong.khi_nao_ms, 'number', 'khi_nao_ms phải là SỐ, không phải chuỗi');
  assert.equal(dong.khi_nao_ms, khi);
  assert.equal(typeof dong.ai_lien_quan, 'string', 'ai_lien_quan là JSON dạng TEXT');
  assert.deepEqual(JSON.parse(dong.ai_lien_quan), [NGUOI_LA]);
  assert.equal(typeof dong.ts_tao, 'string');
  closeDb(db);
});

test('★★★ A2 CHẠM DB THẬT: khiNaoMs là CHỮ -> NỔ, không âm thầm ghi rác', () => {
  const db = dbTam();
  assert.throws(
    () => writeMemo(db, {
      chatId: NHOM, nguoiGhi: HOST, noiDung: 'x', nguyenVan: 'y', khiNaoMs: 'thứ bảy 7h30',
    }),
    /epoch ms/,
    'nhận chữ thì cột INTEGER giữ nguyên TEXT và mọi so sánh thời gian sau đó sai câm',
  );
  assert.equal(db.prepare('SELECT count(*) c FROM ghi_nho').get().c, 0, 'nổ rồi thì không được ghi gì');
  closeDb(db);
});

test('★★ A3 không có mốc thời gian -> khi_nao_ms là NULL, ⛔ không bịa số', () => {
  const db = dbTam();
  const { dong } = writeMemo(db, { chatId: NHOM, nguoiGhi: HOST, noiDung: 'x', nguyenVan: 'y' });
  assert.equal(dong.khi_nao_ms, null, 'bịa một mốc để điền cho đủ là tệ hơn bỏ trống');
  assert.equal(dong.loai, 'khac');
  closeDb(db);
});

test('★★ A4 loai lạ -> NỔ (CHECK của schema phải có người canh trước khi tới DB)', () => {
  const db = dbTam();
  assert.throws(() => writeMemo(db, {
    chatId: NHOM, nguoiGhi: HOST, noiDung: 'x', nguyenVan: 'y', loai: 'linh_tinh',
  }), /không hợp lệ/);
  closeDb(db);
});

test('★★★ A5 nguyenVan rỗng -> NỔ (mất nguyên văn là mất đường đối chiếu)', () => {
  const db = dbTam();
  assert.throws(() => writeMemo(db, { chatId: NHOM, nguoiGhi: HOST, noiDung: 'x', nguyenVan: '  ' }),
    /NGUYÊN VĂN/);
  closeDb(db);
});

test('★★★ A6 CHỈ HOST ghi nhớ được — người khác trong nhóm thì KHÔNG', async () => {
  // Ghi nhớ được bơm lại vào context các lượt sau. Để người lạ ghi được là để
  // họ cấy thẳng câu chữ vào đó — đúng hình dạng của một mũi tiêm prompt.
  const db = dbTam();
  const req = phien(db, { userId: NGUOI_LA, noiDung: 'lưu lại giùm anh nhé' });
  const { goi } = dungTool(db);
  const r = await goi(TEN_TOOL_GHI.GHI_NHO, { request_id: req, noiDung: 'x', nguyenVan: 'y' });
  assert.equal(r.ok, false);
  assert.equal(db.prepare('SELECT count(*) c FROM ghi_nho').get().c, 0);
  closeDb(db);
});

test('★★ A7 readMemos chỉ trả ghi nhớ của ĐÚNG nhóm đó và KHAI NGUỒN', () => {
  const db = dbTam();
  upsertConversation(db, { chatId: '999', loai: 'GROUP', ten: 'Nhóm B', duocNghe: true });
  writeMemo(db, { chatId: NHOM, nguoiGhi: HOST, noiDung: 'của nhóm A', nguyenVan: 'a' });
  writeMemo(db, { chatId: '999', nguoiGhi: HOST, noiDung: 'của nhóm B', nguyenVan: 'b' });
  const kq = readMemos(db, { chatId: NHOM });
  assert.equal(kq.rows.length, 1);
  assert.equal(kq.rows[0].noi_dung, 'của nhóm A', 'ghi nhớ nhóm B lọt sang nhóm A = rò chéo nhóm');
  assert.deepEqual(kq.nguonChatIds, [NHOM]);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// B. Cổng ghi — cue, đường thoát, sổ đo
// ═══════════════════════════════════════════════════════════════════════

test('★★★ B1 KHÔNG có cue -> tra_loi chạy bình thường (chống vá quá tay)', async () => {
  const db = dbTam();
  const req = phien(db, { noiDung: 'mấy giờ họp thế anh?' });
  const { goi, daGui } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: '2 giờ chiều ạ' });
  assert.equal(r.ok, true, 'cổng nổ với câu hỏi thường = khoá mồm trợ lý trong mọi hội thoại');
  assert.equal(daGui.length, 1);
  assert.equal(demCongGhi(db, 'chan'), 0);
  closeDb(db);
});

test('★★★ B2 ĐƯỜNG THOÁT khongCanGhi cho qua VÀ được ghi vào sổ đo', async () => {
  // 🔴 `ref_memory_guard_false_positive_lap_lai`: hook từng bắt nhầm khi host
  // DÁN NGUYÊN VĂN một đoạn chứa chữ khoá. Regex bắt nhầm là chuyện CHẮC CHẮN
  // xảy ra, nên đường thoát không phải tuỳ chọn — nó là điều kiện để cổng này
  // được phép tồn tại.
  const db = dbTam();
  const req = phien(db, { noiDung: 'anh đọc được câu này trong tài liệu: "lưu lại rồi báo"' });
  const { goi, daGui } = dungTool(db);

  const chan = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'dạ em hiểu rồi' });
  assert.equal(chan.ok, false);

  const qua = await goi(TEN_TOOL.TRA_LOI, {
    request_id: req, text: 'dạ em hiểu rồi', khongCanGhi: true, lyDo: 'anh đang dán lại tài liệu, không phải ra lệnh',
  });
  assert.equal(qua.ok, true, JSON.stringify(qua));
  assert.equal(daGui.length, 1, 'bắt nhầm chỉ được tốn MỘT vòng model, không được nuốt câu trả lời');

  assert.equal(demCongGhi(db, 'chan'), 1);
  assert.equal(demCongGhi(db, 'vuot'), 1, 'thiếu chiều "vuot" là mất mẫu số, không đo được cue có quá rộng không');
  const v = db.prepare("SELECT * FROM nhat_ky_cong_ghi WHERE su_kien = 'vuot'").get();
  assert.match(v.ly_do, /dán lại/);
  assert.deepEqual(JSON.parse(v.cue_trung), ['lưu lại']);
  closeDb(db);
});

test('★★★ B3 tool ghi KHÁC cũng mở được cổng (dat_nhac_theo_duoi)', async () => {
  const db = dbTam();
  const req = phien(db, { noiDung: 'chốt lịch mai họp nhé, ghi lại' });
  const { goi } = dungTool(db);
  const n = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: req, noiDung: 'theo dõi vụ họp', dienGiaiGoc: 'ghi lại',
  });
  assert.equal(n.ok, true, JSON.stringify(n));
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'dạ em đặt rồi ạ' });
  assert.equal(r.ok, true, 'cổng chỉ chấp nhận ghi_nho là ép model dùng sai tool');
  assert.equal(demCongGhi(db, 'da_ghi'), 1);
  closeDb(db);
});

test('★★★ B4 tool ghi gọi HỎNG thì KHÔNG mở được cổng', async () => {
  // Đánh dấu khi `ok:false` là mở toang cổng bằng một lời gọi HỎNG: model gọi
  // thiếu tham số, tool trả lỗi, rồi `tra_loi` đi qua như thể đã ghi xong —
  // đúng ca 08:03 nhưng khó thấy hơn vì trong log CÓ một lời gọi tool.
  const db = dbTam();
  const req = phien(db, { noiDung: 'lưu lại giúp anh' });
  const { goi } = dungTool(db);
  const hong = await goi(TEN_TOOL_LICH.DAT_LICH_NHAP, { request_id: req });   // thiếu tham số
  assert.equal(hong.ok, false, 'bài này chỉ có nghĩa khi lời gọi kia THẬT SỰ hỏng');
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'dạ xong rồi ạ' });
  assert.equal(r.ok, false, 'một lời gọi tool HỎNG vừa mở được cổng ghi');
  closeDb(db);
});

test('★★★ B5 cue lấy từ CONFIG, không phải hằng số trong code', async () => {
  const db = dbTam();
  const req = phien(db, { noiDung: 'ghi sổ giùm anh vụ này' });   // KHÔNG nằm trong cue mặc định
  const { goi } = dungTool(db, { cueGhiNho: ['ghi sổ'] });
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'dạ vâng' });
  assert.equal(r.ok, false, 'cue trong config không có tác dụng = host phải sửa code mới đổi được cue');
  assert.deepEqual(JSON.parse(db.prepare("SELECT cue_trung c FROM nhat_ky_cong_ghi").get().c), ['ghi sổ']);
  closeDb(db);
});

test('★★★ B6 lượt NHẮC không bị cổng chặn (nội dung do CODE dựng, không phải host gõ)', async () => {
  // Câu tóm tắt lượt nhắc do `bo_chay.js` dựng và nó hay chứa đúng chữ "chốt".
  // Chặn ở đây là lời nhắc không bao giờ gửi được — hỏng câm đúng thứ tính năng
  // theo đuổi sinh ra để chống.
  const db = dbTam();
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'x',
    nguoiDat: HOST, chatIdDat: NHOM, ma: 'N1',
  });
  chotLich(db, { id: 'N1', ma: 'N1', nguoiDat: HOST });
  const d = db.prepare("SELECT id FROM lich_hen WHERE ma_xac_nhan='N1'").get();
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(Date.now(), d.id);
  const req = phien(db, { noiDung: '[LỜI NHẮC] chốt lịch giúp em', msgId: `nhac:${d.id}:0` });

  const { goi, daGui } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'Anh ơi chốt giúp em địa điểm nhé' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(daGui.length, 1);
  assert.equal(demCongGhi(db, 'chan'), 0);
  closeDb(db);
});

test('★★★ B7 người KHÔNG phải host thì cổng không áp (chỉ host mới ra lệnh được)', async () => {
  const db = dbTam();
  const req = phien(db, { userId: NGUOI_LA, noiDung: 'lưu lại giùm em với' });
  const { goi } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'dạ' });
  assert.equal(r.ok, true, 'người lạ gõ "lưu lại" mà chặn được trợ lý = họ điều khiển được nó');
  closeDb(db);
});

test('★★ B8 lượt SAU không bị dính dấu ghi của lượt TRƯỚC', async () => {
  const db = dbTam();
  const { goi } = dungTool(db);
  const r1 = phien(db, { requestId: 'ra', noiDung: 'lưu lại vụ A' });
  await goi(TEN_TOOL_GHI.GHI_NHO, { request_id: r1, noiDung: 'A', nguyenVan: 'lưu lại vụ A' });
  assert.equal((await goi(TEN_TOOL.TRA_LOI, { request_id: r1, text: 'ok' })).ok, true);

  const r2 = phien(db, { requestId: 'rb', noiDung: 'lưu lại vụ B', msgId: 'm2' });
  const l2 = await goi(TEN_TOOL.TRA_LOI, { request_id: r2, text: 'ok' });
  assert.equal(l2.ok, false, 'dấu ghi rò từ lượt trước sang lượt sau = cổng vô hiệu từ lượt thứ hai');
  closeDb(db);
});

test('★★★ B9 LỚP BỀN: mất dấu trong bộ nhớ mà DB còn bằng chứng -> vẫn cho qua', async () => {
  // 🔴 Bài này tách riêng LỚP THỨ HAI. Ca thường thì dấu trong bộ nhớ luôn thắng
  // trước, nên nó CHE hoàn toàn lớp bền — gỡ `countTurnMemos` đi mà mọi bài
  // khác vẫn xanh (đo thật: đột biến M10 sống sót vòng đầu).
  // Cách tách: nạp một BẢN MODULE MỚI (đổi query string để phá cache) — bản mới
  // có Map RỖNG, đúng như ca daemon nạp lại module giữa lượt, trong khi dòng
  // `ghi_nho` trong DB thì vẫn còn.
  const db = dbTam();
  const req = phien(db, { noiDung: 'lưu lại giùm anh vụ này' });
  const { goi } = dungTool(db);
  assert.equal((await goi(TEN_TOOL_GHI.GHI_NHO, {
    request_id: req, noiDung: 'x', nguyenVan: 'lưu lại giùm anh vụ này',
  })).ok, true);

  // ── bản module MỚI: dấu trong bộ nhớ KHÔNG có, chỉ còn bằng chứng trong DB ──
  const moi = await import(`../src/mcp/tools.js?doi-ban=${process.pid}`);
  const daGui = [];
  let xuLy;
  moi.registerTools({
    setRequestHandler(schema, fn) { if (schema?.shape?.method?.value === 'tools/call') xuLy = fn; },
  }, {
    db,
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: 'dm-host' }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [NHOM], xoa() {}, soPhien: () => 0 },
    api: { getOwnId: () => 'uid-bot' },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    guiTin: {
      sendToGroup: async () => { daGui.push(1); return { msgId: 'm1' }; },
      sendHostDm: async () => ({ msgId: 'd1' }),
    },
    chinhSach: {
      decideReplyRoute: () => ({ huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' }),
    },
  });
  const r = JSON.parse((await xuLy({
    params: { name: TEN_TOOL.TRA_LOI, arguments: { request_id: req, text: 'dạ em lưu rồi ạ' } },
  })).content[0].text);

  assert.equal(r.ok, true,
    'DB đã có bằng chứng ghi mà vẫn chặn -> model bị bắt ghi LẦN HAI, sinh dòng trùng');
  assert.equal(daGui.length, 1);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// C. mo_lai_nhac
// ═══════════════════════════════════════════════════════════════════════

function nhacDaDong(db, ma = 'N1', them = {}) {
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: `việc ${ma}`,
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'x',
    nguoiDat: HOST, chatIdDat: NHOM, ma, ...them,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  return db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
}

test('★★★ C1 mở lại GIỮ số lượt đã nhắc — ⛔ không reset về 0', async () => {
  // Reset là biến trần 10 lượt thành VÔ HẠN chỉ bằng đóng-mở-đóng-mở. Và số lượt
  // đã nhắc là sự thật lịch sử: người ta đã bị làm phiền đúng ngần ấy lần.
  const db = dbTam();
  const d = nhacDaDong(db, 'N1');
  db.prepare('UPDATE lich_hen SET so_lan_da_nhac = 4 WHERE id = ?').run(d.id);
  const req = phien(db, { noiDung: 'xong rồi nhé' });
  const { goi } = dungTool(db);
  await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: req, id: 'N1' });
  const m = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req, id: 'N1' });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(m.duLieu.soLanDaNhac, 4);
  closeDb(db);
});

test('★★★ C2 mốc kế tiếp tính lại từ BÂY GIỜ, không dùng lại mốc quá khứ', async () => {
  // Mốc cũ nằm trong quá khứ ⇒ mở lại là bắn ngay một tin, rồi lượt sau bắn
  // tiếp — host vừa nói "mở lại" đã ăn liền hai tin.
  const db = dbTam();
  const d = nhacDaDong(db, 'N1', { chuKyPhut: 3 });
  db.prepare('UPDATE lich_hen SET gui_luc_ms = ? WHERE id = ?').run(Date.now() - 86_400_000, d.id);
  const req = phien(db, { noiDung: 'xong rồi' });
  const { goi } = dungTool(db);
  await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: req, id: 'N1' });
  await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req, id: 'N1' });
  const sau = db.prepare('SELECT gui_luc_ms FROM lich_hen WHERE id = ?').get(d.id);
  assert.ok(Number(sau.gui_luc_ms) > Date.now(), 'mốc kế tiếp nằm trong quá khứ -> bắn ngay lập tức');
  closeDb(db);
});

test('★★★ C3 CHỈ HOST mở lại được', async () => {
  const db = dbTam();
  nhacDaDong(db, 'N1');
  const rHost = phien(db, { requestId: 'rh', noiDung: 'xong' });
  const { goi } = dungTool(db);
  await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: rHost, id: 'N1' });
  const rLa = phien(db, { requestId: 'rl', userId: NGUOI_LA, noiDung: 'mở lại đi', msgId: 'm9' });
  const m = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: rLa, id: 'N1' });
  assert.equal(m.ok, false, 'người bị nhắc có động cơ lớn nhất để tự mở/đóng — nghe họ là mất cả cơ chế');
  closeDb(db);
});

test('★★★ C4 HẾT LƯỢT mà mở lại không nới trần -> BÁO RÕ, không mở hụt trong im lặng', async () => {
  const db = dbTam();
  const d = nhacDaDong(db, 'N1', { chuKyPhut: 3 });
  db.prepare('UPDATE lich_hen SET so_lan_da_nhac = 10, tran_so_lan = 10 WHERE id = ?').run(d.id);
  const req = phien(db, { noiDung: 'xong' });
  const { goi } = dungTool(db);
  await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: req, id: 'N1' });

  const m1 = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req, id: 'N1' });
  assert.equal(m1.ok, false, 'mở mà lượt sau tự đóng ngay = mở hụt, host tưởng đã mở');
  assert.match(m1.thongDiep, /nới trần|noiTran/);

  const m2 = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req, id: 'N1', noiTran: true });
  assert.equal(m2.ok, true, JSON.stringify(m2));
  assert.equal(m2.duLieu.daNoiTran, true);
  assert.ok(m2.duLieu.tranSoLan > 10);
  closeDb(db);
});

test('★★★ C5 bỏ trống id -> lấy lời nhắc VỪA ĐÓNG của ĐÚNG nhóm này', async () => {
  const db = dbTam();
  upsertConversation(db, { chatId: '999', loai: 'GROUP', ten: 'Nhóm B', duocNghe: true });
  nhacDaDong(db, 'N-A');
  // Một lời nhắc đã đóng của nhóm KHÁC, đóng SAU -> nếu thiếu bộ lọc nhóm thì
  // nó sẽ bị chọn, tức đứng ở nhóm A mở được lời nhắc của nhóm B.
  taoNhacTheoDuoi(db, {
    chatIdDich: '999', loaiDich: 'GROUP', noiDung: 'việc nhóm B',
    dienGiaiGoc: 'x', dienGiaiXacNhan: 'y', nguoiDat: HOST, chatIdDat: '999', ma: 'N-B',
  });
  chotLich(db, { id: 'N-B', ma: 'N-B', nguoiDat: HOST });

  const req = phien(db, { noiDung: 'xong' });
  const { goi } = dungTool(db);
  await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: req, id: 'N-A' });
  await goi(TEN_TOOL_NHAC.DONG_NHAC, { request_id: req, id: 'N-B' });

  const m = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(m.duLieu.noiDung, 'việc N-A', 'mở nhầm lời nhắc của nhóm khác = rò chéo nhóm');
  closeDb(db);
});

test('★★ C6 lời nhắc đang chạy sẵn -> nói rõ, không im lặng làm gì đó', async () => {
  const db = dbTam();
  nhacDaDong(db, 'N1');
  const req = phien(db, { noiDung: 'mở lại' });
  const { goi } = dungTool(db);
  const m = await goi(TEN_TOOL_GHI.MO_LAI_NHAC, { request_id: req, id: 'N1' });
  assert.equal(m.ok, false);
  assert.match(m.thongDiep, /đang chạy/);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// D. schema v6
// ═══════════════════════════════════════════════════════════════════════

test('★★★ D1 PHIEN_BAN_SCHEMA và schema.sql phải NÓI CÙNG MỘT SỐ', () => {
  // Lệch nhau thì DB TRẮNG sinh ra ở phiên bản cũ rồi migrate ngay lần mở đầu —
  // `migrate()` báo `daDoi: true` cho một DB vừa tạo. Bài A3 của store.test.js
  // bắt được ca này thật khi em quên bump schema.sql.
  const sql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
  const m = /VALUES \('schema_version', '(\d+)'\)/.exec(sql);
  assert.ok(m, 'không tìm thấy dòng ghi schema_version trong schema.sql');
  assert.equal(m[1], PHIEN_BAN_SCHEMA);
});
