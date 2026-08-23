/**
 * G2 — test cho src/zalo/normalize.js. KHÔNG mạng, KHÔNG đăng nhập Zalo.
 *
 * Payload giả dựng theo ĐÚNG khai báo kiểu của zca-js@2.1.2
 * (`node_modules/zca-js/dist/models/{Message,Undo,Reaction,GroupEvent}.d.ts`)
 * chứ không theo trí nhớ: TMessage.ts là CHUỖI, TUndoContent.globalMsgId là
 * SỐ, TReaction.content.rMsg[].gMsgID là chuỗi (nhưng thực tế trả 0 khi thả
 * từ điện thoại — issue #360).
 *
 *     node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMessage,
  normalizeRecall,
  normalizeReaction,
  normalizeGroupEvent,
  normalizeMsgType,
  isTextMessage,
  parseQuotedReply,
  parseContent,
  hasHostMention,
  inferConversationKind,
  stripBytes,
  parseTs,
} from '../src/zalo/normalize.js';
import { MSG_TYPE, LOAI_HOI_THOAI } from '../src/lib/hang_so.js';

const HOST = '9876543210';
// ID thật của Zalo vượt Number.MAX_SAFE_INTEGER — giữ dạng CHUỖI suốt đường.
const MSG_ID_DAI = '9990000000001666';
const CHAT_ID = '9990000000001';

function tinNhom(ghiDe = {}, ghiDeData = {}) {
  return {
    type: 1, // ThreadType.Group
    threadId: CHAT_ID,
    isSelf: false,
    ...ghiDe,
    data: {
      actionId: 'a1',
      msgId: MSG_ID_DAI,
      cliMsgId: '111222333',
      msgType: MSG_TYPE.TEXT,
      uidFrom: '555',
      idTo: '0',
      dName: 'Người A',
      ts: '1755678901234',
      status: 1,
      content: 'chào cả nhà',
      ...ghiDeData,
    },
  };
}

const BOI_CANH = { hostUserIds: [HOST] };

// ═══ A. Tin nhắn text ═══
test('A1 text: noiDung giữ nguyên, contentRaw null', () => {
  const t = normalizeMessage(tinNhom(), BOI_CANH);
  assert.equal(t.noiDung, 'chào cả nhà');
  assert.equal(t.contentRaw, null);
  assert.equal(t.msgType, MSG_TYPE.TEXT);
});

test('A2 mọi ID về TEXT và KHÔNG mất chữ số', () => {
  const t = normalizeMessage(tinNhom(), BOI_CANH);
  assert.equal(typeof t.msgId, 'string');
  assert.equal(t.msgId, MSG_ID_DAI);
  assert.equal(t.chatId, CHAT_ID);
  assert.equal(t.cliMsgId, '111222333');
  assert.equal(t.userId, '555');
});

test('A3 tuToi lấy từ isSelf; tenLucGui là ảnh chụp dName', () => {
  const t = normalizeMessage(tinNhom({ isSelf: true }), BOI_CANH);
  assert.equal(t.tuToi, true);
  assert.equal(t.tenLucGui, 'Người A');
});

test('A4 dName rỗng -> null, không phải chuỗi rỗng', () => {
  const t = normalizeMessage(tinNhom({}, { dName: '   ' }), BOI_CANH);
  assert.equal(t.tenLucGui, null);
});

test('A5 payload chỉ trả về ĐÚNG 15 trường của TinChuanHoa (không rò payload thô)', () => {
  const t = normalizeMessage(tinNhom(), BOI_CANH);
  assert.deepEqual(Object.keys(t).sort(), [
    'chatId', 'cliMsgId', 'contentRaw', 'hasHostMention', 'msgId', 'msgType',
    'noiDung', 'tenLucGui', 'traLoiCliMsgId', 'traLoiMsgId', 'traLoiTrich',
    'traLoiUserId', 'tsZalo', 'tuToi', 'userId',
  ]);
});

test('A6 thiếu msgId -> NÉM ngay, không ghi dòng thiếu khoá xuống DB', () => {
  assert.throws(() => normalizeMessage(tinNhom({}, { msgId: null }), BOI_CANH), /msgId/);
});

// ═══ B. Spec H — chỉ lưu TEXT ═══
test('B1 ảnh: noiDung PHẢI null (spec H), metadata vào contentRaw', () => {
  const noiDungAnh = JSON.stringify({
    title: '', href: 'https://zalo.example/x.jpg', thumb: 'https://zalo.example/t.jpg',
    width: 1280, height: 720, type: 'image',
  });
  const t = normalizeMessage(tinNhom({}, { msgType: 'chat.image', content: noiDungAnh }), BOI_CANH);
  assert.equal(t.noiDung, null);
  const raw = JSON.parse(t.contentRaw);
  assert.equal(raw._msgTypeGoc, 'chat.image');
  assert.equal(raw.width, 1280, 'metadata phải còn để còn biết đó là ảnh gì');
});

test('B2 bẫy #316: content là CHUỖI JSON, phải tự parse chứ không lưu thô', () => {
  const { contentRaw } = parseContent('chat.link', JSON.stringify({ title: 'Báo giá', href: 'https://x.vn' }));
  const raw = JSON.parse(contentRaw);
  assert.equal(raw.title, 'Báo giá', 'không parse thì title nằm trong chuỗi, truy vấn không thấy');
});

test('B3 chuỗi không phải JSON vẫn giữ được, có cờ _khongPhaiJson', () => {
  const { noiDung, contentRaw } = parseContent('chat.sticker', 'không-phải-json');
  assert.equal(noiDung, null);
  const raw = JSON.parse(contentRaw);
  assert.equal(raw._khongPhaiJson, true);
  assert.equal(raw._text, 'không-phải-json');
});

test('B4 msgType lạ -> UNKNOWN nhưng tên GỐC không mất', () => {
  const t = normalizeMessage(tinNhom({}, { msgType: 'chat.voice', content: '{"len":3}' }), BOI_CANH);
  assert.equal(t.msgType, MSG_TYPE.UNKNOWN, 'phải đếm được bằng idx_tin_type_la');
  assert.equal(JSON.parse(t.contentRaw)._msgTypeGoc, 'chat.voice',
    'mất tên gốc là mất luôn bằng chứng để sau này đặt tên cho voice/video');
});

test('B5 thiếu hẳn msgType -> UNKNOWN, không nổ', () => {
  const t = normalizeMessage(tinNhom({}, { msgType: undefined, content: 'x' }), BOI_CANH);
  assert.equal(t.msgType, MSG_TYPE.UNKNOWN);
  assert.equal(t.noiDung, null, 'không biết loại thì KHÔNG được coi là text');
});

test('B6 khai là text mà content không phải chuỗi -> KHÔNG ép String(), giữ để điều tra', () => {
  const { noiDung, contentRaw } = parseContent(MSG_TYPE.TEXT, { la: 1 });
  assert.equal(noiDung, null);
  assert.ok(!String(contentRaw).includes('[object Object]'));
  assert.equal(JSON.parse(contentRaw)._batThuong, 'content không phải chuỗi');
});

// ⚠️ Tên cũ của bài này là "chỉ nhận 3 loại ĐÃ XÁC MINH" — một lời nói dối:
// `chat.text`/`chat.image` chưa từng được xác minh và KHÔNG có thật trong
// zca-js. Chính chữ "đã xác minh" đó làm không ai đi kiểm lại. Xem nhóm J.
test('B7 normalizeMsgType: các tên CŨ của pack vẫn được nhận (tương thích ngược)', () => {
  assert.equal(normalizeMsgType('chat.text'), 'chat.text');
  assert.equal(normalizeMsgType('chat.image'), 'chat.image');
  assert.equal(normalizeMsgType('chat.link'), 'chat.link');
  assert.equal(normalizeMsgType('chat.video'), MSG_TYPE.UNKNOWN);
  assert.equal(normalizeMsgType(null), MSG_TYPE.UNKNOWN);
});

// ═══ C. Bỏ bytes/base64 ═══
test('C1 data URI base64 bị bỏ, chỉ còn nhãn độ dài', () => {
  const ra = stripBytes({ anh: `data:image/png;base64,${'A'.repeat(200)}` });
  assert.match(ra.anh, /^<đã bỏ: \d+ ký tự>$/);
});

test('C2 chuỗi base64 dài không có tiền tố cũng bị bỏ', () => {
  const ra = stripBytes({ x: 'QUJD'.repeat(200) });
  assert.match(ra.x, /^<đã bỏ: \d+ ký tự>$/);
});

// ⚠️ Bản cũ của C3 tên là "khoá tên nghi bytes bị bỏ DÙ GIÁ TRỊ NGẮN" và
// assert `data: 'abc'` bị xoá. Chính luật đó đã xoá trắng nội dung tin nhắn
// thật: khoá `content` nằm trong danh sách nghi vấn, mà `content` lại đúng là
// chỗ Zalo để chữ. Tên khoá nay chỉ HẠ NGƯỠNG, không còn là bản án.
test('C3 khoá nghi vấn: giữ CHỮ, bỏ BYTES — quyết theo giá trị chứ không theo tên', () => {
  const ra = stripBytes({
    content: 'A thuỷ bảo build gì đấy anh',   // chữ thật dưới khoá nghi vấn
    data: 'abc',                              // ngắn, không phải bytes
    payload: 'QUJDRA'.repeat(20),             // 120 ký tự base64 dưới khoá nghi vấn
    href: 'https://x.vn/a.jpg',
  });
  assert.equal(ra.content, 'A thuỷ bảo build gì đấy anh', 'xoá chỗ này là mất nội dung tin');
  assert.equal(ra.data, 'abc');
  assert.match(ra.payload, /đã bỏ/, 'base64 dưới khoá nghi vấn vẫn phải bị chặn');
  assert.equal(ra.href, 'https://x.vn/a.jpg', 'URL là metadata, KHÔNG phải bytes — phải giữ');
});

test('C3b ngưỡng hạ CHỈ áp cho khoá nghi vấn, không nới ra toàn bộ', () => {
  const b64 = 'QUJDRA'.repeat(20);   // 120 ký tự, dưới trần 512
  assert.match(stripBytes({ data: b64 }).data, /đã bỏ/, 'khoá nghi vấn -> chặn từ 64');
  assert.equal(stripBytes({ ghiChu: b64 }).ghiChu, b64, 'khoá thường -> vẫn theo trần 512');
});

test('C3c object dưới khoá nghi vấn được ĐỆ QUY, không bị xoá trắng', () => {
  const ra = stripBytes({
    content: { title: 'Dạ em xem rồi ạ', anh: `data:image/png;base64,${'A'.repeat(200)}` },
  });
  assert.equal(ra.content.title, 'Dạ em xem rồi ạ', 'object có trường text thì phải giữ được text');
  assert.match(ra.content.anh, /đã bỏ/, 'bytes thật nằm sâu bên trong vẫn phải bị chặn');
});

test('C4 Buffer/TypedArray bị bỏ', () => {
  const ra = stripBytes({ b: new Uint8Array([1, 2, 3]) });
  assert.match(ra.b, /byte nhị phân/);
});

test('C5 contentRaw quá dài bị cắt và ĐÁNH DẤU đã cắt', () => {
  // Nội dung THẬT (có dấu câu, có dấu tiếng Việt) nên không dính bộ lọc base64
  // — bài này đo TRẦN ĐỘ DÀI, không đo bộ lọc bytes.
  const to = {};
  for (let i = 0; i < 400; i += 1) to[`ghiChu${i}`] = `mục số ${i}, nội dung dài dòng.`;
  const { contentRaw } = parseContent('chat.la', JSON.stringify(to));
  assert.ok(contentRaw.length < 4200, `dài ${contentRaw.length}`);
  assert.match(contentRaw, /CẮT \d+ ký tự/);
});

test('C5b BẮT OAN: văn bản dài có dấu câu KHÔNG được coi là bytes', () => {
  // Bản đầu của bộ lọc cho `\s` vào lớp ký tự base64 và ăn oan đúng ca này.
  const vanBan = 'Anh oi, em gui lai bang gia thang nay nhe. '.repeat(40);
  const ra = stripBytes({ ghiChu: vanBan });
  assert.equal(ra.ghiChu, vanBan);
});

test('C6 vòng lặp tham chiếu không làm nổ, vẫn để lại dấu vết', () => {
  const a = { ten: 'x' };
  a.tuTro = a;
  const { contentRaw } = parseContent('chat.la', a);
  assert.ok(contentRaw === null || typeof contentRaw === 'string');
});

// ═══ D. Thu hồi — 3 bẫy ghép ID ═══
function suKienThuHoi(ghiDe = {}, ghiDeContent = {}) {
  return {
    threadId: CHAT_ID,
    isSelf: false,
    isGroup: true,
    ...ghiDe,
    data: {
      msgId: 'EVT-999',           // ← ID của CHÍNH SỰ KIỆN
      cliMsgId: '444',
      uidFrom: '555',
      dName: 'Người A',
      ts: '1755678999999',
      content: {
        globalMsgId: 9990000000001666, // ← SỐ, và là tin BỊ thu hồi
        cliMsgId: 111222333,
        deleteMsg: 1,
        srcId: 1,
        destId: 2,
        ...ghiDeContent,
      },
    },
  };
}

test('D1 BẪY 1: eventId là ID sự kiện, msgIdDich mới là tin bị thu hồi', () => {
  const u = normalizeRecall(suKienThuHoi());
  assert.equal(u.eventId, 'EVT-999');
  assert.notEqual(u.msgIdDich, u.eventId, 'ghép nhầm = UPDATE không trúng dòng nào, KHÔNG có lỗi');
});

test('D2 BẪY 2+3: globalMsgId dạng SỐ ghép được với msgId dạng CHUỖI của tin', () => {
  const tin = normalizeMessage(tinNhom(), BOI_CANH);
  const u = normalizeRecall(suKienThuHoi());
  assert.equal(typeof u.msgIdDich, 'string');
  assert.equal(u.msgIdDich, tin.msgId, 'đây chính là điều kiện để UPDATE recalled trúng dòng');
});

test('D3 cliMsgId phụ cũng về TEXT (đường ghép dự phòng)', () => {
  const u = normalizeRecall(suKienThuHoi());
  assert.equal(u.cliMsgIdDich, '111222333');
});

test('D4 thiếu globalMsgId -> NÉM, không ghi dòng thu hồi trỏ vào hư không', () => {
  assert.throws(() => normalizeRecall(suKienThuHoi({}, { globalMsgId: null })), /globalMsgId/);
});

test('D5 chỉ trả về ĐÚNG 6 trường của SuKienThuHoi', () => {
  assert.deepEqual(Object.keys(normalizeRecall(suKienThuHoi())).sort(), [
    'chatId', 'cliMsgIdDich', 'eventId', 'msgIdDich', 'nguoiThuHoi', 'tsZalo',
  ]);
});

// ═══ E. Reaction ═══
function reaction(gMsgID, rIcon = '/-heart') {
  return {
    threadId: CHAT_ID,
    isSelf: false,
    isGroup: true,
    data: {
      msgId: 'EVT-R1',
      uidFrom: '555',
      ts: '1755679000000',
      content: { rMsg: [{ gMsgID, cMsgID: '111222333', msgType: 1 }], rIcon, rType: 0, source: 6 },
    },
  };
}

test('E1 reaction từ Zalo Desktop: ghép được vào tin', () => {
  const r = normalizeReaction(reaction(MSG_ID_DAI));
  assert.equal(r.msgIdDich, MSG_ID_DAI);
  assert.equal(r.bieuTuong, '/-heart');
});

test('E2 issue #360 — thả từ ĐIỆN THOẠI cho gMsgID = 0 -> msgIdDich null, KHÔNG ghép bừa', () => {
  assert.equal(normalizeReaction(reaction(0)).msgIdDich, null);
  assert.equal(normalizeReaction(reaction('0')).msgIdDich, null, 'cả dạng chuỗi "0"');
});

test('E3 rIcon rỗng (Reactions.NONE = gỡ cảm xúc) giữ nguyên "", không hoá null', () => {
  assert.equal(normalizeReaction(reaction(MSG_ID_DAI, '')).bieuTuong, '');
});

test('E4 thiếu hẳn rMsg -> null chứ không nổ', () => {
  const r = normalizeReaction({ threadId: CHAT_ID, data: { uidFrom: '5', ts: '1', content: {} } });
  assert.equal(r.msgIdDich, null);
});

// ═══ F. Sự kiện nhóm ═══
test('F1 loại chữ thường của zca-js -> CHỮ HOA khớp schema, giữ tên gốc', () => {
  const s = normalizeGroupEvent({
    type: 'join', act: 'x', threadId: CHAT_ID, isSelf: false,
    data: { groupId: CHAT_ID, groupName: 'Nhóm A', time: '1755679100000' },
  });
  assert.equal(s.loai, 'JOIN');
  assert.equal(JSON.parse(s.duLieu)._loaiGoc, 'join');
  assert.equal(s.tsZalo, 1755679100000);
});

test('F2 thiếu threadId -> lùi về data.groupId', () => {
  const s = normalizeGroupEvent({ type: 'leave', data: { groupId: 'G-77', time: '1' } });
  assert.equal(s.chatId, 'G-77');
});

test('F3 thiếu type -> UNKNOWN, không bỏ qua im lặng', () => {
  const s = normalizeGroupEvent({ threadId: CHAT_ID, data: { groupId: CHAT_ID } });
  assert.equal(s.loai, 'UNKNOWN');
  assert.equal(s.tsZalo, null, 'không có mốc thời gian thì để null, không bịa');
});

// ═══ G. Tag host — điều kiện kích hoạt cốt lõi (spec B) ═══
test('G1 mentions chứa uid host -> true', () => {
  const t = normalizeMessage(
    tinNhom({}, { mentions: [{ uid: HOST, pos: 0, len: 5, type: 0 }] }), BOI_CANH,
  );
  assert.equal(t.hasHostMention, true);
});

test('G2 mentions người khác -> false', () => {
  const t = normalizeMessage(
    tinNhom({}, { mentions: [{ uid: '123', pos: 0, len: 5, type: 0 }] }), BOI_CANH,
  );
  assert.equal(t.hasHostMention, false);
});

test('G3 KHÔNG có mentions (DM, hoặc tin thường) -> false', () => {
  assert.equal(normalizeMessage(tinNhom(), BOI_CANH).hasHostMention, false);
});

test('G4 uid dạng số vẫn khớp uid dạng chuỗi (lệch kiểu như bẫy undo)', () => {
  assert.equal(hasHostMention({ data: { mentions: [{ uid: 555 }] } }, ['555']), true);
});

test('G5 config không có host nào -> false, KHÔNG nổ', () => {
  assert.equal(hasHostMention({ data: { mentions: [{ uid: HOST }] } }, []), false);
  assert.equal(normalizeMessage(tinNhom(), { hostUserIds: undefined }).hasHostMention, false);
});

test('G6 mentions rỗng / không phải mảng -> false', () => {
  assert.equal(hasHostMention({ data: { mentions: [] } }, [HOST]), false);
  assert.equal(hasHostMention({ data: { mentions: 'x' } }, [HOST]), false);
});

// ═══ H. Loại hội thoại — đường vòng qua bẫy isGroup (#25) ═══
test('H1 Message.type là nguồn tin cậy số 1 (0=DM, 1=GROUP)', () => {
  assert.equal(inferConversationKind(CHAT_ID, null, 1), LOAI_HOI_THOAI.GROUP);
  assert.equal(inferConversationKind(CHAT_ID, null, 0), LOAI_HOI_THOAI.DM);
});

test('H2 không có gợi ý -> đối chiếu danh sách nhóm trong config', () => {
  const ch = { groups: [{ chatId: CHAT_ID }] };
  assert.equal(inferConversationKind(CHAT_ID, ch), LOAI_HOI_THOAI.GROUP);
});

test('H3 không đối chiếu được -> UNKNOWN, CỐ Ý không đoán DM', () => {
  assert.equal(inferConversationKind('la-hoac', { groups: [{ chatId: CHAT_ID }] }), LOAI_HOI_THOAI.UNKNOWN);
  assert.equal(inferConversationKind(null, null), LOAI_HOI_THOAI.UNKNOWN);
});

// ═══ I. Mốc thời gian ═══
test('I1 ts là CHUỖI ms -> số', () => {
  assert.equal(parseTs('1755678901234'), 1755678901234);
  assert.equal(parseTs(1755678901234), 1755678901234);
});

test('I2 ts rác -> null ở chỗ cho phép null', () => {
  assert.equal(parseTs('hôm qua'), null);
  assert.equal(parseTs(''), null);
  assert.equal(parseTs(undefined), null);
});

test('I3 tin nhắn thiếu ts vẫn ghi được (cột NOT NULL) và KÊU ra stderr', () => {
  const goc = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  try {
    const t = normalizeMessage(tinNhom({}, { ts: 'rác' }), BOI_CANH);
    assert.ok(t.tsZalo > 0, 'vẫn phải có mốc để không mất dòng tin');
    assert.ok(keu.some((s) => s.includes('không đọc được ts')), 'thay giờ mà im lặng là bịa dữ liệu');
  } finally {
    process.stderr.write = goc;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// J. BUG THẬT 20/08/2026 — msgType `webchat`
//
// 🔴 Payload trong nhóm này lấy NGUYÊN VĂN từ `~/.zalo-tro-ly/lichsu.db`
//    sau lần chạy thật đầu tiên (10 dòng đầu), KHÔNG phải payload tự nghĩ.
//    Payload tự nghĩ chính là thứ đã đẻ ra bug: cả bộ 44 bài trước đều dựng
//    tin bằng `msgType: MSG_TYPE.TEXT` — một tên KHÔNG TỒN TẠI trong zca-js
//    — nên 44 bài xanh mà 10/10 tin thật vẫn hỏng.
// ═══════════════════════════════════════════════════════════════════════

const NHOM_THAT = '9995000000000000005';   // nhóm "Haceco KT"
const HOST_THAT = '9993000000000000003';   // hosts[0].userId trong config
const BOT_THAT = '999200000000000002';    // uidFrom của các sự kiện tự-gửi

/** Tin THẬT: anh nhắn "Test trợ lý 1" vào nhóm. */
function tinThatWebchat(ghiDeData = {}) {
  return {
    type: 1,
    threadId: NHOM_THAT,
    isSelf: false,
    data: {
      msgId: '9996000000002',
      cliMsgId: '1786095999999',
      msgType: 'webchat',
      uidFrom: HOST_THAT,
      idTo: '0',
      dName: 'Hải',
      ts: '1755678901234',
      content: 'Test trợ lý 1',
      ...ghiDeData,
    },
  };
}

