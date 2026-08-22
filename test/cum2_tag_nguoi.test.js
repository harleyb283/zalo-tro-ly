/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 2 — TAG NGƯỜI. A2 · A3 · A9 · B4 · A11.
 *
 * Sinh từ hai triệu chứng THẬT tối 20/08/2026:
 *   · lời nhắc bắn đúng nhịp nhưng KHÔNG TAG AI — "Trọng ơi, vụ cuối tuần nhậu…"
 *     là chữ trần. Anh: *"mày chưa tag người vào kìa"*
 *   · và trước đó là TAG ĐÔI — "@Trọng Nguyễn @Trọng Nguyễn ơi…". Anh cũng phàn nàn.
 *
 * 🔴 LUẬT VIẾT BÀI CHO CỤM NÀY:
 *    Mention là thứ chỉ tồn tại ở TẦNG GỬI (`api.sendMessage({mentions})`). Một
 *    bài chỉ kiểm CHUỖI có chứa "@Tên" là bài GIẢ: chuỗi có @ mà mention rỗng
 *    thì người được nhắc KHÔNG nhận thông báo — đúng cái đang vá.
 *    ⇒ Mọi bài ở đây bắt `api.sendMessage` THẬT và soi mảng `mentions`.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import { ghiTin, taoHangDoi, upsertHoiThoai } from '../src/store/write.js';
import { truyVanLichSu } from '../src/store/query.js';
import { HUONG_TRA_LOI, TEN_TOOL, TEN_TOOL_NHAC, TRANG_THAI_HANG_DOI } from '../src/lib/hang_so.js';
import { chotLich } from '../src/lich/lich_hen.js';
import { taoNhacTheoDuoi } from '../src/lich/theo_duoi.js';
import { chayNhipTheoDuoi } from '../src/lich/bo_chay.js';
import { dangKyTool } from '../src/mcp/tools.js';
import { datLaiThrottle, datThrottle, guiVaoNhom, guiDmHost } from '../src/zalo/send.js';

const NHOM = '9990000000001';
const HOST = '555000111';
const TRONG = '9991000000000000001';
const IM_LANG = '9994000000000000004';   // người CHƯA TỪNG nhắn trong nhóm

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

/** DB thật + vài tin để `dsNguoiTrongNhom` có người tra. */
function dbTam({ tenTrong = 'Trọng Nguyễn' } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum2-'));
  RAC.push(d);
  const db = moDb(path.join(d, 'kho', 'lichsu.db'));
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  const tin = (msgId, userId, ten, ts) => ghiTin(db, {
    chatId: NHOM, msgId, cliMsgId: null, userId, tenLucGui: ten,
    msgType: 'chat.text', noiDung: 'nói gì đó', contentRaw: null,
    tsZalo: ts, tuToi: false, coTagHost: false,
  });
  tin('m-host', HOST, 'Minh Hải', 1_700_000_000_000);
  tin('m-trong', TRONG, tenTrong, 1_700_000_001_000);
  return db;
}

/** Ghi thêm một tin MỚI HƠN để đổi tên hiển thị (dsNguoiTrongNhom lấy tin mới nhất). */
function doiTen(db, userId, tenMoi) {
  ghiTin(db, {
    chatId: NHOM, msgId: `m-doiten-${tenMoi}`, cliMsgId: null, userId, tenLucGui: tenMoi,
    msgType: 'chat.text', noiDung: 'đổi tên rồi', contentRaw: null,
    tsZalo: 1_800_000_000_000, tuToi: false, coTagHost: false,
  });
}

function taoNhac(db, v = {}) {
  const ma = v.ma ?? 'NHAC';
  taoNhacTheoDuoi(db, {
    chatIdDich: NHOM, loaiDich: 'GROUP', noiDung: 'chốt giúp địa điểm',
    dienGiaiGoc: 'nhắc tới khi xong', dienGiaiXacNhan: 'câu đọc lại',
    nguoiDat: HOST, chatIdDat: NHOM, ma, ...v,
  });
  chotLich(db, { id: ma, ma, nguoiDat: HOST });
  return db.prepare('SELECT * FROM lich_hen WHERE ma_xac_nhan = ?').get(ma);
}

/**
 * Gọi tool THẬT với phụ thuộc THẬT. `api.sendMessage` là chỗ duy nhất giả —
 * để bắt được `mentions`, thứ mà không tầng nào ở trên nhìn thấy.
 */
