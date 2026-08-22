/**
 * ═══════════════════════════════════════════════════════════════════════
 * GIAO VIỆC CHO MODEL Ở CHẾ ĐỘ TÁCH (21/08/2026).
 *
 * Bệnh: ở `cheDo:"tach"`, daemon KHÔNG cầm phiên Claude nào ⇒ `guiThongBao` là
 * null ⇒ mọi lời nhắc rơi thẳng xuống câu dự phòng do CODE dựng ⇒ MẤT GIỌNG
 * MODEL. Đó là thứ duy nhất chặn việc bật chế độ tách trên máy thật.
 *
 * 🔴 BA THỨ PHẢI CANH CÙNG LÚC, thiếu một là bản vá thành lỗ hổng:
 *   ① tách  ⇒ việc được giao cho client (dòng `hang_doi_hoi` ở `'cho'`)
 *   ② tách + KHÔNG AI NHẶT ⇒ VẪN có tin đi ra (câu dự phòng) — ⛔ không im lặng
 *   ③ một-tiến-trình ⇒ y hệt hôm nay, kể cả nhánh `--khong-mcp`
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import {
  capNhatHangDoi, layHangDoiCho, taoHangDoi, upsertHoiThoai,
} from '../src/store/write.js';
import { pushPendingQueue } from '../src/mcp/channel.js';
import { CHE_DO, TRANG_THAI_HANG_DOI } from '../src/lib/hang_so.js';
import { chotLich } from '../src/lich/lich_hen.js';
import {
  docNhip, giuQuyenGuiNhac, taoNhacTheoDuoi, tranChoModelMs,
} from '../src/lich/theo_duoi.js';
import { chayNhipTheoDuoi, laCheDoTach } from '../src/lich/bo_chay.js';

const NHOM = '9990000000001';
const HOST = '555000111';
const NGUOI = '999888777';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-tach-'));
  RAC.push(d);
  const db = moDb(path.join(d, 'kho', 'lichsu.db'));
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  return db;
}

/** Lời nhắc THEO ĐUỔI đã chốt, tới hạn ngay. Nhịp NGÀY ⇒ trần chờ = 10 phút. */
function nhacDaChot(db, bayGio, v = {}) {
  const ma = v.ma ?? 'NHAC';
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: NGUOI, ma, ...v,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  db.prepare('UPDATE lich_hen SET gui_luc_ms = $g WHERE ma_xac_nhan = $m')
    .run({ g: bayGio - 1000, m: ma });
  return db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
}

const doc = (db, ma = 'NHAC') => db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);

/**
 * Bộ phụ thuộc của một nhịp. `guiThongBao` MẶC ĐỊNH null — đúng hoàn cảnh
 * daemon ở chế độ tách.
 */
