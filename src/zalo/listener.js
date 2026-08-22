/**
 * CHỦ SỞ HỮU: G2. Gói khác KHÔNG sửa file này.
 * Bật đúng 4 listener của zca-js (message · undo · reaction · group_event)
 * rồi phát sự kiện NỘI BỘ đã chuẩn hoá.
 *
 * RÀNG BUỘC ĐÃ CHỐT Ở G0:
 *  · Tên sự kiện phát ra LẤY TỪ SU_KIEN trong src/lib/hang_so.js.
 *    Gõ tay chuỗi sai thì bên nhận im lặng không nhận gì — hỏng CÂM.
 *  · Payload phát ra PHẢI là TinChuanHoa/SuKienThuHoi/... — payload thô
 *    của zca-js KHÔNG được rò ra khỏi normalize.js.
 *  · 🔴 `isGroup` SAI với DM (zca-js issue #25): trả true cả khi thu hồi
 *    trong tin riêng. Phải đối chiếu `threadId` với danh sách nhóm,
 *    KHÔNG tin cờ isGroup. → `normalize.inferConversationKind()`.
 *  · stdout là kênh giao thức MCP ⇒ mọi tiếng động đi `process.stderr`.
 *
 * ═══ 🔴 HAI ĐIỀU G8 PHẢI BIẾT KHI NỐI DÂY ═══
 *
 * 1. `startListening()` CHỈ GẮN HANDLER — nó KHÔNG gọi `api.listener.start()`.
 *    Mở websocket là việc của bước ⑥ trong `src/index.js`, vì gọi `start()`
 *    hai lần sẽ mở HAI kết nối và mọi tin bị ghi ĐÔI. Quên gọi `start()` thì
 *    hệ chết CÂM (không sự kiện nào, không lỗi nào) ⇒ file này ghi một dòng
 *    stderr nhắc ngay lúc gắn xong, và `lastEventAt()` sẽ mãi trả null
 *    để watchdog tầng 2 bắt được.
 *    Muốn tự mở luôn thì gọi `startListening(api, cauHinh, boPhat, { tuBatDau: true })`.
 *
 * 2. LỖI TRONG HANDLER KHÔNG ĐƯỢC LÀM CHẾT TIẾN TRÌNH. Một tin dị dạng làm
 *    `normalize` ném lỗi mà không ai bắt thì EventEmitter đẩy nó thành
 *    unhandled exception → cả trợ lý chết vì MỘT tin. Nên mỗi handler bọc
 *    try/catch, phát `SU_KIEN.LOI` (đã qua `cleanError`) rồi đi tiếp.
 *
 * ═══ ⚠️ MÂU THUẪN VỚI FACT CŨ — ĐÃ BÁO ROUTER ═══
 * Memory `ref_zca_js_su_kien_va_thu_hoi` ghi *"zca-js có ĐÚNG 4 listener"*.
 * Đọc `node_modules/zca-js@2.1.2/dist/apis/listen.d.ts` thì `ListenerEvents`
 * khai **16 sự kiện**, trong đó có `connected`/`disconnected`/`closed`/`error`
 * (thứ watchdog đang phải dò `ws._closeTimer` — thuộc tính PRIVATE — để đoán),
 * và cả `typing`/`seen_messages`/`delivered_messages` mà memory nói *"không
 * tìm thấy listener nào phát ra"*. G2 vẫn gắn ĐÚNG 4 cái theo phạm vi được
 * giao; 12 cái còn lại là việc của Router quyết, không phải của gói này.
 */

import { SU_KIEN } from '../lib/hang_so.js';
import { cleanError } from '../lib/redact.js';
import {
  normalizeMessage,
  normalizeRecall,
  normalizeReaction,
  normalizeGroupEvent,
} from './normalize.js';

/** @typedef {import('../types.d.ts').CauHinh} CauHinh */

/** Tên 4 sự kiện của zca-js mà gói này gắn. Đúng 4, không hơn. */
export const ZCA_EVENTS = Object.freeze({
  MESSAGE: 'message',
  UNDO: 'undo',
  REACTION: 'reaction',
  GROUP_EVENT: 'group_event',
});

