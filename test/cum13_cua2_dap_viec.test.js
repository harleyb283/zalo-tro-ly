/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 13 — CỬA 2: TRỢ LÝ ĐƯỢC NÓI VỚI NGƯỜI ĐANG BỊ NHẮC (anh chốt 21/08/2026).
 *
 * ═══ LUẬT ═══
 *   **Quyền đi theo VIỆC, ⛔ không theo NGƯỜI.**
 *   Mở khi thoả ĐỦ BA: đúng `nguoi_phu_trach` · lời nhắc `dang_theo_duoi` ·
 *   đúng `chat_id_dich`. Lời nhắc đóng ⇒ cửa đóng theo ngay.
 *
 * 🔴 Cửa 2 mở quyền **NÓI**, ⛔ KHÔNG mở quyền **RA LỆNH**.
 * 🔴 ⛔ KHÔNG có cửa 2 trong DM.
 *
 * ⚠️ Mọi id là BỊA, mở đầu `999`. ⛔ Không bài nào chạm mạng / bắn thông báo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, enqueueQuestion, upsertConversation } from '../src/store/write.js';
import { taskOwnerHost, timViecMoCua2, _xoaPhamViChoTest } from '../src/store/query.js';
import { decideGate, LY_DO } from '../src/policy/gate.js';
import { confirmSchedule, cancelSchedule } from '../src/lich/schedule.js';
import { closeFollowUp, createFollowUp } from '../src/lich/follow_up.js';
import {
  HANH_DONG_GATE, TEN_TOOL, TEN_TOOL_GHI, TEN_TOOL_LICH, TEN_TOOL_NHAC,
} from '../src/lib/hang_so.js';
import { registerTools, TOOL_NOI_KHI_CUA2, TRAN_NOI_CUA2, LOP } from '../src/mcp/tools.js';
import { nhanCua2, LISTEN_ONLY_LABEL } from '../src/mcp/channel.js';
import { resetThrottle, setThrottle } from '../src/zalo/send.js';
import { thanHam, khoiGiua, tuNeo, truocNeo } from './_cat_ma.js';

const NHOM = '9990000000001';
const NHOM_KHAC = '9990000000004';
const HOST = '9991000000000000001';
const DM_HOST = '9993000000000000003';
const PHU_TRACH = '9994000000000000004';
const NGUOI_KHAC = '9995000000000000005';
const HOST_KHAC = '9991000000000000009';
/** `ThreadType.Group` của zca-js — nhóm là 1, DM là 0. */
const LOAI_NHOM = 1;

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});
function tam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum13-'));
  RAC.push(d);
  return d;
}
test.beforeEach(() => { _xoaPhamViChoTest(); });

// ⚠️ Nới throttle: bài này đi qua tầng gửi THẬT (chỉ giả `api.sendMessage`),
// mà throttle mặc định là 1,2 giây/tin. ⛔ Không chạm mạng — chỉ là bộ đếm.
let throttleCu;
test.before(() => { throttleCu = setThrottle({ minKhoangCachMs: 0, toiDaMoiPhut: 100000 }); });
test.after(() => { setThrottle(throttleCu); resetThrottle(); });

const CAU_HINH = {
  cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
  hosts: [{ userId: HOST, ten: 'Chủ máy', dmChatId: DM_HOST }],
  groups: [
    { chatId: NHOM, ten: 'Nhóm việc', ghiLichSu: true, traLoiKhiTag: true },
    { chatId: NHOM_KHAC, ten: 'Nhóm khác', ghiLichSu: true, traLoiKhiTag: true },
  ],
};

const tin = (p) => ({
  chatId: NHOM, msgId: 'm1', cliMsgId: null, userId: PHU_TRACH, tenLucGui: 'Người phụ trách',
  msgType: 'chat.text', noiDung: 'sắp xong rồi anh', contentRaw: null,
  tsZalo: 1_700_000_000_000, tuToi: false, hasHostMention: false, ...p,
});

/** Dựng DB có MỘT lời nhắc đang theo đuổi, giao cho `PHU_TRACH` ở `NHOM`. */
function dbCoNhac(tuyChon = {}) {
  const db = openDb(path.join(tam(), 'kho', 'lichsu.db'));
  for (const c of [NHOM, NHOM_KHAC]) {
    upsertConversation(db, { chatId: c, loai: 'GROUP', ten: 'g', duocNghe: true });
  }
  writeMessage(db, tin({ msgId: 'cu1', noiDung: 'tin cũ' }));
  // ⚠️ `groupMembers` suy danh sách từ `tin_nhan.ten_luc_gui` ⇒ host phải
  // TỪNG NHẮN trong nhóm thì mới tra ra tên mà dựng mention. Đây cũng chính là
  // ca hỏng thật ngoài đời: host chưa từng nhắn ⇒ tag bốc hơi trong im lặng.
  writeMessage(db, tin({ msgId: 'cu2', userId: HOST, tenLucGui: 'Chủ máy', noiDung: 'nhắc giúp anh nhé' }));
  const id = tuyChon.id ?? 'NHAC1';
  createFollowUp(db, {
    id,
    ma: id,
    chatIdDich: tuyChon.chatIdDich ?? NHOM,
    loaiDich: tuyChon.loaiDich ?? 'GROUP',
    noiDung: 'gửi báo giá cho khách',
    dienGiaiGoc: 'nhắc mỗi ngày', dienGiaiXacNhan: 'ok',
    nguoiDat: HOST, chatIdDat: NHOM,
    nguoiPhuTrach: tuyChon.nguoiPhuTrach ?? PHU_TRACH,
  });
  confirmSchedule(db, { id, ma: id, nguoiDat: HOST });
  return { db, id };
}

// ═══════════════════════════════════════════════════════════════════════
// Q — BA ĐIỀU KIỆN, KIỂM Ở TẦNG TRUY VẤN
// ═══════════════════════════════════════════════════════════════════════

test('★★★ Q1 đủ BA điều kiện -> tìm thấy việc (cửa 2 MỞ)', () => {
  const { db, id } = dbCoNhac();
  const v = timViecMoCua2(db, NHOM, PHU_TRACH);
  assert.equal(v?.id, id);
  assert.equal(v.noiDung, 'gửi báo giá cho khách');
  closeDb(db);
});

test('★★★ Q2 SAI NGƯỜI -> đóng (quyền đi theo VIỆC, ⛔ không theo NGƯỜI)', () => {
  const { db } = dbCoNhac();
  assert.equal(timViecMoCua2(db, NHOM, NGUOI_KHAC), null);
  assert.equal(timViecMoCua2(db, NHOM, HOST), null, 'host đi đường riêng, ⛔ không qua cửa 2');
  closeDb(db);
});