function nhip(db, them = {}) {
  const vaoNhom = [];
  const p = {
    db,
    api: {},
    guiVaoNhom: async (_a, c, t) => { vaoNhom.push({ c, t }); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: null,
    taoHangDoi,
    dmHostChatId: 'dm-host',
    ...them,
  };
  return { p, vaoNhom };
}

const hangDoi = (db) => db.prepare('SELECT * FROM hang_doi_hoi ORDER BY ts_tao ASC').all();

// ═══════════════════════════════════════════════════════════════════════
// A — NHẬN DIỆN CHẾ ĐỘ. Phải là TÍN HIỆU DƯƠNG, không suy từ chỗ vắng mặt.
// ═══════════════════════════════════════════════════════════════════════

test('A1 — laCheDoTach: mặc định KHÔNG phải tách (không cờ, không env)', () => {
  assert.equal(laCheDoTach({}, {}, ['node', 'x']), false);
});

test('A2 — laCheDoTach đọc được cả ba nguồn, đúng thứ tự ưu tiên', () => {
  assert.equal(laCheDoTach({ cheDo: CHE_DO.TACH }, {}, []), true, 'p.cheDo');
  assert.equal(laCheDoTach({}, { ZTL_CHE_DO: CHE_DO.TACH }, []), true, 'env');
  assert.equal(laCheDoTach({}, {}, ['node', 'i.js', '--che-do', 'tach']), true, 'argv');
  // p.cheDo THẮNG env — chỗ gọi biết rõ hơn biến môi trường của cả máy.
  assert.equal(
    laCheDoTach({ cheDo: CHE_DO.MOT_TIEN_TRINH }, { ZTL_CHE_DO: CHE_DO.TACH }, []),
    false,
  );
});

test('A3 — 🔴 chế độ LẠ không được đọc thành tách (fail về phía an toàn)', () => {
  // Ba NGUỒN, và mỗi nguồn có phép so RIÊNG trong hàm ⇒ phải thử chuỗi lạ ở
  // CẢ BA. Bản đầu của bài này chỉ thử chuỗi lạ ở `p.cheDo`, nên con đột biến
  // đổi phép so của nhánh env/argv sang `.includes()` SỐNG SÓT: nhánh đó không
  // có bài nào nuôi chuỗi lạ vào. Một tính chất, ba đường vào — thiếu đường nào
  // là đường đó không được canh.
  assert.equal(laCheDoTach({ cheDo: 'tach-ra' }, {}, []), false, 'p.cheDo: chuỗi CHỨA "tach"');
  assert.equal(laCheDoTach({}, { ZTL_CHE_DO: 'tach-ra' }, []), false, 'env: chuỗi CHỨA "tach"');
  assert.equal(
    laCheDoTach({}, {}, ['node', 'i.js', '--che-do', 'mot-tien-trinh-tach']),
    false, 'argv: chuỗi CHỨA "tach"',
  );
  assert.equal(laCheDoTach({}, { ZTL_CHE_DO: 'TACH' }, []), false, 'phân biệt hoa thường');
  assert.equal(laCheDoTach({}, {}, ['node', 'i.js', '--che-do']), false, 'cờ thiếu giá trị');
});

// ═══════════════════════════════════════════════════════════════════════
// B — NGHIỆM THU ①: tách ⇒ việc được GIAO CHO CLIENT, chưa gửi gì cả
// ═══════════════════════════════════════════════════════════════════════

test('B1 — tách: lời nhắc tới giờ ⇒ tạo hàng đợi cho client, ⛔ KHÔNG gửi câu dự phòng', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.TACH });

  const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });

  assert.equal(ra.giaoModel, 1, 'tách mà không giao được model = mất giọng model');
  assert.equal(ra.duPhong, 0);
  assert.equal(vaoNhom.length, 0, 'chưa tới trần mà đã gửi câu máy móc = đúng bệnh cần chữa');

  const hd = hangDoi(db);
  assert.equal(hd.length, 1);
  assert.equal(hd[0].trang_thai, TRANG_THAI_HANG_DOI.CHO, "phải ở 'cho' thì client mới nhặt");
  assert.match(String(hd[0].msg_id), /^nhac:/, 'client/tra_loi nhận ra phiên nhắc qua tiền tố này');
  assert.match(String(hd[0].noi_dung), /LỜI NHẮC THEO ĐUỔI/, 'gói dữ kiện cho model phải có mặt');

  // 🔴 Token phải được đặt — đây là thứ giữ cho lưới an toàn còn bắn được.
  assert.ok(Number(doc(db).cho_model_tu_ms) > 0, 'thiếu token thì lượt nhắc mất ÂM THẦM');

  dongDb(db);
});

