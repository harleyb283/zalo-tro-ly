/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 10 — BƯỚC 4: TÁCH TIẾN TRÌNH THẬT (vẫn MỘT client).
 *
 * 🔴 ĐÂY LÀ BƯỚC ĐẦU TIÊN THẬT SỰ ĐỔI ĐƯỜNG ĐANG CHẠY. Daemon đang phục vụ
 *    người thật và có lịch đã chốt đang chờ bắn.
 *    ⇒ `cheDo` mặc định `"mot-tien-trinh"`: không khai gì thì hành vi Y HỆT
 *      hôm nay. Nhóm bài `D` dưới đây canh riêng chiều mặc định đó.
 *
 * ⚠️ Mọi định danh là BỊA và mở đầu `999` — bộ quét dữ liệu riêng nay soi cả
 *    `test/`.
 * ⚠️ ⛔ Không bài nào chạm mạng thật hay bắn thông báo macOS.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import {
  writeSendResult, writeMessage, takePendingOutbound, claimOutbound, enqueueQuestion,
  upsertConversation, enqueueOutbound,
} from '../src/store/write.js';
import {
  CHE_DO, chotCheDo, HUONG_TRA_LOI, PHIEN_BAN_SCHEMA, TEN_TOOL, TRANG_THAI_GUI, VAI,
} from '../src/lib/hang_so.js';
import { createSourceLedger } from '../src/policy/leak_guard.js';
import { registerTools } from '../src/mcp/tools.js';
import { rutOutbox } from '../src/index.js';
import { thanHam, khoiGiua, tuNeo, truocNeo } from './_cat_ma.js';

const NHOM = '9990000000001';
const HOST = '9991000000000000001';
const GOC = process.cwd();

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function thuMucTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum10-'));
  RAC.push(d);
  return d;
}

