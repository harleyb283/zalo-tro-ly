/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 8 — DM ≠ NHÓM. Chọn sai KIỂU LUỒNG thì Zalo TỪ CHỐI.
 *
 * 🔴 CA HỎNG THẬT sáng 21/08/2026 — host nhắn DM RIÊNG cho trợ lý, trợ lý trả
 *    lời và nhận về:
 *        Gửi tin vào <id-DM> thất bại — Nhóm này không tồn tại.
 *    Chuỗi "Nhóm này không tồn tại" KHÔNG có trong `src/` ⇒ **Zalo trả về**,
 *    tức mình gửi bằng `ThreadType.Group` tới một id DM.
 *
 * 🔴 Gốc: `HUONG_TRA_LOI.NHOM` nghĩa là *"trả lời NGAY CHỖ ĐÃ HỎI"*, KHÔNG có
 *    nghĩa *"chỗ đó là một nhóm"*. `tra_loi` chưa bao giờ hỏi `chat_id_hoi`
 *    thuộc loại gì, trong khi nhánh `DM_HOST` ngay bên dưới thì CÓ truyền
 *    `{ laDm: true }` — nên đường DM CHỦ ĐỘNG chạy được, còn đường TRẢ LỜI MỘT
 *    CÂU HỎI ĐẾN TỪ DM thì rơi vào nhánh nhóm.
 *
 * ⚠️ MỌI bài dưới đây dùng `send.js` THẬT và bắt **tham số thứ ba của
 *    `api.sendMessage`** — tức giá trị `ThreadType` thật sự đi xuống Zalo.
 *    Bài học `ref_test_hang_gia_khong_bat_duoc_loi_kieu_o_tang_db`: tiêm hàng
 *    giả cho tầng gửi thì lỗi chọn nhầm kiểu luồng KHÔNG LỘ — canh "có gọi hàm
 *    gửi không" sẽ xanh trên cả code hỏng.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ThreadType } from 'zca-js';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, enqueueQuestion, upsertConversation } from '../src/store/write.js';
import { groupMembers, conversationKind, reminderTagUids } from '../src/store/query.js';
import { HUONG_TRA_LOI, TEN_TOOL, TEN_TOOL_LICH, TEN_TOOL_NHAC } from '../src/lib/hang_so.js';
import { decideReplyRoute } from '../src/policy/leak_guard.js';
import { quyetDinh } from '../src/policy/gate.js';
import { confirmSchedule, createSchedule } from '../src/lich/schedule.js';
import { createFollowUp } from '../src/lich/follow_up.js';
import { runOneTick, runFollowUpTick } from '../src/lich/runner.js';
import { registerTools } from '../src/mcp/tools.js';
import { ensureMention, resetThrottle, setThrottle, sendHostDm, sendToGroup } from '../src/zalo/send.js';

/**
 * ⚠️ ID BỊA. Ca hỏng thật 21/08 xảy ra trên một id DM khác — ⛔ KHÔNG chép id
 * thật vào đây: pack này lên git, và bài quét dữ liệu riêng (`chia_tin.test.js`
 * C1) CỐ Ý bỏ qua thư mục `test/`, nên ở đây KHÔNG có ai chặn giúp.
 */
const DM = '9998000000000000008';
const DM_KHAC = '9997000000000000007';
const NHOM = '9990000000001';
const HOST = '555000111';
const HOST2 = '666000222';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

let throttleCu;
test.before(() => { throttleCu = setThrottle({ minKhoangCachMs: 0, toiDaMoiPhut: 100000 }); });
test.after(() => { setThrottle(throttleCu); resetThrottle(); });

function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum8-'));
  RAC.push(d);
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: DM, loai: 'DM', ten: 'Chủ máy', duocNghe: true });
  upsertConversation(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  return db;
}

function tin(db, chatId, msgId) {
  writeMessage(db, {
    chatId, msgId, cliMsgId: null, userId: HOST, tenLucGui: 'Chủ máy',
    msgType: 'chat.text', noiDung: 'nội dung cũ', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, hasHostMention: false,
  });
}

/**
 * Bắt THAM SỐ THỨ BA của `api.sendMessage` — chính là `ThreadType` đi xuống Zalo.
 * ⛔ Đây là điểm đo duy nhất có giá trị: mọi tầng trên đều có thể "trông như
 * đúng" mà vẫn truyền nhầm số này.
 */
