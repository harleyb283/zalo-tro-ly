/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 6 — MỘT LƯỢT NHẮC = MỘT TIN. Không hơn, không kém.
 *
 * 🔴 SỰ CỐ THẬT 21/08/2026, anh nhìn thấy tận mắt:
 *      07:10:57  bộ chạy giao việc cho model
 *      07:11:14  model gửi tin thứ NHẤT (17 giây — thừa sức trong hạn)
 *      07:12:27  🔴 tin thứ HAI: "Em nhắc lần 2…"   (= 07:10:57 + 90 giây)
 *    `cho_model_tu_ms` (cờ "đang chờ model") KHÔNG ai gỡ khi model trả lời qua
 *    `tra_loi`, nên đúng trần chờ sau, lưới an toàn tưởng model chết và bắn bù.
 *
 * 🔴 Và lỗi này do CHÍNH bản vá A5 đêm trước đẻ ra: trước A5 trần chờ là 10 phút
 *    cố định, nhịp 3 phút không bao giờ chạm tới ⇒ nhánh gửi bù NGỦ. A5 hạ trần
 *    xuống `min(10 phút, NỬA nhịp)` = 90 giây ⇒ đánh thức đúng một nhánh chưa ai
 *    chạy thật lần nào.
 *
 * 🔴 CÁCH VÁ — TOKEN, không phải "gỡ cờ sau khi gửi xong":
 *    gỡ-sau chỉ vá được ca model trả lời NHANH. Ca model trả lời CHẬM hơn trần
 *    VẪN đi hai tin, vì hàng đợi sống tới `queueTtlMs` = 30 PHÚT, dài gấp 20 lần
 *    trần chờ. Bài T6c dưới đây canh đúng ca đó — nó ĐỎ nếu ai đổi sang gỡ-sau.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, takePendingQueue, enqueueQuestion, upsertConversation } from '../src/store/write.js';
import { HUONG_TRA_LOI, TEN_TOOL, TRANG_THAI_HANG_DOI } from '../src/lib/hang_so.js';
import { chotLich } from '../src/lich/lich_hen.js';
import { taoNhacTheoDuoi } from '../src/lich/theo_duoi.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';
import { registerTools } from '../src/mcp/tools.js';
import { resetThrottle, setThrottle } from '../src/zalo/send.js';

const NHOM = '9990000000001';
const HOST = '555000111';
const TRONG = '9991000000000000001';

/** Nhịp 3 phút ⇒ trần chờ model = min(10 phút, 3·60·1000/2) = 90 giây. */
const NHIP_PHUT = 3;
const TRAN_MS = 90_000;

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

let throttleCu;
test.before(() => { throttleCu = setThrottle({ minKhoangCachMs: 0, toiDaMoiPhut: 100000 }); });
test.after(() => { setThrottle(throttleCu); resetThrottle(); });

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum6-'));
  RAC.push(d);
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  writeMessage(db, {
    chatId: NHOM, msgId: 'm-trong', cliMsgId: null, userId: TRONG, tenLucGui: 'Trọng Nguyễn',
    msgType: 'chat.text', noiDung: 'ừ để em xem', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, hasHostMention: false,
  });
  return db;
}

function nhacDaChot(db, ma = 'NHAC') {
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: `chốt giúp địa điểm ${ma}`,
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: TRONG, ma,
    chuKyPhut: NHIP_PHUT,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  const d = db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE id = ?').run(d.id);
  return d;
}

/** Bộ đếm TIN THẬT ĐI RA — gộp cả hai đường (model qua tool, lưới qua bộ chạy). */
function banGui() {
  const tin = [];
  return {
    tin,
    api: {
      getOwnId: () => 'uid-bot',
      async sendMessage(noiDung, threadId) {
        tin.push({ text: typeof noiDung === 'string' ? noiDung : noiDung?.msg, threadId });
        return { message: { msgId: `m${tin.length}` } };
      },
    },
  };
}

