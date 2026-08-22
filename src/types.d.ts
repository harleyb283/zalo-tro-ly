/**
 * ═══════════════════════════════════════════════════════════════════════
 * zalo-tro-ly — HỢP ĐỒNG CHỮ KÝ (G0). KHÔNG BUILD, không chạy tsc.
 * File này tồn tại để 5 pane viết song song mà tên trường vẫn khớp nhau.
 *
 * CÁCH DÙNG trong file .js (không cần cài gì):
 *     /** @typedef {import('../types.d.ts').TinChuanHoa} TinChuanHoa *\/
 *     /** @param {TinChuanHoa} tin *\/
 *     export function writeMessage(db, tin) { ... }
 *
 * 🔴 LUẬT HOA/THƯỜNG — nguồn sai lệch số 1 giữa các gói:
 *     · Trong JS (biến, đối tượng, tham số):  camelCase   → `chatId`, `tsZalo`
 *     · Trong SQL (cột, kết quả DB trả về):   snake_case  → `chat_id`, `ts_zalo`
 *   Ranh giới CHUYỂN ĐỔI nằm ở `src/store/write.js` và `src/store/query.js`.
 *   Ngoài hai file đó, KHÔNG chỗ nào được trộn hai kiểu.
 *
 *   ⚠️ NGOẠI LỆ CÓ CHỦ ĐÍCH: `KetQuaTruyVan.rows` là DÒNG THÔ từ SQLite,
 *   tức snake_case. Cố ý, vì `nguonChatIds` phải tính bằng
 *   `new Set(rows.map(r => r.chat_id))` — đọc thẳng cột. Xem `DongTinNhan`.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// 1. DỮ LIỆU TỪ ZALO — sau khi chuẩn hoá (src/zalo/normalize.js, G2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Một tin nhắn đã chuẩn hoá. Đây là thứ DUY NHẤT được truyền từ tầng zalo
 * sang tầng store/policy — payload thô của zca-js KHÔNG được rò ra ngoài
 * `normalize.js`.
 */
export interface TinChuanHoa {
  /** threadId. Luôn TEXT, đã qua toId(). */
  chatId: string;
  /** globalMsgId của chính tin này. Luôn TEXT. */
  msgId: string;
  /** ID phụ — đường ghép dự phòng khi globalMsgId trượt. Có thể null. */
  cliMsgId: string | null;
  /** uidFrom. null khi không xác định được người gửi. */
  userId: string | null;
  /** Ảnh chụp dName lúc nhận. Tên có thể đổi về sau — đừng dùng làm khoá. */
  tenLucGui: string | null;
  /** 'chat.text' | 'chat.image' | 'chat.link' | 'UNKNOWN' (xem MSG_TYPE). */
  msgType: string;
  /**
   * ★ CHỈ có giá trị khi msgType === 'chat.text'. Mọi loại khác PHẢI null.
   * Đây là chỗ thi hành spec H (không lưu media của người khác) trong code.
   */
  noiDung: string | null;
  /**
   * JSON thô đã lọc, dạng CHUỖI (đã JSON.stringify), cho msgType lạ.
   * ⚠️ BẮT BUỘC bỏ mọi trường có thể là bytes/base64 trước khi đưa vào đây.
   * Lưu metadata thì được, lưu media thì KHÔNG.
   */
  contentRaw: string | null;
  /** ms từ Zalo. */
  tsZalo: number;
  /** isSelf — tin do chính tài khoản này gửi. */
  tuToi: boolean;
  /**
   * ★ ĐIỀU KIỆN KÍCH HOẠT CỐT LÕI (spec B): host có tag trợ lý trong tin này không.
   * ⚠️ Cách nhận biết "được tag" trong payload TMessage CHƯA XÁC MINH —
   * có trường `mentions` hay phải dò chuỗi? G2 phải kiểm bằng payload THẬT
   * và báo Router kết quả. KHÔNG được đoán rồi im.
   */
  hasHostMention: boolean;

