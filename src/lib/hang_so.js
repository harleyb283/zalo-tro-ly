/**
 * ═══════════════════════════════════════════════════════════════════════
 * HỢP ĐỒNG G0 — mọi CHUỖI CỐ ĐỊNH mà nhiều gói cùng dùng.
 *
 * VÌ SAO có file này: 5 pane viết song song. Nếu mã trạng thái chỉ được
 * "chốt bằng lời" trong tài liệu thì G5 gõ 'LISTENER_CHET', G6 gõ
 * 'listener_chet', và không ai thấy lỗi cho tới lúc ghép — vì so sánh
 * chuỗi sai chỉ trả `false`, không ném exception.
 *
 * ⛔ CẤM gõ tay các chuỗi này ở nơi khác. Import từ đây.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * 🔴 LUẬT SỐ 1 CỦA CẢ PACK — dán ở đây cho mọi gói cùng thấy:
 *
 *   TIẾN TRÌNH NÀY NÓI GIAO THỨC MCP QUA **stdout**.
 *   ⛔ TUYỆT ĐỐI KHÔNG `console.log()` / `process.stdout.write()` ở BẤT KỲ
 *      module nào — một dòng chữ lạc vào stdout là hỏng cả phiên MCP,
 *      và hỏng theo kiểu CÂM (client chỉ thấy "server không phản hồi").
 *   ✅ Mọi log/cảnh báo đi bằng `console.error()` hoặc
 *      `process.stderr.write()`. Ngoại lệ DUY NHẤT: các script trong `bin/`
 *      chạy tay ở terminal (không nói MCP) thì in stdout thoải mái.
 */
export const CANH_BAO_STDOUT =
  'stdout dành riêng cho giao thức MCP — dùng console.error(), không dùng console.log()';

// ─── Mã trạng thái sức khoẻ (hợp đồng G0 mục 5) ────────────────────────
/**
 * ⚠️ `KHONG_BIET` PHẢI CÓ TỪ ĐẦU và phải được xử lý RIÊNG, không gộp vào
 * `LISTENER_CHET`. Lý do: watchdog tầng 1 đọc `ws._closeTimer` — một thuộc
 * tính PRIVATE của zca-js. Thư viện lên version đổi tên thuộc tính thì hàm
 * dò trả `null`. Nếu `null` bị nhồi thành `LISTENER_CHET` ⇒ watchdog đăng
 * nhập lại VÔ HẠN. Nếu bị nhồi thành `OK` ⇒ watchdog chết CÂM đúng lúc cần
 * nhất. Ba trạng thái, không phải hai.
 * @type {Readonly<Record<string, import('../types.d.ts').MaTrangThaiSucKhoe>>}
 */
export const TRANG_THAI_SUC_KHOE = Object.freeze({
  OK: 'OK',
  LISTENER_CHET: 'LISTENER_CHET',
  DANG_NOI_LAI: 'DANG_NOI_LAI',
  CAN_QR: 'CAN_QR',
  KHONG_BIET: 'KHONG_BIET',
});

/** Danh sách hợp lệ, để validate. */
export const DANH_SACH_TRANG_THAI_SUC_KHOE = Object.freeze(Object.values(TRANG_THAI_SUC_KHOE));

// ─── Tên 4 tool MCP (hợp đồng G0 mục 4) ────────────────────────────────
export const TEN_TOOL = Object.freeze({
  LICH_SU: 'lich_su',
  TRA_LOI: 'tra_loi',
  NHAN_RIENG_HOST: 'nhan_rieng_host',
  TRANG_THAI: 'trang_thai',
});

// ─── Sự kiện nội bộ do src/zalo/listener.js phát ra ────────────────────
// G2 phát, G8 nối dây, G3/G4/G5 tiêu thụ. Tên sai = im lặng không nhận gì.
export const SU_KIEN = Object.freeze({
  TIN_NHAN: 'tin_nhan',
  THU_HOI: 'thu_hoi',
  REACTION: 'reaction',
  SU_KIEN_NHOM: 'su_kien_nhom',
  LOI: 'loi',
});

// ─── Trạng thái hàng đợi hỏi (khớp CHECK trong schema.sql) ─────────────
export const TRANG_THAI_HANG_DOI = Object.freeze({
  CHO: 'cho',
  DA_DAY: 'da_day',
  /**
   * v9 — ★ CHỖ NHẬN VIỆC CỦA CLIENT, và nó tồn tại vì MỘT lý do:
   *
   * 🔴 `da_day` KHÔNG dùng làm chốt giành việc được. `pushPendingQueue` gom cả
   * `da_day` (bù dòng mồ côi), nên CAS `da_day -> da_day` **luôn thắng** —
   * hai client cùng khởi động sẽ cùng "nhận" một dòng rồi cùng đẩy, tức hai
   * lượt model cho một câu hỏi, tức hai tin vào nhóm người thật.
   *
   * `dang_xu_ly` là trạng thái KHÔNG NẰM trong tập mà vòng lấy việc quét ⇒
   * CAS vào nó chỉ thắng đúng một lần.
   */
  DANG_XU_LY: 'dang_xu_ly',
  DA_TRA_LOI: 'da_tra_loi',
  HET_HAN: 'het_han',
  BO: 'bo',
});

// ─── Hướng trả lời (ghi vào nhat_ky_truy_van.huong_tra_loi) ────────────
export const HUONG_TRA_LOI = Object.freeze({
  NHOM: 'nhom',
  DM_HOST: 'dm_host',
  TU_CHOI: 'tu_choi',
});

