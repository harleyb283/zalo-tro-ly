/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 1 — ĐƯỜNG LỜI NHẮC THEO ĐUỔI. Sáu bài T1a–T1f + một bài chống hồi quy.
 *
 * Bộ này sinh ra từ một sự cố THẬT tối 20/08/2026: lời nhắc theo đuổi chạy đúng
 * một phát rồi CHẾT ÂM THẦM, mà sổ nhắc vẫn báo "đang theo đuổi". 722 test đang
 * xanh lúc đó KHÔNG bài nào bắt được, vì không bài nào cho HAI bộ chạy đứng
 * cạnh nhau.
 *
 * 🔴 LUẬT VIẾT BÀI CHO CỤM NÀY — đọc trước khi sửa bất cứ dòng nào:
 *    Hai bộ chạy KHÔNG tranh nhau bằng một cơ chế CAS chung. `nhanDangGui` khoá
 *    trên cột `trang_thai`; `danhChoLuotNhac` khoá trên `gui_luc_ms`. Hai `UPDATE`
 *    ấy KHÔNG loại trừ nhau — loại trừ chỉ xảy ra ở tầng `SELECT`.
 *    ⛔ VÌ VẬY CẤM viết bài kiểu *"gọi bộ theo-đuổi TRƯỚC rồi khẳng định nó thắng"*.
 *    Bài đó XANH cả trên code hỏng (vì `danhChoLuotNhac` đẩy `gui_luc_ms` sang
 *    tương lai nên `layLichDenHan` không còn thấy dòng), tức là XANH GIẢ — và nó
 *    dẫn người sửa tới bản vá giòn "đảo thứ tự trong index.js", hỏng lại ngay khi
 *    ai đó thêm một `await`.
 *    ⇒ Bài đúng phải gọi `chayMotNhip` TRƯỚC (đúng thứ tự `index.js` thật) và
 *      khẳng định nó KHÔNG ĐỤNG dòng `la_theo_duoi = 1`.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { enqueueQuestion, upsertConversation } from '../src/store/write.js';
import { queryHistory } from '../src/store/query.js';
import { TRANG_THAI_LICH, TRANG_THAI_TD } from '../src/lib/hang_so.js';
import { chotLich, layLichDenHan, nhanDangGui, taoLich } from '../src/lich/lich_hen.js';
import {
  chinhNhip, conDangTheoDuoi, docNhip, dongNhac, layNhacDenHan, layNhacTreoChoModel,
  taoNhacTheoDuoi, tranChoModelMs,
} from '../src/lich/theo_duoi.js';
import { chayMotNhip, chayNhipTheoDuoi } from '../src/lich/bo_chay.js';

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});
function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum1-'));
  RAC.push(d);
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  return db;
}

const NHOM = '9990000000001';
const HOST = '555000111';
const NGUOI = '999888777';

/** Một lời nhắc THEO ĐUỔI đã chốt, tới hạn ngay. */
function nhacDaChot(db, v = {}) {
  const ma = v.ma ?? 'NHAC';
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: NGUOI, ma, ...v,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  if (v.guiLucMs !== undefined) {
    db.prepare('UPDATE lich_hen SET gui_luc_ms = $g WHERE ma_xac_nhan = $m')
      .run({ g: v.guiLucMs, m: ma });
  }
  return db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
}

/** Một lịch MỘT LẦN đã chốt. */
function lichDaChot(db, guiLucMs, ma = 'MOT1') {
  taoLich(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'lịch một lần',
    guiLucMs, dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
    nguoiDat: HOST, chatIdDat: NHOM, ma,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
}

const doc = (db, ma) => db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);

// ═══════════════════════════════════════════════════════════════════════
// T1a — A1: bộ chạy MỘT LẦN không được đụng dòng THEO ĐUỔI
// ═══════════════════════════════════════════════════════════════════════