function banGui() {
  const tin_ = [];
  return {
    tin: tin_,
    api: {
      getOwnId: () => 'uid-bot',
      async sendMessage(noiDung, id, loaiThread) {
        tin_.push({ id, loaiThread, msg: noiDung?.msg, mentions: noiDung?.mentions });
        return { message: { msgId: `m${tin_.length}` } };
      },
    },
  };
}

const ten = (l) => (l === ThreadType.User ? 'User(DM)' : l === ThreadType.Group ? 'Group' : `lạ:${l}`);

function dungTool(db, api, { hosts, cauTrungTinh = 'Em nhắn riêng anh rồi ạ.', huong } = {}) {
  let xuLy;
  registerTools({
    setRequestHandler(s, f) { if (s?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh,
      hosts: hosts ?? [{ userId: HOST, ten: 'Anh', dmChatId: DM }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
    guiTin: { sendToGroup, sendHostDm },      // ★ tầng gửi THẬT
    ...(huong ? { chinhSach: { decideReplyRoute: () => huong } } : {}),
  });
  return async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text);
}

function phien(db, { requestId = 'r1', chatIdHoi = DM, msgId = 'd1', userId = HOST, noiDung = 'anh hỏi cái này' } = {}) {
  enqueueQuestion(db, { requestId, chatIdHoi, msgId, userId, noiDung, tsTao: new Date().toISOString() });
  return requestId;
}

// ═══════════════════════════════════════════════════════════════════════
// A — NGHIỆM THU ① và ②
// ═══════════════════════════════════════════════════════════════════════

test('★★★ A1 NGHIỆM THU①: câu hỏi đến từ DM -> gửi bằng ThreadType.User', async () => {
  const db = dbTam();
  tin(db, DM, 'd1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'Dạ em trả lời anh đây' });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra.length, 1);
  assert.equal(ra[0].loaiThread, ThreadType.User,
    `🔴 ĐÚNG CA 21/08 — gửi bằng ${ten(ra[0].loaiThread)} tới một id DM, Zalo trả "Nhóm này không tồn tại"`);
  assert.equal(ra[0].id, DM);
  closeDb(db);
});

test('★★★ A2 NGHIỆM THU②: câu hỏi đến từ NHÓM -> vẫn ThreadType.Group (chống hồi quy)', async () => {
  const db = dbTam();
  tin(db, NHOM, 'g1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { chatIdHoi: NHOM, msgId: 'g1' }), text: 'Dạ em trả lời trong nhóm',
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra[0].loaiThread, ThreadType.Group,
    'vá quá tay: mọi tin thành DM thì trợ lý câm trong MỌI nhóm');
  closeDb(db);
});

test('★★★ A3 tin DÀI trong DM -> MỌI phần đều ThreadType.User', async () => {
  // Đường chia nhỏ (`sendInParts`) là một đường gửi RIÊNG, có `laDm` riêng.
  // Vá đường tin ngắn mà quên đường này thì lỗi y hệt, chỉ lộ khi anh hỏi một
  // câu cần trả lời dài — tức đúng lúc nội dung đáng giá nhất.
  const db = dbTam();
  tin(db, DM, 'd1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'x'.repeat(9000) });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(ra.length > 1, `phải chia nhiều phần, thực tế ${ra.length}`);
  for (const [i, t] of ra.entries()) {
    assert.equal(t.loaiThread, ThreadType.User, `phần ${i + 1} gửi bằng ${ten(t.loaiThread)}`);
  }
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// B — CÂU TRUNG TÍNH (nhánh DM_HOST) cũng gọi thẳng sendToGroup
// ═══════════════════════════════════════════════════════════════════════

test('★★★ B1 nơi hỏi CHÍNH LÀ DM host -> BỎ câu trung tính (đáp án đã tới đúng chỗ)', async () => {
  // Hỏi trong DM rồi lại "nhắn riêng" thì đích đến LÀ MỘT. Gửi thêm câu trung
  // tính vào đó là anh nhận hai tin liền: đáp án, rồi "em nhắn riêng anh rồi ạ".
  const db = dbTam();
  tin(db, DM, 'd1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api, {
    huong: { huong: HUONG_TRA_LOI.DM_HOST, coCheo: true, nguonLa: [NHOM], lyDo: 'có nguồn lạ' },
  });
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'đáp án có dữ liệu nhóm khác' });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra.length, 1, `gửi ${ra.length} tin vào cùng một DM — tin thứ hai là câu xã giao vô nghĩa`);
  assert.equal(ra[0].loaiThread, ThreadType.User);
  closeDb(db);
});

test('★★★ B2 `dmChatId` trong config LỆCH nơi hỏi -> câu trung tính vẫn phải đi bằng User', async () => {
  // ⚠️ NÓI RÕ PHẠM VI: với cấu hình ĐÚNG thì ca này KHÔNG xảy ra — host hỏi
  // trong DM của chính mình nên `chat_id_hoi` === `dmChatId`, và bài B1 mới là
  // ca thật. Bài này dựng ca `hosts[].dmChatId` bị điền lệch (người vận hành
  // gõ nhầm, hoặc host có hai luồng DM) để canh LỚP PHÒNG THỦ còn lại: kể cả
  // khi hai id khác nhau, câu trung tính vẫn không được gửi bằng kiểu NHÓM.
  // Không có bài này thì nhánh đó KHÔNG có ai canh.
  const db = dbTam();
  upsertConversation(db, { chatId: DM_KHAC, loai: 'DM', ten: 'Host 2', duocNghe: true });
  tin(db, DM_KHAC, 'd2');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api, {
    // config khai DM của HOST là `DM`, nhưng anh lại nhắn từ `DM_KHAC`.
    hosts: [{ userId: HOST, ten: 'Anh', dmChatId: DM }],
    huong: { huong: HUONG_TRA_LOI.DM_HOST, coCheo: true, nguonLa: [NHOM], lyDo: 'có nguồn lạ' },
  });
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { chatIdHoi: DM_KHAC, msgId: 'd2' }),
    text: 'đáp án',
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra.length, 2, 'phải có đáp án (DM host) + câu trung tính (nơi hỏi)');
  assert.equal(ra[1].id, DM_KHAC);
  assert.equal(ra[1].loaiThread, ThreadType.User,
    `câu trung tính gửi bằng ${ten(ra[1].loaiThread)} vào một DM -> Zalo từ chối`);
  closeDb(db);
});