test('B2 — tách: client nhặt được đúng việc daemon vừa giao', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  const { p } = nhip(db, { cheDo: CHE_DO.TACH });
  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });

  // Phía client: đúng lời gọi `chayClient` dùng trong `khiSanSang`.
  const daBom = [];
  const kq = await pushPendingQueue({
    db,
    queueTtlMs: 1_800_000,
    guiThongBao: async (x) => { daBom.push(x); return true; },
    layHangDoiCho,
    capNhatHangDoi,
    tenHoiThoai: () => 'Nhóm thử',
  });

  assert.equal(kq.day, 1, 'client không nhặt được = việc nằm chết trong hàng đợi');
  assert.equal(daBom.length, 1);
  assert.match(String(daBom[0].noiDung), /LỜI NHẮC THEO ĐUỔI/);
  assert.equal(hangDoi(db)[0].trang_thai, TRANG_THAI_HANG_DOI.DA_DAY);

  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// C — NGHIỆM THU ②: tách + KHÔNG AI NHẶT ⇒ VẪN CÓ TIN ĐI RA
//     🔴 Đây là bài quan trọng nhất cả file. Anh đã chốt: nhắc tới khi xong.
// ═══════════════════════════════════════════════════════════════════════

test('C1 ★★★ tách, không client nào nhặt: quá trần ⇒ code gửi câu dự phòng, ⛔ KHÔNG im lặng', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  const d0 = nhacDaChot(db, bayGio);
  const tran = tranChoModelMs(docNhip(d0));
  const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.TACH });

  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });
  assert.equal(vaoNhom.length, 0);

  // Chưa tới trần: vẫn nhường model.
  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio + tran - 1000 });
  assert.equal(vaoNhom.length, 0, 'bắn sớm là cướp lượt của model');

  // Quá trần mà client vẫn im -> code phải bù.
  const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio + tran });
  assert.equal(ra.duPhong, 1, 'quá trần mà không ai gửi = lời nhắc bốc hơi');
  assert.equal(vaoNhom.length, 1);
  assert.equal(vaoNhom[0].c, NHOM);

  dongDb(db);
});

test('C2 — trần chờ là HÀM CỦA NHỊP, không phải hằng số (nhịp phút ngắn hơn)', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  const d0 = nhacDaChot(db, bayGio, { chuKyPhut: 4 });
  const tran = tranChoModelMs(docNhip(d0));
  assert.equal(tran, 120_000, 'nhịp 4 phút ⇒ trần = nửa nhịp = 120 giây');

  const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.TACH });
  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });
  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio + tran - 1 });
  assert.equal(vaoNhom.length, 0);
  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio + tran });
  assert.equal(vaoNhom.length, 1);

  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// D — NGHIỆM THU ⑤: ⛔ KHÔNG GỬI ĐÔI ở bất kỳ chiều nào
// ═══════════════════════════════════════════════════════════════════════

test('D1 ★★★ tách: model trả lời rồi thì lưới KHÔNG bù thêm một tin nữa', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  const d0 = nhacDaChot(db, bayGio);
  const tran = tranChoModelMs(docNhip(d0));
  const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.TACH });

  await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });

  // Client nhặt, model gọi `tra_loi` -> tool GIỮ QUYỀN GỬI (xoá token).
  const giu = giuQuyenGuiNhac(db, d0.id);
  assert.equal(giu.ok, true, 'tiền đề: model phải giành được quyền gửi');

  // Nhiều nhịp sau, quá trần từ lâu: lưới KHÔNG được bù.
  for (let i = 1; i <= 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio + tran * i });
  }
  assert.equal(vaoNhom.length, 0, 'model đã gửi mà code bù thêm = HAI tin vào nhóm người thật');

  dongDb(db);
});

test('D2 — tách: hai nhịp chồng nhau chỉ giao model MỘT lần', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.TACH });

  const a = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });
  const b = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });
  assert.equal(a.giaoModel + b.giaoModel, 1, 'nhắc chồng nhắc = hai phiên cho một lượt');
  assert.equal(hangDoi(db).length, 1);
  assert.equal(vaoNhom.length, 0);

  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E — NGHIỆM THU ④: CHẾ ĐỘ MỘT-TIẾN-TRÌNH KHÔNG ĐỔI MỘT HÀNH VI NÀO