function dungTool(db, { hosts = [{ userId: HOST, ten: 'Anh', dmChatId: 'dm-host' }] } = {}) {
  const daGui = [];
  const api = {
    getOwnId: () => 'uid-bot',
    async sendMessage(noiDung, threadId, loai) {
      daGui.push({ noiDung, threadId, loai });
      return { message: { msgId: `m${daGui.length}` } };
    },
  };
  let xuLy;
  const server = {
    setRequestHandler(schema, fn) {
      if (schema?.shape?.method?.value === 'tools/call') xuLy = fn;
    },
  };
  dangKyTool(server, {
    db,
    cauHinh: {
      cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
      hosts,
      groups: [{ chatId: NHOM, ten: 'Nhóm thử', ghiLichSu: true, traLoiKhiTag: true }],
    },
    boTichLuy: { ghiNhan() {}, lay: () => [NHOM], xoa() {}, soPhien: () => 0 },
    api,
    docSucKhoe: () => ({ trangThai: 'OK' }),
    guiTin: { guiVaoNhom, guiDmHost },        // ★ tầng gửi THẬT -> mentions THẬT
    chinhSach: {
      decideReplyRoute: () => ({ huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' }),
    },
  });
  const goi = async (name, args) => {
    const r = await xuLy({ params: { name, arguments: args } });
    return JSON.parse(r.content[0].text);
  };
  return { goi, daGui };
}

function phienNhac(db, idNhac, requestId = 'req-nhac') {
  // ⚠️ PHẢI đặt `cho_model_tu_ms` — production luôn đặt nó TRƯỚC khi tạo hàng đợi
  // (`bo_chay.js`). Đó là TOKEN quyền gửi: thiếu nó thì `tra_loi` từ chối, và từ
  // chối là ĐÚNG (nghĩa là lưới an toàn đã gửi câu dự phòng rồi). Helper dựng
  // thiếu token là dựng một trạng thái production KHÔNG tạo ra được.
  db.prepare('UPDATE lich_hen SET cho_model_tu_ms = $t WHERE id = $id')
    .run({ t: Date.now(), id: String(idNhac) });
  taoHangDoi(db, {
    requestId, chatIdHoi: NHOM, msgId: `nhac:${idNhac}:0`,
    userId: HOST, noiDung: '[LỜI NHẮC…]', tsTao: new Date().toISOString(),
  });
  return requestId;
}

let throttleCu;
test.before(() => { throttleCu = datThrottle({ minKhoangCachMs: 0, toiDaMoiPhut: 100000 }); });
test.after(() => { datThrottle(throttleCu); datLaiThrottle(); });

// ═══════════════════════════════════════════════════════════════════════
// T2a — A2: tool nhận được tag, và câu xác nhận NÓI RÕ
// ═══════════════════════════════════════════════════════════════════════

test('T2a ★★★ dat_nhac_theo_duoi nhận tagUserIds + nguoiPhuTrach -> DB có CẢ HAI, câu xác nhận in "Tag"', async () => {
  const db = dbTam();
  const { goi } = dungTool(db);
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm-host', userId: HOST,
    noiDung: 'nhắc Trọng nhé', tsTao: new Date().toISOString(),
  });

  const kq = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: 'r1', noiDung: 'chốt địa điểm', dienGiaiGoc: 'nhắc tới khi xong',
    nguoiPhuTrach: TRONG, tagUserIds: [HOST], chuKyPhut: 3,
  });
  assert.equal(kq.ok, true, JSON.stringify(kq));

  const d = db.prepare('SELECT * FROM lich_hen WHERE id = ?').get(kq.duLieu.id);
  assert.equal(String(d.nguoi_phu_trach), TRONG, 'nguoi_phu_trach không được lưu');
  assert.deepEqual(JSON.parse(d.tag_user_ids), [HOST],
    'tag_user_ids RỖNG = đúng lỗi cũ: tool có tham số mà không truyền xuống');

  assert.match(kq.duLieu.cauXacNhan, /Tag mỗi lượt: .*@Trọng Nguyễn/,
    'câu xác nhận phải cho anh thấy sẽ tag AI trước khi anh gõ "ok"');
  dongDb(db);
});

test('T2a-2 ★★★ THIẾU cả hai -> câu xác nhận PHẢI cảnh báo "KHÔNG TAG AI"', async () => {
  const db = dbTam();
  const { goi } = dungTool(db);
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm-host', userId: HOST,
    noiDung: 'nhắc vụ kia', tsTao: new Date().toISOString(),
  });

  const kq = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: 'r1', noiDung: 'chốt địa điểm', dienGiaiGoc: 'nhắc tới khi xong', chuKyPhut: 3,
  });
  assert.equal(kq.ok, true, JSON.stringify(kq));
  assert.match(kq.duLieu.cauXacNhan, /KHÔNG TAG AI/,
    'anh gõ "ok" cho một lời nhắc chạy nhiều ngày mà không tag được ai — phải bắt được TRƯỚC');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T2b — A3: gói dữ kiện gửi model phải có TÊN và UID
// ═══════════════════════════════════════════════════════════════════════