test('J1 payload THẬT `webchat` -> là tin văn bản, chữ vào noiDung', () => {
  const t = normalizeMessage(tinThatWebchat(), BOI_CANH);
  assert.equal(t.noiDung, 'Test trợ lý 1');
  assert.equal(t.msgType, MSG_TYPE.TEXT);
  assert.equal(t.contentRaw, null);
});

test('J2 HỒI QUY chính cái đã hỏng: KHÔNG được ra UNKNOWN + chữ kẹt trong contentRaw', () => {
  const t = normalizeMessage(tinThatWebchat(), BOI_CANH);
  // Vân tay của bug: msg_type='UNKNOWN', content=NULL, chữ nằm ở _text.
  assert.notEqual(t.msgType, MSG_TYPE.UNKNOWN);
  assert.notEqual(t.noiDung, null, 'content=NULL đúng là triệu chứng của bug');
  assert.ok(
    !String(t.contentRaw).includes('_khongPhaiJson'),
    'chữ kẹt trong contentRaw._text là đúng dạng hỏng đã xảy ra thật',
  );
});

test('J3 THÊM chứ không THAY: `chat.text` cũ vẫn hợp lệ', () => {
  assert.equal(normalizeMsgType('chat.text'), MSG_TYPE.TEXT);
  assert.equal(isTextMessage('chat.text'), true);
  const { noiDung } = parseContent('chat.text', 'chào');
  assert.equal(noiDung, 'chào', '10 dòng DB cũ và 44 bài test cũ đang dựa vào tên này');
});

