/**
 * ═══════════════════════════════════════════════════════════════════════
 * G7 — GỬI TIN. CHỦ SỞ HỮU: G7. Gói khác KHÔNG sửa file này.
 *
 * ⛔ KHÔNG gọi `sendSeenEvent` / `sendTypingEvent` / `sendDeliveredEvent`.
 *    Ba API đó là OPT-IN — không gọi = không phát. Đó chính là cách "âm
 *    thầm" hoạt động, không phải nhờ cài đặt nào. (Khác `zalo-bot-mcp`: nó
 *    CHỦ ĐỘNG gọi `sendChatAction('typing')` mỗi tin đến.)
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 *
 * ═══ ZALO KHÔNG CÓ MARKDOWN ═══
 * `zca-js` chỉ có `TextStyle` theo OFFSET KÝ TỰ (đọc thẳng
 * `node_modules/zca-js/dist/apis/sendMessage.d.ts`):
 *   Bold `b` · Italic `i` · Underline `u` · StrikeThrough `s`
 *   Red `c_db342e` · Orange `c_f27806` · Yellow `c_f7b503` · Green `c_15a85f`
 *   Small `f_13` · Big `f_18` · UnorderedList `lst_1` · OrderedList `lst_2`
 *   Indent `ind_$`
 * KHÔNG monospace, KHÔNG bảng, KHÔNG heading thật, KHÔNG link có nhãn.
 * ⇒ `markdownToZalo()` dịch sang những thứ CÓ THẬT, và **bỏ ký tự markdown**.
 *
 * ═══ 🔴 ĐƠN VỊ CỦA OFFSET — đo thật, và nói rõ chỗ chưa chắc ═══
 * Đo trên máy (20/08/2026), cùng một câu tiếng Việt:
 *      "Báo giá đã duyệt"  NFC -> 16 code unit · NFD -> 21 · UTF-8 -> 22 byte
 *      offset chữ "giá":   NFC = 4 · NFD = 5      (lệch 1 ký tự)
 *      "xong ✅ rồi 👍"     .length = 13 nhưng code point = 12 (cặp surrogate)
 * Ba cách đếm cho ba con số khác nhau ⇒ đoán là bôi đậm trượt chỗ.
 *
 * Bằng chứng dùng để chọn (không phải suy đoán): chính `sendMessage.js` của
 * zca-js validate mentions bằng `if (totalMentionLen > msg.length) throw` —
 * tức thư viện coi `pos`/`len` là **`String.prototype.length` (UTF-16 code
 * unit)**. `Style.start`/`len` cùng khuôn dữ liệu ⇒ dùng cùng đơn vị.
 * Và `handleStyles()` truyền `start`/`len` **NGUYÊN VẸN** sang API, không
 * chuyển đổi gì ⇒ thư viện không "sửa hộ" được.
 *
 * ⚠️ CHƯA XÁC MINH ĐƯỢC (nói thẳng): máy chủ Zalo đếm theo đơn vị nào thì
 * chỉ gửi thật mới biết, mà pack này CẤM đăng nhập Zalo thật. Vì vậy:
 *   · Mọi chuỗi được `normalize('NFC')` TRƯỚC khi tính offset và TRƯỚC khi
 *     gửi — bảo đảm chuỗi đo và chuỗi gửi là MỘT. Đây là phần tự quyết được.
 *   · Nếu M1 thấy style lệch chỗ trên tin có dấu, nghi can số 1 là đơn vị
 *     đếm — đổi `_doDai()` là xong, mọi chỗ khác đã đi qua nó.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { TextStyle, ThreadType } from 'zca-js';

import { GIOI_HAN, MSG_TYPE } from '../lib/hang_so.js';
import { splitMessage, charLength } from '../lib/split_message.js';
import { toId, toIdRequired } from '../lib/ids.js';
import { safeLogText, cleanError } from '../lib/redact.js';

/** @typedef {import('../types.d.ts').TinChuanHoa} TinChuanHoa */

function _canhBao(msg) {
  process.stderr.write(`[zalo/send] ${msg}\n`);
}

/**
 * Độ dài dùng cho MỌI offset trong file này — MỘT chỗ duy nhất.
 * Đổi đơn vị đếm thì sửa đúng hàm này (xem khối "ĐƠN VỊ CỦA OFFSET").
 * @param {string} s
 */
function _doDai(s) {
  return s.length;
}

/** Chuẩn hoá về NFC để chuỗi đo và chuỗi gửi là MỘT. */
function _nfc(s) {
  return typeof s === 'string' ? s.normalize('NFC') : '';
}

// ═══════════════════════════════════════════════════════════════════════
// 1. CẮT AN TOÀN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cắt theo `GIOI_HAN.DO_DAI_TIN_TOI_DA` (4000, hằng số của G0).
 *
 * ⚠️ KHÔNG TÌM THẤY trần độ dài chính thức của Zalo — đã đọc cả
 * `node_modules/zca-js/dist/`: hằng số duy nhất về giới hạn là
 * `MAX_MESSAGES_PER_SEND = 50` (dùng cho sendSeenEvent/sendDeliveredEvent),
 * KHÔNG có hằng nào cho độ dài text. Nên 4000 là con số của CHÍNH TA, không
 * phải của Zalo.
 *
 * 🔴 CẮT thì phải NÓI ĐÃ CẮT. Im lặng nuốt mất đuôi câu trả lời là kiểu hỏng
 * tệ nhất: anh đọc một đáp án trông hoàn chỉnh nhưng thiếu đúng phần kết luận.
 * (Phương án CHIA NHIỀU TIN cũng chạy được nhưng nhân số tin lên — rủi ro
 * cờ spam. Đã báo Router để chọn, mặc định theo đúng chữ hợp đồng: cắt.)
 *
 * @param {string} text
 * @param {number} [tran]
 * @returns {{text: string, daCat: boolean, originalLength: number}}
 */
