/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 5 — DỌN. B5 · A14.
 *
 * 🔴 B5 là loại bug KHÓ CANH NHẤT trong cả 5 cụm: hôm nay nó KHÔNG gây hại gì.
 *    `layBoiCanhNhac` tự giới hạn đúng một nhóm nên chưa rò. Cái sai là **lá chắn
 *    không được nạp đạn**: dữ liệu đi vào context model mà `boTichLuy` rỗng.
 *    ⇒ Bài test KHÔNG được viết theo kiểu "hôm nay có rò không" (hôm nay không rò,
 *      bài sẽ xanh trên cả code hỏng). Phải viết theo kiểu **"giả sử ngày mai ai đó
 *      nới bối cảnh ra nhóm khác — lá chắn có bật lên không?"**.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import { ghiTin, taoHangDoi, upsertHoiThoai } from '../src/store/write.js';
import { HUONG_TRA_LOI, TEN_TOOL_NHAC, TRANG_THAI_LICH } from '../src/lib/hang_so.js';
import { chotLich, taoLich } from '../src/lich/lich_hen.js';
import { taoNhacTheoDuoi } from '../src/lich/theo_duoi.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';
import { decideReplyRoute, createSourceLedger, getSources, recordSources } from '../src/policy/leak_guard.js';
import { registerTools } from '../src/mcp/tools.js';

const NHOM = '9990000000001';
const NHOM_KHAC = '111222333444';
const HOST = '555000111';
const TRONG = '9991000000000000001';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum5-'));
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

function nhacDaChot(db, v = {}) {
  const ma = v.ma ?? 'NHAC';
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: TRONG, ma, ...v,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  const d = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE id = ?').run(d.id);
  return d;
}

/** `truyVanLichSu` giả — mô phỏng ĐÚNG ca "ai đó nới bối cảnh sang nhóm khác". */
const truyVanChamNhomKhac = () => ({
  rows: [{ chat_id: NHOM_KHAC, user_id: TRONG, noi_dung: 'chuyện của nhóm B', ts_zalo: 1 }],
  nguonChatIds: [NHOM_KHAC],
});

// ═══════════════════════════════════════════════════════════════════════
// B5 — lá chắn chống rò chéo phải được NẠP ĐẠN
// ═══════════════════════════════════════════════════════════════════════

test('B5-a ★★★ bối cảnh chạm nhóm KHÁC -> nguồn PHẢI được khai vào boTichLuy', async () => {
  const db = dbTam();
  nhacDaChot(db);

  const daKhai = [];
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi,
    truyVanLichSu: truyVanChamNhomKhac,
    guiVaoNhom: async () => ({ msgId: 'x' }),
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: async () => true,
    recordSources: (rid, nguon) => daKhai.push({ rid, nguon }),
  });

  assert.equal(daKhai.length, 1,
    'dữ liệu vào context model mà KHÔNG khai nguồn -> leak_guard mù, lá chắn thành trang trí');
  assert.ok(daKhai[0].nguon.includes(NHOM_KHAC),
    `nguồn khai được là [${daKhai[0].nguon}] — thiếu nhóm B thì leak_guard tưởng đáp án sạch`);
  dongDb(db);
});

test('B5-b ★★★ lá chắn BẬT THẬT: nguồn khai được làm leak_guard chuyển sang DM host', async () => {
  // Bài này nối nguồn vừa bắt được vào ĐÚNG `leak_guard` thật, để chứng minh việc
  // khai nguồn có TÁC DỤNG THẬT chứ không chỉ là một mảng đẹp mắt.
  const db = dbTam();
  nhacDaChot(db);
  const bo = createSourceLedger();

  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi,
    truyVanLichSu: truyVanChamNhomKhac,
    guiVaoNhom: async () => ({ msgId: 'x' }),
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: async () => true,
    recordSources: (rid, nguon) => recordSources(bo, rid, nguon),
  });

  const rid = db.prepare('SELECT request_id FROM hang_doi_hoi LIMIT 1').get().request_id;
  const qd = decideReplyRoute({
    requestId: rid, chatIdHoi: NHOM, nguon: getSources(bo, rid), tonTaiHangDoi: true,
  });
  assert.equal(qd.huong, HUONG_TRA_LOI.DM_HOST,
    'đáp án mang dữ liệu nhóm B mà vẫn gửi thẳng vào nhóm A -> đúng ca lá chắn sinh ra để chặn');
  assert.deepEqual(qd.nguonLa, [NHOM_KHAC]);
  dongDb(db);
});

