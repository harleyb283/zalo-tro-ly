/**
 * ═══════════════════════════════════════════════════════════════════════
 * v13 — ĐỌC ẢNH VÀ FILE VĂN BẢN (anh chốt 17/09/2026).
 *
 * 🔴 SỢI CHỈ CHUNG: tính năng này nhận DỮ LIỆU TỪ BÊN NGOÀI (một URL do Zalo
 *    cấp) rồi GHI RA ĐĨA và sau đó XOÁ. Ba động tác đó, mỗi cái đều có một kiểu
 *    hỏng câm riêng, và bài ở đây đo đúng từng cái:
 *      · nhận  -> tải nhầm chỗ ⇒ lộ ảnh của người trong nhóm ra khỏi Zalo
 *      · ghi   -> không có trần ⇒ một file khổng lồ treo daemon, ⛔ không ai biết
 *      · xoá   -> đường dẫn tính từ biến ⇒ xoá nhầm thư mục thật (ĐÃ XẢY RA)
 *
 * ⚠️ Ba ràng buộc anh chốt, mỗi cái phải có ít nhất một bài canh:
 *    1. CHỈ tin nhắn riêng của host   -> A1, A2, D1
 *    2. Tải về đọc xong XOÁ            -> C1, C2
 *    3. Chữ đọc được thì LƯU vào kho   -> B1, B2, D2
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  duocPhepDocMedia, layMediaTuTin, phanLoai, taiVeTam, xoaFileTam, donFileCu,
  thuMucTam, GIOI_HAN_MEDIA,
} from '../src/zalo/media.js';
import { closeDb, openDb } from '../src/store/db.js';
import { upsertConversation, writeMessage, writeMediaText } from '../src/store/write.js';
import { mediaMessage } from '../src/store/query.js';
import { registerTools } from '../src/mcp/tools.js';
import { TEN_TOOL_MEDIA, TRANG_THAI_HANG_DOI } from '../src/lib/hang_so.js';

const DM_HOST = '9990000000777';
const NHOM = '9990000000001';
const HOST = '555000111';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function thuMucTamThoi() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-media-'));
  RAC.push(d);
  return d;
}

function dbTam() {
  const d = thuMucTamThoi();
  const db = openDb(path.join(d, 'kho', 'lichsu.db'));
  upsertConversation(db, { chatId: DM_HOST, loai: 'DM', ten: 'DM của host', duocNghe: true });
  return { db, thuMuc: d };
}

const CAU_HINH = {
  hosts: [
    { userId: HOST, dmChatId: '9990000000888' },
    { userId: '9990000000777', dmChatId: DM_HOST },
  ],
  groups: [{ chatId: NHOM, ten: 'Nhóm thật' }],
};

/** Một tin ảnh như Zalo gửi tới, sau khi `normalize` đã bỏ bytes. */
const RAW_ANH = JSON.stringify({
  _msgTypeGoc: 'chat.photo',
  title: 'lich-hoc.jpg',
  href: 'https://zalo-cdn.example/anh/abc123.jpg',
  thumb: 'https://zalo-cdn.example/thumb/abc123.jpg',
});

// ═══════════════════════════════════════════════════════════════════════
// A. RÀNG BUỘC 1 — CHỈ TIN NHẮN RIÊNG CỦA HOST
// ═══════════════════════════════════════════════════════════════════════

test('A1 ★★★ chỉ DM của host được đọc media — nhóm thì KHÔNG', () => {
  assert.equal(duocPhepDocMedia(DM_HOST, CAU_HINH), true);
  assert.equal(duocPhepDocMedia('9990000000888', CAU_HINH), true);
  assert.equal(duocPhepDocMedia(NHOM, CAU_HINH), false,
    '🔴 nhóm có người ngoài — tải ảnh của họ về máy là đúng thứ anh cấm');
  assert.equal(duocPhepDocMedia('chat-la-hoac-trong', CAU_HINH), false);
  assert.equal(duocPhepDocMedia('', CAU_HINH), false);
});