test('T2b ★★★ đường (a): gói gửi model chứa TÊN HIỂN THỊ và UID người phụ trách', async () => {
  const db = dbTam();
  const nhac = taoNhac(db, { chuKyPhut: 3, nguoiPhuTrach: TRONG });
  db.prepare('UPDATE lich_hen SET gui_luc_ms = 1 WHERE id = ?').run(nhac.id);

  const goi = [];
  await chayNhipTheoDuoi({
    db, api: {}, bayGioMs: Date.now(), truyVanLichSu, taoHangDoi,
    guiVaoNhom: async () => ({ msgId: 'x' }),
    guiDmHost: async () => ({ msgId: 'y' }),
    dsNguoiTrongNhom: (d, c) => {
      const { dsNguoiTrongNhom } = require_ds();
      return dsNguoiTrongNhom(d, c);
    },
    guiThongBao: async (payload) => { goi.push(payload); return true; },
  });

  assert.equal(goi.length, 1, 'phải giao đúng một lượt cho model');
  assert.match(goi[0].noiDung, /Trọng Nguyễn/, 'model không được cho biết TÊN -> nó đoán, và đã đoán sai thật');
  assert.ok(goi[0].noiDung.includes(TRONG), 'phải có UID — uid mới là nguồn sự thật');
  dongDb(db);
});

/** import động cho gọn (query.js là read layer thật). */
function require_ds() {
  return dsNguoiCache;
}
let dsNguoiCache;
test.before(async () => { dsNguoiCache = await import('../src/store/query.js'); });

// ═══════════════════════════════════════════════════════════════════════
// T2c — A3 cưỡng chế + A9 chống tag đôi. CÙNG MỘT HÀM.
// ═══════════════════════════════════════════════════════════════════════

test('T2c ★★★ tra_loi: model QUÊN @Tên -> server TỰ tag đúng uid', async () => {
  const db = dbTam();
  const nhac = taoNhac(db, { chuKyPhut: 3, nguoiPhuTrach: TRONG });
  const req = phienNhac(db, nhac.id);
  const { goi, daGui } = dungTool(db);

  const kq = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: 'Trọng ơi, chốt giúp em nhé!' });
  assert.equal(kq.ok, true, JSON.stringify(kq));

  assert.equal(daGui.length, 1);
  const mt = daGui[0].noiDung.mentions ?? [];
  assert.equal(mt.length, 1, 'model viết chữ trần mà server không tag -> đúng triệu chứng anh gặp');
  assert.equal(String(mt[0].uid), TRONG, 'tag nhầm người còn tệ hơn không tag');
  dongDb(db);
});

test('T2c-2 ★★★ tra_loi: model ĐÃ tự viết @Tên -> ĐÚNG MỘT mention, không nhân đôi', async () => {
  const db = dbTam();
  const nhac = taoNhac(db, { chuKyPhut: 3, nguoiPhuTrach: TRONG });
  const req = phienNhac(db, nhac.id);
  const { goi, daGui } = dungTool(db);

  const kq = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: '@Trọng Nguyễn ơi, chốt giúp em nhé!' });
  assert.equal(kq.ok, true, JSON.stringify(kq));

  const msg = daGui[0].noiDung.msg;
  const mt = daGui[0].noiDung.mentions ?? [];
  assert.equal(mt.length, 1, `tag ${mt.length} lần — anh đã phàn nàn đúng chuyện này`);
  assert.equal((msg.match(/@Trọng Nguyễn/g) ?? []).length, 1,
    `chữ "@Trọng Nguyễn" xuất hiện ${(msg.match(/@Trọng Nguyễn/g) ?? []).length} lần trong tin`);
  assert.deepEqual(kq.duLieu.tag.daCoSan, [TRONG], 'phải nhận ra model đã tự tag rồi');
  assert.deepEqual(kq.duLieu.tag.daThem, [], 'không được chèn thêm');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T2d — B4: đổi tên hiển thị
// ═══════════════════════════════════════════════════════════════════════