test('★★ B3 hỏi trong NHÓM, đáp án chéo -> câu trung tính vào nhóm bằng Group (giữ nguyên)', async () => {
  const db = dbTam();
  tin(db, NHOM, 'g1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api, {
    huong: { huong: HUONG_TRA_LOI.DM_HOST, coCheo: true, nguonLa: ['999'], lyDo: 'có nguồn lạ' },
  });
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { chatIdHoi: NHOM, msgId: 'g1' }), text: 'đáp án',
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra.length, 2);
  assert.equal(ra[0].loaiThread, ThreadType.User, 'đáp án đi DM host');
  assert.equal(ra[1].loaiThread, ThreadType.Group, 'câu trung tính đi vào NHÓM');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// C — TAG trong DM: DM KHÔNG CÓ cơ chế mention
// ═══════════════════════════════════════════════════════════════════════

test('★★★ C1 `groupMembers` với một chat DM KHÔNG rỗng — nó trả về chính host', () => {
  // Đây là cái bẫy: ai cũng tưởng DM thì danh sách rỗng nên `ensureMention` vô hại.
  // Đo thật thì nó trả `[{uid: host, ten: 'Chủ máy'}]`.
  const db = dbTam();
  tin(db, DM, 'd1');
  const ds = groupMembers(db, DM);
  assert.equal(ds.length, 1, 'nếu ca này thành rỗng thì bài C2 mất lý do tồn tại — đọc lại trước khi sửa');
  assert.equal(ds[0].uid, HOST);
  closeDb(db);
});

test('★★★ C2 `ensureMention` CHÈN "@Tên" dạng chữ trần — nên KHÔNG được chạy cho DM', () => {
  const db = dbTam();
  tin(db, DM, 'd1');
  const kq = ensureMention('Dạ em trả lời anh', groupMembers(db, DM), [HOST], null);
  assert.match(kq.text, /^@Chủ máy /,
    'bài này ghi lại HÀNH VI THẬT của ensureMention — nó chèn chữ, không tự biết DM');
  closeDb(db);
});