export function truncateSafely(text, tran = GIOI_HAN.DO_DAI_TIN_TOI_DA) {
  const s = _nfc(text);
  const goc = _doDai(s);
  if (goc <= tran) return { text: s, daCat: false, originalLength: goc };

  const duoi = `\n…[cắt bớt, bản đầy đủ dài ${goc} ký tự]`;
  const chua = Math.max(0, tran - _doDai(duoi));
  return { text: s.slice(0, chua) + duoi, daCat: true, originalLength: goc };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. MARKDOWN -> TextStyle
// ═══════════════════════════════════════════════════════════════════════

/** Cặp dấu inline. `**` phải đứng TRƯỚC `*`, nếu không `**a**` bị đọc thành italic rỗng. */
const DAU_INLINE = [
  ['**', TextStyle.Bold],
  ['__', TextStyle.Bold],
  ['~~', TextStyle.StrikeThrough],
  ['*', TextStyle.Italic],
  ['`', null], // Zalo KHÔNG có monospace -> bỏ dấu, giữ chữ, không tô gì
];

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;

/**
 * Phân tích dấu inline của MỘT dòng đã bỏ dấu khối.
 *
 * 🔴 CHỖ SAI KINH ĐIỂN: offset phải tính trên chuỗi ĐÃ BỎ ký tự markdown.
 * Ở đây `batDau` luôn lấy từ `goc + _doDai(ra)` — tức vị trí trong chuỗi ĐẦU
 * RA đang dựng dở, không phải vị trí trong chuỗi vào. Lệch một ký tự là bôi
 * đậm trượt hết phần sau.
 *
 * Dấu mở KHÔNG có dấu đóng ⇒ giữ NGUYÊN VĂN ký tự đó, không nuốt. Nuốt là
 * làm hỏng nội dung (`2 * 3` mất dấu nhân).
 *
 * @param {string} s
 * @param {number} goc offset của đầu dòng trong toàn tin
 * @returns {{text: string, styles: Array<{start:number,len:number,st:string}>}}
 */
function _inline(s, goc) {
  let ra = '';
  /** @type {Array<{start:number,len:number,st:string}>} */
  const styles = [];
  let i = 0;

  while (i < s.length) {
    let khop = false;
    for (const [dau, st] of DAU_INLINE) {
      if (!s.startsWith(dau, i)) continue;
      const dong = s.indexOf(dau, i + dau.length);
      if (dong === -1 || dong === i + dau.length) continue; // không có đóng / rỗng
      const trong = s.slice(i + dau.length, dong);
      const batDau = goc + _doDai(ra);
      const con = _inline(trong, batDau); // lồng nhau: **đậm *nghiêng* **
      ra += con.text;
      if (st) styles.push({ start: batDau, len: _doDai(con.text), st });
      styles.push(...con.styles);
      i = dong + dau.length;
      khop = true;
      break;
    }
    if (!khop) {
      ra += s[i];
      i += 1;
    }
  }
  return { text: ra, styles };
}

/**
 * Dòng cảnh báo -> màu. Zalo có đúng 4 màu, dùng 2 cái nghĩa rõ nhất.
 * @param {string} dong
 * @returns {string|null}
 */
function _mauCanhBao(dong) {
  const d = dong.trimStart();
  if (d.startsWith('🔴') || d.startsWith('⛔') || d.startsWith('❌')) return TextStyle.Red;
  if (d.startsWith('⚠️') || d.startsWith('⚠')) return TextStyle.Orange;
  if (d.startsWith('✅')) return TextStyle.Green;
  return null;
}

/**
 * Markdown -> `{msg, styles}` cho `api.sendMessage()`.
 *
 * Dịch được: heading -> Big+Bold · `**đậm**`/`__đậm__` -> Bold · `*nghiêng*`
 * -> Italic · `~~gạch~~` -> StrikeThrough · `- ` -> UnorderedList · `1. ` ->
 * OrderedList · `> ` -> Italic · dòng mở đầu bằng 🔴/⚠️/✅ -> màu.
 * Bỏ dấu nhưng KHÔNG tô: `` `code` `` (Zalo không có monospace).
 *
 * ⚠️ KHÔNG dịch được, cố ý bỏ qua chứ không giả vờ: bảng, link có nhãn
 * `[chữ](url)` (Zalo tự bắt URL trần), khối code ```…```, ảnh nhúng.
 *
 * @param {string} md
 * @returns {{msg: string, styles: Array<{start:number,len:number,st:string}>}}
 */
export function markdownToZalo(md) {
  const nguon = _nfc(md);
  const dongVao = nguon.split('\n');
  /** @type {string[]} */
  const dongRa = [];
  /** @type {Array<{start:number,len:number,st:string}>} */
  const styles = [];
  let offset = 0;

  for (const dongGoc of dongVao) {
    let noiDung = dongGoc;
    /** @type {string[]} */
    const styleKhoi = [];

    // Thứ tự quan trọng: nhận dạng KHỐI trước rồi mới tới inline. Nhờ vậy
    // `* mục danh sách` (có khoảng trắng) không bị đọc thành `*nghiêng*`.
    const h = RE_HEADING.exec(noiDung);
    const ol = RE_OL.exec(noiDung);
    const ul = RE_UL.exec(noiDung);
    const q = RE_QUOTE.exec(noiDung);
    if (h) {
      noiDung = h[2];
      styleKhoi.push(TextStyle.Big, TextStyle.Bold);
    } else if (ol) {
      noiDung = ol[1];
      styleKhoi.push(TextStyle.OrderedList);
    } else if (ul) {
      noiDung = ul[1];
      styleKhoi.push(TextStyle.UnorderedList);
    } else if (q) {
      noiDung = q[1];
      styleKhoi.push(TextStyle.Italic);
    }

    const mau = _mauCanhBao(noiDung);
    if (mau) styleKhoi.push(mau);

    const kq = _inline(noiDung, offset);
    const len = _doDai(kq.text);
    for (const st of styleKhoi) if (len > 0) styles.push({ start: offset, len, st });
    styles.push(...kq.styles);

    dongRa.push(kq.text);
    offset += len + 1; // +1 cho ký tự '\n' nối dòng
  }

  return { msg: dongRa.join('\n'), styles };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. THROTTLE
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ KHÔNG TÌM THẤY giới hạn tin/phút chính thức của Zalo. Con số dưới đây
 * là của CHÍNH TA, chọn theo nhịp người thật gõ chứ không theo tài liệu nào:
 * một trợ lý trả lời nhanh hơn 1 tin/giây, hoặc quá 20 tin/phút, thì nhìn
 * từ phía Zalo không còn giống người dùng nữa — mà tài khoản mới bắn nhanh
 * là dễ bị gắn cờ spam (khoá 24–48h), và mất tài khoản thì mất luôn cả pack.
 * Thà chậm.
 */
// ═══════════════════════════════════════════════════════════════════════
// 2b. TAG NGƯỜI (@mention)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Dựng danh sách `mentions` cho zca-js từ các cụm `@Tên` trong CÂU ĐÃ SẴN SÀNG GỬI.
 *
 * ✅ ĐỊNH DẠNG THẬT, đọc từ `zca-js/dist/apis/sendMessage.js` (`handleMentions`):
 *      { pos: number, uid: string, len: number, type: uid == "-1" ? 1 : 0 }
 *    · Lọc `m.pos >= 0 && m.uid && m.len > 0` — phần tử hỏng bị **VỨT LẶNG LẼ**,
 *      không báo lỗi. Nên phải tự kiểm ở đây, đừng trông vào nó.
 *    · `totalMentionLen > msg.length` thì **NÉM** `ZaloApiError` giữa luồng gửi.
 *    · Chỉ áp dụng khi `type == ThreadType.Group`; trong DM zca-js bỏ hết.
 *    · `type: 1` là **@All** (uid `"-1"`) — hàm này KHÔNG tự sinh @All bao giờ.
 *
 * 🔴 `pos`/`len` phải đếm CÙNG ĐƠN VỊ với `msg.length` của zca-js — tức UTF-16
 * code unit. Ở đây dùng `_doDai()` (nguồn duy nhất của pack, xem đầu file) và
 * chỉ số chuỗi JS, hai thứ vốn cùng một đơn vị. **Lệch một ký tự là tag trỏ
 * nhầm người** — trong nhóm công việc thật thì đó là làm phiền người khác.
 *
 * 🔴 CHỐT CHẶN — KHÔNG BAO GIỜ BỊA uid:
 *   · Tên không có trong `dsNguoi` (danh sách người CÓ THẬT trong nhóm đó)
 *     ⇒ để nguyên chữ `@Tên`, không tag. Người đọc vẫn hiểu.
 *   · Hai người TRÙNG TÊN ⇒ KHÔNG đoán, để nguyên chữ. Tag nhầm người còn tệ
 *     hơn không tag.
 *
 * Khớp THAM LAM theo tên dài nhất trước: "@An Bình" phải thắng "@An".
 *
 * @param {string} msg câu đã qua truncateSafely + markdownToZalo (chuỗi SẼ gửi đi)
 * @param {Array<{uid: string, ten: string}>} dsNguoi người có thật trong nhóm
 * @returns {{mentions: Array<{uid: string, pos: number, len: number}>, khongTraRa: string[],
 *            trungTen: string[], khongKhop: string[]}}
 *   `khongKhop` = cụm `@…` KHÔNG khớp ai (B4) — khác hẳn `khongTraRa` (tên TRÙNG nhiều người).
 */
export function buildMentions(msg, dsNguoi) {
  const ra = { mentions: [], khongTraRa: [], trungTen: [], khongKhop: [] };
  const s = _nfc(typeof msg === 'string' ? msg : '');
  if (!s || !Array.isArray(dsNguoi) || dsNguoi.length === 0) return ra;

  /** @type {Map<string, string|null>} tên thường hoá -> uid, null = TRÙNG TÊN */
  const bang = new Map();
  for (const ng of dsNguoi) {
    const ten = _nfc(String(ng?.ten ?? '')).trim();
    const uid = ng?.uid === undefined || ng?.uid === null ? '' : String(ng.uid).trim();
    if (!ten || !uid) continue;
    const khoa = ten.toLowerCase();
    if (bang.has(khoa) && bang.get(khoa) !== uid) {
      bang.set(khoa, null);   // trùng tên, khác người -> cấm đoán
      if (!ra.trungTen.includes(ten)) ra.trungTen.push(ten);
    } else if (!bang.has(khoa)) {
      bang.set(khoa, uid);
    }
  }
  // Dài trước: "Minh Hải" phải được thử trước "Minh".
  const ten = [...bang.keys()].sort((a, b) => b.length - a.length);

  let i = 0;
  while (i < s.length) {
    if (s[i] !== '@') { i += 1; continue; }
    const con = s.slice(i + 1).toLowerCase();
    const khop = ten.find((t) => con.startsWith(t));
    if (khop === undefined) {
      // 🔴 B4 — CHỖ HỎNG CÂM THẬT SỰ CỦA HÀM NÀY.
      // Bản cũ chỉ `i += 1; continue;`: một cụm `@Tên` KHÔNG KHỚP AI đi qua đây
      // hoàn toàn im lặng — không cảnh báo, không đếm, không trả về gì. Tin vẫn
      // gửi, vẫn CÓ CHỮ `@Tên` nên người đọc tưởng đã tag, nhưng người được nhắc
      // KHÔNG nhận thông báo nào. Đây là ca xảy ra khi ai đó ĐỔI TÊN HIỂN THỊ —
      // chuyện thường ngày trên Zalo — mà tên cũ đã đóng băng trong `noi_dung`.
      // ⚠️ `khongTraRa` KHÔNG dùng được cho ca này: nó đang mang nghĩa "tên TRÙNG
      // nhiều người nên không dám đoán" (có bài test canh). Hai chuyện khác hẳn
      // nhau ⇒ trường RIÊNG.
      // Nhãn chỉ lấy CỤM ĐẦU sau `@` (tới khoảng trắng đầu tiên): không có cách
      // nào biết tên định gõ dài mấy từ khi nó không khớp ai. Nhãn là để người
      // đọc nhận ra chỗ hỏng, không phải để so khớp lại.
      const nhan = /^[^\s@]{1,32}/.exec(s.slice(i + 1))?.[0] ?? '';
      const truoc = i === 0 ? '' : s[i - 1];
      // Chỉ tính là "định tag" khi `@` đứng đầu tin hoặc sau khoảng trắng —
      // nếu không thì `a@b.com` cũng bị kêu, và cảnh báo kêu oan thì người ta
      // sẽ học cách bỏ qua nó (đúng thứ làm hỏng mọi hệ cảnh báo).
      if (nhan && (truoc === '' || /\s/.test(truoc)) && !ra.khongKhop.includes(nhan)) {
        ra.khongKhop.push(nhan);
      }
      i += 1; continue;
    }

    const uid = bang.get(khop);
    const nguyenVan = s.slice(i + 1, i + 1 + khop.length);
    if (uid === null) {
      if (!ra.khongTraRa.includes(nguyenVan)) ra.khongTraRa.push(nguyenVan);
    } else {
      ra.mentions.push({ uid, pos: i, len: _doDai(`@${nguyenVan}`) });
    }
    i += 1 + khop.length;   // không cho mention chồng lấn nhau
  }

  // Lưới an toàn cuối: zca-js NÉM nếu tổng độ dài mention > độ dài tin. Các
  // mention ở trên không chồng lấn nên về lý thuyết không thể vượt — nhưng
  // thà bỏ bớt ở đây còn hơn để nó ném GIỮA luồng gửi, lúc đó không biết tin
  // đã đi hay chưa.
  let tong = 0;
  const giu = [];
  for (const m of ra.mentions) {
    if (tong + m.len > _doDai(s)) {
      _canhBao(`bỏ mention @${m.uid}: tổng độ dài mention vượt độ dài tin (zca-js sẽ ném)`);
      continue;
    }
    tong += m.len;
    giu.push(m);
  }
  ra.mentions = giu;
  return ra;
}

/**
 * ★★★ NGUỒN SỰ THẬT DUY NHẤT của luật: "mention của những uid này phải CÓ MẶT
 * trong tin, ĐÚNG MỘT LẦN".
 *
 * ═══ 🔴 VÌ SAO PHẢI LÀ MỘT HÀM, KHÔNG ĐƯỢC CHÉP RA BA CHỖ ═══
 * Trước bản này luật đó nằm rải ở BA nơi, và cả ba đều sai theo một kiểu khác nhau:
 *   · `bo_chay.js: dungNoiDung`  — dán tiền tố `@Tên` VÔ ĐIỀU KIỆN, không thèm
 *     đọc `noiDung` ⇒ nội dung đã có sẵn `@Trọng Nguyễn` thì tin đi ra thành
 *     "@Trọng Nguyễn @Trọng Nguyễn ơi…". Anh đã gặp thật và đã phàn nàn.
 *   · `mcp/tools.js: tra_loi`    — KHÔNG có luật nào cả. Model viết gì gửi nấy,
 *     mà model viết "Trọng ơi" (chữ trần) ⇒ không tag được ai. Cũng gặp thật.
 *   · `send.js: buildMentions`    — chỉ DỊCH `@Tên` sẵn có thành mention, không
 *     có trách nhiệm bảo đảm nó tồn tại.
 * Ba bản sao của một luật là mầm trôi lệch: vá một chỗ thì hai chỗ kia vẫn hỏng,
 * và triệu chứng quay lại dưới dạng khác. Từ đây CẢ BA gọi hàm này.
 *
 * ═══ 🔑 HAI NGUYÊN TẮC, KHÔNG ĐƯỢC NỚI ═══
 * ① **uid là NGUỒN SỰ THẬT, tên tra LÚC GỬI.** Tên hiển thị Zalo đổi được bất cứ
 *    lúc nào; chuỗi tên đóng băng lúc TẠO lời nhắc thì vài ngày sau không còn
 *    khớp ai — và `buildMentions` sẽ bỏ qua trong im lặng. Vì vậy hàm này nhận
 *    **uid** rồi tự tra tên từ `dsNguoi` của CHÍNH lúc gửi.
 * ② **KHÔNG giao model việc dựng mention.** Model là kênh chép chuỗi không đáng
 *    tin: nó diễn đạt lại, bỏ dấu `@`, dùng tên thân mật. Code phải tự bảo đảm.
 *
 * ⚠️ Tên TRÙNG nhiều người ⇒ KHÔNG dán tiền tố, báo vào `trungTen`. Dán một cụm
 * `@Tên` mơ hồ chỉ tạo ra chữ không tag được ai — thêm nhiễu mà không thêm tác dụng.
 *
 * @param {string} text        nội dung gốc (model viết, hoặc code dựng)
 * @param {Array<{uid: string, ten: string}>} dsNguoi người CÓ THẬT trong nhóm, tra LÚC GỬI
 * @param {string[]} uids      uid BẮT BUỘC phải được tag
 * @param {string|null} [uidTroLy] uid CHÍNH BOT — không bao giờ tự tag mình.
 *   Lớp chặn THỨ HAI: `groupMembers` đã lọc bot ở tầng truy vấn, nhưng hàm
 *   này còn nhận `dsNguoi` từ chỗ khác (test, gói khác, tương lai) nên không
 *   được phụ thuộc vào việc người gọi đã lọc sạch. `"0"`/rỗng ⇒ KHÔNG BIẾT,
 *   không lọc ai (uid `"0"` có thể là người thật).
 * @returns {{text: string, daThem: string[], daCoSan: string[], khongTraRa: string[],
 *            trungTen: string[], khongKhop: string[]}}
 *   `daThem`     uid vừa được chèn tiền tố · `daCoSan` uid model đã tự tag đúng
 *   `khongTraRa` uid không tra ra tên trong nhóm (A11 — người chưa từng nhắn)
 *   `trungTen`   uid có tên trùng người khác ⇒ cố ý không tag
 *   `khongKhop`  cụm `@…` trong text không khớp ai (B4 — thường là tên cũ)
 */
export function ensureMention(text, dsNguoi = [], uids = [], uidTroLy = null) {
  const s = _nfc(typeof text === 'string' ? text : '');
  const ra = { text: s, daThem: [], daCoSan: [], khongTraRa: [], trungTen: [], khongKhop: [] };

  // uid bot: gạt khỏi CẢ hai đầu — khỏi danh sách người (để không tra ra tên
  // mình) VÀ khỏi danh sách phải-tag (để không ai ép tag mình được).
  const _uTL = uidTroLy === undefined || uidTroLy === null ? '' : String(uidTroLy).trim();
  const uidBot = _uTL === '' || _uTL === '0' ? null : _uTL;
  if (uidBot !== null) {
    dsNguoi = (dsNguoi ?? []).filter((ng) => String(ng?.uid ?? '').trim() !== uidBot);
    const truoc = (uids ?? []).length;
    uids = (uids ?? []).filter((u) => String(u ?? '').trim() !== uidBot);
    // Từ chối nhưng KHÔNG im lặng: có ai đó đang bảo bot tag chính nó, đó là
    // dấu hiệu dữ liệu hoặc luồng gọi sai — phải nhìn thấy được.
    if (uids.length !== truoc) {
      _canhBao(`có yêu cầu tag CHÍNH BOT (${uidBot}) -> đã từ chối, không dựng mention`);
    }
  }

  // uid -> tên, và đếm tên trùng. Cùng cách thường hoá với `buildMentions` để hai
  // hàm không bao giờ bất đồng về "tên này là của ai".
  const tenTheoUid = new Map();
  const soNguoiCungTen = new Map();
  for (const ng of dsNguoi ?? []) {
    const uid = ng?.uid === undefined || ng?.uid === null ? '' : String(ng.uid).trim();
    const ten = _nfc(String(ng?.ten ?? '')).trim();
    if (!uid || !ten) continue;
    if (!tenTheoUid.has(uid)) tenTheoUid.set(uid, ten);
    const khoa = ten.toLowerCase();
    if (!soNguoiCungTen.has(khoa)) soNguoiCungTen.set(khoa, new Set());
    soNguoiCungTen.get(khoa).add(uid);
  }

  // Ai đã được tag SẴN trong text — hỏi chính `buildMentions`, KHÔNG tự dò lại.
  const daCo = buildMentions(s, dsNguoi);
  ra.khongKhop = daCo.khongKhop ?? [];
  const dangCoUid = new Set(daCo.mentions.map((m) => String(m.uid)));

  const canTag = [...new Set((uids ?? []).map((u) => (u === undefined || u === null ? '' : String(u).trim())).filter(Boolean))];
  const themTen = [];
  for (const uid of canTag) {
    const ten = tenTheoUid.get(uid);
    if (!ten) { ra.khongTraRa.push(uid); continue; }
    if (soNguoiCungTen.get(ten.toLowerCase())?.size > 1) { ra.trungTen.push(uid); continue; }
    if (dangCoUid.has(uid)) { ra.daCoSan.push(uid); continue; }   // ★ A9: đã có thì KHÔNG dán nữa
    ra.daThem.push(uid);
    themTen.push(ten);
  }

  if (themTen.length) ra.text = `${themTen.map((t) => `@${t}`).join(' ')} ${s}`;
  return ra;
}

export const DEFAULT_THROTTLE = Object.freeze({
  minKhoangCachMs: 1200,
  toiDaMoiPhut: 20,
});

/**
 * Cấu hình ĐANG CHẠY — `setThrottle()` sửa thẳng vào đây. Tách khỏi
 * `DEFAULT_THROTTLE` vì bộ test phải nới throttle để chạy cho nhanh, mà nới
 * xong thì không còn chỗ nào kiểm được giá trị GỐC có đủ chậm hay không
 * (bài test đầu tiên của em đã dính đúng lỗi đó: mutate rồi assert lên chính
 * cái vừa mutate, luôn xanh).
 */
export const THROTTLE = { ...DEFAULT_THROTTLE };

/** @type {number[]} mốc các lần gửi gần đây (ms) */
let _lichSu = [];
/** Hàng đợi tuần tự: bảo đảm 2 lời gọi song song KHÔNG cùng lúc lọt qua cổng. */
let _hangDoi = Promise.resolve();

const _nghi = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cho test và cho G8 chỉnh. Trả về cấu hình cũ để khôi phục. */
export function setThrottle(moi = {}) {
  const cu = { ...THROTTLE };
  Object.assign(THROTTLE, moi);
  return cu;
}

/** Xoá lịch sử gửi — CHỈ dùng trong test. */
export function resetThrottle() {
  _lichSu = [];
  _hangDoi = Promise.resolve();
}

/**
 * Chờ tới lượt. Tuần tự hoá bằng một chuỗi promise: nếu chỉ `await _nghi()`
 * mà không xếp hàng thì hai lời gọi đồng thời cùng thấy "đủ giãn cách" rồi
 * bắn cùng lúc — throttle thành trang trí.
 */
function _xepHang() {
  const truoc = _hangDoi;
  let moKhoa;
  _hangDoi = new Promise((r) => {
    moKhoa = r;
  });
  return truoc
    .then(async () => {
      for (;;) {
        const bayGio = Date.now();
        _lichSu = _lichSu.filter((t) => bayGio - t < 60_000);
        const choGianCach = _lichSu.length
          ? Math.max(0, THROTTLE.minKhoangCachMs - (bayGio - _lichSu[_lichSu.length - 1]))
          : 0;
        const choPhut =
          _lichSu.length >= THROTTLE.toiDaMoiPhut
            ? Math.max(0, 60_000 - (bayGio - _lichSu[0]) + 10)
            : 0;
        const cho = Math.max(choGianCach, choPhut);
        if (cho <= 0) break;
        if (choPhut > 0) {
          _canhBao(`đã gửi ${_lichSu.length} tin/phút -> chờ ${cho}ms để không bị gắn cờ spam`);
        }
        await _nghi(cho);
      }
      _lichSu.push(Date.now());
    })
    .finally(() => moKhoa());
}

// ═══════════════════════════════════════════════════════════════════════
// 4. GỬI
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ ĐIỂM HỢP ĐỒNG CÒN THIẾU — ĐÃ BÁO ROUTER:
 * Stub G0 bắt "tin trợ lý gửi PHẢI được ghi vào `tin_nhan` với
 * `do_tro_ly_tao = 1`", NHƯNG chữ ký `sendToGroup(api, chatId, text)` không
 * có `db` lẫn callback nào để làm việc đó, và `types.d.ts` cũng không định
 * nghĩa đường nào.
 * ⇒ KHÔNG tự `import '../store/write.js'` (file này không có `db` handle, và
 *   tự mở DB thứ hai trong tiến trình là mời gọi khoá chéo).
 * ⇒ Nhận `tuyChon.ghiLai(tin)` từ ngoài. G8 nối dây:
 *      sendToGroup(api, id, text, { ghiLai: (t) => writeMessage(db, t, {doTroLyTao:true}) })
 *   Tham số THÊM ở cuối nên mọi lời gọi 3 đối số cũ vẫn chạy.
 * ⚠️ Không truyền `ghiLai` ⇒ lịch sử THIẾU VẾ TRẢ LỜI. Đọc lại chỉ thấy câu
 *   hỏi, không thấy trợ lý đã đáp gì. Vì vậy bỏ trống là có CẢNH BÁO stderr,
 *   không im lặng.
 *
 * @param {any} api
 * @param {string} chatId
 * @param {string} text
 * @param {number} loaiThread ThreadType.Group | ThreadType.User
 * @param {{ghiLai?: (tin: TinChuanHoa) => void, anh?: any, tsZalo?: number}} tuyChon
 * @returns {Promise<{msgId: string|null, daCat: boolean}>}
 */
async function _gui(api, chatId, text, loaiThread, tuyChon = {}) {
  const id = toIdRequired(chatId, 'send.chatId');
  if (!api?.sendMessage) {
    throw cleanError('Chưa có phiên Zalo (api.sendMessage không tồn tại) — chưa gửi được gì.');
  }

  const anh = tuyChon.anh ?? null;
  const cat = truncateSafely(text ?? '');
  const { msg, styles } = markdownToZalo(cat.text);

  // `.trim()` chứ không `!msg`: chuỗi toàn khoảng trắng/xuống dòng KHÔNG rỗng
  // theo JS nhưng rỗng theo mắt người. Bộ test bắt được đúng ca `'   \n  '`
  // lọt qua nhánh `!msg`.
  if (!msg.trim() && !anh) {
    throw cleanError('Từ chối gửi tin RỖNG — Zalo cũng sẽ từ chối, và tin rỗng chỉ gây nhiễu.');
  }

  /** @type {any} */
  const noiDung = { msg, styles: styles.length ? styles : undefined };
  if (anh) noiDung.attachments = anh;

  // Mention: CHỈ trong nhóm (zca-js bỏ hết mentions khi thread là DM) và chỉ
  // khi caller đưa được danh sách người CÓ THẬT trong nhóm đó.
  if (loaiThread === ThreadType.Group && Array.isArray(tuyChon.dsNguoi) && tuyChon.dsNguoi.length) {
    const mt = buildMentions(msg, tuyChon.dsNguoi);
    if (mt.mentions.length) noiDung.mentions = mt.mentions;
    for (const t of mt.khongTraRa) {
      _canhBao(`"@${t}" TRÙNG TÊN nhiều người trong nhóm -> để nguyên chữ, KHÔNG tag ai (cấm đoán)`);
    }
  }

  await _xepHang();

  let kq;
  try {
    kq = await api.sendMessage(noiDung, id, loaiThread);
  } catch (e) {
    // cleanError: KHÔNG kèm `cause` — stack của axios/undici kéo theo header
    // Cookie của phiên Zalo.
    // Truyền `e` làm tham số THỨ HAI chứ không nội suy `e.message` vào chuỗi:
    // cleanError() chạy _cheChuoi() trên tham số đó. Nội suy thẳng là mất lớp che,
    // mà thông điệp lỗi mạng của axios/undici có thể mang theo header Cookie.
    throw cleanError(`Gửi tin vào ${id} thất bại`, e);
  }

  // 🔴 SendMessageResult.msgId là NUMBER trong .d.ts của zca-js. ID Zalo vượt
  // Number.MAX_SAFE_INTEGER ⇒ phải qua toId() ngay, đừng để nó đi tiếp dưới
  // dạng số.
  const msgId = toId(kq?.message?.msgId, 'send.ketQua.msgId');

  _ghiLai(tuyChon, {
    chatId: id,
    msgId,
    // 🔴 TIÊM TỪ NGOÀI, cố ý KHÔNG gọi `api.getOwnId()` ở đây. File này giữ
    // bất biến "gửi một tin chỉ chạm ĐÚNG `api.sendMessage`" (có bài E2 canh)
    // — bất biến đó là thứ bảo đảm trợ lý không vô tình phát seen/typing.
    // Đổi lấy sự tiện tay mà mất nó thì không đáng.
    uidTroLy: tuyChon.uidTroLy ?? null,
    noiDung: msg,
    coAnh: Boolean(anh),
    tsZalo: tuyChon.tsZalo ?? Date.now(),
  });

  return { msgId, daCat: cat.daCat };
}

/**
 * Dựng `TinChuanHoa` cho chính tin vừa gửi rồi đưa cho callback.
 * Lỗi ở đây KHÔNG được ném ra: tin đã gửi đi rồi, ném lỗi làm caller tưởng
 * gửi hỏng và gửi lại lần nữa — anh nhận hai tin giống hệt nhau.
 */
function _ghiLai(tuyChon, { chatId, msgId, noiDung, coAnh, tsZalo, uidTroLy = null }) {
  if (typeof tuyChon.ghiLai !== 'function') {
    _canhBao(
      'không có tuyChon.ghiLai -> tin trợ lý vừa gửi KHÔNG được ghi vào lịch sử. ' +
        'Đọc lại sẽ chỉ thấy câu hỏi, không thấy câu trả lời.',
    );
    return;
  }
  if (msgId === null) {
    _canhBao('Zalo không trả msgId -> không ghi được vào lịch sử (msg_id là khoá chính).');
    return;
  }
  try {
    tuyChon.ghiLai(
      /** @type {TinChuanHoa} */ ({
        chatId,
        msgId,
        cliMsgId: null,
        // uid TÀI KHOẢN BOT. Chú thích cũ ở đây ghi "trợ lý gửi bằng chính tài
        // khoản host" — SAI: bot là tài khoản RIÊNG. Để null thì mọi câu trả
        // lời của trợ lý nằm trong kho với user_id trống, không phân biệt được
        // với dòng thiếu dữ liệu.
        userId: uidTroLy,
        tenLucGui: null,
        // Ảnh DO TRỢ LÝ TẠO RA vẫn thuộc spec H ("chỉ lưu thứ do trợ lý tạo"),
        // nhưng schema bắt msg_type != 'chat.text' thì noi_dung PHẢI null.
        // ⇒ có ảnh thì chú thích đi vào contentRaw (metadata, KHÔNG phải bytes).
        msgType: coAnh ? MSG_TYPE.IMAGE : MSG_TYPE.TEXT,
        noiDung: coAnh ? null : noiDung,
        contentRaw: coAnh
          ? JSON.stringify({ _doTroLyTao: true, chuThich: noiDung })
          : null,
        tsZalo,
        tuToi: true,
        hasHostMention: false,
      }),
    );
  } catch (e) {
    _canhBao(`ghiLai() ném lỗi (${safeLogText(e)}) -> BỎ QUA, tin đã gửi thành công rồi.`);
  }
}

/**
 * @param {any} api
 * @param {string} chatId
 * @param {string} text
 * @param {{ghiLai?: (tin: TinChuanHoa) => void, anh?: any}} [tuyChon]
 * @returns {Promise<{msgId: string|null, daCat: boolean}>}
 */
export async function sendToGroup(api, chatId, text, tuyChon = {}) {
  return _gui(api, chatId, text, ThreadType.Group, tuyChon);
}

/**
 * @param {any} api
 * @param {string} dmChatId
 * @param {string} text
 * @param {{ghiLai?: (tin: TinChuanHoa) => void, anh?: any}} [tuyChon]
 * @returns {Promise<{msgId: string|null, daCat: boolean}>}
 */
export async function sendHostDm(api, dmChatId, text, tuyChon = {}) {
  return _gui(api, dmChatId, text, ThreadType.User, tuyChon);
}

/**
 * Gửi ẢNH kèm chú thích. Dùng cho bảng đã render thành PNG — Zalo không có
 * bảng, nên bảng phải thành ảnh chứ không thành chữ kẻ khung.
 *
 * `nguonAnh` theo đúng `AttachmentSource` của zca-js (đọc từ
 * `dist/models/Attachment.d.ts`): đường dẫn file, HOẶC
 * `{ data: Buffer, filename: 'x.png', metadata: { totalSize, width?, height? } }`.
 *
 * ⚠️ Việc RENDER bảng -> PNG không nằm trong file này (cần trình duyệt
 * headless / thư viện vẽ — đụng Rule 2 "không cài thêm gói"). G7 lo phần
 * GỬI; ai làm phần render thì đưa vào đây đường dẫn PNG. Đã báo Router.
 *
 * @param {any} api
 * @param {string} chatId
 * @param {any} nguonAnh
 * @param {string} [chuThich]
 * @param {{ghiLai?: (tin: TinChuanHoa) => void, laDm?: boolean}} [tuyChon]
 * @returns {Promise<{msgId: string|null, daCat: boolean}>}
 */
export async function sendImage(api, chatId, nguonAnh, chuThich = '', tuyChon = {}) {
  if (!nguonAnh) throw cleanError('sendImage() thiếu nguồn ảnh.');
  return _gui(api, chatId, chuThich, tuyChon.laDm ? ThreadType.User : ThreadType.Group, {
    ...tuyChon,
    anh: nguonAnh,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 6. GỬI TIN DÀI — CHIA thành nhiều tin, KHÔNG CẮT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Gửi một đoạn dài bằng cách CHIA ra nhiều tin và gửi lần lượt.
 *
 * 🔴 KHÁC HẲN `truncateSafely()` — đừng lẫn, hai hàm ngược nhau về bản chất:
 *      splitMessage()   = CHIA  -> giữ ĐỦ nội dung, tốn nhiều tin
 *      truncateSafely() = CẮT   -> MẤT đuôi, chỉ ghi chú "đã cắt"
 *    ⛔ TUYỆT ĐỐI KHÔNG cắt trước rồi mới chia: cắt xong thì đuôi đã mất, mà
 *    người đọc vẫn thấy "1/3, 2/3, 3/3" nên tưởng đã nhận đủ. Hỏng CÂM.
 *
 * ⚠️ `_gui()` bên trong vẫn gọi `truncateSafely()`, và đó KHÔNG phải cắt chồng:
 *    mọi phần do `splitMessage()` sinh ra đều ≤ trần, nên `truncateSafely()` trả về
 *    nguyên văn (`daCat = false`). Nó ở đó làm LƯỚI AN TOÀN cho trường hợp
 *    `splitMessage` lỡ nhả ra một phần quá dài. Có bài test chứng minh no-op.
 *
 * 🔴 THROTTLE KHÔNG phải trang trí: mỗi phần đi qua `_xepHang()`, nơi cưỡng
 *    chế giãn cách `THROTTLE.minKhoangCachMs` (1.200ms) và trần tin/phút.
 *    Tài khoản mới bắn dồn dễ bị gắn cờ spam (khoá 24–48h); trần 5 tin của
 *    `splitMessage` cũng sinh ra vì lý do đó — đừng nới.
 *
 *    ⚠️ ĐÍNH CHÍNH một hiểu nhầm dễ mắc (phép thử đột biến vạch ra): giãn
 *    cách KHÔNG đến từ vòng lặp `await` này. `_xepHang()` tự nối chuỗi
 *    promise nên dù có `Promise.all` thì các tin VẪN đi tuần tự và VẪN đủ
 *    giãn cách. Cái mà vòng lặp tuần tự thật sự mua được là **DỪNG NGAY khi
 *    một phần gửi hỏng** — không bắn tiếp 3 phần sau của một câu trả lời đã
 *    đứt đoạn. Có bài test canh đúng điều đó.
 *
 * @param {any} api
 * @param {string} chatId
 * @param {string} text
 * @param {{ghiLai?: (tin: TinChuanHoa) => void, dsNguoi?: Array<{uid: string, ten: string}>,
 *          uidTroLy?: string|null, laDm?: boolean, tran?: number, soTinToiDa?: number}} [tuyChon]
 * @returns {Promise<{msgId: string|null, msgIds: string[], soPhan: number, daCat: boolean}>}
 *   `daCat = true` nghĩa là CHẠM TRẦN SỐ TIN nên nội dung vẫn thiếu — khác
 *   hẳn `daCat` của `truncateSafely()` (vượt trần độ dài một tin).
 */
export async function sendInParts(api, chatId, text, tuyChon = {}) {
  const kq = splitMessage(text, { tran: tuyChon.tran, soTinToiDa: tuyChon.soTinToiDa });
  if (kq.soPhan === 0) {
    throw cleanError('Từ chối gửi tin RỖNG — Zalo cũng sẽ từ chối, và tin rỗng chỉ gây nhiễu.');
  }

  const loai = tuyChon.laDm ? ThreadType.User : ThreadType.Group;
  /** @type {string[]} */
  const msgIds = [];
  for (const phan of kq.phan) {
    // TUẦN TỰ: mỗi vòng chặn ở `_xepHang()` bên trong `_gui()`.
    // eslint-disable-next-line no-await-in-loop
    const r = await _gui(api, chatId, phan, loai, tuyChon);
    if (r.daCat) {
      // Không thể xảy ra nếu `splitMessage` đúng — nhưng nếu xảy ra thì đó là
      // MẤT CHỮ, phải kêu chứ không nuốt.
      _canhBao(`phần ${msgIds.length + 1}/${kq.soPhan} vẫn bị truncateSafely() cắt -> splitMessage() nhả ra phần quá trần`);
    }
    if (r.msgId) msgIds.push(r.msgId);
  }

  if (kq.daCat) {
    _canhBao(
      `nội dung ${kq.originalLength} ký tự vượt trần ${kq.soPhan} tin -> ĐÃ THIẾU phần cuối. `
      + 'Trần số tin có để tránh gắn cờ spam; muốn đủ thì dùng kênh phụ.',
    );
  }

  return { msgId: msgIds[0] ?? null, msgIds, soPhan: kq.soPhan, daCat: kq.daCat };
}

/** Tin này có phải gửi nhiều phần không (dùng để quyết định có cần kênh phụ). */
export function needsSplitting(text, tran = GIOI_HAN.DO_DAI_TIN_TOI_DA) {
  return charLength(String(text ?? '').trim()) > tran;
}