test('J4 bảng ánh xạ đủ cho các tên thật đã tra được', () => {
  assert.equal(normalizeMsgType('webchat'), MSG_TYPE.TEXT);
  assert.equal(normalizeMsgType('chat.photo'), MSG_TYPE.IMAGE, 'tên THẬT của ảnh là chat.photo');
  assert.equal(normalizeMsgType('chat.link'), MSG_TYPE.LINK);
  assert.equal(normalizeMsgType('chat.image'), MSG_TYPE.IMAGE, 'tên cũ của pack, giữ');
});

test('J5 chỉ VĂN BẢN mới được mang noiDung — spec H không nới theo', () => {
  for (const ten of ['chat.photo', 'chat.link', 'chat.voice', 'chat.delete', 'share.file']) {
    assert.equal(isTextMessage(ten), false, ten);
    assert.equal(parseContent(ten, 'chữ giả vờ').noiDung, null, ten);
  }
});

test('J6 payload THẬT `chat.delete` -> UNKNOWN, giữ tên gốc, KHÔNG nổ', () => {
  // Nguyên văn từ DB: content là MẢNG, uidFrom là object BigNumber {s,e,c}.
  const noiDungThat = [{
    type: 2,
    actionType: 0,
    uidFrom: { s: 1, e: 17, c: [79598, 26602110971] },
    uidTo: { s: 1, e: 18, c: [409980, 96266021109] },
    clientDelMsgId: 1786095000001,
    globalDelMsgId: 0,
    destId: { s: 1, e: 18, c: [409980, 96266021109] },
  }];
  const t = normalizeMessage(
    tinThatWebchat({ msgType: 'chat.delete', content: JSON.stringify(noiDungThat) }),
    BOI_CANH,
  );
  assert.equal(t.msgType, MSG_TYPE.UNKNOWN);
  assert.equal(t.noiDung, null);
  assert.equal(JSON.parse(t.contentRaw)._msgTypeGoc, 'chat.delete');
});