  /**
   * ★ v2 — REPLY/QUOTE: tin này đang trả lời tin nào.
   * Nguồn: `TMessage.quote` của zca-js (models/Message.d.ts).
   * ⚠️ `traLoiUserId` là tác giả TIN GỐC (`quote.ownerId`), KHÔNG phải người
   *    bấm trả lời — người đó nằm ở `userId` của chính dòng này.
   * ⚠️ `traLoiMsgId` = `quote.globalMsgId`, khai NUMBER nên phải qua toId();
   *    giá trị 0 coi như KHÔNG ghép được (null), lúc đó còn `traLoiCliMsgId`.
   */
  traLoiMsgId: string | null;
  traLoiCliMsgId: string | null;
  traLoiUserId: string | null;
  traLoiTrich: string | null;
}

/**
 * Sự kiện thu hồi tin.
 *
 * 🔴 BẪY GHÉP ID SỐ 1: `eventId` là ID của CHÍNH SỰ KIỆN thu hồi
 * (TUndo.msgId ở cấp cao nhất), KHÔNG phải tin bị thu hồi.
 * Tin bị thu hồi nằm ở `content.globalMsgId` → `msgIdDich`.
 * Ghép nhầm ⇒ UPDATE không khớp dòng nào, KHÔNG có lỗi nào được ném ra.
 *
 * 🔴 BẪY SỐ 2 — LỆCH KIỂU: TMessage.msgId là string, TUndoContent.globalMsgId
 * là number. So sánh thẳng KHÔNG khớp. Bắt buộc đi qua toId()/sameId().
 */
export interface SuKienThuHoi {
  /** TUndo.msgId — ID của sự kiện, dùng làm PRIMARY KEY để chống trùng. */
  eventId: string;
  chatId: string;
  /** ← content.globalMsgId. Tin BỊ thu hồi. */
  msgIdDich: string;
  cliMsgIdDich: string | null;
  /** uidFrom của người bấm thu hồi. */
  nguoiThuHoi: string | null;
  tsZalo: number;
}

/**
 * Reaction đã chuẩn hoá.
 * ⚠️ Reaction thả từ ĐIỆN THOẠI cho gMsgID = 0 ⇒ `msgIdDich` null,
 * `khopDuoc` false. Phần lớn reaction của người Việt sẽ rơi vào ca này.
 */
export interface ReactionChuanHoa {
  chatId: string;
  msgIdDich: string | null;
  userId: string | null;
  bieuTuong: string | null;
  tsZalo: number | null;
}

