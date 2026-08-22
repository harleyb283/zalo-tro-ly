/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 11 — BƯỚC 6: KHOÁ CỨNG PHẠM VI ĐỌC Ở CLIENT.
 *
 * ═══ LUẬT ANH CHỐT 21/08/2026 ═══
 *   "Quyền đi theo CHỖ HỎI, không theo NGƯỜI HỎI."
 *   Pane nhóm X chỉ thấy nhóm X. Chỉ pane DM host mới đọc cả kho.
 *   ⇒ Anh đứng TRONG NHÓM hỏi "tổng hợp hôm nay" thì chỉ tóm tắt nhóm đó,
 *     **dù người hỏi chính là anh**.
 *
 * 🔴 CỬA RÒ ĐANG MỞ SẴN, và nó mở đúng chiều nguy hiểm: mô tả tool `history`
 *    ghi *"chatId bỏ trống = tìm MỌI hội thoại đang nghe"*. Tức chỉ cần model
 *    QUÊN một tham số là nó đọc cả kho. Nhóm bài `P` canh đúng ca đó.
 *
 * ⚠️ Mọi id là BỊA, mở đầu `999`. ⛔ Không bài nào chạm mạng.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, writeMemo, enqueueQuestion, upsertConversation } from '../src/store/write.js';
import {
  _xoaPhamViChoTest, setClientId, setReadScope, groupMembers, readMemos,
  getReadScope, latestMessages, reminderTagUids, storeStats, queryHistory,
} from '../src/store/query.js';
import { CHE_DO, TEN_TOOL, TEN_TOOL_LICH, TEN_TOOL_NHAC, VAI } from '../src/lib/hang_so.js';
import { confirmSchedule, createSchedule } from '../src/lich/schedule.js';
import { createSourceLedger } from '../src/policy/leak_guard.js';
import { createFollowUp } from '../src/lich/follow_up.js';
import { registerTools } from '../src/mcp/tools.js';
import { thanHam, khoiGiua, tuNeo, truocNeo } from './_cat_ma.js';

const NHOM_A = '9990000000001';
const NHOM_B = '9990000000002';
const HOST = '9991000000000000001';
const NGUOI_B = '9994000000000000004';
const GOC = process.cwd();

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

// 🔴 Phạm vi là biến CẤP MODULE — bài trước rò sang bài sau thì kết quả vô
// nghĩa. Dựng lại sạch trước MỖI bài.
test.beforeEach(() => { _xoaPhamViChoTest(); });
test.after(() => { _xoaPhamViChoTest(); });

function thuMucTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum11-'));
  RAC.push(d);
  return d;
}

function dbHaiNhom() {
  const db = openDb(path.join(thuMucTam(), 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM_A, loai: 'GROUP', ten: 'Nhóm A', duocNghe: true });
  upsertConversation(db, { chatId: NHOM_B, loai: 'GROUP', ten: 'Nhóm B', duocNghe: true });
  const tin = (chatId, msgId, userId, ten, noiDung) => writeMessage(db, {
    chatId, msgId, cliMsgId: null, userId, tenLucGui: ten,
    msgType: 'chat.text', noiDung, contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, hasHostMention: false,
  });
  tin(NHOM_A, 'a1', HOST, 'Chủ máy', 'chuyện của nhóm A');
  tin(NHOM_A, 'a2', HOST, 'Chủ máy', 'thêm chuyện nhóm A');
  tin(NHOM_B, 'b1', NGUOI_B, 'Người B', 'BÍ MẬT của nhóm B');
  return db;
}

// ═══════════════════════════════════════════════════════════════════════
// P — GHI ĐÈ Ở TẦNG TRUY VẤN
// ═══════════════════════════════════════════════════════════════════════

test('★★★ P1 NGHIỆM THU①: khoá nhóm A, hỏi nhóm B -> 0 DÒNG của B', () => {
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const kq = queryHistory(db, { chatId: NHOM_B });
  assert.equal(kq.rows.length, 2, 'phải trả dữ liệu nhóm A, không phải trả rỗng');
  for (const r of kq.rows) {
    assert.equal(String(r.chat_id), NHOM_A, `dòng của ${r.chat_id} lọt vào pane nhóm A`);
  }
  assert.deepEqual(kq.nguonChatIds, [NHOM_A], 'nguồn khai ra cũng phải đúng phạm vi');
  closeDb(db);
});