test('★★★ Q3 SAI NHÓM -> đóng', () => {
  const { db } = dbCoNhac();
  assert.equal(timViecMoCua2(db, NHOM_KHAC, PHU_TRACH), null,
    '🔴 mở ở nhóm khác = người đó điều khiển trợ lý ở mọi nhóm chung');
  closeDb(db);
});

test('★★★ Q4 lời nhắc ĐÃ ĐÓNG -> cửa đóng theo NGAY', () => {
  const { db, id } = dbCoNhac();
  assert.ok(timViecMoCua2(db, NHOM, PHU_TRACH), 'chưa đóng thì phải mở — nếu không bài này rỗng');
  closeFollowUp(db, { id, nguoiDong: HOST, isHost: true, bayGioMs: Date.now() });
  assert.equal(timViecMoCua2(db, NHOM, PHU_TRACH), null);
  closeDb(db);
});

test('★★★ Q5 🔴 lời nhắc bị HUỶ LỊCH -> cũng phải đóng (bẫy em tự tìm ra)', () => {
  // `cancelSchedule()` chỉ đổi `trang_thai` sang 'da_huy' và KHÔNG đụng
  // `trang_thai_td` ⇒ chỉ kiểm ba điều kiện là cửa 2 MỞ CHO MỘT VIỆC ĐÃ HUỶ.
  const { db, id } = dbCoNhac();
  cancelSchedule(db, { id });
  assert.equal(timViecMoCua2(db, NHOM, PHU_TRACH), null,
    '🔴 việc đã huỷ mà cửa vẫn mở — người đó nói chuyện với trợ lý về một việc không còn');
  closeDb(db);
});

test('★★★ Q6 lời nhắc gắn vào DM -> ⛔ KHÔNG mở (anh chốt: không có cửa 2 trong DM)', () => {
  const { db } = dbCoNhac({ chatIdDich: DM_HOST, loaiDich: 'DM' });
  assert.equal(timViecMoCua2(db, DM_HOST, PHU_TRACH), null);
  closeDb(db);
});