test('J7 `chat.delete` là tên THƯ VIỆN KHÔNG BIẾT nhưng ĐÃ THẤY THẬT -> không cắm cờ _tenLa', () => {
  const raw = JSON.parse(parseContent('chat.delete', '[]').contentRaw);
  assert.equal(raw._tenLa, undefined, 'đã đo thật rồi thì không bắt ai đi xem lại nữa');
});

test('J8 tên CHƯA AI TỪNG THẤY -> cắm cờ _tenLa để có người đi xem', () => {
  const la = JSON.parse(parseContent('chat.hoan.toan.moi', '{}').contentRaw);
  assert.equal(la._tenLa, true);
  // Tên đã biết mà pack chưa có ô thì KHÔNG cắm — cờ kêu ở ca bình thường
  // thì chẳng mấy chốc không ai nhìn nữa.
  const biet = JSON.parse(parseContent('chat.voice', '{"len":3}').contentRaw);
  assert.equal(biet._tenLa, undefined);
});

test('J9 mentions được GIỮ làm bằng chứng — nếu không thì has_host_tag không thể truy được', () => {
  const men = [{ uid: BOT_THAT, pos: 0, len: 8, type: 0 }];
  const t = normalizeMessage(tinThatWebchat({ mentions: men }), { hostUserIds: [HOST_THAT], uidTroLy: BOT_THAT });
  assert.equal(t.noiDung, 'Test trợ lý 1', 'giữ bằng chứng KHÔNG được làm mất chữ');
  const raw = JSON.parse(t.contentRaw);
  assert.equal(raw._mentions[0].uid, BOT_THAT);
  assert.equal(raw._mentions[0].pos, 0);
});

