/**
 * ═══════════════════════════════════════════════════════════════════════
 * G4 — CỔNG HOST. CHỦ SỞ HỮU: G4. Gói khác KHÔNG sửa file này.
 *
 * ⚠️ HÀM THUẦN — KHÔNG mạng, KHÔNG I/O, KHÔNG ghi DB, KHÔNG sinh request_id
 *    (sinh id + ghi `hang_doi_hoi` là việc của caller/G8). Chỉ QUYẾT ĐỊNH.
 *    Đây là điều kiện để test được mà không cần Zalo lẫn Claude.
 *
 * 🔴 KHÔNG RÕ NGUỒN → 'drop' IM LẶNG. Không trả lời, không react, không báo
 *    gì cho người gửi. Người lạ KHÔNG được biết bot có tồn tại hay không.
 *
 * 🔴 LUẬT THỨ TỰ CỦA CẢ HỆ (không thuộc file này nhưng phải nhớ):
 *        mọi tin → store GHI TRƯỚC (luôn luôn) → gate
 *    Gate trả 'drop' KHÔNG có nghĩa là "bỏ tin", chỉ có nghĩa "đừng đánh
 *    thức Claude". Tin vẫn đã nằm trong DB rồi.
 *
 * ⛔ BỎ HẲN nhánh `pairing` của repo mẫu — spec C: host tự quản file config.
 * ⛔ stdout dành riêng cho giao thức MCP.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { HANH_DONG_GATE } from '../lib/hang_so.js';
import { toId } from '../lib/ids.js';
import { isHost, findGroup, findHostByDm } from './access.js';

/** @typedef {import('../types.d.ts').TinChuanHoa} TinChuanHoa */
/** @typedef {import('../types.d.ts').CauHinh} CauHinh */
/** @typedef {import('../types.d.ts').GateResult} GateResult */

/** Mã lý do — để G8 ghi log và để test so khớp mà không phải so câu chữ. */
export const LY_DO = Object.freeze({
  THIEU_DU_LIEU: 'thieu-du-lieu',
  NHOM_NGOAI_ALLOWLIST: 'nhom-ngoai-allowlist',
  KHONG_PHAI_HOST: 'khong-phai-host',
  KHONG_TAG: 'khong-tag',
  NHOM_TAT_TRA_LOI: 'nhom-tat-tra-loi',
  TIN_CUA_TRO_LY: 'tin-cua-tro-ly',
  HOST_TAG_TRONG_NHOM: 'host-tag-trong-nhom',
  HOST_NHAN_DM: 'host-nhan-dm',
  // v9 — tỉnh dậy để NGHE, ⛔ không được nói.
  NGHE_NGUOI_KHAC: 'nghe-nguoi-khac',
  // v10 — CỬA 2: người ĐANG BỊ NHẮC được nói, trong đúng phạm vi việc đó.
  NGUOI_PHU_TRACH_DAP_VIEC: 'nguoi-phu-trach-dap-viec',
});

/**
 * Cho phép host điều khiển trợ lý qua DM (không đòi tag).
 * Xem khối "HAI ĐIỀU CHƯA XÁC MINH" trong docstring `quyetDinh()`.
 * Đặt `false` để quay về đúng chữ của stub G0 (chỉ kích hoạt bằng tag trong nhóm).
 */
export const CHO_PHEP_DM = true;

/**
 * @param {string} lyDo
 * @returns {GateResult}
 */
function _bo(lyDo) {
  return { action: HANH_DONG_GATE.DROP, payload: { lyDo } };
}

/**
 * ★ v9 — TỈNH DẬY NHƯNG KHÔNG ĐƯỢC NÓI.
 *
 * ⚠️ `chatId` vẫn đi kèm: lượt nghe VẪN đọc được lịch sử đúng chỗ nó đang nghe.
 * Thứ bị lấy đi là quyền NÓI RA và quyền GHI, ⛔ không phải quyền đọc.
 */
