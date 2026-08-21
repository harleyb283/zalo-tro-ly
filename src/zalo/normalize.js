/**
 * CHỦ SỞ HỮU: G2. Gói khác KHÔNG sửa file này.
 * Biến payload thô zca-js thành TinChuanHoa / SuKienThuHoi /
 * ReactionChuanHoa / SuKienNhomChuanHoa.
 *
 * 🔴 BẪY ĐÃ BIẾT — đừng phát hiện lại bằng máu:
 *  1. `content` KHAI là `string | TAttachmentContent | TOtherContent` nhưng
 *     THỰC TẾ là CHUỖI JSON phải tự JSON.parse. Docs không nói, chỉ có
 *     trong issue #316 của chính tác giả.
 *  2. TUndo.msgId là ID của CHÍNH SỰ KIỆN. Tin bị thu hồi ở
 *     content.globalMsgId. Ghép nhầm = không khớp dòng nào, KHÔNG báo lỗi.
 *  3. LỆCH KIỂU: TMessage.msgId là string, TUndoContent.globalMsgId là
 *     number ⇒ MỌI ID phải qua toId() (src/lib/ids.js).
 *  4. Reaction từ ĐIỆN THOẠI cho gMsgID = 0 ⇒ msgIdDich null. Bình thường,
 *     không phải lỗi. Đừng hứa ghi đầy đủ reaction.
 *
 *  · Spec H: chỉ tin VĂN BẢN mới được có noiDung. Metadata vào contentRaw
 *    sau khi ĐÃ BỎ mọi trường có thể là bytes/base64.
 *  · msgType lạ ⇒ MSG_TYPE.UNKNOWN + giữ contentRaw.
 *
 * ═══ 🔴 SỬA 20/08/2026 — BUG THẬT: TÊN LOẠI TIN VĂN BẢN LÀ `webchat` ═══
 *
 * Lần chạy thật đầu tiên: 10/10 dòng trong DB có `msg_type='UNKNOWN'` và
 * `noi_dung=NULL`, chữ thật kẹt trong `content_raw`:
 *     {"_msgTypeGoc":"webchat","_khongPhaiJson":true,"_text":"Test trợ lý 1"}
 *
 * Nguyên nhân: `'chat.text'` (và `'chat.image'`) **CHƯA BAO GIỜ TỒN TẠI** —
 * grep toàn bộ `node_modules/zca-js@2.1.2` không có một lần nào. Hai tên đó
 * suy ra từ tài liệu chứ không từ thư viện. Tên THẬT của tin văn bản là
 * `webchat`, của ảnh là `chat.photo`.
 *
 * Hỏng theo kiểu CÂM: không có lỗi nào, không có cảnh báo nào. Nhánh
 * "msgType lạ" nuốt trọn mọi tin và vẫn ghi DB thành công. Chỉ lộ ra khi mở
 * DB xem bằng mắt. Lưới an toàn `_msgTypeGoc` là thứ DUY NHẤT cứu được chữ.
 *
 * Nguồn của bảng ánh xạ dưới: hàm `getClientMessageType()` trong
 * `zca-js/dist/utils.js` — bảng tra chính chủ của thư viện.
 *
 * ⚠️ BẢNG ĐÓ KHÔNG ĐỦ. `chat.delete` xuất hiện thật trong traffic (8/10 dòng
 * đầu tiên) nhưng thư viện KHÔNG hề biết tên này. ⇒ nhánh UNKNOWN +
 * `contentRaw` GIỮ NGUYÊN làm lưới an toàn, và sẽ còn tên lạ nữa.
 *
 * ═══ ĐÃ XÁC MINH 20/08/2026 bằng `node_modules/zca-js@2.1.2/dist/models/*.d.ts` ═══
 * (đọc khai báo kiểu của CHÍNH thư viện đang cài, không phải đoán từ docs)
 *
 *  ✅ TAG HOST — câu hỏi để mở ở G0 mục 7.2.3, nay CÓ ĐÁP ÁN:
 *     `TGroupMessage = TMessage & { mentions: TMention[] | undefined }`
 *     `TMention = { uid: string; pos: number; len: number; type: 0 | 1 }`
 *     ⇒ nhận biết tag bằng TRƯỜNG CÓ CẤU TRÚC, KHÔNG phải dò chuỗi.
 *     ⚠️ `UserMessage` (DM) KHÔNG có `mentions` — trong DM không ai tag được.
 *     ✅ `type: 0|1` — ĐÃ XÁC MINH 20/08/2026 tại `apis/sendMessage.js`
 *        (`handleMentions`): `type: m.uid == "-1" ? 1 : 0` ⇒ **1 = @All**,
 *        uid lúc đó là chuỗi `"-1"`. File này vẫn CHỈ so `uid` — @All có
 *        uid `"-1"` nên không khớp uid trợ lý, tức không tự kích hoạt vì một
 *        cú @All. Đúng tinh thần spec B (im là mặc định).
 *
 *  ✅ ĐỌC LOẠI HỘI THOẠI KHÔNG CẦN `isGroup`: `Message` mang sẵn
 *     `type: ThreadType` (User=0, Group=1) — trường CÔNG KHAI, đúng ngay cả
 *     khi cờ `isGroup` của Undo/Reaction sai (issue #25). Với undo/reaction
 *     thì không có trường này ⇒ phải đối chiếu `threadId` với danh sách nhóm
 *     trong config (xem `loaiHoiThoai()`).
 *
 *  ✅ REACTION: tin đích nằm ở `content.rMsg[].gMsgID`, biểu tượng ở
 *     `content.rIcon`. `Reactions.NONE = ''` nghĩa là GỠ cảm xúc — giữ nguyên
 *     chuỗi rỗng, KHÔNG đổi thành null, để còn phân biệt "gỡ" với "không rõ".
 *
 *  ✅ GROUP EVENT: `GroupEventType` là chuỗi THƯỜNG ('join', 'leave', ...)
 *     trong khi schema.sql viết ví dụ bằng CHỮ HOA ('JOIN'/'LEAVE'/'UNKNOWN')
 *     ⇒ chuẩn hoá về CHỮ HOA ở đây, và giữ tên gốc trong `duLieu._loaiGoc`.
 */