test('★★ Q7 thiếu dữ liệu -> đóng, ⛔ không ném', () => {
  const { db } = dbCoNhac();
  for (const [c, u] of [[null, PHU_TRACH], [NHOM, null], [null, null], ['', ''], [undefined, undefined]]) {
    assert.equal(timViecMoCua2(db, c, u), null, `chatId=${c} userId=${u}`);
  }
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// G — GATE
// ═══════════════════════════════════════════════════════════════════════

test('★★★ G1 gate nhận bối cảnh -> `nghe` KÈM idViecMoCua (⛔ KHÔNG phải `allow`)', () => {
  const kq = decideGate(tin({}), CAU_HINH, { idViecMoCua: 'NHAC1' });
  assert.equal(kq.action, HANH_DONG_GATE.NGHE,
    '🔴 `allow` là mở toàn quyền — cửa 2 chỉ mở quyền NÓI');
  assert.equal(kq.payload.lyDo, LY_DO.NGUOI_PHU_TRACH_DAP_VIEC);
  assert.equal(kq.payload.idViecMoCua, 'NHAC1');
});

test('★★★ G2 KHÔNG có bối cảnh -> lượt chỉ nghe thuần (fail-closed)', () => {
  const kq = decideGate(tin({}), CAU_HINH);
  assert.equal(kq.action, HANH_DONG_GATE.NGHE);
  assert.equal(kq.payload.lyDo, LY_DO.NGHE_NGUOI_KHAC);
  assert.equal(kq.payload.idViecMoCua, undefined, 'vắng hẳn = cửa đóng, ⛔ không phải rỗng');
});

test('★★★ G3 bối cảnh ⛔ KHÔNG cứu được 4 nhánh DROP', () => {
  // Cửa 2 chỉ nới nhánh "người khác trong nhóm đã duyệt". Truyền bối cảnh vào
  // 4 nhánh drop mà chúng mở ra thì cửa 2 thành cửa toang.
  const bc = { idViecMoCua: 'NHAC1' };
  const ca = [
    ['nhóm ngoài allowlist', tin({ chatId: '9990000000009' })],
    ['nhóm tắt trả lời', tin({ chatId: NHOM_KHAC })],
    ['DM người lạ', tin({ chatId: DM_HOST })],
    ['tiếng vọng trợ lý', tin({ tuToi: true })],
  ];
  const ch = { ...CAU_HINH, groups: [CAU_HINH.groups[0], { chatId: NHOM_KHAC, ten: 'x', traLoiKhiTag: false }] };
  for (const [ten, t] of ca) {
    assert.equal(decideGate(t, ch, bc).action, HANH_DONG_GATE.DROP, `🔴 bối cảnh mở được: ${ten}`);
  }
});

test('★★★ G4 ⛔ KHÔNG có cửa 2 trong DM — kể cả ĐÚNG người phụ trách', () => {
  // Anh chốt: mở DM là ai từng bị nhắc một việc cũng nhắn riêng được cho trợ lý.
  const kq = decideGate(tin({ chatId: DM_HOST, userId: PHU_TRACH }), CAU_HINH, { idViecMoCua: 'NHAC1' });
  assert.equal(kq.action, HANH_DONG_GATE.DROP);
  assert.equal(kq.payload.lyDo, LY_DO.KHONG_PHAI_HOST);
  assert.equal(kq.payload.idViecMoCua, undefined);
});

test('★★★ G5 HOST vẫn đi đường cũ, ⛔ bối cảnh không đổi gì', () => {
  const kq = decideGate(tin({ userId: HOST, hasHostMention: true }), CAU_HINH, { idViecMoCua: 'NHAC1' });
  assert.equal(kq.action, HANH_DONG_GATE.ALLOW);
  assert.equal(kq.payload.lyDo, LY_DO.HOST_TAG_TRONG_NHOM);
});

// ═══════════════════════════════════════════════════════════════════════
// T — QUA TOOL: mở quyền NÓI, ⛔ không mở quyền RA LỆNH
// ═══════════════════════════════════════════════════════════════════════

function dungTool(db, doiCauHinh = {}) {
  // 🔴 ⛔ KHÔNG tiêm `guiTin` giả. Muốn chứng minh `mentions` THẬT đi xuống
  // tầng gửi thì phải để lời gọi chạy qua `src/zalo/send.js` THẬT, và chỉ giả
  // ở lớp cuối cùng (`api.sendMessage`). Tiêm `guiTin` là cắt đúng đoạn đang
  // cần đo — bài test sẽ xanh kể cả khi mentions không bao giờ được dựng.
  const daGoiApi = [];
  // ⚠️ MẢNG THẬT, ⛔ không phải getter: mọi bài đều `const { daGui } = dungTool(…)`,
  // mà destructuring ĐÁNH GIÁ getter NGAY lúc đó — lúc chưa gửi gì. Bài test
  // sẽ luôn thấy mảng rỗng và luôn xanh. (Em vừa dính đúng lỗi này.)
  const daGui = [];
  let xuLy;
  registerTools({
    setRequestHandler(sc, f) { if (sc?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api: {
      sendMessage: async (noiDung, threadId, loaiThread) => {
        daGoiApi.push({ noiDung, threadId, loaiThread });
        daGui.push({
          noi: String(loaiThread) === String(LOAI_NHOM) ? 'nhom' : 'dm',
          c: String(threadId),
          t: noiDung?.msg ?? '',
        });
        return { msgId: '9996000000001' };
      },
    },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: { ...CAU_HINH, ...doiCauHinh },
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
  });
  return {
    daGoiApi,
    daGui,
    goi: async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text),
  };
}

function phien(db, rid, idViec, noiDung = 'sắp xong rồi anh') {
  enqueueQuestion(db, {
    requestId: rid, chatIdHoi: NHOM, msgId: rid, userId: PHU_TRACH,
    noiDung, tsTao: new Date().toISOString(), chiNghe: true, idViecMoCua: idViec,
  });
  return rid;
}

test('★★★ T1 CỬA 2 MỞ: `tra_loi` chạy được và TIN THẬT SỰ ĐI RA nhóm', () => {
  const { db, id } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  return goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r1', id),
    text: 'Dạ vâng, chưa có mốc cụ thể nên em vẫn nhắc đợt tới nhé ạ.',
  }).then((r) => {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(daGui.length, 1, 'cửa 2 mà không nói được thì mở làm gì');
    assert.equal(daGui[0].noi, 'nhom');
    closeDb(db);
  });
});

test('★★★ T2 CỬA 2 + `xinHostDuyet` -> MỘT tin trong nhóm, TAG HOST THẬT', async () => {
  // 🔴 Anh chốt 21/08/2026 nguyên văn: *"Anh cần mày tag anh trong nhóm cơ"*.
  // ⛔ KHÔNG nhắn riêng: anh không thấy ngay, và người đang bị nhắc tưởng bị lờ.
  const { db, id } = dbCoNhac();
  const { goi, daGui, daGoiApi } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r2', id),
    text: 'Dạ em ghi nhận 3h chiều mai. Anh duyệt cho em dời lịch nhắc sang 3h chiều mai nhé ạ?',
    xinHostDuyet: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));

  // ① ĐÚNG MỘT tin, và nó vào NHÓM.
  assert.equal(daGui.length, 1, `🔴 gửi ${daGui.length} tin — hai tin là làm phiền`);
  assert.equal(daGui[0].noi, 'nhom', '⛔ không được nhắn riêng');

  // ② 🔴 `mentions` THẬT đi xuống tầng gửi — ⛔ KHÔNG chỉ canh chuỗi "@".
  // Canh chữ thì một `mentions` sai kiểu / rỗng vẫn xanh, mà Zalo thì không
  // tag ai cả (bài học `ref_test_hang_gia_khong_bat_duoc_loi_kieu_o_tang_db`).
  assert.equal(daGoiApi.length, 1, 'phải chạm đúng một lời gọi sendMessage');
  const men = daGoiApi[0].noiDung?.mentions;
  assert.ok(Array.isArray(men) && men.length >= 1,
    `🔴 KHÔNG có mentions đi xuống api.sendMessage: ${JSON.stringify(daGoiApi[0].noiDung)}`);
  const cuaHost = men.find((m) => String(m.uid) === HOST);
  assert.ok(cuaHost, `🔴 mentions không chứa uid host (${HOST}): ${JSON.stringify(men)}`);
  assert.equal(typeof cuaHost.pos, 'number', 'pos phải là SỐ — zca-js dùng nó để cắt chuỗi');
  assert.ok(cuaHost.len > 0, 'len phải > 0, nếu không Zalo bỏ qua mention');

  // ③ Vùng `pos..pos+len` phải TRÙNG đúng cụm "@Tên" trong text đi ra.
  const text = daGoiApi[0].noiDung?.msg ?? daGoiApi[0].text;
  assert.equal(text.slice(cuaHost.pos, cuaHost.pos + cuaHost.len), '@Chủ máy',
    '🔴 pos/len lệch = Zalo tag nhầm đoạn chữ, hoặc không tag gì');
  closeDb(db);
});

test('★★★ T2b BA CA: chung chung ⛔ KHÔNG tag · có mốc / báo xong ⇒ CÓ tag', async () => {
  // ⚠️ Ca chung chung ⛔ KHÔNG tag host — không có gì để anh quyết, tag là làm
  // phiền vô cớ. Đây là khác biệt DUY NHẤT giữa ba ca, nên phải canh cả hai
  // chiều: có tag khi cần, VÀ không tag khi không cần.
  const CA = [
    ['chung chung', 'Dạ vâng, chưa có mốc cụ thể nên em vẫn nhắc đợt tới nhé ạ.', undefined, 0],
    ['có mốc', 'Dạ em ghi nhận 3h chiều mai. Anh duyệt cho em dời lịch nhắc sang 3h chiều mai nhé ạ?', true, 1],
    ['báo xong', 'Dạ vâng ạ. Anh xác nhận việc này xong để em đóng nhé ạ?', true, 1],
  ];
  for (const [ten, text, xin, soTag] of CA) {
    const { db, id } = dbCoNhac();
    // eslint-disable-next-line no-await-in-loop
    const { goi, daGoiApi } = dungTool(db);
    // eslint-disable-next-line no-await-in-loop
    const r = await goi(TEN_TOOL.TRA_LOI, {
      request_id: phien(db, `rc-${ten}`, id), text, ...(xin === undefined ? {} : { xinHostDuyet: xin }),
    });
    assert.equal(r.ok, true, `${ten}: ${JSON.stringify(r)}`);
    assert.equal(daGoiApi.length, 1, `${ten}: phải ĐÚNG MỘT tin`);
    const men = daGoiApi[0].noiDung?.mentions ?? [];
    assert.equal(men.length, soTag, `🔴 ${ten}: mong ${soTag} mention, nhận ${men.length}`);
    if (soTag) assert.equal(String(men[0].uid), HOST, ten);
    closeDb(db);
  }
});