test('B5-c ★★★ FAIL-CLOSED: chạm nhóm khác mà chưa nối recordSources -> KHÔNG giao model', async () => {
  // ⛔ Không có nhánh "không chắc thì cứ gửi". Chưa có đường khai nguồn thì tuyệt đối
  // không đẩy dữ liệu nhóm khác vào context model — rơi xuống câu dự phòng do code
  // dựng, câu đó chỉ dùng `noi_dung` của chính dòng nhắc.
  const db = dbTam();
  nhacDaChot(db);

  let giaoModel = 0;
  const daGui = [];
  const ra = await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi,
    truyVanLichSu: truyVanChamNhomKhac,
    guiVaoNhom: async (_a, _c, t) => { daGui.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: async () => { giaoModel += 1; return true; },
    // ★ CỐ Ý KHÔNG truyền recordSources
  });

  assert.equal(giaoModel, 0, 'đã đẩy dữ liệu nhóm khác vào context model mà không có vết nguồn');
  assert.equal(ra.duPhong, 1, 'phải rơi xuống câu dự phòng, không được bỏ lượt nhắc');
  assert.equal(daGui.length, 1);
  assert.doesNotMatch(daGui[0], /nhóm B/, 'câu dự phòng KHÔNG được mang nội dung nhóm khác');
  dongDb(db);
});

test('B5-d ★★ bối cảnh CHỈ trong nhóm mình -> vẫn giao model bình thường (chống vá quá tay)', async () => {
  const db = dbTam();
  nhacDaChot(db);
  let giaoModel = 0;
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), taoHangDoi,
    truyVanLichSu: () => ({ rows: [], nguonChatIds: [NHOM] }),
    guiVaoNhom: async () => ({ msgId: 'x' }),
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: async () => { giaoModel += 1; return true; },
    // không có recordSources, nhưng cũng KHÔNG có nguồn lạ -> vẫn phải chạy đường model
  });
  assert.equal(giaoModel, 1, 'vá quá tay: chặn cả ca sạch thì lời nhắc mất hẳn giọng model');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// A14 — hai chốt mà `dat_lich_nhap` có, `dat_nhac_theo_duoi` thì không
// ═══════════════════════════════════════════════════════════════════════

function dungTool(db) {
  const nhatKy = [];
  let xuLy;
  registerTools({
    setRequestHandler(schema, fn) { if (schema?.shape?.method?.value === 'tools/call') xuLy = fn; },
  }, {
    db,
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: 'dm-host' }],
      groups: [
        { chatId: NHOM, ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true },
        { chatId: NHOM_KHAC, ten: 'Nhóm B', ghiLichSu: true, traLoiKhiTag: true },
      ],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [NHOM], xoa() {}, soPhien: () => 0 },
    api: { getOwnId: () => 'bot' },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    kho: { ghiNhatKyTruyVan: (_db, b) => { nhatKy.push(b); } },
  });
  return {
    nhatKy,
    goi: async (name, args) => JSON.parse((await xuLy({ params: { name, arguments: args } })).content[0].text),
  };
}

test('A14-a ★★★ trần số lịch đang chờ áp cho CẢ lời nhắc theo đuổi', async () => {
  // Model lỡ vòng lặp ở đây nặng hơn lịch một lần: mỗi dòng đẻ ra là một lời nhắc
  // LẶP LẠI, nhắc mãi tới khi có người vào đóng.
  const db = dbTam();
  for (let i = 0; i < 50; i += 1) {
    taoLich(db, {
      chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: `rác ${i}`,
      guiLucMs: Date.now() + 3600_000, dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
      nguoiDat: HOST, chatIdDat: NHOM, ma: `R${i}`,
    });
  }
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'nhắc nữa đi', tsTao: new Date().toISOString(),
  });

  const { goi } = dungTool(db);
  const kq = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: 'r1', noiDung: 'thêm một việc', dienGiaiGoc: 'nhắc tới khi xong',
  });
  assert.equal(kq.ok, false, 'không có trần -> model lỡ vòng lặp là đẻ hàng loạt lời nhắc LẶP LẠI');
  assert.match(kq.thongDiep, /trần 50/);
  assert.equal(
    db.prepare("SELECT count(*) c FROM lich_hen WHERE la_theo_duoi = 1").get().c, 0,
    'phải chặn TRƯỚC khi ghi DB',
  );
  dongDb(db);
});