test('A2 ★★ hỏi bằng userId thay vì dmChatId thì KHÔNG mở cửa (fail-closed)', () => {
  // userId và dmChatId TRÙNG NHAU ở Zalo cho phần lớn ca, nên rất dễ viết nhầm
  // điều kiện thành "userId là host" — và lúc đó MỌI nhóm mà host có mặt đều
  // lọt qua. Bài này khoá đúng chỗ dễ nhầm ấy.
  const ch = { hosts: [{ userId: 'u-rieng', dmChatId: 'dm-rieng' }] };
  assert.equal(duocPhepDocMedia('u-rieng', ch), false);
  assert.equal(duocPhepDocMedia('dm-rieng', ch), true);
});

// ═══════════════════════════════════════════════════════════════════════
// B. ĐỌC ĐƯỜNG TẢI RA KHỎI TIN
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★★ lấy được href + tên + loại; ưu tiên ảnh GỐC chứ không phải thumb', () => {
  const m = layMediaTuTin(RAW_ANH);
  assert.equal(m.url, 'https://zalo-cdn.example/anh/abc123.jpg');
  assert.equal(m.ten, 'lich-hoc.jpg');
  assert.equal(m.loai, 'anh');
});

test('B2 ★★★ TỪ CHỐI mọi thứ không phải http/https', () => {
  for (const xau of ['file:///etc/passwd', 'data:image/png;base64,AAAA', 'javascript:alert(1)']) {
    assert.equal(layMediaTuTin(JSON.stringify({ href: xau })), null,
      `'${xau}' phải bị từ chối — đây là đường tải một URL LẠ về máy`);
  }
  assert.equal(layMediaTuTin(null), null);
  assert.equal(layMediaTuTin('không-phải-json'), null);
  assert.equal(layMediaTuTin(JSON.stringify({ title: 'chỉ có mô tả' })), null);
});

test('B3 ★★ phân loại theo đuôi; đuôi lạ -> "khac" để caller TỪ CHỐI', () => {
  assert.equal(phanLoai('a.jpg'), 'anh');
  assert.equal(phanLoai('a.PNG'), 'anh');
  assert.equal(phanLoai('lich.csv'), 'van_ban');
  assert.equal(phanLoai('hd.pdf'), 'tai_lieu');
  assert.equal(phanLoai('la.exe'), 'khac', '⛔ đoán bừa rồi tải file lạ về máy là chuyện khác');
  assert.equal(phanLoai('không-có-đuôi'), 'khac');
});

// ═══════════════════════════════════════════════════════════════════════
// C. TẢI VỀ — TRẦN, VÀ XOÁ
// ═══════════════════════════════════════════════════════════════════════

test('C1 ★★★ tải về ghi đúng thư mục tạm, và XOÁ được', async () => {
  const goc = thuMucTamThoi();
  const thuMuc = path.join(goc, 'media_tam');
  const kq = await taiVeTam('https://x.test/a.jpg', thuMuc, {
    ten: 'a.jpg',
    fetchFn: async () => ({
      ok: true, headers: { get: () => '4' }, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }),
  });
  assert.equal(kq.ok, true);
  assert.equal(kq.soByte, 4);
  assert.ok(fs.existsSync(kq.duongDan));
  assert.equal(path.extname(kq.duongDan), '.jpg');
  assert.ok(kq.duongDan.startsWith(thuMuc), 'file PHẢI nằm trong thư mục tạm');

  assert.equal(xoaFileTam(kq.duongDan, thuMuc), true);
  assert.equal(fs.existsSync(kq.duongDan), false, 'ràng buộc 2 của anh: đọc xong là xoá');
});

