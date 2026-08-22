/**
 * v3 — test DÒ TIN THU HỒI BẰNG ĐỐI CHIẾU.
 *
 * Chạy HOÀN TOÀN KHÔNG CẦN ZALO, không cần mạng: `api` là đồ giả, thuật toán
 * lõi (`classifyDrift`, `lockBand`) là hàm thuần.
 *
 * 🔴 Trọng tâm bộ test này là CHỐNG VU OAN. Kết luận nhầm "người này đã thu
 * hồi tin" nặng hơn hẳn bỏ sót, nên phần lớn bài dưới đây kiểm đúng một thứ:
 * hệ thống có chịu IM LẶNG khi chưa đủ chắc hay không.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, upsertConversation } from '../src/store/write.js';
import { queryHistory } from '../src/store/query.js';
import {
  A0_BO_DO, BIEN_THE_THAM_SO, DO_TIN_CAY, KET_LUAN_A0, NGUON_THU_HOI, NHOM_LOI_A0,
} from '../src/lib/hang_so.js';

import {
  stripGPrefix, buildApiParams, fetchGroupHistory, registerHistoryApi, cloudMessageBase,
  describeError, classifyErrorGroup, sessionReady, HISTORY_API_NAME, summarizeResponseBody,
  errorGroupMeaning,
} from '../src/scan/history_api.js';
import {
  applyScanResult, lockBand, writeScanLog, groupsToScan, classifyDrift, runScanPass,
  callsToday, messagesInWindow, withinBand, inQuietHours, isScanEnabled,
} from '../src/scan/drift_check.js';
import { maskSampleMessage, isProbeA0Enabled, runProbeA0, waitForSession } from '../src/scan/probe_a0.js';

const RAC = [];
function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-scan-'));
  RAC.push(d);
  return openDb(path.join(d, 'kho', 'lichsu.db'));
}
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

const NHOM = '9990000000001';
const GIO = 1_700_000_000_000;

function moNghe(db, chatId = NHOM) {
  upsertConversation(db, { chatId, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
}
function them(db, msgId, tsZalo, v = {}) {
  writeMessage(db, {
    chatId: NHOM, msgId, cliMsgId: null, userId: '555', tenLucGui: 'A',
    msgType: 'chat.text', noiDung: `tin ${msgId}`, contentRaw: null,
    tsZalo, tuToi: false, hasHostMention: false, ...v,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// A. SO SÁNH msg_id — cái bẫy số vs TEXT
// ═══════════════════════════════════════════════════════════════════════

test('A1 ★ so msg_id bằng BigInt, KHÔNG bằng chuỗi (chuỗi thì "9" > "10")', () => {
  // Nếu so chuỗi, '9' > '10' và '9' sẽ bị coi là NGOÀI biên [1, 10].
  assert.equal(withinBand('9', '1', '10'), true);
  // Vượt Number.MAX_SAFE_INTEGER: ép Number là mất chính xác ÂM THẦM.
  const lon = '9007199254740993';      // 2^53 + 1
  assert.equal(withinBand(lon, '9007199254740992', '9007199254740994'), true);
  assert.equal(withinBand('9007199254740991', lon, '9007199254740995'), false);
});

test('A2 id không ép được BigInt -> KHÔNG kết luận (fail-closed)', () => {
  assert.equal(withinBand('abc', '1', '10'), false);
});

test('A3 stripGPrefix bỏ đúng một ký tự "g" đầu', () => {
  assert.equal(stripGPrefix('g123'), '123');
  assert.equal(stripGPrefix('123'), '123');
  assert.equal(stripGPrefix('gg1'), 'g1', 'chỉ bỏ MỘT ký tự, không tham lam');
});

// ═══════════════════════════════════════════════════════════════════════
// B. THUẬT TOÁN HIỆU TẬP HỢP
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★ tin có trong DB, trong biên, vắng ở Zalo -> NGHI bị thu hồi', () => {
  const kq = classifyDrift({
    zIds: ['100', '300'],
    dsDb: [{ msgId: '100', tsZalo: GIO }, { msgId: '200', tsZalo: GIO }, { msgId: '300', tsZalo: GIO }],
    bienMin: '100', bienMax: '300', bayGioMs: GIO + 3_600_000,
  });
  assert.deepEqual(kq.vangMat, ['200']);
});

test('B2 ★ KHOẢNG TRỐNG msg_id KHÔNG phải dấu hiệu thu hồi', () => {
  // Đây là cái sai gốc phải chặn: msg_id là đồng hồ toàn cục ~58 đơn vị/ms,
  // hai tin cách nhau 2 giây đã có ~116.000 id trống. Nếu ai đó cài "thiếu id
  // = thu hồi" thì bài này đỏ.
  const kq = classifyDrift({
    zIds: ['1000000', '1116000'],
    dsDb: [{ msgId: '1000000', tsZalo: GIO }, { msgId: '1116000', tsZalo: GIO }],
    bienMin: '1000000', bienMax: '1116000', bayGioMs: GIO + 3_600_000,
  });
  assert.deepEqual(kq.vangMat, [], 'khoảng trống là BÌNH THƯỜNG, không được kết luận gì');
});

test('B3 ★ Zalo trả RỖNG -> tuyệt đối KHÔNG kết luận gì (chống vu oan cả nhóm)', () => {
  // Một lời gọi mạng hỏng trả danh sách rỗng. Nếu coi rỗng là "hiện trạng" thì
  // CẢ NHÓM bị đánh dấu thu hồi trong một lượt.
  const kq = classifyDrift({
    zIds: [],
    dsDb: [{ msgId: '1', tsZalo: GIO }, { msgId: '2', tsZalo: GIO }],
    bienMin: null, bienMax: null, bayGioMs: GIO + 3_600_000,
  });
  assert.deepEqual(kq.vangMat, []);
  assert.equal(kq.soNgoaiBien, 2);
});

test('B4 tin NGOÀI biên -> không kết luận (ca ③)', () => {
  const kq = classifyDrift({
    zIds: ['200', '300'],
    dsDb: [{ msgId: '100', tsZalo: GIO }, { msgId: '250', tsZalo: GIO }],
    bienMin: '200', bienMax: '300', bayGioMs: GIO + 3_600_000,
  });
  assert.deepEqual(kq.vangMat, ['250']);
  assert.equal(kq.soNgoaiBien, 1, "'100' nằm dưới biên -> im lặng");
});

test('B5 Zalo có mà DB không -> BACKFILL (ca ②, phần thưởng thêm)', () => {
  const kq = classifyDrift({
    zIds: ['100', '200'],
    dsDb: [{ msgId: '100', tsZalo: GIO }],
    bienMin: '100', bienMax: '200', bayGioMs: GIO + 3_600_000,
  });
  assert.deepEqual(kq.backfill, ['200']);
});

test('B6 ★ CHỐT 3: tin mới < 60 giây -> BỎ QUA (có thể đang đồng bộ)', () => {
  const bayGio = GIO + 10_000;
  const kq = classifyDrift({
    zIds: ['100'],
    dsDb: [{ msgId: '100', tsZalo: GIO }, { msgId: '150', tsZalo: bayGio - 5_000 }],
    bienMin: '100', bienMax: '200', bayGioMs: bayGio,
  });
  assert.deepEqual(kq.vangMat, [], 'tin 5 giây tuổi mà kết luận thu hồi là vu oan');
});

test('B7 ★ CHỐT 4: bản ghi nguồn SU_KIEN KHÔNG bị đối chiếu đụng vào', () => {
  const kq = classifyDrift({
    zIds: [],
    dsDb: [{ msgId: '150', tsZalo: GIO, nguonHienTai: NGUON_THU_HOI.SU_KIEN }],
    bienMin: '100', bienMax: '200', bayGioMs: GIO + 3_600_000,
  });
  assert.deepEqual(kq.vangMat, [], 'đã biết CHẮC rồi thì đối chiếu không được hạ cấp');
});

// ═══════════════════════════════════════════════════════════════════════
// C. CHỐT 1 — thu hẹp biên khi trần cắt trang
// ═══════════════════════════════════════════════════════════════════════

test('C1 không cắt trang -> giữ nguyên biên', () => {
  const b = lockBand({ cutTrang: false, minMsgId: '10', maxMsgId: '90', minMsgIdTrangCuoiTron: '10' });
  assert.deepEqual([b.bienMin, b.bienMax, b.daThuHep], ['10', '90', false]);
});

test('C1b ★ CẮT TRANG -> THU HẸP biên về trang cuối lấy trọn', () => {
  // Không thu hẹp thì những tin cũ hơn phần đã đọc sẽ "vắng mặt" chỉ vì ta
  // chưa đọc tới -> vu oan đúng nhóm tin đó.
  const b = lockBand({ cutTrang: true, minMsgId: '10', maxMsgId: '90', minMsgIdTrangCuoiTron: '50' });
  assert.deepEqual([b.bienMin, b.bienMax, b.daThuHep], ['50', '90', true]);
});

// ═══════════════════════════════════════════════════════════════════════
// D. CHỐT 2 — phải vắng 2 lượt LIÊN TIẾP (chạy trên DB thật)
// ═══════════════════════════════════════════════════════════════════════

test('D1 ★ vắng LẦN ĐẦU -> chỉ NGHI_NGO, CHƯA đánh dấu da_thu_hoi', () => {
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  const kq = applyScanResult(db, {
    chatId: NHOM, vangMat: ['200'], hienDien: [],
    bayGioIso: new Date(GIO).toISOString(), bayGioMs: GIO, quetTruocMs: GIO - 1000,
  });
  const r = db.prepare("SELECT * FROM tin_nhan WHERE msg_id='200'").get();
  assert.equal(kq.soNghiNgo, 1);
  assert.equal(kq.soXacNhan, 0);
  assert.equal(Number(r.da_thu_hoi), 0, 'một lần vắng CHƯA đủ để nói ra');
  assert.equal(r.thu_hoi_do_tin_cay, DO_TIN_CAY.NGHI_NGO);
  closeDb(db);
});

test('D2 ★ vắng LẦN HAI liên tiếp -> mới nâng lên SUY_RA + ghi sự kiện', () => {
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  const chung = { chatId: NHOM, vangMat: ['200'], hienDien: [], bayGioMs: GIO, quetTruocMs: GIO - 1000 };
  applyScanResult(db, { ...chung, bayGioIso: new Date(GIO).toISOString() });
  const kq = applyScanResult(db, { ...chung, bayGioIso: new Date(GIO + 1000).toISOString() });
  const r = db.prepare("SELECT * FROM tin_nhan WHERE msg_id='200'").get();
  assert.equal(kq.soXacNhan, 1);
  assert.equal(Number(r.da_thu_hoi), 1);
  assert.equal(r.thu_hoi_nguon, NGUON_THU_HOI.DOI_CHIEU);
  assert.equal(r.thu_hoi_do_tin_cay, DO_TIN_CAY.SUY_RA);
  assert.equal(r.noi_dung, 'tin 200', 'UPDATE chứ KHÔNG DELETE — nội dung phải còn');
  const sk = db.prepare("SELECT * FROM su_kien_thu_hoi WHERE msg_id_dich='200'").get();
  assert.equal(sk.nguon, NGUON_THU_HOI.DOI_CHIEU);
  assert.equal(sk.event_id, `dc:${NHOM}:200`, 'khoá tự dựng phải có tiền tố dc:');
  assert.equal(Number(sk.khoang_tu_ms), GIO - 1000, 'phải lưu CẬN DƯỚI của khoảng');
  assert.equal(sk.nguoi_thu_hoi, '555', 'người thu hồi = người GỬI (Zalo chỉ cho thu hồi tin mình)');
  closeDb(db);
});

test('D3 ★ xuất hiện LẠI -> XOÁ dấu nghi ngờ, không cộng dồn qua nhiều ngày', () => {
  // Một lần mạng hỏng làm tin "vắng"; lượt sau thấy lại thì phải quên đi. Không
  // xoá thì bộ đếm cứ cộng dồn và cuối cùng vu oan một tin hoàn toàn bình thường.
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  applyScanResult(db, {
    chatId: NHOM, vangMat: ['200'], hienDien: [],
    bayGioIso: new Date(GIO).toISOString(), bayGioMs: GIO, quetTruocMs: null,
  });
  const kq = applyScanResult(db, {
    chatId: NHOM, vangMat: [], hienDien: ['200'],
    bayGioIso: new Date(GIO + 1).toISOString(), bayGioMs: GIO + 1, quetTruocMs: GIO,
  });
  const r = db.prepare("SELECT * FROM tin_nhan WHERE msg_id='200'").get();
  assert.equal(kq.soXoaNghi, 1);
  assert.equal(Number(r.vang_mat_so_lan), 0);
  assert.equal(r.vang_mat_lan_dau, null);
  closeDb(db);
});

test('D4 ★ tin đã CHAC_CHAN (SU_KIEN) thì applyScanResult không đụng, kể cả bị ép', () => {
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  db.exec("UPDATE tin_nhan SET da_thu_hoi=1, thu_hoi_nguon='SU_KIEN', thu_hoi_do_tin_cay='CHAC_CHAN' WHERE msg_id='200'");
  const chung = { chatId: NHOM, vangMat: ['200'], hienDien: [], bayGioMs: GIO, quetTruocMs: null };
  applyScanResult(db, { ...chung, bayGioIso: 'x' });
  applyScanResult(db, { ...chung, bayGioIso: 'y' });
  const r = db.prepare("SELECT * FROM tin_nhan WHERE msg_id='200'").get();
  assert.equal(r.thu_hoi_nguon, NGUON_THU_HOI.SU_KIEN, 'KHÔNG được hạ cấp xuống DOI_CHIEU');
  assert.equal(r.thu_hoi_do_tin_cay, 'CHAC_CHAN');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E. CỜ ĐỘ TIN CẬY DO TẦNG TRUY VẤN ĐẶT
// ═══════════════════════════════════════════════════════════════════════

test('E1 ★ query trả kèm nguồn: DOI_CHIEU KHÔNG được nói một mốc giờ', () => {
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  const chung = { chatId: NHOM, vangMat: ['200'], hienDien: [], bayGioMs: GIO, quetTruocMs: GIO - 60_000 };
  applyScanResult(db, { ...chung, bayGioIso: 'a' });
  applyScanResult(db, { ...chung, bayGioIso: 'b' });

  const kq = queryHistory(db, { chatId: NHOM });
  const r = kq.rows.find((x) => String(x.msg_id) === '200');
  assert.equal(r._thu_hoi.nguon, NGUON_THU_HOI.DOI_CHIEU);
  assert.equal(r._thu_hoi.chacChanThoiDiem, false, 'DOI_CHIEU thì KHÔNG chắc thời điểm');
  assert.match(r._thu_hoi.moTaThoiDiem, /khoảng/, 'phải nói "khoảng", không nói một mốc');
  closeDb(db);
});

test('E2 nguồn SU_KIEN thì được nói mốc chính xác', () => {
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  db.exec(
    "UPDATE tin_nhan SET da_thu_hoi=1, thu_hoi_nguon='SU_KIEN', "
    + `thu_hoi_do_tin_cay='CHAC_CHAN', thu_hoi_luc=${GIO} WHERE msg_id='200'`,
  );
  const r = queryHistory(db, { chatId: NHOM }).rows.find((x) => String(x.msg_id) === '200');
  assert.equal(r._thu_hoi.chacChanThoiDiem, true);
  assert.match(r._thu_hoi.moTaThoiDiem, /thu hồi lúc/);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// F. CẮT TỈA + TRẦN + GIỜ YÊN
// ═══════════════════════════════════════════════════════════════════════

test('F1 ★ nhóm KHÔNG có tin trong cửa sổ -> không nằm trong danh sách quét (0 request)', () => {
  const db = dbTam(); moNghe(db);
  them(db, '1', GIO - 10_000_000);              // rất cũ
  assert.deepEqual(groupsToScan(db, GIO - 4_500_000), []);
  them(db, '2', GIO - 1000);                    // vừa có tin
  assert.deepEqual(groupsToScan(db, GIO - 4_500_000), [NHOM]);
  closeDb(db);
});

test('F1b nhóm KHÔNG được nghe thì không quét, dù có tin', () => {
  const db = dbTam();
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'lạ', duocNghe: false });
  them(db, '2', GIO);
  assert.deepEqual(groupsToScan(db, GIO - 4_500_000), []);
  closeDb(db);
});

test('F2 giờ yên [0,6) chặn quét', () => {
  const nuaDem = new Date(2026, 7, 20, 3, 0, 0).getTime();
  const chieu = new Date(2026, 7, 20, 15, 0, 0).getTime();
  assert.equal(inQuietHours(nuaDem), true);
  assert.equal(inQuietHours(chieu), false);
});

test('F3 ★ chạm trần ngày -> KHÔNG quét và PHẢI báo host (không im lặng chết)', async () => {
  const db = dbTam(); moNghe(db); them(db, '2', GIO);
  for (let i = 0; i < 3; i += 1) {
    writeScanLog(db, {
      chatId: NHOM, tsBatDau: new Date().toISOString(), tsKetThuc: new Date().toISOString(),
      cuaSoTuMs: 0, cuaSoDenMs: 0, bienMin: null, bienMax: null,
      soTinZalo: 0, soTinDb: 0, soNghiNgo: 0, soXacNhan: 0, soBackfill: 0,
      soGoiMang: 50, ketQua: 'OK',
    });
  }
  assert.equal(callsToday(db, Date.now()), 150);
  const baoDuoc = [];
  const kq = await runScanPass({
    db, api: {}, bayGioMs: new Date().setHours(12, 0, 0, 0),
    tranNgay: 100, notifyHost: (s) => baoDuoc.push(s),
  });
  assert.equal(kq.boQua, 'TRAN_NGAY');
  assert.equal(baoDuoc.length, 1, 'chạm trần mà im lặng thì tính năng chết không ai biết');
  closeDb(db);
});

test('F4 ★ lỗi mạng -> ghi LOI_MANG, KHÔNG kết luận tin nào bị thu hồi', async () => {
  const db = dbTam(); moNghe(db);
  // Tin phải nằm TRONG cửa sổ quét, nếu không nhóm bị cắt tỉa từ trước và bài
  // này xanh vì lý do khác hẳn (đã dính lúc viết: dùng mốc 2023 nên nhóm không
  // vào danh sách quét, không có dòng nhật ký nào để kiểm).
  const bayGio = new Date().setHours(12, 0, 0, 0);
  them(db, '200', bayGio - 100_000);
  const api = { custom() {}, [HISTORY_API_NAME]: async () => { throw new Error('mạng hỏng'); } };
  const kq = await runScanPass({ db, api, bayGioMs: bayGio, nghi: async () => {} });
  const nk = db.prepare('SELECT * FROM doi_chieu_lich_su ORDER BY id DESC LIMIT 1').get();
  assert.equal(nk.ket_qua, 'LOI_MANG');
  assert.equal(Number(db.prepare('SELECT count(*) c FROM tin_nhan WHERE da_thu_hoi=1').get().c), 0);
  assert.equal(kq.tong.soXacNhan, 0);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// G. PHÂN TRANG
// ═══════════════════════════════════════════════════════════════════════

test('G1 ★ hasMore mãi mãi + con trỏ LẶP LẠI -> dừng, không lặp vô hạn', async () => {
  let goi = 0;
  const api = {
    custom() {},
    [HISTORY_API_NAME]: async () => {
      goi += 1;
      return { groupMsgs: [{ msgId: '1' }], hasMore: true, lastMsgId: '99' };  // con trỏ ĐỨNG YÊN
    },
  };
  const kq = await fetchGroupHistory(api, NHOM, { nghi: async () => {} });
  assert.ok(goi <= 3, `phải dừng sớm, đã gọi ${goi} lần`);
  assert.equal(kq.tin.length, 1, 'khử trùng theo msgId ngay trong vòng lặp');
  closeDb;
});

test('G2 ★ trần request chạm -> cutTrang = true (để tầng trên thu hẹp biên)', async () => {
  let n = 0;
  const api = {
    custom() {},
    [HISTORY_API_NAME]: async () => {
      n += 1;
      return { groupMsgs: [{ msgId: String(1000 - n) }], hasMore: true, lastMsgId: String(1000 - n) };
    },
  };
  const kq = await fetchGroupHistory(api, NHOM, { tranGoi: 3, nghi: async () => {} });
  assert.equal(kq.soGoi, 3);
  assert.equal(kq.cutTrang, true);
});

test('G3 chưa đăng ký API -> NÉM rõ ràng, không gọi mạng mù', async () => {
  await assert.rejects(() => fetchGroupHistory({}, NHOM), /Chưa đăng ký/);
});

test('G4 registerHistoryApi: api không có custom -> trả false, KHÔNG ném', () => {
  assert.equal(registerHistoryApi({}), false);
  assert.equal(registerHistoryApi(null), false);
});

// ═══════════════════════════════════════════════════════════════════════
// H. CỜ TẮT + A0
// ═══════════════════════════════════════════════════════════════════════

test('H1 ★ HAI CỜ đều MẶC ĐỊNH TẮT', () => {
  assert.equal(isScanEnabled({}), false, 'quét đối chiếu phải TẮT khi chưa qua A0');
  assert.equal(isProbeA0Enabled({}), false);
  assert.equal(isScanEnabled({ ZTL_QUET_DOI_CHIEU: '0' }), false);
  assert.equal(isScanEnabled({ ZTL_QUET_DOI_CHIEU: '1' }), true);
  assert.equal(isProbeA0Enabled({ ZTL_PROBE_A0: '1' }), true);
});

test('H2 ★ A0 CHE nội dung tin của người thật, chỉ giữ độ dài + 12 ký tự đầu', () => {
  const goc = 'nội dung riêng tư rất dài của người khác';
  const m = maskSampleMessage({ msgId: '9', ts: 123, data: { content: goc } });
  // Tính từ chuỗi gốc chứ KHÔNG gõ số cứng — gõ số cứng thì bài test chỉ đo
  // được kỹ năng đếm ký tự của người viết test, không đo được hàm che.
  assert.equal(m.doDaiNoiDung, goc.length);
  assert.equal(m.dauNoiDung.length, 13, '12 ký tự + dấu …');
  assert.ok(!m.dauNoiDung.includes('người khác'), 'KHÔNG được lọt nguyên văn ra file Router đọc');
  assert.ok(m.dauNoiDung.length < goc.length, 'phải NGẮN HƠN bản gốc');
});

test('H3 messagesInWindow trả kèm nguồn hiện tại (để thi hành chốt 4)', () => {
  const db = dbTam(); moNghe(db); them(db, '200', GIO);
  db.exec("UPDATE tin_nhan SET thu_hoi_nguon='SU_KIEN' WHERE msg_id='200'");
  const ds = messagesInWindow(db, NHOM, GIO - 1000);
  assert.equal(ds[0].nguonHienTai, 'SU_KIEN');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// I. BUG THẬT 20/08/2026 — ĐỌC NHẦM THUỘC TÍNH, KHÔNG PHẢI ĐUA THỨ TỰ
// ═══════════════════════════════════════════════════════════════════════

test('I1 ★ base URL đọc được từ ctx.loginInfo.zpw_service_map_v3', () => {
  const ctx = { loginInfo: { zpw_service_map_v3: { group_cloud_message: ['https://a'] } } };
  assert.equal(cloudMessageBase(null, ctx), 'https://a');
});

test('I2 ★★ base URL đọc được từ api.zpwServiceMap — ĐÚNG HÌNH DẠNG THẬT của zca-js', () => {
  // 🔴 ĐÂY LÀ BÀI CANH BUG. Bản đầu đọc `ctx.zpwServiceMap`, mà thuộc tính đó
  // KHÔNG BAO GIỜ tồn tại lúc chạy — chỉ có trong khai báo kiểu context.d.ts:123.
  // Grep toàn bộ dist/: phép gán DUY NHẤT là apis.js:150 `this.zpwServiceMap = …`
  // (lên đối tượng API), và zalo.js:72 `new API(ctx, loginInfo.zpw_service_map_v3, …)`.
  // Đối tượng api dưới đây dựng theo ĐÚNG hình dạng đó: KHÔNG có ctx đi kèm.
  const api = { zpwServiceMap: { group_cloud_message: ['https://b'] } };
  assert.equal(cloudMessageBase(api, null), 'https://b');
  assert.equal(sessionReady(api, null), true);
});

test('I3 ★ ctx.zpwServiceMap (thuộc tính KHÔNG có thật) không cứu được gì', () => {
  // Nếu ai đó "sửa" lại thành chỉ đọc ctx.zpwServiceMap thì bài I2 đỏ; bài này
  // ghi lại lý do: hình dạng đó là kiểu TypeScript nói dối, không phải runtime.
  const ctxSai = { zpwServiceMap: { group_cloud_message: ['https://c'] } };
  const api = { zpwServiceMap: { group_cloud_message: ['https://b'] } };
  // Vẫn phải lấy được từ api — không phụ thuộc thuộc tính ma kia.
  assert.equal(cloudMessageBase(api, ctxSai), 'https://b');
});

test('I4 không nguồn nào có -> null, và sessionReady = false', () => {
  assert.equal(cloudMessageBase(null, null), null);
  assert.equal(cloudMessageBase({}, {}), null);
  assert.equal(sessionReady({}, {}), false);
});

test('I5 ★ chờ CÓ ĐIỀU KIỆN: sẵn sàng ngay -> trả về lập tức, không ngủ', async () => {
  const api = { zpwServiceMap: { group_cloud_message: ['https://b'] } };
  let daNgu = 0;
  const kq = await waitForSession({ api, ctx: null }, { nghi: async () => { daNgu += 1; } });
  assert.equal(kq.sanSang, true);
  assert.equal(kq.doiMs, 0);
  assert.equal(daNgu, 0, 'phiên sẵn sàng rồi mà vẫn ngủ là phí thời gian khởi động');
});

test('I6 ★ chờ: chưa sẵn sàng rồi sẵn sàng giữa chừng -> bắt được', async () => {
  const api = {};
  let n = 0;
  const kq = await waitForSession({ api, ctx: null }, {
    tranMs: 5000, nhipMs: 100,
    nghi: async () => {
      n += 1;
      if (n === 3) api.zpwServiceMap = { group_cloud_message: ['https://b'] };
    },
  });
  assert.equal(kq.sanSang, true);
  assert.equal(kq.doiMs, 300);
});

test('I7 ★ chờ: hết trần vẫn rỗng -> sanSang=false, KHÔNG treo vô hạn', async () => {
  const kq = await waitForSession({ api: {}, ctx: null }, {
    tranMs: 1000, nhipMs: 250, nghi: async () => {},
  });
  assert.equal(kq.sanSang, false);
  assert.equal(kq.doiMs, 1000);
});

test('I8 ★★ A0 chưa sẵn sàng -> CHUA_SAN_SANG, TUYỆT ĐỐI không phải DO', async () => {
  // Đây chính là ca ngày 20/08/2026 làm Router suýt kết luận "endpoint chết,
  // dừng hẳn phương án A". Hai trạng thái phải TÁCH.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-a0-'));
  RAC.push(d);
  const f = path.join(d, 'probe_a0.json');
  const ra = await runProbeA0({
    api: { custom() {} }, db: null, chatId: NHOM, duongDanRa: f,
    tranChoMs: 200, nhipChoMs: 100, nghi: async () => {},
  });
  assert.equal(ra.ket_luan, KET_LUAN_A0.CHUA_SAN_SANG);
  assert.notEqual(ra.ket_luan, KET_LUAN_A0.DO);
  assert.equal(ra.so_goi_mang, 0);
  assert.equal(ra.co_bang_chung_ve_endpoint, false);
  assert.match(ra.doc_the_nao, /KHÔNG nói gì về endpoint/);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).ket_luan, KET_LUAN_A0.CHUA_SAN_SANG);
});

test('I9 ★★ lời gọi mạng ĐẦU TIÊN hỏng -> so_goi_mang = 1 và ket_luan = DO', async () => {
  // Chiều ngược lại của I8, quan trọng ngang: endpoint chết THẬT thì phải hiện
  // ra là DO kèm bằng chứng, đừng để nó trông giống "chưa thử".
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-a0b-'));
  RAC.push(d);
  const f = path.join(d, 'probe_a0.json');
  // ⚠️ ĐỒ GIẢ PHẢI GIẢ CHO ĐÚNG (sửa 20/08/2026): trước đây nó chỉ ném, còn
  // `so_goi_mang` thì tầng trên tự suy ra từ SỐ LẦN GỌI HÀM — nên một lỗi xảy ra
  // TRƯỚC khi chạm mạng cũng bị đếm thành "đã gọi 1 lần". Giờ con số do sổ chẩn
  // đoán giữ, nên đồ giả muốn nói "404 từ máy chủ" thì phải chạm sổ y như hàng
  // thật. Khẳng định bên dưới KHÔNG đổi một chữ nào.
  const api = {
    custom() {},
    zpwServiceMap: { group_cloud_message: ['https://b'] },
    [HISTORY_API_NAME]: async ({ so }) => {
      if (so) { so.soGoiMang += 1; so.soPhanHoi += 1; so.httpMa = 404; so.httpOk = false; }
      throw new Error('404 Not Found');
    },
  };
  const ra = await runProbeA0({ api, db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {} });
  assert.equal(ra.so_goi_mang, 1, 'đã chạm mạng 1 lần -> con số phải nói đúng');
  assert.equal(ra.ket_luan, KET_LUAN_A0.DO);
  assert.equal(ra.co_bang_chung_ve_endpoint, true);
  assert.match(ra.loi, /404/);
  assert.equal(ra.nhom_loi, NHOM_LOI_A0.ENDPOINT_CHET, '404 -> ĐÂY mới là điều kiện dừng');
});

test('I10 ★ probe_a0.json GHI ĐÈ mỗi lượt, không giữ kết quả cũ', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-a0c-'));
  RAC.push(d);
  const f = path.join(d, 'probe_a0.json');
  fs.writeFileSync(f, JSON.stringify({ ket_luan: 'KET_QUA_CU', rac: true }));
  await runProbeA0({
    api: { custom() {} }, db: null, chatId: NHOM, duongDanRa: f,
    tranChoMs: 0, nhipChoMs: 10, nghi: async () => {},
  });
  const moi = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.notEqual(moi.ket_luan, 'KET_QUA_CU', 'đọc phải kết quả lượt trước là chuyện nguy hiểm');
  assert.equal(moi.rac, undefined, 'phải ghi đè hẳn, không trộn với file cũ');
});

test('I11 A0 chạy được thật khi phiên sẵn sàng + vẫn CHE nội dung', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-a0d-'));
  RAC.push(d);
  const f = path.join(d, 'probe_a0.json');
  const api = {
    custom() {},
    zpwServiceMap: { group_cloud_message: ['https://b'] },
    [HISTORY_API_NAME]: async () => ({
      groupMsgs: [{ msgId: '100', ts: 1, content: 'nội dung rất riêng tư của người ta' }],
      hasMore: false, lastMsgId: '100',
    }),
  };
  const ra = await runProbeA0({ api, db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {} });
  assert.equal(ra.ket_luan, KET_LUAN_A0.XANH);
  assert.equal(ra.so_goi_mang, 1);
  assert.equal(ra.co_bang_chung_ve_endpoint, true);
  assert.ok(!JSON.stringify(ra).includes('riêng tư của người ta'), 'nội dung phải bị che');
});

// ═══════════════════════════════════════════════════════════════════════
// J. "Lỗi không xác định" — PHÉP ĐO NUỐT MẤT NGUYÊN NHÂN (20/08/2026)
//
// Lượt A0 thứ hai gọi được mạng thật rồi hỏng, nhưng file kết quả chỉ ghi
// `loi: "Lỗi không xác định"` — nguyên văn error_message của Zalo, không nói
// gì cả. Con số thì đáng tin, LÝ DO thì không. Cả nhóm bài dưới đây canh đúng
// một điều: file kết quả phải nói được VÌ SAO, đủ để phân nhóm nguyên nhân.
// ═══════════════════════════════════════════════════════════════════════

test('J1 ★★ CHỖ NUỐT LỖI: ZaloApiError có .code -> phải giữ, không chỉ lấy message', () => {
  // Đây chính là hình dạng thật: zca-js `resolveResponse` ném
  // `new ZaloApiError(result.error.message, result.error.code)` với message
  // lấy NGUYÊN VĂN từ `error_message` của máy chủ Zalo.
  const e = new Error('Lỗi không xác định');
  e.name = 'ZcaApiError';
  e.code = 114;
  const mo = describeError(e);
  assert.equal(mo.loi, 'Lỗi không xác định');
  assert.equal(mo.loi_ma, 114, 'MẤT trường này là mất thứ DUY NHẤT phân biệt được nhóm');
  assert.equal(mo.loi_ten, 'ZcaApiError');
  assert.ok(mo.stack_rut_gon, 'stack rút gọn phải có để biết ném từ đâu');
});

test('J2 ★ lỗi là object KHÔNG có message -> JSON.stringify ra, không "[object Object]"', () => {
  const mo = describeError({ error_code: 216, ghi_chu: 'khong co message' });
  assert.ok(!String(mo.loi).includes('[object Object]'), 'rơi về chuỗi mặc định là mất sạch');
  assert.match(mo.loi, /216/);
  assert.match(mo.loi_json, /216/);
});

test('J3 ★ Error rỗng message vẫn bóc được stack (own-property không đếm được)', () => {
  const mo = describeError(new Error(''));
  // JSON.stringify(err) trần trả "{}" — phải dùng danh sách khoá own-property.
  assert.ok(mo.loi_json, 'stringify trần trả "{}" là mất hết');
  assert.match(mo.loi_json, /stack|message/);
});

test('J4 ★★ HTTP 200 + error_code trong THÂN -> ENDPOINT SỐNG, không phải chết', () => {
  // ⚠️ Zalo hay trả 200 kèm mã lỗi trong thân. Chỉ nhìn mã HTTP là bỏ sót hẳn
  // nhánh này, rồi xếp nhầm sang "endpoint chết" = chôn phương án A oan.
  const nhom = classifyErrorGroup({ soGoiMang: 1, httpMa: 200, loiMa: 114 });
  assert.equal(nhom, NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC);
  assert.match(errorGroupMeaning(nhom), /KHÔNG PHẢI nhóm "endpoint chết"/);
});

test('J4b ★ mã lỗi nằm trong thân (không có e.code) vẫn xếp đúng nhóm', () => {
  const nhom = classifyErrorGroup({
    soGoiMang: 1, httpMa: 200, loiMa: null,
    thanPhanHoi: { dang: 'JSON', error_code: 216 },
  });
  assert.equal(nhom, NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC);
});

test('J5 ★★ CHỈ 404/410 mới là ENDPOINT_CHET — điều kiện dừng phương án A', () => {
  assert.equal(classifyErrorGroup({ soGoiMang: 1, httpMa: 404 }), NHOM_LOI_A0.ENDPOINT_CHET);
  assert.equal(classifyErrorGroup({ soGoiMang: 1, httpMa: 410 }), NHOM_LOI_A0.ENDPOINT_CHET);
  // Ba nhóm dưới đây TUYỆT ĐỐI không được xếp thành "endpoint chết".
  assert.notEqual(classifyErrorGroup({ soGoiMang: 1, httpMa: 403 }), NHOM_LOI_A0.ENDPOINT_CHET);
  assert.notEqual(classifyErrorGroup({ soGoiMang: 1, httpMa: 500 }), NHOM_LOI_A0.ENDPOINT_CHET);
  assert.notEqual(
    classifyErrorGroup({ soGoiMang: 1, httpMa: 200, loiMa: 1 }), NHOM_LOI_A0.ENDPOINT_CHET,
  );
  assert.match(errorGroupMeaning(NHOM_LOI_A0.ENDPOINT_CHET), /ĐIỀU KIỆN DỪNG/);
});

test('J6 ★ 401/403 -> QUYỀN/PHIÊN, hướng khác hẳn', () => {
  assert.equal(classifyErrorGroup({ soGoiMang: 1, httpMa: 401 }), NHOM_LOI_A0.QUYEN_PHIEN);
  assert.equal(classifyErrorGroup({ soGoiMang: 1, httpMa: 403 }), NHOM_LOI_A0.QUYEN_PHIEN);
});

test('J7 ★★ chưa chạm mạng -> CHUA_CHAM_MANG, cấm suy ra gì về endpoint', () => {
  assert.equal(classifyErrorGroup({ soGoiMang: 0, httpMa: 404 }), NHOM_LOI_A0.CHUA_CHAM_MANG);
  assert.match(errorGroupMeaning(NHOM_LOI_A0.CHUA_CHAM_MANG), /ĐỪNG kết luận/);
});

test('J8 ★ không nối được (DNS/TCP) -> nhóm RIÊNG, không phải endpoint chết', () => {
  const nhom = classifyErrorGroup({ soGoiMang: 1, loiKetNoi: 'ENOTFOUND' });
  assert.equal(nhom, NHOM_LOI_A0.KHONG_KET_NOI_DUOC);
  assert.notEqual(nhom, NHOM_LOI_A0.ENDPOINT_CHET);
});

test('J9 ★ không đủ bằng chứng -> nói thẳng CHUA_PHAN_LOAI_DUOC, KHÔNG đoán bừa', () => {
  assert.equal(classifyErrorGroup({ soGoiMang: 1 }), NHOM_LOI_A0.CHUA_PHAN_LOAI_DUOC);
});

test('J10 ★★ thân phản hồi: giữ error_code/error_message, CHE nội dung tin', async () => {
  const than = await summarizeResponseBody(null, async () => JSON.stringify({
    error_code: 114,
    error_message: 'Lỗi không xác định',
    data: 'noi-dung-tin-that-cua-nguoi-ta-da-ma-hoa',
  }));
  assert.equal(than.dang, 'JSON');
  assert.equal(than.error_code, 114);
  assert.equal(than.error_message, 'Lỗi không xác định');
  assert.equal(than.do_dai_truong_data, 40, 'chỉ giữ ĐỘ DÀI');
  assert.ok(
    !JSON.stringify(than).includes('noi-dung-tin-that'),
    'thân thật là tin của người ta -> tuyệt đối không ghi ra file Router đọc',
  );
});

test('J11 thân không phải JSON (trang lỗi HTML) -> cắt ngắn, vẫn ghi được', async () => {
  const than = await summarizeResponseBody(null, async () => '<html>502 Bad Gateway</html>');
  assert.equal(than.dang, 'KHONG_PHAI_JSON');
  assert.match(than.dau, /502/);
});

test('J12 đọc thân hỏng -> KHÔNG ném, phép đo chính vẫn phải chạy tiếp', async () => {
  const than = await summarizeResponseBody(null, async () => { throw new Error('stream đã đóng'); });
  assert.equal(than.dang, 'KHONG_DOC_DUOC');
});

test('J13 ★★ ném TRƯỚC khi chạm mạng -> so_goi_mang = 0 và KHÔNG được là DO', async () => {
  // 🔴 BUG THẬT bản trước: `e.soGoi = soGoi + 1` đếm SỐ LẦN GỌI HÀM, nên lỗi
  // xảy ra trước khi bắn request (thiếu base URL, encodeAES rỗng) vẫn bị ghi
  // thành "đã chạm mạng 1 lần" -> co_bang_chung_ve_endpoint = true -> đúng cái
  // kết luận "endpoint chết, dừng phương án A" mà file này sinh ra để chặn.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-a0e-'));
  RAC.push(d);
  const f = path.join(d, 'probe_a0.json');
  const api = {
    custom() {},
    zpwServiceMap: { group_cloud_message: ['https://b'] },
    // Ném mà KHÔNG chạm sổ = chưa hề bắn request nào đi.
    [HISTORY_API_NAME]: async () => { throw new Error('encodeAES trả rỗng'); },
  };
  const ra = await runProbeA0({ api, db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {} });
  assert.equal(ra.so_goi_mang, 0);
  assert.equal(ra.co_bang_chung_ve_endpoint, false);
  assert.notEqual(ra.ket_luan, KET_LUAN_A0.DO, 'chưa bắn request nào mà báo DO là vu oan endpoint');
  assert.equal(ra.nhom_loi, NHOM_LOI_A0.CHUA_CHAM_MANG);
  assert.equal(ra.so_lan_thu_goi, 1, 'vẫn phải ghi ĐÃ THỬ gọi, để không tưởng là chưa chạy');
});

test('J14 ★★ ca thật 20/08: 200 + "Lỗi không xác định" -> file nói đủ để phân nhóm', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-a0f-'));
  RAC.push(d);
  const f = path.join(d, 'probe_a0.json');
  const api = {
    custom() {},
    zpwServiceMap: { group_cloud_message: ['https://b'] },
    [HISTORY_API_NAME]: async ({ so }) => {
      so.soGoiMang += 1; so.soPhanHoi += 1; so.httpMa = 200; so.httpOk = true;
      so.thanPhanHoi = { dang: 'JSON', error_code: 114, error_message: 'Lỗi không xác định' };
      const e = new Error('Lỗi không xác định');
      e.name = 'ZcaApiError'; e.code = 114;
      throw e;
    },
  };
  const ra = await runProbeA0({
    api, db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {}, thuBienThe: false,
  });
  assert.equal(ra.ket_luan, KET_LUAN_A0.DO);
  assert.equal(ra.loi_ma, 114, 'mã lỗi Zalo — thứ lượt trước bị nuốt mất');
  assert.equal(ra.http_ma, 200);
  assert.equal(ra.nhom_loi, NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC);
  assert.match(ra.doc_the_nao, /CHỈ nhóm ENDPOINT_CHET/);
  // Ghi ra file rồi mới có ích — Router đọc file, không đọc biến.
  const tuFile = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(tuFile.loi_ma, 114);
  assert.equal(tuFile.nhom_loi, NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC);
  assert.ok(tuFile.y_nghia_nhom, 'phải kèm nghĩa, đừng bắt người đọc tra ở chỗ khác');
});

test('J18 ★★ THAM SỐ khớp diff PR #370 — đối chiếu bằng test, không bằng mắt', () => {
  const t = buildApiParams({ groupId: 'g12345', conTro: null, soLuong: 999, imei: 'IM-1' });
  assert.equal(t.groupId, '12345', 'còn tiền tố "g" -> Zalo trả rỗng -> VU OAN cả nhóm');
  assert.equal(t.globalMsgId, 0, 'trang đầu phải là số 0');
  assert.equal(t.count, 50, 'trần cứng 50 của endpoint');
  assert.deepEqual(t.msgIds, []);
  assert.equal(t.imei, 'IM-1');
  assert.equal(t.src, 3);
  assert.deepEqual(
    Object.keys(t).sort(),
    ['count', 'globalMsgId', 'groupId', 'imei', 'msgIds', 'src'],
    'thừa/thiếu một khoá là đủ để Zalo trả lỗi chung chung',
  );
});

test('J19 ★★ con trỏ trang sau GIỮ CHUỖI, không ép Number (vượt MAX_SAFE_INTEGER)', () => {
  const to = '18446744073709551615';
  const t = buildApiParams({ groupId: '1', conTro: to, soLuong: 50, imei: 'x' });
  assert.equal(t.globalMsgId, to, 'ép Number là mất chính xác ÂM THẦM -> phân trang nhảy cóc');
  assert.notEqual(t.globalMsgId, Number(to));
});

test('J20 biến thể MSG_IDS_CHUOI đổi ĐÚNG MỘT tham số, không đụng phần còn lại', () => {
  const c = buildApiParams({ groupId: 'g1', conTro: null, soLuong: 50, imei: 'x' });
  const b = buildApiParams({
    groupId: 'g1', conTro: null, soLuong: 50, imei: 'x',
    bienThe: BIEN_THE_THAM_SO.MSG_IDS_CHUOI,
  });
  assert.equal(b.msgIds, '[]');
  assert.deepEqual(
    { ...c, msgIds: null }, { ...b, msgIds: null },
    'đổi 2 thứ cùng lúc thì kết quả không nói được thứ nào mới là nguyên nhân',
  );
});

test('J21 ★★ ĐƯỜNG QUÉT THẬT cũng phải ghi mã lỗi, không chỉ "Lỗi không xác định"', async () => {
  // Cùng căn bệnh với A0: nhật ký quét hằng đêm chạy KHÔNG CÓ AI NGỒI XEM. Ghi
  // mỗi một chuỗi vô nghĩa vào đó là hỏng câm — sáng ra chỉ biết "lỗi mạng".
  const db = dbTam(); moNghe(db);
  // Cùng cái bẫy F4 đã ghi lại: tin phải nằm TRONG cửa sổ quét và ngoài giờ
  // yên, không thì nhóm bị cắt từ trước và không có dòng nhật ký nào để kiểm.
  const bayGio = new Date().setHours(12, 0, 0, 0);
  them(db, '100', bayGio - 100_000);
  const api = {
    custom() {},
    zpwServiceMap: { group_cloud_message: ['https://b'] },
    [HISTORY_API_NAME]: async ({ so }) => {
      so.soGoiMang += 1; so.httpMa = 200;
      const e = new Error('Lỗi không xác định');
      e.name = 'ZcaApiError'; e.code = 114;
      throw e;
    },
  };
  await runScanPass({ db, api, bayGioMs: bayGio, nghi: async () => {}, notifyHost: () => {} });
  const nk = db.prepare('SELECT * FROM doi_chieu_lich_su ORDER BY id DESC LIMIT 1').get();
  assert.equal(nk.ket_qua, 'LOI_MANG');
  assert.match(nk.ghi_chu, /ma=114/, 'mã lỗi Zalo là thứ DUY NHẤT phân biệt được nguyên nhân');
  assert.match(nk.ghi_chu, /http=200/);
  assert.match(nk.ghi_chu, /ENDPOINT_SONG_LOI_GIAO_THUC/, 'phải nói luôn nhóm, khỏi tra chỗ khác');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// K. BỘ NHIỀU GIẢ THUYẾT TRONG MỘT LẦN KHỞI ĐỘNG (anh chốt 20/08 22:5x)
//
// Anh sắp ngồi test và Router sẽ KHÔNG restart nữa ⇒ một lần chạy phải loại
// được NHIỀU đường. Ba thứ phải canh: trần request (tài khoản THẬT, bắn dồn là
// bị gắn cờ spam), điều kiện dừng sớm, và daemon PHẢI SỐNG dù phép thử nổ.
// ═══════════════════════════════════════════════════════════════════════

function apiGia({ theoBienThe = {}, macDinh = 604, dem = null, ghiNhip = null } = {}) {
  return {
    custom() {},
    zpwServiceMap: { group_cloud_message: ['https://b'] },
    [HISTORY_API_NAME]: async ({ so, bienThe, conTro }) => {
      if (dem) dem.push({ bienThe, conTro });
      if (ghiNhip) ghiNhip.push(bienThe);
      so.soGoiMang += 1; so.soPhanHoi += 1; so.httpOk = true;
      const kb = theoBienThe[bienThe];
      if (kb && kb.xanh) {
        so.httpMa = 200;
        return { groupMsgs: [{ msgId: '100', ts: 1 }], hasMore: false, lastMsgId: '100' };
      }
      so.httpMa = kb?.http ?? 200;
      const e = new Error(kb?.msg ?? 'Lỗi không xác định');
      e.name = 'ZcaApiError'; e.code = kb?.ma ?? macDinh;
      throw e;
    },
  };
}
function fileTam(ten) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `ztl-${ten}-`));
  RAC.push(d);
  return path.join(d, 'probe_a0.json');
}

test('K1 ★★ PHÉP THỬ NỔ TUNG -> runProbeA0 VẪN TRẢ VỀ, KHÔNG ném (daemon phải sống)', async () => {
  // 🔴 Anh sắp ngồi test. A0 là phép ĐO, không phải điều kiện sống của trợ lý.
  // `api` dưới đây nổ ngay khi bị chạm tới — kiểu hỏng tệ nhất tưởng tượng được.
  const apiDoc = new Proxy({}, {
    get() { throw new Error('api nổ tung ngay khi chạm vào'); },
  });
  const f = fileTam('k1');
  const ra = await runProbeA0({ api: apiDoc, db: null, chatId: NHOM, duongDanRa: f });
  assert.ok(ra, 'phải TRẢ VỀ chứ không ném — ném là daemon có nguy cơ chết theo');
  assert.equal(ra.goi_duoc, false);
  assert.equal(ra.co_bang_chung_ve_endpoint, false, 'phép đo tự hỏng thì CẤM nói gì về endpoint');
  assert.notEqual(ra.ket_luan, KET_LUAN_A0.DO);
  assert.ok(ra.tong_ket, 'vẫn phải có dòng tổng kết để Router biết đọc thế nào');
});

test('K1b ★★ lỗi ném NGOÀI khối try (ngay dòng đầu) -> lưới cuối vẫn đỡ được', async () => {
  // `p.bayGioMs` là dòng ĐẦU TIÊN, nằm ngoài mọi try bên trong. Đây là ca duy
  // nhất chứng minh lưới bọc ngoài cùng có tác dụng thật.
  const pDoc = new Proxy({}, { get() { throw new Error('p nổ ngay dòng đầu'); } });
  const ra = await runProbeA0(pDoc);
  assert.ok(ra, 'ném ở đây là daemon có nguy cơ chết theo phép đo');
  assert.equal(ra.co_bang_chung_ve_endpoint, false);
  assert.match(ra.loi, /PHÉP THỬ A0 TỰ NỔ/);
  assert.match(ra.tong_ket, /sửa phép đo/i);
});

test('K1c ★★ gọi runProbeA0 KHÔNG tham số: không ném VÀ KHÔNG ngủ 60 giây', async () => {
  // Không có `api` thì chờ bao lâu cũng vô ích. Trước khi sửa, bài này ngốn
  // đúng 60 giây của MỌI lần chạy bộ test.
  const t = process.hrtime.bigint();
  const ra = await runProbeA0();
  const giay = Number(process.hrtime.bigint() - t) / 1e9;
  assert.ok(ra);
  assert.equal(ra.goi_duoc, false);
  assert.ok(giay < 2, `ngốn ${giay.toFixed(1)}s — chờ một thứ không tồn tại là ngủ vô ích`);
});

test('K2 ★★ TRẦN 5 REQUEST CHO CẢ BỘ — tài khoản THẬT, không được nới', async () => {
  // DB có tin thật -> CON_TRO_THAT chạy được -> đây là ca TIÊU NHIỀU NHẤT.
  const db = dbTam(); moNghe(db); them(db, '900', GIO);
  const dem = [];
  const f = fileTam('k2');
  const ra = await runProbeA0({
    api: apiGia({ dem }), db, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  assert.equal(dem.length, 5, 'chuẩn + 4 biến thể = đúng 5, không hơn');
  assert.ok(
    dem.length <= A0_BO_DO.TRAN_REQUEST_CA_BO,
    `bắn ${dem.length} request — quá trần là rủi ro bị Zalo khoá 24-48h`,
  );
  assert.equal(ra.so_request_ca_bo, 5);
  closeDb(db);
});

test('K2b ★★ trần hạ xuống 3 -> 2 biến thể cuối bị BỎ và nói rõ vì sao', async () => {
  // Chứng minh trần là trần THẬT, không phải con số trang trí.
  const db = dbTam(); moNghe(db); them(db, '900', GIO);
  const dem = [];
  const f = fileTam('k2b');
  const ra = await runProbeA0({
    api: apiGia({ dem }), db, chatId: NHOM, duongDanRa: f, nghi: async () => {},
    tranRequestCaBo: 3,
  });
  assert.equal(dem.length, 3);
  const boQua = ra.bo_bien_the.filter((x) => x.bo_qua);
  assert.equal(boQua.length, 2);
  assert.match(boQua[0].vi_sao_bo_qua, /chạm trần/);
  assert.match(ra.tong_ket, /CHƯA thử/, 'phải nói rõ cái nào chưa thử, đừng để tưởng đã loại hết');
  closeDb(db);
});

test('K3 ★★ mỗi biến thể đổi ĐÚNG MỘT thứ, và KHÔNG thử lại cái đã loại', async () => {
  const dem = [];
  const f = fileTam('k3');
  await runProbeA0({
    api: apiGia({ dem }), db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  const day = dem.map((x) => x.bienThe);
  assert.equal(day[0], BIEN_THE_THAM_SO.CHUAN);
  assert.ok(
    !day.includes(BIEN_THE_THAM_SO.MSG_IDS_CHUOI),
    'MSG_IDS_CHUOI đã LOẠI lúc 22:37 (cũng ra 604) — thử lại là phí một request thật',
  );
  // Đối chiếu từng biến thể: so với CHUẨN phải lệch đúng 1 khoá.
  const chuan = buildApiParams({ groupId: 'g1', conTro: null, soLuong: 50, imei: 'IM' });
  for (const bt of [BIEN_THE_THAM_SO.SRC_1, BIEN_THE_THAM_SO.BO_IMEI]) {
    const b = buildApiParams({ groupId: 'g1', conTro: null, soLuong: 50, imei: 'IM', bienThe: bt });
    const khac = [...new Set([...Object.keys(chuan), ...Object.keys(b)])]
      .filter((k) => JSON.stringify(chuan[k]) !== JSON.stringify(b[k]));
    assert.deepEqual(khac.length, 1, `${bt} đổi ${khac.length} thứ — đổi 2 thứ thì kết quả vô nghĩa`);
  }
});

test('K3b ★ TOI_THIEU là LƯỚI VÉT, cố ý bỏ 3 khoá — chạy CUỐI nên không gây mơ hồ', () => {
  const t = buildApiParams({
    groupId: 'g1', conTro: null, soLuong: 50, imei: 'IM',
    bienThe: BIEN_THE_THAM_SO.TOI_THIEU,
  });
  assert.deepEqual(Object.keys(t).sort(), ['count', 'globalMsgId', 'groupId']);
  // Đọc thẳng hằng số, không chép lại thứ tự vào test.
  const day = A0_BO_DO.DAY_BIEN_THE;
  assert.equal(day[day.length - 1], 'TOI_THIEU', 'lưới vét phải nằm CUỐI hàng');
  assert.equal(A0_BO_DO.TRAN_REQUEST_CA_BO, 5);
  assert.ok(A0_BO_DO.NGHI_GIUA_BIEN_THE_MS >= 2000);
});

test('K4 ★★ DỪNG SỚM khi một biến thể XANH — thử tiếp là bắn thừa vô nghĩa', async () => {
  const dem = [];
  const f = fileTam('k4');
  const ra = await runProbeA0({
    api: apiGia({ dem, theoBienThe: { [BIEN_THE_THAM_SO.SRC_1]: { xanh: true } } }),
    db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  assert.equal(dem.length, 2, 'chuẩn + SRC_1 rồi DỪNG');
  assert.equal(ra.nhom_loi, NHOM_LOI_A0.THAM_SO_SAI_DA_CHUNG_MINH);
  assert.match(ra.dung_som, /XANH/);
  assert.match(ra.tong_ket, /SRC_1/, 'tổng kết phải chỉ thẳng biến thể nào chạy được');
});

test('K5 ★★ DỪNG SỚM khi gặp 404 giữa chừng — endpoint chết thì tham số nào cũng vô ích', async () => {
  const dem = [];
  const f = fileTam('k5');
  const ra = await runProbeA0({
    api: apiGia({ dem, theoBienThe: { [BIEN_THE_THAM_SO.SRC_1]: { http: 404, ma: null } } }),
    db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  assert.equal(dem.length, 2, 'gặp endpoint chết là dừng, không bắn nốt 3 lượt còn lại');
  assert.match(ra.dung_som, /ENDPOINT_CHET/);
});

test('K6 ★★ endpoint chết NGAY lượt chuẩn -> KHÔNG chạy biến thể nào cả', async () => {
  const dem = [];
  const f = fileTam('k6');
  const ra = await runProbeA0({
    api: apiGia({ dem, theoBienThe: { CHUAN: { http: 404, ma: null } } }),
    db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  assert.equal(dem.length, 1);
  assert.equal(ra.bo_bien_the, null);
  assert.equal(ra.nhom_loi, NHOM_LOI_A0.ENDPOINT_CHET);
});

test('K7 ★★ GIÃN NHỊP ≥ 2 giây trước MỖI lần bắn biến thể', async () => {
  const db = dbTam(); moNghe(db); them(db, '900', GIO);
  const nguMs = [];
  const f = fileTam('k7');
  await runProbeA0({
    api: apiGia(), db, chatId: NHOM, duongDanRa: f,
    nghi: async (ms) => { nguMs.push(ms); },
  });
  const dai = nguMs.filter((m) => m >= A0_BO_DO.NGHI_GIUA_BIEN_THE_MS);
  assert.equal(dai.length, 4, 'mỗi biến thể phải nghỉ một nhịp — bắn dồn là rủi ro gắn cờ spam');
  closeDb(db);
});

test('K8 ★★ CON_TRO_THAT: không có msg_id trong DB -> BỎ LƯỢT, CẤM bịa id', async () => {
  const dem = [];
  const f = fileTam('k8');
  const ra = await runProbeA0({
    api: apiGia({ dem }), db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  const ct = ra.bo_bien_the.find((x) => x.bien_the === BIEN_THE_THAM_SO.CON_TRO_THAT);
  assert.equal(ct.bo_qua, true);
  assert.match(ct.vi_sao_bo_qua, /KHÔNG bịa/);
  assert.ok(
    !dem.some((x) => x.bienThe === BIEN_THE_THAM_SO.CON_TRO_THAT),
    'bỏ lượt thì KHÔNG được tiêu request',
  );
});

test('K9 ★★ CON_TRO_THAT dùng ĐÚNG msg_id mới nhất trong DB, không phải số 0', async () => {
  const db = dbTam(); moNghe(db);
  them(db, '100', GIO); them(db, '900', GIO + 1000); them(db, '500', GIO + 500);
  const dem = [];
  const f = fileTam('k9');
  await runProbeA0({
    api: apiGia({ dem }), db, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  const ct = dem.find((x) => x.bienThe === BIEN_THE_THAM_SO.CON_TRO_THAT);
  assert.equal(ct.conTro, '900', 'phải là id LỚN NHẤT theo SỐ, không phải theo chuỗi');
  closeDb(db);
});

test('K10 ★★ mỗi biến thể ghi ĐỦ: đổi gì · vì sao nghi · BẰNG CHỨNG · loại được gì', async () => {
  const f = fileTam('k10');
  const ra = await runProbeA0({
    api: apiGia(), db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  for (const x of ra.bo_bien_the) {
    assert.ok(x.doi_gi, `${x.bien_the} thiếu doi_gi`);
    assert.ok(x.vi_sao_nghi, `${x.bien_the} thiếu vi_sao_nghi`);
    assert.ok(x.bang_chung, `${x.bien_the} thiếu bang_chung`);
    assert.match(x.bang_chung, /dist\/apis\//, 'bằng chứng phải trỏ vào node_modules, không phải tài liệu');
    assert.ok(x.hong_thi_loai_duoc, `${x.bien_the} thiếu hong_thi_loai_duoc`);
  }
});

test('K11 ★★ tất cả hỏng -> tổng kết nói ĐÃ LOẠI gì và nghi gì tiếp (không bỏ lửng)', async () => {
  const f = fileTam('k11');
  const ra = await runProbeA0({
    api: apiGia(), db: null, chatId: NHOM, duongDanRa: f, nghi: async () => {},
  });
  assert.match(ra.tong_ket, /ĐÃ LOẠI/);
  assert.match(ra.tong_ket, /SRC_1/);
  assert.match(ra.tong_ket, /QUYỀN\/PHIÊN|groupId/, 'phải chỉ ra hướng đi tiếp');
  // Ghi ra FILE mới có ích — Router đọc file, không đọc biến.
  const tuFile = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(tuFile.tong_ket, ra.tong_ket);
  assert.equal(tuFile.bo_bien_the.length, 4);
});

test('K12 ★ file kết quả KHÔNG lộ nội dung tin người thật dù chạy cả bộ', async () => {
  const db = dbTam(); moNghe(db);
  them(db, '900', GIO, { noiDung: 'chuyen rieng tu cua nguoi ta' });
  const f = fileTam('k12');
  await runProbeA0({ api: apiGia(), db, chatId: NHOM, duongDanRa: f, nghi: async () => {} });
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes('chuyen rieng tu'), 'file này Router đọc bằng mắt');
  closeDb(db);
});