test('★★★ T2c `xinHostDuyet` KHÔNG mở thêm quyền nào — bật ở lượt chỉ-nghe vẫn bị chặn', async () => {
  // Tham số này là PHÂN LOẠI, ⛔ không phải quyền. Model bật bừa ở một lượt
  // không có cửa 2 thì ⛔ không được biến nó thành lượt nói được.
  const { db } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'rx', null), text: 'Dạ', xinHostDuyet: true,
  });
  assert.equal(r.ok, false, '🔴 `xinHostDuyet` mở được cửa = model tự cấp quyền cho mình');
  assert.deepEqual(daGui, []);
  closeDb(db);
});

test('★★★ T2d HOST CHƯA TỪNG NHẮN trong nhóm -> tag hỏng CÂM, phải LÙI về DM', async () => {
  // 🔴 `groupMembers` suy danh sách từ `tin_nhan.ten_luc_gui`. Host chưa
  // nhắn lần nào ⇒ không tra ra tên ⇒ `ensureMention` bỏ qua TRONG IM LẶNG ⇒ câu
  // "anh duyệt cho em nhé" KHÔNG tới ai, mà nhìn từ ngoài thì mọi thứ ổn.
  const db = openDb(path.join(tam(), 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'g', duocNghe: true });
  writeMessage(db, tin({ msgId: 'c1', noiDung: 'tin cũ' }));      // chỉ NGƯỜI PHỤ TRÁCH nhắn
  createFollowUp(db, {
    id: 'NHAC1', ma: 'NHAC1', chatIdDich: NHOM, loaiDich: 'GROUP',
    noiDung: 'gửi báo giá', dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: PHU_TRACH,
  });
  confirmSchedule(db, { id: 'NHAC1', ma: 'NHAC1', nguoiDat: HOST });

  const { goi, daGui, daGoiApi } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r-lui', 'NHAC1'),
    text: 'Dạ vâng ạ. Anh xác nhận việc này xong để em đóng nhé ạ?',
    xinHostDuyet: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(daGoiApi[0].noiDung?.mentions, undefined, 'dựng cảnh: tag PHẢI hỏng ở đây');
  assert.equal(daGui.length, 2, '🔴 tag hỏng mà KHÔNG lùi = lời xin bốc hơi trong im lặng');
  assert.equal(daGui[0].noi, 'nhom', 'tin trong nhóm vẫn phải đi trước');
  assert.equal(daGui[1].noi, 'dm', 'rồi mới lùi về DM host');
  assert.equal(daGui[1].c, DM_HOST);
  assert.match(daGui[1].t, /KHÔNG tag được anh/, 'phải nói RÕ vì sao có tin này');
  closeDb(db);
});

test('★★★ T2d2 HOST TRÙNG TÊN với người khác -> ⛔ không tag bừa, PHẢI lùi', async () => {
  // 🔴 `ensureMention` cố ý KHÔNG dán `@Tên` khi tên trùng nhiều người — dán một
  // cụm mơ hồ chỉ tạo chữ không tag được ai. Nhưng khi đó lời xin cũng KHÔNG
  // tới host ⇒ phải lùi y như ca "chưa từng nhắn". Đường lùi chỉ xét
  // `khongTraRa` mà quên `trungTen` là bỏ sót đúng một nửa số ca hỏng.
  const db = openDb(path.join(tam(), 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'g', duocNghe: true });
  writeMessage(db, tin({ msgId: 'd1', noiDung: 'x' }));
  writeMessage(db, tin({ msgId: 'd2', userId: HOST, tenLucGui: 'Chủ máy', noiDung: 'x' }));
  // ★ Người thứ ba TRÙNG TÊN với host.
  writeMessage(db, tin({ msgId: 'd3', userId: NGUOI_KHAC, tenLucGui: 'Chủ máy', noiDung: 'x' }));
  createFollowUp(db, {
    id: 'NHAC1', ma: 'NHAC1', chatIdDich: NHOM, loaiDich: 'GROUP',
    noiDung: 'gửi báo giá', dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: PHU_TRACH,
  });
  confirmSchedule(db, { id: 'NHAC1', ma: 'NHAC1', nguoiDat: HOST });

  const { goi, daGui, daGoiApi } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r-trung', 'NHAC1'), text: 'Dạ vâng ạ. Anh xác nhận nhé ạ?', xinHostDuyet: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(daGoiApi[0].noiDung?.mentions, undefined,
    'dựng cảnh: trùng tên thì ⛔ KHÔNG được tag ai');
  assert.ok(!daGoiApi[0].noiDung.msg.startsWith('@'),
    '🔴 dán @Tên mơ hồ = chữ trần, tag nhầm hoặc không tag ai');
  assert.equal(daGui.length, 2, '🔴 trùng tên mà không lùi = lời xin bốc hơi');
  assert.equal(daGui[1].noi, 'dm');
  closeDb(db);
});

test('★★★ T2d3 nơi hỏi là DM -> ⛔ KHÔNG chạy đường lùi (DM không có mention)', async () => {
  // DM không có cơ chế mention, nên `ensureMention` ⛔ không chạy ở đó. Chạy đường
  // lùi cho một lượt DM là gửi cho host TIN THỨ HAI vào đúng chỗ vừa gửi.
  const { db, id } = dbCoNhac();
  // Lượt DM: `chat_id_hoi` chính là DM host.
  enqueueQuestion(db, {
    requestId: 'r-dm', chatIdHoi: DM_HOST, msgId: 'mdm', userId: HOST,
    noiDung: 'anh hỏi', tsTao: new Date().toISOString(), chiNghe: false, idViecMoCua: id,
  });
  const { goi, daGui } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: 'r-dm', text: 'Dạ anh.', xinHostDuyet: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(daGui.length, 1, `🔴 lượt DM mà gửi ${daGui.length} tin — anh nhận hai tin liền`);
  closeDb(db);
});