test('J10 tin KHÔNG tag ai thì contentRaw vẫn null như cũ (không phình DB)', () => {
  const t = normalizeMessage(tinThatWebchat(), BOI_CANH);
  assert.equal(t.contentRaw, null);
});

test('J11 🔴 chiều so sánh: anh tag TRỢ LÝ thì phải kích hoạt được', () => {
  // Đây là ca THẬT của spec B: uid bị tag là TÀI KHOẢN BOT, không phải host.
  const tho = tinThatWebchat({ mentions: [{ uid: BOT_THAT, pos: 0, len: 8, type: 0 }] });

  assert.equal(
    hasHostMention(tho, [HOST_THAT], BOT_THAT), true,
    'có uid trợ lý thì đánh giá đúng câu hỏi của hợp đồng',
  );

  // Không truyền uid trợ lý -> KHÔNG thể đánh giá -> false (im lặng) + PHẢI KÊU.
  const goc = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  try {
    assert.equal(hasHostMention(tho, [HOST_THAT]), false);
  } finally {
    process.stderr.write = goc;
  }
  assert.ok(
    keu.some((s) => s.includes('uidTroLy')),
    'câm mà không kêu thì đúng bằng kiểu hỏng đã giấu bug webchat suốt 10 dòng',
  );
});

test('J12 tag người KHÁC không kích hoạt trợ lý', () => {
  const tho = tinThatWebchat({ mentions: [{ uid: '111222333444', pos: 0, len: 5, type: 0 }] });
  assert.equal(hasHostMention(tho, [HOST_THAT], BOT_THAT), false, 'sai về phía IM LẶNG');
});