//     ⚠️ Có lịch T7 07:00 đã chốt đang chờ bắn trên máy anh.
// ═══════════════════════════════════════════════════════════════════════

test('E1 ★★★ một-tiến-trình + `--khong-mcp`: gửi câu dự phòng NGAY, ⛔ không chờ trần', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  // KHÔNG khai cheDo ⇒ mặc định một-tiến-trình. `guiThongBao` null = --khong-mcp.
  const { p, vaoNhom } = nhip(db);

  const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });

  assert.equal(ra.duPhong, 1, 'chờ trần ở chế độ này = đổi hành vi của đường đang chạy thật');
  assert.equal(ra.giaoModel, 0);
  assert.equal(vaoNhom.length, 1, 'tin phải đi ra NGAY trong chính nhịp này');
  assert.equal(hangDoi(db).length, 0, 'không có client nào thì đừng tạo hàng đợi mồ côi');
  assert.equal(doc(db).cho_model_tu_ms, null, 'không đặt token cho một phiên không tồn tại');

  dongDb(db);
});

test('E2 — một-tiến-trình + CÓ phiên Claude: đi đúng đường notify như cũ', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  const daBom = [];
  const { p, vaoNhom } = nhip(db, {
    guiThongBao: async (x) => { daBom.push(x); return true; },
  });

  const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });

  assert.equal(ra.giaoModel, 1);
  assert.equal(daBom.length, 1, 'đường notify trực tiếp phải còn nguyên');
  assert.equal(vaoNhom.length, 0);
  assert.equal(hangDoi(db).length, 1);

  dongDb(db);
});

test('E3 — 🔴 biến môi trường của MÁY không được lật hành vi khi chỗ gọi đã khai rõ', async () => {
  const cu = process.env.ZTL_CHE_DO;
  process.env.ZTL_CHE_DO = CHE_DO.TACH;   // máy đang chạy tách ở chỗ khác
  try {
    const db = dbTam();
    const bayGio = Date.now();
    nhacDaChot(db, bayGio);
    const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.MOT_TIEN_TRINH });

    const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });
    assert.equal(ra.duPhong, 1);
    assert.equal(vaoNhom.length, 1);

    dongDb(db);
  } finally {
    if (cu === undefined) delete process.env.ZTL_CHE_DO;
    else process.env.ZTL_CHE_DO = cu;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// F — LÁ CHẮN CHỐNG RÒ CHÉO KHÔNG ĐƯỢC NỚI RA THEO
// ═══════════════════════════════════════════════════════════════════════

test('F1 — tách: bối cảnh chạm nhóm KHÁC mà chưa nối recordSources ⇒ vẫn FAIL-CLOSED', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  const { p, vaoNhom } = nhip(db, {
    cheDo: CHE_DO.TACH,
    // Tầng truy vấn khai có chạm một nhóm KHÁC...
    truyVanLichSu: () => ({ dong: [], nguonChatIds: ['9990000009999'] }),
    // ...mà KHÔNG có đường khai nguồn.
  });

  const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });
  assert.equal(ra.giaoModel, 0, 'nới fail-closed để lấy giọng model = mở đúng cửa leak_guard cấm');
  assert.equal(ra.duPhong, 1);
  assert.equal(vaoNhom.length, 1, 'fail-closed vẫn phải CÓ tin đi ra');
  assert.equal(hangDoi(db).length, 0);

  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// G — DÒNG `da_day` KẸT Ở CHẾ ĐỘ TÁCH VẪN CÓ ĐƯỜNG RA