test('★★★ T2d4 ⛔ KHÔNG bao giờ tag CHÍNH BOT, kể cả khi host = tài khoản bot', async () => {
  // Trợ lý chạy trên chính tài khoản của host ⇒ `nguoi_dat` có thể trùng uid
  // bot. Tag chính mình là một mention vô nghĩa gửi vào nhóm người thật.
  const db = openDb(path.join(tam(), 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'g', duocNghe: true });
  writeMessage(db, tin({ msgId: 'b1', noiDung: 'x' }));
  writeMessage(db, tin({ msgId: 'b2', userId: HOST, tenLucGui: 'Chủ máy', noiDung: 'x' }));
  createFollowUp(db, {
    id: 'NHAC1', ma: 'NHAC1', chatIdDich: NHOM, loaiDich: 'GROUP',
    noiDung: 'x', dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
    nguoiDat: HOST, chatIdDat: NHOM, nguoiPhuTrach: PHU_TRACH,
  });
  confirmSchedule(db, { id: 'NHAC1', ma: 'NHAC1', nguoiDat: HOST });

  const daGoiApi = [];
  let xuLy;
  registerTools({
    setRequestHandler(sc, f) { if (sc?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    // ★ uid bot CHÍNH LÀ host.
    api: {
      getOwnId: () => HOST,
      sendMessage: async (noiDung, threadId, loaiThread) => {
        daGoiApi.push({ noiDung, threadId, loaiThread });
        return { msgId: '9996000000001' };
      },
    },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: CAU_HINH,
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
  });
  const goi = async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r-bot', 'NHAC1'), text: 'Dạ vâng ạ. Anh xác nhận nhé ạ?', xinHostDuyet: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const men = daGoiApi[0]?.noiDung?.mentions ?? [];
  assert.ok(!men.some((m) => String(m.uid) === HOST),
    `🔴 BOT TỰ TAG CHÍNH MÌNH: ${JSON.stringify(men)}`);
  assert.ok(!daGoiApi[0].noiDung.msg.startsWith('@'), 'cũng ⛔ không được dán chữ @ trần');
  closeDb(db);
});

test('★★★ T2e TAG ĂN thì ⛔ KHÔNG lùi (⛔ không gửi hai tin vô cớ)', async () => {
  const { db, id } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r-khonglui', id), text: 'Dạ vâng ạ. Anh xác nhận nhé ạ?', xinHostDuyet: true,
  });
  assert.equal(daGui.length, 1, `🔴 gửi ${daGui.length} tin — anh nhận HAI thông báo cho MỘT việc`);
  closeDb(db);
});

test('★★★ T2f trần độ dài đo phần MODEL VIẾT — tag do code chèn ⛔ không bị cắt', async () => {
  // Router lo tin bị cắt cụt vì phần tag. Trả lời bằng ĐO: trần chặn ở
  // `thamSo.text` (model viết), còn cụm "@Tên" do `ensureMention` chèn SAU đó —
  // nên tổng vượt trần vẫn đi ra NGUYÊN VẸN, ⛔ không ai cắt gì cả.
  const { db, id } = dbCoNhac();
  const { goi, daGoiApi } = dungTool(db);
  const sat = `${'a'.repeat(TRAN_NOI_CUA2 - 1)}?`;      // đúng sát trần
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r-tran', id), text: sat, xinHostDuyet: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const di = daGoiApi[0].noiDung.msg;
  assert.ok(di.length > TRAN_NOI_CUA2, 'tin đi ra PHẢI dài hơn trần (đã cộng phần tag)');
  assert.ok(di.endsWith(sat), '🔴 tin bị CẮT CỤT — phần model viết không còn nguyên');
  assert.equal(daGoiApi[0].noiDung.mentions?.length, 1, 'tag vẫn phải ăn');
  closeDb(db);
});

test('★★★ T3a 🔴 CỬA 2 ⛔ KHÔNG MỞ QUYỀN RA LỆNH (v11: nghiệp vụ mở, RA LỆNH vẫn đóng)', async () => {
  // 🔴 ĐỌC KỸ TRƯỚC KHI SỬA BÀI NÀY.
  // Bản v10 canh "MỌI tool GHI đều bị chặn ở cửa 2". Ngày 21/08/2026 anh **gỡ**
  // chốt đó cho **quyền NGHIỆP VỤ**: trợ lý được đóng việc / đổi lịch / ghi nhớ
  // theo lời người KHÔNG phải host. Anh đã nghe phản biện và **giữ quyết định**
  // ⇒ bài test cũ ⛔ KHÔNG được giữ nguyên để lén chặn tiếp.
  //
  // Nhưng anh nới **quyền nghiệp vụ**, ⛔ KHÔNG nới **quyền RA LỆNH**. Bài này
  // nay canh đúng phần ⛔ KHÔNG đổi:
  //   ① `nhan_rieng_host` — đường thẳng vào DM riêng của anh — VẪN CHẶN.
  //   ② Tool nghiệp vụ **thiếu bằng chứng** (ai nói / nguyên văn) — VẪN CHẶN,
  //      và ⛔ không ghi nổi một dòng nào xuống DB.
  // Phần "có bằng chứng thì chạy" nằm ở cụm 16 (nghiệm thu GĐ5).
  const { db, id } = dbCoNhac();
  const { goi } = dungTool(db);
  const truocLich = db.prepare('SELECT COUNT(*) n FROM lich_hen').get().n;
  const truocGhiNho = db.prepare('SELECT COUNT(*) n FROM ghi_nho').get().n;

  // ① QUYỀN RA LỆNH: chặn ở LỚP DANH SÁCH TRẮNG.
  const rl = await goi(TEN_TOOL.NHAN_RIENG_HOST, { request_id: phien(db, 'rg-dm', id), text: 'anh ơi' });
  assert.equal(rl.ok, false, '🔴 cửa 2 mở được đường nhắn riêng vào DM anh');
  assert.equal(rl.lop, LOP.DANH_SACH_TRANG, 'phải rơi ở danh sách trắng, ⛔ không phải lớp khác');

  // ② NGHIỆP VỤ THIẾU BẰNG CHỨNG: chặn ở LỚP ĐÒI NGUỒN.
  for (const [ten, args] of [
    [TEN_TOOL_NHAC.DONG_NHAC, { id }],
    [TEN_TOOL_NHAC.CHINH_NHIP_NHAC, { id, chuKyNgay: 7 }],
    [TEN_TOOL_LICH.HUY_LICH, { id }],
    [TEN_TOOL_LICH.DAT_LICH_NHAP, { noiDung: 'x', khiNaoMs: Date.now() + 60_000 }],
    [TEN_TOOL_LICH.DAT_LICH_CHOT, { id: 'x', ma: 'x' }],
    [TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, { noiDung: 'x' }],
    [TEN_TOOL_GHI.GHI_NHO, { noiDung: 'x', nguyenVan: 'x' }],
    [TEN_TOOL_GHI.MO_LAI_NHAC, { id }],
    // ⚠️ Có `nguonNguoi` mà THIẾU `nguonNguyenVan` ⇒ vẫn phải từ chối. Nửa bộ
    // bằng chứng là thứ dễ lọt nhất: nhìn thoáng qua tưởng "đã khai nguồn rồi".
    [TEN_TOOL_GHI.GHI_NHO, { noiDung: 'x', nguyenVan: 'x', nguonNguoi: PHU_TRACH }],
    [TEN_TOOL_NHAC.DONG_NHAC, { id, nguonNguyenVan: 'xong rồi anh' }],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await goi(ten, { request_id: phien(db, `rg-${ten}-${Object.keys(args).length}`, id), ...args });
    assert.equal(r.ok, false, `🔴 '${ten}' chạy được mà ⛔ KHÔNG khai nguồn`);
    assert.equal(r.lop, LOP.THIEU_NGUON, `'${ten}' rơi nhầm lớp: ${r.lop} — ${r.thongDiep}`);
  }

  // 🔴 Canh BẢN GHI DB trước/sau, ⛔ không chỉ đếm lời gọi hàm.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lich_hen').get().n, truocLich);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ghi_nho').get().n, truocGhiNho);
  const d = db.prepare('SELECT trang_thai_td, chu_ky_ngay FROM lich_hen WHERE id = $i').get({ i: id });
  assert.equal(d.trang_thai_td, 'dang_theo_duoi', '🔴 đóng được lời nhắc mà ⛔ không để lại vết');
  assert.equal(d.chu_ky_ngay, 1, 'nhịp bị đổi = người đó tự dời lịch');
  closeDb(db);
});

test('★★★ T4 danh sách tool NÓI đúng MỘT cái, ⛔ không có tool ghi, ⛔ không nhắn riêng', () => {
  // `nhan_rieng_host` ĐÃ BỎ 21/08/2026 — xin phép phải TAG TRONG NHÓM.
  assert.deepEqual([...TOOL_NOI_KHI_CUA2], [TEN_TOOL.TRA_LOI]);
  for (const cam of [
    TEN_TOOL.NHAN_RIENG_HOST, TEN_TOOL_NHAC.DONG_NHAC,
    TEN_TOOL_GHI.GHI_NHO, TEN_TOOL_LICH.HUY_LICH,
  ]) {
    assert.ok(!TOOL_NOI_KHI_CUA2.includes(cam), `🔴 '${cam}' lọt vào danh sách NÓI`);
  }
});

test('★★★ T5 CỬA 2 ĐÓNG (lượt chỉ nghe thuần) -> `tra_loi` vẫn bị chặn', async () => {
  const { db } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db, 'r3', null), text: 'Dạ' });
  assert.equal(r.ok, false);
  assert.deepEqual(daGui, [], '🔴 cửa đóng mà tin vẫn đi ra');
  closeDb(db);
});

