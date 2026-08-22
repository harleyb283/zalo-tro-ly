/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 3 — TRẠNG THÁI VÔ HÌNH / SỔ SÁCH NÓI DỐI. A7 · A8 · B1 · B2 · A10 · T3f.
 *
 * 🔑 SỢI CHỈ CHUNG: không cái nào ném lỗi, không cái nào làm test đỏ. Chúng chỉ
 *    NÓI DỐI TRONG IM LẶNG. Đây là loại hỏng khiến anh mất niềm tin vào cả những
 *    chỗ hệ báo đúng.
 *
 * 🔴 LUẬT VIẾT BÀI CHO CỤM NÀY — khác hẳn hai cụm trước:
 *    Ở đây KHÔNG có hành vi sai để bắt; hành vi vẫn "chạy được". Cái sai là
 *    **có dữ liệu mà không có đường ra**. Nên mỗi bài phải hỏi đúng một câu:
 *    *"thứ này có TỚI ĐƯỢC MẮT ANH không?"* — trả về của tool, nội dung DM,
 *    chữ trong `so_nhac.md`. ⛔ Một bài chỉ khẳng định "DB có cột đó" là bài
 *    GIẢ: đúng cái tình trạng trước khi vá (`msg_id_da_gui` ghi 2 lần, đọc 0 lần).
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import {
  capNhatHangDoi, ghiTin, layHangDoiCho, taoHangDoi, upsertHoiThoai,
} from '../src/store/write.js';
import { dsNguoiTrongNhom, truyVanLichSu } from '../src/store/query.js';
import { HUONG_TRA_LOI, TEN_TOOL, TEN_TOOL_LICH, TRANG_THAI_HANG_DOI } from '../src/lib/hang_so.js';
import { chotLich, nhanDangGui, taoLich } from '../src/lich/lich_hen.js';
import {
  danhChoLuotNhac, layLichDanhChoChuaRoGui, layNhacBatBienVo, sinhSoNhac, taoNhacTheoDuoi,
} from '../src/lich/theo_duoi.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';
import { dayHangDoiCho } from '../src/mcp/channel.js';
import { dangKyTool } from '../src/mcp/tools.js';
import { taoBoDemLoiGui } from '../src/index.js';
import { datLaiThrottle, datThrottle, guiDmHost, guiVaoNhom } from '../src/zalo/send.js';

const NHOM = '9990000000001';
const HOST = '555000111';
const TRONG = '9991000000000000001';
const BOT = '999200000000000002';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum3-'));
  RAC.push(d);
  const db = moDb(path.join(d, 'kho', 'lichsu.db'));
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  return { db, thuMuc: d };
}

const tinGia = (v = {}) => ({
  chatId: NHOM, msgId: 'm1', cliMsgId: null, userId: HOST, tenLucGui: 'Minh Hải',
  msgType: 'chat.text', noiDung: 'xin chào', contentRaw: null,
  tsZalo: 1_700_000_000_000, tuToi: false, coTagHost: false, ...v,
});

function nhacDaChot(db, v = {}) {
  const ma = v.ma ?? 'NHAC';
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: TRONG, ma, ...v,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  return db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
}