test('T2d ★★★ đổi tên hiển thị: mention VẪN đúng uid, và @tên-cũ không khớp ai thì CÓ CẢNH BÁO ĐI RA', async () => {
  const db = dbTam({ tenTrong: 'Trọng Nguyễn' });
  // Người đó đổi tên hiển thị sang một tên KHÔNG còn khớp tiền tố tên cũ.
  doiTen(db, TRONG, 'Nguyễn Văn T');
  const nhac = taoNhac(db, { chuKyPhut: 3, nguoiPhuTrach: TRONG });
  const req = phienNhac(db, nhac.id);
  const { goi, daGui } = dungTool(db);

  // Model viết theo TÊN CŨ (đóng băng trong nội dung lời nhắc từ mấy hôm trước).
  const kq = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: '@Trọng Nguyễn ơi, chốt giúp em nhé!' });
  assert.equal(kq.ok, true, JSON.stringify(kq));

  const mt = daGui[0].noiDung.mentions ?? [];
  assert.equal(mt.length, 1, 'uid là nguồn sự thật -> vẫn phải tag được dù tên đã đổi');
  assert.equal(String(mt[0].uid), TRONG);

  assert.deepEqual(kq.duLieu.tag.khongKhop, ['Trọng'],
    '"@Trọng Nguyễn" không khớp ai mà đi qua IM LẶNG -> đúng lỗi câm B4');
  assert.ok(Array.isArray(kq.duLieu.canhBao) && kq.duLieu.canhBao.some((c) => /KHÔNG khớp ai/.test(c)),
    'cảnh báo phải ĐI RA theo kết quả tool — stderr thì không ai đọc');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T2e — A11: người chưa từng nhắn trong nhóm
// ═══════════════════════════════════════════════════════════════════════

test('T2e ★★★ uid CHƯA TỪNG nhắn -> tool TRẢ VỀ "không tag được", câu xác nhận nói rõ', async () => {
  const db = dbTam();
  const { goi } = dungTool(db);
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm-host', userId: HOST,
    noiDung: 'nhắc anh Quyết', tsTao: new Date().toISOString(),
  });

  const kq = await goi(TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, {
    request_id: 'r1', noiDung: 'gửi báo giá', dienGiaiGoc: 'nhắc tới khi xong',
    nguoiPhuTrach: IM_LANG, chuKyPhut: 3,
  });
  assert.equal(kq.ok, true, JSON.stringify(kq));

  assert.deepEqual(kq.duLieu.tagKhongTraRa, [IM_LANG],
    'trước đây chuyện này chỉ đi vào stderr của tiến trình nền — KHÔNG AI ĐỌC');
  assert.match(kq.duLieu.cauXacNhan, /Chưa tag được uid/,
    'anh phải thấy điều này TRƯỚC khi gõ "ok"');
  assert.match(kq.duLieu.nhac, /chưa tag được uid/i, 'phải dặn model nói lại cho anh');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// T2f — chứng minh KHÔNG CÒN BẢN SAO LUẬT
// ═══════════════════════════════════════════════════════════════════════

test('T2f ★★★ HAI đường gửi dùng CHUNG một luật: cùng nội dung + cùng uid -> cùng kết quả', async () => {
  // 🔴 CANH HÀNH VI, KHÔNG CANH VĂN BẢN.
  // Bản đầu của bài này quét `@${...}` trong src/ để đòi "chỉ một chỗ dựng chuỗi @".
  // Nó ĐỎ OAN ở `lich_hen.js` và `tools.js` — hai chỗ đó chỉ in `@Tên` vào CÂU XÁC
  // NHẬN cho anh đọc, không phải dựng mention. Canh văn bản kiểu đó là đúng cái bẫy
  // `ref_validator_false_alarm_traps`: kêu oan vài lần là người ta tắt bài test đi.
  // ⇒ Thay bằng: chứng minh HAI đường gửi (dự phòng do code dựng, và đường model
  //   qua `tra_loi`) cho ra CÙNG một kết quả tag. Chung kết quả = chung luật.
  const db = dbTam();
  const nhac = taoNhac(db, { chuKyPhut: 3, nguoiPhuTrach: TRONG });
  const { dsNguoiTrongNhom } = dsNguoiCache;
  const dsNguoi = dsNguoiTrongNhom(db, NHOM);

  const { dungNoiDung } = await import('../src/lich/bo_chay.js');
  const CAU = '@Trọng Nguyễn ơi, chốt giúp em nhé!';

  // Đường (b) — code dựng câu dự phòng.
  const duongB = dungNoiDung({ noiDung: CAU, dsNguoi, tagUserIds: [TRONG] });
  assert.equal((duongB.text.match(/@Trọng Nguyễn/g) ?? []).length, 1,
    'đường dự phòng vẫn nhân đôi -> nó chưa dùng chung luật');
  assert.deepEqual(duongB.daCoSan, [TRONG]);

  // Đường (a) — model viết, `tra_loi` cưỡng chế.
  const req = phienNhac(db, nhac.id);
  const { goi, daGui } = dungTool(db);
  const kq = await goi(TEN_TOOL.TRA_LOI, { request_id: req, text: CAU });
  assert.equal(kq.ok, true, JSON.stringify(kq));

  assert.equal(daGui[0].noiDung.msg, duongB.text,
    'hai đường cho ra hai câu KHÁC nhau -> vẫn còn hai bản sao của luật');
  assert.deepEqual(kq.duLieu.tag.daCoSan, duongB.daCoSan, 'hai đường phải kết luận giống nhau');
  dongDb(db);
});