test('★★★ C3 trả lời trong DM -> KHÔNG chèn "@Tên", KHÔNG kèm mentions', async () => {
  // `UserMessage` của zca-js không có trường `mentions`, và `send.js` chỉ dựng
  // mentions khi thread là Group ⇒ chuỗi "@Chủ máy " chèn vào DM là CHỮ TRẦN.
  // Anh sẽ nhận "@Chủ máy Dạ em trả lời anh" trong tin nhắn riêng.
  const db = dbTam();
  tin(db, DM, 'd1');
  // Lượt NHẮC trong DM: đây là ca duy nhất `can.uids` không rỗng.
  createFollowUp(db, {
    chatIdDich: DM, loaiDich: 'DM', noiDung: 'theo dõi vụ X', dienGiaiGoc: 'x',
    dienGiaiXacNhan: 'y', nguoiDat: HOST, chatIdDat: DM, ma: 'N1', nguoiPhuTrach: HOST,
  });
  confirmSchedule(db, { id: 'N1', ma: 'N1', nguoiDat: HOST });
  const idNhac = db.prepare("SELECT id FROM lich_hen WHERE ma_xac_nhan='N1'").get().id;
  // Token quyền gửi — `bo_chay` đặt nó TRƯỚC khi giao việc cho model. Thiếu nó
  // thì `tra_loi` từ chối (chốt chống một-lượt-hai-tin), tức dựng thiếu một
  // trạng thái mà production LUÔN tạo ra.
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(Date.now(), idNhac);

  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { msgId: `nhac:${idNhac}:0` }),
    text: 'Anh ơi vụ X sao rồi ạ',
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.doesNotMatch(ra[0].msg, /@Chủ máy/,
    'chèn "@Tên" vào DM = chữ trần vô nghĩa, không tag được ai, trông như trợ lý hỏng');
  assert.equal(ra[0].mentions, undefined, 'DM không có cơ chế mention');
  assert.equal(ra[0].loaiThread, ThreadType.User);
  closeDb(db);
});

test('★★ C4 trả lời trong NHÓM vẫn cưỡng chế tag như cũ (chống hồi quy)', async () => {
  const db = dbTam();
  tin(db, NHOM, 'g1');
  createFollowUp(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'theo dõi vụ Y', dienGiaiGoc: 'x',
    dienGiaiXacNhan: 'y', nguoiDat: HOST, chatIdDat: NHOM, ma: 'N2', nguoiPhuTrach: HOST,
  });
  confirmSchedule(db, { id: 'N2', ma: 'N2', nguoiDat: HOST });
  const idNhac = db.prepare("SELECT id FROM lich_hen WHERE ma_xac_nhan='N2'").get().id;
  // Token quyền gửi — `bo_chay` đặt nó TRƯỚC khi giao việc cho model. Thiếu nó
  // thì `tra_loi` từ chối (chốt chống một-lượt-hai-tin), tức dựng thiếu một
  // trạng thái mà production LUÔN tạo ra.
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = ? WHERE id = ?').run(Date.now(), idNhac);

  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { chatIdHoi: NHOM, msgId: `nhac:${idNhac}:0` }),
    text: 'Anh ơi vụ Y sao rồi ạ',
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(ra[0].msg, /@Chủ máy/, 'bỏ cưỡng chế tag trong nhóm = lời nhắc không tag được ai');
  assert.ok(Array.isArray(ra[0].mentions) && ra[0].mentions.length === 1);
  closeDb(db);
});

test('★★★ C5 LỚP 1/3 — `reminderTagUids` đã tự trả rỗng cho DM', () => {
  // 🔴 BA LỚP CHE NHAU. Chống tag-trong-DM hiện có BA lớp độc lập, và gỡ MỘT
  // lớp thì hai lớp kia vẫn chặn ⇒ đột biến sống sót, trông như thiếu test.
  // Ba bài C5/C6/C7 tách từng lớp ra canh riêng.
  //   · lớp 1 (đây)  — tầng truy vấn không trả uid nào cho một lời nhắc DM
  //   · lớp 2 (C6)   — `_traLoi` không chạy cưỡng chế tag khi đích là DM
  //   · lớp 3 (C7)   — `send.js` không dựng mentions khi thread là User
  const db = dbTam();
  createFollowUp(db, {
    chatIdDich: DM, loaiDich: 'DM', noiDung: 'v', dienGiaiGoc: 'x', dienGiaiXacNhan: 'y',
    nguoiDat: HOST, chatIdDat: DM, ma: 'N9', nguoiPhuTrach: HOST, tagUserIds: [HOST2],
  });
  const id = db.prepare("SELECT id FROM lich_hen WHERE ma_xac_nhan='N9'").get().id;
  assert.deepEqual(reminderTagUids(db, id).uids, [],
    'trả uid cho một lời nhắc DM thì tầng trên sẽ dựng chữ "@Tên" thừa');
  closeDb(db);
});

