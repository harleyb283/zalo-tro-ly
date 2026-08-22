/**
 * G7 — test gửi tin. Chạy: `npm test` (node --test).
 *
 * Chạy HOÀN TOÀN không cần Zalo, không mạng, không DB: `api` là đồ giả ghi
 * lại đúng những gì được truyền vào `sendMessage()`. Bộ chuyển markdown là
 * hàm thuần nên kiểm được từng offset một.
 *
 * 🔴 Cách kiểm offset trong bộ test này: KHÔNG so số cứng (số cứng vô nghĩa,
 * sai một ly là test cũng sai theo). Mỗi bài đều CẮT LẠI chuỗi kết quả bằng
 * chính `start`/`len` mà bộ chuyển sinh ra, rồi so với đoạn chữ ĐÁNG LẼ phải
 * được tô. Lệch offset là hiện ra ngay.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TextStyle, ThreadType } from 'zca-js';

import {
  THROTTLE_MAC_DINH,
  catAnToan,
  chuyenMarkdown,
  datLaiThrottle,
  datThrottle,
  dungMentions,
  guiNhieuPhan,
  canChiaNho,
  guiAnh,
  guiDmHost,
  guiVaoNhom,
} from '../src/zalo/send.js';
import { GIOI_HAN } from '../src/lib/hang_so.js';

// Throttle thật là 1,2 giây/tin — bộ test sẽ mất hàng chục giây. Tắt giãn
// cách cho phần lớn bài, có 2 bài RIÊNG bật lại để kiểm chính throttle.
datThrottle({ minKhoangCachMs: 0, toiDaMoiPhut: 100000 });

/** api giả: ghi lại mọi lời gọi, không chạm mạng. */
function apiGia(ketQua = { message: { msgId: 999000000012345 }, attachment: [] }) {
  const goi = [];
  return {
    goi,
    async sendMessage(noiDung, threadId, type) {
      goi.push({ noiDung, threadId, type });
      if (ketQua instanceof Error) throw ketQua;
      return ketQua;
    },
  };
}

/** Cắt lại chuỗi bằng chính offset mà bộ chuyển sinh ra. */
function doanDuocTo(kq, st) {
  return kq.styles
    .filter((s) => s.st === st)
    .map((s) => kq.msg.slice(s.start, s.start + s.len));
}

// ═══════════════════════════════════════════════════════════════════════════
// A. MARKDOWN -> TextStyle · OFFSET
// ═══════════════════════════════════════════════════════════════════════════

test('A1 ★ offset tính trên chuỗi ĐÃ BỎ dấu markdown, không phải chuỗi gốc', () => {
  const kq = chuyenMarkdown('xin chào **anh Hải** nhé');
  assert.equal(kq.msg, 'xin chào anh Hải nhé', 'dấu ** phải bị bỏ khỏi chữ');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['anh Hải']);
  // Nếu ai đó tính offset trên chuỗi GỐC thì start sẽ là 11 (sau '**'),
  // cắt ra được 'h Hải n' — bài này bắt đúng ca đó.
  assert.equal(kq.styles[0].start, 9);
});

test('A2 ★ NHIỀU đoạn đậm trên một dòng — offset phải dồn đúng, không tích luỹ lệch', () => {
  const kq = chuyenMarkdown('**một** giữa **hai** cuối **ba**');
  assert.equal(kq.msg, 'một giữa hai cuối ba');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['một', 'hai', 'ba']);
});

test('A3 ★ TIẾNG VIỆT CÓ DẤU — offset không lệch vì chữ có dấu', () => {
  const kq = chuyenMarkdown('Đã duyệt **báo giá** của khách rồi ạ');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['báo giá']);

  // Đầu vào dạng NFD (chữ + dấu tách rời) trông y hệt trên màn hình nhưng
  // .length lệch 5 trên câu 16 ký tự. Chuẩn hoá NFC làm chuỗi đo và chuỗi
  // gửi là MỘT, nên đoạn cắt ra vẫn đúng.
  const nfd = 'Đã duyệt **báo giá** của khách rồi ạ'.normalize('NFD');
  assert.notEqual(nfd, 'Đã duyệt **báo giá** của khách rồi ạ', 'NFD phải khác NFC');
  const kq2 = chuyenMarkdown(nfd);
  assert.deepEqual(doanDuocTo(kq2, TextStyle.Bold), ['báo giá']);
  assert.equal(kq2.msg, kq.msg, 'đầu ra phải được chuẩn hoá về cùng một dạng');
});

test('A4 ★ EMOJI (cặp surrogate) trước đoạn tô — offset vẫn trúng', () => {
  const kq = chuyenMarkdown('xong 👍 rồi, **kết luận** ở đây');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['kết luận']);
});