function dungTool(db) {
  const daGui = [];
  const api = {
    getOwnId: () => BOT,
    async sendMessage(noiDung, threadId, loai) {
      daGui.push({ noiDung, threadId, loai });
      return { message: { msgId: `m${daGui.length}` } };
    },
  };
  let xuLy;
  dangKyTool({
    setRequestHandler(schema, fn) { if (schema?.shape?.method?.value === 'tools/call') xuLy = fn; },
  }, {
    db,
    cauHinh: {
      cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: 'dm-host' }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [NHOM], xoa() {}, soPhien: () => 0 },
    api,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    guiTin: { guiVaoNhom, guiDmHost },
    chinhSach: {
      decideReplyRoute: () => ({ huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' }),
    },
  });
  return {
    daGui,
    goi: async (name, args) => JSON.parse((await xuLy({ params: { name, arguments: args } })).content[0].text),
  };
}

let throttleCu;
test.before(() => { throttleCu = datThrottle({ minKhoangCachMs: 0, toiDaMoiPhut: 100000 }); });
test.after(() => { datThrottle(throttleCu); datLaiThrottle(); });

// ═══════════════════════════════════════════════════════════════════════
// T3a — A7: câu hỏi không được bốc hơi
// ═══════════════════════════════════════════════════════════════════════

test('T3a ★★★ dòng `da_day` mồ côi PHẢI được đẩy bù (đây là 2 câu anh hỏi đã bốc hơi)', async () => {
  const { db } = dbTam();
  taoHangDoi(db, {
    requestId: 'r-mo-coi', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'Trọng đang nói về vấn đề gì thế', tsTao: new Date().toISOString(),
  });
  capNhatHangDoi(db, 'r-mo-coi', TRANG_THAI_HANG_DOI.DA_DAY);   // đã đẩy, phiên Claude rồi chết

  // Đường CŨ (không gom da_day) KHÔNG thấy nó — đây là tiền đề của bài.
  assert.equal(layHangDoiCho(db, 60_000).length, 0,
    'tiền đề: đường cũ không thấy dòng da_day');

  const day = [];
  const kq = await dayHangDoiCho({
    db, queueTtlMs: 30 * 60_000,
    layHangDoiCho, capNhatHangDoi,
    guiThongBao: async (p) => { day.push(p.requestId); return true; },
  });
  assert.equal(kq.day, 1, 'câu hỏi mồ côi KHÔNG được đẩy bù -> nó bốc hơi im lặng');
  assert.deepEqual(day, ['r-mo-coi']);
  dongDb(db);
});

test('T3a-2 ★★★ quá TTL -> het_han VÀ CÓ DM host (đánh dấu rồi im lặng vẫn là nuốt câu hỏi)', async () => {
  const { db } = dbTam();
  taoHangDoi(db, {
    requestId: 'r-cu', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'còn sống ko', tsTao: new Date(Date.now() - 3 * 3600_000).toISOString(),
  });

  const baoHost = [];
  await dayHangDoiCho({
    db, queueTtlMs: 30 * 60_000,
    layHangDoiCho, capNhatHangDoi,
    guiThongBao: async () => true,
    baoHetHan: async (s) => { baoHost.push(s); },
  });

  assert.equal(
    db.prepare('SELECT trang_thai t FROM hang_doi_hoi WHERE request_id = ?').get('r-cu').t,
    TRANG_THAI_HANG_DOI.HET_HAN,
  );
  assert.equal(baoHost.length, 1, 'quá hạn mà KHÔNG báo -> anh không bao giờ biết câu hỏi đã rơi');
  assert.match(baoHost[0], /còn sống ko/, 'phải nói RÕ câu nào bị rơi, không nói chung chung');
  dongDb(db);
});

test('T3a-3 ★★★ ĐẨY BÙ HAI LẦN KHÔNG SINH HAI CÂU TRẢ LỜI', async () => {
  // 🔴 Đây là thứ làm cho việc đẩy bù trở nên AN TOÀN. Thiếu nó thì bản vá A7
  // biến một lỗi (mất câu hỏi) thành một lỗi khác (hai tin vào nhóm người thật),
  // mà tin Zalo thì KHÔNG thu hồi được.
  const { db } = dbTam();
  const nhac = nhacDaChot(db, { chuKyPhut: 3 });
  // Token quyền gửi — production đặt trước khi tạo hàng đợi (xem `bo_chay.js`).
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = $t WHERE id = $id')
    .run({ t: Date.now(), id: String(nhac.id) });
  taoHangDoi(db, {
    requestId: 'r-doi', chatIdHoi: NHOM, msgId: `nhac:${nhac.id}:0`, userId: HOST,
    noiDung: 'câu hỏi', tsTao: new Date().toISOString(),
  });
  ghiTin(db, tinGia({ msgId: 'm-trong', userId: TRONG, tenLucGui: 'Trọng Nguyễn' }));

  const { goi, daGui } = dungTool(db);
  const l1 = await goi(TEN_TOOL.TRA_LOI, { request_id: 'r-doi', text: 'Dạ đây ạ' });
  assert.equal(l1.ok, true, JSON.stringify(l1));

  // Kênh nối lại -> đẩy bù -> Claude nhận lại cùng request_id -> gọi tra_loi lần hai.
  const l2 = await goi(TEN_TOOL.TRA_LOI, { request_id: 'r-doi', text: 'Dạ đây ạ' });
  assert.equal(l2.ok, false, 'trả lời lần thứ hai cho cùng một câu hỏi -> anh nhận HAI tin');
  assert.match(l2.thongDiep, /ĐÃ được trả lời rồi/);
  assert.equal(daGui.length, 1, `đã gửi ${daGui.length} tin vào nhóm cho MỘT câu hỏi`);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T3b — A8: cuộc đua cờ do_tro_ly_tao. VIẾT THEO ĐÚNG THỨ TỰ THUA.
// ═══════════════════════════════════════════════════════════════════════

test('T3b ★★★ echo của listener ghi TRƯỚC -> cờ do_tro_ly_tao VẪN phải là 1', () => {
  // ⛔ CẤM viết bài theo thứ tự THẮNG (ghiLai trước, echo sau): bài đó ĐANG XANH
  // SẴN trên code hỏng, tức xanh giả. 35,3 % tin thật của bot rơi vào thứ tự THUA.
  const { db } = dbTam();

  // 1) Echo từ websocket tới TRƯỚC — mang tên hiển thị của bot, không có cờ.
  ghiTin(db, tinGia({
    msgId: 'm-bot', userId: BOT, tenLucGui: 'Hảis Assistant',
    noiDung: 'Dạ em đây ạ', tuToi: true,
  }));
  // 2) Rồi `ghiLai` của tầng gửi mới chạy.
  ghiTin(db, tinGia({
    msgId: 'm-bot', userId: BOT, tenLucGui: null, noiDung: 'Dạ em đây ạ', tuToi: true,
  }), { doTroLyTao: true });

  const r = db.prepare('SELECT * FROM tin_nhan WHERE msg_id = ?').get('m-bot');
  assert.equal(Number(r.do_tro_ly_tao), 1,
    'cờ phụ thuộc vào AI GHI TRƯỚC -> 35,3 % tin của bot mất cờ (đo thật trên DB 21/08 00:28)');

  // Hệ quả phải hết theo: bot không được coi là thành viên nhóm.
  const uids = dsNguoiTrongNhom(db, NHOM).map((n) => String(n.uid));
  assert.equal(uids.includes(BOT), false,
    'bot lọt vào danh sách người trong nhóm -> nó tự tag được chính nó');
  dongDb(db);
});

test('T3b-2 ★★ thứ tự THẮNG vẫn phải đúng (đối chứng — nếu không bài trên vô nghĩa)', () => {
  const { db } = dbTam();
  ghiTin(db, tinGia({ msgId: 'm-b2', userId: BOT, tenLucGui: null, tuToi: true }), { doTroLyTao: true });
  ghiTin(db, tinGia({ msgId: 'm-b2', userId: BOT, tenLucGui: 'Hảis Assistant', tuToi: true }));
  const r = db.prepare('SELECT * FROM tin_nhan WHERE msg_id = ?').get('m-b2');
  assert.equal(Number(r.do_tro_ly_tao), 1, 'echo tới sau KHÔNG được xoá cờ');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T3c — B1: "đã dành chỗ mà chưa rõ đã gửi"
// ═══════════════════════════════════════════════════════════════════════

test('T3c ★★★ nhanDangGui rồi CHẾT trước ghiKetQuaGui -> trang_thai VÀ so_nhac.md phải NÓI RA', () => {
  const { db, thuMuc } = dbTam();
  taoLich(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'gửi báo giá',
    guiLucMs: Date.now() - 1000, dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
    nguoiDat: HOST, chatIdDat: NHOM, ma: 'MOT1',
  });
  chotLich(db, { id: 'MOT1', ma: 'MOT1', nguoiDat: HOST });

  // Mô phỏng ĐÚNG cửa sổ chết: dành chỗ xong, tiến trình bị kill -> KHÔNG có catch nào.
  assert.equal(nhanDangGui(db, db.prepare("SELECT id FROM lich_hen WHERE ma_xac_nhan='MOT1'").get().id), true);

  const treo = layLichDanhChoChuaRoGui(db);
  assert.equal(treo.length, 1, 'trạng thái này VÔ HÌNH: msg_id_da_gui ghi 2 lần, đọc 0 lần');
  assert.equal(treo[0].ma, 'MOT1');

  // ★ Phải TỚI ĐƯỢC MẮT ANH — không chỉ tồn tại trong DB.
  const { goi } = dungTool(db);
  taoHangDoi(db, {
    requestId: 'r-tt', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'trạng thái', tsTao: new Date().toISOString(),
  });
  return goi(TEN_TOOL.TRANG_THAI, { request_id: 'r-tt' }).then((kq) => {
    assert.equal(kq.duLieu.soLichDanhChoChuaRoGui, 1);
    assert.ok(kq.duLieu.canhBao?.some((c) => /KHÔNG RÕ ĐÃ GỬI/.test(c)), 'tool phải nói ra');
    assert.ok(kq.duLieu.canhBao.some((c) => /ĐỪNG tự gửi lại/.test(c)),
      'phải dặn KHÔNG gửi lại — Zalo có thể đã nhận rồi');

    const f = path.join(thuMuc, 'so_nhac.md');
    sinhSoNhac(db, f);
    assert.match(fs.readFileSync(f, 'utf8'), /KHÔNG RÕ đã gửi hay chưa/, 'sổ nhắc cũng phải hiện');
    dongDb(db);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// T3d — B2: gửi hỏng phải có người biết
// ═══════════════════════════════════════════════════════════════════════

test('T3d ★★★ bộ chạy trả về `loi` -> phải có đường ra tới host (2 nhịp liên tiếp)', async () => {
  const { db } = dbTam();
  const nhac = nhacDaChot(db, { chuKyPhut: 1 });
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE id = ?').run(nhac.id);

  // Bộ đếm `loi` phải THẬT SỰ nhích khi gửi hỏng — không có nó thì index.js
  // không có gì để tiêu thụ.
  const ra = await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), truyVanLichSu, taoHangDoi,
    guiVaoNhom: async () => { throw new Error('bot bị kick khỏi nhóm'); },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
  });
  assert.equal(ra.loi, 1, 'gửi hỏng mà bộ đếm không nhích -> index.js không thể báo host');
  dongDb(db);
});

test('T3d-2 ★★★ _baoHetLuot KHÔNG được nói "đã nhắc đủ N lần" khi chưa có bằng chứng gửi', async () => {
  // 🔴 Sổ sách nói dối lần thứ hai: `so_lan_da_nhac` đếm LƯỢT DÀNH CHỖ, không
  // phải TIN ĐÃ TỚI NƠI. Bot bị kick thì mỗi nhịp vẫn tiêu một lượt rồi gửi hỏng,
  // và host nhận đúng câu "đã nhắc đủ 10 lần" cho việc CHƯA AI ĐƯỢC NHẮC.
  const { db } = dbTam();
  const nhac = nhacDaChot(db, { chuKyPhut: 1, tranSoLan: 1 });
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE id = ?').run(nhac.id);

  const dm = [];
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), truyVanLichSu, taoHangDoi,
    guiVaoNhom: async () => { throw new Error('bot bị kick khỏi nhóm'); },
    guiDmHost: async (_a, _c, text) => { dm.push(text); return { msgId: 'y' }; },
    dmHostChatId: 'dm-host',
    dsNguoiTrongNhom: () => [],
  });
  await new Promise((r) => setTimeout(r, 20));   // _baoHetLuot là fire-and-forget

  assert.equal(dm.length, 1);
  assert.doesNotMatch(dm[0], /đã nhắc đủ/i,
    'câu này khẳng định N TIN ĐÃ TỚI NƠI — trong khi chưa gửi nổi tin nào');
  assert.match(dm[0], /KHÔNG có bằng chứng/,
    'phải khai thẳng chỗ mình không biết, đúng mức đó chứ không hơn');
  assert.match(dm[0], /HẾT LƯỢT/, 'vẫn phải giữ: dừng vì hết lượt, KHÔNG phải vì xong việc');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T3e — A10: sổ nhắc nói đúng nhịp
// ═══════════════════════════════════════════════════════════════════════

test('T3e ★★★ so_nhac.md in ĐÚNG nhịp phút + trần, và cảnh báo bất biến vỡ', () => {
  const { db, thuMuc } = dbTam();
  nhacDaChot(db, { chuKyPhut: 3, tranSoLan: 10 });
  const f = path.join(thuMuc, 'so_nhac.md');

  sinhSoNhac(db, f);
  let txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /nhịp \*\*3 phút\*\*/, 'file thật ghi "nhịp 1 ngày lúc 08:00" cho một lời nhắc 3 PHÚT');
  assert.match(txt, /trần \*\*10\*\* lần/, 'không in trần -> anh không biết nó sẽ tự tắt lúc nào');
  assert.doesNotMatch(txt, /nhịp \*\*1 ngày\*\*/, 'không được in nhịp ngày cho lời nhắc nhịp phút');

  // Bất biến vỡ = đúng ca CGKJ trên DB thật: đã chốt sổ mà sổ vẫn báo đang theo đuổi.
  db.prepare("UPDATE lich_hen SET trang_thai = 'da_gui' WHERE ma_xac_nhan = 'NHAC'").run();
  assert.equal(layNhacBatBienVo(db).length, 1);
  sinhSoNhac(db, f);
  txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /BẤT THƯỜNG/, 'sổ vẫn liệt kê nó như đang chạy -> anh tưởng việc vẫn được đuổi');
  assert.match(txt, /SẼ KHÔNG BAO GIỜ NHẮC NỮA/);
  dongDb(db);
});

test('T3e-2 ★★ nhịp NGÀY vẫn in đúng kiểu ngày (đối chứng, chống vá quá tay)', () => {
  const { db, thuMuc } = dbTam();
  nhacDaChot(db, { gioNhac: '08:00' });   // mặc định: nhịp ngày
  const f = path.join(thuMuc, 'so_nhac.md');
  sinhSoNhac(db, f);
  const txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /nhịp \*\*1 ngày\*\* lúc \*\*08:00\*\*/);
  assert.match(txt, /không trần/, 'nhịp ngày KHÔNG có trần — phải nói rõ, đừng để trống');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T3f — lỗ phủ có sẵn: dat_lich_nhap.tagKhongTraRa
// ═══════════════════════════════════════════════════════════════════════

test('T3f ★★ dat_lich_nhap PHẢI trả `tagKhongTraRa` (lỗ phủ có sẵn, phát hiện ở cụm 2)', async () => {
  // Xoá trường này khỏi `_datLichNhap` thì TOÀN BỘ 741 test vẫn xanh — tức cảnh
  // báo "không tag được ai" của tool lịch MỘT LẦN chưa từng có ai canh.
  const { db } = dbTam();
  const { goi } = dungTool(db);
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'đặt lịch', tsTao: new Date().toISOString(),
  });

  const kq = await goi(TEN_TOOL_LICH.DAT_LICH_NHAP, {
    request_id: 'r1',
    guiLuc: new Date(Date.now() + 3600_000).toISOString(),
    noiDung: 'nhắc họp',
    tagUserIds: ['9999999999999'],       // uid chưa từng nhắn trong nhóm
    dienGiaiGoc: '1 tiếng nữa nhắc họp',
  });
  assert.equal(kq.ok, true, JSON.stringify(kq));
  assert.deepEqual(kq.duLieu.tagKhongTraRa, ['9999999999999'],
    'không trả trường này thì anh gõ "ok" cho một lịch không tag được ai mà không hay');
  dongDb(db);
});

test('T3d-3 ★★★ bộ đếm lỗi: 2 nhịp liên tiếp -> BÁO host; báo ĐÚNG MỘT LẦN; hồi phục cũng báo', async () => {
  // 🔴 Bài này sinh ra TỪ phép thử đột biến: bản đầu em viết logic này thành
  // closure bên trong `main()` của index.js, và vô hiệu hoá cả nhánh báo host
  // thì TOÀN BỘ 752 bài vẫn XANH. Thứ gì cần canh thì phải lôi ra khỏi `main()`.
  const bao = [];
  const dem = taoBoDemLoiGui(async (s) => { bao.push(s); });

  dem('nhắc theo đuổi', { loi: 1 });
  assert.equal(bao.length, 0, 'một nhịp hỏng thường chỉ là mạng chớp — báo ngay là làm phiền');

  dem('nhắc theo đuổi', { loi: 2 });
  assert.equal(bao.length, 1, 'hỏng 2 nhịp LIÊN TIẾP mà không ai được báo -> hỏng câm');
  assert.match(bao[0], /gửi HỎNG 2 nhịp liên tiếp/);
  assert.match(bao[0], /KHÔNG tới được ai/);

  // Nhịp 30 giây: báo mỗi nhịp = 120 tin/giờ vào DM -> tự biến cảnh báo thành rác.
  dem('nhắc theo đuổi', { loi: 1 });
  dem('nhắc theo đuổi', { loi: 1 });
  assert.equal(bao.length, 1, 'báo lại mỗi nhịp -> anh sẽ tắt thông báo, và mất luôn cảnh báo thật');

  dem('nhắc theo đuổi', { loi: 0 });
  assert.equal(bao.length, 2, 'im lặng khoẻ lại thì anh vẫn tưởng đang hỏng');
  assert.match(bao[1], /đã gửi lại được bình thường/);

  dem('nhắc theo đuổi', { loi: 0 });
  assert.equal(bao.length, 2, 'không được báo hồi phục lặp lại');

  // Hai bộ chạy đếm ĐỘC LẬP — lịch một lần hỏng không được che lời nhắc theo đuổi.
  dem('lịch một lần', { loi: 1 });
  dem('lịch một lần', { loi: 1 });
  assert.equal(bao.length, 3);
  assert.match(bao[2], /"lịch một lần"/);

  dem('gì đó', null);
  dem('gì đó', undefined);
  assert.equal(bao.length, 3, 'runner ném lỗi (ra = null) không được làm bộ đếm nổ');
});