test('★★★ P2 NGHIỆM THU②: khoá nhóm A, BỎ TRỐNG chatId -> CHỈ nhóm A', () => {
  // 🔴 Đây là cửa rò nguy hiểm nhất: mặc định cũ của `history` là "bỏ trống =
  // MỌI hội thoại". Chỉ cần model quên một tham số là nó đọc cả kho.
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const kq = queryHistory(db, {});
  assert.equal(kq.rows.length, 2);
  assert.deepEqual([...new Set(kq.rows.map((r) => String(r.chat_id)))], [NHOM_A],
    '🔴 "bỏ trống" trong pane nhóm PHẢI nghĩa là "nhóm của tôi", ⛔ không phải "tất cả"');
  closeDb(db);
});

test('★★★ P3 tìm theo TỪ KHOÁ cũng bị ép phạm vi', () => {
  // Tìm từ khoá là đường vòng hiển nhiên nhất: không truyền chatId, chỉ truyền
  // một chữ, rồi đọc kết quả của mọi nhóm.
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const kq = queryHistory(db, { tuKhoa: 'BÍ MẬT' });
  assert.equal(kq.rows.length, 0, 'tìm từ khoá vượt được phạm vi = khoá vô nghĩa');
  closeDb(db);
});

test('★★★ P4 `storeStats` cũng bị ép — CON SỐ CŨNG LÀ DỮ LIỆU', () => {
  // "Kho có N tin, đang nghe M nhóm" nói cho pane nhóm biết có bao nhiêu nhóm
  // khác tồn tại và chúng ồn tới đâu. Rò ở dạng gọn hơn, vẫn là rò.
  const db = dbHaiNhom();
  const toanBo = storeStats(db);
  assert.equal(toanBo.soTinDaLuu, 3);
  assert.equal(toanBo.soNhomDangNghe, 2);

  setReadScope(NHOM_A);
  const trongPhamVi = storeStats(db);
  assert.equal(trongPhamVi.soTinDaLuu, 2, 'đếm cả kho = khai ra kho có bao nhiêu tin');
  assert.equal(trongPhamVi.soNhomDangNghe, 1, 'khai ra có mấy nhóm khác đang được nghe');
  assert.equal(trongPhamVi.phamVi, NHOM_A);
  closeDb(db);
});

test('★★★ P5 `groupMembers` bị ép — TÊN NGƯỜI là dữ liệu riêng', () => {
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const ds = groupMembers(db, NHOM_B);
  assert.deepEqual(ds.map((x) => x.uid), [HOST],
    'danh sách thành viên nhóm khác nói cho pane này biết ai có mặt ở đó');
  closeDb(db);
});

test('★★★ P6 `readMemos` bị ép — ghi nhớ nhóm khác là dữ liệu nhóm khác', () => {
  const db = dbHaiNhom();
  writeMemo(db, { chatId: NHOM_A, nguoiGhi: HOST, noiDung: 'của A', nguyenVan: 'a' });
  writeMemo(db, { chatId: NHOM_B, nguoiGhi: HOST, noiDung: 'BÍ MẬT của B', nguyenVan: 'b' });
  setReadScope(NHOM_A);
  const kq = readMemos(db, { chatId: NHOM_B });
  assert.equal(kq.rows.length, 1);
  assert.equal(kq.rows[0].noi_dung, 'của A');
  closeDb(db);
});

test('★★ P7 `latestMessages` đi qua cùng cửa nên cũng bị ép', () => {
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const kq = latestMessages(db, NHOM_B, 50);
  assert.deepEqual([...new Set(kq.rows.map((r) => String(r.chat_id)))], [NHOM_A]);
  closeDb(db);
});