// ─── Hành động của policy/gate.js ──────────────────────────────────────
export const HANH_DONG_GATE = Object.freeze({
  ALLOW: 'allow',   // tỉnh dậy VÀ được nói
  /**
   * v9 (21/08/2026) — ★ TỈNH DẬY NHƯNG **KHÔNG ĐƯỢC NÓI**.
   *
   * Anh chốt: *"khi đó em mới thực sự là trợ lý"* — trợ lý phải luôn theo kịp
   * nhóm, ⛔ không phải cái bot ngồi chờ gọi tên. Nên tin của người khác trong
   * nhóm đã duyệt nay TẠO MỘT LƯỢT thay vì bị vứt.
   *
   * 🔴 LUẬT "IM TRONG NHÓM TRỪ KHI HOST TAG" KHÔNG ĐỔI MỘT CHỮ. Nó chuyển từ
   * *"không nghe"* sang *"nghe mà không nói"* — cái ra Zalo vẫn y hệt hôm nay.
   */
  NGHE: 'nghe',
  DROP: 'drop',     // bỏ IM LẶNG — người lạ không được biết bot có sống hay không
  REPLY: 'reply',   // trả lời cứng tại chỗ, không cần Claude
});

// ─── Loại hội thoại (khớp CHECK trong schema.sql) ──────────────────────
export const LOAI_HOI_THOAI = Object.freeze({
  GROUP: 'GROUP',
  DM: 'DM',
  UNKNOWN: 'UNKNOWN',
});

// ─── msgType ───────────────────────────────────────────────────────────
/**
 * Chỉ 3 loại đã XÁC NHẬN từ code mẫu của chính tác giả zca-js.
 * Voice/video/file/sticker/vị trí NHẬN ĐƯỢC nhưng CHƯA BIẾT tên chính xác
 * ⇒ mọi msgType lạ ghi thành `UNKNOWN` + giữ `content_raw`, và đếm bằng
 * `idx_tin_type_la`. Đừng đoán tên rồi hardcode.
 */
export const MSG_TYPE = Object.freeze({
  TEXT: 'chat.text',
  IMAGE: 'chat.image',
  LINK: 'chat.link',
  UNKNOWN: 'UNKNOWN',
});

/** msgType nào được phép có `noi_dung` khác NULL — thi hành spec H ở tầng code. */
export const MSG_TYPE_CO_NOI_DUNG = Object.freeze([MSG_TYPE.TEXT]);

// ─── Mã lỗi trả về từ tool MCP (hợp đồng G0 mục 9) ─────────────────────
/**
 * Tool KHÔNG BAO GIỜ ném stack ra client. Trả `{ ok: false, ma, thongDiep }`
 * với `ma` lấy từ đây.
 */
export const MA_LOI = Object.freeze({
  THIEU_REQUEST_ID: 'THIEU_REQUEST_ID',
  REQUEST_ID_LA: 'REQUEST_ID_LA',        // không có trong hang_doi_hoi → fail-closed
  HANG_DOI_HET_HAN: 'HANG_DOI_HET_HAN',
  BI_CHAN_RO_CHEO: 'BI_CHAN_RO_CHEO',    // đã chuyển sang DM host
  KHONG_CO_HOST: 'KHONG_CO_HOST',
  ZALO_CHUA_SAN_SANG: 'ZALO_CHUA_SAN_SANG',
  DB_LOI: 'DB_LOI',
  CAU_HINH_SAI: 'CAU_HINH_SAI',
  KHONG_RO: 'KHONG_RO',
  // v6: cổng ghi chặn vì lượt này chưa có tool ghi nào chạy. ⚠️ Đây KHÔNG phải
  // lỗi hệ thống — là lời nhắc việc, và luôn có đường đi tiếp (`khongCanGhi`).
  CAN_GHI_TRUOC: 'CAN_GHI_TRUOC',
});

// ─── Giới hạn mặc định ─────────────────────────────────────────────────
export const GIOI_HAN = Object.freeze({
  SO_LUONG_MAC_DINH: 50,      // lich_su({soLuong}) khi không truyền
  SO_LUONG_TOI_DA: 500,       // trần cứng, chặn truy vấn kéo cả kho vào prompt
  DO_DAI_TIN_TOI_DA: 4000,    // cắt text trước khi gửi Zalo
  SO_LAN_NOI_LAI_TOI_DA: 5,
});

/** Backoff nối lại (ms) — thiết kế 5.2. Vượt mảng thì dùng phần tử cuối. */
export const BACKOFF_NOI_LAI_MS = Object.freeze([5000, 15000, 60000, 300000, 300000]);

// ─── v3: DÒ TIN THU HỒI BẰNG ĐỐI CHIẾU ─────────────────────────────────
/**
 * 🔴 HAI MỨC TIN CẬY KHÔNG ĐƯỢC TRỘN.
 *  · SU_KIEN   — nghe được sự kiện `undo`: biết CHẮC ai thu hồi và LÚC NÀO.
 *  · DOI_CHIEU — suy ra do tin vắng mặt khi quét lại: KHÔNG biết chính xác
 *                lúc nào, chỉ biết nó xảy ra GIỮA HAI LẦN QUÉT.
 * Trộn hai thứ này rồi trả lời anh "bị thu hồi lúc 14:32" trong khi thực tế
 * chỉ biết "khoảng 14:00–14:30" là NÓI SAI SỰ THẬT mà không ai phát hiện được.
 */
export const NGUON_THU_HOI = Object.freeze({
  SU_KIEN: 'SU_KIEN',
  DOI_CHIEU: 'DOI_CHIEU',
});

/**
 * Mức tin cậy của kết luận thu hồi.
 * NGHI_NGO = mới vắng mặt 1 lần quét, CHƯA được coi là thu hồi.
 * SUY_RA   = vắng mặt đủ số lần liên tiếp -> mới dám kết luận.
 */
export const DO_TIN_CAY = Object.freeze({
  CHAC_CHAN: 'CHAC_CHAN',
  SUY_RA: 'SUY_RA',
  NGHI_NGO: 'NGHI_NGO',
});