function dungTool(db, api, { guiHong = false } = {}) {
  let xuLy;
  registerTools({
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
    guiTin: {
      sendToGroup: async (a, c, t) => {
        if (guiHong) throw new Error('mạng rớt');
        return a.sendMessage(t, c).then((r) => ({ msgId: r.message.msgId }));
      },
      sendHostDm: async (a, c, t) => a.sendMessage(t, c).then((r) => ({ msgId: r.message.msgId })),
    },
    chinhSach: {
      decideReplyRoute: () => ({ huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' }),
    },
  });
  return async (name, args) => JSON.parse((await xuLy({ params: { name, arguments: args } })).content[0].text);
}

/** Chạy một nhịp bộ chạy. `enqueueQuestion` thật ⇒ phiên model dựng đúng như production. */
async function motNhip(db, api, bayGioMs, { coModel = true } = {}) {
  return chayNhipTheoDuoi({
    db, api, bayGioMs, enqueueQuestion,
    sendToGroup: async (a, c, t) => a.sendMessage(t, c).then((r) => ({ msgId: r.message.msgId })),
    sendHostDm: async (a, c, t) => a.sendMessage(t, c).then((r) => ({ msgId: r.message.msgId })),
    groupMembers: () => [{ uid: TRONG, ten: 'Trọng Nguyễn' }],
    ...(coModel ? { guiThongBao: async () => true } : {}),
  });
}

function rid(db) {
  return db.prepare('SELECT request_id FROM hang_doi_hoi ORDER BY rowid DESC LIMIT 1').get()?.request_id;
}
function dong(db, id) {
  return db.prepare('SELECT * FROM lich_hen WHERE id = ?').get(id);
}

// ═══════════════════════════════════════════════════════════════════════
// T6a — CHÍNH XÁC SỰ CỐ 21/08: model trả lời NHANH, không được có tin thứ hai
// ═══════════════════════════════════════════════════════════════════════

test('T6a ★★★ model trả lời TRONG HẠN -> ĐÚNG MỘT tin, lưới KHÔNG bắn thêm', async () => {
  const db = dbTam();
  const d = nhacDaChot(db);
  const { tin, api } = banGui();
  const goi = dungTool(db, api);

  const t0 = Date.now();
  await motNhip(db, api, t0);                       // 07:10:57 — giao model
  assert.equal(tin.length, 0, 'giao model thì chưa được gửi gì');

  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: rid(db), text: 'Anh Trọng ơi, chốt giúp em nhé' });
  assert.equal(r.ok, true, JSON.stringify(r));      // 07:11:14 — model gửi tin 1
  assert.equal(tin.length, 1);

  // 07:12:27 — đúng mốc lưới an toàn từng bắn tin thứ hai.
  await motNhip(db, api, t0 + TRAN_MS + 1000);

  assert.equal(tin.length, 1,
    `một lượt nhắc đi ${tin.length} tin — đúng sự cố 21/08/2026 anh nhìn thấy`);
  assert.equal(dong(db, d.id).cho_model_tu_ms, null, 'token phải đã bị tiêu');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6b — CHIỀU NGƯỢC LẠI: đừng vá quá tay làm mất lưới an toàn
// ═══════════════════════════════════════════════════════════════════════

test('T6b ★★★ model IM quá hạn -> lưới VẪN bắn câu dự phòng', async () => {
  const db = dbTam();
  nhacDaChot(db);
  const { tin, api } = banGui();

  const t0 = Date.now();
  await motNhip(db, api, t0);                       // giao model
  assert.equal(tin.length, 0);

  const ra = await motNhip(db, api, t0 + TRAN_MS + 1000);   // model im
  assert.equal(ra.duPhong, 1, 'model chết mà không ai gửi bù -> lời nhắc biến mất âm thầm');
  assert.equal(tin.length, 1);
  closeDb(db);
});

test('T6b-2 ★★ CHƯA tới trần thì lưới CHƯA được bắn (nếu không thì nhắc đôi ngay lập tức)', async () => {
  const db = dbTam();
  nhacDaChot(db);
  const { tin, api } = banGui();
  const t0 = Date.now();
  await motNhip(db, api, t0);
  await motNhip(db, api, t0 + TRAN_MS - 5_000);     // còn 5 giây nữa mới tới trần
  assert.equal(tin.length, 0, 'bắn sớm là cướp lượt của model, và model vẫn gửi -> hai tin');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6c — 🔴 LỖ THỨ HAI, Router chưa thấy: model trả lời CHẬM HƠN TRẦN
// ═══════════════════════════════════════════════════════════════════════

test('T6c ★★★ lưới đã bắn rồi -> model tỉnh muộn bị TỪ CHỐI, không có tin thứ hai', async () => {
  // 🔴 Bài này ĐỎ nếu ai đổi sang "gỡ cờ SAU khi gửi xong": lúc đó model tỉnh
  // muộn vẫn gửi được, vì hàng đợi sống tới queueTtlMs = 30 PHÚT — dài gấp 20
  // lần trần chờ 90 giây. Đúng cùng một hậu quả: một lượt đi hai tin.
  const db = dbTam();
  nhacDaChot(db);
  const { tin, api } = banGui();
  const goi = dungTool(db, api);

  const t0 = Date.now();
  await motNhip(db, api, t0);
  const r0 = rid(db);
  await motNhip(db, api, t0 + TRAN_MS + 1000);      // lưới bắn câu dự phòng
  assert.equal(tin.length, 1);

  // Model tỉnh ở phút thứ 3 — hàng đợi VẪN còn hạn, nên nó gọi tool được.
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: r0, text: 'Anh Trọng ơi, chốt giúp em' });
  assert.equal(r.ok, false, 'model tỉnh muộn mà vẫn gửi -> nhóm nhận HAI lời nhắc');
  assert.equal(tin.length, 1, `đã đi ${tin.length} tin cho MỘT lượt nhắc`);
  closeDb(db);
});

test('T6c-2 ★★★ CHỈ RIÊNG token cũng chặn được (tách khỏi lớp A7)', async () => {
  // 🔴 Ca T6c có HAI lớp cùng chặn: (1) token đã bị lưới tiêu, (2) phiên model đã
  // bị đóng `da_tra_loi` nên chốt A7 bắt trước. Lớp (2) bắt TRƯỚC nên nó che mất
  // lớp (1) — gỡ token đi thì T6c vẫn xanh. Bài này gỡ lớp (2) ra để canh riêng
  // lớp (1), đúng bài học "phòng thủ nhiều lớp phải có test riêng cho từng lớp".
  const db = dbTam();
  nhacDaChot(db);
  const { tin, api } = banGui();
  const goi = dungTool(db, api);

  const t0 = Date.now();
  await motNhip(db, api, t0);
  const r0 = rid(db);
  await motNhip(db, api, t0 + TRAN_MS + 1000);
  assert.equal(tin.length, 1);

  // Gỡ lớp A7: coi như phiên vẫn còn sống (ca thật: model đang bay giữa chừng
  // lúc lưới bắn, hoặc lệnh đóng phiên hỏng).
  db.prepare('UPDATE hang_doi_hoi SET trang_thai = ? WHERE request_id = ?')
    .run(TRANG_THAI_HANG_DOI.CHO, r0);

  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: r0, text: 'Anh Trọng ơi' });
  assert.equal(r.ok, false, 'chỉ còn lớp token mà không chặn được -> hai tin');
  assert.match(r.thongDiep, /KHÔNG gửi thêm tin thứ hai/);
  assert.equal(tin.length, 1);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6d — GỬI HỎNG: token phải TRẢ LẠI, lưới an toàn còn nguyên
// ═══════════════════════════════════════════════════════════════════════

test('T6d ★★★ model gửi HỎNG -> token trả lại, lưới vẫn bắn được', async () => {
  // ⛔ Đây là lý do KHÔNG được "giành token rồi thôi". Giành mà không trả thì
  // hỏng theo chiều ngược lại: model chết giữa chừng, lưới không bao giờ bắn,
  // lời nhắc biến mất âm thầm — đúng thứ cả tính năng sinh ra để chống.
  const db = dbTam();
  const d = nhacDaChot(db);
  const { tin, api } = banGui();
  const goiHong = dungTool(db, api, { guiHong: true });

  const t0 = Date.now();
  await motNhip(db, api, t0);
  const mocTruoc = dong(db, d.id).cho_model_tu_ms;
  assert.ok(mocTruoc, 'phải có token sau khi giao model');

  const r = await goiHong(TEN_TOOL.TRA_LOI, { request_id: rid(db), text: 'thử' });
  assert.equal(r.ok, false);
  assert.equal(tin.length, 0);

  assert.equal(dong(db, d.id).cho_model_tu_ms, mocTruoc,
    'gửi hỏng mà token bị tiêu -> lưới an toàn mất lượt này VĨNH VIỄN');

  const ra = await motNhip(db, api, t0 + TRAN_MS + 1000);
  assert.equal(ra.duPhong, 1, 'lưới phải bắn bù được sau khi model gửi hỏng');
  assert.equal(tin.length, 1);
  closeDb(db);
});

test('T6d-2 ★★ token trả về MỐC CŨ, không phải mốc hiện tại', () => {
  // Trả về `Date.now()` thì thời gian đã chờ bị tính lại từ đầu ⇒ lưới bị lùi
  // thêm nguyên một trần nữa. Người thật chờ gấp đôi mà không ai biết vì sao.
  const db = dbTam();
  const d = nhacDaChot(db);
  const moc = Date.now() - 60_000;
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(moc, d.id);

  const { giuQuyenGuiNhac, traVeQuyenGuiNhac } = tvd;
  const giu = giuQuyenGuiNhac(db, d.id);
  assert.equal(giu.ok, true);
  assert.equal(giu.mocCu, moc);
  assert.equal(dong(db, d.id).cho_model_tu_ms, null);

  traVeQuyenGuiNhac(db, d.id, giu.mocCu);
  assert.equal(dong(db, d.id).cho_model_tu_ms, moc, 'phải là mốc CŨ');
  closeDb(db);
});

test('T6d-3 ★★★ hai bên cùng giành token -> ĐÚNG MỘT bên thắng', () => {
  const db = dbTam();
  const d = nhacDaChot(db);
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(Date.now(), d.id);
  const a = tvd.giuQuyenGuiNhac(db, d.id);
  const b = tvd.giuQuyenGuiNhac(db, d.id);
  assert.deepEqual([a.ok, b.ok], [true, false], 'cả hai cùng thắng = cả hai cùng gửi');
  closeDb(db);
});

test('T6d-4 ★★★ ẢNH CHỤP LỖI THỜI: SELECT thấy token cũ mà UPDATE phải THUA', () => {
  // 🔴 Đây là việc RIÊNG của phép kiểm `changes === 1`, và chỉ ca này tách được
  // nó ra khỏi phép kiểm null ở trên (hai lớp che nhau: bỏ lớp nào thì lớp kia
  // vẫn bắt được ca thường).
  // Ca thật: `SELECT` xong thì lưới an toàn chen vào tiêu mất token, rồi `UPDATE`
  // của mình mới chạy. Ảnh chụp trong tay đã lỗi thời — chỉ WHERE của chính
  // `UPDATE` mới nguyên tử.
  const db = dbTam();
  const d = nhacDaChot(db);
  const moc = Date.now();
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(moc, d.id);

  const dbLoiThoi = {
    prepare(sql) {
      const st = db.prepare(sql);
      if (!sql.startsWith('SELECT')) return st;
      return {
        get: (...a) => {
          // bên kia tiêu token NGAY sau khi mình đọc xong
          const r = st.get(...a);
          db.prepare('UPDATE lich_hen SET cho_model_tu_ms = NULL WHERE id = ?').run(d.id);
          return r;
        },
      };
    },
  };
  const giu = tvd.giuQuyenGuiNhac(dbLoiThoi, d.id);
  assert.equal(giu.ok, false,
    'hai bên cùng tin mình cầm token -> cùng gửi -> một lượt đi hai tin');
  closeDb(db);
});

test('T6d-5 ★★★ trả token KHÔNG được đè lên token của LƯỢT MỚI', () => {
  // Lời gọi mạng treo lâu, nhịp sau đã dành chỗ một lượt MỚI và đặt token mới.
  // Lúc đó mới trả token cũ về thì mốc chờ bị kéo lùi -> lưới an toàn của lượt
  // mới bắn SỚM hơn trần -> lại nhắc đôi, đúng thứ đang vá.
  const db = dbTam();
  const d = nhacDaChot(db);
  const cu = Date.now() - 200_000;
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(cu, d.id);
  const giu = tvd.giuQuyenGuiNhac(db, d.id);
  assert.equal(giu.ok, true);

  const moi = Date.now();
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(moi, d.id);

  assert.equal(tvd.traVeQuyenGuiNhac(db, d.id, giu.mocCu), false, 'phải từ chối trả');
  assert.equal(Number(dong(db, d.id).cho_model_tu_ms), moi,
    'token của lượt MỚI bị đè bằng mốc cũ -> lưới bắn sớm -> nhắc đôi lần nữa');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6e — SỔ SÁCH: đếm lượt và BẰNG CHỨNG gửi
// ═══════════════════════════════════════════════════════════════════════

test('T6e ★★★ so_lan_da_nhac == số tin thật, ĐƯỜNG MODEL', async () => {
  const db = dbTam();
  const d = nhacDaChot(db);
  const { tin, api } = banGui();
  const goi = dungTool(db, api);

  const t0 = Date.now();
  await motNhip(db, api, t0);
  await goi(TEN_TOOL.TRA_LOI, { request_id: rid(db), text: 'Anh Trọng ơi' });
  await motNhip(db, api, t0 + TRAN_MS + 1000);      // lưới không được cộng thêm gì

  const sau = dong(db, d.id);
  assert.equal(tin.length, 1);
  assert.equal(Number(sau.so_lan_da_nhac), 1, `đếm ${sau.so_lan_da_nhac} mà gửi ${tin.length} tin -> trần là con số dối`);
  assert.ok(sau.msg_id_da_gui,
    'đường model KHÔNG ghi bằng chứng gửi -> câu báo hết lượt kêu oan "không có bằng chứng tin nào đã gửi"');
  closeDb(db);
});

test('T6e-2 ★★★ so_lan_da_nhac == số tin thật, ĐƯỜNG DỰ PHÒNG', async () => {
  const db = dbTam();
  const d = nhacDaChot(db);
  const { tin, api } = banGui();
  const t0 = Date.now();
  await motNhip(db, api, t0, { coModel: false });   // không có Claude -> gửi thẳng
  assert.equal(tin.length, 1);
  const sau = dong(db, d.id);
  assert.equal(Number(sau.so_lan_da_nhac), 1);
  assert.ok(sau.msg_id_da_gui);
  closeDb(db);
});

test('T6e-3 ★★★ gửi HỎNG cả hai đường -> KHÔNG có bằng chứng gửi (cấm ghi khống)', async () => {
  const db = dbTam();
  const d = nhacDaChot(db);
  const api = {
    getOwnId: () => 'uid-bot',
    async sendMessage() { throw new Error('bot bị kick khỏi nhóm'); },
  };
  await chayNhipTheoDuoi({
    db, api, bayGioMs: Date.now(), enqueueQuestion,
    sendToGroup: async () => { throw new Error('bot bị kick khỏi nhóm'); },
    sendHostDm: async () => ({ msgId: 'x' }),
    groupMembers: () => [{ uid: TRONG, ten: 'Trọng Nguyễn' }],
  });
  assert.equal(dong(db, d.id).msg_id_da_gui, null,
    'ghi bằng chứng khi gửi hỏng = sổ sách nói dối, host tưởng người ta đã được nhắc');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6f — THỨ TỰ: token đặt TRƯỚC hàng đợi
// ═══════════════════════════════════════════════════════════════════════

test('T6f ★★★ token có mặt NGAY khi hàng đợi vừa sinh ra', async () => {
  // Đặt token SAU `enqueueQuestion` thì có một khe: chết giữa hai lệnh ⇒ tồn tại một
  // phiên nhắc KHÔNG có token ⇒ model trả lời bị từ chối, mà lưới cũng không bắn
  // (nó chỉ nhặt dòng CÓ token) ⇒ lượt nhắc mất ÂM THẦM.
  const db = dbTam();
  const d = nhacDaChot(db);
  let mocLucTaoHangDoi;
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(),
    enqueueQuestion: (dbIn, x) => {
      mocLucTaoHangDoi = dong(dbIn, d.id).cho_model_tu_ms;
      return enqueueQuestion(dbIn, x);
    },
    sendToGroup: async () => ({ msgId: 'x' }),
    sendHostDm: async () => ({ msgId: 'y' }),
    groupMembers: () => [],
    guiThongBao: async () => true,
  });
  assert.ok(mocLucTaoHangDoi,
    'hàng đợi sinh ra khi chưa có token -> chết giữa hai lệnh là mất lượt nhắc trong im lặng');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6h — 🔴 NHÁNH NGỦ THỨ BA: báo động GIẢ "quá hạn" cho lời nhắc ĐÃ gửi tới nơi
// ═══════════════════════════════════════════════════════════════════════

test('T6h ★★★ lưới gửi bù xong -> phiên model phải ĐÓNG, không để đẻ báo động giả', async () => {
  // Ngủ vì HAI lớp che nhau, và vừa thức do CHÍNH hai bản vá gần đây:
  //   · A5 (21/08) hạ trần chờ xuống dưới nhịp  -> lưới mới bắn lần đầu tiên
  //   · bản vá "báo câu hỏi quá hạn" (20/08)    -> `het_han` từ âm thầm thành TIN THẬT
  // Hậu quả nếu không vá: mỗi lần model im, 30 phút sau host nhận
  // "quá 30 phút nên em không trả lời muộn nữa" cho một lời nhắc ĐÃ tới nơi.
  const db = dbTam();
  nhacDaChot(db);
  const { tin, api } = banGui();

  const t0 = Date.now();
  await motNhip(db, api, t0);
  const r0 = rid(db);
  const ra = await motNhip(db, api, t0 + TRAN_MS + 1000);
  assert.equal(ra.duPhong, 1);
  assert.equal(tin.length, 1, 'lời nhắc PHẢI đã tới nơi bằng câu dự phòng');

  const q = db.prepare('SELECT trang_thai FROM hang_doi_hoi WHERE request_id = ?').get(r0);
  assert.equal(q.trang_thai, TRANG_THAI_HANG_DOI.DA_TRA_LOI,
    'phiên model bị bỏ rơi -> 30 phút sau host nhận báo động GIẢ về một tin đã gửi thành công');

  // Và kiểm THẲNG hậu quả: quét quá hạn KHÔNG được nhặt nó ra để báo.
  db.prepare('UPDATE hang_doi_hoi SET ts_tao = ?')
    .run(new Date(Date.now() - 1_860_000).toISOString());
  const hetHan = [];
  takePendingQueue(db, 1_800_000, { gomDaDay: true, khiHetHan: (r) => hetHan.push(r.request_id) });
  assert.deepEqual(hetHan, [], 'vẫn còn đường sinh báo động giả');
  closeDb(db);
});

test('T6h-3 ★★★ đóng phiên phải ĐÚNG lời nhắc đó, KHÔNG giết phiên của lời nhắc KHÁC', async () => {
  // Nhóm việc thật thường có VÀI lời nhắc chạy song song. Lọc thiếu `id` là mỗi
  // lần một lời nhắc rơi xuống câu dự phòng thì nó giết luôn phiên model của các
  // lời nhắc còn lại -> chúng mất giọng model mà không ai thấy lỗi ở đâu.
  const db = dbTam();
  const A = nhacDaChot(db, 'NHAC-A');
  const B = nhacDaChot(db, 'NHAC-B');
  const { api } = banGui();

  const t0 = Date.now();
  await motNhip(db, api, t0);                    // cả A và B đều giao model
  const phien = db.prepare('SELECT request_id, msg_id FROM hang_doi_hoi').all();
  assert.equal(phien.length, 2);
  const cuaB = phien.find((r) => r.msg_id.startsWith(`nhac:${B.id}:`)).request_id;

  // Chỉ A quá trần (B vẫn còn token mới) -> chỉ phiên của A được đóng.
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(t0, B.id);
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(t0 - TRAN_MS * 2, A.id);
  await motNhip(db, api, t0 + 100);

  const ttB = db.prepare('SELECT trang_thai FROM hang_doi_hoi WHERE request_id = ?').get(cuaB);
  assert.equal(ttB.trang_thai, TRANG_THAI_HANG_DOI.CHO,
    'phiên model của lời nhắc B bị giết oan -> B mất giọng model trong im lặng');
  closeDb(db);
});

test('T6h-2 ★★ lưới gửi HỎNG -> KHÔNG đóng phiên (còn cơ hội cuối cho model)', async () => {
  const db = dbTam();
  nhacDaChot(db);
  const api = { getOwnId: () => 'uid-bot', async sendMessage() { throw new Error('rớt mạng'); } };
  const t0 = Date.now();
  const p = {
    db, api, enqueueQuestion,
    sendToGroup: async () => { throw new Error('rớt mạng'); },
    sendHostDm: async () => ({ msgId: 'y' }),
    groupMembers: () => [],
    guiThongBao: async () => true,
  };
  await chayNhipTheoDuoi({ ...p, bayGioMs: t0 });
  const r0 = rid(db);
  await chayNhipTheoDuoi({ ...p, bayGioMs: t0 + TRAN_MS + 1000 });
  const q = db.prepare('SELECT trang_thai FROM hang_doi_hoi WHERE request_id = ?').get(r0);
  assert.equal(q.trang_thai, TRANG_THAI_HANG_DOI.CHO,
    'đóng phiên khi gửi hỏng = vứt nốt cơ hội cuối, lượt nhắc mất hẳn');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T6g — câu hỏi THƯỜNG không được dính chốt này
// ═══════════════════════════════════════════════════════════════════════

test('T6g ★★★ câu hỏi thường (không phải lượt nhắc) vẫn trả lời bình thường', async () => {
  // Chốt token chỉ áp cho phiên có `msg_id` dạng `nhac:<id>:<lần>`. Vá quá tay
  // ở đây là khoá mồm trợ lý trong mọi cuộc hội thoại thường.
  const db = dbTam();
  const { tin, api } = banGui();
  const goi = dungTool(db, api);
  enqueueQuestion(db, {
    requestId: 'r-thuong', chatIdHoi: NHOM, msgId: 'm-thuong', userId: HOST,
    noiDung: 'mấy giờ họp?', tsTao: new Date().toISOString(),
  });
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: 'r-thuong', text: '2 giờ chiều ạ' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(tin.length, 1);
  closeDb(db);
});

const tvd = await import('../src/lich/theo_duoi.js');