import { MSG_TYPE, LOAI_HOI_THOAI } from '../lib/hang_so.js';
import { toId, toIdBatBuoc, cungId } from '../lib/ids.js';

/** @typedef {import('../types.d.ts').TinChuanHoa} TinChuanHoa */
/** @typedef {import('../types.d.ts').SuKienThuHoi} SuKienThuHoi */
/** @typedef {import('../types.d.ts').ReactionChuanHoa} ReactionChuanHoa */
/** @typedef {import('../types.d.ts').SuKienNhomChuanHoa} SuKienNhomChuanHoa */
/** @typedef {import('../types.d.ts').CauHinh} CauHinh */

// ─────────────────────────────────────────────────────────────────────────
// Trần an toàn cho `contentRaw` / `duLieu`.
//
// Vì sao phải có trần Ở ĐÂY chứ không để DB lo: `content_raw` đi thẳng vào
// prompt gửi model mỗi lần RAG/tool trúng dòng đó. Một payload sticker vài
// trăm KB không làm SQLite gãy, nhưng làm nổ context và tốn tiền — hỏng theo
// kiểu không ai thấy stack trace.
// ─────────────────────────────────────────────────────────────────────────
const TRAN_CONTENT_RAW = 4000;   // ký tự, sau khi JSON.stringify
const TRAN_CHUOI_CON = 512;      // một chuỗi con dài hơn mức này bị coi là "có thể là bytes"
const TRAN_SAU = 4;              // độ sâu object tối đa
const TRAN_PHAN_TU_MANG = 20;    // số phần tử mảng tối đa giữ lại
const TRAN_TRICH_TRA_LOI = 500;  // ký tự trích đoạn tin được trả lời


/**
 * Tên khoá HAY chứa bytes/base64.
 *
 * 🔴 SỬA 20/08/2026 — TÊN KHOÁ KHÔNG CÒN LÀ BẢN ÁN, CHỈ LÀ NGHI VẤN.
 *
 * Bản cũ: khoá nào có tên trong danh sách này là **xoá trắng giá trị**, bất kể
 * bên trong là gì. Hậu quả đo được trên DB thật: khoá `content` — tên nằm
 * trong danh sách — chính là chỗ Zalo để **nội dung tin nhắn**. Mọi tin có
 * `content` dạng object bị ghi vào kho thành:
 *     {"_msgTypeGoc":"webchat","_batThuong":"content không phải chuỗi",
 *      "content":"<đã bỏ: khoá nghi chứa bytes>"}
 * Chữ thật biến mất, không lỗi, không cảnh báo.
 *
 * ⚠️ ĐÂY LÀ LUẬT DÙNG CHUNG, không phải sự cố riêng của `content`: cùng cơ chế
 * đó cũng đang xoá mọi giá trị dưới `data`/`payload`/`chunk` của những msgType
 * chưa ai khảo sát — tức là xoá đúng thứ ta cần để đặt tên cho chúng.
 *
 * Cách sửa (KHÔNG phải thêm ngoại lệ cho một tên khoá):
 *   · Quyết định theo **GIÁ TRỊ**: chuỗi trông như bytes thì bỏ, chuỗi là chữ
 *     người đọc được thì giữ — dù khoá tên gì.
 *   · Tên khoá nghi vấn chỉ **HẠ NGƯỠNG** phát hiện base64 (512 -> 64 ký tự),
 *     tức siết chặt hơn ở đúng chỗ đáng ngờ mà không đụng tới chữ thật.
 *     Chữ tiếng Việt có dấu/khoảng trắng/dấu câu nên KHÔNG khớp base64.
 *   · Giá trị không phải chuỗi thì **ĐỆ QUY** thay vì xoá — bytes thật nằm sâu
 *     bên trong vẫn bị chặn theo giá trị (Buffer/TypedArray/data-URI).
 *
 * Cố ý KHÔNG chặn `href`, `thumb`, `title`, `params`… — đó là URL/metadata,
 * thứ spec H cho phép giữ.
 */
const KHOA_CO_THE_LA_BYTES = new Set([
  'data', 'base64', 'b64', 'buffer', 'bytes', 'binary', 'blob',
  'rawdata', 'filedata', 'imagedata', 'content', 'payload', 'chunk',
]);

const RE_DATA_URI = /^data:[^;,]*;base64,/i;
/**
 * ⚠️ CỐ Ý KHÔNG cho khoảng trắng vào lớp ký tự (chỉ cho xuống dòng — base64
 * hay được ngắt dòng). Bản đầu có `\s` và nó ăn oan một ghi chú dài 9000 ký
 * tự trong chính bộ test này: văn bản dài mà không có dấu câu vẫn khớp
 * "trông như base64". Có dấu tiếng Việt hay dấu câu thì không khớp, nhưng
 * tiếng Anh trần thì khớp — nên bỏ khoảng trắng ra để thu hẹp diện bắt oan.
 */