/**
 * Kết luận của MỐC A0. Bốn trạng thái, KHÔNG gộp.
 *
 * 🔴 `CHUA_SAN_SANG` PHẢI TÁCH KHỎI `DO`. Ngày 20/08/2026 lượt A0 đầu ghi `DO`
 * cho ca chưa gọi được mạng lần nào, và Router suýt kết luận "endpoint chết ⇒
 * dừng hẳn phương án A". Hai thứ hoàn toàn khác nhau:
 *   DO             = ĐÃ GỌI THẬT và hỏng  -> đây mới là điều kiện dừng phương án
 *   CHUA_SAN_SANG  = chưa gọi lần nào     -> chưa biết gì, chạy lại
 * Phân biệt bằng `so_goi_mang`: 0 nghĩa là chưa có bằng chứng nào về endpoint.
 */
export const KET_LUAN_A0 = Object.freeze({
  XANH: 'XANH',
  GOI_DUOC_NHUNG_0_TIN: 'GOI_DUOC_NHUNG_0_TIN',
  CHUA_SAN_SANG: 'CHUA_SAN_SANG',
  DO: 'DO',
});

/**
 * Chờ phiên Zalo sẵn sàng trước khi chạy A0.
 *
 * ⚠️ Chờ KHÔNG phải bản vá cho lỗi đọc nhầm thuộc tính (xem
 * `api_lichsu.cloudMessageBase`) — cả hai nguồn đều được gán XONG trước khi
 * `login()` trả về, nên đường bình thường không có cuộc đua nào.
 * Vòng chờ này chỉ là lưới cho ca NỐI LẠI PHIÊN: watchdog thay `api` bằng đối
 * tượng mới, có một khoảnh khắc chưa có service map.
 * ⇒ 60 giây là quá đủ (đăng nhập thật xong trong vài giây), mà vẫn đủ ngắn để
 * một phiên hỏng thật được báo ngay trong lượt khởi động chứ không treo im.
 */