test('A14-b ★★★ đặt nhắc CHÉO NHÓM phải để lại VẾT trong nhật ký', async () => {
  const db = dbTam();
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'nhắc bên nhóm B nhé', tsTao: new Date().toISOString(),
  });
  const { goi, nhatKy } = dungTool(db);

  const kq = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: 'r1', noiDung: 'chốt hộ', dienGiaiGoc: 'nhắc tới khi xong',
    chatIdDich: NHOM_KHAC,
  });
  assert.equal(kq.ok, true, JSON.stringify(kq));
  assert.equal(kq.duLieu.cheoNhom, true);
  assert.equal(nhatKy.length, 1, 'đứng nhóm A đặt nhắc vào nhóm B mà KHÔNG để lại vết nào');
  assert.equal(nhatKy[0].coCheo, 1);
  assert.deepEqual(nhatKy[0].nguonChatIds, [NHOM_KHAC]);
  dongDb(db);
});

test('A14-c ★★ đặt nhắc TRONG CÙNG nhóm thì KHÔNG ghi nhật ký chéo (chống nhiễu)', async () => {
  const db = dbTam();
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'nhắc ngay đây', tsTao: new Date().toISOString(),
  });
  const { goi, nhatKy } = dungTool(db);
  const kq = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: 'r1', noiDung: 'chốt hộ', dienGiaiGoc: 'nhắc tới khi xong',
  });
  assert.equal(kq.ok, true, JSON.stringify(kq));
  assert.equal(kq.duLieu.cheoNhom, false);
  assert.equal(nhatKy.length, 0, 'ghi nhật ký cho mọi lượt là làm loãng đúng thứ cần soi');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// A17 — chỉ thị "Read FULL mỗi run" đã bỏ, nội dung KHÔNG được mất
// ═══════════════════════════════════════════════════════════════════════

test('A17 ★★ luật "số ngày lấy từ tool, cấm tự nhẩm" phải nằm SẴN trong file luật', () => {
  // Bỏ chỉ thị Read thì luật duy nhất chỉ có ở `core-rules.md` phải được đưa sang
  // file agent — nếu không thì "bỏ bước không ai làm" hoá thành "mất một luật".
  // 🔴 CANH BẢN TRONG PACK, ⛔ KHÔNG phải bản ngoài.
  // Bản đầu trỏ `../../..` — hai cấp TRÊN gốc pack — tức nó đọc bản đang chạy
  // của người vận hành. Khi pack được chuyển ra khỏi cây thư mục đó (21/08/2026)
  // thì đường đó thành `/Users/.claude/...` ⇒ **ENOENT**, suite ĐỎ.
  // ⚠️ Và ngay cả khi còn với tới được thì nó vẫn SAI BẢN CHẤT: bài này canh
  // *"luật có nằm sẵn trong file luật không"*, mà thứ người khác clone về là
  // **bản trong pack**. Hai bài `luat_pack_khop_ban_chay` mới là chỗ đối chiếu
  // hai bản với nhau, và chúng đã có sẵn chốt cho phép bản ngoài vắng mặt.
  const s = fs.readFileSync(path.join(process.cwd(), '.claude/agents/zalo-nhom.md'), 'utf8');
  assert.match(s, /CẤM TỰ NHẨM|CẤM tự nhẩm/,
    'luật này trước đây CHỈ có trong core-rules.md — bỏ chỉ thị Read mà không đưa sang là mất luật');
  assert.match(s, /KHÔNG phải Read gì ở đầu run/,
    'phải nói rõ là đã bỏ chỉ thị, đừng để người sau tưởng vẫn còn');
});