test('T1a ★★★ chayMotNhip chạy TRƯỚC vẫn KHÔNG đụng dòng la_theo_duoi=1', async () => {
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: bayGio - 1000 });

  // Dòng theo đuổi đã chốt ⇒ đang ở 'da_len_lich', ĐÚNG trạng thái mà
  // `layLichDenHan` cũ vơ vào. Đây là tiền đề của bài; hỏng tiền đề thì bài vô nghĩa.
  assert.equal(doc(db, 'NHAC').trang_thai, TRANG_THAI_LICH.DA_LEN_LICH);
  assert.equal(layNhacDenHan(db, bayGio).length, 1, 'bộ theo-đuổi PHẢI thấy nó');

  // ★ Lọc ở tầng SELECT: bộ một-lần không được thấy dòng này.
  assert.deepEqual(layLichDenHan(db, bayGio), [], 'layLichDenHan vơ nhầm dòng theo đuổi');

  const daGui = [];
  const kq = await chayMotNhip({
    db, api: {}, bayGioMs: bayGio,
    guiVaoNhom: async (_a, c, t) => { daGui.push({ c, t }); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    groupMembers: () => [],
  });

  assert.equal(kq.daGui, 0, 'bộ chạy MỘT LẦN đã gửi hộ lời nhắc theo đuổi');
  assert.equal(daGui.length, 0);

  const sau = doc(db, 'NHAC');
  assert.equal(sau.trang_thai, TRANG_THAI_LICH.DA_LEN_LICH, 'trang_thai bị lật -> dòng chết vĩnh viễn');
  assert.equal(Number(sau.so_lan_thu), 0, 'so_lan_thu tăng = nhanDangGui đã chạm vào');
  assert.equal(sau.msg_id_da_gui, null);
  assert.equal(Number(sau.so_lan_da_nhac), 0);

  // Và nó phải CÒN SỐNG với bộ theo-đuổi — đây là điều đã hỏng thật hôm 20/08.
  assert.equal(layNhacDenHan(db, bayGio).length, 1, 'dòng rơi khỏi CẢ HAI truy vấn');
  closeDb(db);
});

test('T1a-2 ★★ nhanDangGui TỰ NÓ từ chối dòng theo đuổi (lớp trong, chống ảnh tĩnh cũ)', () => {
  // 🔴 Bài RIÊNG vì lớp này KHÔNG chạm tới được qua đường công khai một khi
  // `layLichDenHan` đã lọc đúng — đó chính là định nghĩa của phòng thủ nhiều lớp.
  // Phép thử đột biến xác nhận: gỡ `AND la_theo_duoi = 0` khỏi `nhanDangGui` thì
  // MỌI bài khác vẫn xanh, chỉ bài này đỏ. Không có nó thì lớp trong là code chết
  // không ai canh, và cửa sổ ảnh-tĩnh-cũ lặng lẽ mở lại khi ai đó sửa `layLichDenHan`.
  const db = dbTam();
  const bayGio = Date.now();
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: bayGio - 1000 });
  const dong = doc(db, 'NHAC');

  assert.equal(nhanDangGui(db, dong.id), false,
    'nhanDangGui nhận dòng la_theo_duoi=1 -> ảnh tĩnh cũ đủ để gửi tin thứ hai');
  const sau = doc(db, 'NHAC');
  assert.equal(sau.trang_thai, TRANG_THAI_LICH.DA_LEN_LICH);
  assert.equal(Number(sau.so_lan_thu), 0, 'từ chối rồi mà vẫn tăng so_lan_thu');

  // Đối chứng: cùng hàm đó PHẢI nhận một lịch một lần, nếu không bài trên xanh vô nghĩa.
  lichDaChot(db, bayGio - 1000, 'MOT1');
  assert.equal(nhanDangGui(db, doc(db, 'MOT1').id), true, 'lịch một lần phải nhận được');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T1b — A1-bis: cửa sổ ẢNH-TĨNH-CŨ, hai bộ chạy cùng tick
// ═══════════════════════════════════════════════════════════════════════

test('T1b ★★★ hai bộ chạy CÙNG TICK -> lời nhắc chỉ đi ĐÚNG MỘT tin', async () => {
  const db = dbTam();
  const bayGio = Date.now();

  // Dòng #1 tới hạn SỚM HƠN nên `chayMotNhip` xử nó trước rồi chạm `await` —
  // đúng khoảnh khắc nhả quyền điều khiển cho bộ theo-đuổi chen vào.
  lichDaChot(db, bayGio - 5000, 'MOT1');
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: bayGio - 1000, ma: 'NHAC' });

  const daGui = [];
  const guiVaoNhom = async (_a, _c, text) => {
    await new Promise((r) => setTimeout(r, 5));   // gửi tin là việc CÓ THẬT tốn thời gian
    daGui.push(text);
    return { msgId: `m${daGui.length}` };
  };
  const chung = {
    db, api: {}, bayGioMs: bayGio, guiVaoNhom,
    guiDmHost: async () => ({ msgId: 'dm' }),
    groupMembers: () => [],
  };

  // ★ KHÔNG await giữa hai lời gọi — y hệt `index.js`.
  const a = chayMotNhip(chung);
  const b = chayNhipTheoDuoi({ ...chung, queryHistory, enqueueQuestion });
  await Promise.all([a, b]);

  const cuaNhac = daGui.filter((t) => t.includes('chốt giúp địa điểm'));
  assert.equal(cuaNhac.length, 1,
    `lời nhắc đi ${cuaNhac.length} tin — hai tin giống hệt nhau vào nhóm người thật`);
  assert.equal(daGui.length, 2, 'phải đúng 2 tin: 1 của lịch một lần + 1 của lời nhắc');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T1c — A5: nhịp phút ngắn hơn trần chờ model