test('★★★ T6 phiên tự khai `idViecMoCua` qua THAM SỐ TOOL -> ⛔ không lọt', async () => {
  const { db, id } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  for (const doi of [{ idViecMoCua: id }, { id_viec_mo_cua: id }, { chiNghe: false }]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db, `rk-${Object.keys(doi)[0]}`, null), text: 'Dạ', ...doi });
    assert.equal(r.ok, false, `model tự khai ${JSON.stringify(doi)} mà lọt`);
  }
  assert.deepEqual(daGui, []);
  closeDb(db);
});

test('★★★ T7 TRẦN ĐỘ DÀI: câu dài ⇒ chặn (chống biến thành chatbot)', async () => {
  const { db, id } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  const dai = 'a'.repeat(TRAN_NOI_CUA2 + 1);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db, 'r4', id), text: dai });
  assert.equal(r.ok, false);
  assert.match(r.thongDiep, /quá dài/);
  assert.deepEqual(daGui, []);

  const vua = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db, 'r5', id), text: 'a'.repeat(TRAN_NOI_CUA2) });
  assert.equal(vua.ok, true, 'đúng trần thì phải qua — ⛔ đừng chặn nhầm câu hợp lệ');
  closeDb(db);
});

test('★★★ T8 trần CHỈ áp cho lượt cửa 2, ⛔ không áp cho HOST', async () => {
  const { db } = dbCoNhac();
  const { goi } = dungTool(db);
  enqueueQuestion(db, {
    requestId: 'r-host', chatIdHoi: NHOM, msgId: 'mh', userId: HOST,
    noiDung: 'anh hỏi', tsTao: new Date().toISOString(), chiNghe: false,
  });
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: 'r-host', text: 'a'.repeat(TRAN_NOI_CUA2 + 500) });
  assert.equal(r.ok, true, '🔴 chặn nhầm host là trợ lý cụt lủn với chính chủ');
  closeDb(db);
});

test('★★★ T9 đường XIN host chỉ mở KHI CỬA 2 MỞ, ⛔ không đại trà', async () => {
  // Đường lùi "tra host theo người ĐẶT việc" là một lối mới đi thẳng vào DM
  // của anh. Nới đại trà thì ai cũng nhắn riêng được cho anh qua trợ lý.
  const { db } = dbCoNhac();
  const { goi, daGui } = dungTool(db);
  const r = await goi(TEN_TOOL.NHAN_RIENG_HOST, {
    request_id: phien(db, 'r-nodoor', null), text: 'anh ơi',
  });
  assert.equal(r.ok, false, '🔴 cửa đóng mà vẫn nhắn được vào DM anh');
  assert.deepEqual(daGui, []);
  closeDb(db);
});

test('★★★ T10 TAG đúng host CỦA VIỆC ĐÓ, ⛔ không phải host bất kỳ', async () => {
  // 🔴 PHẢI có HAI host, và host đặt việc KHÔNG được là `hosts[0]`. Một đối
  // chứng chỉ có một giá trị thì không phân biệt được gì — bản đầu của bài này
  // chỉ có một host và đột biến "lấy hosts[0]" SỐNG SÓT.
  const { db, id } = dbCoNhac();
  const { goi, daGoiApi } = dungTool(db, {
    hosts: [
      { userId: HOST_KHAC, ten: 'Host khác', dmChatId: '9993000000000000009' },
      { userId: HOST, ten: 'Chủ máy', dmChatId: DM_HOST },
    ],
  });
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, 'r-dung-host', id),
    text: 'Dạ vâng ạ. Anh xác nhận việc này xong để em đóng nhé ạ?',
    xinHostDuyet: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const men = daGoiApi[0]?.noiDung?.mentions ?? [];
  assert.deepEqual(men.map((m) => String(m.uid)), [HOST],
    `🔴 tag NHẦM NGƯỜI — kéo người ngoài cuộc vào việc không phải của họ: ${JSON.stringify(men)}`);
  closeDb(db);
});