/** Sự kiện nhóm (JOIN/LEAVE/ADD_ADMIN/.../UNKNOWN). */
export interface SuKienNhomChuanHoa {
  chatId: string;
  loai: string;
  /** JSON thô dạng chuỗi. */
  duLieu: string | null;
  tsZalo: number | null;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. DÒNG THÔ TỪ SQLITE — snake_case, khớp 1-1 với schema.sql
// ═══════════════════════════════════════════════════════════════════════

/** Một dòng của bảng `tin_nhan` như SQLite trả về. Cờ boolean là 0/1. */
export interface DongTinNhan {
  chat_id: string;
  msg_id: string;
  cli_msg_id: string | null;
  user_id: string | null;
  ten_luc_gui: string | null;
  msg_type: string;
  noi_dung: string | null;
  content_raw: string | null;
  ts_zalo: number;
  ts_ghi: string;
  tu_toi: number;
  co_tag_host: number;
  da_thu_hoi: number;
  thu_hoi_boi: string | null;
  thu_hoi_luc: number | null;
  do_tro_ly_tao: number;
}

/** Một dòng của bảng `hang_doi_hoi`. */
export interface DongHangDoi {
  request_id: string;
  chat_id_hoi: string;
  msg_id: string;
  user_id: string;
  noi_dung: string;
  ts_tao: string;
  trang_thai: 'cho' | 'da_day' | 'da_tra_loi' | 'het_han' | 'bo';
}

// ═══════════════════════════════════════════════════════════════════════
// 3. ★ TRÁI TIM LUẬT CHỐNG RÒ CHÉO (src/store/query.js, G3)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★★★ Mọi hàm truy vấn trong `src/store/query.js` PHẢI trả về kiểu này.
 * ⛔ CẤM hàm truy vấn nào trả mảng dòng TRẦN — kể cả hàm "chỉ đếm cho vui".
 *
 * 🔴 `nguonChatIds` BẮT BUỘC tính từ DÒNG TRẢ VỀ:
 *        [...new Set(rows.map(r => r.chat_id))]
 *    ⛔ KHÔNG tính từ THAM SỐ truy vấn.
 *
 *    Vì sao đây là chỗ chết người: truy vấn `lich_su({tuKhoa: 'báo giá'})`
 *    không truyền chatId nào cả, nhưng đọc dữ liệu của 5 nhóm. Tính nguồn
 *    theo tham số ⇒ khai nguồn RỖNG ⇒ leak_guard tưởng "không có nhóm khác"
 *    ⇒ đáp án chứa chuyện 5 nhóm được gửi thẳng vào nhóm đang hỏi.
 *    Hỏng CÂM, và hỏng đúng ca nguy hiểm nhất.
 *
 *    Đặt dấu vết nguồn ở CÙNG CHỖ dữ liệu được đọc ra là lý do Claude
 *    không có cách nào đọc mà không để lại vết.
 */
export interface KetQuaTruyVan {
  /** Dòng thô từ SQLite — snake_case. Xem ghi chú NGOẠI LỆ ở đầu file. */
  rows: DongTinNhan[];
  /** Tập chat_id ĐÃ THỰC SỰ ĐỌC, không trùng lặp. */
  nguonChatIds: string[];
}

/** Tham số truy vấn lịch sử. Mọi trường đều tuỳ chọn trừ khi nói khác. */
export interface ThamSoLichSu {
  /** Giới hạn về đúng một hội thoại. Không truyền = tìm mọi hội thoại được nghe. */
  chatId?: string;
  /** Tìm trong `noi_dung`. */
  tuKhoa?: string;
  /** Mặc định GIOI_HAN.SO_LUONG_MAC_DINH, trần cứng GIOI_HAN.SO_LUONG_TOI_DA. */
  soLuong?: number;
  /** ISO date/datetime. So với ts_zalo. */
  tuNgay?: string;
  denNgay?: string;
  /** Mặc định false — tin đã thu hồi VẪN trả về (đó là tính năng, không phải bug). */
  boQuaDaThuHoi?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. CHÍNH SÁCH (src/policy/, G4)
// ═══════════════════════════════════════════════════════════════════════

export type HanhDongGate = 'allow' | 'drop' | 'reply';

/**
 * Kết quả của `decideGate()` trong gate.js.
 * ⚠️ gate.js là HÀM THUẦN: không mạng, không I/O, không ghi DB.
 * Nó chỉ QUYẾT ĐỊNH; caller mới thực thi.
 *
 * 'drop' = bỏ IM LẶNG. Không trả lời, không react, không báo gì cho người gửi —
 * người lạ không được biết bot có tồn tại/còn sống hay không.
 */
export interface GateResult {
  action: HanhDongGate;
  /** Có mặt khi action !== 'drop'. Với 'reply' thì payload.text là câu trả lời cứng. */
  payload?: {
    text?: string;
    chatId?: string;
    /** Lý do quyết định — để ghi log, KHÔNG gửi cho người dùng. */
    lyDo?: string;
  };
}

export type HuongTraLoi = 'nhom' | 'dm_host' | 'tu_choi';

/** Kết quả của leak_guard — quyết định đáp án đi đường nào. */
export interface QuyetDinhChongRoCheo {
  huong: HuongTraLoi;
  /** true = nguồn dữ liệu có chat_id KHÁC nơi host hỏi. */
  coCheo: boolean;
  /** Các chat_id "lạ" gây ra cờ coCheo. Ghi log, KHÔNG gửi ra ngoài. */
  nguonLa: string[];
  lyDo: string;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. CẤU HÌNH (src/policy/access.js, G4) — tên trường CHỐT CỨNG
// ═══════════════════════════════════════════════════════════════════════

export interface CauHinhHost {
  /** Zalo user_id của host, TEXT. */
  userId: string;
  ten: string;
  /** threadId của DM giữa trợ lý và host — đích của luật chống rò chéo. */
  dmChatId: string;
}

export interface CauHinhNhom {
  chatId: string;
  ten: string;
  /** false = có nghe sự kiện nhưng KHÔNG ghi vào DB. */
  ghiLichSu: boolean;
  /** false = không bao giờ trả lời trong nhóm này, kể cả host tag. */
  traLoiKhiTag: boolean;
}

export interface CauHinhDuongDan {
  /** ★ MẶC ĐỊNH PHẢI NGOÀI project (~/.zalo-tro-ly/) — mức siết CAO. */
  db: string;
  session: string;
  health: string;
}

export interface CauHinhThoiGian {
  keepAliveMs: number;
  watchdogMs: number;
  /** Không sự kiện nào trong khoảng này ⇒ NGHI listener chết (lớp dự phòng). */
  imLangMs: number;
  /** Câu hỏi cũ hơn mức này thì bỏ — trả lời muộn là vô duyên. */
  queueTtlMs: number;
}

export interface CauHinh {
  hosts: CauHinhHost[];
  groups: CauHinhNhom[];
  duongDan: CauHinhDuongDan;
  thoiGian: CauHinhThoiGian;
  /**
   * ★ HẰNG SỐ, ĐỌC TỪ CONFIG. ⛔ KHÔNG do model sinh, KHÔNG tham số hoá.
   * Để model tự viết câu này là nó lộ chủ đề:
   * "em nhắn riêng anh vụ báo giá bên <khách hàng>" — rò rồi.
   */
  cauTrungTinh: string;
  /** Lệnh shell người setup tự cắm để nhận cảnh báo. null = không dùng. */
  notifyCommand: string | null;
  /** ⚠️ updateSettings(ShowOnlineStatus,0) là cài đặt CẤP TÀI KHOẢN. */
  anTrangThai: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. SỨC KHOẺ (src/ops/health.js, G6)
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 `KHONG_BIET` là trạng thái ĐỘC LẬP, không được gộp vào `LISTENER_CHET`.
 * Xem giải thích đầy đủ ở src/lib/hang_so.js.
 */
export type MaTrangThaiSucKhoe =
  | 'OK'
  | 'LISTENER_CHET'
  | 'DANG_NOI_LAI'
  | 'CAN_QR'
  | 'KHONG_BIET';

/** Nội dung file `health.json`. */
export interface TrangThaiSucKhoe {
  trangThai: MaTrangThaiSucKhoe;
  /** Câu người đọc hiểu được. ĐÃ QUA redact() — không được chứa cookie. */
  lyDo: string;
  /** ISO datetime, thời điểm VÀO trạng thái này (không phải lúc ghi file). */
  tuLuc: string;
  soLanThuLai: number;
}

// ═══════════════════════════════════════════════════════════════════════
// 7. TOOL MCP (src/mcp/tools.js, G5) — 4 tool, tên + chữ ký CHỐT CỨNG
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ HAI HÌNH DẠNG CỦA CÙNG MỘT HỢP ĐỒNG — đừng nhầm:
 *
 *  · Chữ ký HÀM JS (trong code):     lichSu(requestId, thamSo)
 *  · inputSchema của MCP (JSON):     một object PHẲNG, request_id nằm cùng cấp
 *
 * MCP chỉ truyền được MỘT object đối số, nên schema phải phẳng.
 * `request_id` là BẮT BUỘC ở `lich_su`, `tra_loi`, `nhan_rieng_host`.
 * `trang_thai` KHÔNG có tham số nào.
 */
export interface ThamSoToolLichSu extends ThamSoLichSu {
  request_id: string;
}

export interface ThamSoToolTraLoi {
  request_id: string;
  text: string;
}

export interface ThamSoToolNhanRiengHost {
  request_id: string;
  text: string;
}

/** `trang_thai()` — không tham số. */
export type ThamSoToolTrangThai = Record<string, never>;

/**
 * Mọi tool trả về hình dạng này. ⛔ KHÔNG ném stack ra client.
 * Lỗi ⇒ `{ ok: false, ma: <MA_LOI>, thongDiep }`.
 */
export interface KetQuaTool<T = unknown> {
  ok: boolean;
  /** Có mặt khi ok === true. */
  duLieu?: T;
  /** Có mặt khi ok === false. Lấy từ MA_LOI trong src/lib/hang_so.js. */
  ma?: string;
  /** Câu người đọc hiểu được, ĐÃ QUA redact(). */
  thongDiep?: string;
}

/** Dữ liệu trả về của `lich_su`. */
export interface DuLieuLichSu {
  /** Đã rút gọn cho model đọc — KHÔNG trả nguyên dòng DB. */
  tin: Array<{
    chatId: string;
    tenHoiThoai: string | null;
    nguoiGui: string | null;
    noiDung: string | null;
    msgType: string;
    thoiGian: string;
    daThuHoi: boolean;
  }>;
  soDong: number;
  /**
   * ⚠️ Trả về cho MINH BẠCH, nhưng cưỡng chế KHÔNG dựa vào việc model
   * đọc trường này. Cưỡng chế nằm ở `tra_loi` phía server.
   */
  nguonChatIds: string[];
}

/** Dữ liệu trả về của `tra_loi` / `nhan_rieng_host`. */
export interface DuLieuGui {
  huong: HuongTraLoi;
  coCheo: boolean;
  /** msgId của tin trợ lý vừa gửi, nếu gửi được. */
  msgId: string | null;
}

/** Dữ liệu trả về của `trang_thai`. */
export interface DuLieuTrangThai {
  sucKhoe: TrangThaiSucKhoe;
  soNhomDangNghe: number;
  soTinDaLuu: number;
  soThuHoiMoCoi: number;
  /** Số câu hỏi đang ở trạng thái 'cho'. */
  soHangDoiCho: number;
}

// ═══════════════════════════════════════════════════════════════════════
// 8. HÀNG ĐỢI + PHIÊN TRUY VẤN (G5 dựng, G4 cưỡng chế)
// ═══════════════════════════════════════════════════════════════════════

export interface MucHangDoi {
  requestId: string;
  chatIdHoi: string;
  msgId: string;
  userId: string;
  noiDung: string;
  tsTao: string;
}

/**
 * Bộ tích luỹ nguồn, sống trong RAM tiến trình server.
 *
 * 🔴 Sống theo `requestId`, KHÔNG phải theo lượt gọi tool.
 * Claude tra 3 lần rồi mới trả lời — reset giữa chừng thì lần cuối trông
 * "sạch" và luật bị lách mà không ai cố ý.
 */
export interface BoTichLuyNguon {
  ghiNhan(requestId: string, nguonChatIds: string[]): void;
  lay(requestId: string): string[];
  xoa(requestId: string): void;
}

/** Payload gửi kèm notification channel sang phiên Claude. */
export interface ThongBaoChannel {
  requestId: string;
  chatId: string;
  tenHoiThoai: string | null;
  nguoiHoi: string | null;
  noiDung: string;
  tsZalo: number;
}