// ═══════════════════════════════════════════════════════════════════════

test('T1c ★★★ nhịp 3 phút, model IM MÃI -> lưới dự phòng VẪN bắn', async () => {
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 3, tranSoLan: null, guiLucMs: t0 - 1000 });

  // Trần chờ phải NHỎ HƠN nhịp — bất biến của `tranChoModelMs`.
  const tran = tranChoModelMs(docNhip({ chu_ky_phut: 3 }));
  assert.ok(tran < 3 * 60_000, `trần chờ ${tran}ms >= nhịp 180000ms thì lưới không bao giờ bắn`);

  const daGui = [];
  let soLanGiaoModel = 0;
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await chayNhipTheoDuoi({
      db, api: {}, bayGioMs: t0 + i * 3 * 60_000, queryHistory, enqueueQuestion,
      guiVaoNhom: async (_a, _c, t) => { daGui.push(t); return { msgId: 'x' }; },
      guiDmHost: async () => ({ msgId: 'y' }),
      groupMembers: () => [],
      // Model NHẬN việc nhưng KHÔNG BAO GIỜ gọi `tra_loi` — ca Claude rớt/bận.
      guiThongBao: async () => { soLanGiaoModel += 1; return true; },
    });
  }

  assert.ok(soLanGiaoModel >= 1, 'tiền đề: phải có lượt được giao cho model');
  assert.ok(daGui.length >= 1,
    'model im mà code KHÔNG gửi bù lần nào -> lời nhắc biến mất âm thầm, đúng thứ tính năng sinh ra để chống');

  // Trần bị đốt bởi lượt CHƯA GỬI GÌ: cho phép lệch tối đa 1 (đúng một lượt đang chờ model).
  const daNhac = Number(doc(db, 'NHAC').so_lan_da_nhac);
  assert.ok(daNhac - daGui.length <= 1,
    `đã tính ${daNhac} lượt nhưng chỉ gửi ${daGui.length} tin — trần bị đốt bởi lượt chưa gửi`);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T1d — A6: đóng / tạm dừng rồi thì bộ quét treo phải IM
// ═══════════════════════════════════════════════════════════════════════

test('T1d ★★★ host ĐÓNG rồi -> quét treo KHÔNG gửi tin nào nữa', async () => {
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: t0 + 10 * 60_000 });   // chưa tới hạn nhắc
  // Giả lập: đã giao model từ lâu, model im.
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = $t WHERE ma_xac_nhan = ?')
    .run({ t: t0 - 10 * 60_000 }, 'NHAC');

  dongNhac(db, { id: 'NHAC', nguoiDong: HOST, isHost: true, bayGioMs: t0 });
  assert.equal(doc(db, 'NHAC').cho_model_tu_ms, null, 'dongNhac phải xoá mốc chờ model');

  const daGui = [];
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: t0, queryHistory, enqueueQuestion,
    guiVaoNhom: async (_a, _c, t) => { daGui.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    groupMembers: () => [],
  });
  assert.equal(daGui.length, 0, 'đóng rồi mà vẫn nhắc = làm phiền người thật về việc ĐÃ XONG');
  closeDb(db);
});

test('T1d-2 ★★★ host TẠM DỪNG -> quét treo KHÔNG gửi (van xả không bị đi vòng)', async () => {
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: t0 + 10 * 60_000 });
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = $t WHERE ma_xac_nhan = ?')
    .run({ t: t0 - 10 * 60_000 }, 'NHAC');

  chinhNhip(db, { id: 'NHAC', isHost: true, tamDungToiMs: t0 + 86_400_000, bayGioMs: t0 });
  assert.equal(doc(db, 'NHAC').trang_thai_td, TRANG_THAI_TD.TAM_DUNG);

  const daGui = [];
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: t0, queryHistory, enqueueQuestion,
    guiVaoNhom: async (_a, _c, t) => { daGui.push(t); return { msgId: 'x' }; },
    guiDmHost: async () => ({ msgId: 'y' }),
    groupMembers: () => [],
  });
  assert.equal(daGui.length, 0, 'van xả bị lưới dự phòng đi vòng qua');
  closeDb(db);
});