/**
 * Trạng thái module. Cố ý để ở cấp module (không phải class): cả pack chỉ
 * chạy MỘT phiên Zalo trong MỘT tiến trình — pid-lock ở `index.js` bảo đảm
 * điều đó — và `lastEventAt()` trong hợp đồng là hàm trần, không có
 * chỗ nào truyền instance vào.
 * @type {{api: any, boPhat: any, gan: Array<[string, Function]>}|null}
 */
let _dangGan = null;

/** ms epoch của sự kiện gần nhất. null = chưa nhận gì kể từ lúc bật. */
let _lanCuoi = null;

function _canhBao(msg) {
  // ⛔ KHÔNG console.log — stdout là kênh MCP (xem CANH_BAO_STDOUT).
  process.stderr.write(`[listener] ${msg}\n`);
}

/**
 * Bọc một handler: đánh dấu "còn sống" TRƯỚC, chuẩn hoá SAU, lỗi thì phát
 * SU_KIEN.LOI chứ không ném ra ngoài.
 *
 * 🔴 Vì sao đánh dấu `_lanCuoi` TRƯỚC khi chuẩn hoá: watchdog tầng 2 dùng nó
 * để hỏi "listener còn nhận được gì không". Một tin dị dạng làm normalize ném
 * lỗi VẪN là bằng chứng websocket còn sống. Đặt sau `catch` thì một chuỗi tin
 * dị dạng sẽ bị đọc thành "im lặng bất thường" ⇒ watchdog đăng nhập lại vô cớ.
 *
 * @param {string} tenZca
 * @param {string} tenNoiBo
 * @param {(tho: any) => any} chuanHoa
 * @param {any} boPhat
 * @param {{hostUserIds: string[]}} boiCanh
 */
function _boc(tenZca, tenNoiBo, chuanHoa, boPhat, boiCanh) {
  return function xuLy(tho) {
    _lanCuoi = Date.now();
    let daChuanHoa;
    try {
      daChuanHoa = chuanHoa(tho, boiCanh);
    } catch (e) {
      _phatLoi(boPhat, tenZca, e);
      return;
    }
    try {
      boPhat.emit(tenNoiBo, daChuanHoa);
    } catch (e) {
      // Lỗi của BÊN NHẬN (G3 ghi DB hỏng…). Không phải lỗi của ta, nhưng cũng
      // không được để nó nổ ngược lên websocket của zca-js.
      _phatLoi(boPhat, `${tenZca}->${tenNoiBo}`, e);
    }
  };
}

/**
 * Phát SU_KIEN.LOI. Nếu chính việc phát lỗi cũng hỏng (không ai nghe 'loi'
 * và boPhat là EventEmitter chuẩn thì `emit('loi')` KHÔNG ném — nhưng
 * `emit('error')` thì có) thì nuốt và ghi stderr: đường báo lỗi không bao
 * giờ được phép làm chết đường chính.
 */
function _phatLoi(boPhat, boiCanh, e) {
  const loi = cleanError(`listener '${boiCanh}' xử lý sự kiện thất bại`, e);
  try {
    boPhat.emit(SU_KIEN.LOI, loi);
  } catch {
    /* nuốt có chủ đích */
  }
  _canhBao(loi.message);
}

/**
 * Gắn 4 listener và phát sự kiện nội bộ đã chuẩn hoá.
 *
 * @param {any} api           đối tượng API của zca-js (có `api.listener`)
 * @param {CauHinh} cauHinh
 * @param {import('node:events').EventEmitter} boPhat
 * @param {{tuBatDau?: boolean}} [tuyChon]
 * @returns {void}
 */
/**
 * Đọc uid của TÀI KHOẢN BOT đang đăng nhập.
 *
 * Nguồn: `api.getOwnId()` — `zca-js/dist/apis/getOwnId.js` là `() => ctx.uid`,
 * **ĐỒNG BỘ** (đừng `await` rồi đi bắt `.catch()`), `ctx.uid` được gán ở
 * `zalo.js:63` từ `loginInfo.uid` ngay sau khi đăng nhập.
 *
 * ⚠️ KHÔNG có nguồn thứ hai trong payload: `new UserMessage(uid, data)` chỉ
 * dùng `uid` để THAY chỗ `"0"` trong `uidFrom`/`idTo` rồi vứt, không giữ lại
 * thành trường nào. Đã kiểm `models/Message.js`.
 *
 * @param {any} api
 * @returns {string|null} null = không đọc được
 */
