/**
 * ═══════════════════════════════════════════════════════════════════════
 * LƯỚI VỚT CÂU HỎI MỒ CÔI (21/08/2026)
 *
 * 🔴 SỰ CỐ GỐC — ba câu hỏi thật chết trong một buổi chiều:
 *      12:47 nhóm Haceco  "nói các rule e cần tuân theo đi"
 *      13:42 DM host      "Xong thì báo a nhé"
 *      14:29 DM host      "Alo xong chưa"
 *    Cả ba nằm ở `da_day` (đã đẩy, chưa ai trả lời). Anh chờ hơn một tiếng.
 *
 * 🔴 HAI LỖI TÁCH BIỆT, file này canh cả hai:
 *
 *  ① THAM SỐ BỊ NUỐT GIỮA ĐƯỜNG. `index.js` tính `chatIdHoi` (khoá định tuyến
 *    pane v10.2) rồi truyền vào `pushPendingQueue`, nhưng hàm đó ⛔ KHÔNG chuyển
 *    tiếp xuống `layHangDoiCho`. Khoá định tuyến chưa bao giờ chạy ⇒ pane khoá
 *    vào nhóm A vẫn giành được câu hỏi DM của host, đẩy vào phiên của nó, và
 *    câu đó chết ở đấy. Bài B1/B2 canh ĐƯỜNG ĐI của tham số, ⛔ không canh tầng
 *    cuối — tầng cuối luôn xanh vì nó có nhận được tham số đâu mà sai.
 *
 *  ② ⛔ KHÔNG CÓ LƯỚI VỚT. `gomDaDay` chỉ chạy lúc bắt tay; lưới "hết hạn 30
 *    phút" chỉ được TÍNH khi có ai quét tới dòng đó, mà ⛔ không ai quét
 *    `da_day` cả ⇒ dòng nằm im vô hạn. Bài A/C canh lưới mới.
 *
 * KHÔNG mạng, KHÔNG Zalo.
 *     node --test test/rescue_orphans.test.js
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  RESCUE_TICK_MS, MAX_RESCUE_ATTEMPTS, ORPHAN_AGE_MS, UNCLAIMED_AGE_MS, createRescueLedger,
} from '../src/ops/rescue_orphans.js';
import { pushPendingQueue } from '../src/mcp/channel.js';
import { notifyHost } from '../src/ops/notify_host.js';
import { moDb, dongDb } from '../src/store/db.js';
import { taoHangDoi, layHangDoiCho, capNhatHangDoi, nhanViec } from '../src/store/write.js';

function dbTam() {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-vot-'));
  return moDb(path.join(thuMuc, 'lichsu.db'));
}

/** Ghi một dòng hàng đợi với mốc thời gian TỰ CHỌN (để giả lập dòng cũ). */
function ghiDong(db, { rid, chatId = '111', tsTao, trangThai = 'cho', noiDung = 'câu hỏi' }) {
  taoHangDoi(db, {
    requestId: rid,
    chatIdHoi: chatId,
    msgId: `m-${rid}`,
    userId: '900',
    noiDung,
    tsTao,
  });
  if (trangThai !== 'cho') capNhatHangDoi(db, rid, trangThai);
}

// ═══════════════════════════════════════════════════════════════════════
// A · sổ đếm lượt vớt
// ═══════════════════════════════════════════════════════════════════════

test('A1 dòng `cho` LUÔN được đẩy và ⛔ không bị đếm', () => {
  const so = createRescueLedger({ log: () => {} });
  for (let i = 0; i < 10; i += 1) {
    assert.equal(so.choPhep({ request_id: 'r1', trang_thai: 'cho' }), true);
  }
  assert.equal(so.soDong(), 0, 'đường đi chính ⛔ không được dính trần');
});