test('A5 ★ NHIỀU DÒNG — offset cộng dồn qua ký tự xuống dòng', () => {
  const kq = chuyenMarkdown('dòng một\ndòng **hai**\ndòng **ba** cuối');
  assert.equal(kq.msg, 'dòng một\ndòng hai\ndòng ba cuối');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['hai', 'ba']);
});

test('A6 heading -> Big + Bold, dấu # bị bỏ', () => {
  const kq = chuyenMarkdown('# Tiêu đề lớn\nnội dung');
  assert.equal(kq.msg, 'Tiêu đề lớn\nnội dung');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Big), ['Tiêu đề lớn']);
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['Tiêu đề lớn']);
});

test('A7 danh sách -> lst_1 / lst_2, dấu đầu dòng bị bỏ', () => {
  const kq = chuyenMarkdown('- mục một\n- mục hai\n1. thứ nhất\n2) thứ nhì');
  assert.equal(kq.msg, 'mục một\nmục hai\nthứ nhất\nthứ nhì');
  assert.deepEqual(doanDuocTo(kq, TextStyle.UnorderedList), ['mục một', 'mục hai']);
  assert.deepEqual(doanDuocTo(kq, TextStyle.OrderedList), ['thứ nhất', 'thứ nhì']);
});

test('A8 ★ "* mục" là DANH SÁCH, "*chữ*" là NGHIÊNG — không lẫn nhau', () => {
  const ds = chuyenMarkdown('* mục danh sách');
  assert.equal(ds.msg, 'mục danh sách');
  assert.deepEqual(doanDuocTo(ds, TextStyle.UnorderedList), ['mục danh sách']);
  assert.deepEqual(doanDuocTo(ds, TextStyle.Italic), []);

  const ng = chuyenMarkdown('đây là *nghiêng* nhé');
  assert.equal(ng.msg, 'đây là nghiêng nhé');
  assert.deepEqual(doanDuocTo(ng, TextStyle.Italic), ['nghiêng']);
});

test('A9 gạch ngang + lồng nhau (đậm chứa nghiêng)', () => {
  const kq = chuyenMarkdown('~~bỏ~~ và **đậm *và nghiêng* nữa**');
  assert.equal(kq.msg, 'bỏ và đậm và nghiêng nữa');
  assert.deepEqual(doanDuocTo(kq, TextStyle.StrikeThrough), ['bỏ']);
  assert.deepEqual(doanDuocTo(kq, TextStyle.Bold), ['đậm và nghiêng nữa']);
  assert.deepEqual(doanDuocTo(kq, TextStyle.Italic), ['và nghiêng']);
});

test('A10 `code` — bỏ dấu backtick, KHÔNG tô (Zalo không có monospace)', () => {
  const kq = chuyenMarkdown('chạy `npm test` đi');
  assert.equal(kq.msg, 'chạy npm test đi');
  assert.equal(kq.styles.length, 0, 'không được bịa ra style monospace');
});

test('A11 ★ dấu mở KHÔNG có dấu đóng -> giữ NGUYÊN VĂN, không nuốt mất chữ', () => {
  for (const [vao, ra] of [
    ['2 * 3 = 6', '2 * 3 = 6'],
    ['đậm **chưa đóng', 'đậm **chưa đóng'],
    ['dấu ~~ lẻ', 'dấu ~~ lẻ'],
  ]) {
    assert.equal(chuyenMarkdown(vao).msg, ra, `nuốt mất chữ ở: ${vao}`);
  }
});

test('A12 dòng cảnh báo -> màu, và màu phủ ĐÚNG dòng đó', () => {
  const kq = chuyenMarkdown('bình thường\n🔴 nguy hiểm\n⚠️ lưu ý\n✅ xong');
  assert.deepEqual(doanDuocTo(kq, TextStyle.Red), ['🔴 nguy hiểm']);
  assert.deepEqual(doanDuocTo(kq, TextStyle.Orange), ['⚠️ lưu ý']);
  assert.deepEqual(doanDuocTo(kq, TextStyle.Green), ['✅ xong']);
});

test('A13 mọi style nằm TRONG chuỗi, len > 0 — không có range vượt biên', () => {
  const kq = chuyenMarkdown(
    '# Báo cáo\n- **xong** rồi\n⚠️ còn *một* việc\n~~bỏ~~ `mã` cuối',
  );
  for (const s of kq.styles) {
    assert.ok(s.start >= 0, `start âm: ${JSON.stringify(s)}`);
    assert.ok(s.len > 0, `len <= 0: ${JSON.stringify(s)}`);
    assert.ok(s.start + s.len <= kq.msg.length, `vượt biên: ${JSON.stringify(s)}`);
    assert.equal(typeof s.st, 'string');
  }
});