// ═══════════════════════════════════════════════════════════════════════
// K. REPLY / QUOTE  (v2)
//
// ⚠️ NÓI THẲNG VỀ ĐỘ TIN CẬY: khác nhóm J, ở đây CHƯA CÓ payload quote thật
//    nào đo được — tới lúc viết chưa ai reply trong nhóm, mà bản cũ thì vứt
//    hẳn `data.quote` nên kho lịch sử không giữ được mẫu nào.
//    Payload dưới dựng theo `TQuote` trong
//    `node_modules/zca-js@2.1.2/dist/models/Message.d.ts` — tức lấy từ MÃ
//    NGUỒN THƯ VIỆN, không phải tự nghĩ. Đã báo Router đây là rủi ro còn lại.
// ═══════════════════════════════════════════════════════════════════════

/** Đúng khuôn TQuote: globalMsgId/cliMsgId là NUMBER, ownerId là string. */
function quoteGia(v = {}) {
  return {
    ownerId: '9993000000000000003',
    cliMsgId: 1786095000001,
    globalMsgId: 9996000000002,
    cliMsgType: 1,
    ts: 1755678901234,
    msg: 'Test trợ lý 1',
    attach: '',
    fromD: '',
    ttl: 0,
    ...v,
  };
}

test('K1 quote -> lấy đúng tin ĐƯỢC trả lời, KHÔNG nhầm với msgId tin hiện tại', () => {
  const t = normalizeMessage(tinNhom({}, { quote: quoteGia() }), BOI_CANH);
  assert.equal(t.traLoiMsgId, '9996000000002');
  assert.notEqual(t.traLoiMsgId, t.msgId, 'nhầm hai cái này là ghép không ra dòng nào mà chẳng có lỗi');
});