test('C2 ★★★ TỪ CHỐI xoá file NGOÀI thư mục tạm (kiểm tiền tố trước khi rm)', () => {
  const goc = thuMucTamThoi();
  const thuMuc = path.join(goc, 'media_tam');
  fs.mkdirSync(thuMuc, { recursive: true });
  const nanNhan = path.join(goc, 'file-quan-trong.txt');
  fs.writeFileSync(nanNhan, 'dữ liệu thật');

  const goc2 = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    assert.equal(xoaFileTam(nanNhan, thuMuc), false);
    assert.equal(xoaFileTam(path.join(thuMuc, '..', 'file-quan-trong.txt'), thuMuc), false,
      '🔴 `..` phải bị chặn — đây đúng hình dạng ca xoá nhầm thư mục thật 21/08/2026');
  } finally {
    process.stderr.write = goc2;
  }
  assert.equal(fs.existsSync(nanNhan), true, 'file ngoài thư mục tạm PHẢI còn nguyên');
});

test('C3 ★★★ quá trần dung lượng -> TỪ CHỐI, và không để lại file nửa vời', async () => {
  const thuMuc = path.join(thuMucTamThoi(), 'media_tam');
  const qua = GIOI_HAN_MEDIA.DUNG_LUONG_TOI_DA + 1;

  // (a) chặn sớm theo header
  const a = await taiVeTam('https://x.test/to.jpg', thuMuc, {
    fetchFn: async () => ({ ok: true, headers: { get: () => String(qua) }, arrayBuffer: async () => new ArrayBuffer(8) }),
  });
  assert.equal(a.ok, false);
  assert.match(a.ly, /^QUA_LON_/);

  // (b) header NÓI DỐI (thiếu/0) -> vẫn phải chặn theo số byte THẬT
  const b = await taiVeTam('https://x.test/to2.jpg', thuMuc, {
    fetchFn: async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(qua) }),
  });
  assert.equal(b.ok, false, 'header do bên ngoài khai — tin nó là tin lời người lạ');
  assert.match(b.ly, /^QUA_LON_/);

  const conLai = fs.existsSync(thuMuc) ? fs.readdirSync(thuMuc) : [];
  assert.deepEqual(conLai, [], 'từ chối rồi thì ⛔ không được để lại file rác');
});

test('C4 ★★ máy chủ trả lỗi -> báo lý do, ⛔ không ném', async () => {
  const thuMuc = path.join(thuMucTamThoi(), 'media_tam');
  const kq = await taiVeTam('https://x.test/a.jpg', thuMuc, {
    fetchFn: async () => ({ ok: false, status: 404, headers: { get: () => null } }),
  });
  assert.equal(kq.ok, false);
  assert.equal(kq.ly, 'MAY_CHU_TRA_LOI_404');
});

test('C5 ★★ dọn file quá tuổi (lưới hai, cho ca model chết giữa chừng)', () => {
  const thuMuc = path.join(thuMucTamThoi(), 'media_tam');
  fs.mkdirSync(thuMuc, { recursive: true });
  const cu = path.join(thuMuc, 'cu.jpg');
  const moi = path.join(thuMuc, 'moi.jpg');
  fs.writeFileSync(cu, 'x');
  fs.writeFileSync(moi, 'y');
  const xua = Date.now() - GIOI_HAN_MEDIA.TUOI_TOI_DA_MS - 60_000;
  fs.utimesSync(cu, new Date(xua), new Date(xua));

  assert.equal(donFileCu(thuMuc), 1);
  assert.equal(fs.existsSync(cu), false);
  assert.equal(fs.existsSync(moi), true, 'file vừa tải ⛔ không được xoá oan giữa lượt');
});

test('C6 ★★★ thư mục tạm LUÔN nằm cạnh DB (ngoài repo), ⛔ không nằm trong repo', () => {
  const t = thuMucTam('~/.zalo-tro-ly/lichsu.db');
  assert.equal(path.basename(t), GIOI_HAN_MEDIA.TEN_THU_MUC);
  assert.equal(path.dirname(t), path.join(os.homedir(), '.zalo-tro-ly'));
  assert.ok(!t.startsWith(process.cwd()),
    '🔴 nằm trong repo là ảnh của người thật đi thẳng vào git');
});

// ═══════════════════════════════════════════════════════════════════════
// D. KHO — NULL ⛔ KHÁC chuỗi rỗng
// ═══════════════════════════════════════════════════════════════════════

