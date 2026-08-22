/**
 * ═══════════════════════════════════════════════════════════════════════
 * LƯỚI CANH OUTBOX KẸT — bước 5 (21/08/2026).
 *
 * Bệnh: ở `cheDo:"tach"`, `tra_loi` chỉ XẾP HÀNG rồi báo model "đã xếp hàng".
 * Daemon chết ⇒ model tưởng xong, người nhắn không nhận gì, KHÔNG AI BÁO.
 *
 * 🔴 Hai thứ phải canh cho bằng được, quan trọng ngang nhau:
 *    ① lưới CÓ nổ khi tin kẹt thật (kể cả ca `'dang_gui'` — tiến trình cầm nó chết)
 *    ② lưới KHÔNG nổ bừa: không bắn gì vào NHÓM, không báo lặp mỗi nhịp, và
 *      ở chế độ một-tiến-trình (outbox rỗng) thì im hoàn toàn.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeSendResult, claimOutbound, upsertConversation, enqueueOutbound } from '../src/store/write.js';
import { TRANG_THAI_GUI } from '../src/lib/hang_so.js';
import {
  GIAN_AN_KHOI_DONG_MS, NGUONG_KET_MS, TRAN_LIET_KE, taoBoCanhOutbox,
} from '../src/lich/canh_outbox.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';

const NHOM = '9990000000001';
const T0 = 1_700_000_000_000;

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function moiTruong() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-obx-'));
  RAC.push(d);
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm Dự Án', duocNghe: true });
  return { db, so: path.join(d, 'obx.log') };
}

/**
 * Bộ canh với mốc khởi động ĐẶT SẴN — nếu để nó tự lấy nhịp đầu làm mốc thì mọi
 * bài đều phải đốt một nhịp cho gian ân, che mất thứ đang muốn đo.
 */
function bo(so, tuyChon = {}) {
  return taoBoCanhOutbox({ duongDanSo: so, mocKhoiDongMs: T0 - GIAN_AN_KHOI_DONG_MS, ...tuyChon });
}

function docSo(duongDan) {
  if (!fs.existsSync(duongDan)) return [];
  return fs.readFileSync(duongDan, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Xếp một tin vào outbox và đặt mốc thời gian về ĐỒNG HỒ GIẢ của bài test.
 *
 * 🔴 PHẢI đặt lại ts KỂ CẢ KHI `giaMs = 0`. `enqueueOutbound` đóng dấu bằng
 * `_bayGio()` — GIỜ MÁY THẬT (2026), trong khi bài test chạy ở `T0` (2023) ⇒ để
 * nguyên thì mọi dòng đều "ở tương lai" so với mốc lọc, và lưới KHÔNG BAO GIỜ
 * thấy chúng. Bài O7b đã đỏ đúng vì chuyện này — bẫy tự cắn của bộ test, không
 * phải lỗi của lưới.
 */
function xepHang(db, { id = 'g-1', giaMs = 0, text = 'câu trả lời cho anh' } = {}) {
  const { id: idThat } = enqueueOutbound(db, { id, requestId: 'r-1', chatIdDich: NHOM, text });
  const moc = new Date(T0 - giaMs).toISOString();
  db.prepare('UPDATE hang_doi_gui SET ts_tao = $t, ts_cap_nhat = $t WHERE id = $id')
    .run({ t: moc, id: idThat });
  return idThat;
}

// ═══════════════════════════════════════════════════════════════════════
// O1 — NGHIỆM THU ①: tin kẹt ở 'cho'  =>  DM host
// ═══════════════════════════════════════════════════════════════════════

test('O1 — tin ở "cho" quá ngưỡng: DM host, và KHÔNG bắn gì vào nhóm', async () => {
  const { db, so } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS });
  const daBaoHost = [];
  const b = bo(so);

  const n = await b.chayMotNhip({
    db, bayGioMs: T0, notifyHost: async (s) => { daBaoHost.push(s); },
  });
  assert.equal(n.ket, 1);
  assert.equal(n.notifyHost, 1);
  assert.equal(daBaoHost.length, 1);
  assert.match(daBaoHost[0], /1 tin đã XẾP HÀNG gửi mà chưa ra khỏi máy/);
  assert.match(daBaoHost[0], /Nhóm Dự Án/, 'host phải biết tin kẹt đi ĐÂU');
  // 🔴 Ràng buộc cứng của Router: KHÔNG kèm nội dung tin (leak sang DM host).
  assert.ok(!daBaoHost[0].includes('câu trả lời cho anh'),
    'bê nội dung tin của một hội thoại sang DM host là mở đúng đường leak_guard cấm');

  closeDb(db);
});