test('★★★ C6 LỚP 2/3 — trong DM KHÔNG chạy cưỡng chế tag, nên KHÔNG có cảnh báo tag', async () => {
  // Model viết "@Ai Đó" trong DM. Nếu `_traLoi` vẫn chạy `ensureMention` thì nó sinh
  // cảnh báo "@Ai Đó không khớp ai trong nhóm — người được nhắc KHÔNG nhận thông
  // báo". Câu đó VÔ NGHĨA trong DM (ở đó không tag được ai, kể cả người có thật),
  // và cảnh báo sai lặp lại là thứ làm model thôi tin cả cảnh báo đúng.
  const db = dbTam();
  tin(db, DM, 'd1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: '@Ai Đó ơi cho em hỏi' });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.duLieu.canhBao, undefined, `cảnh báo tag vô nghĩa trong DM: ${JSON.stringify(r.duLieu.canhBao)}`);
  assert.deepEqual(r.duLieu.tag.khongKhop, []);
  assert.equal(ra[0].loaiThread, ThreadType.User);
  closeDb(db);
});

test('★★ C6b đối chiếu: trong NHÓM thì "@Ai Đó" VẪN phải sinh cảnh báo', async () => {
  const db = dbTam();
  tin(db, NHOM, 'g1');
  const { api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { chatIdHoi: NHOM, msgId: 'g1' }), text: '@Ai Đó ơi cho em hỏi',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Array.isArray(r.duLieu.canhBao) && r.duLieu.canhBao.length,
    'mất cảnh báo trong nhóm = model tưởng đã tag được người ta, mà thật ra chỉ là chữ');
  closeDb(db);
});

test('★★★ C7 LỚP 3/3 — `sendHostDm` KHÔNG dựng mentions dù có ĐỦ danh sách người', async () => {
  // Gọi thẳng tầng gửi với `dsNguoi` đầy đủ — bỏ qua hai lớp trên. Đây là ca
  // duy nhất tách được lớp cuối: nếu `send.js` bỏ điều kiện ThreadType thì nó
  // sẽ nhét `mentions` vào một tin DM, mà zca-js bỏ hết mentions trong DM ⇒
  // vừa thừa dữ liệu vừa che mất lỗi thật.
  const { tin: ra, api } = banGui();
  await sendHostDm(api, DM, '@Chủ máy ơi', { dsNguoi: [{ uid: HOST, ten: 'Chủ máy' }] });
  assert.equal(ra.length, 1);
  assert.equal(ra[0].loaiThread, ThreadType.User);
  assert.equal(ra[0].mentions, undefined, 'dựng mentions cho một thread DM là dữ liệu thừa gửi lên Zalo');

  // Đối chiếu: cùng dữ liệu đó vào NHÓM thì PHẢI có mentions.
  await sendToGroup(api, NHOM, '@Chủ máy ơi', { dsNguoi: [{ uid: HOST, ten: 'Chủ máy' }] });
  assert.ok(Array.isArray(ra[1].mentions) && ra[1].mentions.length === 1,
    'mất mentions trong nhóm = lời nhắc chỉ còn là chữ, không ai nhận thông báo');
});

test('★★★ C8 khi đích là DM, `_traLoi` KHÔNG truyền dsNguoi xuống tầng gửi', async () => {
  // Lớp giữa `_guiTheoChinhSach`: `_tuyChonGui(kho, db, api, laDm ? null : chatId)`.
  // Tách bằng cách rình đúng tham số `tuyChon` mà tầng gửi nhận được.
  const db = dbTam();
  tin(db, DM, 'd1');
  const bat = [];
  const api = { getOwnId: () => 'uid-bot', async sendMessage() { return { message: { msgId: 'm1' } }; } };
  let xuLy;
  registerTools({
    setRequestHandler(s2, f) { if (s2?.shape?.method?.value === 'tools/call') xuLy = f; },
  }, {
    db,
    api,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Anh', dmChatId: DM }],
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [], xoa() {}, soPhien: () => 0 },
    guiTin: {
      sendToGroup: async (_a, _c, _t, tc) => { bat.push({ duong: 'nhom', tc }); return { msgId: 'm' }; },
      sendHostDm: async (_a, _c, _t, tc) => { bat.push({ duong: 'dm', tc }); return { msgId: 'm' }; },
    },
  });
  const goi = async (n, a) => JSON.parse((await xuLy({ params: { name: n, arguments: a } })).content[0].text);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'dạ' });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bat[0].duong, 'dm', 'phải đi đường DM');
  assert.equal(bat[0].tc.laDm, true);
  assert.equal(bat[0].tc.dsNguoi, undefined,
    'truyền danh sách người xuống một tin DM là dựa hoàn toàn vào lớp cuối của send.js');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// D — ĐƯỜNG LỊCH / NHẮC vào DM (đường anh sẽ dùng nhiều)