test('T1d-3 ★★ layNhacTreoChoModel TỰ NÓ lọc trạng thái (lớp ngoài)', () => {
  // 🔴 Bài RIÊNG vì phép thử đột biến cho thấy T1d/T1d-2 KHÔNG chạm tới lớp này:
  // chúng xanh nhờ `dongNhac`/`chinhNhip` đã xoá `cho_model_tu_ms`, nên bộ quét
  // không còn gì để thấy. Muốn canh chính bộ lọc thì phải dựng thẳng cái trạng
  // thái mà hai hàm kia sẽ không bao giờ để lại — đó là việc của bài này.
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: t0 + 10 * 60_000 });
  const cu = t0 - 10 * 60_000;

  const dat = (sql, tham = {}) => db.prepare(`UPDATE lich_hen SET ${sql} WHERE ma_xac_nhan = 'NHAC'`).run(tham);

  dat('cho_model_tu_ms = $t', { t: cu });
  assert.equal(layNhacTreoChoModel(db, t0).length, 1, 'tiền đề: đang treo thì PHẢI thấy');

  dat("trang_thai_td = 'da_xong', ly_do_dong = 'HOST_DONG'");
  assert.equal(layNhacTreoChoModel(db, t0).length, 0, 'host bảo XONG mà vẫn lấy ra để nhắc');

  dat("trang_thai_td = 'dang_theo_duoi', ly_do_dong = NULL, tam_dung_toi_ms = $t", { t: t0 + 86_400_000 });
  assert.equal(layNhacTreoChoModel(db, t0).length, 0, 'đang TẠM DỪNG mà vẫn lấy ra — van xả bị đi vòng');

  dat("tam_dung_toi_ms = NULL, trang_thai = 'da_huy'");
  assert.equal(layNhacTreoChoModel(db, t0).length, 0, 'dòng đã chốt sổ mà vẫn lấy ra');
  closeDb(db);
});

test('T1d-4 ★★ conDangTheoDuoi: chặn host-đóng/tạm-dừng nhưng CHO QUA lượt chạm trần', () => {
  // Ngữ nghĩa của lớp canh này TINH TẾ và load-bearing cho T1g: câu hỏi đúng là
  // "HOST có bảo dừng không", KHÔNG phải "còn đang chạy không". Hỏi sai câu thì
  // lượt cuối của trần bị nuốt — bản đầu của em đã sai đúng chỗ này.
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 3, guiLucMs: t0 });
  const id = doc(db, 'NHAC').id;
  const dat = (sql, tham = {}) => db.prepare(`UPDATE lich_hen SET ${sql} WHERE id = '${id}'`).run(tham);

  assert.equal(conDangTheoDuoi(db, id, t0), true, 'đang chạy bình thường');

  dat("trang_thai_td = 'da_xong', trang_thai = 'da_gui', ly_do_dong = 'HET_LUOT'");
  assert.equal(conDangTheoDuoi(db, id, t0), true,
    'chặn lượt HET_LUOT = trần 10 hoá thành nhắc 9 lần');

  dat("ly_do_dong = 'HOST_DONG'");
  assert.equal(conDangTheoDuoi(db, id, t0), false, 'host bảo xong rồi mà vẫn nhắc');

  dat("trang_thai_td = 'tam_dung', trang_thai = 'da_len_lich', ly_do_dong = NULL");
  assert.equal(conDangTheoDuoi(db, id, t0), false, 'đang tạm dừng mà vẫn nhắc');

  dat("trang_thai_td = 'dang_theo_duoi', tam_dung_toi_ms = $t", { t: t0 + 3600_000 });
  assert.equal(conDangTheoDuoi(db, id, t0), false, 'còn trong hạn tạm dừng mà vẫn nhắc');

  assert.equal(conDangTheoDuoi(db, 'khong-co-that', t0), false, 'dòng không tồn tại phải là false');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T1e — A4: van xả phải giữ được nhịp PHÚT
// ═══════════════════════════════════════════════════════════════════════

test('T1e ★★★ chinhNhip({chuKyPhut:5}) -> mốc kế tiếp cách ĐÚNG 5 phút', () => {
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 3 });

  const kq = chinhNhip(db, { id: 'NHAC', isHost: true, chuKyPhut: 5, bayGioMs: t0 });
  assert.equal(kq.ok, true);
  assert.equal(Number(kq.dong.chu_ky_phut), 5, 'cột DB phải đổi');

  const lech = Number(doc(db, 'NHAC').gui_luc_ms) - t0;
  assert.equal(lech, 5 * 60_000,
    `mốc kế tiếp lệch ${Math.round(lech / 60000)} phút — host siết nhịp mà nó tự giãn sang hôm sau`);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T1f — B3: ternary chết