const RE_BASE64_DAI = /^[A-Za-z0-9+/=\r\n]{512,}$/;

/** Ngưỡng HẠ THẤP, chỉ dùng cho giá trị nằm dưới khoá tên nghi vấn. */
const RE_BASE64_NGAN = /^[A-Za-z0-9+/=\r\n]{64,}$/;

/**
 * @param {unknown} s
 * @param {boolean} [khoaNghi] giá trị này nằm dưới một khoá tên nghi vấn?
 */
function _coVeLaBytes(s, khoaNghi = false) {
  if (typeof s !== 'string') return false;
  if (RE_DATA_URI.test(s)) return true;
  if (s.length > TRAN_CHUOI_CON && RE_BASE64_DAI.test(s)) return true;
  // Dưới khoá nghi vấn thì soi kỹ hơn — nhưng vẫn theo GIÁ TRỊ. Chữ người
  // viết (có dấu, có khoảng trắng, có dấu câu) không bao giờ khớp mẫu này.
  if (khoaNghi && s.length >= 64 && RE_BASE64_NGAN.test(s)) return true;
  return false;
}

/**
 * Bỏ mọi thứ có thể là bytes/base64 khỏi một giá trị bất kỳ, cắt bớt cho gọn.
 * Trả về BẢN SAO — không sửa đối tượng gốc.
 *
 * ⚠️ Chuỗi bị bỏ được thay bằng nhãn `'<đã bỏ: N ký tự>'` chứ KHÔNG xoá hẳn
 * khoá: mất hẳn khoá thì sau này không ai biết loại tin đó từng mang gì, mà
 * đúng thứ ta đang cần là bằng chứng để đặt tên cho các msgType chưa biết.
 *
 * @param {unknown} v
 * @param {number} [sau]
 * @returns {unknown}
 */
export function loBoBytes(v, sau = 0) {
  if (v === null || v === undefined) return v ?? null;
  if (sau > TRAN_SAU) return '<đã cắt: quá sâu>';

  const t = typeof v;
  if (t === 'number' || t === 'boolean') return v;
  if (t === 'bigint') return String(v);
  if (t === 'string') {
    return _coVeLaBytes(v) ? `<đã bỏ: ${v.length} ký tự>` : v;
  }

  // Buffer / TypedArray / ArrayBuffer — bytes thật, bỏ thẳng.
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
    const n = /** @type {any} */ (v).byteLength ?? 0;
    return `<đã bỏ: ${n} byte nhị phân>`;
  }

  if (Array.isArray(v)) {
    const ra = v.slice(0, TRAN_PHAN_TU_MANG).map((x) => loBoBytes(x, sau + 1));
    if (v.length > TRAN_PHAN_TU_MANG) ra.push(`<đã cắt: còn ${v.length - TRAN_PHAN_TU_MANG} phần tử>`);
    return ra;
  }

  if (t === 'object') {
    /** @type {Record<string, unknown>} */
    const ra = {};
    for (const [k, val] of Object.entries(/** @type {object} */ (v))) {
      const nghi = KHOA_CO_THE_LA_BYTES.has(k.toLowerCase());
      if (typeof val === 'string') {
        // Quyết theo GIÁ TRỊ. Khoá nghi vấn chỉ làm ngưỡng chặt hơn, KHÔNG
        // tự nó kết tội — xem khối chú thích ở `KHOA_CO_THE_LA_BYTES`.
        ra[k] = _coVeLaBytes(val, nghi) ? `<đã bỏ: ${val.length} ký tự>` : val;
        continue;
      }
      // Không phải chuỗi thì ĐỆ QUY chứ không xoá: Buffer/TypedArray/data-URI
      // nằm sâu bên trong vẫn bị chặn ở đúng nhánh của chúng, còn object có
      // trường text thì giữ được text.
      ra[k] = loBoBytes(val, sau + 1);
    }
    return ra;
  }

  return `<đã bỏ: kiểu ${t}>`;
}

/**
 * JSON.stringify an toàn + cắt theo trần. Không bao giờ ném lỗi.
 * @param {unknown} v
 * @returns {string|null}
 */
function _chuoiHoaGon(v) {
  if (v === null || v === undefined) return null;
  let s;
  try {
    s = JSON.stringify(loBoBytes(v));
  } catch {
    // Vòng lặp tham chiếu hoặc BigInt lọt lưới — vẫn phải để lại dấu vết.
    try {
      s = JSON.stringify({ _khongChuoiHoaDuoc: true, _kieu: typeof v });
    } catch {
      return null;
    }
  }
  if (s === undefined || s === null) return null;
  if (s.length > TRAN_CONTENT_RAW) {
    return `${s.slice(0, TRAN_CONTENT_RAW)}…<CẮT ${s.length} ký tự>`;
  }
  return s;
}

/**
 * `ts` của zca-js là CHUỖI mili-giây ('1755678901234'). Trả về số, hoặc null
 * nếu không đọc được — KHÔNG bịa `Date.now()` ở đây.
 * @param {unknown} v
 * @returns {number|null}
 */