test('★★★ P7b `reminderTagUids` bị ép — UID là dữ liệu riêng NHẤT', () => {
  // 🔴 Đường này KHÔNG đi qua `queryHistory`: nó tra thẳng `lich_hen` theo id.
  // `idNhac` suy từ hàng đợi nên model không tự chọn được, nhưng dữ liệu cũ /
  // lỗi ghi vẫn trỏ được sang nhóm khác — và thứ nó trả về là **uid người
  // thật**, món riêng tư nhất trong kho.
  const db = dbHaiNhom();
  const idB = 'NB2';
  createFollowUp(db, {
    chatIdDich: NHOM_B, loaiDich: 'GROUP', noiDung: 'việc nhóm B', dienGiaiGoc: 'x',
    dienGiaiXacNhan: 'y', nguoiDat: NGUOI_B, chatIdDat: NHOM_B, id: idB, ma: idB,
    tagUserIds: [NGUOI_B],
  });
  confirmSchedule(db, { id: idB, ma: idB, nguoiDat: NGUOI_B });

  assert.ok(reminderTagUids(db, idB), 'không khoá thì phải đọc được — nếu không bài này rỗng');
  setReadScope(NHOM_A);
  assert.equal(reminderTagUids(db, idB), null,
    '🔴 pane nhóm A đọc được uid người nhóm B');
  closeDb(db);
});

test('★★★ P8 KHÔNG khoá phạm vi -> đọc được cả kho (⛔ không vá quá tay)', () => {
  // Đây là chiều ngược lại: daemon và chế độ một-tiến-trình vốn có toàn quyền
  // hợp lệ. Vá quá tay ở đây là trợ lý mù trên chính máy đang chạy hôm nay.
  const db = dbHaiNhom();
  assert.equal(getReadScope(), null);
  assert.equal(queryHistory(db, {}).rows.length, 3);
  assert.equal(queryHistory(db, { chatId: NHOM_B }).rows.length, 1);
  closeDb(db);
});

