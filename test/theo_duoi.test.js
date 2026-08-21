/**
 * v4 — test LỜI NHẮC THEO ĐUỔI TỚI KHI XONG.
 *
 * 🔴 Tính năng này nhắn vào NHÓM CÓ NGƯỜI THẬT, MỖI SÁNG, KHÔNG CÓ TRẦN.
 * Nên bộ test tập trung vào đúng những chỗ mà sai một cái là làm phiền người
 * khác hoặc bỏ rơi việc thật:
 *   · không nhắc hai lần cùng một lượt
 *   · CHỈ HOST đổi được nhịp / đóng được lời nhắc
 *   · van xả có tác dụng THẬT (đổi nhịp là mốc kế tiếp phải đổi theo)
 *   · Chủ Nhật không nhắc, Thứ Bảy VẪN nhắc
 *   · model im lặng thì code vẫn gửi — không để lời nhắc biến mất âm thầm
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import { ghiTin, taoHangDoi, upsertHoiThoai } from '../src/store/write.js';
import { truyVanLichSu } from '../src/store/query.js';
import { NHAC_THEO_DUOI, TRANG_THAI_LICH, TRANG_THAI_TD } from '../src/lib/hang_so.js';
import { chotLich } from '../src/lich/lich_hen.js';
import {
  cauNhacDuPhong, chinhNhip, danhChoLuotNhac, docGioNhac, dongNhac,
  layBoiCanhNhac, layNhacDenHan, mocNhacKeTiep, mocTuGioDiaPhuong,
  ngayDiaPhuong, sinhSoNhac, taoNhacTheoDuoi, xemNhacTheoDuoi,
} from '../src/lich/theo_duoi.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';

const RAC = [];
function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-td-'));
  RAC.push(d);
  return { db: moDb(path.join(d, 'kho', 'lichsu.db')), thuMuc: d };
}
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

const NHOM = '9990000000001';
const HOST = '555000111';
const NGUOI = '999888777';
const TZ = 'Asia/Ho_Chi_Minh';

function nhacGia(db, v = {}) {
  const kq = taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'gửi báo giá',
    dienGiaiGoc: 'nhắc tới khi nào xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: NGUOI,
    ma: 'AAAA', ...v,
  });
  return kq;
}
function chot(db, ma = 'AAAA') {
  return chotLich(db, { id: ma, ma, nguoiDat: HOST });
}

// ═══════════════════════════════════════════════════════════════════════
// A. LỊCH THEO MÚI GIỜ
// ═══════════════════════════════════════════════════════════════════════

test('A1 ★ mốc 08:00 tính theo MÚI GIỜ tường minh, không theo giờ máy', () => {
  const moc = mocTuGioDiaPhuong(2026, 8, 24, 8, 0, TZ);   // 08:00 giờ VN
  assert.equal(new Date(moc).toISOString(), '2026-08-24T01:00:00.000Z');
});

test('A2 ngayDiaPhuong trả đúng thứ (0 = Chủ Nhật)', () => {
  // 23/08/2026 là Chủ Nhật.
  assert.equal(ngayDiaPhuong(Date.parse('2026-08-23T03:00:00Z'), TZ).thu, 0);
  assert.equal(ngayDiaPhuong(Date.parse('2026-08-22T03:00:00Z'), TZ).thu, 6, 'Thứ Bảy');
});

test('A3 ★★ CHỪA CHỦ NHẬT, nhưng THỨ BẢY VẪN NHẮC', () => {
  // Thứ Sáu 21/08 sau giờ nhắc -> kế tiếp phải là THỨ BẢY 22/08, không nhảy qua.
  const thuSau = Date.parse('2026-08-21T02:00:00Z');   // 09:00 VN thứ Sáu
  const ke = mocNhacKeTiep(thuSau, { chuKyNgay: 1, gioNhac: '08:00', boChuNhat: true, muiGio: TZ });
  assert.equal(ngayDiaPhuong(ke, TZ).ngay, 22, 'Thứ Bảy VẪN nhắc — anh chốt vậy');

  // Từ Thứ Bảy -> kế tiếp rơi vào Chủ Nhật 23 ⇒ phải nhảy sang Thứ Hai 24.
  const thuBay = Date.parse('2026-08-22T02:00:00Z');
  const ke2 = mocNhacKeTiep(thuBay, { chuKyNgay: 1, gioNhac: '08:00', boChuNhat: true, muiGio: TZ });
  assert.equal(ngayDiaPhuong(ke2, TZ).ngay, 24, 'Chủ Nhật phải bị chừa');
  assert.equal(ngayDiaPhuong(ke2, TZ).thu, 1);
});

test('A4 boChuNhat=false thì Chủ Nhật vẫn nhắc', () => {
  const thuBay = Date.parse('2026-08-22T02:00:00Z');
  const ke = mocNhacKeTiep(thuBay, { chuKyNgay: 1, gioNhac: '08:00', boChuNhat: false, muiGio: TZ });
  assert.equal(ngayDiaPhuong(ke, TZ).ngay, 23);
});

test('A5 chu kỳ 2 ngày cộng đúng 2 ngày', () => {
  const t2 = Date.parse('2026-08-24T01:00:00Z');   // Thứ Hai 08:00 VN
  const ke = mocNhacKeTiep(t2, { chuKyNgay: 2, gioNhac: '08:00', boChuNhat: true, muiGio: TZ });
  assert.equal(ngayDiaPhuong(ke, TZ).ngay, 26, 'Thứ Tư');
});

test('A6 lần ĐẦU: chưa tới giờ nhắc hôm nay -> nhắc NGAY hôm nay', () => {
  const sang = Date.parse('2026-08-24T00:00:00Z');   // 07:00 VN thứ Hai
  const ke = mocNhacKeTiep(sang, { gioNhac: '08:00', boChuNhat: true, muiGio: TZ, laLanDau: true });
  assert.equal(new Date(ke).toISOString(), '2026-08-24T01:00:00.000Z');
});

test('A7 giờ nhắc rác -> rơi về mặc định 08:00, KHÔNG ném', () => {
  assert.deepEqual(docGioNhac('25:99'), { gio: 8, phut: 0 });
  assert.deepEqual(docGioNhac('13:30'), { gio: 13, phut: 30 });
});

// ═══════════════════════════════════════════════════════════════════════
// B. VÒNG ĐỜI
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★ tạo xong vẫn phải CHỜ XÁC NHẬN — chưa chốt thì không tới hạn', () => {
  const { db } = dbTam();
  nhacGia(db);
  // Kể cả đã quá giờ.
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  assert.deepEqual(layNhacDenHan(db, Date.now()), []);
  dongDb(db);
});

test('B2 chốt rồi mới vào danh sách tới hạn', () => {
  const { db } = dbTam();
  nhacGia(db);
  chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  assert.equal(layNhacDenHan(db, Date.now()).length, 1);
  dongDb(db);
});

test('B3 ★ mặc định đúng 5 điều anh chốt: 1 ngày, 08:00, chừa CN, theo đuổi', () => {
  const { db } = dbTam();
  nhacGia(db);
  const d = db.prepare('SELECT * FROM lich_hen LIMIT 1').get();
  assert.equal(Number(d.la_theo_duoi), 1);
  assert.equal(Number(d.chu_ky_ngay), NHAC_THEO_DUOI.CHU_KY_NGAY_MAC_DINH);
  assert.equal(Number(d.chu_ky_ngay), 1);
  assert.equal(d.gio_nhac, '08:00');
  assert.equal(Number(d.bo_chu_nhat), 1);
  assert.equal(d.trang_thai_td, TRANG_THAI_TD.DANG_THEO_DUOI);
  dongDb(db);
});

test('B4 ★★ KHÔNG CÓ TRẦN LEO THANG — nhắc 500 lần vẫn còn sống', () => {
  // Anh BÁC trần leo thang. Bài này canh để không ai lặng lẽ thêm lại.
  const { db } = dbTam();
  nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET so_lan_da_nhac = 500, gui_luc_ms = 1');
  assert.equal(layNhacDenHan(db, Date.now()).length, 1, 'đã nhắc 500 lần vẫn phải tiếp tục');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// C. NHẮC ĐÚNG MỘT LẦN MỖI LƯỢT
// ═══════════════════════════════════════════════════════════════════════

test('C1 ★ danhChoLuotNhac chỉ thành công MỘT lần, và DỜI mốc ngay', () => {
  const { db } = dbTam();
  nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  const d = db.prepare('SELECT * FROM lich_hen LIMIT 1').get();
  const a = danhChoLuotNhac(db, d, Date.now());
  assert.equal(a.ok, true);
  assert.ok(a.mocKeTiepMs > Date.now(), 'mốc kế tiếp phải nằm ở tương lai');
  // Nhịp thứ hai cầm bản ghi CŨ -> phải trượt.
  assert.equal(danhChoLuotNhac(db, d, Date.now()).ok, false, 'nhắc hai lần là làm phiền người thật');
  const sau = db.prepare('SELECT * FROM lich_hen LIMIT 1').get();
  assert.equal(Number(sau.so_lan_da_nhac), 1);
  assert.ok(Number(sau.nhac_lan_cuoi_ms) > 0);
  dongDb(db);
});

test('C2 ★ hai nhịp CHỒNG NHAU -> chỉ gửi 1 tin', async () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  const gui = [];
  const p = {
    db,
    api: {},
    guiVaoNhom: async () => { await new Promise((r) => setTimeout(r, 5)); gui.push(1); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    truyVanLichSu,
  };
  await Promise.all([chayNhipTheoDuoi(p), chayNhipTheoDuoi(p)]);
  assert.equal(gui.length, 1);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// D. VAN XẢ — thứ DUY NHẤT thay cho trần leo thang
// ═══════════════════════════════════════════════════════════════════════

test('D1 ★★ NGƯỜI KHÁC trong nhóm KHÔNG đổi được nhịp', () => {
  // Thiếu chốt này thì đúng người đang bị nhắc tự tắt được lời nhắc của mình.
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  const kq = chinhNhip(db, { id, laHost: false, chuKyNgay: 30 });
  assert.equal(kq.ok, false);
  assert.equal(kq.ly, 'KHONG_PHAI_HOST');
  assert.equal(Number(db.prepare('SELECT chu_ky_ngay c FROM lich_hen LIMIT 1').get().c), 1);
  dongDb(db);
});

test('D2 ★★ host giãn nhịp -> chu kỳ ĐỔI và mốc kế tiếp DỜI theo', () => {
  // "2 ngày check lại 1 lần cho anh" — model quy đổi thành chuKyNgay = 2.
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  const truoc = Number(db.prepare('SELECT gui_luc_ms g FROM lich_hen LIMIT 1').get().g);
  const kq = chinhNhip(db, { id, laHost: true, chuKyNgay: 2 });
  assert.equal(kq.ok, true);
  assert.equal(Number(kq.dong.chu_ky_ngay), 2);
  assert.ok(
    Number(kq.dong.gui_luc_ms) > truoc,
    'đổi nhịp mà mốc kế tiếp không dời thì lượt sau vẫn chạy nhịp cũ — van xả thành trang trí',
  );
  dongDb(db);
});

test('D3 ★ host TẠM DỪNG -> không còn tới hạn nữa', () => {
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  assert.equal(layNhacDenHan(db, Date.now()).length, 1);
  chinhNhip(db, { id, laHost: true, tamDungToiMs: Date.now() + 86_400_000 });
  assert.deepEqual(layNhacDenHan(db, Date.now()), []);
  dongDb(db);
});

test('D4 tạm dừng hết hạn -> tự chạy lại, không cần ai bật', () => {
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  chinhNhip(db, { id, laHost: true, tamDungToiMs: Date.now() - 1000 });
  db.exec(`UPDATE lich_hen SET gui_luc_ms = 1, trang_thai_td = '${TRANG_THAI_TD.DANG_THEO_DUOI}'`);
  assert.equal(layNhacDenHan(db, Date.now()).length, 1);
  dongDb(db);
});

test('D5 chu kỳ vô lý (0, âm, 9999) -> TỪ CHỐI, không im lặng nhận bừa', () => {
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  for (const ck of [0, -3, 9999]) {
    assert.equal(chinhNhip(db, { id, laHost: true, chuKyNgay: ck }).ly, 'CHU_KY_LA', `ck=${ck}`);
  }
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E. ĐÓNG — CHỈ HOST
// ═══════════════════════════════════════════════════════════════════════

test('E1 ★★ NGƯỜI KHÁC nói "xong rồi" KHÔNG đóng được lời nhắc', () => {
  // Trợ lý tự suy "ok xong rồi" là xong = IM LẶNG BỎ RƠI MỘT VIỆC THẬT.
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  const kq = dongNhac(db, { id, nguoiDong: NGUOI, laHost: false });
  assert.equal(kq.ok, false);
  assert.equal(kq.ly, 'KHONG_PHAI_HOST');
  assert.equal(
    db.prepare('SELECT trang_thai_td t FROM lich_hen LIMIT 1').get().t,
    TRANG_THAI_TD.DANG_THEO_DUOI,
    'vẫn phải theo đuổi tiếp',
  );
  dongDb(db);
});

test('E2 host đóng -> ghi rõ AI đóng và LÚC NÀO, hết tới hạn', () => {
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  const kq = dongNhac(db, { id, nguoiDong: HOST, laHost: true, bayGioMs: 1_700_000_000_000 });
  assert.equal(kq.ok, true);
  assert.equal(kq.dong.trang_thai_td, TRANG_THAI_TD.DA_XONG);
  assert.equal(kq.dong.dong_boi, HOST);
  assert.equal(Number(kq.dong.dong_luc_ms), 1_700_000_000_000);
  assert.equal(kq.dong.ly_do_dong, 'HOST_DONG');
  assert.deepEqual(layNhacDenHan(db, Date.now()), []);
  dongDb(db);
});

test('E3 đóng hai lần -> lần hai từ chối', () => {
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  dongNhac(db, { id, nguoiDong: HOST, laHost: true });
  assert.equal(dongNhac(db, { id, nguoiDong: HOST, laHost: true }).ly, 'DA_XONG');
  dongDb(db);
});

test('E4 đã đóng thì không chỉnh nhịp được nữa', () => {
  const { db } = dbTam();
  const { id } = nhacGia(db); chot(db);
  dongNhac(db, { id, nguoiDong: HOST, laHost: true });
  assert.equal(chinhNhip(db, { id, laHost: true, chuKyNgay: 3 }).ly, 'DA_XONG');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// F. BỐI CẢNH — dữ kiện cho model, KHÔNG phải mẫu câu
// ═══════════════════════════════════════════════════════════════════════

test('F1 ★ tầng truy vấn cấp SỐ NGÀY và LỜI NGƯỜI ĐÓ ĐÃ NÓI — model không tự đếm', () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  const bayGio = Date.parse('2026-08-25T02:00:00Z');
  db.exec(`UPDATE lich_hen SET nhac_lan_cuoi_ms = ${bayGio - 86_400_000}, so_lan_da_nhac = 3`);
  ghiTin(db, {
    chatId: NHOM, msgId: 'm1', cliMsgId: null, userId: NGUOI, tenLucGui: 'Anh B',
    msgType: 'chat.text', noiDung: 'em đang làm, mai gửi nhé', contentRaw: null,
    tsZalo: bayGio - 3_600_000, tuToi: false, coTagHost: false,
  });
  const d = db.prepare('SELECT * FROM lich_hen LIMIT 1').get();
  const bc = layBoiCanhNhac(db, d, { bayGioMs: bayGio, truyVan: truyVanLichSu });
  assert.equal(bc.soLanDaNhac, 3);
  assert.equal(bc.soNgayTuLanNhacTruoc, 1);
  assert.equal(bc.nguoiPhuTrachDaNoiGi.length, 1);
  assert.match(bc.nguoiPhuTrachDaNoiGi[0].noiDung, /mai gửi/);
  dongDb(db);
});

test('F2 người phụ trách CHƯA nói gì -> danh sách rỗng (không bịa)', () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  const d = db.prepare('SELECT * FROM lich_hen LIMIT 1').get();
  const bc = layBoiCanhNhac(db, d, { bayGioMs: Date.now(), truyVan: truyVanLichSu });
  assert.deepEqual(bc.nguoiPhuTrachDaNoiGi, []);
  dongDb(db);
});

test('F3 ★ bối cảnh KHÔNG có trường "nghi đã xong" — cấm suy hộ rồi đóng', () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  const d = db.prepare('SELECT * FROM lich_hen LIMIT 1').get();
  const bc = layBoiCanhNhac(db, d, { truyVan: truyVanLichSu });
  for (const k of Object.keys(bc)) {
    assert.ok(!/xong|hoanThanh|daXong/i.test(k), `bối cảnh không được gợi ý kết luận: ${k}`);
  }
  dongDb(db);
});

test('F4 ★ câu dự phòng KHÁC nhau theo số lần đã nhắc (không lặp y nguyên)', () => {
  const d = { noi_dung: 'gửi báo giá' };
  const a = cauNhacDuPhong(d, { soLanDaNhac: 0, soNgayTuKhiDat: 0, nguoiPhuTrachDaNoiGi: [] });
  const b = cauNhacDuPhong(d, { soLanDaNhac: 4, soNgayTuKhiDat: 5, nguoiPhuTrachDaNoiGi: [] });
  const c = cauNhacDuPhong(d, {
    soLanDaNhac: 4, soNgayTuKhiDat: 5, nguoiPhuTrachDaNoiGi: [{ noiDung: 'mai gửi' }],
  });
  assert.notEqual(a, b, 'lần đầu và lần thứ 5 phải khác nhau');
  assert.notEqual(b, c, 'có nhắn lại rồi thì câu phải khác');
  assert.match(b, /5 ngày/);
  assert.match(c, /chưa chốt ngày/);
});

// ═══════════════════════════════════════════════════════════════════════
// G. KHÔNG ĐỂ LỜI NHẮC BIẾN MẤT ÂM THẦM
// ═══════════════════════════════════════════════════════════════════════

test('G1 ★ có Claude -> giao model viết câu, KHÔNG tự gửi câu cứng', async () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  const gui = [];
  const bao = [];
  const kq = await chayNhipTheoDuoi({
    db, api: {}, truyVanLichSu, taoHangDoi,
    guiVaoNhom: async (...a) => { gui.push(a); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: async (n) => { bao.push(n); return true; },
  });
  assert.equal(kq.giaoModel, 1);
  assert.equal(gui.length, 0, 'có model thì để model viết, đừng bắn câu cứng');
  assert.match(bao[0].noiDung, /LỜI NHẮC THEO ĐUỔI/);
  assert.match(bao[0].noiDung, /Đã nhắc: 0 lần/, 'dữ kiện do tầng truy vấn cấp');
  assert.equal(bao[0].chatId, NHOM);
  dongDb(db);
});

test('G2 ★★ KHÔNG có Claude -> code vẫn gửi, lời nhắc không biến mất', async () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  const gui = [];
  const kq = await chayNhipTheoDuoi({
    db, api: {}, truyVanLichSu,
    guiVaoNhom: async (_a, c, t) => { gui.push({ c, t }); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [{ uid: NGUOI, ten: 'Anh B' }],
    guiThongBao: null,
  });
  assert.equal(kq.duPhong, 1);
  assert.equal(gui.length, 1);
  assert.match(gui[0].t, /@Anh B/, 'phải TAG THẲNG người phụ trách');
  assert.match(gui[0].t, /gửi báo giá/);
  dongDb(db);
});

test('G3 ★★ model IM quá trần -> code gửi bù, không bỏ lượt', async () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  // Giả lập: đã giao model từ lâu mà chưa có tin nào gửi đi.
  db.exec(`UPDATE lich_hen SET cho_model_tu_ms = ${Date.now() - NHAC_THEO_DUOI.TRAN_CHO_MODEL_MS - 1000}`);
  const gui = [];
  const kq = await chayNhipTheoDuoi({
    db, api: {}, truyVanLichSu, taoHangDoi,
    guiVaoNhom: async (_a, c, t) => { gui.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
    guiThongBao: async () => true,
  });
  assert.equal(kq.duPhong, 1, 'model im mà cũng im theo là để việc rơi không ai biết');
  assert.equal(gui.length, 1);
  assert.equal(
    db.prepare('SELECT cho_model_tu_ms c FROM lich_hen LIMIT 1').get().c, null,
    'gửi bù xong phải xoá cờ chờ, không gửi bù mãi',
  );
  dongDb(db);
});

test('G4 uid không tra ra tên -> BỎ tag, tin VẪN gửi (cấm bịa tên)', async () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');
  const gui = [];
  await chayNhipTheoDuoi({
    db, api: {}, truyVanLichSu,
    guiVaoNhom: async (_a, c, t) => { gui.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],          // không tra ra ai
    guiThongBao: null,
  });
  assert.equal(gui.length, 1);
  assert.ok(!gui[0].includes('@'), 'không có @ rác trong tin');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// H. SỔ NHẮC DỄ ĐỌC
// ═══════════════════════════════════════════════════════════════════════

test('H1 ★ sinh file .md, và file NÓI RÕ nó không phải nguồn', () => {
  const { db, thuMuc } = dbTam();
  nhacGia(db); chot(db);
  const f = path.join(thuMuc, 'so_nhac.md');
  const kq = sinhSoNhac(db, f, { bayGioMs: Date.now() });
  assert.ok(kq);
  const s = fs.readFileSync(f, 'utf8');
  assert.match(s, /SQL là gốc/, 'phải nói rõ file chỉ để liếc');
  assert.match(s, /Sửa ở đây KHÔNG có tác dụng/);
  assert.match(s, /gửi báo giá/);
  assert.match(s, /nhắc tới khi nào xong/, 'giữ NGUYÊN VĂN lời anh nói');
  dongDb(db);
});

test('H2 ★ KHÔNG có đường đọc ngược từ file vào DB', () => {
  // Hai chỗ cùng ghi một file là ghi đè nhau (case thật index.md revert 2 lần).
  const src = fs.readFileSync(new URL('../src/lich/theo_duoi.js', import.meta.url), 'utf8');
  assert.ok(!/readFileSync\s*\(/.test(src), 'theo_duoi.js không được ĐỌC file sổ');
});

test('H3 sổ ghi NGUYÊN TỬ (file tạm + rename), không để anh đọc phải file cụt', () => {
  const src = fs.readFileSync(new URL('../src/lich/theo_duoi.js', import.meta.url), 'utf8');
  assert.match(src, /renameSync/);
});

test('H4 lời nhắc đã đóng vẫn hiện trong sổ, có ghi ai đóng', () => {
  const { db, thuMuc } = dbTam();
  const { id } = nhacGia(db); chot(db);
  dongNhac(db, { id, nguoiDong: HOST, laHost: true, bayGioMs: 1_700_000_000_000 });
  const f = path.join(thuMuc, 'so_nhac.md');
  sinhSoNhac(db, f);
  const s = fs.readFileSync(f, 'utf8');
  assert.match(s, /Đã xong \(1\)/);
  assert.match(s, new RegExp(HOST));
  dongDb(db);
});

test('H5 xemNhacTheoDuoi lọc theo trạng thái', () => {
  const { db } = dbTam();
  nhacGia(db); chot(db);
  assert.equal(xemNhacTheoDuoi(db, { trangThaiTd: TRANG_THAI_TD.DANG_THEO_DUOI }).length, 1);
  assert.equal(xemNhacTheoDuoi(db, { trangThaiTd: TRANG_THAI_TD.DA_XONG }).length, 0);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// H. NHỊP PHÚT + TRẦN SỐ LẦN (v5)
//
// 🔴 Trần là ĐIỀU KIỆN anh duyệt nhịp dày. Bài quan trọng nhất nhóm này là
//    H2/H3: chạm trần thì THẬT SỰ dừng, và host PHẢI biết nó dừng vì HẾT
//    LƯỢT chứ không phải vì việc đã xong.
// ═══════════════════════════════════════════════════════════════════════

test('H1 ★ nhịp phút lưu xuống DB và dời mốc đúng N phút', () => {
  const { db } = dbTam();
  nhacGia(db, { chuKyPhut: 2 }); chot(db);
  const d = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA');
  assert.equal(Number(d.chu_ky_phut), 2);
  assert.equal(Number(d.tran_so_lan), 10, 'nhịp dày phải tự có trần mặc định');

  const t = Date.now();
  const cho = danhChoLuotNhac(db, { ...d, gui_luc_ms: d.gui_luc_ms }, t);
  assert.equal(cho.ok, true);
  assert.equal(cho.mocKeTiepMs - t, 120_000, 'phải là đúng 2 phút kể từ BÂY GIỜ');
  dongDb(db);
});

test('H2 ★★ chạm trần -> DỪNG THẬT: đóng dòng, ly_do_dong = HET_LUOT', () => {
  const { db } = dbTam();
  nhacGia(db, { chuKyPhut: 1, tranSoLan: 3 }); chot(db);

  let cho;
  for (let i = 1; i <= 3; i += 1) {
    const d = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA');
    cho = danhChoLuotNhac(db, d, Date.now());
    assert.equal(cho.ok, true, `lượt ${i}`);
    assert.equal(cho.hetLuot, i === 3, `lượt ${i} hetLuot`);
  }
  const sau = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA');
  assert.equal(Number(sau.so_lan_da_nhac), 3, 'trần 3 = nhắc ĐỦ 3 lần, không phải 2');
  assert.equal(sau.trang_thai_td, TRANG_THAI_TD.DA_XONG);
  assert.equal(sau.ly_do_dong, 'HET_LUOT',
    'dùng HOST_DONG ở đây là host tưởng có ai đó đã xong việc');
  // Đã đóng thì nhịp sau KHÔNG được lấy ra nữa.
  assert.equal(layNhacDenHan(db, Date.now() + 86_400_000).length, 0);
  dongDb(db);
});

test('H3 ★★ hết lượt -> BÁO HOST, nói rõ dừng vì hết lượt KHÔNG phải vì xong', async () => {
  const { db } = dbTam();
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'N', duocNghe: true });
  nhacGia(db, { chuKyPhut: 1, tranSoLan: 1 }); chot(db);
  db.exec('UPDATE lich_hen SET gui_luc_ms = 1');

  const dm = [];
  await chayNhipTheoDuoi({
    db, api: {}, truyVanLichSu, taoHangDoi,
    guiVaoNhom: async () => ({ msgId: 'x' }),
    guiDmHost: async (_a, _c, text) => { dm.push(text); return { msgId: 'y' }; },
    dmHostChatId: 'dm-host',
    dsNguoiTrongNhom: () => [],
  });
  await new Promise((r) => setTimeout(r, 20));   // báo host là fire-and-forget

  assert.equal(dm.length, 1, 'im lặng tắt là bỏ rơi một việc thật mà không ai hay');
  assert.match(dm[0], /HẾT LƯỢT/);
  assert.match(dm[0], /KHÔNG phải vì việc đã xong/);
  assert.match(dm[0], /chinh_nhip_nhac/, 'phải chỉ đường nới trần');
  dongDb(db);
});

test('H4 🔴 nhịp NGÀY không bị gắn trần -> nhắc mãi tới khi host đóng', () => {
  const { db } = dbTam();
  nhacGia(db); chot(db);   // mặc định: nhịp ngày
  const d = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA');
  assert.equal(d.chu_ky_phut, null);
  assert.equal(d.tran_so_lan, null, 'trần KHÔNG được lây sang nhịp ngày');

  for (let i = 0; i < 20; i += 1) {
    const cur = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA');
    const cho = danhChoLuotNhac(db, cur, Number(cur.gui_luc_ms));
    assert.equal(cho.hetLuot, false, `lượt ${i} không được tự tắt`);
  }
  assert.equal(
    db.prepare('SELECT trang_thai_td t FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA').t,
    TRANG_THAI_TD.DANG_THEO_DUOI,
  );
  dongDb(db);
});

test('H5 chinhNhip đổi được nhịp phút và trần; null = bỏ hẳn', () => {
  const { db } = dbTam();
  nhacGia(db, { chuKyPhut: 2 }); chot(db);
  const id = db.prepare('SELECT id FROM lich_hen WHERE ma_xac_nhan = ?').get('AAAA').id;

  assert.equal(chinhNhip(db, { id, laHost: true, chuKyPhut: 5, tranSoLan: 20 }).ok, true);
  let d = db.prepare('SELECT * FROM lich_hen WHERE id = ?').get(id);
  assert.equal(Number(d.chu_ky_phut), 5);
  assert.equal(Number(d.tran_so_lan), 20);

  assert.equal(chinhNhip(db, { id, laHost: true, chuKyPhut: null, tranSoLan: null }).ok, true);
  d = db.prepare('SELECT * FROM lich_hen WHERE id = ?').get(id);
  assert.equal(d.chu_ky_phut, null, 'null = quay về nhịp ngày');
  assert.equal(d.tran_so_lan, null, 'null = bỏ trần');
  dongDb(db);
});