export function docTs(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * Như `docTs` nhưng dùng cho cột NOT NULL (`tin_nhan.ts_zalo`).
 *
 * ⚠️ Không đọc được thì lấy giờ NHẬN làm xấp xỉ — nhưng PHẢI kêu ra stderr.
 * Bỏ dòng tin chỉ vì thiếu mốc thời gian là mất dữ liệu thật; im lặng thay
 * bằng giờ máy lại là bịa. Nên: vẫn ghi, và luôn để lại tiếng động.
 * @param {unknown} v
 * @param {string} boiCanh
 * @returns {number}
 */
function _docTsBatBuoc(v, boiCanh) {
  const ts = docTs(v);
  if (ts !== null) return ts;
  const thay = Date.now();
  process.stderr.write(
    `[normalize] ${boiCanh}: không đọc được ts (${String(v)}) -> dùng giờ nhận ${thay}\n`,
  );
  return thay;
}

function _chuoiHoacNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// ═══════════════════════════════════════════════════════════════════════
// 0. BẢNG ÁNH XẠ msgType — TÊN THẬT CỦA ZALO → HẰNG SỐ CHUẨN NỘI BỘ
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tên THẬT (Zalo gửi ra) → hằng số chuẩn trong `hang_so.js`.
 *
 * Hai cột danh tính khác nhau, đừng trộn:
 *   · KHOÁ  = tên Zalo thật, dùng để SO KHỚP payload đến.
 *   · GIÁ TRỊ = hằng số nội bộ, dùng để GHI cột `tin_nhan.msg_type`.
 *
 * Ghi bằng hằng số nội bộ để `MSG_TYPE_CO_NOI_DUNG` ở `write.js` (chốt chặn
 * spec H, KHÔNG thuộc quyền sửa của file này) vẫn thi hành đúng, và để 10
 * dòng dữ liệu cũ không bị lệch từ vựng với dòng mới.
 *
 * Độ tin cậy từng dòng — ghi rõ vì không đồng đều:
 *   ✅ ĐO THẬT trên traffic 20/08/2026 : `webchat`
 *   🟡 TỪ BẢNG TRA CỦA THƯ VIỆN        : `chat.photo`, `chat.link`
 *   ⚪ TÊN CŨ CỦA CHÍNH PACK NÀY       : `chat.text`, `chat.image`
 *      → GIỮ LẠI có chủ đích: thêm chứ không thay. Bộ test cũ và 10 dòng DB
 *        cũ đang dùng chúng; bỏ đi là làm vỡ thứ đang chạy để đổi lấy sự
 *        gọn gàng — không đáng.
 */
const TEN_THAT_SANG_CHUAN = new Map([
  ['webchat', MSG_TYPE.TEXT],
  ['chat.text', MSG_TYPE.TEXT],
  ['chat.photo', MSG_TYPE.IMAGE],
  ['chat.image', MSG_TYPE.IMAGE],
  ['chat.link', MSG_TYPE.LINK],
]);

/**
 * Tên đã CÓ NGƯỜI NHÌN THẤY — hoặc trong mã nguồn zca-js, hoặc trong traffic
 * thật. KHÔNG phải danh sách được hỗ trợ; chỉ để phân biệt hai ca rất khác
 * nhau mà nếu gộp thì mất tín hiệu:
 *
 *   · tên ở TRONG tập này  → biết là gì, chỉ là pack chưa có ô để xếp
 *                            (vd `chat.voice`) ⇒ im lặng, không cần ai xem.
 *   · tên NGOÀI tập này    → chưa ai từng thấy ⇒ đánh dấu `_tenLa` để có
 *                            người đi xem. Đúng hạng mục đã đẻ ra bug
 *                            `webchat`, nên đáng một cái cờ.
 *
 * ⚠️ `chat.zalo.me` KHÔNG có trong đây: nó là TÊN MIỀN
 * (`https://chat.zalo.me`), không phải msgType. Suýt lọt vào vì grep bắt
 * đúng dạng chuỗi `chat.*`.
 */
const TEN_THAT_DA_BIET = new Set([
  ...TEN_THAT_SANG_CHUAN.keys(),
  // getClientMessageType() — zca-js/dist/utils.js
  'chat.voice', 'chat.sticker', 'chat.doodle', 'chat.recommended',
  'chat.video.msg', 'share.file', 'chat.gif', 'chat.location.new',
  // xử lý quote trong sendMessage.js
  'chat.todo', 'group.poll',
  // ĐO THẬT 20/08/2026 — thư viện KHÔNG biết tên này
  'chat.delete',
]);

/** Tên gốc về dạng so khớp được. Không đổi giá trị đem đi ghi DB. */
function _chuanTen(v) {
  const s = _chuoiHoacNull(v);
  return s === null ? null : s.toLowerCase();
}

/**
 * Tin này có phải VĂN BẢN không — tức có được phép mang `noiDung` không.
 *
 * 🔴 Đây là chốt chặn spec H phía normalize. Trước đây chỗ này so cứng
 * `msgType === 'chat.text'`, mà `'chat.text'` không có thật ⇒ điều kiện
 * KHÔNG BAO GIỜ đúng ⇒ mọi tin văn bản đều rơi xuống nhánh "loại khác".
 *
 * @param {string|null} msgTypeGoc tên GỐC từ payload
 * @returns {boolean}
 */
export function laVanBan(msgTypeGoc) {
  return TEN_THAT_SANG_CHUAN.get(_chuanTen(msgTypeGoc) ?? '') === MSG_TYPE.TEXT;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. TIN NHẮN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Đọc thông tin REPLY/QUOTE — "tin này đang trả lời tin nào".
 *
 * ✅ TÊN TRƯỜNG THẬT, đọc từ `zca-js@2.1.2/dist/models/Message.d.ts`:
 *      TMessage.quote?: TQuote
 *      TQuote = { ownerId: string; cliMsgId: number; globalMsgId: number;
 *                 cliMsgType: number; ts: number; msg: string;
 *                 attach: string; fromD: string; ttl: number }
 *
 * 🔴 BẪY GIỐNG HỆT THU HỒI (bẫy 2+3 ở đầu file), đừng vấp lại:
 *   · Tin ĐƯỢC TRẢ LỜI nằm ở `quote.globalMsgId`, KHÔNG phải `msgId` của tin
 *     hiện tại.
 *   · `globalMsgId`/`cliMsgId` khai là **NUMBER** trong khi `tin_nhan.msg_id`
 *     là **TEXT** ⇒ bắt buộc qua `toId()`, nếu không thì ghép không ra dòng
 *     nào mà cũng chẳng có lỗi.
 *   · `ownerId` là tác giả TIN GỐC, KHÔNG phải người bấm trả lời (người bấm
 *     nằm ở `uidFrom` của chính tin này).
 *
 * ⚠️ `globalMsgId = 0` được coi là KHÔNG GHÉP ĐƯỢC (giống `gMsgID = 0` của
 * reaction, issue #360) — '0' không phải một msgId. Vẫn giữ `cliMsgId` làm
 * đường ghép dự phòng thay vì vứt cả cụm.
 *
 * ⚠️ `quote.msg` khai `string` nhưng với tin đính kèm thì thực tế có thể là
 * object (cùng họ với bẫy #316 của `content`) ⇒ không phải chuỗi thì bỏ,
 * KHÔNG `String()` ra `'[object Object]'`.
 *
 * @param {any} quote
 * @returns {{traLoiMsgId: string|null, traLoiCliMsgId: string|null,
 *            traLoiUserId: string|null, traLoiTrich: string|null}}
 */
export function docTraLoi(quote) {
  const rong = {
    traLoiMsgId: null, traLoiCliMsgId: null, traLoiUserId: null, traLoiTrich: null,
  };
  if (!quote || typeof quote !== 'object') return rong;

  const g = toId(quote.globalMsgId, 'quote.globalMsgId');
  const trich = typeof quote.msg === 'string' ? quote.msg.trim() : '';

  return {
    traLoiMsgId: g === null || g === '0' ? null : g,
    traLoiCliMsgId: toId(quote.cliMsgId, 'quote.cliMsgId'),
    traLoiUserId: toId(quote.ownerId, 'quote.ownerId'),
    traLoiTrich: trich === '' ? null : trich.slice(0, TRAN_TRICH_TRA_LOI),
  };
}

/**
 * Đính bằng chứng `mentions` vào `contentRaw` — CHỈ khi tin thật sự có tag.
 *
 * 🔴 Vì sao cần: `co_tag_host` là cờ SUY RA (so `mentions[].uid` với
 * `hosts[].userId` trong config). Trước bản này, payload `mentions` KHÔNG
 * được lưu ở bất cứ đâu ⇒ khi cờ ra 0 thì **không có cách nào** biết là
 * "anh không tag" hay "anh có tag mà so hụt uid". Đúng ca đó đã xảy ra:
 * 2 tin thật trong nhóm Haceco KT đều `co_tag_host=0` và không ai kết luận
 * được gì. Mà đây lại là điều kiện kích hoạt CỐT LÕI của spec B.
 *
 * Tin không tag ai thì KHÔNG đụng tới `contentRaw` — tuyệt đại đa số tin
 * văn bản vẫn giữ `contentRaw = null` như cũ.
 *
 * @param {string|null} contentRaw
 * @param {string|null} msgTypeGoc
 * @param {unknown} mentions
 * @returns {string|null}
 */
function _kemMentions(contentRaw, msgTypeGoc, mentions) {
  if (!Array.isArray(mentions) || mentions.length === 0) return contentRaw;

  // Chỉ giữ 4 trường đã xác minh trong TMention. Bê nguyên phần tử vào là
  // rước theo cả những trường chưa ai đọc, có thể kèm bytes.
  const ds = mentions.slice(0, TRAN_PHAN_TU_MANG).map((m) => ({
    uid: toId(m?.uid, 'mention.uid'),
    pos: typeof m?.pos === 'number' ? m.pos : null,
    len: typeof m?.len === 'number' ? m.len : null,
    type: typeof m?.type === 'number' ? m.type : null,
  }));

  /** @type {Record<string, unknown>} */
  let goi;
  if (contentRaw === null) {
    goi = { _msgTypeGoc: msgTypeGoc ?? null };
  } else {
    try {
      goi = JSON.parse(contentRaw);
    } catch {
      // contentRaw đã bị CẮT ở trần độ dài ⇒ không còn là JSON hợp lệ.
      // Thà mất bằng chứng mentions còn hơn làm hỏng dữ liệu đã có.
      return contentRaw;
    }
  }
  goi._mentions = ds;
  return _chuoiHoaGon(goi);
}

/**
 * @param {any} tho payload thô từ listener 'message' (UserMessage | GroupMessage)
 * @param {{hostUserIds: string[]}} boiCanh
 * @returns {TinChuanHoa}
 */
export function chuanHoaTinNhan(tho, boiCanh) {
  const d = tho?.data ?? {};
  const msgTypeGoc = _chuoiHoacNull(d.msgType);
  const { noiDung, contentRaw: rawGoc } = docNoiDung(msgTypeGoc, d.content);
  const contentRaw = _kemMentions(rawGoc, msgTypeGoc, d.mentions);

  return {
    chatId: toIdBatBuoc(tho?.threadId, 'message.threadId'),
    msgId: toIdBatBuoc(d.msgId, 'message.msgId'),
    cliMsgId: toId(d.cliMsgId, 'message.cliMsgId'),
    userId: toId(d.uidFrom, 'message.uidFrom'),
    tenLucGui: _chuoiHoacNull(d.dName),
    msgType: chuanHoaMsgType(msgTypeGoc),
    noiDung,
    contentRaw,
    tsZalo: _docTsBatBuoc(d.ts, 'message'),
    tuToi: tho?.isSelf === true,
    coTagHost: coTagHost(tho, boiCanh?.hostUserIds ?? [], boiCanh?.uidTroLy),
    ...docTraLoi(d.quote),
  };
}

/**
 * Tên thật → hằng số chuẩn. Không có trong bảng ⇒ 'UNKNOWN'.
 *
 * Tên gốc KHÔNG mất: `docNoiDung()` giữ ở `contentRaw._msgTypeGoc`. Chính
 * lưới đó là thứ đã cứu được chữ của 10 dòng đầu tiên khi `webchat` chưa
 * được nhận — giữ nguyên, đừng bỏ dù bảng ánh xạ có đầy lên tới đâu.
 *
 * @param {string|null} msgTypeGoc
 * @returns {string}
 */
export function chuanHoaMsgType(msgTypeGoc) {
  const ten = _chuanTen(msgTypeGoc);
  if (ten === null) return MSG_TYPE.UNKNOWN;
  return TEN_THAT_SANG_CHUAN.get(ten) ?? MSG_TYPE.UNKNOWN;
}

/**
 * Rút chữ từ `content` dạng OBJECT của một tin VĂN BẢN.
 *
 * ⚠️ ĐỘ TIN CẬY: hình dạng object này **CHƯA XÁC MINH ĐƯỢC**. `zca-js` truyền
 * thẳng `msg.content` từ server, không biến đổi gì (`apis/listen.js`), nên
 * không có khai báo kiểu nào để đọc; và 2 dòng gặp thật trong DB thì đã bị
 * luật che cũ xoá trắng trước khi ai kịp nhìn. Danh sách khoá dưới đây là
 * PHỎNG ĐOÁN CÓ CƠ SỞ (trùng tên với `TAttachmentContent` của zca-js).
 *
 * Vì chưa chắc nên hàm CỐ Ý dè dặt:
 *   · chỉ nhận chuỗi thuần, không phải bytes, không rỗng;
 *   · không tìm thấy thì trả `null` (để `noi_dung` NULL) chứ KHÔNG bịa —
 *     `contentRaw` vẫn giữ nguyên object để còn đối chiếu.
 * Payload thật đầu tiên bắt được sau bản vá sẽ chốt được danh sách này.
 *
 * @param {unknown} o
 * @returns {string|null}
 */
function _rutChuTuObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  for (const k of ['title', 'text', 'msg', 'description']) {
    const v = /** @type {any} */ (o)[k];
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s === '' || _coVeLaBytes(v)) continue;
    return s;
  }
  return null;
}

/**
 * Tách nội dung theo msgType, thi hành spec H.
 *
 * 🔴 LUẬT: `noiDung` CHỈ khác null khi tin là VĂN BẢN (`laVanBan()`). Mọi loại
 * khác chỉ được giữ METADATA trong `contentRaw`, và KHÔNG tải media của
 * người khác.
 *
 * @param {string|null} msgType  tên GỐC từ payload (chưa chuẩn hoá)
 * @param {unknown} content
 * @returns {{noiDung: string|null, contentRaw: string|null}}
 */
export function docNoiDung(msgType, content) {
  if (laVanBan(msgType)) {
    if (typeof content === 'string') {
      return { noiDung: content, contentRaw: null };
    }
    // Khai là text mà content là OBJECT. KHÔNG ép String(content) (ra
    // '[object Object]' — rác im lặng), nhưng cũng KHÔNG bỏ trắng: đo trên DB
    // thật có 2 dòng dạng này, đều là tin do CHÍNH TRỢ LÝ gửi vọng ngược về
    // qua listener, và chữ bị mất sạch.
    const chu = _rutChuTuObject(content);
    return {
      noiDung: chu,
      // Giữ NGUYÊN hình dạng kể cả khi đã rút được chữ: hình dạng object này
      // CHƯA AI XÁC MINH (server Zalo quyết, zca-js truyền thẳng không đụng —
      // đã đọc `apis/listen.js`). Còn giữ thì lần sau còn đối chiếu được xem
      // rút đúng trường chưa.
      contentRaw: _chuoiHoaGon({
        _msgTypeGoc: msgType,
        _batThuong: 'content không phải chuỗi',
        _daRutChu: chu !== null,
        content,
      }),
    };
  }

  // ⚠️ Mọi loại KHÁC text: noiDung PHẢI null (spec H). Không có ngoại lệ.
  let daTach = content;
  if (typeof content === 'string') {
    // Bẫy #316: content của loại khác text là CHUỖI JSON, phải tự parse.
    try {
      daTach = JSON.parse(content);
    } catch {
      daTach = _coVeLaBytes(content)
        ? { _khongPhaiJson: true, _doDai: content.length }
        : { _khongPhaiJson: true, _text: content };
    }
  }

  const goi = { _msgTypeGoc: msgType ?? null };

  // Tên chưa ai từng thấy ⇒ cắm cờ để có người đi xem. Tên đã biết mà pack
  // chưa có ô (vd `chat.voice`) thì KHÔNG cắm — cờ mà kêu ở ca bình thường
  // thì chẳng mấy chốc không ai buồn nhìn nữa.
  const ten = _chuanTen(msgType);
  if (ten !== null && !TEN_THAT_DA_BIET.has(ten)) {
    /** @type {any} */ (goi)._tenLa = true;
  }

  if (daTach !== null && daTach !== undefined && typeof daTach === 'object' && !Array.isArray(daTach)) {
    Object.assign(goi, daTach);
  } else if (daTach !== null && daTach !== undefined) {
    /** @type {any} */ (goi)._giaTri = daTach;
  }

  return { noiDung: null, contentRaw: _chuoiHoaGon(goi) };
}

/**
 * Tin này có tag (mention) tài khoản host không?
 *
 * ✅ ĐÃ XÁC MINH bằng `zca-js@2.1.2/dist/models/Message.d.ts`:
 *      TGroupMessage = TMessage & { mentions: TMention[] | undefined }
 *      TMention      = { uid: string; pos: number; len: number; type: 0 | 1 }
 *    ⇒ đọc trường có cấu trúc, KHÔNG dò chuỗi trong text. Độ tin cậy CAO.
 *
 * 🔴 ĐỌC KỸ CHIỀU SO SÁNH — chỗ này rất dễ hiểu ngược:
 *   `mentions[].uid` là NGƯỜI BỊ TAG. Trợ lý chạy trên MỘT TÀI KHOẢN ZALO
 *   RIÊNG (không phải tài khoản cá nhân của anh — tiền đề này đã bị hiểu sai
 *   2 lần trong dự án). Anh tag trợ lý ⇒ `uid` = uid của TÀI KHOẢN BOT, còn
 *   `uidFrom` mới là host.
 *
 *   Nhưng hàm này so `uid` với `hostUserIds`, tức đang hỏi *"tin này có tag
 *   HOST không"*. Hai câu hỏi KHÁC NHAU. Cột `co_tag_host` giữ đúng nghĩa
 *   đen của tên nó; ai cần *"có tag trợ lý không"* (điều kiện kích hoạt thật
 *   của spec B) thì phải so với uid tài khoản bot, và uid đó KHÔNG có trong
 *   `boiCanh` hiện tại. ⚠️ Đã báo Router — đừng lặng lẽ đổi nghĩa hàm này.
 *
 * ⚠️ CÒN MÙ, đừng tự bịt bằng cách đoán: `type: 0|1` chưa rõ nghĩa (rất có
 *    thể 1 = tag cả nhóm / @All). Hàm CỐ Ý bỏ qua `type` và chỉ so `uid`:
 *    nếu 1 là @All thì `uid` lúc đó không phải uid host nên vẫn trả false —
 *    sai về phía IM LẶNG, đúng tinh thần spec B (im là mặc định).
 *
 * @param {any} tho
 * @param {string[]} hostUserIds
 * @returns {boolean}
 */
export function coTagHost(tho, hostUserIds, uidTroLy) {
  const ds = tho?.data?.mentions;
  if (!Array.isArray(ds) || ds.length === 0) return false;

  // Đường ĐÚNG theo hợp đồng: "tin này có tag TRỢ LÝ không".
  const idTroLy = toId(uidTroLy, 'coTagHost.uidTroLy');
  if (idTroLy !== null) return ds.some((m) => cungId(m?.uid, idTroLy));

  // Không ai truyền uid trợ lý ⇒ KHÔNG thể trả lời đúng câu hỏi đó. Lùi về
  // nghĩa đen của tên hàm (có tag host không) — luôn false ở ca thật, tức
  // sai về phía IM LẶNG. Nhưng phải KÊU, vì đây là điều kiện kích hoạt cốt
  // lõi và kiểu hỏng của nó là câm tuyệt đối: không lỗi, không stack, chỉ là
  // trợ lý không bao giờ nói. Đúng kiểu hỏng đã giấu bug `webchat` 10 dòng.
  _keuThieuUidTroLy();
  if (!Array.isArray(hostUserIds) || hostUserIds.length === 0) return false;
  return ds.some((m) => hostUserIds.some((h) => cungId(m?.uid, h)));
}

/**
 * Kêu MỖI LẦN, không chốt "chỉ một lần": cùng lối với `_docTsBatBuoc`, và
 * một cảnh báo chỉ hiện một lần rồi im thì sau vài giờ log không còn dấu vết
 * nào của một lỗi vẫn đang xảy ra.
 */
function _keuThieuUidTroLy() {
  process.stderr.write(
    '[normalize] ⚠️ có tin mang `mentions` nhưng KHÔNG ai truyền `uidTroLy` -> '
      + 'không đánh giá được "host tag trợ lý" (spec B). Trợ lý sẽ KHÔNG BAO GIỜ '
      + 'được kích hoạt trong nhóm. Sửa: listener truyền uid tài khoản bot vào '
      + 'boiCanh.uidTroLy.\n',
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2. THU HỒI
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {any} tho payload thô từ listener 'undo' (Undo)
 * @returns {SuKienThuHoi}
 */
export function chuanHoaThuHoi(tho) {
  const d = tho?.data ?? {};
  const c = d.content ?? {};

  return {
    // 🔴 BẪY 1: đây là ID của CHÍNH SỰ KIỆN thu hồi, KHÔNG phải tin bị thu hồi.
    eventId: toIdBatBuoc(d.msgId, 'undo.msgId(=id sự kiện)'),
    chatId: toIdBatBuoc(tho?.threadId, 'undo.threadId'),
    // 🔴 Tin BỊ thu hồi nằm ở đây. Number ⇒ toId() ép về TEXT (bẫy 2 + 3).
    msgIdDich: toIdBatBuoc(c.globalMsgId, 'undo.content.globalMsgId'),
    cliMsgIdDich: toId(c.cliMsgId, 'undo.content.cliMsgId'),
    nguoiThuHoi: toId(d.uidFrom, 'undo.uidFrom'),
    tsZalo: _docTsBatBuoc(d.ts, 'undo'),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. REACTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {any} tho payload thô từ listener 'reaction' (Reaction)
 * @returns {ReactionChuanHoa}
 */
export function chuanHoaReaction(tho) {
  const d = tho?.data ?? {};
  const c = d.content ?? {};
  const dich = Array.isArray(c.rMsg) ? c.rMsg[0] : null;

  // 🔴 zca-js #360 (CÒN MỞ): thả cảm xúc từ app ĐIỆN THOẠI cho gMsgID = 0.
  // '0' KHÔNG phải một msgId — coi như KHÔNG GHÉP ĐƯỢC. Ghép bừa vào cMsgID
  // thì tệ hơn: nó tạo ra liên kết SAI mà không ai kiểm lại được.
  const idDich = toId(dich?.gMsgID, 'reaction.rMsg.gMsgID');

  return {
    chatId: toIdBatBuoc(tho?.threadId, 'reaction.threadId'),
    msgIdDich: idDich === null || idDich === '0' ? null : idDich,
    userId: toId(d.uidFrom, 'reaction.uidFrom'),
    // Reactions.NONE = '' nghĩa là GỠ cảm xúc — giữ nguyên '' để phân biệt
    // với "không đọc được" (null).
    bieuTuong: c.rIcon === undefined || c.rIcon === null ? null : String(c.rIcon),
    tsZalo: docTs(d.ts),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4. SỰ KIỆN NHÓM
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {any} tho payload thô từ listener 'group_event' (GroupEvent)
 * @returns {SuKienNhomChuanHoa}
 */
export function chuanHoaSuKienNhom(tho) {
  const d = tho?.data ?? {};
  const loaiGoc = _chuoiHoacNull(tho?.type);

  return {
    // threadId có thể vắng ở vài nhánh group_event ⇒ lùi về data.groupId.
    chatId: toIdBatBuoc(tho?.threadId ?? d.groupId, 'group_event.threadId'),
    loai: loaiGoc ? loaiGoc.toUpperCase() : 'UNKNOWN',
    duLieu: _chuoiHoaGon({ _loaiGoc: loaiGoc, _act: _chuoiHoacNull(tho?.act), ...d }),
    tsZalo: docTs(d.time ?? d.ts),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. LOẠI HỘI THOẠI — đường vòng qua bẫy `isGroup` (issue #25)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Suy loại hội thoại cho một `threadId`.
 *
 * 🔴 KHÔNG tin cờ `isGroup`: zca-js issue #25 — `isGroup = true` cả khi thu hồi
 * trong tin RIÊNG. Thứ tự tin cậy:
 *   1. `goiY` = `Message.type` (ThreadType: 0=User, 1=Group) — trường CÔNG KHAI
 *      của chính payload message, đúng cả khi isGroup sai.
 *   2. `threadId` nằm trong danh sách nhóm ở config ⇒ GROUP.
 *   3. Không đối chiếu được ⇒ UNKNOWN. CỐ Ý không đoán DM: đoán nhầm DM cho
 *      một nhóm lạ là mở đường cho luật chống rò chéo hiểu sai phạm vi.
 *
 * ⚠️ Hàm này là PHẦN THÊM của G2 (không có trong `types.d.ts`): `TinChuanHoa`
 * không mang trường loại hội thoại, mà `hoi_thoai.loai` trong schema thì bắt
 * buộc. G3/G4 dùng lại được, KHÔNG cần tự viết bản thứ hai. Đã báo Router.
 *
 * @param {unknown} threadId
 * @param {CauHinh|{groups?: Array<{chatId: string}>}|null} cauHinh
 * @param {unknown} [goiY]  `Message.type` nếu có (0 = User/DM, 1 = Group)
 * @returns {string} LOAI_HOI_THOAI.*
 */
export function loaiHoiThoai(threadId, cauHinh, goiY) {
  if (goiY === 1) return LOAI_HOI_THOAI.GROUP;
  if (goiY === 0) return LOAI_HOI_THOAI.DM;

  const id = toId(threadId, 'loaiHoiThoai.threadId');
  if (id === null) return LOAI_HOI_THOAI.UNKNOWN;

  const ds = cauHinh?.groups;
  if (Array.isArray(ds) && ds.some((g) => cungId(g?.chatId, id))) {
    return LOAI_HOI_THOAI.GROUP;
  }
  return LOAI_HOI_THOAI.UNKNOWN;
}