function _nghe(chatId, lyDo, idViec) {
  const payload = { chatId, lyDo };
  // ⚠️ Chỉ gắn khi CÓ — `payload.idViecMoCua === undefined` là "cửa 2 đóng",
  // và nó phải là mặc định. Gắn `null` cũng được, nhưng vắng hẳn thì mọi chỗ
  // đọc `if (payload.idViecMoCua)` đều fail-closed mà không cần nhớ luật.
  if (idViec) payload.idViecMoCua = String(idViec);
  return { action: HANH_DONG_GATE.NGHE, payload };
}

/**
 * Quyết định một tin có đánh thức Claude hay không.
 *
 * ═══ 🔴 MÂU THUẪN TRONG HỢP ĐỒNG G0 — ĐÃ BÁO ROUTER, ĐỌC TRƯỚC KHI SỬA ═══
 * Stub G0 liệt kê luật *"tin do chính mình gửi (tuToi) → drop"*. Nhưng spec đã
 * chốt trợ lý chạy trên CHÍNH TÀI KHOẢN của host (*"a sẽ giao toàn bộ quyền
 * đăng nhập zalo web cho tool"*). Anh gõ trong nhóm bằng điện thoại thì
 * websocket của tool nhận lại chính tin đó với `isSelf = true`, tức
 * `tuToi = true`. Bỏ mù theo `tuToi` là **trợ lý CÂM VĨNH VIỄN** — mà câm
 * kiểu này không có lỗi nào để lần ra.
 *
 * Nên ở đây `tuToi` KHÔNG tự nó làm rớt tin. Chống vòng lặp (trợ lý trả lời
 * rồi tự đọc lại lời mình) do luật `hasHostMention` lo: tin do trợ lý soạn không
 * mang `mentions` trỏ vào host nên rơi ở bước "không tag". `tuToi` chỉ dùng
 * làm lớp chặn PHỤ cho ca `tuToi && !host` (tài khoản chạy tool không nằm
 * trong `hosts`).
 *
 * ═══ ⚠️ HAI ĐIỀU CHƯA XÁC MINH — KHÔNG ĐOÁN, ĐANG CHỜ M1 ═══
 * 1. Zalo có cho TỰ TAG CHÍNH MÌNH không? Trợ lý dùng tài khoản của host nên
 *    "host tag trợ lý" hoá ra là "host tự tag chính mình" (G2 nêu, chưa ai
 *    kiểm). Không tự tag được ⇒ đường kích hoạt trong NHÓM không tồn tại.
 * 2. Vì (1) chưa chắc, file này CÓ MỞ đường DM: tin trong DM của host được
 *    cho qua mà KHÔNG đòi tag. Lý do không phải tiện tay:
 *      · `UserMessage` của zca-js KHÔNG có trường `mentions` (G2 xác minh từ
 *        .d.ts) ⇒ trong DM `hasHostMention` LUÔN false ⇒ đòi tag trong DM là đóng
 *        cửa vĩnh viễn, không phải "chặt chẽ hơn".
 *      · DM chỉ có host và trợ lý ⇒ không có ai để mà rò sang.
 *    Muốn đóng lại thì đặt `CHO_PHEP_DM = false` — sửa đúng một dòng.
 *
 * @param {TinChuanHoa} tin
 * @param {CauHinh} cauHinh
 * @param {{idViecMoCua?: string|null}} [boiCanh] kết quả `timViecMoCua2()` — caller
 *   tra DB rồi truyền vào. Vắng ⇒ cửa 2 ĐÓNG (fail-closed, và đó là mặc định
 *   đúng: mọi caller cũ không truyền gì thì hành vi y hệt v9).
 * @returns {GateResult}
 */