test('D1 ★★★ lưu chữ đọc được; NULL = chưa đọc, "" = đã đọc mà không có chữ', () => {
  const { db } = dbTam();
  writeMessage(db, {
    chatId: DM_HOST, msgId: 'anh-1', cliMsgId: null, userId: HOST, tenLucGui: 'Host',
    msgType: 'chat.image', noiDung: null, contentRaw: RAW_ANH,
    tsZalo: 1_700_000_000_000, tuToi: false, hasHostMention: false,
  });

  const truoc = mediaMessage(db, { chatId: DM_HOST, msgId: 'anh-1' });
  assert.equal(truoc.mediaText, null, 'chưa ai đọc tấm ảnh này');
  assert.equal(layMediaTuTin(truoc.contentRaw).url, 'https://zalo-cdn.example/anh/abc123.jpg');

  writeMediaText(db, { chatId: DM_HOST, msgId: 'anh-1', chu: 'Thứ 4 18h TA Impact' });
  const sau = mediaMessage(db, { chatId: DM_HOST, msgId: 'anh-1' });
  assert.equal(sau.mediaText, 'Thứ 4 18h TA Impact');
  assert.ok(sau.mediaTextAt, 'phải biết đọc LÚC NÀO');

  // Ảnh phong cảnh: đã đọc, không có chữ. ⛔ KHÔNG được lẫn với "chưa đọc".
  writeMediaText(db, { chatId: DM_HOST, msgId: 'anh-1', chu: '' });
  assert.equal(mediaMessage(db, { chatId: DM_HOST, msgId: 'anh-1' }).mediaText, '');
  closeDb(db);
});

test('D2 ★★★ spec H nguyên vẹn: `content` của tin ảnh VẪN là NULL sau khi lưu chữ', () => {
  const { db } = dbTam();
  writeMessage(db, {
    chatId: DM_HOST, msgId: 'anh-2', cliMsgId: null, userId: HOST, tenLucGui: 'Host',
    msgType: 'chat.image', noiDung: null, contentRaw: RAW_ANH,
    tsZalo: 1_700_000_000_001, tuToi: false, hasHostMention: false,
  });
  writeMediaText(db, { chatId: DM_HOST, msgId: 'anh-2', chu: 'chữ trong ảnh' });

  const dong = db.prepare('SELECT content, media_text FROM messages WHERE msg_id = ?').get('anh-2');
  assert.equal(dong.content, null,
    '🔴 lưu chữ ⛔ KHÔNG phải cửa sau của spec H — media của người khác vẫn không được giữ');
  assert.equal(dong.media_text, 'chữ trong ảnh');
  closeDb(db);
});