test('A2 ★ vớt tối đa MAX_RESCUE_ATTEMPTS lần rồi TỪ CHỐI + báo host ĐÚNG một lần', () => {
  const bao = [];
  const so = createRescueLedger({ log: () => {}, notifyHost: (s) => bao.push(s) });
  const r = { request_id: 'r2', trang_thai: 'da_day', ts_tao: '2026-08-21T13:42:17.482Z', noi_dung: 'Xong thì báo a nhé' };

  for (let i = 0; i < MAX_RESCUE_ATTEMPTS; i += 1) assert.equal(so.choPhep(r), true, `lần ${i + 1} phải cho vớt`);
  assert.equal(so.choPhep(r), false, 'quá trần thì TỪ CHỐI');
  assert.equal(so.choPhep(r), false);
  assert.equal(so.choPhep(r), false);

  assert.equal(bao.length, 1, 'báo host ĐÚNG một lần, ⛔ không bắn mỗi nhịp');
  assert.ok(bao[0].includes('13:42'), 'câu báo phải nêu giờ hỏi');
  assert.ok(bao[0].includes('Xong thì báo a nhé'), 'và trích lại câu hỏi');
});

test('A3 `quen()` xoá khỏi sổ để nó ⛔ không phình vô hạn', () => {
  const so = createRescueLedger({ log: () => {} });
  so.choPhep({ request_id: 'r3', trang_thai: 'da_day' });
  assert.equal(so.soDong(), 1);
  so.quen('r3');
  assert.equal(so.soDong(), 0);
});

test('A4 ★★★ hằng số phải nằm đúng thứ tự — đây là chỗ đã gây lỗi thật', () => {
  // ⛔ 22/08/2026: ngưỡng 3 phút bằng đúng độ dài một lượt model bình thường,
  // nên lưới vớt kết luận "mồ côi" trong khi pane kia đang soạn dở, rồi đẩy
  // câu đó sang pane thứ hai. Ba ràng buộc dưới đây giữ cho chuyện đó ⛔ không
  // tái diễn — và giữ luôn cả trật tự "pane chủ được ưu tiên trước".
  assert.ok(ORPHAN_AGE_MS >= 10 * 60_000,
    '🔴 ngưỡng mồ côi phải CAO HƠN HẲN một lượt model, ⛔ không phải bằng nó');
  assert.ok(UNCLAIMED_AGE_MS > ORPHAN_AGE_MS,
    '🔴 pane chủ phải được thử lại TRƯỚC khi pane toàn quyền nhảy vào');
  assert.ok(UNCLAIMED_AGE_MS < 30 * 60_000,
    '🔴 phải kịp vớt TRƯỚC khi câu hỏi hết hạn (queueTtlMs mặc định 30 phút)');
  assert.ok(RESCUE_TICK_MS <= 60_000, 'quét ít nhất mỗi phút');
  assert.ok(MAX_RESCUE_ATTEMPTS >= 1 && MAX_RESCUE_ATTEMPTS <= 3);
});

test('A5 ★★ pane toàn quyền dùng NGƯỠNG RIÊNG, cao hơn, cho dòng vô chủ', () => {
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const than = idx.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(than, /tuoiMoCoiMs: ORPHAN_AGE_MS,[\s\S]{0,120}?choPhepDay/,
    'nhịp ① vớt đúng tuyến của mình');
  assert.match(than, /if \(toanBo\) \{[\s\S]{0,220}?tuoiMoCoiMs: UNCLAIMED_AGE_MS,[\s\S]{0,80}?chatIdHoi: null/,
    '🔴 nhịp ② (vô chủ) phải dùng ngưỡng CAO HƠN, ⛔ không dùng chung ngưỡng ①');
});

// ═══════════════════════════════════════════════════════════════════════
// B · ★ THAM SỐ PHẢI ĐI HẾT ĐƯỜNG — lỗi ① ở đầu file
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★★★ pushPendingQueue PHẢI chuyển `chatIdHoi` xuống layHangDoiCho', async () => {
  let thayTuyChon = null;
  await pushPendingQueue({
    db: {},
    queueTtlMs: 1000,
    guiThongBao: async () => true,
    layHangDoiCho: (_db, _ttl, t) => { thayTuyChon = t; return []; },
    capNhatHangDoi: () => true,
    chatIdHoi: '9993000000000000007',
    treToiThieuMs: 37_000,
    tuoiMoCoiMs: ORPHAN_AGE_MS,
  });

  assert.equal(thayTuyChon.chatIdHoi, '9993000000000000007',
    'khoá định tuyến pane BỊ NUỐT ⇒ pane nhóm A giành câu hỏi của nhóm B');
  assert.equal(thayTuyChon.treToiThieuMs, 37_000, 'ngưỡng dự phòng bị nuốt');
  assert.equal(thayTuyChon.tuoiMoCoiMs, ORPHAN_AGE_MS, 'tuổi mồ côi bị nuốt');
});