test('A14 chuỗi rỗng / không phải chuỗi -> không nổ', () => {
  assert.deepEqual(chuyenMarkdown(''), { msg: '', styles: [] });
  assert.deepEqual(chuyenMarkdown(null), { msg: '', styles: [] });
  assert.deepEqual(chuyenMarkdown(undefined), { msg: '', styles: [] });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. CẮT AN TOÀN
// ═══════════════════════════════════════════════════════════════════════════

test('B1 dưới trần -> giữ nguyên, không đánh dấu cắt', () => {
  const kq = catAnToan('ngắn thôi');
  assert.equal(kq.text, 'ngắn thôi');
  assert.equal(kq.daCat, false);
});

test('B2 ★ quá trần -> cắt VÀ NÓI ĐÃ CẮT, không im lặng nuốt đuôi', () => {
  const dai = 'x'.repeat(GIOI_HAN.DO_DAI_TIN_TOI_DA + 500);
  const kq = catAnToan(dai);
  assert.equal(kq.daCat, true);
  assert.equal(kq.originalLength, GIOI_HAN.DO_DAI_TIN_TOI_DA + 500);
  assert.ok(kq.text.length <= GIOI_HAN.DO_DAI_TIN_TOI_DA, `dài ${kq.text.length}`);
  assert.match(kq.text, /cắt bớt/, 'cắt mà không báo là kiểu hỏng tệ nhất');
  assert.match(kq.text, new RegExp(String(kq.originalLength)), 'phải nói bản đầy đủ dài bao nhiêu');
});

test('B3 trần đúng bằng độ dài -> KHÔNG cắt (không lệch 1 ký tự)', () => {
  const s = 'y'.repeat(100);
  assert.equal(catAnToan(s, 100).daCat, false);
  assert.equal(catAnToan(s, 99).daCat, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// C. GỬI
// ═══════════════════════════════════════════════════════════════════════════

test('C1 guiVaoNhom gửi đúng ThreadType.Group, guiDmHost gửi ThreadType.User', async () => {
  const api = apiGia();
  await guiVaoNhom(api, '111', 'chào nhóm');
  await guiDmHost(api, 'dm-1', 'chào riêng');
  assert.equal(api.goi[0].type, ThreadType.Group);
  assert.equal(api.goi[0].threadId, '111');
  assert.equal(api.goi[1].type, ThreadType.User);
  assert.equal(api.goi[1].threadId, 'dm-1');
});

test('C2 ★ msgId trả về là CHUỖI, không phải number (ID Zalo vượt MAX_SAFE_INTEGER)', async () => {
  const api = apiGia({ message: { msgId: 9990000000001123 }, attachment: [] });
  const kq = await guiVaoNhom(api, '111', 'x');
  assert.equal(typeof kq.msgId, 'string', 'để nguyên number là mất chính xác âm thầm');
});

test('C3 ★ ghi lại chính tin vừa gửi, đúng hình dạng TinChuanHoa', async () => {
  const api = apiGia();
  const daGhi = [];
  await guiVaoNhom(api, '111', '**xong** rồi ạ', { ghiLai: (t) => daGhi.push(t) });
  assert.equal(daGhi.length, 1, 'không ghi thì lịch sử thiếu vế trả lời');
  const t = daGhi[0];
  assert.equal(t.chatId, '111');
  assert.equal(typeof t.msgId, 'string');
  assert.equal(t.noiDung, 'xong rồi ạ', 'phải ghi chữ ĐÃ BỎ markdown, đúng cái người ta thấy');
  assert.equal(t.msgType, 'chat.text');
  assert.equal(t.tuToi, true);
  assert.equal(t.coTagHost, false);
  assert.equal(typeof t.tsZalo, 'number');
});

test('C4 KHÔNG truyền ghiLai -> vẫn gửi được, nhưng phải KÊU ra stderr', async () => {
  const goc = process.stderr.write.bind(process.stderr);
  const thu = [];
  process.stderr.write = (s) => (thu.push(String(s)), true);
  try {
    await guiVaoNhom(apiGia(), '111', 'x');
  } finally {
    process.stderr.write = goc;
  }
  assert.match(thu.join(''), /ghiLai/, 'im lặng bỏ ghi = lịch sử thủng mà không ai biết');
});

test('C5 ★ ghiLai NÉM LỖI -> KHÔNG được ném ra ngoài (tin đã gửi rồi)', async () => {
  const api = apiGia();
  const kq = await guiVaoNhom(api, '111', 'x', {
    ghiLai: () => {
      throw new Error('DB hỏng');
    },
  });
  // Ném ra là caller tưởng gửi hỏng rồi gửi lại -> anh nhận hai tin giống hệt.
  assert.equal(typeof kq.msgId, 'string');
  assert.equal(api.goi.length, 1);
});

test('C6 lỗi gửi -> cleanError, KHÔNG rò cookie trong thông điệp', async () => {
  const api = apiGia(new Error('connect ECONNREFUSED; Cookie: zpsid=BI_MAT_123456'));
  await assert.rejects(() => guiVaoNhom(api, '111', 'x'), (e) => {
    assert.match(e.message, /Gửi tin vào 111 thất bại/);
    assert.equal(e.message.includes('BI_MAT_123456'), false, 'lộ nguyên cookie ra thông điệp lỗi');
    return true;
  });
});

test('C7 tin RỖNG bị từ chối, chưa api nào được gọi', async () => {
  const api = apiGia();
  await assert.rejects(() => guiVaoNhom(api, '111', ''), /RỖNG/);
  await assert.rejects(() => guiVaoNhom(api, '111', '   \n  '), /RỖNG/);
  assert.equal(api.goi.length, 0);
});

test('C8 chưa có phiên Zalo -> lỗi đọc được, không nổ TypeError', async () => {
  await assert.rejects(() => guiVaoNhom({}, '111', 'x'), /Chưa có phiên Zalo/);
  await assert.rejects(() => guiVaoNhom(null, '111', 'x'), /Chưa có phiên Zalo/);
});

test('C9 thiếu chatId -> ném NGAY, không gửi mò', async () => {
  const api = apiGia();
  await assert.rejects(() => guiVaoNhom(api, null, 'x'), /Thiếu ID bắt buộc/);
  assert.equal(api.goi.length, 0);
});

test('C10 text quá dài -> gửi bản đã cắt và báo daCat', async () => {
  const api = apiGia();
  const kq = await guiVaoNhom(api, '111', 'z'.repeat(GIOI_HAN.DO_DAI_TIN_TOI_DA + 100));
  assert.equal(kq.daCat, true);
  assert.ok(api.goi[0].noiDung.msg.length <= GIOI_HAN.DO_DAI_TIN_TOI_DA);
});

test('C11 styles được truyền sang sendMessage; không có style thì bỏ hẳn field', async () => {
  const api = apiGia();
  await guiVaoNhom(api, '111', '**đậm**');
  assert.ok(Array.isArray(api.goi[0].noiDung.styles));
  await guiVaoNhom(api, '111', 'trơn');
  assert.equal(api.goi[1].noiDung.styles, undefined);
});

test('C12 guiAnh đính kèm ảnh; chú thích vào contentRaw vì schema cấm noi_dung', async () => {
  const api = apiGia();
  const daGhi = [];
  await guiAnh(api, '111', '/tmp/bang.png', 'bảng tuần này', { ghiLai: (t) => daGhi.push(t) });
  assert.equal(api.goi[0].noiDung.attachments, '/tmp/bang.png');
  const t = daGhi[0];
  assert.equal(t.msgType, 'chat.image');
  assert.equal(t.noiDung, null, 'schema: msg_type != chat.text thì noi_dung PHẢI null');
  assert.equal(JSON.parse(t.contentRaw).chuThich, 'bảng tuần này');
  assert.equal(JSON.parse(t.contentRaw)._doTroLyTao, true);
});

test('C13 guiAnh thiếu nguồn ảnh -> ném', async () => {
  await assert.rejects(() => guiAnh(apiGia(), '111', null, 'x'), /thiếu nguồn ảnh/);
});

// ═══════════════════════════════════════════════════════════════════════════
// D. THROTTLE
// ═══════════════════════════════════════════════════════════════════════════

test('D1 ★ giãn cách tối thiểu giữa 2 tin liên tiếp', async () => {
  const cu = datThrottle({ minKhoangCachMs: 120, toiDaMoiPhut: 100000 });
  datLaiThrottle();
  try {
    const api = apiGia();
    const t0 = Date.now();
    await guiVaoNhom(api, '111', 'một');
    await guiVaoNhom(api, '111', 'hai');
    await guiVaoNhom(api, '111', 'ba');
    const troi = Date.now() - t0;
    assert.ok(troi >= 240, `3 tin chỉ mất ${troi}ms — throttle không có tác dụng`);
    assert.equal(api.goi.length, 3);
  } finally {
    datThrottle(cu);
    datLaiThrottle();
  }
});

test('D2 ★ gọi SONG SONG cũng không lọt qua cổng cùng lúc', async () => {
  const cu = datThrottle({ minKhoangCachMs: 80, toiDaMoiPhut: 100000 });
  datLaiThrottle();
  try {
    const moc = [];
    const api = {
      async sendMessage() {
        moc.push(Date.now());
        return { message: { msgId: 1 }, attachment: [] };
      },
    };
    const t0 = Date.now();
    // Không await từng cái: bắn 3 lời gọi cùng lúc.
    await Promise.all([1, 2, 3].map((i) => guiVaoNhom(api, '111', `tin ${i}`)));
    assert.equal(moc.length, 3);
    assert.ok(Date.now() - t0 >= 160, 'chạy song song thì throttle thành trang trí');
    for (let i = 1; i < moc.length; i++) {
      assert.ok(moc[i] - moc[i - 1] >= 60, `2 tin cách nhau ${moc[i] - moc[i - 1]}ms`);
    }
  } finally {
    datThrottle(cu);
    datLaiThrottle();
  }
});

test('D3 giá trị MẶC ĐỊNH đủ chậm để không giống máy bắn tin', () => {
  // Đọc THROTTLE_MAC_DINH chứ KHÔNG đọc THROTTLE: đầu file này đã nới
  // throttle cho test chạy nhanh, assert lên chính cái vừa nới thì luôn xanh
  // và bài test thành vô dụng (bản đầu của em đã dính đúng lỗi đó).
  assert.ok(THROTTLE_MAC_DINH.minKhoangCachMs >= 1000, 'nhanh hơn 1 tin/giây là không còn giống người');
  assert.ok(THROTTLE_MAC_DINH.toiDaMoiPhut <= 30);
  assert.equal(Object.isFrozen(THROTTLE_MAC_DINH), true, 'mặc định phải đóng băng để không ai nới ngầm');
});

// ═══════════════════════════════════════════════════════════════════════════
// E. LUẬT CHUNG CỦA PACK
// ═══════════════════════════════════════════════════════════════════════════

const NGUON = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'src', 'zalo', 'send.js'),
  'utf8',
);

test('E1 ★ TUYỆT ĐỐI không gọi sendSeenEvent/sendTypingEvent/sendDeliveredEvent', () => {
  // Ba API này là opt-in — gọi một cái là mất hẳn tính "âm thầm".
  for (const ten of ['sendSeenEvent', 'sendTypingEvent', 'sendDeliveredEvent']) {
    assert.equal(
      new RegExp(`\\.\\s*${ten}\\s*\\(`).test(NGUON),
      false,
      `send.js có gọi ${ten}`,
    );
  }
});

test('E2 hành vi: gửi một tin KHÔNG chạm bất kỳ API nào ngoài sendMessage', async () => {
  // Kiểm bằng HÀNH VI chứ không chỉ quét chữ: api giả bẫy mọi thuộc tính lạ.
  const daGoi = [];
  const api = new Proxy(
    {
      async sendMessage() {
        daGoi.push('sendMessage');
        return { message: { msgId: 1 }, attachment: [] };
      },
    },
    {
      get(muc, ten) {
        if (ten in muc) return muc[ten];
        if (typeof ten === 'string') daGoi.push(`LẠ:${ten}`);
        return undefined;
      },
    },
  );
  await guiVaoNhom(api, '111', 'x');
  assert.deepEqual(daGoi.filter((x) => x.startsWith('LẠ:')), []);
  assert.deepEqual(daGoi, ['sendMessage']);
});

test('E3 send.js KHÔNG có console.log (stdout là kênh giao thức MCP)', () => {
  assert.equal(/console\.log\s*\(/.test(NGUON), false);
});

test('E4 send.js KHÔNG import src/store (không có db handle, và mở DB thứ 2 là khoá chéo)', () => {
  assert.equal(/from\s+['"][^'"]*\/store\//.test(NGUON), false);
  assert.equal(/from\s+['"][^'"]*\/mcp\//.test(NGUON), false);
});

test('E5 mọi ID đi qua toId/toIdRequired, không String(x) trần cho ID', () => {
  assert.match(NGUON, /toIdRequired\(/);
  assert.match(NGUON, /toId\(kq\?\.message\?\.msgId/);
});

// ═══════════════════════════════════════════════════════════════════════
// G. TAG NGƯỜI (@mention) — số đo lấy từ TIN THẬT của Zalo
//
// 🔴 Tin THẬT anh gửi trong nhóm Haceco KT 20/08/2026:
//        nội dung : "Test tag @Hảis Assistant"
//        mentions : [{ uid: "999200000000000002", pos: 9, len: 15, type: 0 }]
//    Đây là mention do CHÍNH ZALO sinh ra, nên nó là thước đo trọng tài cho
//    câu hỏi "pos/len đếm theo đơn vị nào" mà G7 phải để ngỏ (không được
//    đăng nhập Zalo thật nên trước đó chỉ suy từ mã nguồn zca-js).
// ═══════════════════════════════════════════════════════════════════════

const BOT_THAT = '999200000000000002';
const TEN_BOT = 'Hảis Assistant';
const CAU_THAT = 'Test tag @Hảis Assistant';

test('G1 ★ khớp ĐÚNG số Zalo thật trả về: pos=9, len=15', () => {
  const kq = dungMentions(CAU_THAT, [{ uid: BOT_THAT, ten: TEN_BOT }]);
  assert.equal(kq.mentions.length, 1);
  assert.deepEqual(kq.mentions[0], { uid: BOT_THAT, pos: 9, len: 15 });
});

test('G2 ★ len BAO GỒM ký tự @ — bỏ nó ra là lệch 1, tag trỏ nhầm chỗ', () => {
  const kq = dungMentions(CAU_THAT, [{ uid: BOT_THAT, ten: TEN_BOT }]);
  assert.equal(kq.mentions[0].len, `@${TEN_BOT}`.length);
  assert.notEqual(kq.mentions[0].len, TEN_BOT.length, 'Zalo thật trả 15, không phải 14');
});

test('G3 ★ đơn vị đếm là NFC/UTF-16 — NFD cho 16 chứ không phải 15', () => {
  // Chứng minh bài G1 KHÔNG phải ăn may: chữ "ả" tách tổ hợp thì dài thêm 1.
  assert.equal(`@${TEN_BOT}`.normalize('NFD').length, 16);
  assert.equal(`@${TEN_BOT}`.normalize('NFC').length, 15);
  // Đưa vào bản NFD, hàm phải tự chuẩn hoá NFC rồi cho lại đúng 15.
  const kq = dungMentions(CAU_THAT.normalize('NFD'), [{ uid: BOT_THAT, ten: TEN_BOT.normalize('NFD') }]);
  assert.equal(kq.mentions[0].len, 15);
  assert.equal(kq.mentions[0].pos, 9);
});

test('G4 🔴 KHÔNG tra ra uid -> để nguyên chữ, TUYỆT ĐỐI không bịa uid', () => {
  const kq = dungMentions('nhờ @Người Lạ xem giúp', [{ uid: BOT_THAT, ten: TEN_BOT }]);
  assert.deepEqual(kq.mentions, [], 'không có bằng chứng thì không tag — chữ vẫn còn, người đọc vẫn hiểu');
});

test('G5 🔴 TRÙNG TÊN -> không đoán, không tag ai, và BÁO ra', () => {
  const ds = [{ uid: '111', ten: 'Hải' }, { uid: '222', ten: 'Hải' }];
  const kq = dungMentions('@Hải xem giúp', ds);
  assert.deepEqual(kq.mentions, [], 'tag nhầm người trong nhóm công việc thật là làm phiền người khác');
  assert.deepEqual(kq.trungTen, ['Hải']);
  assert.deepEqual(kq.khongTraRa, ['Hải']);
});

test('G6 khớp THAM LAM tên dài nhất: "@Lan Anh" thắng "@Lan"', () => {
  const ds = [{ uid: '111', ten: 'Lan' }, { uid: '222', ten: 'Lan Anh' }];
  const kq = dungMentions('@Lan Anh ơi', ds);
  assert.equal(kq.mentions.length, 1);
  assert.equal(kq.mentions[0].uid, '222', 'khớp ngắn trước là tag nhầm sang người tên Lan');
  assert.equal(kq.mentions[0].len, '@Lan Anh'.length);
});

test('G7 nhiều mention: pos của cái sau tính trên CÙNG chuỗi, không cộng dồn', () => {
  const ds = [{ uid: '111', ten: 'An' }, { uid: '222', ten: 'Bình' }];
  const cau = 'chào @An và @Bình nhé';
  const kq = dungMentions(cau, ds);
  assert.equal(kq.mentions.length, 2);
  assert.equal(kq.mentions[0].pos, cau.indexOf('@An'));
  assert.equal(kq.mentions[1].pos, cau.indexOf('@Bình'));
});

test('G8 KHÔNG tự đặt trường `type` — @All là quyết định của zca-js, không phải của ta', () => {
  // zca-js tự tính `type: m.uid == "-1" ? 1 : 0` (apis/sendMessage.js).
  // Hàm này chỉ trả uid/pos/len. Tự gán `type` là mở đường phát @All ngoài ý
  // muốn — cả nhóm nhận thông báo vì một câu trả lời của bot.
  const kq = dungMentions('chào @An', [{ uid: '111', ten: 'An' }]);
  assert.deepEqual(Object.keys(kq.mentions[0]).sort(), ['len', 'pos', 'uid']);
});

test('G9 tổng độ dài mention KHÔNG vượt độ dài tin (zca-js sẽ NÉM nếu vượt)', () => {
  const ds = [{ uid: '111', ten: 'An' }, { uid: '222', ten: 'Bình' }];
  const cau = '@An @Bình';
  const kq = dungMentions(cau, ds);
  const tong = kq.mentions.reduce((a, m) => a + m.len, 0);
  assert.ok(tong <= cau.length, `tổng ${tong} > ${cau.length} là zca-js ném giữa luồng gửi`);
});

// ═══════════════════════════════════════════════════════════════════════
// H. GHI LẠI CHÍNH CÂU TRẢ LỜI CỦA TRỢ LÝ  (bug đo thật 20/08/2026)
//
// 🔴 `SELECT * FROM tin_nhan WHERE do_tro_ly_tao=1` ra RỖNG trong khi trợ lý
//    đã trả lời thật trong nhóm ⇒ đọc lại kho chỉ thấy câu hỏi, không thấy
//    câu trả lời. Nguyên nhân: 4 chỗ gọi trong `mcp/tools.js` không truyền
//    `ghiLai`. `send.js` CÓ kêu cảnh báo, nhưng cảnh báo ở stderr của tiến
//    trình nền nên không ai đọc — cảnh báo không thay được bài test.
// ═══════════════════════════════════════════════════════════════════════

test('H1 có ghiLai -> câu trả lời vào kho, kèm uid bot tiêm từ ngoài', async () => {
  const api = apiGia();
  const ghi = [];
  datThrottle({ moiTinMs: 0, dmMs: 0 });
  await guiVaoNhom(api, '9995000000000000005', 'Dạ em xem rồi ạ', {
    ghiLai: (t) => ghi.push(t),
    uidTroLy: '999200000000000002',
  });
  datLaiThrottle();
  assert.equal(ghi.length, 1);
  assert.equal(ghi[0].noiDung, 'Dạ em xem rồi ạ');
  assert.equal(ghi[0].tuToi, true);
  assert.equal(ghi[0].userId, '999200000000000002',
    'để null thì câu trả lời nằm trong kho không phân biệt được với dòng thiếu dữ liệu');
});

test('H2 KHÔNG có ghiLai -> phải KÊU, vì đây đúng là cách bug vừa rồi xảy ra', async () => {
  const api = apiGia();
  const goc = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  datThrottle({ moiTinMs: 0, dmMs: 0 });
  try {
    await guiVaoNhom(api, '111', 'xin chào');
  } finally {
    process.stderr.write = goc;
    datLaiThrottle();
  }
  assert.ok(keu.join('').includes('KHÔNG được ghi vào lịch sử'));
});

test('H3 mention chỉ đi vào NHÓM — trong DM zca-js bỏ hết, đừng gửi thừa', async () => {
  const api = apiGia();
  datThrottle({ moiTinMs: 0, dmMs: 0 });
  await guiDmHost(api, 'dm1', 'chào @An', { dsNguoi: [{ uid: '111', ten: 'An' }] });
  datLaiThrottle();
  assert.equal(api.goi[0].type, ThreadType.User);
  assert.equal(api.goi[0].noiDung.mentions, undefined);
});

test('H4 gửi vào NHÓM có dsNguoi -> mentions đi kèm đúng khuôn zca-js', async () => {
  const api = apiGia();
  datThrottle({ moiTinMs: 0, dmMs: 0 });
  await guiVaoNhom(api, 'nhom1', 'nhờ @An xem giúp', { dsNguoi: [{ uid: '111', ten: 'An' }] });
  datLaiThrottle();
  const m = api.goi[0].noiDung.mentions;
  assert.equal(m.length, 1);
  assert.equal(m[0].uid, '111');
  // Cắt lại bằng chính pos/len sinh ra — lệch offset là lộ ngay.
  assert.equal(api.goi[0].noiDung.msg.slice(m[0].pos, m[0].pos + m[0].len), '@An');
});

test('H5 tag người KHÔNG có trong nhóm -> gửi tin KHÔNG kèm mentions nào', async () => {
  const api = apiGia();
  datThrottle({ moiTinMs: 0, dmMs: 0 });
  await guiVaoNhom(api, 'nhom1', 'nhờ @Người Lạ xem', { dsNguoi: [{ uid: '111', ten: 'An' }] });
  datLaiThrottle();
  assert.equal(api.goi[0].noiDung.mentions, undefined, 'không có bằng chứng thì không tag');
  assert.ok(api.goi[0].noiDung.msg.includes('@Người Lạ'), 'chữ vẫn phải còn nguyên');
});

// ═══════════════════════════════════════════════════════════════════════
// I. GỬI TIN DÀI — CHIA, không CẮT
// ═══════════════════════════════════════════════════════════════════════

const RAT_DAI = 'Câu trả lời rất dài. '.repeat(400);   // ~8.000 ký tự

test('I1 tin dài -> nhiều tin, gộp lại KHÔNG mất chữ nào', async () => {
  const api = apiGia();
  datThrottle({ moiTinMs: 0, dmMs: 0, minKhoangCachMs: 0, toiDaMoiPhut: 999 });
  const kq = await guiNhieuPhan(api, 'nhom1', RAT_DAI);
  datLaiThrottle();
  assert.ok(kq.soPhan > 1, `phải chia, thực tế ${kq.soPhan}`);
  assert.equal(api.goi.length, kq.soPhan, 'mỗi phần một lần gọi sendMessage');
  assert.equal(kq.daCat, false, 'chưa chạm trần 5 tin thì không được thiếu chữ');

  // Bỏ tiền tố "n/m " rồi gộp lại. So sau khi BỎ HẾT khoảng trắng: `splitMessage`
  // trim từng phần nên khoảng trắng ở mối nối biến mất — đó là bình thường.
  // Cái phải chứng minh ở đây là KHÔNG MẤT KÝ TỰ NÀO; chuyện không cắt giữa
  // từ đã có bộ test riêng của `split_message.js` lo.
  const bo = (x) => x.replace(/\s+/g, '');
  const gop = api.goi.map((g) => g.noiDung.msg.replace(/^\d+\/\d+ /, '')).join('');
  assert.equal(bo(gop), bo(RAT_DAI), 'gộp lại phải ra đúng bản gốc — thiếu là mất chữ');
});

test('I2 ★ CHỨNG MINH không cắt chồng: catAnToan() là NO-OP trên mọi phần', async () => {
  const api = apiGia();
  datThrottle({ moiTinMs: 0, dmMs: 0, minKhoangCachMs: 0, toiDaMoiPhut: 999 });
  await guiNhieuPhan(api, 'nhom1', RAT_DAI);
  datLaiThrottle();
  for (const g of api.goi) {
    const m = g.noiDung.msg;
    assert.ok(m.length <= 4000, `phần dài ${m.length} > trần`);
    // Vân tay của catAnToan() là hậu tố này. Có nó nghĩa là đã cắt MẤT chữ.
    assert.ok(!m.includes('[cắt bớt, bản đầy đủ dài'), 'catAnToan() đã cắt -> mất đuôi mà vẫn đánh số như đủ');
    assert.equal(catAnToan(m, 4000).daCat, false, 'catAnToan trên phần này phải là no-op');
  }
});

test('I3 🔴 THROTTLE là thật: các tin cách nhau ≥ minKhoangCachMs', async () => {
  const api = apiGia();
  const moc = [];
  const goc = api.sendMessage.bind(api);
  api.sendMessage = async (...a) => { moc.push(Date.now()); return goc(...a); };

  datThrottle({ moiTinMs: 0, dmMs: 0, minKhoangCachMs: 60, toiDaMoiPhut: 999 });
  await guiNhieuPhan(api, 'nhom1', RAT_DAI);
  datLaiThrottle();

  assert.ok(moc.length >= 2, 'cần ít nhất 2 tin mới đo được giãn cách');
  for (let i = 1; i < moc.length; i += 1) {
    // Bắn song song thì các mốc dính sát nhau -> bài này đỏ.
    assert.ok(moc[i] - moc[i - 1] >= 55, `tin ${i} chỉ cách ${moc[i] - moc[i - 1]}ms — throttle bị vô hiệu`);
  }
});

test('I4 chạm trần số tin -> daCat = true và KÊU (thiếu chữ phải nói ra)', async () => {
  const api = apiGia();
  const goc = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  datThrottle({ moiTinMs: 0, dmMs: 0, minKhoangCachMs: 0, toiDaMoiPhut: 999 });
  let kq;
  try {
    kq = await guiNhieuPhan(api, 'nhom1', 'x '.repeat(20000));   // 40k ký tự
  } finally {
    process.stderr.write = goc;
    datLaiThrottle();
  }
  assert.equal(kq.daCat, true);
  assert.ok(kq.soPhan <= 5, 'trần 5 tin sinh ra để tránh gắn cờ spam — đừng nới');
  assert.ok(keu.join('').includes('ĐÃ THIẾU'), 'thiếu chữ mà im lặng là hỏng câm');
});

test('I5 canChiaNho: chỉ tin THẬT SỰ dài mới cần kênh phụ', () => {
  assert.equal(canChiaNho('ngắn thôi'), false);
  assert.equal(canChiaNho(RAT_DAI), true);
  assert.equal(canChiaNho(''), false);
});

test('I6 tin rỗng -> NÉM, không gửi tin trống', async () => {
  await assert.rejects(() => guiNhieuPhan(apiGia(), 'nhom1', '   \n  '), /RỖNG/);
});

test('I7 ★ một phần gửi HỎNG -> DỪNG NGAY, không bắn nốt phần sau', async () => {
  // Đây mới là thứ vòng lặp tuần tự mua được (giãn cách thì `_xepHang()` lo,
  // kể cả khi bắn song song — phép thử đột biến đã vạch ra hiểu nhầm này).
  const api = apiGia();
  let lan = 0;
  const goc = api.sendMessage.bind(api);
  api.sendMessage = async (...a) => {
    lan += 1;
    if (lan === 2) throw new Error('mạng rớt');
    return goc(...a);
  };
  datThrottle({ moiTinMs: 0, dmMs: 0, minKhoangCachMs: 0, toiDaMoiPhut: 999 });
  await assert.rejects(() => guiNhieuPhan(api, 'nhom1', RAT_DAI));
  datLaiThrottle();
  assert.equal(lan, 2, `đã bắn tiếp ${lan - 2} phần sau khi đứt — câu trả lời dở dang mà vẫn spam`);
});