//
// 🔴 EM KHÔNG LÀM THEO ĐỀ NGHỊ A2 ("đặt lại dòng về 'cho'"), và đây là bài
//    chứng minh vì sao KHÔNG CẦN: `pushPendingQueue` của client gọi
//    `layHangDoiCho(..., { gomDaDay: true })` ⇒ dòng kẹt `'da_day'` ĐÃ được
//    client nhặt lại sẵn, không phải đổi trạng thái gì cả.
// ⚠️ Bài này càng quan trọng SAU khi lưới canh `hang_doi_hoi` bị bỏ hẳn
//    (21/08/2026): nó là bằng chứng duy nhất còn lại rằng dòng kẹt KHÔNG rơi
//    vào im lặng — client nhặt lại, hoặc `layHangDoiCho` đánh `het_han` kèm
//    `baoHetHan` báo host.
// ═══════════════════════════════════════════════════════════════════════

test('G1 — tách: dòng kẹt "da_day" ĐÃ được client nhặt lại, không cần đặt về "cho"', async () => {
  const db = dbTam();
  taoHangDoi(db, {
    requestId: 'r-ket', chatIdHoi: NHOM, msgId: 'm-1', userId: HOST,
    noiDung: 'tóm tắt sáng nay nhóm này trao đổi gì', tsTao: new Date().toISOString(),
  });
  capNhatHangDoi(db, 'r-ket', TRANG_THAI_HANG_DOI.DA_DAY);

  const daBom = [];
  const kq = await pushPendingQueue({
    db,
    queueTtlMs: 1_800_000,
    guiThongBao: async (x) => { daBom.push(x); return true; },
    layHangDoiCho,
    capNhatHangDoi,
    tenHoiThoai: () => 'Nhóm thử',
  });

  assert.equal(kq.day, 1);
  assert.equal(daBom[0].requestId, 'r-ket');
  assert.match(String(daBom[0].noiDung), /tóm tắt sáng nay/);

  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// H — CHỖ GỌI QUÊN TRUYỀN `taoHangDoi`: dù đi nhánh nào cũng phải CÓ TIN ĐI RA
//
// 🔴 Bài này sinh ra từ một con đột biến SỐNG SÓT (P12: bỏ điều kiện
//    `p.taoHangDoi`). Em KHÔNG nhận vơ là "test yếu": đo thật thì hai bản cho
//    KẾT QUẢ QUAN SÁT ĐƯỢC GIỐNG HỆT —
//      · bản gốc : `giaoDuocChoModel = false` -> rơi thẳng (b1), gửi dự phòng
//      · bản đột biến: vào nhánh (a), `p.taoHangDoi(...)` NÉM, `catch` nuốt,
//        rồi cũng rơi xuống (b1) và gửi dự phòng
//    ⇒ ĐỘT BIẾN TƯƠNG ĐƯƠNG về hành vi. Điều kiện `p.taoHangDoi` là hàng rào
//      PHÒNG THỦ (tránh một vòng ném-bắt và một khoảnh khắc token treo lửng),
//      ⛔ không phải thứ quyết định người dùng có nhận được tin hay không.
//    Bài dưới đây pin cái THẬT SỰ quan trọng: tin vẫn đi ra, và token sạch.
// ═══════════════════════════════════════════════════════════════════════

test('H1 — tách nhưng chỗ gọi QUÊN taoHangDoi: vẫn có tin đi ra và token không treo', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, bayGio);
  const { p, vaoNhom } = nhip(db, { cheDo: CHE_DO.TACH, taoHangDoi: undefined });

  const ra = await chayNhipTheoDuoi({ ...p, bayGioMs: bayGio });

  assert.equal(vaoNhom.length, 1, 'thiếu một phụ thuộc mà im lặng = lời nhắc bốc hơi');
  assert.equal(ra.duPhong, 1);
  assert.equal(hangDoi(db).length, 0, 'không có đường tạo hàng đợi thì đừng để lại phiên mồ côi');
  assert.equal(doc(db).cho_model_tu_ms, null,
    'token treo lửng = nhịp sau lưới bù thêm một tin nữa cho lượt đã gửi rồi');

  dongDb(db);
});