test('B2 ★ vắng tham số ⇒ giữ nguyên hành vi cũ (⛔ không tự lọc)', async () => {
  let thayTuyChon = null;
  await pushPendingQueue({
    db: {},
    queueTtlMs: 1000,
    guiThongBao: async () => true,
    layHangDoiCho: (_db, _ttl, t) => { thayTuyChon = t; return []; },
    capNhatHangDoi: () => true,
  });
  assert.equal(thayTuyChon.chatIdHoi, null);
  assert.equal(thayTuyChon.treToiThieuMs, 0);
  assert.equal(thayTuyChon.tuoiMoCoiMs, 0);
});

test('B3 ★ `choPhepDay` phải chặn TRƯỚC khi CAS nhận việc', async () => {
  const casGoi = [];
  const daDay = [];
  await pushPendingQueue({
    db: {},
    queueTtlMs: 0,
    guiThongBao: async (t) => { daDay.push(t.requestId); return true; },
    layHangDoiCho: () => ([
      { request_id: 'chan', chat_id_hoi: '1', trang_thai: 'da_day', ts_tao: new Date().toISOString(), noi_dung: 'x' },
      { request_id: 'qua', chat_id_hoi: '1', trang_thai: 'cho', ts_tao: new Date().toISOString(), noi_dung: 'y' },
    ]),
    capNhatHangDoi: () => true,
    nhanViec: (_db, rid) => { casGoi.push(rid); return true; },
    choPhepDay: (r) => String(r.request_id) !== 'chan',
  });

  assert.deepEqual(daDay, ['qua']);
  assert.deepEqual(casGoi, ['qua'],
    'dòng bị chặn ⛔ KHÔNG được CAS — CAS rồi bỏ là tự tạo ra dòng kẹt `dang_xu_ly`');
});

// ═══════════════════════════════════════════════════════════════════════
// C · tuổi mồ côi trong layHangDoiCho — chạm DB thật
// ═══════════════════════════════════════════════════════════════════════

test("C1 ★★★ dòng `da_day` QUÁ ngưỡng mồ côi -> ĐƯỢC vớt", () => {
  const db = dbTam();
  try {
    const cu = new Date(Date.now() - ORPHAN_AGE_MS - 60_000).toISOString();
    ghiDong(db, { rid: 'cu', tsTao: cu, trangThai: 'da_day', noiDung: 'Alo xong chưa' });

    const ds = layHangDoiCho(db, 30 * 60_000, { gomDaDay: true, tuoiMoCoiMs: ORPHAN_AGE_MS });
    assert.deepEqual(ds.map((r) => r.request_id), ['cu']);
  } finally { dongDb(db); }
});

test("C2 ★★★ dòng `da_day` còn MỚI -> ⛔ KHÔNG vớt (Claude đang soạn dở)", () => {
  const db = dbTam();
  try {
    ghiDong(db, {
      rid: 'moi',
      tsTao: new Date(Date.now() - 5_000).toISOString(),
      trangThai: 'da_day',
    });

    const ds = layHangDoiCho(db, 30 * 60_000, { gomDaDay: true, tuoiMoCoiMs: ORPHAN_AGE_MS });
    assert.deepEqual(ds, [], 'vớt câu đang xử lý dở = đẩy lại chính nó');
  } finally { dongDb(db); }
});

test('C3 ★ dòng `cho` ⛔ KHÔNG bị bắt chờ theo tuổi mồ côi', () => {
  const db = dbTam();
  try {
    ghiDong(db, { rid: 'moi-cho', tsTao: new Date().toISOString(), trangThai: 'cho' });

    const ds = layHangDoiCho(db, 30 * 60_000, { gomDaDay: true, tuoiMoCoiMs: ORPHAN_AGE_MS });
    assert.deepEqual(ds.map((r) => r.request_id), ['moi-cho'],
      'câu hỏi mới ⛔ KHÔNG được chậm 3 phút — nó chưa từng được đẩy cho ai');
  } finally { dongDb(db); }
});