test('K2 🔴 globalMsgId khai NUMBER -> phải ra CHUỖI, không mất chữ số', () => {
  const t = normalizeMessage(tinNhom({}, { quote: quoteGia() }), BOI_CANH);
  assert.equal(typeof t.traLoiMsgId, 'string');
  assert.equal(typeof t.traLoiCliMsgId, 'string');
  assert.equal(t.traLoiCliMsgId, '1786095000001');
});

test('K3 ownerId là tác giả TIN GỐC, KHÁC người bấm trả lời', () => {
  const t = normalizeMessage(
    tinNhom({}, { quote: quoteGia({ ownerId: 'AAA' }), uidFrom: 'BBB' }),
    BOI_CANH,
  );
  assert.equal(t.traLoiUserId, 'AAA');
  assert.equal(t.userId, 'BBB', 'lẫn hai cái này là quy nhầm lời cho người khác');
});

test('K4 globalMsgId = 0 -> KHÔNG ghép được, nhưng giữ cliMsgId làm đường lùi', () => {
  const t = normalizeMessage(tinNhom({}, { quote: quoteGia({ globalMsgId: 0 }) }), BOI_CANH);
  assert.equal(t.traLoiMsgId, null, "'0' không phải một msgId — ghép bừa là tạo liên kết SAI");
  assert.equal(t.traLoiCliMsgId, '1786095000001', 'vứt cả cụm thì mất luôn đường ghép dự phòng');
});