function _layUidTroLy(api) {
  try {
    const v = api?.getOwnId?.();
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' || s === '0' ? null : s;
  } catch (e) {
    _canhBao(`getOwnId() ném lỗi: ${cleanError('không đọc được uid trợ lý', e).message}`);
    return null;
  }
}

/**
 * Dựng `boiCanh` cho các hàm chuẩn hoá.
 *
 * 🔴 ĐÂY LÀ CHỖ ĐÃ SINH RA BUG "TRỢ LÝ CÂM VĨNH VIỄN" — đọc trước khi sửa.
 *
 * `hasHostMention()` hỏi: *"tin này có tag TRỢ LÝ không"*. Trong `mentions`, `uid`
 * là **người BỊ tag** — tức tài khoản BOT. Host là người ĐI tag, nằm ở
 * `uidFrom`. Bản trước chỉ truyền `{ hostUserIds }` nên `hasHostMention` rơi vào
 * nhánh lùi và đi so `mentions[].uid` với uid HOST ⇒ **không bao giờ khớp**
 * ⇒ `co_tag_host` luôn 0 ⇒ spec B không bao giờ kích hoạt được.
 *
 * Đo thật 20/08/2026, nhóm Haceco KT: anh nhắn `"Test tag @Hảis Assistant"`,
 * `_mentions[0].uid = 999200000000000002` (BOT), host là
 * `9993000000000000003`. Hai số khác nhau — đúng như thiết kế, vì
 * **BOT và HOST là HAI TÀI KHOẢN KHÁC NHAU**. Tiền đề "bot = host" đã rò vào
 * mã nguồn 4 lần; đây là lần thứ 4.
 *
 * 🔴 KHÔNG lấy được uid bot ⇒ FAIL-CLOSED: cố ý truyền `hostUserIds` RỖNG để
 * **triệt nhánh lùi** trong `normalize.hasHostMention()`. Rỗng ⇒ luôn `false` ⇒
 * trợ lý im lặng. Lùi về so với host là tái tạo lại đúng con bug này, nên
 * thà câm còn hơn câm-mà-tưởng-là-chạy.
 *
 * @param {any} api
 * @param {string[]} hostUserIds
 * @returns {{hostUserIds: string[], uidTroLy?: string}}
 */
function _dungBoiCanh(api, hostUserIds) {
  const uidTroLy = _layUidTroLy(api);
  if (uidTroLy !== null) return { hostUserIds, uidTroLy };

  _canhBao(
    'KHÔNG đọc được uid tài khoản bot (api.getOwnId) -> FAIL-CLOSED: hasHostMention sẽ '
      + 'LUÔN false, trợ lý KHÔNG BAO GIỜ trả lời trong nhóm. Vẫn nghe và vẫn ghi '
      + 'lịch sử bình thường. CỐ Ý không lùi về so với uid host — nhánh đó chính là '
      + 'bug đã làm trợ lý câm.',
  );
  return { hostUserIds: [] };
}