test('C4 ★ `dang_xu_ly` cũng là dòng mồ côi (client chết giữa chừng)', () => {
  const db = dbTam();
  try {
    ghiDong(db, {
      rid: 'ket',
      tsTao: new Date(Date.now() - ORPHAN_AGE_MS * 2).toISOString(),
      trangThai: 'dang_xu_ly',
    });
    const ds = layHangDoiCho(db, 30 * 60_000, { gomDaDay: true, tuoiMoCoiMs: ORPHAN_AGE_MS });
    assert.deepEqual(ds.map((r) => r.request_id), ['ket']);
  } finally { dongDb(db); }
});

test('C5 ★ khoá định tuyến: chỉ lấy dòng của ĐÚNG hội thoại mình', () => {
  const db = dbTam();
  try {
    const cu = new Date(Date.now() - ORPHAN_AGE_MS - 60_000).toISOString();
    ghiDong(db, { rid: 'dm', chatId: '900', tsTao: cu, trangThai: 'da_day' });
    ghiDong(db, { rid: 'nhom', chatId: '111', tsTao: cu, trangThai: 'da_day' });

    const ds = layHangDoiCho(db, 30 * 60_000, {
      gomDaDay: true, tuoiMoCoiMs: ORPHAN_AGE_MS, chatIdHoi: '900',
    });
    assert.deepEqual(ds.map((r) => r.request_id), ['dm'],
      'pane khoá vào DM ⛔ KHÔNG được nhặt dòng của nhóm');
  } finally { dongDb(db); }
});

// ═══════════════════════════════════════════════════════════════════════
// D · TẦNG 1b — cảnh báo của CLIENT phải có đường ra tới host
//
// 🔴 Client là bên PHÁT HIỆN sự cố (nó quét hàng đợi) nhưng cố ý ⛔ không có
//    `api` Zalo, và `notifyCommand` mặc định `null`. Trước v11, báo động của
//    nó chết trong log: ba câu quá hạn chiều 21/08/2026 ⛔ không tới được anh.
// ═══════════════════════════════════════════════════════════════════════

const CAU_HINH_BAO = {
  hosts: [{ userId: '900', ten: 'Host', dmChatId: '9993000000000000009' }],
  groups: [],
  cauTrungTinh: 'x',
  notifyCommand: null,
};

test('D1 ★★★ client KHÔNG có api -> XẾP HÀNG DM, ⛔ không rơi xuống "chỉ còn log"', async () => {
  const daXep = [];
  const kq = await notifyHost(CAU_HINH_BAO, 'Có 3 câu anh hỏi mà em không kịp trả lời', {
    api: null,
    xepHangDm: (dm, text) => { daXep.push({ dm, text }); },
  });

  assert.equal(daXep.length, 1, 'phải xếp đúng một tin');
  assert.equal(daXep[0].dm, '9993000000000000009', 'gửi vào DM host');
  assert.ok(daXep[0].text.includes('3 câu'), 'giữ nguyên nội dung cảnh báo');
  assert.equal(kq.thanhCong, true);
  assert.ok(kq.chiTiet.some((s) => s.includes('tầng 1b')));
});

test('D2 ★ có api Zalo thì đi đường Zalo, ⛔ KHÔNG xếp hàng (⛔ không gửi đôi)', async () => {
  const daXep = [];
  const daGui = [];
  await notifyHost(CAU_HINH_BAO, 'thử', {
    api: { sendMessage: async (noiDung) => { daGui.push(noiDung); return { msgId: '1' }; } },
    xepHangDm: (dm, text) => { daXep.push({ dm, text }); },
  });
  assert.equal(daXep.length, 0, 'đi được đường Zalo thì ⛔ không xếp hàng nữa');
});

test('D3 ★ xếp hàng HỎNG -> ⛔ không nuốt im, đi tiếp xuống tầng dưới', async () => {
  const kq = await notifyHost(CAU_HINH_BAO, 'thử', {
    api: null,
    xepHangDm: () => { throw new Error('DB khoá'); },
  });
  assert.ok(kq.chiTiet.some((s) => s.includes('tầng 1b hỏng')), 'phải ghi lại là hỏng');
});