test('O1b — chưa tới ngưỡng thì im (đừng bắn khi daemon còn đang đẩy)', async () => {
  const { db, so } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS - 1000 });
  const daBaoHost = [];
  const b = bo(so);

  const n = await b.chayMotNhip({
    db, bayGioMs: T0, notifyHost: async (s) => { daBaoHost.push(s); },
  });
  assert.equal(n.ket, 0);
  assert.equal(daBaoHost.length, 0);

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O2 — NGHIỆM THU ②: gửi bình thường  =>  lưới KHÔNG nổ
// ═══════════════════════════════════════════════════════════════════════

test('O2 — tin đã gửi xong: lưới KHÔNG nổ dù dòng cũ bao nhiêu đi nữa', async () => {
  const { db, so } = moiTruong();
  const id = xepHang(db, { giaMs: NGUONG_KET_MS * 10 });
  assert.equal(claimOutbound(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI), true);
  assert.equal(writeSendResult(db, id, { msgId: 'm-999' }), true);
  // Lùi cả dòng 'da_gui' về quá khứ: tuổi KHÔNG được là lý do để nổ.
  db.prepare('UPDATE hang_doi_gui SET ts_cap_nhat = $t WHERE id = $id')
    .run({ t: new Date(T0 - NGUONG_KET_MS * 10).toISOString(), id });

  const daBaoHost = [];
  const b = bo(so);
  const n = await b.chayMotNhip({
    db, bayGioMs: T0, notifyHost: async (s) => { daBaoHost.push(s); },
  });
  assert.equal(n.ket, 0);
  assert.equal(n.notifyHost, 0);
  assert.equal(daBaoHost.length, 0);

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O3 — NGHIỆM THU ③: 'dang_gui' quá lâu = tiến trình cầm nó ĐÃ CHẾT
// ═══════════════════════════════════════════════════════════════════════

test('O3 — dòng "dang_gui" quá lâu CŨNG nổ (đừng bỏ sót ca tiến trình chết)', async () => {
  const { db, so } = moiTruong();
  const id = xepHang(db);
  // Daemon nhận việc rồi chết trước khi gửi -> dòng nằm 'dang_gui' vĩnh viễn.
  assert.equal(claimOutbound(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI), true);
  db.prepare('UPDATE hang_doi_gui SET ts_cap_nhat = $t WHERE id = $id')
    .run({ t: new Date(T0 - NGUONG_KET_MS).toISOString(), id });

  const daBaoHost = [];
  const b = bo(so);
  const n = await b.chayMotNhip({
    db, bayGioMs: T0, notifyHost: async (s) => { daBaoHost.push(s); },
  });
  assert.equal(n.notifyHost, 1, "'dang_gui' quá lâu mà bỏ qua = tin chết câm đúng ca daemon sập");
  assert.match(daBaoHost[0], /dang_gui/);
  assert.match(daBaoHost[0], /đã thử 1 lần/, 'claimOutbound cộng so_lan_thu lúc NHẬN — phải hiện ra');

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O4 — NGHIỆM THU ④: một dòng kẹt lâu  =>  báo ĐÚNG 1 LẦN
// ═══════════════════════════════════════════════════════════════════════

test('O4 — kẹt suốt 20 nhịp: host chỉ nhận ĐÚNG MỘT tin', async () => {
  const { db, so } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS });
  const daBaoHost = [];
  const notifyHost = async (s) => { daBaoHost.push(s); };
  const b = bo(so);

  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await b.chayMotNhip({ db, bayGioMs: T0 + i * 30_000, notifyHost });
  }
  assert.equal(daBaoHost.length, 1, 'nhịp 30 giây mà báo mỗi nhịp = 120 tin/giờ vào DM của anh');
  assert.equal(docSo(so).filter((r) => r.su_kien === 'ket').length, 1, 'sổ cũng chỉ ghi một lần');

  closeDb(db);
});

test('O4b — nhiều tin cùng kẹt: gom MỘT tin, không phải mỗi tin một DM', async () => {
  const { db, so } = moiTruong();
  for (let i = 0; i < 3; i += 1) xepHang(db, { id: `g-${i}`, giaMs: NGUONG_KET_MS });
  const daBaoHost = [];
  const b = bo(so);

  const n = await b.chayMotNhip({
    db, bayGioMs: T0, notifyHost: async (s) => { daBaoHost.push(s); },
  });
  assert.equal(n.ket, 3);
  assert.equal(daBaoHost.length, 1, 'ba tin kẹt = ba DM là tự biến cảnh báo thật thành rác');
  assert.match(daBaoHost[0], /3 tin đã XẾP HÀNG/);
  assert.equal(docSo(so).filter((r) => r.su_kien === 'ket').length, 3,
    'nhưng SỔ phải ghi đủ 3 dòng — gom là chuyện của tin nhắn, không phải của sổ');

  closeDb(db);
});

test('O4c — nhiều tin hơn TRAN_LIET_KE: tin DM phải nói rõ còn bao nhiêu nữa', async () => {
  const { db, so } = moiTruong();
  const tong = TRAN_LIET_KE + 3;
  for (let i = 0; i < tong; i += 1) xepHang(db, { id: `g-${i}`, giaMs: NGUONG_KET_MS });
  const daBaoHost = [];
  const b = bo(so);

  await b.chayMotNhip({ db, bayGioMs: T0, notifyHost: async (s) => { daBaoHost.push(s); } });
  assert.match(daBaoHost[0], new RegExp(`${tong} tin đã XẾP HÀNG`));
  assert.match(daBaoHost[0], /và 3 tin nữa/, 'cắt danh sách mà không nói là giấu bớt sự thật');

  closeDb(db);
});

test('O4d — tin kẹt rồi ĐI ĐƯỢC: ghi sổ thoat_ket (bằng chứng lưới không kêu oan)', async () => {
  const { db, so } = moiTruong();
  const id = xepHang(db, { giaMs: NGUONG_KET_MS });
  const daBaoHost = [];
  const notifyHost = async (s) => { daBaoHost.push(s); };
  const b = bo(so);

  await b.chayMotNhip({ db, bayGioMs: T0, notifyHost });
  assert.equal(daBaoHost.length, 1);

  claimOutbound(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
  writeSendResult(db, id, { msgId: 'm-1' });

  const n = await b.chayMotNhip({ db, bayGioMs: T0 + 30_000, notifyHost });
  assert.equal(n.thoatKet, 1);
  assert.equal(daBaoHost.length, 1, 'thoát kẹt rồi thì đừng nhắn thêm gì');
  const d = docSo(so).find((r) => r.su_kien === 'thoat_ket');
  assert.equal(d.trang_thai_cuoi, TRANG_THAI_GUI.DA_GUI);

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O5 — NGHIỆM THU ⑤: chế độ MỘT-TIẾN-TRÌNH (outbox rỗng) => im hoàn toàn
// ═══════════════════════════════════════════════════════════════════════

test('O5 — outbox rỗng (chế độ một-tiến-trình): lưới KHÔNG bao giờ nổ', async () => {
  const { db, so } = moiTruong();
  const daBaoHost = [];
  const b = bo(so);

  // Chạy xuyên một ngày giả lập.
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const n = await b.chayMotNhip({
      db, bayGioMs: T0 + i * 30_000, notifyHost: async (s) => { daBaoHost.push(s); },
    });
    assert.equal(n.ket, 0);
    assert.equal(n.notifyHost, 0);
  }
  assert.equal(daBaoHost.length, 0);
  // Và sổ chỉ có ĐÚNG một dòng mẫu số (toàn số 0), không phình theo nhịp.
  const d = docSo(so);
  assert.equal(d.length, 1, 'outbox đứng yên mà sổ vẫn nở = 2.880 dòng rác/ngày');
  assert.deepEqual(
    { su_kien: d[0].su_kien, cho: d[0].cho, dang_gui: d[0].dang_gui },
    { su_kien: 'dem_outbox', cho: 0, dang_gui: 0 },
  );

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O6 — MẪU SỐ: ghi khi phân bố ĐỔI, im khi đứng yên
// ═══════════════════════════════════════════════════════════════════════

test('O6 — sổ ghi cả lúc KHOẺ, nhưng chỉ khi có gì đổi', async () => {
  const { db, so } = moiTruong();
  const b = bo(so);

  await b.chayMotNhip({ db, bayGioMs: T0 });
  const id = xepHang(db);
  await b.chayMotNhip({ db, bayGioMs: T0 + 30_000 });
  await b.chayMotNhip({ db, bayGioMs: T0 + 60_000 });   // không đổi gì -> không ghi
  claimOutbound(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
  writeSendResult(db, id, { msgId: 'm-1' });
  await b.chayMotNhip({ db, bayGioMs: T0 + 90_000 });

  const dem = docSo(so).filter((r) => r.su_kien === 'dem_outbox');
  assert.equal(dem.length, 3, 'ba lần phân bố khác nhau -> đúng ba dòng, không hơn không kém');
  assert.deepEqual(dem.map((r) => [r.cho, r.dang_gui, r.da_gui]),
    [[0, 0, 0], [1, 0, 0], [0, 0, 1]]);
  // 🔴 Đây chính là MẪU SỐ: tuần sau đếm được "kẹt N lần trên tổng M tin đã gửi".
  assert.equal(dem.at(-1).da_gui, 1);

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O7 — GIAN ÂN LÚC KHỞI ĐỘNG: đừng kêu oan lô tồn daemon sắp đẩy
// ═══════════════════════════════════════════════════════════════════════

test('O7 — daemon vừa lên, lô tồn cũ: nhường trọn một nhịp rồi mới báo', async () => {
  const { db, so } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS * 5 });   // tồn từ đêm qua
  const daBaoHost = [];
  const notifyHost = async (s) => { daBaoHost.push(s); };
  // Mốc khởi động = ĐÚNG bây giờ (tiến trình vừa lên).
  const b = taoBoCanhOutbox({ duongDanSo: so, mocKhoiDongMs: T0 });

  const n0 = await b.chayMotNhip({ db, bayGioMs: T0, notifyHost });
  assert.equal(n0.boQuaGianAn, 1);
  assert.equal(daBaoHost.length, 0, 'daemon chưa kịp thở đã kêu = báo động giả');

  const n1 = await b.chayMotNhip({ db, bayGioMs: T0 + GIAN_AN_KHOI_DONG_MS - 1, notifyHost });
  assert.equal(n1.boQuaGianAn, 1);
  assert.equal(daBaoHost.length, 0);

  // Hết gian ân mà vẫn kẹt -> báo.
  const n2 = await b.chayMotNhip({ db, bayGioMs: T0 + GIAN_AN_KHOI_DONG_MS, notifyHost });
  assert.equal(n2.notifyHost, 1);

  closeDb(db);
});

test('O7b — gian ân KHÔNG che ca đang chạy thì bị chặn (mốc ≤150 giây)', async () => {
  const { db, so } = moiTruong();
  const daBaoHost = [];
  const notifyHost = async (s) => { daBaoHost.push(s); };
  // Tiến trình đã sống từ lâu — đúng hoàn cảnh của mốc nghiệm thu ①.
  const b = taoBoCanhOutbox({ duongDanSo: so, mocKhoiDongMs: T0 - 86_400_000 });

  // Tin xếp hàng lúc T0, đường gửi bị chặn.
  xepHang(db, { giaMs: 0 });
  let baoLuc = null;
  // Nhịp 30 giây, y như bo_chay.
  for (let t = 0; t <= 180_000 && baoLuc === null; t += 30_000) {
    // eslint-disable-next-line no-await-in-loop
    const n = await b.chayMotNhip({ db, bayGioMs: T0 + t, notifyHost });
    if (n.notifyHost) baoLuc = t;
  }
  assert.notEqual(baoLuc, null, 'chặn đường gửi mà im luôn = đúng bệnh cần chống');
  assert.ok(baoLuc <= 150_000, `báo sau ${baoLuc / 1000}s — mốc Router chốt là ≤150 giây`);

  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// O8 — DÂY NỐI THẬT + CÔNG TẮC RIÊNG
// ═══════════════════════════════════════════════════════════════════════

function nhipThat(db, them = {}) {
  return {
    db,
    api: {},
    guiVaoNhom: them.guiVaoNhom ?? (async () => ({ msgId: 'x' })),
    guiDmHost: them.guiDmHost ?? (async () => ({ msgId: 'y' })),
    groupMembers: () => [],
    guiThongBao: null,
    enqueueQuestion: () => {},
    dmHostChatId: 'dm-host',
    ...them,
  };
}

test('O8 — chayNhipTheoDuoi TỰ chạy lưới outbox, không cần index.js truyền gì', async () => {
  const { db } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS });
  const vaoNhom = [];
  const dmHost = [];
  const p = nhipThat(db, {
    guiVaoNhom: async (...a) => { vaoNhom.push(a); return { msgId: 'x' }; },
    guiDmHost: async (...a) => { dmHost.push(a); return { msgId: 'y' }; },
    // Mốc khởi động của bộ canh mặc định = nhịp đầu tiên -> đốt một nhịp gian ân.
  });

  await chayNhipTheoDuoi({ ...p, bayGioMs: T0 });
  await chayNhipTheoDuoi({ ...p, bayGioMs: T0 + GIAN_AN_KHOI_DONG_MS });

  assert.equal(dmHost.length, 1, 'lưới không được chạy qua nhịp thật -> tin kẹt = im lặng');
  assert.equal(dmHost[0][1], 'dm-host');
  assert.match(String(dmHost[0][2]), /chưa ra khỏi máy/);
  // 🔴 Ràng buộc cứng: KHÔNG một tin nào vào nhóm.
  assert.equal(vaoNhom.length, 0, 'bắn vào nhóm người thật = hỏng nặng hơn tin kẹt');

  closeDb(db);
});

test('O8b — CÔNG TẮC RIÊNG: ZTL_LUOI_OUTBOX=0 tắt được, và mặc định là BẬT', async () => {
  const cu = process.env.ZTL_LUOI_OUTBOX;
  try {
    const { db } = moiTruong();
    xepHang(db, { giaMs: NGUONG_KET_MS });
    const b = bo(null);
    const dmHost = [];
    const p = nhipThat(db, {
      canhOutbox: b,
      guiDmHost: async (...a) => { dmHost.push(a); return { msgId: 'y' }; },
    });

    process.env.ZTL_LUOI_OUTBOX = '0';
    await chayNhipTheoDuoi({ ...p, bayGioMs: T0 });
    assert.equal(dmHost.length, 0, 'tắt mà vẫn chạy = công tắc vô nghĩa');
    assert.equal(b.storeStats().ket, 0, 'tắt là KHÔNG soi DB, không chỉ là không gửi');

    delete process.env.ZTL_LUOI_OUTBOX;
    await chayNhipTheoDuoi({ ...p, bayGioMs: T0 + 30_000 });
    assert.equal(dmHost.length, 1, 'MẶC ĐỊNH phải BẬT — lưới này canh sự thật khách quan');

    closeDb(db);
  } finally {
    if (cu === undefined) delete process.env.ZTL_LUOI_OUTBOX;
    else process.env.ZTL_LUOI_OUTBOX = cu;
  }
});

test('O8c — 🔴 công tắc CHỈ nghe ĐÚNG biến của mình, không nghe biến lạ', async () => {
  const cu = { ...process.env };
  try {
    // 21/08/2026 pack từng có một lưới thứ hai với cờ riêng, và bài này vốn canh
    // "tắt lưới kia KHÔNG được tắt lưới này". Lưới kia đã bỏ hẳn, nhưng TÍNH CHẤT
    // thì phải giữ: một biến môi trường KHÁC không được lật công tắc của lưới này.
    // ⛔ Xoá bài theo lưới cũ là mở lại đúng cửa "gộp cờ" mà nó sinh ra để chặn.
    delete process.env.ZTL_LUOI_OUTBOX;
    process.env.ZTL_LICH_HEN = '0';
    process.env.ZTL_LUOI = '0';
    process.env.ZTL_LUOI_OUTBOX_X = '0';

    const { db } = moiTruong();
    xepHang(db, { giaMs: NGUONG_KET_MS });
    const dmHost = [];
    const p = nhipThat(db, {
      guiDmHost: async (...a) => { dmHost.push(a); return { msgId: 'y' }; },
    });
    await chayNhipTheoDuoi({ ...p, bayGioMs: T0 });
    await chayNhipTheoDuoi({ ...p, bayGioMs: T0 + GIAN_AN_KHOI_DONG_MS });
    assert.equal(dmHost.length, 1, 'một biến lạ tắt được lưới = công tắc nghe nhầm đài');

    closeDb(db);
  } finally {
    for (const k of ['ZTL_LUOI_OUTBOX', 'ZTL_LICH_HEN', 'ZTL_LUOI', 'ZTL_LUOI_OUTBOX_X']) {
      if (cu[k] === undefined) delete process.env[k];
      else process.env[k] = cu[k];
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
// O9 — HỎNG THÌ HỎNG VỀ PHÍA CÒN KÊU, và không được làm chết nhịp
// ═══════════════════════════════════════════════════════════════════════

test('O9 — đọc outbox hỏng: đếm lỗi, KHÔNG ném ra ngoài làm chết nhịp nhắc', async () => {
  const { db } = moiTruong();
  const b = bo(null, {
    layKet: () => { throw new Error('outbox hỏng (giả lập)'); },
  });
  const n = await b.chayMotNhip({ db, bayGioMs: T0, notifyHost: async () => {} });
  assert.equal(n.loi, 1);
  assert.equal(b.storeStats().loi, 1);

  closeDb(db);
});

test('O9b — DM host ném lỗi: nhịp vẫn về bình thường', async () => {
  const { db } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS });
  const b = bo(null);
  const n = await b.chayMotNhip({
    db, bayGioMs: T0, notifyHost: async () => { throw new Error('Zalo chết'); },
  });
  assert.equal(n.notifyHost, 1, 'đã đánh dấu là ĐÃ BÁO — không được quay lại spam mỗi nhịp');
  // Chờ microtask của nhánh fire-and-forget xả hết, không để lỗi rơi ra ngoài.
  await new Promise((r) => { setTimeout(r, 5); });

  closeDb(db);
});

test('O9c — không có đường DM host: vẫn ghi sổ, không im lặng tuyệt đối', async () => {
  const { db, so } = moiTruong();
  xepHang(db, { giaMs: NGUONG_KET_MS });
  const b = bo(so);
  const n = await b.chayMotNhip({ db, bayGioMs: T0, notifyHost: null });
  assert.equal(n.notifyHost, 1);
  assert.equal(docSo(so).filter((r) => r.su_kien === 'ket').length, 1,
    'mất đường DM mà sổ cũng trống thì sau này không ai lần ra được');

  closeDb(db);
});