// ═══════════════════════════════════════════════════════════════════════

test('T1f ★★ tham số `laBu` đã bỏ hẳn, và cả pack KHÔNG còn ternary hai nhánh giống nhau', () => {
  // (a) Tham số chết phải BIẾN MẤT — không để lại dấu vết khiến người đọc sau
  //     tin rằng có phân biệt. Vì sao bỏ chứ không cho tiền tố thật: xem chú
  //     thích ở `_guiNhac`.
  const boChay = fs.readFileSync(path.join(GOC, 'src/lich/bo_chay.js'), 'utf8');
  const than = boChay.split('\n').filter((d) => !d.trimStart().startsWith('*')
    && !d.trimStart().startsWith('//') && !d.trimStart().startsWith('/*')).join('\n');
  assert.equal(/\blaBu\b/.test(than), false, 'tham số laBu vẫn còn trong phần thân code');

  // (b) Lưới chung: quét CẢ pack. Bắt được cả ternary xuống dòng.
  //     Mẫu này đã cắn hai lần trong một buổi (`index.js` CAN_QR và `bo_chay.js` tienTo)
  //     nên canh bằng bài test chứ không bằng trí nhớ người review.
  const pat = /\?([^?:;{}]{1,120}):([^?:;{},)\]]{1,120})/gs;
  const chuan = (s) => s.replace(/\s+/g, ' ').trim();
  const loi = [];
  const quet = (thuMuc) => {
    for (const f of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      const p = path.join(thuMuc, f.name);
      if (f.isDirectory()) { quet(p); continue; }
      if (!f.name.endsWith('.js')) continue;
      const txt = fs.readFileSync(p, 'utf8');
      for (const m of txt.matchAll(pat)) {
        const a = chuan(m[1]); const b = chuan(m[2]);
        if (a && a === b) {
          loi.push(`${path.relative(GOC, p)}:${txt.slice(0, m.index).split('\n').length} -> ? ${a} : ${b}`);
        }
      }
    }
  };
  quet(path.join(GOC, 'src'));
  quet(path.join(GOC, 'bin'));
  assert.deepEqual(loi, [], `ternary hai nhánh GIỐNG HỆT (nhánh chết, người đọc tin là có phân biệt):\n${loi.join('\n')}`);
});

// ═══════════════════════════════════════════════════════════════════════
// CHỐNG HỒI QUY — bài này KHÔNG có trong danh sách Router giao, em tự thêm
// ═══════════════════════════════════════════════════════════════════════

test('T1g ★★★ lượt CHẠM TRẦN vẫn phải GỬI (trần 3 = nhắc đủ 3 lần, không phải 2)', async () => {
  // 🔴 Vì sao có bài này: lớp canh mới ở `_guiNhac` (A6) đọc lại trạng thái ngay
  // trước khi gửi. `danhChoLuotNhac` lại ĐÓNG dòng ngay khi chạm trần rồi caller
  // mới gửi ⇒ bản đầu của lớp canh đã chặn mất chính lượt cuối, biến trần 3 thành
  // nhắc 2 lần. Bộ test cũ KHÔNG bắt được: H2 chỉ gọi `danhChoLuotNhac` trực tiếp,
  // H3 chỉ kiểm tin DM host chứ không kiểm tin gửi vào NHÓM.
  const db = dbTam();
  const t0 = Date.parse('2026-08-21T02:00:00Z');
  nhacDaChot(db, { chuKyPhut: 1, tranSoLan: 3, guiLucMs: t0 - 1000 });

  const daGui = [];
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await chayNhipTheoDuoi({
      db, api: {}, bayGioMs: t0 + i * 60_000, queryHistory, enqueueQuestion,
      guiVaoNhom: async (_a, _c, t) => { daGui.push(t); return { msgId: 'x' }; },
      guiDmHost: async () => ({ msgId: 'y' }),
      groupMembers: () => [],
    });
  }

  assert.equal(daGui.length, 3, 'trần 3 phải nhắc ĐỦ 3 lần — lượt cuối bị nuốt');
  const sau = doc(db, 'NHAC');
  assert.equal(sau.trang_thai_td, TRANG_THAI_TD.DA_XONG);
  assert.equal(sau.ly_do_dong, 'HET_LUOT');
  closeDb(db);
});