export function quyetDinh(tin, cauHinh, boiCanh) {
  if (!tin || !cauHinh) return _bo(LY_DO.THIEU_DU_LIEU);

  const chatId = toId(tin.chatId, 'gate.chatId');
  if (chatId === null) return _bo(LY_DO.THIEU_DU_LIEU);

  const userId = toId(tin.userId, 'gate.userId');
  const laHostGui = isHost(cauHinh, userId);

  // Tài khoản chạy tool KHÔNG nằm trong hosts mà lại tự gửi tin -> đây đúng
  // là tiếng vọng của chính trợ lý, bỏ. (Ca host-dùng-chung-tài-khoản không
  // rơi vào đây vì lúc đó laHostGui = true.)
  if (tin.tuToi === true && !laHostGui) return _bo(LY_DO.TIN_CUA_TRO_LY);

  // ── Nhánh DM của host ────────────────────────────────────────────────
  const hostDm = findHostByDm(cauHinh, chatId);
  if (hostDm) {
    if (!CHO_PHEP_DM) return _bo(LY_DO.NHOM_NGOAI_ALLOWLIST);
    // DM của host A nhưng người gửi lại là B -> không cho qua. Ca này về lý
    // thuyết không xảy ra (DM chỉ có 2 người), nhưng nếu `dmChatId` bị điền
    // nhầm thành một NHÓM thì nó xảy ra thật, và hậu quả là người lạ điều
    // khiển được trợ lý.
    if (!laHostGui) return _bo(LY_DO.KHONG_PHAI_HOST);
    return {
      action: HANH_DONG_GATE.ALLOW,
      payload: { chatId, lyDo: LY_DO.HOST_NHAN_DM },
    };
  }

  // ── Nhánh nhóm ───────────────────────────────────────────────────────
  const nhom = findGroup(cauHinh, chatId);
  if (!nhom) return _bo(LY_DO.NHOM_NGOAI_ALLOWLIST);

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 v9 (21/08/2026) — HẠ VAI CỬA NÀY. Anh chốt: *"khi đó em mới thực sự
  // là trợ lý"*. Trợ lý phải LUÔN THEO KỊP NHÓM, ⛔ không phải cái bot ngồi
  // chờ gọi tên.
  //
  // Câu hỏi cửa này trả lời ĐỔI, và đây là toàn bộ thay đổi:
  //     trước:  "tin này có ĐÁNH THỨC trợ lý không?"
  //     sau :   "tin này có cho trợ lý LÊN TIẾNG không?"
  //
  // 🔴 LUẬT "IM TRONG NHÓM TRỪ KHI HOST TAG" KHÔNG ĐỔI MỘT CHỮ. Ba nhánh
  // dưới đây trước trả `drop`, nay trả `nghe` — mà `nghe` **không có đường
  // nào ra Zalo** (tra_loi từ chối, mọi tool ghi bị chặn; xem `tools.js`).
  // Thứ đi ra Zalo vẫn y hệt hôm nay; chỉ có thứ ĐI VÀO là nhiều hơn.
  //
  // ⛔ BỐN NHÁNH GIỮ NGUYÊN `drop`, ⛔ KHÔNG ĐƯỢC NỚI:
  //   · nhóm ngoài allowlist            (ngay phía trên)
  //   · nhóm traLoiKhiTag = false       (ngay dưới)
  //   · DM của người lạ                 (nhánh DM phía trên)
  //   · tiếng vọng của chính trợ lý     (nhánh tuToi phía trên)
  //
  // ⚠️ Nhóm tắt trả lời phải xét TRƯỚC người gửi: nó là lựa chọn "nhóm này
  // trợ lý không tham gia", nên cũng KHÔNG tốn lượt model nào cho nó.
  // ═══════════════════════════════════════════════════════════════════
  if (nhom.traLoiKhiTag !== true) return _bo(LY_DO.NHOM_TAT_TRA_LOI);

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 v10 — CỬA 2: NGƯỜI ĐANG BỊ NHẮC ĐƯỢC NÓI.
  //
  // ═══ LUẬT ANH CHỐT 21/08/2026 ═══
  //   **Quyền đi theo VIỆC, ⛔ không theo NGƯỜI.**
  //   Không phải *"người này đang nói chuyện"*, mà *"đây là việc EM đang đuổi"*.
  //
  // ⚠️ File này là HÀM THUẦN — ⛔ không chạm DB. Ba điều kiện (đúng người phụ
  // trách · việc còn mở · đúng nhóm) do `timViecMoCua2()` ở `store/query.js`
  // kiểm trong MỘT truy vấn, và caller truyền kết quả vào qua `boiCanh`.
  // ⇒ Giữ được tính thuần, mà vẫn không có chỗ nào tự suy ra quyền.
  //
  // 🔴 CỬA 2 MỞ QUYỀN **NÓI**, ⛔ KHÔNG MỞ QUYỀN **RA LỆNH**.
  // Hành động vẫn là `nghe` (⛔ KHÔNG phải `allow`), nên mọi chốt chặn tool
  // GHI ở `mcp/tools.js` **tiếp tục áp nguyên vẹn**. Thứ duy nhất `idViecMoCua`
  // nới ra là hai tool NÓI. Người đó nói *"xong rồi"* mười lần cũng chỉ là một
  // DẤU HIỆU — **CHỈ HOST ĐÓNG**, chốt cũ của anh, ⛔ giữ nguyên.
  //
  // ⛔ KHÔNG XÉT Ở NHÁNH DM. Anh chốt: cửa 2 chỉ trong đúng nhóm có lời nhắc.
  // Khối này nằm SAU nhánh DM (đã `return` phía trên) — đó là chỗ thi hành.
  // ═══════════════════════════════════════════════════════════════════
  if (!laHostGui) {
    return _nghe(
      chatId,
      boiCanh?.idViecMoCua ? LY_DO.NGUOI_PHU_TRACH_DAP_VIEC : LY_DO.NGHE_NGUOI_KHAC,
      boiCanh?.idViecMoCua,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 HOST GÕ MÀ KHÔNG TAG -> VẪN `drop`. ⛔ ĐỪNG ĐỔI THÀNH `nghe`.
  //
  // Em ĐÃ viết nhánh `nghe` ở đây rồi phải gỡ ra — ghi lại để người sau khỏi
  // đi lại đúng đường đó:
  //
  // Trợ lý chạy trên CHÍNH TÀI KHOẢN của host, nên tin do TRỢ LÝ tự gửi quay
  // lại qua websocket với `tuToi = true` VÀ `laHostGui = true` ⇒ nó KHÔNG rơi
  // ở nhánh `tuToi && !laHostGui` phía trên. Thứ duy nhất chặn tiếng vọng đó
  // là đúng dòng `hasHostMention !== true` này (tin trợ lý soạn không mang mention
  // trỏ vào host). Đổi nó thành `nghe` là **mỗi câu trợ lý nói ra lại đẻ thêm
  // một lượt model** — không thành vòng lặp vô hạn vì lượt nghe không gửi
  // được gì, nhưng là tiếng vọng có thật, và Router đã liệt kê tiếng vọng vào
  // bốn nhánh CẤM NỚI.
  //
  // ⚠️ Cái mất: trợ lý không nghe được tin host TỰ GÕ trong nhóm. Muốn nghe
  // được thì phải phân biệt "host gõ" với "trợ lý gửi", mà `TinChuanHoa`
  // KHÔNG mang cờ đó (`do_tro_ly_tao` chỉ có sau khi ghi DB, và A8 đã đo được
  // là nó thua cuộc đua 35,3 % số lần). ⇒ Chưa làm được, ⛔ không đoán.
  // ═══════════════════════════════════════════════════════════════════
  if (tin.hasHostMention !== true) return _bo(LY_DO.KHONG_TAG);

  return {
    action: HANH_DONG_GATE.ALLOW,
    payload: { chatId, lyDo: LY_DO.HOST_TAG_TRONG_NHOM },
  };
}

