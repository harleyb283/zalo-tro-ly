/**
 * v3 — test HẸN GIỜ GỬI TIN. Không cần Zalo, không cần mạng.
 *
 * 🔴 Trọng tâm: tin nhắc đi vào NHÓM CÓ NGƯỜI THẬT. Hai thứ phải chặn tuyệt đối:
 *   ① gửi khi anh CHƯA xác nhận
 *   ② gửi HAI LẦN cùng một lịch
 * và một thứ phải thiên vị: thà KHÔNG GỬI còn hơn gửi sai giờ.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import { ghiTin, upsertHoiThoai } from '../src/store/write.js';
import { GIOI_HAN_LICH, TIEN_TO_NHAC_MUON, TRANG_THAI_LICH } from '../src/lib/hang_so.js';

import {
  chotLich, conBaoLau, danhDauQuaHan, demDangCho, dinhDangVn, dungCauXacNhan,
  ghiKetQuaGui, huyLich, layLichDenHan, nhanDangGui, quyetDinhTre, taoLich,
  taoMaXacNhan, xemLich,
} from '../src/lich/lich_hen.js';
import { chayMotNhip, dungNoiDung, uidSangTen, batLich } from '../src/lich/bo_chay.js';
import { docMocTuyetDoi } from '../src/mcp/tools.js';

const RAC = [];
function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-lich-'));
  RAC.push(d);
  return moDb(path.join(d, 'kho', 'lichsu.db'));
}
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

const NHOM = '9990000000001';
const HOST = '555000111';

function lichGia(db, v = {}) {
  return taoLich(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'nhắc họp',
    guiLucMs: Date.now() + 3_600_000, muiGio: 'Asia/Ho_Chi_Minh',
    dienGiaiGoc: '1 tiếng nữa nhắc anh A', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, ...v,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// A. ĐỌC MỐC THỜI GIAN — chỉ nhận TUYỆT ĐỐI
// ═══════════════════════════════════════════════════════════════════════

test('A1 ★ TỪ CHỐI chuỗi tương đối — quy đổi là việc của model, không phải tool', () => {
  for (const s of ['2 ngày nữa', 'mai', '9h sáng thứ Sáu', '']) {
    assert.ok(docMocTuyetDoi(s).loi, `phải từ chối '${s}'`);
  }
});

test('A2 ★ TỪ CHỐI ISO THIẾU OFFSET — thiếu offset là JS hiểu theo giờ MÁY', () => {
  // Đây là ca nguy hiểm nhất vì chuỗi trông hoàn toàn hợp lệ: máy đặt sai múi
  // giờ thì nhắc lệch vài tiếng mà nhìn không thấy gì bất thường.
  const kq = docMocTuyetDoi('2026-08-22T09:00:00');
  assert.ok(kq.loi);
  assert.match(kq.loi, /offset/);
});

test('A3 nhận ISO có offset và có Z', () => {
  assert.equal(docMocTuyetDoi('2026-08-22T09:00:00+07:00').ms, Date.parse('2026-08-22T02:00:00Z'));
  assert.equal(docMocTuyetDoi('2026-08-22T02:00:00Z').ms, Date.parse('2026-08-22T02:00:00Z'));
});

// ═══════════════════════════════════════════════════════════════════════
// B. CÂU XÁC NHẬN — do TOOL dựng
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★ câu xác nhận có ĐỦ: mã, nhóm đích, giờ + THỨ, "còn bao lâu", nội dung', () => {
  const luc = Date.parse('2026-08-22T09:00:00+07:00');
  const cau = dungCauXacNhan({
    ma: 'A3F2', tenDich: 'Nhóm Dự án Sao Mai', guiLucMs: luc,
    muiGio: 'Asia/Ho_Chi_Minh', tenTag: ['Anh A'], noiDung: 'xác nhận cấu hình',
    bayGioMs: Date.parse('2026-08-20T19:00:00+07:00'),
  });
  assert.match(cau, /A3F2/);
  assert.match(cau, /Nhóm Dự án Sao Mai/);
  // ⚠️ 22/08/2026 là THỨ BẢY. Bản thiết kế ghi 'Thứ Sáu 22/08/2026' — SAI, đã
  // kiểm chéo bằng Intl và lệnh date. Giữ sự thật ở đây; chính cái cột THỨ này
  // là thứ bắt được lỗi đó, đúng công dụng nó sinh ra.
  assert.match(cau, /Thứ Bảy/, 'phải in THỨ tiếng Việt');
  assert.match(cau, /09:00/);
  assert.match(cau, /22\/08\/2026/);
  assert.match(cau, /còn 1 ngày 14 giờ/, '"còn bao lâu" là lưới bắt lỗi sai NĂM/THÁNG');
  assert.match(cau, /@Anh A/);
});

test('B2 ★ "còn bao lâu" lộ ngay ca model tính nhầm NĂM', () => {
  const t = Date.parse('2026-08-20T00:00:00Z');
  assert.match(conBaoLau(t, t + 372 * 86400_000), /372 ngày/);
});

test('B3 dinhDangVn theo MÚI GIỜ tường minh, không theo giờ máy', () => {
  const luc = Date.parse('2026-08-22T02:00:00Z');   // = 09:00 giờ VN
  assert.match(dinhDangVn(luc, 'Asia/Ho_Chi_Minh'), /^09:00 Thứ Bảy 22\/08\/2026$/);
  assert.match(dinhDangVn(luc, 'UTC'), /^02:00 Thứ Bảy 22\/08\/2026$/);
});

test('B4 múi giờ rác -> KHÔNG âm thầm rơi về giờ máy', () => {
  const s = dinhDangVn(Date.parse('2026-08-22T02:00:00Z'), 'Khong/CoThat');
  assert.match(s, /^2026-08-22T02:00:00/, 'trả ISO để lộ ra là có vấn đề');
});

test('B5 mã xác nhận 4 ký tự, bỏ chữ dễ đọc nhầm (O/0, I/1)', () => {
  for (let i = 0; i < 200; i += 1) {
    const m = taoMaXacNhan();
    assert.equal(m.length, 4);
    assert.ok(!/[O0I1]/.test(m), `mã ${m} chứa ký tự dễ đọc nhầm`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// C. VÒNG ĐỜI — KHÔNG CÓ ĐƯỜNG TẮT
// ═══════════════════════════════════════════════════════════════════════

test('C1 ★ taoLich LUÔN ở cho_xac_nhan — không tham số nào bỏ qua được', () => {
  const db = dbTam();
  const { id } = lichGia(db);
  const d = db.prepare('SELECT * FROM lich_hen WHERE id=$id').get({ id });
  assert.equal(d.trang_thai, TRANG_THAI_LICH.CHO_XAC_NHAN);
  dongDb(db);
});

test('C2 ★ lịch CHƯA chốt thì KHÔNG BAO GIỜ tới hạn (dù đã quá giờ)', () => {
  const db = dbTam();
  lichGia(db, { guiLucMs: Date.now() - 10_000 });   // đã quá giờ
  assert.deepEqual(layLichDenHan(db, Date.now()), [], 'chưa xác nhận mà gửi là hỏng nặng nhất');
  dongDb(db);
});

test('C3 chốt SAI MÃ -> từ chối', () => {
  const db = dbTam();
  const { ma } = lichGia(db);
  assert.equal(chotLich(db, { id: ma, ma: 'XXXX', nguoiDat: HOST }).ly, 'SAI_MA');
  dongDb(db);
});

test('C4 chốt bởi NGƯỜI KHÁC -> từ chối', () => {
  const db = dbTam();
  const { ma } = lichGia(db);
  assert.equal(chotLich(db, { id: ma, ma, nguoiDat: 'nguoi_la' }).ly, 'KHONG_PHAI_NGUOI_DAT');
  dongDb(db);
});

test('C5 chốt đúng -> da_len_lich, và tới hạn thì mới ra', () => {
  const db = dbTam();
  const { ma } = lichGia(db, { guiLucMs: Date.now() - 1000 });
  assert.equal(chotLich(db, { id: ma, ma, nguoiDat: HOST }).ok, true);
  assert.equal(layLichDenHan(db, Date.now()).length, 1);
  dongDb(db);
});

test('C6 chốt HAI LẦN -> lần hai từ chối (SAI_TRANG_THAI)', () => {
  const db = dbTam();
  const { ma } = lichGia(db);
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  assert.equal(chotLich(db, { id: ma, ma, nguoiDat: HOST }).ly, 'SAI_TRANG_THAI');
  dongDb(db);
});

test('C7 huỷ: chỉ người đặt, và không huỷ được cái đã gửi', () => {
  const db = dbTam();
  const a = lichGia(db);
  assert.equal(huyLich(db, { id: a.id, nguoiDat: 'nguoi_la' }).ly, 'KHONG_PHAI_NGUOI_DAT');
  assert.equal(huyLich(db, { id: a.id, nguoiDat: HOST }).ok, true);
  assert.equal(huyLich(db, { id: a.id, nguoiDat: HOST }).ly, 'SAI_TRANG_THAI');
  dongDb(db);
});

test('C8 demDangCho đếm cả cho_xac_nhan lẫn da_len_lich', () => {
  const db = dbTam();
  lichGia(db);
  const b = lichGia(db);
  chotLich(db, { id: b.ma, ma: b.ma, nguoiDat: HOST });
  assert.equal(demDangCho(db), 2);
  huyLich(db, { id: b.id, nguoiDat: HOST });
  assert.equal(demDangCho(db), 1);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// D. TRỄ — thiên vị KHÔNG GỬI
// ═══════════════════════════════════════════════════════════════════════

test('D1 trễ ≤ 5 phút -> gửi bình thường, không nói gì', () => {
  assert.deepEqual(quyetDinhTre(60_000), { hanhDong: 'GUI', tienTo: '' });
});

test('D2 trễ 5 phút–2 giờ -> gửi KÈM tiền tố cố định "(nhắc muộn) "', () => {
  const q = quyetDinhTre(30 * 60_000);
  assert.equal(q.hanhDong, 'GUI_KEM_NHAN');
  assert.equal(q.tienTo, TIEN_TO_NHAC_MUON);
});

test('D3 ★ trễ > 2 giờ -> KHÔNG GỬI VÀO NHÓM', () => {
  assert.equal(quyetDinhTre(GIOI_HAN_LICH.TRAN_TRE_MS + 1).hanhDong, 'BO_QUA_HAN');
});

test('D4 ★ quá hạn: đổi qua_han, KHÔNG gửi nhóm, DM host', async () => {
  const db = dbTam();
  const { ma, id } = lichGia(db, { guiLucMs: Date.now() - 5 * 3_600_000 });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  const guiNhom = [];
  const guiDm = [];
  const kq = await chayMotNhip({
    db, api: {},
    guiVaoNhom: async (...a) => { guiNhom.push(a); return { msgId: '1' }; },
    guiDmHost: async (...a) => { guiDm.push(a); return { msgId: '2' }; },
    dsNguoiTrongNhom: () => [],
    dmHostChatId: 'dm-host',
  });
  assert.equal(kq.quaHan, 1);
  assert.equal(guiNhom.length, 0, 'TUYỆT ĐỐI không gửi vào nhóm khi quá trần trễ');
  assert.equal(guiDm.length, 1, 'phải báo riêng host');
  assert.match(guiDm[0][2], /KHÔNG gửi vào nhóm/);
  assert.equal(
    db.prepare('SELECT trang_thai t FROM lich_hen WHERE id=$id').get({ id }).t,
    TRANG_THAI_LICH.QUA_HAN,
  );
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E. GỬI ĐÚNG MỘT LẦN
// ═══════════════════════════════════════════════════════════════════════

test('E1 ★ nhanDangGui chỉ thành công MỘT lần (dành chỗ trước khi gọi mạng)', () => {
  const db = dbTam();
  const { ma, id } = lichGia(db, { guiLucMs: Date.now() - 1000 });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  assert.equal(nhanDangGui(db, id), true);
  assert.equal(nhanDangGui(db, id), false, 'lần hai phải THẤT BẠI, nếu không là gửi 2 tin');
  dongDb(db);
});

test('E2 ★ hai nhịp CHỒNG NHAU -> chỉ gửi 1 tin', async () => {
  const db = dbTam();
  const { ma } = lichGia(db, { guiLucMs: Date.now() - 1000 });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  const gui = [];
  const p = {
    db, api: {},
    guiVaoNhom: async () => { await new Promise((r) => setTimeout(r, 5)); gui.push(1); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
  };
  await Promise.all([chayMotNhip(p), chayMotNhip(p)]);
  assert.equal(gui.length, 1, 'daemon restart / timer chồng nhau không được gửi hai lần');
  dongDb(db);
});

test('E3 ★ gửi LỖI -> ghi trạng thái loi, KHÔNG tự thử lại', async () => {
  // Tự gửi lại thì ca "Zalo đã nhận nhưng trả lỗi mạng" thành gửi hai lần vào
  // nhóm người thật. Host đọc xem_lich thấy 'loi' rồi tự quyết.
  const db = dbTam();
  const { ma, id } = lichGia(db, { guiLucMs: Date.now() - 1000 });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  const kq = await chayMotNhip({
    db, api: {},
    guiVaoNhom: async () => { throw new Error('mạng hỏng'); },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [],
  });
  assert.equal(kq.loi, 1);
  const d = db.prepare('SELECT * FROM lich_hen WHERE id=$id').get({ id });
  assert.equal(d.trang_thai, TRANG_THAI_LICH.LOI);
  assert.equal(Number(d.so_lan_thu), 1);
  assert.deepEqual(layLichDenHan(db, Date.now()), [], 'KHÔNG được quay lại hàng chờ');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// F. TAG NGƯỜI — dùng lại tầng mention, CẤM bịa
// ═══════════════════════════════════════════════════════════════════════

test('F1 uid -> tên; uid lạ thì báo ra, KHÔNG bịa tên', () => {
  const kq = uidSangTen([{ uid: '1', ten: 'Anh A' }], ['1', '999']);
  assert.deepEqual(kq.ten, ['Anh A']);
  assert.deepEqual(kq.khongTraRa, ['999']);
});

test('F2 ★ dựng nội dung: tiền tố trễ + @Tên + nội dung, đúng thứ tự', () => {
  const kq = dungNoiDung({
    noiDung: 'họp lúc 3h', tienTo: TIEN_TO_NHAC_MUON,
    dsNguoi: [{ uid: '1', ten: 'Anh A' }], tagUserIds: ['1'],
  });
  assert.equal(kq.text, '(nhắc muộn) @Anh A họp lúc 3h');
});

test('F3 ★ uid không tra ra tên -> BỎ tag đó, tin vẫn gửi được', () => {
  const kq = dungNoiDung({ noiDung: 'x', dsNguoi: [], tagUserIds: ['999'] });
  assert.equal(kq.text, 'x', 'không có @ rác trong tin');
  assert.deepEqual(kq.khongTraRa, ['999']);
});

test('F4 ★ chuỗi @Tên do bộ chạy dựng phải TAG ĐƯỢC THẬT qua dungMentions', async () => {
  // Bài nối hai tầng: nếu tên dựng ra mà tầng mention không nhận thì tin gửi đi
  // có chữ "@Anh A" nhưng KHÔNG tag ai — hỏng câm, nhìn tin vẫn thấy bình thường.
  const { dungMentions } = await import('../src/zalo/send.js');
  const ds = [{ uid: '111', ten: 'Anh A' }];
  const nd = dungNoiDung({ noiDung: 'họp nhé', dsNguoi: ds, tagUserIds: ['111'] });
  const mt = dungMentions(nd.text, ds);
  assert.equal(mt.mentions.length, 1);
  assert.equal(mt.mentions[0].uid, '111');
  assert.equal(mt.mentions[0].pos, 0);
  assert.equal(mt.mentions[0].len, '@Anh A'.length, 'len GỒM cả ký tự @');
});

test('F5 gửi vào nhóm có truyền dsNguoi xuống tầng gửi', async () => {
  const db = dbTam();
  const { ma } = lichGia(db, { guiLucMs: Date.now() - 1000, tagUserIds: ['111'] });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  let tuyChon = null;
  await chayMotNhip({
    db, api: {},
    guiVaoNhom: async (_a, _c, _t, tc) => { tuyChon = tc; return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: () => [{ uid: '111', ten: 'Anh A' }],
  });
  assert.deepEqual(tuyChon.dsNguoi, [{ uid: '111', ten: 'Anh A' }]);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// G. CỜ
// ═══════════════════════════════════════════════════════════════════════

test('G1 bộ chạy lịch mặc định BẬT (khác phần quét, vốn phải chờ A0)', () => {
  assert.equal(batLich({}), true);
  assert.equal(batLich({ ZTL_LICH_HEN: '0' }), false);
});

test('G2 ★ KHÔNG GỌI createReminder ở đâu cả (anh đã cắt phương án B1)', () => {
  // Bản đầu của bài này quét CẢ FILE nên bắt oan chính dòng chú thích
  // "KHÔNG gọi `createReminder`" — cùng lỗi dương tính giả đã gặp nhiều lần:
  // quét theo văn bản thì không phân biệt được LỆNH THẬT với CÂU GIẢI THÍCH.
  // Nay chỉ soi dòng CODE (bỏ comment `//` và dòng trong khối chú thích).
  for (const f of ['src/lich/lich_hen.js', 'src/lich/bo_chay.js', 'src/mcp/tools.js']) {
    const s = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const codeThat = s
      .replace(/\/\*[\s\S]*?\*\//g, '')          // khối /* ... */
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/createReminder|dung_luoi_zalo|zalo_reminder_id/.test(codeThat),
      `${f} còn GỌI THẬT tới phương án B1 đã bị cắt`,
    );
  }
  // Cột trong schema cũng không được có — schema là hợp đồng, để lại cột chết
  // là mời người sau dùng lại.
  const sc = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.ok(!/dung_luoi_zalo|zalo_reminder_id/.test(sc), 'schema còn cột của B1');
});