function dbTam() {
  const db = openDb(path.join(thuMucTam(), 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  writeMessage(db, {
    chatId: NHOM, msgId: 'g1', cliMsgId: null, userId: HOST, tenLucGui: 'Chủ máy',
    msgType: 'chat.text', noiDung: 'hỏi', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, hasHostMention: false,
  });
  return db;
}

/** Dựng `tra_loi` ở CHẾ ĐỘ TÁCH (client): cửa gửi là XẾP HÀNG. */
function dungClient(db) {
  const daGuiThang = [];
  let xuLy;
  registerTools({
    setRequestHandler(s, f) { if (s?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    // ⚠️ `api: null` đúng như client thật — chốt chặn cuối nếu ai đó lỡ gọi
    // đường gửi thẳng.
    api: null,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: '9993000000000000003' }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: createSourceLedger({ db }),
    guiTin: {
      sendToGroup: async (...a) => { daGuiThang.push(a); return { msgId: 'x' }; },
      sendHostDm: async (...a) => { daGuiThang.push(a); return { msgId: 'y' }; },
    },
    kho: { xepHangGuiRa: enqueueOutbound },   // ★ cửa gửi của client
  });
  return {
    daGuiThang,
    goi: async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text),
  };
}

function phien(db, rid = 'r1') {
  enqueueQuestion(db, {
    requestId: rid, chatIdHoi: NHOM, msgId: 'g1', userId: HOST,
    noiDung: 'anh hỏi cái này', tsTao: new Date().toISOString(),
  });
  return rid;
}

// ═══════════════════════════════════════════════════════════════════════
// D — CHIỀU MẶC ĐỊNH: ⛔ KHÔNG ĐỔI HÀNH VI HÔM NAY
// ═══════════════════════════════════════════════════════════════════════

test('★★★ D1 KHÔNG khai gì -> cheDo = "mot-tien-trinh", vai daemon', () => {
  const c = chotCheDo({}, {}, {});
  assert.equal(c.cheDo, CHE_DO.MOT_TIEN_TRINH,
    '🔴 mặc định đổi = daemon thật đang phục vụ anh đổi hành vi ngay lần restart kế tiếp');
  assert.equal(c.laClient, false);
  assert.equal(c.laDaemon, true);
});

test('★★★ D2 cheDo LẠ -> CẢNH BÁO rồi về mặc định, ⛔ KHÔNG ném', () => {
  // Gõ sai một chữ mà cả trợ lý không khởi động được là phạt nặng hơn lỗi.
  // Và rơi về mặc định là rơi về ĐÚNG hành vi hôm nay — hướng an toàn.
  for (const xau of ['linh-tinh', 'TACH', 'client', 123, true]) {
    assert.equal(chotCheDo({}, { cheDo: xau }, {}).cheDo, CHE_DO.MOT_TIEN_TRINH);
  }
});

test('★★★ D3 ở "mot-tien-trinh" thì vai LUÔN daemon, kể cả khi ép vai client', () => {
  // Một tiến trình làm hết. Cho `vai=client` ăn ở chế độ này là trợ lý im lặng
  // không gửi được gì cả — không có daemon nào rút outbox.
  const c = chotCheDo({}, { vai: VAI.CLIENT }, {});
  assert.equal(c.laClient, false);
  assert.equal(c.vai, VAI.DAEMON);
});

test('★★★ D4 "tach" mà THIẾU vai -> daemon (⛔ không phải client)', () => {
  // Rơi nhầm vào client là không ai giữ Zalo, không ai chạy bộ hẹn giờ.
  assert.equal(chotCheDo({}, { cheDo: CHE_DO.TACH }, {}).vai, VAI.DAEMON);
  assert.equal(chotCheDo({}, { cheDo: CHE_DO.TACH, vai: 'lung tung' }, {}).vai, VAI.DAEMON);
});

test('★★ D5 thứ tự ưu tiên: cờ > env > config', () => {
  assert.equal(chotCheDo({ cheDo: CHE_DO.TACH }, {}, {}).cheDo, CHE_DO.TACH, 'config phải có tác dụng');
  assert.equal(
    chotCheDo({ cheDo: CHE_DO.TACH }, {}, { ZTL_CHE_DO: CHE_DO.MOT_TIEN_TRINH }).cheDo,
    CHE_DO.MOT_TIEN_TRINH, 'env phải thắng config',
  );
  assert.equal(
    chotCheDo({ cheDo: CHE_DO.MOT_TIEN_TRINH }, { cheDo: CHE_DO.TACH }, { ZTL_CHE_DO: CHE_DO.MOT_TIEN_TRINH }).cheDo,
    CHE_DO.TACH, 'cờ dòng lệnh phải thắng tất cả',
  );
});

test('★★★ D6 KHÔNG có `xepHangGuiRa` -> `tra_loi` gửi THẲNG như hôm nay', () => {
  // Đây là bằng chứng đường một-tiến-trình không đổi: cửa outbox chỉ mở khi
  // `src/index.js` nối `kho.xepHangGuiRa`, mà nó CHỈ nối ở vai client.
  const src = fs.readFileSync(path.join(GOC, 'src/mcp/tools.js'), 'utf8');
  assert.match(src, /typeof kho\?\.xepHangGuiRa === 'function' \? kho\.xepHangGuiRa : null/,
    'cửa outbox phải là tuỳ chọn, vắng thì về đường cũ');
  const idx = fs.readFileSync(path.join(GOC, 'src/index.js'), 'utf8');
  const khoiClient = khoiGiua(idx, 'async function chayClient', 'export async function rutOutbox');
  assert.match(khoiClient, /xepHangGuiRa: enqueueOutbound/, 'client phải nối cửa outbox');
});

// ═══════════════════════════════════════════════════════════════════════
// C — CLIENT: ⛔ KHÔNG pid-lock, ⛔ KHÔNG Zalo
// ═══════════════════════════════════════════════════════════════════════

/** Chạy `src/index.js` như một tiến trình THẬT với vai + config cho sẵn. */
function chayTienTrinh(args, env = {}, timeout = 8000) {
  // ⚠️ `spawnSync` chứ không `execFileSync`: `log()` của pack ghi ra STDERR, mà
  // `execFileSync` chỉ trả STDOUT khi tiến trình thoát 0 ⇒ mọi dòng log biến
  // mất đúng ở ca THÀNH CÔNG — tức ca cần đọc log nhất.
  const r = spawnSync(process.execPath, [path.join(GOC, 'src/index.js'), ...args], {
    encoding: 'utf8', timeout, env: { ...process.env, ...env },
  });
  return { ma: r.status ?? -1, ra: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function fileCauHinh(duongDanDb) {
  const d = thuMucTam();
  const f = path.join(d, 'config.json');
  fs.writeFileSync(f, JSON.stringify({
    hosts: [{ userId: HOST, ten: 'Chủ máy', dmChatId: '9993000000000000003' }],
    groups: [{ chatId: NHOM, ten: 'Nhóm thử' }],
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    duongDan: {
      db: duongDanDb,
      session: path.join(d, 'session.json'),
      health: path.join(d, 'health.json'),
    },
  }));
  return f;
}

test('★★★ C1 NGHIỆM THU③: HAI client cùng lúc -> CẢ HAI đều sống', () => {
  // 🔴 CA DỄ MẮC NHẤT của cả việc tách: pid-lock nằm ngay đầu `main()`, ai bê
  // nguyên khối khởi động sang vai client là N pane chết lúc khởi động — pane
  // thứ hai thấy khoá của pane thứ nhất rồi thoát.
  const pDb = path.join(thuMucTam(), 'kho', 'lichsu.db');
  closeDb(openDb(pDb));                       // daemon dựng cấu trúc trước
  const cfg = fileCauHinh(pDb);
  // ⚠️ Từ bước 6, client PHẢI khai phạm vi đọc — thiếu là không khởi động.
  const env = { ZTL_CHE_DO: CHE_DO.TACH, ZTL_VAI: VAI.CLIENT, ZTL_CHAT_ID: NHOM };

  const a = chayTienTrinh(['--config', cfg, '--kiem-khoi-dong'], env);
  const b = chayTienTrinh(['--config', cfg, '--kiem-khoi-dong'], env);

  assert.equal(a.ma, 0, `client 1 chết: ${a.ra}`);
  assert.equal(b.ma, 0, `client 2 chết: ${b.ra}`);
  for (const r of [a, b]) {
    assert.match(r.ra, /KHÔNG migrate, KHÔNG pid-lock/, 'phải nói rõ nó KHÔNG giữ khoá');
  }
  assert.ok(!fs.existsSync(path.join(path.dirname(pDb), 'zalo-tro-ly.pid')),
    'client TẠO RA file pid -> daemon thật sẽ không khởi động được nữa');
});

test('★★★ C2 NGHIỆM THU⑤: client mở DB CŨ HƠN -> thoát mã ≠0 kèm thông điệp', () => {
  const pDb = path.join(thuMucTam(), 'kho', 'cu.db');
  const db = openDb(pDb);
  db.prepare("UPDATE meta SET gia_tri = '6' WHERE khoa = 'schema_version'").run();
  closeDb(db);
  const r = chayTienTrinh(['--config', fileCauHinh(pDb), '--kiem-khoi-dong'],
    { ZTL_CHE_DO: CHE_DO.TACH, ZTL_VAI: VAI.CLIENT, ZTL_CHAT_ID: NHOM });
  assert.notEqual(r.ma, 0, 'client chạy tiếp trên cấu trúc cũ = hỏng CÂM');
  // ⚠️ Không để cứng số phiên bản đích — lên phiên bản mà phải sửa bài này thì
  // bài sẽ bị sửa cho xanh thay vì được đọc.
  assert.match(r.ra, /v6/, 'thiếu số của DB');
  assert.match(r.ra, new RegExp(`v${PHIEN_BAN_SCHEMA}`), 'thiếu số client cần');
});

test('★★★ C3 client KHÔNG chạm Zalo: `api: null`, ⛔ không làm việc của daemon', () => {
  const idx = fs.readFileSync(path.join(GOC, 'src/index.js'), 'utf8');
  const kh = khoiGiua(idx, 'async function chayClient', 'export async function rutOutbox');
  for (const cam of ['giuKhoaPid', 'loginWithCookie', 'startListening', 'runFollowUpTick', 'runOneTick', 'keepAlive']) {
    assert.ok(!kh.includes(cam), `vai client gọi \`${cam}\` — đó là việc của daemon`);
  }
  // ⚠️ Neo vào ĐÚNG khối `registerTools`. Bản đầu em canh `/api: null/` trên cả
  // hàm — quá lỏng: trong `chayClient` còn một `{ api: null }` khác (đường
  // `notifyHost`), nên đổi `api` của tool sang giá trị khác vẫn xanh. Đột biến M7
  // sống sót đúng vì thế.
  assert.match(kh, /api: null,\s*\n\s*docSucKhoe:/,
    'client phải truyền api null CHO TOOL làm chốt chặn cuối');
  assert.match(kh, /createSourceLedger\(\{ db \}\)/, 'client PHẢI dùng sổ nguồn trên ĐĨA, không phải RAM');

  // 🔴 v9 — KHẲNG ĐỊNH DƯƠNG. Tiêu đề cũ ghi "không có bộ hẹn giờ nào", và câu
  // đó nay SAI: client PHẢI có vòng lấy việc, nếu không thì ở chế độ tách nó
  // chỉ nhặt việc đúng MỘT LẦN lúc khởi động (lỗi chặn cứng, sửa 21/08/2026).
  // Cấm là cấm bộ hẹn giờ CỦA DAEMON (keepAlive, nhịp theo đuổi), ⛔ không
  // phải cấm mọi bộ hẹn giờ.
  assert.match(kh, /taoVongLayViec\(/, 'client PHẢI bật vòng lấy việc — thiếu nó là pane câm sau lượt đầu');
});

// ═══════════════════════════════════════════════════════════════════════
// X — tra_loi ở chế độ tách: XẾP HÀNG, và NÓI ĐÚNG SỰ THẬT
// ═══════════════════════════════════════════════════════════════════════

test('★★★ X1 NGHIỆM THU①: tra_loi XẾP HÀNG, ⛔ không chạm mạng', () => {
  const db = dbTam();
  const { goi, daGuiThang } = dungClient(db);
  return goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'Dạ em trả lời anh' })
    .then((r) => {
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(daGuiThang.length, 0, '🔴 client tự gửi = N bộ đếm throttle độc lập = nguy cơ gắn cờ spam');
      const ds = takePendingOutbound(db);
      assert.equal(ds.length, 1, 'không xếp hàng thì tin BIẾN MẤT — không ai gửi cả');
      assert.equal(ds[0].text, 'Dạ em trả lời anh');
      assert.equal(ds[0].chat_id_dich, NHOM);
      assert.equal(ds[0].trang_thai, TRANG_THAI_GUI.CHO);
      closeDb(db);
    });
});

test('★★★ X2 🔴 thông điệp trả model nói "ĐÃ XẾP HÀNG", ⛔ CẤM chữ "đã gửi"', async () => {
  // Viết "đã gửi" ở đây là dựng lại ĐÚNG ca hỏng 08:03 sáng 21/08: trợ lý đáp
  // "dạ em ghi nhận rồi ạ" rồi không ghi gì. Câu đó host TIN NGAY và không
  // kiểm lại — nói sai một lần là mất trắng một việc thật.
  const db = dbTam();
  const { goi } = dungClient(db);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'Dạ' });

  assert.equal(r.duLieu.daXepHang, true);
  assert.equal(r.duLieu.msgId, null, 'chưa có tin nào tồn tại trên Zalo -> msgId phải là null');
  assert.equal(r.duLieu.trangThaiGui, 'da_xep_hang');
  assert.match(r.duLieu.nhac, /XẾP HÀNG/);
  assert.match(r.duLieu.nhac, /chưa gửi/i, 'phải nói THẲNG là chưa gửi');
  assert.doesNotMatch(r.duLieu.nhac.replace(/ĐỪNG nói[^.]*\./g, ''), /\bđã gửi\b/i,
    'thông điệp khẳng định "đã gửi" khi mới xếp hàng = nói dối host');
  closeDb(db);
});

test('★★★ X3 chế độ MỘT TIẾN TRÌNH: gửi THẲNG, ⛔ không xếp hàng, ⛔ không có chữ "xếp hàng"', async () => {
  const db = dbTam();
  const daGui = [];
  let xuLy;
  registerTools({
    setRequestHandler(s, f) { if (s?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api: { getOwnId: () => '9998000000000000008' },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: '9993000000000000003' }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
    guiTin: {
      sendToGroup: async (_a, c, t) => { daGui.push({ c, t }); return { msgId: '9996000000001' }; },
      sendHostDm: async () => ({ msgId: 'y' }),
    },
    // ⛔ KHÔNG có `kho.xepHangGuiRa` — đúng như hôm nay.
  });
  const r = JSON.parse((await xuLy({
    params: { name: TEN_TOOL.TRA_LOI, arguments: { request_id: phien(db), text: 'Dạ' } },
  })).content[0].text);

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(daGui.length, 1, 'đường cũ phải gửi THẲNG');
  assert.equal(r.duLieu.msgId, '9996000000001', 'đường cũ phải trả msgId THẬT');
  assert.equal(r.duLieu.daXepHang, false);
  assert.equal(r.duLieu.nhac, undefined, 'đường cũ không được mọc thêm câu "đã xếp hàng"');
  assert.equal(takePendingOutbound(db).length, 0, 'đường cũ ⛔ không được đụng outbox');
  closeDb(db);
});

test('★★★ X4 luật chống rò chéo GIỮ NGUYÊN ở chế độ tách (⛔ không nới)', async () => {
  // Đổi đường gửi ⛔ không được nới lá chắn. Đáp án chạm nhóm khác thì vẫn phải
  // đi DM host — chỉ khác là nay nó đi qua hàng đợi.
  const db = dbTam();
  const bo = createSourceLedger({ db });
  const rid = phien(db);
  bo.ghiNhan(rid, ['9990000000009']);      // đã đọc dữ liệu một nhóm KHÁC

  let xuLy;
  registerTools({
    setRequestHandler(s, f) { if (s?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api: null,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: '9993000000000000003' }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: bo,
    kho: { xepHangGuiRa: enqueueOutbound },
  });
  const r = JSON.parse((await xuLy({
    params: { name: TEN_TOOL.TRA_LOI, arguments: { request_id: rid, text: 'đáp án có dữ liệu nhóm khác' } },
  })).content[0].text);

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.duLieu.huong, HUONG_TRA_LOI.DM_HOST, 'lá chắn bị nới ở chế độ tách');
  assert.equal(r.duLieu.coCheo, true);
  const ds = takePendingOutbound(db);
  assert.equal(ds.length, 2, 'phải xếp hàng CẢ đáp án (DM host) lẫn câu trung tính (nhóm)');
  assert.deepEqual(ds.map((x) => x.chat_id_dich).sort(), ['9993000000000000003', NHOM].sort());
  const dm = ds.find((x) => x.chat_id_dich === '9993000000000000003');
  const nhom = ds.find((x) => x.chat_id_dich === NHOM);
  assert.match(dm.text, /dữ liệu nhóm khác/, 'đáp án thật phải vào DM host');
  assert.doesNotMatch(nhom.text, /dữ liệu nhóm khác/, 'một chữ của đáp án lọt vào nhóm là RÒ');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// K — 🔴 NGHIỆM THU②: KILL daemon GIỮA CHỪNG
// ═══════════════════════════════════════════════════════════════════════

test('★★★ K1 NGHIỆM THU②: KILL daemon GIỮA CHỪNG -> tin CÒN, lên lại GỬI TIẾP, ⛔ không đôi', () => {
  // 🔴 Đây là lý do outbox phải nằm TRÊN ĐĨA chứ không phải hàng đợi trong RAM.
  // Kịch bản: client xếp hàng xong; daemon NHẶT được việc (CAS -> 'dang_gui')
  // rồi CHẾT TRƯỚC KHI GỬI. Tin phải còn nguyên, và lượt sau ⛔ KHÔNG được gửi
  // thành hai tin.
  const db = dbTam();
  const { id } = enqueueOutbound(db, { requestId: 'r1', chatIdDich: NHOM, text: 'tin quan trọng' });

  // ── daemon lần 1: nhận việc rồi "chết" (không gửi, không ghi kết quả) ──
  assert.equal(claimOutbound(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI), true);
  const sauChet = db.prepare('SELECT * FROM hang_doi_gui WHERE id = ?').get(id);
  assert.equal(sauChet.trang_thai, TRANG_THAI_GUI.DANG_GUI, 'tin phải CÒN trong outbox');
  assert.equal(sauChet.text, 'tin quan trọng', 'nội dung phải nguyên vẹn');
  assert.equal(sauChet.msg_id, null, 'chưa gửi thì ⛔ không được có msgId');

  // ── daemon lần 2 (vừa lên lại): dòng đang 'dang_gui' của tiến trình đã chết ──
  // ⚠️ `takePendingOutbound` CỐ Ý không trả nó: bốc lại việc người khác đang cầm
  // là đúng công thức GỬI HAI TIN. Việc quyết định có thử lại hay không thuộc
  // về lưới canh outbox (bước 5) — ⛔ ⛔ KHÔNG phải vòng rút này.
  assert.deepEqual(takePendingOutbound(db).map((x) => x.id), [],
    'vòng rút mà bốc lại dòng "dang_gui" là gửi hai tin vào nhóm người thật');

  // Lưới canh (mô phỏng bước 5) đưa nó về 'cho' -> daemon gửi tiếp ĐÚNG MỘT lần.
  assert.equal(claimOutbound(db, id, TRANG_THAI_GUI.DANG_GUI, TRANG_THAI_GUI.CHO), true);
  assert.deepEqual(takePendingOutbound(db).map((x) => x.id), [id], 'daemon lên lại phải thấy tin');
  closeDb(db);
});

test('★★★ K2 daemon lên lại GỬI TIẾP đúng một lần (chạy `rutOutbox` thật)', async () => {
  const db = dbTam();
  enqueueOutbound(db, { requestId: 'r1', chatIdDich: NHOM, text: 'tin A' });
  const daGui = [];
  const kho = { takePendingOutbound, claimOutbound, writeSendResult };
  const gui = async (chatId, text) => { daGui.push({ chatId, text }); return { msgId: '9996000000001' }; };

  const r1 = await rutOutbox({ db, log: () => {}, kho, gui });
  assert.deepEqual(r1, { daGui: 1, loi: 0 });
  assert.equal(daGui.length, 1);

  // Chạy lại nhịp -> ⛔ KHÔNG được gửi lần hai.
  const r2 = await rutOutbox({ db, log: () => {}, kho, gui });
  assert.deepEqual(r2, { daGui: 0, loi: 0 });
  assert.equal(daGui.length, 1, '🔴 gửi đôi — tin Zalo KHÔNG thu hồi được');

  const d = db.prepare('SELECT * FROM hang_doi_gui').get();
  assert.equal(d.trang_thai, TRANG_THAI_GUI.DA_GUI);
  assert.equal(d.msg_id, '9996000000001');
  assert.equal(d.so_lan_thu, 1);
  closeDb(db);
});

test('★★★ K3 HAI vòng rút chồng nhau -> ĐÚNG MỘT bên gửi', async () => {
  const db = dbTam();
  enqueueOutbound(db, { requestId: 'r1', chatIdDich: NHOM, text: 'tin A' });
  const kho = { takePendingOutbound, claimOutbound, writeSendResult };
  const daGui = [];
  // Hàm gửi CHẬM: hai vòng cùng vào, mô phỏng nhịp trước chưa xong nhịp sau đã tới.
  const gui = async (chatId, text) => {
    await new Promise((r) => { setTimeout(r, 30); });
    daGui.push({ chatId, text });
    return { msgId: '9996000000001' };
  };
  const [a, b] = await Promise.all([
    rutOutbox({ db, log: () => {}, kho, gui }),
    rutOutbox({ db, log: () => {}, kho, gui }),
  ]);
  assert.equal(daGui.length, 1, `hai vòng cùng gửi -> ${daGui.length} tin vào nhóm người thật`);
  assert.equal(a.daGui + b.daGui, 1);
  closeDb(db);
});

test('★★★ K4 gửi HỎNG -> ghi "loi" + LÝ DO, ⛔ không tự thử lại vô hạn', async () => {
  // Zalo có thể ĐÃ NHẬN mà mình không biết (ca "không rõ đã gửi hay chưa").
  // Thử lại mù là rủi ro hai tin — quyết định thử lại thuộc về lưới canh.
  const db = dbTam();
  enqueueOutbound(db, { requestId: 'r1', chatIdDich: NHOM, text: 'tin A' });
  const kho = { takePendingOutbound, claimOutbound, writeSendResult };
  const gui = async () => { throw new Error('mạng rớt'); };

  const r1 = await rutOutbox({ db, log: () => {}, kho, gui });
  assert.deepEqual(r1, { daGui: 0, loi: 1 });
  const d = db.prepare('SELECT * FROM hang_doi_gui').get();
  assert.equal(d.trang_thai, TRANG_THAI_GUI.LOI);
  assert.match(d.ly_do, /mạng rớt/);
  assert.equal(d.msg_id, null, 'gửi hỏng mà ghi msgId = sổ sách nói dối');

  const r2 = await rutOutbox({ db, log: () => {}, kho, gui });
  assert.deepEqual(r2, { daGui: 0, loi: 0 }, "dòng 'loi' ⛔ không được tự quay lại hàng chờ");
  closeDb(db);
});

test('★★ K5 đọc hàng đợi HỎNG -> nuốt và báo, ⛔ không làm chết vòng chạy daemon', async () => {
  const db = dbTam();
  const noi = [];
  const ra = await rutOutbox({
    db, log: (m) => noi.push(m),
    kho: { takePendingOutbound: () => { throw new Error('DB khoá'); }, claimOutbound, writeSendResult },
    gui: async () => ({ msgId: 'x' }),
  });
  assert.deepEqual(ra, { daGui: 0, loi: 0 });
  assert.match(noi.join(' '), /DB khoá|hàng đợi gửi/);
  closeDb(db);
});