export const A0_CHO = Object.freeze({
  TRAN_MS: 60_000,
  TICK_MS: 500,
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 * NHÓM NGUYÊN NHÂN khi A0 hỏng — sinh ra ngày 20/08/2026.
 *
 * 🔴 VÌ SAO CẦN: lượt A0 thứ hai ghi `loi: "Lỗi không xác định"` — một chuỗi
 * KHÔNG NÓI GÌ CẢ. Cả tính năng này sinh ra để chống "hỏng mà không ai biết vì
 * sao", mà bản thân phép đo lại nuốt mất nguyên nhân. Con số thì đáng tin, lý
 * do thì không.
 *
 * Ba nhóm dưới đây có cách xử KHÁC HẲN NHAU, nên KHÔNG được gộp:
 *   ENDPOINT_CHET   -> ĐÂY MỚI LÀ ĐIỀU KIỆN DỪNG PHƯƠNG ÁN A
 *   *_LOI_GIAO_THUC -> endpoint SỐNG, sai tham số/quyền -> SỬA ĐƯỢC
 *   QUYEN_PHIEN     -> hướng khác hẳn (chữ ký, đăng nhập lại)
 *
 * ⚠️ CỐ Ý KHÔNG có nhóm "THAM_SO_SAI" suy ra từ mã lỗi Zalo: KHÔNG tồn tại
 * bảng mã lỗi Zalo công khai nào đủ tin để tra. Bịa ra một bảng như thế là
 * đúng cái lỗi mà `nhom_loi` sinh ra để chặn. Ta chỉ nói được tới mức
 * "endpoint sống, lỗi nằm trong giao thức" — phần còn lại phải ĐO, không đoán.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const NHOM_LOI_A0 = Object.freeze({
  /** Chưa có request nào rời khỏi tiến trình -> KHÔNG nói gì được về endpoint. */
  CHUA_CHAM_MANG: 'CHUA_CHAM_MANG',
  /** Request bắn đi nhưng không nối được (DNS/TCP/timeout). Có thể chỉ là mạng. */
  KHONG_KET_NOI_DUOC: 'KHONG_KET_NOI_DUOC',
  /** 404/410 -> endpoint đã gỡ. ĐIỀU KIỆN DỪNG DUY NHẤT. */
  ENDPOINT_CHET: 'ENDPOINT_CHET',
  /** 401/403 -> quyền hoặc phiên. */
  QUYEN_PHIEN: 'QUYEN_PHIEN',
  /** 5xx -> lỗi phía Zalo, thử lại lượt sau. */
  MAY_CHU_LOI: 'MAY_CHU_LOI',
  /** HTTP OK + Zalo trả error_code trong THÂN -> endpoint SỐNG, ta gọi sai. */
  ENDPOINT_SONG_LOI_GIAO_THUC: 'ENDPOINT_SONG_LOI_GIAO_THUC',
  /**
   * Bộ tham số CHUẨN hỏng nhưng BIẾN THỂ chạy được -> đã CHỨNG MINH là sai
   * tham số, không phải đoán. Chỉ đặt được khi lượt biến thể thành công thật.
   */
  THAM_SO_SAI_DA_CHUNG_MINH: 'THAM_SO_SAI_DA_CHUNG_MINH',
  /** Không đủ bằng chứng. Nói thẳng thay vì đoán bừa. */
  CHUA_PHAN_LOAI_DUOC: 'CHUA_PHAN_LOAI_DUOC',
});

/** Trần cắt cho các trường chẩn đoán — file này Router đọc bằng mắt. */
export const A0_CHAN_DOAN = Object.freeze({
  TRAN_THAN_PHAN_HOI: 400,
  TRAN_STACK_DONG: 3,
  TRAN_LOI_KY_TU: 500,
});

/**
 * Biến thể tham số dùng cho MỘT lượt gọi chẩn đoán.
 *
 * 🔴 KHÔNG PHẢI "thử nhiều lần cho chắc" — trần gọi mạng KHÔNG đổi (vẫn 2).
 * Lượt thứ hai chỉ chạy khi lượt đầu đã chứng minh endpoint SỐNG, và nó đổi
 * ĐÚNG MỘT tham số để lần sau khỏi phải đoán nhóm 2 hay nhóm 3.
 *
 * MSG_IDS_CHUOI: gửi `msgIds` dạng CHUỖI `"[]"` thay vì mảng rỗng.
 * Căn cứ (đọc `node_modules/zca-js/dist/apis/`, KHÔNG đọc tài liệu): zca-js
 * stringify MỌI cấu trúc lồng trước khi nhét vào params —
 *   sendSeenEvent  `msgInfos: JSON.stringify(msgInfos)`
 *   deleteAvatar   `delPhotos: JSON.stringify(delPhotos)`
 *   updateLabels   `labelData: JSON.stringify(...)`
 *   sendMessage    `mentionInfo: JSON.stringify(...)`
 *   deleteGroupInviteBox `invitations: JSON.stringify(...)`
 * ⇒ quy ước của Zalo là params PHẲNG. `msgIds: []` (mảng thật) là chỗ lệch
 * quy ước duy nhất trong bộ tham số ta đang gửi.
 */
export const BIEN_THE_THAM_SO = Object.freeze({
  CHUAN: 'CHUAN',
  /** ⛔ ĐÃ LOẠI 22:37 20/08 — cũng ra 604 y hệt. ĐỪNG THỬ LẠI, phí request. */
  MSG_IDS_CHUOI: 'MSG_IDS_CHUOI',
  SRC_1: 'SRC_1',
  BO_IMEI: 'BO_IMEI',
  CON_TRO_THAT: 'CON_TRO_THAT',
  TOI_THIEU: 'TOI_THIEU',
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 * BỘ ĐO NHIỀU GIẢ THUYẾT TRONG MỘT LẦN KHỞI ĐỘNG.
 *
 * 🔴 VÌ SAO ĐỔI THIẾT KẾ: mỗi lượt đo cũ trả lời ĐÚNG MỘT câu hỏi mà tốn MỘT
 * lần restart daemon. Anh sắp ngồi test và sẽ không cho restart nữa ⇒ một lần
 * chạy phải loại được NHIỀU đường, không phải một.
 *
 * 🔴 TRẦN 5 REQUEST CHO CẢ BỘ, gồm cả lượt chuẩn. Đây là TÀI KHOẢN THẬT của
 * anh trên một client KHÔNG CHÍNH THỐNG — bắn dồn là rủi ro bị gắn cờ spam,
 * khoá 24–48h. Không ai biết ngưỡng thật của Zalo nên con số này là PHỎNG ĐOÁN
 * CÓ CĂN CỨ, và nó chỉ được phép GIẢM, không được tăng.
 *
 * Nghỉ ≥ 2 giây giữa các lượt, vì lý do trên. `NGHI_GIUA_2_REQUEST_MS` (1,5s)
 * là cho phân trang trong MỘT lượt quét — ở đây ta đổi hẳn hình dạng tham số
 * nên giãn rộng hơn.
 *
 * Thứ tự chạy XẾP THEO SỨC MẠNH BẰNG CHỨNG giảm dần, để nếu chạm trần giữa
 * chừng thì thứ bị bỏ luôn là thứ mơ hồ nhất.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const A0_BO_DO = Object.freeze({
  TRAN_REQUEST_CA_BO: 5,
  NGHI_GIUA_BIEN_THE_MS: 2_000,
  DAY_BIEN_THE: Object.freeze([
    'SRC_1',         // 3/3 API zca-js gửi src đều dùng src:1
    'BO_IMEI',       // deleteMessage BỎ imei ở đúng nhánh nhóm
    'CON_TRO_THAT',  // globalMsgId trong zca-js LUÔN là id thật, chưa bao giờ là 0
    'TOI_THIEU',     // lưới vét: bỏ hết thứ không chắc chắn
  ]),
});

/** Kết quả một lượt quét, ghi vào `doi_chieu_lich_su.ket_qua`. */
export const KET_QUA_QUET = Object.freeze({
  OK: 'OK',
  CUT_TRANG: 'CUT_TRANG',
  LOI_MANG: 'LOI_MANG',
  BO_QUA: 'BO_QUA',
});

/**
 * 🔴 TRẦN GỌI MẠNG. Đây là client KHÔNG CHÍNH THỐNG gọi lặp lại — đúng thứ
 * làm tài khoản bị gắn cờ spam. Không ai biết ngưỡng thật của Zalo, nên mọi
 * con số dưới đây là PHỎNG ĐOÁN CÓ CĂN CỨ, không phải số đo.
 *
 * ⚠️ CHU_KY_QUET_MS để 60 PHÚT cho tuần đầu (Router chốt), rút xuống 30 sau
 * khi theo dõi thấy tài khoản không sao. Cửa sổ 75 phút > chu kỳ 60 phút nên
 * vẫn còn chồng lấn — điều kiện cần để "xác nhận 2 lần liên tiếp" hoạt động.
 */
export const GIOI_HAN_QUET = Object.freeze({
  TRAN_MOI_LAN_QUET: 6,          // ~300 tin/nhóm/lượt; quá thì dừng, ghi CUT_TRANG
  TRAN_MOI_NGAY: 200,            // chạm trần -> NGỪNG tới nửa đêm + báo host
  CHU_KY_QUET_MS: 3_600_000,     // 60 phút (tuần đầu)
  CUA_SO_QUET_MS: 4_500_000,     // 75 phút — biên "còn quyền thu hồi" + đệm
  NGHI_GIUA_2_REQUEST_MS: 1500,
  QUET_GIO_YEN: Object.freeze([0, 6]),   // 0h–6h không quét
  SO_TIN_MOI_TRANG: 50,          // trần cứng của endpoint (PR tự kẹp Math.min(50,…))
  BO_QUA_TIN_MOI_HON_MS: 60_000, // tin < 60 giây: có thể đang đồng bộ
  SO_LAN_VANG_DE_KET_LUAN: 2,    // phải vắng 2 lượt LIÊN TIẾP mới nâng SUY_RA
});

// ─── v3: HẸN GIỜ GỬI TIN ───────────────────────────────────────────────
/** Khớp CHECK trong schema.sql. */
export const TRANG_THAI_LICH = Object.freeze({
  CHO_XAC_NHAN: 'cho_xac_nhan',
  DA_LEN_LICH: 'da_len_lich',
  DA_GUI: 'da_gui',
  QUA_HAN: 'qua_han',
  DA_HUY: 'da_huy',
  LOI: 'loi',
});

/**
 * 🔴 THIÊN VỊ KHÔNG GỬI. Gửi nhầm giờ vào nhóm có người thật thì KHÔNG rút
 * lại được; không gửi thì host vẫn được báo và tự quyết. Anh nói thẳng:
 * "nhắc muộn 2 ngày TỆ HƠN không nhắc".
 */
export const GIOI_HAN_LICH = Object.freeze({
  NHIP_KIEM_MS: 30_000,          // đánh thức mỗi 30 giây, có index riêng nên rẻ
  TRE_IM_LANG_MS: 300_000,       // ≤ 5 phút: gửi bình thường, không nói gì
  TRAN_TRE_MS: 7_200_000,        // > 2 giờ: KHÔNG gửi vào nhóm, DM host
  TRAN_TUONG_LAI_MS: 15_552_000_000, // 180 ngày — chặn ca model tính nhầm năm
  TRAN_DANG_CHO: 50,             // chặn vòng lặp model đặt hàng loạt
  MUI_GIO_MAC_DINH: 'Asia/Ho_Chi_Minh',
});

/** Tiền tố CỐ ĐỊNH cho tin nhắc bị trễ vừa phải — do code dựng, không để model viết. */
export const TIEN_TO_NHAC_MUON = '(nhắc muộn) ';

// ─── v4: NHẮC NHỞ LÀ THEO ĐUỔI TỚI KHI XONG (anh chốt 20/08/2026) ──────
/**
 * Trạng thái riêng của lời nhắc THEO ĐUỔI.
 *
 * ⚠️ VÌ SAO PHẢI LÀ CỘT RIÊNG, không thêm giá trị vào `trang_thai`:
 * `lich_hen.trang_thai` có ràng buộc CHECK liệt kê cứng 6 giá trị. Thêm giá trị
 * thứ 7 đòi DỰNG LẠI BẢNG — mà luật migrate của pack cấm DROP/RENAME/copy-bảng
 * (đây là kho hội thoại THẬT, mất là mất hẳn). Nên `trang_thai` giữ nguyên vòng
 * đời cũ, `trang_thai_td` chỉ có nghĩa khi `la_theo_duoi = 1`.
 */
export const TRANG_THAI_TD = Object.freeze({
  DANG_THEO_DUOI: 'dang_theo_duoi',
  TAM_DUNG: 'tam_dung',
  DA_XONG: 'da_xong',
});

/**
 * 🔴 KHÔNG CÓ TRẦN LEO THANG. ĐỪNG THÊM LẠI.
 *
 * Router từng đề xuất "N ngày không xong thì ngừng nhắc nhóm, quay sang hỏi
 * riêng anh" — anh BÁC thẳng: *"Đây là làm việc, không phải đi chơi nên ko có
 * chuyện ko làm mà có mặt mũi ở đây"*. Nhắc TỚI KHI XONG VIỆC.
 *
 * Thứ DUY NHẤT thay cho trần là VAN XẢ: anh giãn nhịp bằng lời ngay trong nhóm
 * ("2 ngày check lại 1 lần cho anh"). Nếu ai đó bỏ van xả đi thì phải dựng lại
 * trần — nhưng đó là quyết định của anh, không phải của người sửa code.
 */
export const NHAC_THEO_DUOI = Object.freeze({
  CHU_KY_NGAY_MAC_DINH: 1,
  GIO_NHAC_MAC_DINH: '08:00',
  /**
   * ⚠️ ĐỔI 22/08/2026 — anh chốt: *"Bỏ giới hạn không nhắc vào CN đi"*.
   *
   * Trước đây `true` vì anh nói *"Không chắc chủ nhật nhé"* (20/08). Nay bỏ:
   * Chủ Nhật nhắc như mọi ngày.
   *
   * ⚠️ Cờ vẫn giữ nguyên trong schema và vẫn khai được cho từng lời nhắc —
   * ⛔ KHÔNG xoá. Đây là đổi MẶC ĐỊNH, ⛔ không phải bỏ tính năng: anh muốn
   * chừa Chủ Nhật cho một việc cụ thể thì vẫn khai được.
   *
   * 🔴 Bỏ chừa Chủ Nhật còn sửa luôn một cái bẫy phụ: khi chừa CN thì nhịp 1
   * ngày và nhịp 2 ngày rơi TRÙNG nhau nếu hôm nay là thứ Bảy — đúng ca đã
   * làm bài test D2 (`theo_duoi`) đỏ oan sáng nay.
   */
  BO_CHU_NHAT_MAC_DINH: false,
  CHU_KY_NGAY_TOI_DA: 90,        // chặn model quy đổi nhầm ("2 năm nữa check lại")

  // ─── NHỊP THEO PHÚT (anh chốt 20/08/2026: "cứ 2p nhắc lại 1 lần") ────
  // Nhịp phút là "cứ N phút KỂ TỪ LẦN NHẮC TRƯỚC" — KHÁC bản chất với nhịp
  // ngày ("mỗi N ngày lúc HH:MM"). Xem `_docNhip()` ở lich/follow_up.js.
  CHU_KY_PHUT_TOI_THIEU: 1,      // chặn 0 và số âm; 1 phút đủ để anh test
  CHU_KY_PHUT_TOI_DA: 1440,      // > 1 ngày thì khai bằng chuKyNgay cho đúng nghĩa
  /**
   * 🔴 TRẦN SỐ LẦN — điều kiện anh duyệt phương án C, KHÔNG được bỏ.
   * Nhịp DÀY (dưới ngưỡng dưới) mà không trần thì một lời nhắc quên đóng sẽ
   * nhắn người thật mãi mãi. 10 lần × 2 phút ≈ 20 phút — đủ dài để người ta
   * kịp thấy và trả lời, đủ ngắn để không thành phiền nếu họ đang bận.
   */
  TRAN_SO_LAN_MAC_DINH_NHIP_DAY: 10,
  NGUONG_NHIP_DAY_PHUT: 60,      // < 1 giờ = nhịp dày -> áp trần mặc định
  TRAN_SO_LAN_TOI_DA: 500,       // chặn model gõ nhầm "nhắc 100000 lần"
  // Cửa sổ lấy bối cảnh khi dựng câu nhắc: từ lần nhắc trước tới giờ. Chưa nhắc
  // lần nào thì lùi tối đa bằng đây.
  CUA_SO_BOI_CANH_MS: 7 * 86_400_000,
  SO_TIN_BOI_CANH_TOI_DA: 30,
  /**
   * 🔴 Giao model viết câu rồi model im — sau ngần này thì CODE TỰ GỬI câu dự
   * phòng. Thiếu đường bù này thì Claude rớt là lời nhắc BIẾN MẤT ÂM THẦM, đúng
   * thứ cả tính năng sinh ra để chống ("việc rơi mà không ai biết").
   * 10 phút: đủ rộng cho một lượt Claude bình thường, đủ hẹp để lời nhắc 08:00
   * vẫn tới trong buổi sáng.
   */
  TRAN_CHO_MODEL_MS: 600_000,
});

/** Ai đóng được một lời nhắc theo đuổi. */
export const LY_DO_DONG = Object.freeze({
  HOST_DONG: 'HOST_DONG',        // đường DUY NHẤT hợp lệ để coi là XONG VIỆC
  /**
   * Dừng vì HẾT LƯỢT, KHÔNG phải vì xong việc. Phải phân biệt được: host nhìn
   * vào phải biết ngay là lời nhắc tắt do chạm trần chứ không phải do ai đó
   * đã giải quyết. Kèm theo là một tin nhắn riêng cho host.
   */
  HET_LUOT: 'HET_LUOT',
});

// ─── Tên tool MCP thêm ở v3 ────────────────────────────────────────────
export const TEN_TOOL_LICH = Object.freeze({
  DAT_LICH_NHAP: 'dat_lich_nhap',
  DAT_LICH_CHOT: 'dat_lich_chot',
  XEM_LICH: 'xem_lich',
  HUY_LICH: 'huy_lich',
});

/**
 * Tool NHẮC THEO ĐUỔI — lặp lại tới khi HOST bảo xong.
 *
 * 🔴 KHÁC HẲN `TEN_TOOL_LICH` ở trên, và đây là chỗ model rất dễ chọn nhầm vì
 * tên na ná nhau:
 *   · `TEN_TOOL_LICH`  = nhắc MỘT LẦN. `gui_luc_ms` là một mốc đơn; gửi xong
 *     chuyển `da_gui` và hết. Muốn nhắc tiếp thì mỗi lần phải đặt lại một lịch
 *     mới — quên một hôm là việc rơi im lặng.
 *   · `TEN_TOOL_NHAC`  = nhắc LẶP theo chu kỳ ngày, tự tính mốc kế tiếp, chạy
 *     mãi tới khi host đóng.
 * Mô tả từng tool bên `mcp/tools.js` phải nói rõ khác biệt này — model đọc mô
 * tả trước khi gọi, dặn ở chỗ khác thì lúc nó chuẩn bị gọi lại không thấy.
 */
export const TEN_TOOL_NHAC = Object.freeze({
  DAT_NHAC_THEO_DUOI: 'dat_nhac_theo_duoi',
  CHINH_NHIP_NHAC: 'chinh_nhip_nhac',
  DONG_NHAC: 'dong_nhac',
  XEM_NHAC: 'xem_nhac',
});

// ─── Tool GHI NHỚ + mở lại lời nhắc (v6, 21/08/2026) ───────────────────
export const TEN_TOOL_GHI = Object.freeze({
  GHI_NHO: 'ghi_nho',
  MO_LAI_NHAC: 'mo_lai_nhac',
  /**
   * v9 — ★ ĐÓNG MỘT LƯỢT MÀ KHÔNG GỬI GÌ. Đường ra sạch của lượt CHỈ NGHE.
   *
   * 🔴 Không có tool này thì lượt nghe không có cách nào kết thúc: `tra_loi`
   * bị chặn, nên dòng nằm lại `dang_xu_ly`/`da_day` cho tới khi quá hạn — và
   * lượt quá hạn thì bị đẩy bù lại ở lần khởi động sau, tức trợ lý xử lý lại
   * một tin cũ của người lạ. Nhân với 449 tin/ngày.
   *
   * ⛔ Tool này TUYỆT ĐỐI không chạm mạng. Nó chỉ đổi một dòng trong DB.
   */
  BO_QUA: 'bo_qua',
});

export const LOAI_GHI_NHO = Object.freeze({
  CHOT_VIEC: 'chot_viec',
  SU_KIEN: 'su_kien',
  DAC_DIEM_NGUOI: 'dac_diem_nguoi',
  KHAC: 'khac',
});

// ─── CHẾ ĐỘ CHẠY + VAI TIẾN TRÌNH (v7, 21/08/2026) ─────────────────────
/**
 * `mot-tien-trinh` — MẶC ĐỊNH, và là cách hệ đang chạy hôm nay: một tiến trình
 *   giữ Zalo, chạy bộ hẹn giờ, VÀ làm máy chủ MCP cho phiên Claude.
 * `tach` — daemon giữ Zalo + bộ hẹn giờ + gửi outbox; client chỉ làm máy chủ MCP.
 *
 * 🔴 Mặc định PHẢI là `mot-tien-trinh`. Daemon đang phục vụ người thật và có
 * lịch đã chốt đang chờ bắn — không khai gì thì hành vi y hệt hôm nay.
 */
export const CHE_DO = Object.freeze({
  MOT_TIEN_TRINH: 'mot-tien-trinh',
  TACH: 'tach',
});

/** Vai của MỘT tiến trình khi `cheDo = 'tach'`. Chỉ có nghĩa ở chế độ đó. */
export const VAI = Object.freeze({
  DAEMON: 'daemon',
  CLIENT: 'client',
});

/**
 * ★ Chốt chế độ + vai cho tiến trình này.
 *
 * Thứ tự ưu tiên: **cờ dòng lệnh > biến môi trường > config**.
 * ⚠️ `cheDo` là thuộc tính của CẢ HỆ (nên hợp với config), còn `vai` là thuộc
 * tính của TỪNG TIẾN TRÌNH (cùng một file config, máy chạy một daemon và N
 * client) ⇒ `vai` **chỉ** nhận từ cờ/env, ⛔ không bao giờ từ config.
 *
 * 🔴 Giá trị lạ ⇒ CẢNH BÁO rồi về `mot-tien-trinh`, ⛔ KHÔNG ném. Gõ sai một
 * chữ mà cả trợ lý không khởi động được là phạt nặng hơn lỗi — và quan trọng
 * hơn: rơi về mặc định là rơi về **đúng hành vi hôm nay**, tức hướng an toàn.
 *
 * @param {{cheDo?: string}} [cauHinh] object config đã validate (nay chưa mang
 *   `cheDo`; đọc sẵn để khi `policy/access.js` khai thêm trường thì tự chạy)
 * @param {{cheDo?: string, vai?: string}} [co] cờ dòng lệnh đã đọc
 * @param {Record<string,string|undefined>} [env]
 * @returns {{cheDo: string, vai: string, laClient: boolean, laDaemon: boolean}}
 */
export function chotCheDo(cauHinh = {}, co = {}, env = process.env) {
  const canhBao = (msg) => process.stderr.write(`[lib/hang_so] ${msg}\n`);
  const hopLe = Object.values(CHE_DO);

  const thoCheDo = co.cheDo ?? env.ZTL_CHE_DO ?? cauHinh?.cheDo;
  let cheDo = CHE_DO.MOT_TIEN_TRINH;
  if (thoCheDo !== undefined && thoCheDo !== null && thoCheDo !== '') {
    if (hopLe.includes(thoCheDo)) cheDo = thoCheDo;
    else {
      canhBao(
        `cheDo = ${JSON.stringify(thoCheDo)} không hợp lệ (chỉ nhận ${hopLe.join(' | ')}) `
        + `-> dùng "${CHE_DO.MOT_TIEN_TRINH}"`,
      );
    }
  }

  const thoVai = co.vai ?? env.ZTL_VAI;
  let vai = VAI.DAEMON;
  if (thoVai !== undefined && thoVai !== null && thoVai !== '') {
    if (Object.values(VAI).includes(thoVai)) vai = thoVai;
    else {
      // ⚠️ Vai lạ ⇒ DAEMON, ⛔ không phải CLIENT. Daemon là vai làm ĐỦ mọi việc;
      // rơi nhầm vào client là trợ lý im lặng không gửi được gì cả.
      canhBao(`vai = ${JSON.stringify(thoVai)} không hợp lệ -> dùng "${VAI.DAEMON}"`);
    }
  }
  // ⚠️ Ở `mot-tien-trinh` thì vai LUÔN là daemon — một tiến trình làm hết.
  // 🔴 Đây là chỗ DUY NHẤT kẹp vai theo chế độ. Bản đầu em kẹp ở HAI chỗ (cả
  // trong điều kiện đọc `thoVai`), và phép thử đột biến chỉ ra rằng chỗ này khi
  // đó là code CHẾT — gỡ đi mà không bài nào đỏ. Một chỗ quyết định, kiểm được.
  if (cheDo !== CHE_DO.TACH) vai = VAI.DAEMON;

  return {
    cheDo, vai,
    laClient: cheDo === CHE_DO.TACH && vai === VAI.CLIENT,
    laDaemon: vai === VAI.DAEMON,
  };
}

// ─── Trạng thái hàng đợi GỬI RA (outbox, v7) ───────────────────────────
// ⚠️ 'da_gui' nghĩa là ZALO ĐÃ NHẬN, ⛔ không phải "người ta đã đọc".
export const TRANG_THAI_GUI = Object.freeze({
  CHO: 'cho',
  DANG_GUI: 'dang_gui',
  DA_GUI: 'da_gui',
  LOI: 'loi',
});

export const SU_KIEN_CONG_GHI = Object.freeze({
  CHAN: 'chan',      // cổng nổ, tra_loi bị từ chối
  VUOT: 'vuot',      // model đi vòng bằng khongCanGhi
  DA_GHI: 'da_ghi',  // cue có khớp nhưng đã có tool ghi chạy -> cho qua
});

/**
 * ★ CUE GHI NHỚ — danh sách MẶC ĐỊNH, host đè được bằng config.
 *
 * 🔴 ĐỂ Ở ĐÂY LÀ ĐỂ CÓ GIÁ TRỊ NỀN, ⛔ KHÔNG PHẢI để hardcode.
 * `cauHinh.cueGhiNho` thắng danh sách này. Host sửa cue mà phải sửa code là
 * cue sẽ không bao giờ được sửa.
 *
 * ⚠️ Cố ý CHỈ gồm cue MỆNH LỆNH RÕ RÀNG. Cám dỗ là nhét thêm "nhớ", "chốt",
 * "note" trần — nhưng "nhớ" xuất hiện trong "anh không nhớ", "để anh nhớ xem",
 * và bắt nhầm thì tốn một vòng model MỖI LẦN. Rộng dần theo số đo trong
 * `nhat_ky_cong_ghi`, ⛔ đừng đoán trước.
 */
export const CUE_GHI_NHO_MAC_DINH = Object.freeze([
  'lưu lại', 'lưu giùm', 'lưu hộ', 'lưu vào',
  'ghi lại', 'ghi giùm', 'ghi hộ', 'ghi vào', 'ghi nhớ',
  'nhớ giùm', 'nhớ hộ', 'nhớ nhé', 'nhớ giúp',
  'note lại', 'note giùm',
  'chốt là', 'chốt lịch',
]);

// ═══════════════════════════════════════════════════════════════════════
// 🔴 PANEL-MỖI-NHÓM (v10.2, 21/08/2026) — ba con số, mỗi con số một lý do
// ═══════════════════════════════════════════════════════════════════════

/**
 * Trần thời gian cho lệnh `tichHop.moPhienLenh`.
 *
 * ⚠️ Lệnh này do NGƯỜI VẬN HÀNH viết, pack ⛔ không biết nó làm gì. Nó có thể
 * treo (mạng, khoá file, hỏi mật khẩu). Treo mà không có trần là **giữ luôn
 * vòng nhận tin của daemon** ⇒ mọi nhóm câm, không riêng nhóm đang mở pane.
 */
export const HAN_MO_PHIEN_MS = 5_000;

/**
 * ★ Client DỰ PHÒNG chỉ nhặt dòng đã chờ quá lâu. Đây là **tổng có tên**, ⛔
 * không phải một con số chọn cho tròn:
 *
 *     HAN_MO_PHIEN_MS        5 000 ms   trần lệnh mở pane (trên)
 *   + pane Claude khởi động 30 000 ms   BIÊN TRÊN đo từ log spawn (10–30 s)
 *   + nhịp poll của client   2 000 ms   CLIENT_POLL_TICK_MS
 *   ─────────────────────────────────
 *   = 37 000 ms
 *
 * 🔴 Lấy **BIÊN TRÊN** của thời gian khởi động, ⛔ không phải trung vị: chọn
 * trung vị nghĩa là **một nửa số lần** dự phòng cướp việc của pane riêng, và
 * cướp việc thì ⛔ không có lỗi nào nổ ra — chỉ là mức cô lập âm thầm tụt về
 * bằng hôm nay.
 *
 * ⚠️ Ngắn hơn `queueTtlMs` (30 phút) rất nhiều ⇒ ⛔ không có ca "chờ dự phòng
 * lâu tới mức câu hỏi hết hạn".
 */
export const GIAN_CHO_MO_PANE_MS = HAN_MO_PHIEN_MS + 30_000 + 2_000;

/**
 * Gọi `moPhienLenh` THẤT BẠI thì bao lâu mới thử lại cho cùng một nhóm.
 *
 * ⚠️ Đánh dấu "đã gọi" ngay cả khi thất bại ⇒ **không bao giờ thử lại**, nhóm
 * đó vĩnh viễn không có pane. Không đánh dấu gì ⇒ **mỗi tin một lần gọi**
 * (449 lần/ngày). Mốc thời gian là đường giữa.
 */
export const THU_LAI_MO_PHIEN_MS = 5 * 60_000;

/**
 * Mặc định cho `tranSoClient` — trần số nhóm daemon tự mở phiên.
 *
 * 🔴 NÓI THẲNG: **con số này KHÔNG có cơ sở đo.** Pack ⛔ không spawn pane nên
 * ⛔ không biết máy người dùng chịu được bao nhiêu phiên Claude. Nó là **van
 * an toàn để người vận hành chỉnh**, ⛔ không phải một kết luận kỹ thuật.
 * Quá trần ⇒ nhóm mới dùng client DỰ PHÒNG, ⛔ KHÔNG bị bỏ rơi.
 */
export const TRAN_SO_CLIENT_MAC_DINH = 4;

/**
 * Nhóm im lặng quá lâu ⇒ QUÊN khỏi sổ đã-mở, để lần sau có tin thì mở lại.
 *
 * ⚠️ Pack ⛔ KHÔNG giết pane — nó ⛔ không tạo ra pane đó, và giết một tiến
 * trình mình không tạo là đụng vào thứ của người khác. "Ngủ" ở đây chỉ nghĩa
 * là **quên**, ⛔ không phải "tắt".
 */
export const NGHI_SAU_GIO_MAC_DINH = 12;


// ═══════════════════════════════════════════════════════════════════════
// 🔴 ĐƯỜNG XIN DUYỆT (v11, 21/08/2026)
// ═══════════════════════════════════════════════════════════════════════

/** Tool của đường xin duyệt. Agent nhóm chỉ có `XIN_DUYET`; hai cái kia của router. */
export const TEN_TOOL_DUYET = Object.freeze({
  XIN_DUYET: 'xin_duyet',
  XEM_YEU_CAU: 'xem_yeu_cau',
  DUYET_YEU_CAU: 'duyet_yeu_cau',
});

/**
 * ⚠️ `DA_LAM` tách khỏi `DA_DUYET` — và đó là điểm mấu chốt:
 * **duyệt là CHO PHÉP, ⛔ không phải CHẠY HỘ.** Gộp hai trạng thái là mất khả
 * năng trả lời *"việc này đã duyệt rồi mà đã ai làm chưa"*, tức mất luôn chỗ
 * để phát hiện việc được duyệt rồi bị bỏ quên.
 */
export const TRANG_THAI_DUYET = Object.freeze({
  CHO_DUYET: 'cho_duyet',
  DA_DUYET: 'da_duyet',
  TU_CHOI: 'tu_choi',
  DA_LAM: 'da_lam',
});


export const PHIEN_BAN_SCHEMA = '11';  // v11 (21/08/2026): yeu_cau_duyet + ghi_nho.nguon_*