test('D3 ★★ tin ảnh GẦN NHẤT khi ⛔ không cho msgId (ca thường gặp: gửi ảnh xong bảo đọc)', () => {
  const { db } = dbTam();
  const them = (id, ts, loai, raw) => writeMessage(db, {
    chatId: DM_HOST, msgId: id, cliMsgId: null, userId: HOST, tenLucGui: 'Host',
    msgType: loai, noiDung: loai === 'chat.text' ? 'đọc hộ chị' : null, contentRaw: raw,
    tsZalo: ts, tuToi: false, hasHostMention: false,
  });
  them('cu', 1_000, 'chat.image', RAW_ANH);
  them('moi', 2_000, 'chat.image', JSON.stringify({ href: 'https://x.test/moi.png' }));
  them('chu', 3_000, 'chat.text', null);   // tin CHỮ mới nhất — ⛔ không được chọn

  const m = mediaMessage(db, { chatId: DM_HOST });
  assert.equal(m.msgId, 'moi', 'phải lấy ảnh mới nhất, ⛔ không phải tin chữ mới nhất');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// E. TẦNG TOOL — chốt chặn nằm ở chỗ THỰC HIỆN, không chỉ ở lời dặn
// ═══════════════════════════════════════════════════════════════════════

function dungTool(chatIdHoi, ghiDe = {}) {
  let xuLy;
  const daGhi = [];
  registerTools({
    setRequestHandler(schema, fn) {
      if (schema?.shape?.method?.value === 'tools/call') xuLy = fn;
    },
  }, {
    db: {},
    cauHinh: { ...CAU_HINH, duongDan: { db: path.join(thuMucTamThoi(), 'lichsu.db') } },
    boTichLuy: {},
    api: {},
    docSucKhoe: () => ({ trangThai: 'OK' }),
    kho: {
      getQueueRow: () => ({
        request_id: 'r1', asking_chat_id: chatIdHoi, msg_id: 'm1', user_id: HOST,
        content: 'đọc hộ ảnh', ts_created: new Date().toISOString(),
        status: TRANG_THAI_HANG_DOI.DA_DAY,
      }),
      updateQueueState: () => true,
      mediaMessage: ghiDe.mediaMessage ?? (() => ({
        chatId: chatIdHoi, msgId: 'anh-1', msgType: 'chat.image',
        contentRaw: RAW_ANH, mediaText: null, mediaTextAt: null, tsZalo: 1,
      })),
      writeMediaText: ghiDe.writeMediaText ?? ((_db, p) => { daGhi.push(p); return { ok: true, doiDong: 1 }; }),
      writeActionTrail: () => {},
    },
  });
  return {
    daGhi,
    async goi(ten, args) {
      const ra = await xuLy({ params: { name: ten, arguments: args } });
      return JSON.parse(ra.content[0].text);
    },
  };
}

test('E1 ★★★ gọi media_fetch TỪ TRONG NHÓM -> TỪ CHỐI, ⛔ không chạm mạng', async () => {
  const t = dungTool(NHOM);
  const kq = await t.goi(TEN_TOOL_MEDIA.TAI_MEDIA, { request_id: 'r1' });
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /TIN NHẮN RIÊNG/,
    'phải nói rõ vì sao từ chối, để model ⛔ không đi bịa nội dung ảnh');
});

test('E2 ★★★ lưu chữ từ trong NHÓM cũng bị TỪ CHỐI (đường vào thứ hai)', async () => {
  const t = dungTool(NHOM);
  const kq = await t.goi(TEN_TOOL_MEDIA.LUU_CHU_ANH, { request_id: 'r1', msgId: 'anh-1', chu: 'x' });
  assert.equal(kq.ok, false);
  assert.deepEqual(t.daGhi, [], '⛔ không được ghi một chữ nào vào kho');
});

test('E3 ★★ trong DM: thiếu `chu` -> từ chối và CHỈ ĐƯỜNG (rỗng là hợp lệ)', async () => {
  const t = dungTool(DM_HOST);
  const kq = await t.goi(TEN_TOOL_MEDIA.LUU_CHU_ANH, { request_id: 'r1', msgId: 'anh-1' });
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /RỖNG/, 'phải nói rõ chuỗi rỗng là đường đi tiếp hợp lệ');
});

test('E4 ★★★ trong DM: lưu chuỗi RỖNG là HỢP LỆ và có ghi vào kho', async () => {
  const t = dungTool(DM_HOST);
  const kq = await t.goi(TEN_TOOL_MEDIA.LUU_CHU_ANH, { request_id: 'r1', msgId: 'anh-1', chu: '' });
  assert.equal(kq.ok, true);
  assert.equal(t.daGhi.length, 1);
  assert.equal(t.daGhi[0].chu, '');
  assert.match(kq.duLieu.ghiChu, /không có chữ/);
});

test('E5 ★★ tin ⛔ không có đường tải -> nói THẬT, ⛔ không im lặng trả rỗng', async () => {
  const t = dungTool(DM_HOST, {
    mediaMessage: () => ({
      chatId: DM_HOST, msgId: 'anh-x', msgType: 'chat.image',
      contentRaw: JSON.stringify({ title: 'chỉ có mô tả' }), mediaText: null, mediaTextAt: null, tsZalo: 1,
    }),
  });
  const kq = await t.goi(TEN_TOOL_MEDIA.TAI_MEDIA, { request_id: 'r1' });
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /giới hạn thật/,
    'model phải biết đây là bế tắc thật để nói với anh, chứ ⛔ không thử lại vô ích');
});