test('★★★ P9 phạm vi KHÔNG có đường nào nhận từ tham số tool', () => {
  // ⛔ Model tự nới phạm vi của chính nó thì hàng rào chỉ còn là lời đề nghị.
  // Bài này canh cấu trúc: không tool nào khai tham số phạm vi, và không chỗ
  // nào trong `tools.js` gọi `setReadScope`.
  const src = fs.readFileSync(path.join(GOC, 'src/mcp/tools.js'), 'utf8');
  assert.ok(!src.includes('setReadScope'),
    '🔴 `tools.js` gọi setReadScope = model có đường đổi phạm vi của chính nó');
  for (const ten of ['phamVi', 'pham_vi', 'scope', 'clientId', 'client_id']) {
    assert.ok(!new RegExp(`${ten}:\\s*\\{\\s*type:`).test(src),
      `có tham số tool tên "${ten}" — phạm vi/danh tính ⛔ KHÔNG được là tham số`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// T — QUA TOOL THẬT
// ═══════════════════════════════════════════════════════════════════════

function dungTool(db) {
  const nhatKy = [];
  let xuLy;
  registerTools({
    setRequestHandler(s, f) { if (s?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api: null,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: '9993000000000000003' }],
      groups: [
        { chatId: NHOM_A, ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true },
        { chatId: NHOM_B, ten: 'Nhóm B', ghiLichSu: true, traLoiKhiTag: true },
      ],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
    kho: { writeQueryLog: (_db, b) => { nhatKy.push(b); } },
  });
  return {
    nhatKy,
    goi: async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text),
  };
}

function phien(db, rid = 'r1', chatIdHoi = NHOM_A) {
  enqueueQuestion(db, {
    requestId: rid, chatIdHoi, msgId: 'a1', userId: HOST,
    noiDung: 'tổng hợp hôm nay', tsTao: new Date().toISOString(),
  });
  return rid;
}

test('★★★ T1 qua tool `history`: hỏi nhóm B -> chỉ nhóm A, và NÓI RÕ vì sao', async () => {
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const { goi } = dungTool(db);
  const r = await goi(TEN_TOOL.LICH_SU, { request_id: phien(db), chatId: NHOM_B });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([...new Set(r.duLieu.tin.map((t) => t.chatId))], [NHOM_A]);
  assert.equal(r.duLieu.biGioiHan, true, 'im lặng trả 0 dòng = model tưởng "nhóm B không có gì"');
  assert.match(r.duLieu.nhac, /chỉ thấy nhóm này thôi/,
    'phải có NGUYÊN VĂN câu chỉ đường anh đã duyệt');
  assert.match(r.duLieu.nhac, /DM/, 'phải chỉ đường DM');
  assert.match(r.duLieu.nhac, /KHÔNG ĐƯỢC PHÉP XEM/,
    'phải phân biệt "không được xem" với "không có gì"');
  closeDb(db);
});

test('★★★ T2 NGHIỆM THU③: 20 lượt của pane nhóm -> co_cheo = 0 trên 100%', async () => {
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  const { goi, nhatKy } = dungTool(db);
  for (let i = 0; i < 20; i += 1) {
    // Cố tình hỏi LUNG TUNG: lúc nhóm B, lúc bỏ trống, lúc tìm từ khoá.
    const args = i % 3 === 0 ? { chatId: NHOM_B } : i % 3 === 1 ? {} : { tuKhoa: 'BÍ MẬT' };
    // eslint-disable-next-line no-await-in-loop
    const r = await goi(TEN_TOOL.LICH_SU, { request_id: phien(db, `r${i}`), ...args });
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.duLieu.nguonChatIds.filter((c) => c !== NHOM_A), [],
      `lượt ${i} khai nguồn ngoài phạm vi`,
    );
  }
  // rồi trả lời một lượt để sinh dòng nhật ký
  await goi(TEN_TOOL.LICH_SU, { request_id: phien(db, 'rz') });
  assert.deepEqual(nhatKy.filter((x) => x.coCheo === true), [],
    'pane nhóm mà còn dòng co_cheo=1 nghĩa là vẫn đọc được nhóm khác');
  closeDb(db);
});

test('★★★ T3 NGHIỆM THU④: `client_id` LÀ CỘT THẬT trong DB và ghi ĐÚNG', async () => {
  // ⚠️ Bài này cố ý KHÔNG stub `kho.writeQueryLog` — stub chỉ chứng minh
  // "tools.js có truyền", ⛔ không chứng minh "cột tồn tại và giá trị vào được
  // đúng ô". Đây đúng ca `ref_test_hang_gia_khong_bat_duoc_loi_kieu_o_tang_db`.
  const db = dbHaiNhom();
  setReadScope(NHOM_A);
  setClientId('pane-nhom-a');
  let xuLy;
  registerTools({
    setRequestHandler(sc, f) { if (sc?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api: null,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: '9993000000000000003' }],
      groups: [{ chatId: NHOM_A, ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: createSourceLedger({ db }),
    guiTin: {
      sendToGroup: async () => ({ msgId: '9996000000001' }),
      sendHostDm: async () => ({ msgId: '9996000000002' }),
    },
  });
  const goi = async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text);

  const rid = phien(db, 'rk');
  assert.equal((await goi(TEN_TOOL.LICH_SU, { request_id: rid })).ok, true);
  const rt = await goi(TEN_TOOL.TRA_LOI, { request_id: rid, text: 'Dạ em tóm tắt nhóm mình ạ' });
  assert.equal(rt.ok, true, JSON.stringify(rt));

  const dong = db.prepare('SELECT * FROM nhat_ky_truy_van WHERE request_id = $r').get({ r: rid });
  assert.ok(dong, 'không có dòng nhật ký = mất bằng chứng nghiệm thu');
  assert.equal(dong.client_id, 'pane-nhom-a', 'client_id phải là TÊN PANE, không phải null/khác');
  assert.equal(dong.co_cheo, 0);
  closeDb(db);
});

test('★★★ T4 `followup_list` / `schedule_list` cũng bị lọc (đường đọc KHÔNG qua lich_su)', async () => {
  const db = dbHaiNhom();
  for (const [ma, chat] of [['NA', NHOM_A], ['NB', NHOM_B]]) {
    createFollowUp(db, {
      chatIdDich: chat, loaiDich: 'GROUP', noiDung: `việc ${ma}`, dienGiaiGoc: 'x',
      dienGiaiXacNhan: 'y', nguoiDat: HOST, chatIdDat: chat, ma,
    });
    confirmSchedule(db, { id: ma, ma, nguoiDat: HOST });
    createSchedule(db, {
      chatIdDich: chat, loaiDich: 'GROUP', noiDung: `lịch ${ma}`,
      guiLucMs: Date.now() + 3_600_000, dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
      nguoiDat: HOST, chatIdDat: chat, ma: `L${ma}`,
    });
    confirmSchedule(db, { id: `L${ma}`, ma: `L${ma}`, nguoiDat: HOST });
  }
  setReadScope(NHOM_A);
  const { goi } = dungTool(db);

  const rn = await goi(TEN_TOOL_NHAC.XEM_NHAC, { request_id: phien(db, 'r1') });
  assert.equal(rn.ok, true, JSON.stringify(rn));
  assert.deepEqual(rn.duLieu.danhSach.map((x) => x.noiDung), ['việc NA'],
    'xem_nhac đọc bảng CHUNG cho mọi nhóm -> là đường lách nếu không lọc');

  const rl = await goi(TEN_TOOL_LICH.XEM_LICH, { request_id: phien(db, 'r2') });
  assert.equal(rl.ok, true, JSON.stringify(rl));
  // ⚠️ `schedule_list` liệt kê CẢ lịch một lần lẫn lịch nền của nhắc theo đuổi —
  // nên đúng ở đây là "không dòng nào của nhóm B", ⛔ không phải "đúng 1 dòng".
  const dsL = rl.duLieu.lich;
  assert.ok(dsL.length >= 1, 'lọc sạch trơn thì bài này thành vô nghĩa');
  for (const x of dsL) {
    assert.equal(x.chatIdDich, NHOM_A, `lịch của ${x.chatIdDich} lọt vào pane nhóm A`);
  }
  assert.deepEqual(dsL.filter((x) => /NB/.test(x.noiDung)), []);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E — NGOẠI LỆ DM HOST + hỏng phải AN TOÀN
// ═══════════════════════════════════════════════════════════════════════

function chayClient(env) {
  const d = thuMucTam();
  const pDb = path.join(d, 'kho', 'lichsu.db');
  closeDb(openDb(pDb));
  const cfg = path.join(d, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({
    hosts: [{ userId: HOST, ten: 'Chủ máy', dmChatId: '9993000000000000003' }],
    groups: [{ chatId: NHOM_A, ten: 'Nhóm A' }],
    cauTrungTinh: 'x',
    duongDan: { db: pDb, session: path.join(d, 's.json'), health: path.join(d, 'h.json') },
  }));
  const r = spawnSync(process.execPath, [path.join(GOC, 'src/index.js'), '--config', cfg, '--kiem-khoi-dong'], {
    encoding: 'utf8', timeout: 8000,
    env: { ...process.env, ZTL_CHE_DO: CHE_DO.TACH, ZTL_VAI: VAI.CLIENT, ...env },
  });
  return { ma: r.status ?? -1, ra: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('★★★ E1 NGHIỆM THU⑤a: THIẾU CẢ HAI biến -> KHÔNG khởi động (hỏng AN TOÀN)', () => {
  // 🔴 Nếu "không khai gì" = toàn quyền thì một lần quên `ZTL_CHAT_ID` lúc mở
  // pane là pane đó lặng lẽ đọc cả kho — hỏng CÂM, không ai thấy.
  const r = chayClient({});
  assert.notEqual(r.ma, 0, 'thiếu biến mà vẫn chạy = mặc định RÒ DỮ LIỆU');
  assert.match(r.ra, /KHÔNG biết phạm vi/);
  assert.match(r.ra, /ZTL_CHAT_ID/);
  assert.match(r.ra, /ZTL_PHAM_VI=toan_bo/, 'phải chỉ luôn cách khai toàn quyền');
});

test('★★★ E2 NGHIỆM THU⑤b: pane DM host khai TƯỜNG MINH -> toàn quyền', () => {
  const r = chayClient({ ZTL_PHAM_VI: 'toan_bo' });
  assert.equal(r.ma, 0, r.ra);
  assert.match(r.ra, /TOÀN BỘ/);
  assert.match(r.ra, /khai tường minh/);
});

test('★★★ E3 khoá vào một nhóm -> log nói RÕ đang khoá vào đâu', () => {
  const r = chayClient({ ZTL_CHAT_ID: NHOM_A });
  assert.equal(r.ma, 0, r.ra);
  // 🔴 v10.3 — log tách làm HAI DÒNG RIÊNG: NHẬN gì / ĐỌC gì. Canh cả hai,
  // vì gộp lại chính là nhầm lẫn mà v10.3 sinh ra để gỡ.
  assert.match(r.ra, new RegExp(`NHẬN: chỉ dòng của ${NHOM_A}`), 'thiếu dòng NHẬN');
  assert.match(r.ra, new RegExp(`ĐỌC : KHOÁ vào ${NHOM_A}`), 'thiếu dòng ĐỌC');
});

test('★★ E4 khai CẢ HAI -> từ chối, ⛔ không tự đoán ý', () => {
  const r = chayClient({ ZTL_CHAT_ID: NHOM_A, ZTL_PHAM_VI: 'toan_bo' });
  assert.notEqual(r.ma, 0);
  assert.match(r.ra, /CẢ HAI/);
});

test('★★★ E5 `setReadScope(null)` = toàn quyền, KHÁC "chưa ai chốt"', async () => {
  // Hai trạng thái này giống nhau ở kết quả đọc nhưng khác nhau ở Ý NGHĨA, và
  // phải phân biệt được để nghiệm thu: "pane DM host" vs "daemon".
  const { isScopeLocked } = await import('../src/store/query.js');
  assert.equal(isScopeLocked(), false, 'chưa ai chốt');
  setReadScope(null);
  assert.equal(getReadScope(), null);
  assert.equal(isScopeLocked(), true, 'đã chốt là toàn quyền — một QUYẾT ĐỊNH, không phải mặc định');
});

// ═══════════════════════════════════════════════════════════════════════
// M — chế độ một tiến trình KHÔNG đổi hành vi
// ═══════════════════════════════════════════════════════════════════════

test('★★★ M1 chế độ MỘT TIẾN TRÌNH: không ai gọi setReadScope -> đọc cả kho', () => {
  const idx = fs.readFileSync(path.join(GOC, 'src/index.js'), 'utf8');
  // `setReadScope` chỉ được gọi trong `chayClient`, ⛔ không ở đường daemon.
  const truocClient = truocNeo(idx, 'async function chayClient');
  const sauClient = tuNeo(idx, 'export async function drainOutbox');
  assert.ok(!truocClient.includes('setReadScope('), 'đường daemon ⛔ không được khoá phạm vi');
  assert.ok(!sauClient.includes('setReadScope('), 'đường daemon ⛔ không được khoá phạm vi');

  const db = dbHaiNhom();
  assert.equal(queryHistory(db, {}).rows.length, 3, 'daemon phải đọc được cả kho như hôm nay');
  closeDb(db);
});

test('★★★ M2 config `cheDo` (việc B) — mặc định và giá trị lạ đều về một-tiến-trình', async () => {
  const { validateConfig } = await import('../src/policy/access.js');
  const nen = {
    hosts: [{ userId: HOST, ten: 'a', dmChatId: '9993000000000000003' }],
    groups: [{ chatId: NHOM_A, ten: 'g' }],
    cauTrungTinh: 'x',
    duongDan: { db: '/tmp/999a.db', session: '/tmp/999s', health: '/tmp/999h' },
  };
  assert.equal(validateConfig({ ...nen }).cheDo, CHE_DO.MOT_TIEN_TRINH, 'không khai -> mặc định');
  assert.equal(validateConfig({ ...nen, cheDo: CHE_DO.TACH }).cheDo, CHE_DO.TACH);
  assert.equal(validateConfig({ ...nen, cheDo: 'linh tinh' }).cheDo, CHE_DO.MOT_TIEN_TRINH,
    'giá trị lạ ⇒ về mặc định (= hành vi hôm nay), ⛔ không ném');
});
