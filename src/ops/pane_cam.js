/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ LƯỚI PHÁT HIỆN **PANE CÂM** — anh chốt 18/09/2026.
 *
 * 🔴 CA THẬT ĐÃ XẢY RA (18/09/2026, 19h03–19h30):
 * Pane router được mở lại bằng `claude --resume <id>`, THIẾU cờ
 * `--dangerously-load-development-channels server:zalo-tro-ly`. Chính
 * `.mcp.json` đã ghi sẵn cảnh báo: *pane không có cờ đó chỉ thấy các tool
 * zalo, KHÔNG nhận tin*.
 *
 * Hậu quả đúng như cảnh báo, và nó hỏng theo kiểu TỆ NHẤT:
 *   · daemon nhận tin, ghi `ask_queue`            ✅
 *   · client đẩy thông báo, dòng chuyển `da_day`  ✅
 *   · phiên Claude ⛔ KHÔNG nhận được gì
 *   · ⛔ KHÔNG lỗi nào nổ ra, ⛔ không ai được báo
 * Anh nhắn 5 câu trong 23 phút và tưởng trợ lý lờ mình. Trợ lý chỉ biết vì
 * tình cờ tự mở kho ra soi.
 *
 * ═══ VÌ SAO CÁC LƯỚI CŨ ⛔ KHÔNG BẮT ĐƯỢC ═══
 *  · `rescue_orphans` ĐẨY LẠI dòng mồ côi — nhưng đẩy lại vào đúng cái phiên
 *    đang câm thì cũng rơi vào hư không. Nó chữa ca "pane chết", ⛔ không chữa
 *    ca "pane sống mà điếc".
 *  · `claimedButUnsent` canh đường GỬI RA, ⛔ không canh đường NHẬN VÀO.
 *  · Watchdog canh websocket Zalo — mà Zalo thì vẫn thông suốt.
 *
 * ⇒ Lưới này hỏi một câu ⛔ chưa ai hỏi: **"đẩy rồi, nhưng có ai trả lời
 *   không?"** Và nó báo qua ĐƯỜNG KHÁC (outbox của daemon) chứ ⛔ không qua
 *   phiên đang hỏng — cảnh báo đi bằng chính con đường đã đứt thì vô nghĩa.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** @typedef {import('../types.d.ts').TDb} TDb */

/** Ngưỡng mặc định. Một lượt model đo thật 10–76 giây; 5 phút là quá dư. */
export const NGUONG_CAM_MS = 5 * 60_000;

/**
 * Nhịp soi. 60 giây: đủ nhanh để anh biết trong vòng một phút sau ngưỡng, đủ
 * chậm để ⛔ không thành một truy vấn mỗi 2 giây chỉ để chờ một chuyện hiếm.
 */
export const MUTE_TICK_MS = 60_000;

/**
 * ★ Hàm thuần trên DB — các dòng ĐÃ ĐẨY mà quá lâu ⛔ không ai trả lời.
 *
 * ⚠️ CỐ Ý ⛔ KHÔNG đếm `cho`: dòng `cho` là dòng chưa ai nhận, và đó có thể chỉ
 * là pane đang bận. Thứ đáng báo động là dòng đã có người NHẬN (`da_day` /
 * `dang_xu_ly`) mà vẫn đứng im — nghĩa là có ai đó đã cầm việc rồi biến mất.
 *
 * @param {TDb} db
 * @param {{nguongMs?: number, bayGioMs?: number}} [tuyChon]
 * @returns {{so: number, cuNhatMs: number, viDu: string|null}}
 */
export function dongDayMaKhongAiTraLoi(db, tuyChon = {}) {
  const nguong = Number(tuyChon.nguongMs ?? NGUONG_CAM_MS);
  const bayGio = Number(tuyChon.bayGioMs ?? Date.now());
  const moc = new Date(bayGio - nguong).toISOString();

  const ds = db
    .prepare(
      `SELECT request_id, content, ts_created FROM ask_queue
        WHERE status IN ('da_day','dang_xu_ly') AND ts_created <= $moc
        ORDER BY ts_created ASC LIMIT 50`,
    )
    .all({ moc });

  if (!ds.length) return { so: 0, cuNhatMs: 0, viDu: null };
  const cu = Date.parse(String(ds[0].ts_created));
  return {
    so: ds.length,
    cuNhatMs: Number.isFinite(cu) ? bayGio - cu : 0,
    viDu: String(ds[0].content ?? '').slice(0, 60) || null,
  };
}

/**
 * ★ Bộ theo dõi: báo host MỘT LẦN khi phát hiện câm, và báo lại khi hồi phục.
 *
 * 🔴 BÁO ĐÚNG MỘT LẦN cho mỗi đợt. Lưới này chạy mỗi nhịp soi (60 giây); báo
 * mỗi nhịp là 60 tin/giờ vào DM của anh — tức tự tay biến cảnh báo thành rác,
 * và rác thì người ta tắt. Cùng bài học với `createSendFailureCounter`.
 *
 * 🔴 HỒI PHỤC CŨNG PHẢI BÁO. Im lặng khoẻ lại thì anh vẫn đang đi khởi động
 * lại pane cho một thứ đã tự lành.
 *
 * @param {(loiNhan: string) => unknown} baoRa gửi qua outbox — ⛔ KHÔNG qua phiên
 * @param {{nguongMs?: number}} [tuyChon]
 */
export function createMuteWatcher(baoRa, tuyChon = {}) {
  let daBao = false;
  const nguongMs = Number(tuyChon.nguongMs ?? NGUONG_CAM_MS);

  return function kiem(db, bayGioMs = Date.now()) {
    let kq;
    try {
      kq = dongDayMaKhongAiTraLoi(db, { nguongMs, bayGioMs });
    } catch {
      // Đọc hỏng thì im — lưới an toàn ⛔ không được tự biến thành nguồn lỗi mới.
      return { cam: false, daBao };
    }

    if (kq.so > 0 && !daBao) {
      daBao = true;
      const phut = Math.round(kq.cuNhatMs / 60_000);
      Promise.resolve(baoRa(
        `🔴 TRỢ LÝ ĐANG CÂM — ${kq.so} tin đã vào máy nhưng KHÔNG phiên nào trả lời `
        + `(cũ nhất ${phut} phút).\n`
        + `Câu đầu: "${kq.viDu ?? '(không có chữ)'}"\n\n`
        + 'Thường gặp nhất: pane được mở bằng `claude --resume` mà THIẾU cờ '
        + '`--dangerously-load-development-channels server:zalo-tro-ly`. '
        + 'Pane thiếu cờ vẫn thấy tool nhưng KHÔNG nhận tin.\n'
        + 'Anh mở lại pane bằng đúng lệnh có cờ giúp em ạ.',
      )).catch(() => {});
    } else if (kq.so === 0 && daBao) {
      daBao = false;
      Promise.resolve(baoRa('✅ Đường nhận tin đã thông lại, em nghe được bình thường.'))
        .catch(() => {});
    }
    return { cam: kq.so > 0, daBao };
  };
}