test('★★★ T11 `idViecMoCua` chuỗi RỖNG -> ép về NULL (cửa ĐÓNG)', () => {
  // `''` là một giá trị "có mặt" trong SQL: `IS NOT NULL` coi nó là cửa MỞ cho
  // một việc không tồn tại, và `phien.idViecMoCua` truthy-check thì lại đóng —
  // hai tầng hiểu ngược nhau là chỗ hỏng câm sinh ra.
  const { db } = dbCoNhac();
  for (const [i, v] of ['', '   ', null, undefined, 0, false].entries()) {
    enqueueQuestion(db, {
      requestId: `rr${i}`, chatIdHoi: NHOM, msgId: `mm${i}`, userId: PHU_TRACH,
      noiDung: 'x', tsTao: new Date().toISOString(), chiNghe: true, idViecMoCua: v,
    });
    const d = db.prepare('SELECT id_viec_mo_cua FROM hang_doi_hoi WHERE request_id = $r').get({ r: `rr${i}` });
    assert.equal(d.id_viec_mo_cua, null, `giá trị ${JSON.stringify(v)} phải thành NULL`);
  }
  closeDb(db);
});

test('★★★ T12a BA LỚP che nhau — đo xem lớp NÀO thật sự chặn', async () => {
  // 🔴 EM ĐO SAI MỘT LƯỢT, ghi lại để khỏi ai đo sai tiếp.
  // Bản đầu bài này định cô lập điều kiện `phien.idViecMoCua` trong
  // `_nhanRiengHost` bằng cách tiêm `taskOwnerHost` luôn trả host. Nó XANH,
  // và em tưởng lớp đó đang chặn. Thật ra tin bị chặn SỚM HƠN HAI TẦNG, ở
  // `_chanKhiChiNghe` — `nhan_rieng_host` không nằm trong danh sách trắng của
  // lượt chỉ-nghe khi cửa 2 đóng, nên nó chưa bao giờ chạy tới `_nhanRiengHost`.
  //
  // ⇒ Bài này nay đo ĐÚNG thứ nó chặn được: LỚP DANH SÁCH TRẮNG.
  // Điều kiện `idViecMoCua` trong `_nhanRiengHost` là lớp DƯ THỪA có chủ đích
  // (phòng khi ai đó thêm `nhan_rieng_host` vào danh sách trắng), và vì dư nên
  // ⛔ KHÔNG đo được — đã báo Router, ⛔ đừng viết bài giả vờ đo nó.
  const { db } = dbCoNhac();
  const daGui = [];
  let xuLy;
  registerTools({
    setRequestHandler(sc, f) { if (sc?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api: { sendMessage: async () => ({ msgId: '9996000000001' }) },
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: CAU_HINH,
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
    kho: { taskOwnerHost: () => HOST },   // vô hiệu lớp trong cùng
    guiTin: {
      sendToGroup: async () => ({ msgId: 'x' }),
      sendHostDm: async (_a, c, t) => { daGui.push({ c, t }); return { msgId: 'y' }; },
    },
  });
  const goi = async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text);

  const r = await goi(TEN_TOOL.NHAN_RIENG_HOST, {
    request_id: phien(db, 'r-lop1', null), text: 'anh ơi',
  });
  assert.equal(r.ok, false, '🔴 cửa 2 đóng mà vẫn nhắn được vào DM anh');
  // ⚠️ Bản cũ canh chữ `/CHỈ ĐỂ NGHE/` trong thông điệp. Sửa câu chữ cho dễ
  // hiểu là bài đỏ oan (đã xảy ra 21/08) — mà nguy hơn: ĐỔI THỨ TỰ LỚP thì câu
  // chữ vẫn có thể trùng, ⛔ không bài nào đỏ. Nay đo bằng nhãn `lop` do chính
  // cổng chặn đóng vào: mốc ỔN ĐỊNH, ⛔ không phụ thuộc lời văn.
  assert.equal(r.lop, LOP.DANH_SACH_TRANG,
    `phải rơi ở LỚP DANH SÁCH TRẮNG — rơi chỗ khác nghĩa là thứ tự lớp đã đổi (thật: ${r.lop})`);
  assert.deepEqual(daGui, []);
  closeDb(db);
});

test('★★★ T12 đường XIN host fail-closed HAI LỚP (⛔ hai lớp phải TÁCH được)', () => {
  // Lớp 1: chỉ tra khi phiên có `idViecMoCua`. Lớp 2: `taskOwnerHost(null)`
  // trả null. Bài này canh LỚP 2 riêng — nếu không, gỡ lớp 1 vẫn xanh nhờ lớp
  // 2 che, và ngược lại. Hai lá chắn che nhau là hai lá chắn không đo được.
  const { db, id } = dbCoNhac();
  assert.equal(taskOwnerHost(db, id), HOST, 'phải tra ra host ĐÃ ĐẶT việc');
  for (const xau of [null, undefined, '', '   ', 'KHONG_TON_TAI']) {
    assert.equal(taskOwnerHost(db, xau), null, `id ${JSON.stringify(xau)} phải trả null`);
  }
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// W — NỐI DÂY ĐẦU-CUỐI (`handleMessage`) — chỗ 4 đột biến từng SỐNG SÓT
// ═══════════════════════════════════════════════════════════════════════

/** Dựng bộ đủ để chạy `handleMessage` mà ⛔ không chạm mạng. */
function boDauCuoi(db) {
  const daBao = [];
  return {
    daBao,
    p: {
      db,
      cauHinh: CAU_HINH,
      guiThongBao: async (x) => { daBao.push(x); return true; },
      tenHoiThoai: () => 'Nhóm việc',
      log: () => {},
    },
  };
}

test('★★★ W1 ĐẦU-CUỐI: người phụ trách nói -> phiên MANG id việc (⛔ không chết câm)', async () => {
  // 🔴 Bốn đột biến ở `index.js` từng SỐNG vì không bài nào chạy qua đường nối
  // dây thật: "không tra cửa 2", "ghi hàng đợi bỏ mất id", "tra hỏng thì ném",
  // "lấy id từ biến riêng". Cả bốn đều làm tính năng CHẾT CÂM hoặc SAI CÂM.
  const { handleMessage } = await import('../src/index.js');
  const { db, id } = dbCoNhac();
  const { p, daBao } = boDauCuoi(db);
  handleMessage(p, tin({ msgId: 'w1', userId: PHU_TRACH, noiDung: 'sắp xong rồi anh' }));
  await new Promise((r) => setTimeout(r, 25));

  const dong = db.prepare("SELECT * FROM hang_doi_hoi WHERE msg_id = 'w1'").get();
  assert.ok(dong, 'phải mở phiên');
  assert.equal(dong.id_viec_mo_cua, id, '🔴 cửa 2 KHÔNG tới được phiên — tính năng chết câm');
  assert.equal(dong.chi_nghe, 1, 'cửa 2 mở quyền NÓI, ⛔ vẫn KHÔNG phải lượt host');
  assert.equal(daBao[0]?.idViecMoCua, id, 'tin báo cho model cũng phải mang id');
  assert.equal(daBao[0]?.noiDungViec, 'gửi báo giá cho khách', 'model cần BIẾT phạm vi là việc nào');
  closeDb(db);
});

test('★★★ W2 ĐẦU-CUỐI: người KHÔNG phụ trách -> phiên KHÔNG mang id', async () => {
  const { handleMessage } = await import('../src/index.js');
  const { db } = dbCoNhac();
  const { p } = boDauCuoi(db);
  handleMessage(p, tin({ msgId: 'w2', userId: NGUOI_KHAC }));
  await new Promise((r) => setTimeout(r, 25));
  const dong = db.prepare("SELECT * FROM hang_doi_hoi WHERE msg_id = 'w2'").get();
  assert.equal(dong.id_viec_mo_cua, null, '🔴 cửa mở cho người không phụ trách');
  assert.equal(dong.chi_nghe, 1);
  closeDb(db);
});

test('★★★ W3 ĐẦU-CUỐI: HOST gửi -> lượt đầy đủ, ⛔ KHÔNG dính cờ cửa 2', async () => {
  // Đột biến "lấy id từ BIẾN riêng thay vì payload gate" lộ ra ở đây: gate trả
  // `allow` (không có id) trong khi biến `boiCanhCua2` có thể vẫn mang giá trị.
  const { handleMessage } = await import('../src/index.js');
  const { db, id } = dbCoNhac({ nguoiPhuTrach: HOST });   // host CHÍNH LÀ người phụ trách
  const { p } = boDauCuoi(db);
  handleMessage(p, tin({ msgId: 'w3', userId: HOST, hasHostMention: true }));
  await new Promise((r) => setTimeout(r, 25));
  const dong = db.prepare("SELECT * FROM hang_doi_hoi WHERE msg_id = 'w3'").get();
  assert.equal(dong.chi_nghe, 0, 'host phải là lượt đầy đủ');
  assert.equal(dong.id_viec_mo_cua, null,
    '🔴 lượt host mà mang cờ cửa 2 = trần 300 ký tự áp nhầm lên chính chủ');
  void id;
  closeDb(db);
});

test('★★★ W5 id cửa 2 lấy từ PAYLOAD GATE, ⛔ không từ biến tra DB riêng', () => {
  // Hai giá trị này TRÙNG NHAU hôm nay (index.js chỉ tra khi gate sẽ trả
  // `nghe`), nên ⛔ không bài hành vi nào phân biệt được — đột biến đổi nguồn
  // SỐNG SÓT, và em đã đo đúng thế. Nhưng "trùng nhau hôm nay" là một sự
  // TRÙNG HỢP của điều kiện tra, ⛔ không phải một bảo đảm: đổi điều kiện đó
  // là hai vế tách ra, và không có gì báo.
  // ⇒ Canh CẤU TRÚC: gate là nguồn sự thật DUY NHẤT về quyền.
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const than = khoiGiua(idx, 'export function handleMessage', '// MAIN')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(than, /idViecMoCua: kq\.payload\?\.idViecMoCua \?\? null/,
    'phải đọc quyền từ payload của GATE');
  assert.ok(!/idViecMoCua: boiCanhCua2/.test(than),
    '🔴 đọc thẳng biến tra DB = hai nguồn sự thật về QUYỀN');
});

test('★★★ W4 ĐẦU-CUỐI: tra cửa 2 HỎNG -> coi như ĐÓNG, ⛔ KHÔNG giết đường nhận tin', async () => {
  // Một lỗi đọc DB ⛔ không được làm rơi cả tin nhắn — tin vẫn phải được GHI và
  // phiên vẫn phải mở, chỉ là cửa 2 đóng.
  const { handleMessage } = await import('../src/index.js');
  const { db } = dbCoNhac();
  const goc = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('trang_thai_td = $ttd')) throw new Error('DB chết đúng lúc');
    return goc(sql);
  };
  const { p } = boDauCuoi(db);
  assert.doesNotThrow(() => handleMessage(p, tin({ msgId: 'w4', userId: PHU_TRACH })));
  await new Promise((r) => setTimeout(r, 25));
  db.prepare = goc;
  const dong = db.prepare("SELECT * FROM hang_doi_hoi WHERE msg_id = 'w4'").get();
  assert.ok(dong, 'tra hỏng mà mất luôn phiên = mất tin của người thật');
  assert.equal(dong.id_viec_mo_cua, null, 'hỏng phải về chiều ĐÓNG');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// N — NHÃN BƠM CHO MODEL
// ═══════════════════════════════════════════════════════════════════════

test('★★★ N1 nhãn cửa 2 nêu ĐÍCH DANH việc + 3 điều bắt buộc', () => {
  const n = nhanCua2('gửi báo giá cho khách');
  assert.match(n, /gửi báo giá cho khách/, 'không nêu việc thì model không biết phạm vi là gì');
  assert.match(n, /Ngoài phạm vi/, 'phải dặn ra khỏi phạm vi thì im');
  assert.match(n, /bo_qua/, 'phải chỉ đường đóng lượt');
  assert.match(n, /nhan_rieng_host/, 'phải chỉ đường XIN host');
  assert.match(n, /không tự quyết/, 'phải nói rõ model KHÔNG phải chốt cuối');
});

test('★★★ N2 nhãn cửa 2 THẮNG nhãn chỉ-nghe (⛔ không dán cả hai)', async () => {
  const { createChannel } = await import('../src/mcp/channel.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const nhan = [];
  const kenh = createChannel({ tenServer: 't', phienBan: '0', registerTools: () => {} });
  const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
  client.fallbackNotificationHandler = async (n) => { nhan.push(n); };
  const [tC, tS] = InMemoryTransport.createLinkedPair();
  await kenh.noiVaoTransport(tS);
  await client.connect(tC);

  await kenh.guiThongBao({
    requestId: 'r1', chatId: NHOM, noiDung: 'sắp xong', chiNghe: true,
    idViecMoCua: 'NHAC1', noiDungViec: 'gửi báo giá cho khách',
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(nhan.length, 1);
  const c = nhan[0].params.content;
  assert.ok(c.startsWith('[ĐÁP VIỆC'), 'nhãn cửa 2 phải ở ĐẦU content');
  assert.ok(!c.includes(LISTEN_ONLY_LABEL),
    '🔴 dán cả hai nhãn = bảo model vừa "không được trả lời" vừa "đáp ngắn"');
  assert.equal(nhan[0].params.meta.id_viec_mo_cua, 'NHAC1');
  await kenh.dong();
});