// ═══════════════════════════════════════════════════════════════════════

test('★★★ D1 lịch MỘT LẦN vào DM -> bộ chạy gửi bằng ThreadType.User', async () => {
  const db = dbTam();
  createSchedule(db, {
    chatIdDich: DM, loaiDich: 'DM', noiDung: 'uống thuốc', guiLucMs: Date.now() - 1000,
    dienGiaiGoc: 'x', dienGiaiXacNhan: 'y', nguoiDat: HOST, chatIdDat: DM, ma: 'L1',
  });
  confirmSchedule(db, { id: 'L1', ma: 'L1', nguoiDat: HOST });
  const { tin: ra, api } = banGui();
  await runOneTick({
    db, api, sendToGroup, sendHostDm, groupMembers: () => [], bayGioMs: Date.now(),
  });
  assert.equal(ra.length, 1, 'lịch tới hạn mà không gửi gì = hỏng CÂM');
  assert.equal(ra[0].loaiThread, ThreadType.User, `gửi bằng ${ten(ra[0].loaiThread)}`);
  closeDb(db);
});

test('★★★ D2 nhắc THEO ĐUỔI vào DM -> gửi bằng ThreadType.User', async () => {
  const db = dbTam();
  createFollowUp(db, {
    chatIdDich: DM, loaiDich: 'DM', noiDung: 'theo dõi vụ X', dienGiaiGoc: 'x',
    dienGiaiXacNhan: 'y', nguoiDat: HOST, chatIdDat: DM, ma: 'N1', nguoiPhuTrach: HOST,
  });
  confirmSchedule(db, { id: 'N1', ma: 'N1', nguoiDat: HOST });
  db.prepare("UPDATE lich_hen SET gui_luc_ms = 1 WHERE ma_xac_nhan = 'N1'").run();

  const { tin: ra, api } = banGui();
  await runFollowUpTick({
    db, api, sendToGroup, sendHostDm, groupMembers: () => [], bayGioMs: Date.now(), enqueueQuestion,
  });
  assert.equal(ra.length, 1);
  assert.equal(ra[0].loaiThread, ThreadType.User, `gửi bằng ${ten(ra[0].loaiThread)}`);
  closeDb(db);
});