test('D4 ★★★ cảnh báo gửi qua Zalo PHẢI vào sổ lịch sử', async () => {
  // 🔴 Thiếu `ghiLai` thì đọc lại kho chỉ thấy câu anh hỏi, ⛔ không thấy câu
  // em đáp — và cảnh báo là loại tin đáng tra cứu nhất khi có sự cố.
  const daGhi = [];
  const kq = await notifyHost(CAU_HINH_BAO, 'daemon mất kết nối', {
    api: {
      sendMessage: async () => ({ message: { msgId: 123456789 } }),
      getOwnId: () => '9993000000000000008',
    },
    ghiLai: (tin) => daGhi.push(tin),
    uidTroLy: '9993000000000000008',
  });

  assert.equal(kq.tang, 1);
  assert.equal(daGhi.length, 1, 'tin cảnh báo phải được ghi lại đúng một lần');
  assert.equal(daGhi[0].chatId, '9993000000000000009');
  assert.equal(daGhi[0].userId, '9993000000000000008', 'phải ghi đúng người gửi là trợ lý');
  assert.ok(String(daGhi[0].noiDung).includes('mất kết nối'));
});

// ═══════════════════════════════════════════════════════════════════════
// E · NỐI DÂY — canh ĐƯỜNG ĐI, vì đây đúng là chỗ đã đứt một lần
// ═══════════════════════════════════════════════════════════════════════

test('E1 ★★★ client nối `baoHetHan` vào đường XẾP HÀNG, ⛔ không phải notifyHost trần', () => {
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const kh = idx.slice(idx.indexOf('async function chayClient'), idx.indexOf('export async function rutOutbox'));
  const sach = kh.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(sach, /xepHangDm:\s*\(dmChatId, text\)\s*=>\s*\{\s*xepHangGui\(db,/,
    '🔴 client phải đưa hàm xếp hàng vào notifyHost, không thì cảnh báo chết trong log');
  assert.match(sach, /baoHetHan:\s*\(loiNhan\)\s*=>\s*baoHostClient\(loiNhan\)/,
    '🔴 câu hỏi quá hạn phải đi qua đường có thật');
  assert.ok(!/baoHetHan:\s*\(loiNhan\)\s*=>\s*notifyHost\(cauHinh, loiNhan, \{ api: null \}\)/.test(sach),
    '⛔ đường cũ (rơi xuống chỉ-còn-log) ⛔ không được sống lại');
});

test('E2 ★★★ daemon báo host qua một cửa DUY NHẤT có kèm `ghiLai`', () => {
  // 🔴 Bảy chỗ trong daemon gọi báo host. Mỗi chỗ tự truyền tham số là bảy cơ
  // hội quên `ghiLai` — và quên thì ⛔ không có lỗi nào nổ ra, chỉ là sổ sách
  // thiếu vế trả lời. Ép tất cả đi qua một hàm.
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const than = idx.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(than, /const baoHostDaemon = \(thongDiep, them = \{\}\) => notifyHost\(cauHinh, thongDiep, \{[\s\S]{0,200}?ghiLai: ghiLaiTinTroLy/,
    '🔴 cửa chung phải luôn kèm ghiLai');
  assert.ok(!/notifyHost\(cauHinh, (loiNhan|s), \{ api \}\)/.test(than),
    '⛔ ⛔ không được gọi thẳng notifyHost với mỗi `api` — đó là đường ⛔ không ghi sổ');
});

test('C6 ★ CAS `nhanViec` chỉ thắng MỘT lần — hai lưới vớt ⛔ không đẩy đôi', () => {
  const db = dbTam();
  try {
    const cu = new Date(Date.now() - ORPHAN_AGE_MS - 60_000).toISOString();
    ghiDong(db, { rid: 'dua', tsTao: cu, trangThai: 'da_day' });

    assert.equal(nhanViec(db, 'dua', 'da_day', 'dang_xu_ly'), true, 'bên thứ nhất thắng');
    assert.equal(nhanViec(db, 'dua', 'da_day', 'dang_xu_ly'), false, 'bên thứ hai PHẢI thua');
  } finally { dongDb(db); }
});