// ═══════════════════════════════════════════════════════════════════════
// H. WIRING — chặn lỗi CHỈ LỘ SAU KHI ĐĂNG NHẬP ZALO
// ═══════════════════════════════════════════════════════════════════════

test('H1 ★ mọi module + tên hàm mà index.js nạp ĐỘNG đều tồn tại thật', async () => {
  // 🔴 Khối wiring v3 trong index.js dùng `await import(...)` và chỉ chạy SAU
  // khi đăng nhập Zalo thành công — thứ pack này CẤM thử. Nghĩa là gõ sai một
  // đường dẫn hay một tên hàm sẽ không lộ ra ở `node --check`, không lộ ở
  // `--kiem-khoi-dong`, mà nổ đúng lúc daemon chạy thật trên nhóm có người thật.
  // Bài này kéo lỗi đó về thời điểm chạy test.
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const can = [
    ['./scan/probe_a0.js', ['batA0', 'chayA0', 'chonNhomThu', 'duongDanKetQua']],
    ['./scan/doi_chieu.js', ['batQuet', 'quetMotLuot']],
    ['./lich/bo_chay.js', ['batLich', 'chayMotNhip', 'NHIP_MS']],
    ['./lib/hang_so.js', ['GIOI_HAN_QUET']],
    ['./store/query.js', ['dsNguoiTrongNhom']],
    ['./zalo/send.js', ['guiVaoNhom', 'guiDmHost']],
    ['./ops/notify_host.js', ['dmHostChinh']],
  ];
  for (const [duongDan, ten] of can) {
    assert.ok(src.includes(`import('${duongDan}')`), `index.js không nạp ${duongDan}`);
    const m = await import(duongDan.replace('./', '../src/'));
    for (const t of ten) {
      assert.ok(m[t] !== undefined, `${duongDan} KHÔNG export '${t}' mà index.js đang lấy`);
    }
  }
});