test('★★★ D3 đặt lịch TỪ DM qua tool thật -> DB ghi loai_dich = DM', async () => {
  // Bộ chạy chọn kiểu luồng theo `loai_dich`. Nếu tool ghi nhầm 'GROUP' thì
  // tới giờ gửi mới hỏng — hỏng CÂM, cách lúc đặt hàng giờ.
  const db = dbTam();
  tin(db, DM, 'd1');
  const { api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL_LICH.DAT_LICH_NHAP, {
    request_id: phien(db),
    guiLuc: new Date(Date.now() + 3_600_000).toISOString(),
    noiDung: 'uống thuốc', dienGiaiGoc: 'nhắc anh 9h uống thuốc',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(db.prepare('SELECT loai_dich l FROM lich_hen ORDER BY rowid DESC LIMIT 1').get().l, 'DM');
  closeDb(db);
});

test('★★★ D4 đặt nhắc THEO ĐUỔI từ DM -> loai_dich = DM', async () => {
  const db = dbTam();
  tin(db, DM, 'd1');
  const { api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: phien(db), noiDung: 'theo dõi vụ X', dienGiaiGoc: 'theo dõi giúp anh',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(db.prepare('SELECT loai_dich l FROM lich_hen ORDER BY rowid DESC LIMIT 1').get().l, 'DM');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E — nguồn nhận dạng DM, và các lớp KHÁC không được đụng
// ═══════════════════════════════════════════════════════════════════════

test('★★★ E1 `conversationKind` — có dòng thì trả loại, không có dòng thì null', () => {
  const db = dbTam();
  assert.equal(conversationKind(db, DM), 'DM');
  assert.equal(conversationKind(db, NHOM), 'GROUP');
  assert.equal(conversationKind(db, '404404404'), null,
    'null (không có dòng) phải KHÁC "UNKNOWN" (có dòng mà chưa biết) — người gọi cần phân biệt');
  closeDb(db);
});

test('★★★ E2 chưa có dòng `hoi_thoai` -> LÙI VỀ CONFIG, vẫn gửi đúng DM', async () => {
  // Ca thật: DB vừa dựng lại, hoặc host DM lần đầu và tin chưa kịp ghi.
  // Không có đường lùi thì lượt đầu tiên sau mỗi lần dựng DB lại hỏng y như cũ.
  const db = dbTam();
  db.prepare('DELETE FROM hoi_thoai WHERE chat_id = ?').run(DM);
  assert.equal(conversationKind(db, DM), null, 'dựng sai tiền đề thì bài này vô nghĩa');

  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api);
  const r = await goi(TEN_TOOL.TRA_LOI, { request_id: phien(db), text: 'Dạ em trả lời anh' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra[0].loaiThread, ThreadType.User, 'config có `hosts[].dmChatId` mà vẫn gửi kiểu nhóm');
  closeDb(db);
});

test('★★ E3 không tra ra loại ở CẢ HAI nguồn -> giữ hành vi cũ (NHÓM), không nổ', async () => {
  const db = dbTam();
  upsertConversation(db, { chatId: '404404404', loai: 'UNKNOWN', ten: null, duocNghe: true });
  tin(db, '404404404', 'u1');
  const { tin: ra, api } = banGui();
  const goi = dungTool(db, api, {
    huong: { huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' },
  });
  const r = await goi(TEN_TOOL.TRA_LOI, {
    request_id: phien(db, { chatIdHoi: '404404404', msgId: 'u1' }), text: 'x',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ra[0].loaiThread, ThreadType.Group,
    'mặc định phải giữ nguyên hành vi cũ — đổi sang DM là làm hỏng mọi nhóm chưa kịp có dòng hoi_thoai');
  closeDb(db);
});

test('★★★ E4 gate: DM KHÔNG cần tag mới kích hoạt, NHÓM thì CẦN', () => {
  // Trợ lý tự khai với anh là "DM thì không cần tag". Bài này XÁC MINH câu đó
  // bằng code, ⛔ không tin lời nó nói.
  const ch = {
    hosts: [{ userId: HOST, ten: 'Anh', dmChatId: DM }],
    groups: [{ chatId: NHOM, ten: 'N', traLoiKhiTag: true }],
  };
  const t = (chatId) => ({ chatId, userId: HOST, tuToi: false, hasHostMention: false, msgType: 'chat.text', noiDung: 'hi' });
  assert.equal(quyetDinh(t(DM), ch).action, 'allow', 'DM đòi tag = đóng cửa vĩnh viễn (UserMessage không có mentions)');
  assert.equal(quyetDinh(t(NHOM), ch).action, 'drop', 'nhóm mà không cần tag = trợ lý chen vào mọi câu chuyện');
});

test('★★★ E5 leak_guard: DM là MỘT NGUỒN RIÊNG, không lẫn với nhóm', () => {
  // Đọc lịch sử nhóm rồi trả lời trong DM ⇒ vẫn là chéo nguồn. Và đọc lịch sử
  // của CHÍNH DM đó thì KHÔNG chéo.
  const cheo = decideReplyRoute({ requestId: 'r', chatIdHoi: DM, nguon: [NHOM], tonTaiHangDoi: true });
  assert.equal(cheo.huong, HUONG_TRA_LOI.DM_HOST);
  assert.deepEqual(cheo.nguonLa, [NHOM]);

  const sach = decideReplyRoute({ requestId: 'r', chatIdHoi: DM, nguon: [DM], tonTaiHangDoi: true });
  assert.equal(sach.huong, HUONG_TRA_LOI.NHOM, 'đọc lịch sử của chính DM đó KHÔNG phải chéo nguồn');
  assert.deepEqual(sach.nguonLa, []);
});