test('K5 quote.msg không phải chuỗi -> bỏ, KHÔNG ra "[object Object]"', () => {
  const t = normalizeMessage(tinNhom({}, { quote: quoteGia({ msg: { title: 'ảnh' } }) }), BOI_CANH);
  assert.equal(t.traLoiTrich, null);
  assert.equal(t.traLoiMsgId, '9996000000002', 'trích hỏng không được làm mất liên kết');
});

test('K6 tin thường (không reply) -> cả 4 trường null, không phình dữ liệu', () => {
  const t = normalizeMessage(tinNhom(), BOI_CANH);
  assert.deepEqual(
    [t.traLoiMsgId, t.traLoiCliMsgId, t.traLoiUserId, t.traLoiTrich],
    [null, null, null, null],
  );
});

test('K7 trích đoạn dài bị cắt, không kéo cả bài vào mỗi dòng reply', () => {
  const { traLoiTrich } = parseQuotedReply(quoteGia({ msg: 'x'.repeat(5000) }));
  assert.ok(traLoiTrich.length <= 500, `dài ${traLoiTrich.length}`);
});

test('K8 quote rác (null/chuỗi/số) -> không nổ, trả 4 null', () => {
  for (const rac of [null, undefined, 'abc', 123, []]) {
    const r = parseQuotedReply(rac);
    assert.equal(r.traLoiMsgId, null, String(rac));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// L. LUẬT CHE XOÁ TRẮNG CHỮ THẬT  (đo trên DB thật 20/08/2026)
//
// 🔴 2 dòng trong kho có nguyên văn:
//   {"_msgTypeGoc":"webchat","_batThuong":"content không phải chuỗi",
//    "content":"<đã bỏ: khoá nghi chứa bytes>"}
//   Cả hai là tin do CHÍNH TRỢ LÝ gửi, vọng ngược về qua listener. Chữ mất
//   sạch vì khoá `content` nằm trong danh sách "tên nghi chứa bytes" — mà
//   `content` lại đúng là chỗ Zalo để nội dung tin.
// ═══════════════════════════════════════════════════════════════════════

test('L1 ★ HỒI QUY: content dạng object KHÔNG còn bị xoá trắng', () => {
  const { contentRaw } = parseContent('webchat', { title: 'Dạ em xem rồi ạ' });
  assert.ok(
    !String(contentRaw).includes('khoá nghi chứa bytes'),
    'đây đúng là vân tay của 2 dòng đã mất chữ trong kho thật',
  );
  assert.ok(String(contentRaw).includes('Dạ em xem rồi ạ'));
});

test('L2 rút được chữ thì đổ sang noiDung, và VẪN giữ object để đối chiếu', () => {
  const { noiDung, contentRaw } = parseContent('webchat', { title: 'Dạ em xem rồi ạ' });
  assert.equal(noiDung, 'Dạ em xem rồi ạ');
  const raw = JSON.parse(contentRaw);
  assert.equal(raw._daRutChu, true);
  assert.equal(raw.content.title, 'Dạ em xem rồi ạ',
    'hình dạng object này CHƯA XÁC MINH — giữ lại thì lần sau còn kiểm được rút đúng trường chưa');
});

test('L3 KHÔNG rút được thì để NULL, tuyệt đối không bịa — nhưng phải giữ nguyên object', () => {
  const { noiDung, contentRaw } = parseContent('webchat', { la: 1, sau: { hon: 'nữa' } });
  assert.equal(noiDung, null);
  const raw = JSON.parse(contentRaw);
  assert.equal(raw._daRutChu, false);
  assert.equal(raw.content.la, 1, 'mất object là mất luôn bằng chứng để đặt tên cho hình dạng này');
  assert.equal(raw.content.sau.hon, 'nữa');
});

test('L4 🔴 KHÔNG nới quá tay: bytes thật trong object vẫn phải bị chặn', () => {
  const { noiDung, contentRaw } = parseContent('webchat', {
    title: 'chú thích ảnh',
    anh: `data:image/png;base64,${'A'.repeat(400)}`,
    tho: 'QUJDRA'.repeat(200),
  });
  assert.equal(noiDung, 'chú thích ảnh');
  const raw = JSON.parse(contentRaw);
  assert.match(raw.content.anh, /đã bỏ/, 'data URI phải bị chặn');
  assert.match(raw.content.tho, /đã bỏ/, 'base64 dài phải bị chặn');
});

test('L5 không rút chữ từ giá trị trông như bytes (thà NULL còn hơn ghi rác)', () => {
  const { noiDung } = parseContent('webchat', { title: `data:image/png;base64,${'A'.repeat(300)}` });
  assert.equal(noiDung, null);
});