test('H2 ★ hai cờ của phần A phải nằm SAU điều kiện bật, không chạy vô điều kiện', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(/if \(batA0\(\)\)/.test(src), 'A0 phải nằm sau if (batA0())');
  assert.ok(/if \(batQuet\(\)\)/.test(src), 'quét phải nằm sau if (batQuet())');
  // Bộ chạy lịch KHÔNG được phụ thuộc phần quét — B phải sống kể cả khi A hỏng hẳn.
  const iQuet = src.indexOf('batQuet()');
  const iLich = src.indexOf('batLich()');
  assert.ok(iLich > iQuet, 'thứ tự khai báo');
  assert.ok(!/batQuet\(\)[\s\S]{0,400}batLich\(\)[\s\S]{0,50}\)/.test(src.slice(iQuet, iQuet + 100)),
    'batLich KHÔNG được lồng trong nhánh batQuet');
});

// ═══════════════════════════════════════════════════════════════════════
// I. BUG THẬT ĐÃ BẮT — canh để không tái phát
// ═══════════════════════════════════════════════════════════════════════

test('I1 ★ câu xác nhận KHÔNG còn chỗ giữ chỗ nào, mã hiện ở MỌI vị trí', async () => {
  // 🔴 Bug thật 20/08/2026: bản đầu dựng câu với '____' rồi
  // `cau.replace('____', ma)`. `String.replace` với mẫu CHUỖI chỉ thay LẦN ĐẦU
  // -> tiêu đề có mã thật nhưng dòng cuối vẫn là: Anh nhắn "ok ____" để chốt.
  // Anh đọc xong KHÔNG BIẾT gõ mã gì, mà tool thì báo ok:true.
  const { moDb: mo, dongDb: dong } = await import('../src/store/db.js');
  const { taoHangDoi, upsertHoiThoai: upsert } = await import('../src/store/write.js');
  const { dangKyTool } = await import('../src/mcp/tools.js');

  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-i1-'));
  RAC.push(d);
  const db = mo(path.join(d, 'lichsu.db'));
  upsert(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm Sao Mai', duocNghe: true });
  taoHangDoi(db, {
    requestId: 'R1', chatIdHoi: NHOM, msgId: '1', userId: HOST,
    noiDung: 'x', tsTao: new Date().toISOString(),
  });
  const hs = [];
  dangKyTool({ setRequestHandler: (_s, fn) => hs.push(fn) }, {
    db,
    cauHinh: { hosts: [{ userId: HOST, ten: 'Anh', dmChatId: 'dm1' }], groups: [{ chatId: NHOM, ten: 'Nhóm Sao Mai' }] },
    boTichLuy: null, api: null, docSucKhoe: () => null,
  });
  const kq = JSON.parse((await hs[1]({
    params: {
      name: 'dat_lich_nhap',
      arguments: {
        request_id: 'R1',
        guiLuc: new Date(Date.now() + 3_600_000).toISOString(),
        noiDung: 'họp 3h', dienGiaiGoc: '1 tiếng nữa',
      },
    },
  })).content[0].text);

  assert.equal(kq.ok, true);
  const cau = kq.duLieu.cauXacNhan;
  const ma = kq.duLieu.maXacNhan;
  assert.ok(!cau.includes('____'), `câu xác nhận còn chỗ giữ chỗ:\n${cau}`);
  // ⚠️ ĐỔI 20/08/2026: trước đây mã phải hiện ĐỦ 3 lần (tiêu đề + "ok X" +
  // "huỷ X"). Anh phản hồi lúc test thật là bị bắt gõ mã thì phiền, nên ca
  // CHỈ CÓ MỘT lịch chờ (đúng ca này) không còn bắt gõ mã nữa — mã chỉ còn ở
  // TIÊU ĐỀ để sau này gọi tên lịch đó. Mục đích gốc của bài vẫn giữ: không
  // được sót chỗ giữ chỗ, và mã KHÔNG được biến mất khỏi câu.
  assert.ok(cau.includes(`[${ma}]`), `mã '${ma}' phải còn ở tiêu đề:\n${cau}`);
  assert.match(cau, /Anh nhắn "ok" để chốt/, 'một lịch chờ thì đừng bắt gõ mã');
  assert.ok(!cau.includes(`ok ${ma}`), 'ca một lịch KHÔNG được bắt gõ mã nữa');
  // Câu trong DB và câu trả cho anh phải là MỘT.
  const trongDb = db.prepare('SELECT dien_giai_xac_nhan c FROM lich_hen LIMIT 1').get().c;
  assert.equal(trongDb, cau, 'câu anh đọc và câu lưu DB phải giống hệt');
  dongDb(db);
});