export function startListening(api, cauHinh, boPhat, tuyChon = {}) {
  const bo = api?.listener;
  if (!bo || typeof bo.on !== 'function' || typeof bo.off !== 'function') {
    throw cleanError('api.listener không dùng được (thiếu .on/.off) — chưa đăng nhập Zalo?');
  }
  if (!boPhat || typeof boPhat.emit !== 'function') {
    throw cleanError('boPhat phải là EventEmitter');
  }

  if (_dangGan) {
    if (_dangGan.api === api) {
      // Gắn hai lần lên CÙNG một api = mỗi tin vào DB hai lần. Ném cho to
      // tiếng ngay lúc khởi động, đừng để phát hiện qua dữ liệu trùng.
      throw cleanError('startListening() đã chạy rồi trên chính api này — gắn hai lần là ghi tin ĐÔI');
    }
    // api MỚI (watchdog vừa đăng nhập lại): gỡ dây cũ rồi mới nối dây mới.
    _canhBao('phát hiện api mới -> gỡ 4 listener của phiên cũ trước khi gắn lại');
    stopListening(_dangGan.api);
  }

  const hostUserIds = (cauHinh?.hosts ?? [])
    .map((h) => (h?.userId === undefined || h?.userId === null ? null : String(h.userId).trim()))
    .filter((x) => x !== null && x !== '');
  if (hostUserIds.length === 0) {
    // Không chặn chạy: spec F cho phép chạy như daemon ghi lịch sử thuần
    // (`--khong-mcp`). Nhưng phải nói ra, vì lúc đó hasHostMention LUÔN false và
    // trợ lý sẽ không bao giờ trả lời — im lặng ở đây trông y hệt "bot hỏng".
    _canhBao('config KHÔNG có host nào -> hasHostMention luôn false, trợ lý sẽ không bao giờ được kích hoạt');
  }

  const boiCanh = _dungBoiCanh(api, hostUserIds);

  /** @type {Array<[string, Function]>} */
  const gan = [
    [ZCA_EVENTS.MESSAGE, _boc(ZCA_EVENTS.MESSAGE, SU_KIEN.TIN_NHAN, normalizeMessage, boPhat, boiCanh)],
    [ZCA_EVENTS.UNDO, _boc(ZCA_EVENTS.UNDO, SU_KIEN.THU_HOI, normalizeRecall, boPhat, boiCanh)],
    [ZCA_EVENTS.REACTION, _boc(ZCA_EVENTS.REACTION, SU_KIEN.REACTION, normalizeReaction, boPhat, boiCanh)],
    [ZCA_EVENTS.GROUP_EVENT, _boc(ZCA_EVENTS.GROUP_EVENT, SU_KIEN.SU_KIEN_NHOM, normalizeGroupEvent, boPhat, boiCanh)],
  ];
  for (const [ten, fn] of gan) bo.on(ten, fn);

  _dangGan = { api, boPhat, gan };
  _lanCuoi = null;

  if (tuyChon.tuBatDau === true) {
    if (typeof bo.start !== 'function') {
      throw cleanError('tuBatDau=true nhưng api.listener.start() không tồn tại');
    }
    bo.start();
  } else {
    _canhBao(
      `đã gắn ${gan.length} listener (${gan.map(([t]) => t).join(', ')}) — ` +
        'NHỚ gọi api.listener.start() ở index.js, không gọi thì im lặng tuyệt đối',
    );
  }
}

/**
 * Gỡ đúng 4 handler mà `startListening()` đã gắn.
 *
 * ⚠️ CỐ Ý KHÔNG gọi `api.listener.stop()`: đóng websocket là quyết định vòng
 * đời của `index.js` (G8). Gói này chỉ chịu trách nhiệm phần dây của nó — gỡ
 * dây xong mà tự tay đóng cả đường truyền là giẫm sang gói khác.
 *
 * @param {any} api
 * @returns {void}
 */
export function stopListening(api) {
  if (!_dangGan) return;
  const muc = _dangGan;
  if (api && muc.api !== api) {
    _canhBao('stopListening() nhận api KHÁC api đang gắn -> bỏ qua, không gỡ nhầm dây của phiên khác');
    return;
  }
  const bo = muc.api?.listener;
  for (const [ten, fn] of muc.gan) {
    try {
      bo?.off?.(ten, fn);
    } catch (e) {
      _canhBao(`gỡ listener '${ten}' thất bại: ${cleanError('', e).message}`);
    }
  }
  _dangGan = null;
}

/**
 * Thời điểm nhận sự kiện gần nhất (ms epoch) — watchdog tầng 2 dùng để
 * phát hiện "im lặng bất thường". null = chưa nhận gì kể từ lúc bật.
 *
 * ⚠️ null KHÔNG có nghĩa là "chết": nhóm im vài tiếng là chuyện thường. Nó chỉ
 * là một trong hai tầng — tầng 1 mới là thứ đọc trạng thái websocket.
 * @returns {number|null}
 */
export function lastEventAt() {
  return _lanCuoi;
}

/** Đang gắn dây hay không (dùng cho test + `trang_thai`). */
export function isListening() {
  return _dangGan !== null;
}

/** Chỉ dùng trong TEST: xoá sạch trạng thái module. */
export function _datLaiChoTest() {
  _dangGan = null;
  _lanCuoi = null;
}
