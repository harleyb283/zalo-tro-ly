/**
 * ═══════════════════════════════════════════════════════════════════════
 * v4 — LỜI NHẮC THEO ĐUỔI TỚI KHI XONG (anh chốt 20/08/2026).
 *
 * ĐỔI BẢN CHẤT, không phải thêm cờ: nhắc nhở không còn là "bắn một phát rồi
 * thôi" mà là THEO ĐUỔI cho tới khi việc xong.
 *
 * 🔴 NĂM ĐIỀU ANH CHỐT — KHÔNG TỰ NỚI:
 *   1. Dừng khi nào  : KHI XONG VIỆC. ❌ KHÔNG CÓ TRẦN LEO THANG.
 *                      *"Đây là làm việc, không phải đi chơi nên ko có chuyện
 *                       ko làm mà có mặt mũi ở đây"*
 *   2. Tần suất      : 1 lần/ngày, 08:00
 *   3. Cuối tuần     : nhắc bình thường, CHỪA CHỦ NHẬT. Thứ Bảy VẪN nhắc.
 *   4. Nhắc ở đâu    : TRONG NHÓM, TAG THẲNG người đó. *"Ko sợ mất lòng nhé"*
 *   5. Nhắc chính anh: thẳng tay, không chốt chặn nào.
 *
 * 🔴 VAN XẢ — PHẦN QUAN TRỌNG NHẤT, ĐỪNG COI LÀ PHỤ.
 * Không có trần, nên thứ DUY NHẤT ngăn một lời nhắc quên đóng nhắn người thật
 * mỗi sáng VĨNH VIỄN là: anh giãn nhịp BẰNG LỜI ngay trong nhóm
 * (*"2 ngày check lại 1 lần cho anh"*). Bỏ van xả đi mà không dựng lại trần là
 * để hệ tự do làm phiền người khác mãi mãi.
 *
 * 🔴 CHỈ HOST ĐÓNG. Trợ lý KHÔNG tự suy ai đó nói "ok xong rồi" là xong — đọc
 * sai một câu là IM LẶNG BỎ RƠI MỘT VIỆC THẬT mà anh không biết để cứu. Thấy
 * dấu hiệu xong thì HỎI anh, anh gật mới đóng.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { ensureParentDir, expandPath } from '../lib/paths.js';

import {
  GIOI_HAN_LICH, LY_DO_DONG, NHAC_THEO_DUOI, TRANG_THAI_LICH, TRANG_THAI_TD,
} from '../lib/hang_so.js';
import { toIdRequired } from '../lib/ids.js';

function _log(msg) {
  process.stderr.write(`[lich/theo_duoi] ${msg}\n`);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. LỊCH THEO MÚI GIỜ — phần dễ sai nhất, không có thư viện nào đỡ
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lệch múi giờ (ms) tại một thời điểm cụ thể.
 *
 * Tính bằng cách đọc thời gian ĐÓ theo `muiGio` rồi coi các con số đọc được như
 * thể chúng là UTC — hiệu số chính là offset. Cách này đúng cả với vùng có DST
 * (Việt Nam không có, nhưng pack chạy được ở máy khác).
 */
function _lechMuiGioMs(ms, muiGio) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: muiGio, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  const nhuUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return nhuUtc - ms;
}

/** Ngày/thứ ĐỊA PHƯƠNG của một thời điểm. */
export function localDateParts(ms, muiGio = GIOI_HAN_LICH.MUI_GIO_MAC_DINH) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: muiGio, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return {
    nam: +p.year,
    thang: +p.month,
    ngay: +p.day,
    // 0 = Chủ Nhật
    thu: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

/**
 * Epoch ms của một mốc GIỜ ĐỊA PHƯƠNG (y-m-d hh:mm ở `muiGio`).
 *
 * Lặp 2 lần vì offset phụ thuộc chính thời điểm cần tìm (bài toán con gà–quả
 * trứng ở biên DST). Lần đầu đoán bằng offset tại mốc-coi-như-UTC, lần hai
 * chỉnh lại bằng offset tại mốc vừa đoán.
 */
export function localTimeToEpoch(nam, thang, ngay, gio, phut, muiGio = GIOI_HAN_LICH.MUI_GIO_MAC_DINH) {
  const nhuUtc = Date.UTC(nam, thang - 1, ngay, gio, phut, 0);
  let moc = nhuUtc;
  for (let i = 0; i < 2; i += 1) moc = nhuUtc - _lechMuiGioMs(moc, muiGio);
  return moc;
}

/**
 * Giờ nhắc về dạng CHUỖI chuẩn "HH:MM".
 *
 * 🔴 KHÁC `parseReminderHour()` — cái đó trả OBJECT `{gio, phut}` để tính toán.
 * Bug thật 20/08/2026: `_datNhacTheoDuoi` lấy thẳng kết quả `parseReminderHour()`
 * làm giá trị `remind_time` ⇒ (a) câu xác nhận in "lúc [object Object]",
 * (b) `node:sqlite` KHÔNG bind được object nên INSERT NÉM ⇒ nhắc theo đuổi
 * NHỊP NGÀY chưa từng tạo nổi trên hệ thật. Hai hàm tên gần giống nhau, trả
 * hai kiểu khác nhau — dùng nhầm là hỏng ở tận DB.
 *
 * @param {unknown} s
 * @returns {string} luôn là "HH:MM" hợp lệ
 */
export function normalizeReminderHour(s) {
  const { gio, phut } = parseReminderHour(s);
  return `${String(gio).padStart(2, '0')}:${String(phut).padStart(2, '0')}`;
}

/** 'HH:MM' -> {gio, phut}. Rác thì rơi về mặc định và NÓI RA. */
export function parseReminderHour(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) {
    if (s) _log(`remind_time='${s}' không hợp lệ -> dùng ${NHAC_THEO_DUOI.GIO_NHAC_MAC_DINH}`);
    const d = /^(\d{1,2}):(\d{2})$/.exec(NHAC_THEO_DUOI.GIO_NHAC_MAC_DINH);
    return { gio: +d[1], phut: +d[2] };
  }
  return { gio: +m[1], phut: +m[2] };
}

/**
 * Đọc NHỊP của một lời nhắc. ★ NGUỒN SỰ THẬT DUY NHẤT cho câu hỏi
 * "cái này nhắc lại sau bao lâu" — mọi chỗ khác phải gọi hàm này.
 *
 * 🔴 VÌ SAO GIỮ HAI CỘT chứ không quy hết về phút (quyết định 20/08/2026):
 * hai chế độ KHÁC BẢN CHẤT, không phải khác đơn vị.
 *   · `cycle_days` + `remind_time` = lịch theo NGÀY, NEO vào giờ địa phương và
 *     có luật chừa Chủ Nhật. "Mỗi ngày 8h sáng" KHÔNG bằng "cứ 1440 phút" —
 *     nó phải rơi đúng 8h, chứ không phải "8h cộng thêm khoảng trễ lần trước".
 *   · `cycle_minutes` = đếm N phút KỂ TỪ LẦN NHẮC TRƯỚC, không neo giờ nào.
 * Ép chung một số là mất thông tin, và mất im lặng.
 *
 * LUẬT ƯU TIÊN — CHỈ MỘT, khai ở đây: `cycle_minutes` khác NULL thì nó THẮNG.
 * Nhờ vậy không có "hai cơ chế đá nhau": chỉ có MỘT chỗ quyết định.
 *
 * @param {any} dong dòng `schedules` (hoặc object cùng hình dạng)
 * @returns {{laPhut: boolean, phut: number|null, ngay: number}}
 */
export function parseCadence(dong) {
  const phutTho = dong?.cycle_minutes ?? dong?.chuKyPhut;
  if (phutTho !== null && phutTho !== undefined && Number.isFinite(Number(phutTho))) {
    const phut = Math.trunc(Number(phutTho));
    if (phut > 0) return { laPhut: true, phut, ngay: 0 };
  }
  const ngay = Math.max(
    1,
    Math.min(
      NHAC_THEO_DUOI.CHU_KY_NGAY_TOI_DA,
      Math.trunc(Number(dong?.cycle_days ?? dong?.chuKyNgay) || NHAC_THEO_DUOI.CHU_KY_NGAY_MAC_DINH),
    ),
  );
  return { laPhut: false, phut: null, ngay };
}

/**
 * Trần mặc định theo nhịp. CHỈ nhịp DÀY (< 1 giờ) mới có trần.
 *
 * 🔴 Nhịp từ 1 giờ trở lên KHÔNG áp trần — anh đã chốt "nhắc tới khi xong
 * việc, không có trần leo thang". Trần sinh ra RIÊNG cho nhịp dày bất thường;
 * đừng để nó lây sang ca nhịp ngày.
 */
export function defaultAttemptCap(nhip) {
  if (!nhip?.laPhut) return null;
  return nhip.phut < NHAC_THEO_DUOI.NGUONG_NHIP_DAY_PHUT
    ? NHAC_THEO_DUOI.TRAN_SO_LAN_MAC_DINH_NHIP_DAY
    : null;
}

/**
 * Kiểm nhịp phút. Ngoài khoảng thì TỪ CHỐI, ⛔ không âm thầm làm tròn — làm
 * tròn là anh dặn 2 phút mà nó chạy khác, và không ai biết.
 * @returns {{ok: true, phut: number}|{ok: false, ly: string}}
 */
export function validateMinuteCadence(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.trunc(n) !== n) {
    return { ok: false, ly: `chuKyPhut '${v}' không phải số nguyên.` };
  }
  if (n < NHAC_THEO_DUOI.CHU_KY_PHUT_TOI_THIEU) {
    return { ok: false, ly: `chuKyPhut phải >= ${NHAC_THEO_DUOI.CHU_KY_PHUT_TOI_THIEU} phút.` };
  }
  if (n > NHAC_THEO_DUOI.CHU_KY_PHUT_TOI_DA) {
    return {
      ok: false,
      ly: `chuKyPhut tối đa ${NHAC_THEO_DUOI.CHU_KY_PHUT_TOI_DA} phút (1 ngày). `
        + 'Dài hơn thì khai bằng chuKyNgay cho đúng nghĩa lịch theo ngày.',
    };
  }
  return { ok: true, phut: n };
}

/** Kiểm trần số lần. Bỏ trống = KHÔNG trần (hợp lệ). */
export function validateAttemptCap(v) {
  if (v === null || v === undefined || v === '') return { ok: true, tran: null };
  const n = Number(v);
  if (!Number.isFinite(n) || Math.trunc(n) !== n || n < 1) {
    return { ok: false, ly: `tranSoLan '${v}' phải là số nguyên >= 1, hoặc bỏ trống để không giới hạn.` };
  }
  if (n > NHAC_THEO_DUOI.TRAN_SO_LAN_TOI_DA) {
    return { ok: false, ly: `tranSoLan tối đa ${NHAC_THEO_DUOI.TRAN_SO_LAN_TOI_DA}.` };
  }
  return { ok: true, tran: n };
}

/**
 * ★ Mốc nhắc KẾ TIẾP, tính theo múi giờ, có chừa Chủ Nhật.
 *
 * @param {number} tuMs mốc gốc (lần nhắc trước, hoặc "bây giờ" cho lần đầu)
 * @param {{chuKyNgay?: number, gioNhac?: string, boChuNhat?: boolean,
 *          muiGio?: string, laLanDau?: boolean}} cfg
 * @returns {number}
 */
export function nextReminderAt(tuMs, cfg = {}) {
  // ─── NHỊP PHÚT: đếm thẳng từ mốc trước, KHÔNG neo giờ, KHÔNG chừa Chủ Nhật.
  // 🔴 Chừa Chủ Nhật ở đây là SAI Ý ĐỊNH: "cứ 2 phút nhắc lại" mà gặp Chủ
  // Nhật thì nhảy sang thứ Hai — lệch hoàn toàn thứ anh dặn. Nhịp phút để
  // đuổi một việc GẤP trong ngày; tổng thời gian đã bị TRẦN SỐ LẦN khống chế
  // nên không cần luật lịch nào nữa.
  // `remind_time` cũng KHÔNG dùng ở nhánh này — hai cơ chế không đá nhau vì
  // `parseCadence()` chỉ chọn đúng MỘT nhánh.
  const nhip = parseCadence({ cycle_minutes: cfg.chuKyPhut, cycle_days: cfg.chuKyNgay });
  if (nhip.laPhut) return Math.floor(tuMs) + nhip.phut * 60_000;

  const muiGio = cfg.muiGio ?? GIOI_HAN_LICH.MUI_GIO_MAC_DINH;
  const boCn = cfg.boChuNhat ?? NHAC_THEO_DUOI.BO_CHU_NHAT_MAC_DINH;
  const { gio, phut } = parseReminderHour(cfg.gioNhac);
  const chuKy = Math.max(
    1,
    Math.min(NHAC_THEO_DUOI.CHU_KY_NGAY_TOI_DA, Math.trunc(Number(cfg.chuKyNgay) || 1)),
  );

  const d = localDateParts(tuMs, muiGio);
  // Lần ĐẦU: mốc gần nhất còn ở TƯƠNG LAI, có thể là ngay hôm nay nếu chưa tới
  // giờ nhắc. Lần SAU: cộng đúng `chuKy` ngày kể từ lần nhắc trước.
  let buoc = cfg.laLanDau ? 0 : chuKy;
  for (let i = 0; i < 400; i += 1) {
    const moc = localTimeToEpoch(d.nam, d.thang, d.ngay + buoc, gio, phut, muiGio);
    if (moc > tuMs && !(boCn && localDateParts(moc, muiGio).thu === 0)) return moc;
    buoc += 1;
  }
  // Không bao giờ tới đây với tham số hợp lệ; thà trả mốc xa còn hơn trả NaN.
  _log('nextReminderAt: không tìm được mốc trong 400 ngày -> lùi 1 ngày thô');
  return tuMs + 86_400_000;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. KHO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tạo lời nhắc THEO ĐUỔI. Vẫn phải qua `cho_xac_nhan` như lịch một lần —
 * không có đường tắt, và cố ý không có tham số nào bỏ qua bước chốt.
 */
export function createFollowUp(db, p) {
  const id = p.id ?? randomUUID();
  const muiGio = p.muiGio ?? GIOI_HAN_LICH.MUI_GIO_MAC_DINH;
  const gioNhac = p.gioNhac ?? NHAC_THEO_DUOI.GIO_NHAC_MAC_DINH;
  const chuKy = Math.max(
    1,
    Math.min(NHAC_THEO_DUOI.CHU_KY_NGAY_TOI_DA,
      Math.trunc(Number(p.chuKyNgay) || NHAC_THEO_DUOI.CHU_KY_NGAY_MAC_DINH)),
  );
  const boCn = p.boChuNhat ?? NHAC_THEO_DUOI.BO_CHU_NHAT_MAC_DINH;
  const bayGio = p.bayGioMs ?? Date.now();
  // Nhịp phút (nếu có) THẮNG nhịp ngày — luật ưu tiên khai ở `parseCadence()`.
  const chuKyPhut = p.chuKyPhut === null || p.chuKyPhut === undefined
    ? null : Math.trunc(Number(p.chuKyPhut));
  const nhip = parseCadence({ cycle_minutes: chuKyPhut, cycle_days: chuKy });
  // Trần: host khai gì dùng nấy; không khai thì lấy mặc định THEO NHỊP.
  const tranSoLan = p.tranSoLan === undefined ? defaultAttemptCap(nhip)
    : (p.tranSoLan === null ? null : Math.trunc(Number(p.tranSoLan)));

  const mocDau = nextReminderAt(bayGio, {
    chuKyNgay: chuKy, chuKyPhut, gioNhac, boChuNhat: boCn, muiGio, laLanDau: true,
  });

  db.prepare(
    `INSERT INTO schedules
       (id, target_chat_id, target_kind, content, tag_user_ids, send_at_ms, timezone,
        raw_phrasing, confirm_phrasing, created_by, creator_chat_id, status,
        confirm_code, attempt_count, ts_created, ts_updated,
        is_follow_up, follow_up_status, cycle_days, remind_time, skip_sunday,
        remind_count, owner, cycle_minutes, max_reminds)
     VALUES ($id, $dich, $loai, $nd, $tag, $luc, $mg, $goc, $xn, $nguoi, $dat,
             $tt, $ma, 0, $ts, $ts, 1, $ttd, $ck, $gn, $bcn, 0, $pt, $ckp, $tran)`,
  ).run({
    id,
    dich: toIdRequired(p.chatIdDich, 'nhac.chatIdDich'),
    loai: p.loaiDich === 'DM' ? 'DM' : 'GROUP',
    nd: String(p.noiDung),
    tag: p.tagUserIds?.length ? JSON.stringify(p.tagUserIds.map(String)) : null,
    luc: mocDau,
    mg: muiGio,
    goc: String(p.dienGiaiGoc),
    xn: String(p.dienGiaiXacNhan),
    nguoi: toIdRequired(p.nguoiDat, 'nhac.nguoiDat'),
    dat: toIdRequired(p.chatIdDat, 'nhac.chatIdDat'),
    tt: TRANG_THAI_LICH.CHO_XAC_NHAN,
    ttd: TRANG_THAI_TD.DANG_THEO_DUOI,
    ma: p.ma,
    ts: new Date().toISOString(),
    ck: chuKy,
    gn: gioNhac,
    bcn: boCn ? 1 : 0,
    pt: p.nguoiPhuTrach ? String(p.nguoiPhuTrach) : null,
    ckp: chuKyPhut,
    tran: tranSoLan,
  });
  return { id, mocDauMs: mocDau, nhip, tranSoLan };
}

/** Lời nhắc theo đuổi TỚI HẠN. Đã chốt + đang theo đuổi + không tạm dừng. */
export function dueFollowUps(db, bayGioMs) {
  return db
    .prepare(
      `SELECT * FROM schedules
        WHERE is_follow_up = 1
          AND status = $tt
          AND follow_up_status = $ttd
          AND send_at_ms <= $now
          AND (paused_until_ms IS NULL OR paused_until_ms <= $now)
        ORDER BY send_at_ms ASC LIMIT 20`,
    )
    .all({ tt: TRANG_THAI_LICH.DA_LEN_LICH, ttd: TRANG_THAI_TD.DANG_THEO_DUOI, now: Math.floor(bayGioMs) });
}

// ═══════════════════════════════════════════════════════════════════════
// A5 — TRẦN CHỜ MODEL PHẢI LÀ HÀM CỦA NHỊP, KHÔNG PHẢI HẰNG SỐ
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ Chờ model viết câu bao lâu thì code tự gửi câu dự phòng.
 *
 * 🔴 VÌ SAO KHÔNG DÙNG THẲNG `NHAC_THEO_DUOI.TRAN_CHO_MODEL_MS` (10 phút):
 * nhịp phút cho phép xuống tận 1 phút. Mỗi lượt `claimReminderTurn` lại ghi đè
 * `model_wait_since_ms = bayGio`, nên với nhịp 3 phút thì mốc đó được LÀM MỚI mỗi 3
 * phút và KHÔNG BAO GIỜ đuổi kịp ngưỡng 10 phút ⇒ **lưới dự phòng chưa từng bắn
 * một lần nào**. Mà lưới đó chính là thứ chú thích ở `runner.js` gọi là "giữ cho
 * tính năng không hỏng câm": Claude rớt thì lời nhắc BIẾN MẤT ÂM THẦM.
 * Hệ quả kèm theo: mỗi nhịp lại đẩy thêm một hàng đợi + một notification cho cùng
 * một lời nhắc (nhắc chồng nhắc), và `remind_count` tăng cho cả lượt CHƯA GỬI GÌ
 * nên trần 10 lần bị đốt trong 30 phút dù có thể chưa nhắn nổi một tin.
 *
 * 🔴 BẤT BIẾN hàm này giữ: **trần chờ LUÔN NHỎ HƠN nhịp**. Nhờ `Math.min` với
 * nửa nhịp, mỗi lượt đã dành chỗ chắc chắn kết thúc (model trả lời HOẶC code gửi bù)
 * TRƯỚC khi lượt kế tiếp tới hạn. Nhịp ngày thì 10 phút vốn đã nhỏ hơn 1 ngày.
 *
 * @param {{laPhut: boolean, phut: number|null}} nhip kết quả `parseCadence()`
 * @returns {number} ms
 */
export function modelWaitCapMs(nhip) {
  if (!nhip?.laPhut) return NHAC_THEO_DUOI.TRAN_CHO_MODEL_MS;
  return Math.min(NHAC_THEO_DUOI.TRAN_CHO_MODEL_MS, Math.floor((nhip.phut * 60_000) / 2));
}

/**
 * Trần NHỎ NHẤT có thể có — dùng làm bộ lọc thô cho `stalledModelReminders()`.
 * Suy từ hằng số sẵn có, KHÔNG chép số vào đây: đổi `CHU_KY_PHUT_TOI_THIEU` mà
 * quên sửa chỗ này thì bộ quét bỏ sót lượt treo trong im lặng.
 */
export const MIN_MODEL_WAIT_MS = modelWaitCapMs({
  laPhut: true, phut: NHAC_THEO_DUOI.CHU_KY_PHUT_TOI_THIEU,
});

/**
 * Các lượt ĐÃ GIAO MODEL mà model còn im — ứng viên cho câu dự phòng.
 *
 * 🔴 BA điều kiện trạng thái (A6) — bản cũ KHÔNG có cái nào:
 *   · `follow_up_status = 'dang_theo_duoi'` — host bảo XONG rồi thì đừng nhắc nữa
 *   · `status = 'da_len_lich'`       — dòng đã chốt sổ thì đừng nhắc nữa
 *   · `paused_until_ms`                  — host giãn nhịp BẰNG LỜI thì phải im
 * Thiếu ba cái này thì bộ quét trở thành đường vòng qua chính van xả: host đóng
 * hoặc tạm dừng xong, ≤10 phút sau trợ lý vẫn nhắn vào nhóm có người thật.
 *
 * ⚠️ Lọc theo `MIN_MODEL_WAIT_MS` là bộ lọc THÔ. Trần thật của từng
 * dòng phụ thuộc nhịp của chính nó ⇒ caller PHẢI lọc lại bằng `modelWaitCapMs()`.
 * Cố ý không nhét phép tính đó vào SQL: `parseCadence()` là nguồn sự thật DUY NHẤT về
 * nhịp, viết lại luật ưu tiên phút-thắng-ngày bằng SQL là đẻ ra bản sao thứ hai.
 */
export function stalledModelReminders(db, bayGioMs) {
  const now = Math.floor(bayGioMs);
  return db
    .prepare(
      `SELECT * FROM schedules
        WHERE is_follow_up = 1
          AND model_wait_since_ms IS NOT NULL
          AND model_wait_since_ms <= $han
          AND status = $tt
          AND follow_up_status = $ttd
          AND (paused_until_ms IS NULL OR paused_until_ms <= $now)
        ORDER BY model_wait_since_ms ASC LIMIT 20`,
    )
    .all({
      han: now - MIN_MODEL_WAIT_MS,
      tt: TRANG_THAI_LICH.DA_LEN_LICH,
      ttd: TRANG_THAI_TD.DANG_THEO_DUOI,
      now,
    });
}

/**
 * ═══ 🔴 TOKEN GỬI — `model_wait_since_ms` KHÔNG chỉ là "mốc bắt đầu chờ" ═══
 *
 * Nó là **quyền gửi** của MỘT lượt nhắc, và chỉ MỘT bên được cầm:
 *   · model gửi qua `reply`  → giành token ở đây
 *   · lưới an toàn gửi câu dự phòng → giành token bằng CAS ở `runner.js`
 * Ai giành được (`changes === 1`) mới được chạm mạng. Bên thua **im**.
 *
 * 🔴 VÌ SAO PHẢI LÀ TOKEN CHỨ KHÔNG PHẢI "GỠ CỜ SAU KHI GỬI XONG":
 * gỡ-sau chỉ vá được ca model trả lời NHANH. Ca model trả lời CHẬM hơn trần vẫn
 * đi hai tin: lưới bắn lúc 90 giây, model tỉnh lúc 3 phút và vẫn gửi được, vì
 * hàng đợi sống tới `queueTtlMs` = 30 PHÚT — dài gấp 20 lần trần chờ. Xảy ra thật
 * 21/08/2026 (một lượt đi 2 tin, cách nhau đúng 90 giây).
 *
 * ⚠️ Giành TRƯỚC khi gửi, và **trả lại nếu gửi hỏng** (`releaseReminderSend`).
 * Giành mà không trả là mất lưới an toàn — đúng ca ngược lại: model chết giữa
 * chừng mà không ai gửi bù, lời nhắc biến mất âm thầm.
 *
 * @returns {{ok: boolean, mocCu: number|null}} `ok=false` ⇒ bên kia đã gửi rồi,
 *   HOẶC host vừa `followup_close`/`followup_adjust` (hai hàm đó cũng xoá cột này).
 */
export function claimReminderSend(db, idNhac) {
  const d = db
    .prepare('SELECT model_wait_since_ms FROM schedules WHERE id = $id AND is_follow_up = 1')
    .get({ id: String(idNhac) });
  const cu = d?.model_wait_since_ms;
  if (cu === null || cu === undefined) return { ok: false, mocCu: null };
  const kq = db
    .prepare('UPDATE schedules SET model_wait_since_ms = NULL WHERE id = $id AND model_wait_since_ms = $cu')
    .run({ id: String(idNhac), cu: Number(cu) });
  return { ok: Number(kq.changes) === 1, mocCu: Number(cu) };
}

/**
 * Trả token về đúng mốc cũ khi gửi HỎNG.
 *
 * ⚠️ Trả về mốc **CŨ**, không phải `Date.now()`: thời gian đã chờ phải được giữ
 * nguyên, để lưới an toàn bắn ngay như đáng lẽ nó phải bắn, chứ không bị lùi
 * thêm một trần nữa.
 * `WHERE model_wait_since_ms IS NULL` để không ghi đè lên mốc của một lượt MỚI mà
 * nhịp sau vừa dành chỗ trong lúc lời gọi mạng đang treo.
 */
export function releaseReminderSend(db, idNhac, mocCu) {
  if (mocCu === null || mocCu === undefined) return false;
  const kq = db
    .prepare('UPDATE schedules SET model_wait_since_ms = $cu WHERE id = $id AND model_wait_since_ms IS NULL')
    .run({ id: String(idNhac), cu: Number(mocCu) });
  return Number(kq.changes) === 1;
}

/**
 * Ghi BẰNG CHỨNG đã gửi cho đường model.
 *
 * 🔴 Trước bản này chỉ đường DỰ PHÒNG ghi `sent_msg_id`; đường model thì không.
 * Hậu quả: lời nhắc do model gửi thành công 10 lượt vẫn để lại cột NULL, nên câu
 * báo hết lượt kèm cảnh báo *"em KHÔNG có bằng chứng tin nào đã gửi"* — báo động
 * giả. Cảnh báo giả lặp lại vài lần là lần sau host thôi tin cả cảnh báo đúng.
 */
export function writeReminderProof(db, idNhac, msgId) {
  const kq = db
    .prepare('UPDATE schedules SET sent_msg_id = $m WHERE id = $id AND is_follow_up = 1')
    .run({ m: msgId ? String(msgId) : null, id: String(idNhac) });
  return Number(kq.changes) === 1;
}

/**
 * Lớp canh THỨ HAI, đọc ngay trước khi chạm mạng: lượt này còn được GỬI không?
 *
 * 🔴 Vì sao cần dù truy vấn ở trên đã lọc: giữa lúc `SELECT` và lúc `await` gửi tin
 * có thể có một lời gọi tool của host chen vào (`followup_close` / `followup_adjust` chạy
 * trong CÙNG tiến trình). Đây là chỗ chạm NGƯỜI THẬT — đọc thêm một dòng DB rẻ hơn
 * nhiều so với một tin nhắn không rút lại được.
 *
 * ═══ 🔴 CÂU HỎI ĐÚNG LÀ "HOST CÓ BẢO DỪNG KHÔNG", KHÔNG PHẢI "CÒN ĐANG CHẠY KHÔNG" ═══
 * Bản đầu của hàm này đòi `follow_up_status === 'dang_theo_duoi'` và suýt gây HỒI QUY:
 * `claimReminderTurn()` đóng dòng NGAY khi chạm trần (`HET_LUOT`) rồi caller mới gửi,
 * nên lượt CUỐI CÙNG sẽ bị chính lớp canh này chặn ⇒ trần 10 hoá thành nhắc 9 lần,
 * phá đúng chú thích *"trần 10 nghĩa là nhắc đủ 10 lần rồi mới thôi, không phải 9"*.
 *
 * Nên phân biệt theo LÝ DO ĐÓNG, đúng ngữ nghĩa mà lớp canh này sinh ra để bảo vệ:
 *   · `HOST_DONG`  -> CHẶN. Host bảo xong việc rồi, nhắc nữa là làm phiền người thật.
 *   · `tam_dung`   -> CHẶN. Van xả — thứ DUY NHẤT ngăn nhắc mãi khi không có trần.
 *   · `HET_LUOT`   -> CHO QUA. Đây chính là lượt vừa chạm trần, nó PHẢI được gửi.
 * Dòng đóng bằng `HET_LUOT` từ lượt TRƯỚC không lọt tới đây được: cả `dueFollowUps`
 * lẫn `stalledModelReminders` đều đòi `follow_up_status = 'dang_theo_duoi'`.
 */
export function isStillFollowingUp(db, id, bayGioMs) {
  const d = db
    .prepare(
      `SELECT status, follow_up_status, close_reason, paused_until_ms
         FROM schedules WHERE id = $id`,
    )
    .get({ id: String(id) });
  if (!d) return false;

  // Van xả: host giãn nhịp / tạm ngưng BẰNG LỜI.
  if (d.follow_up_status === TRANG_THAI_TD.TAM_DUNG) return false;
  if (d.paused_until_ms !== null && d.paused_until_ms !== undefined
      && Number(d.paused_until_ms) > Math.floor(bayGioMs)) return false;

  // Đã đóng: chỉ cho qua đúng ca "lượt vừa chạm trần".
  if (d.follow_up_status === TRANG_THAI_TD.DA_XONG) {
    return d.close_reason === LY_DO_DONG.HET_LUOT;
  }

  // Còn đang theo đuổi: vòng đời của dòng phải chưa bị chốt sổ (`da_huy`, `loi`…).
  return d.status === TRANG_THAI_LICH.DA_LEN_LICH;
}

/**
 * ★ DÀNH CHỖ TRƯỚC KHI GỬI — đẩy mốc sang lần kế tiếp NGAY, trong một lệnh.
 *
 * 🔴 `WHERE send_at_ms = $cu` là thứ bảo đảm hai nhịp timer chồng nhau (hoặc
 * daemon vừa restart) KHÔNG gửi hai tin vào nhóm người thật. Chỉ đi tiếp khi
 * `changes === 1`. Khác lịch một lần ở chỗ: KHÔNG đổi trạng thái (lời nhắc còn
 * sống để nhắc tiếp), chỉ dời mốc.
 *
 * 🔴 `AND status = $tt` — nửa còn lại của LUẬT ĐỐI XỨNG với `claimSending`:
 * mọi cột mà `dueFollowUps()` lọc thì lệnh dành chỗ này cũng phải lọc. Thiếu nó
 * thì ca ngược lại xảy ra: `runOneTick` (hoặc `cancelSchedule`) đã lật `status` trong
 * lúc `runFollowUpTick` đang `await`, mà lệnh này vẫn cho qua vì nó chỉ nhìn
 * `send_at_ms` — tức là gửi một lời nhắc thuộc dòng đã bị người khác chốt sổ.
 * Ảnh tĩnh `ds` chụp TRƯỚC nên không thấy; chỉ `WHERE` của chính `UPDATE` này
 * mới nguyên tử. Xem chú thích dài ở `schedule.js: claimSending`.
 *
 * @returns {{ok: boolean, mocKeTiepMs: number|null}}
 */
export function claimReminderTurn(db, dong, bayGioMs) {
  const ke = nextReminderAt(bayGioMs, {
    chuKyNgay: dong.cycle_days,
    chuKyPhut: dong.cycle_minutes,
    gioNhac: dong.remind_time,
    boChuNhat: Number(dong.skip_sunday) === 1,
    muiGio: dong.timezone,
  });
  const kq = db
    .prepare(
      `UPDATE schedules
          SET send_at_ms = $ke, last_remind_ms = $now,
              remind_count = remind_count + 1, ts_updated = $ts
        WHERE id = $id AND send_at_ms = $cu
          AND follow_up_status = $ttd AND status = $tt AND is_follow_up = 1`,
    )
    .run({
      ke, now: Math.floor(bayGioMs), ts: new Date().toISOString(),
      id: String(dong.id), cu: Number(dong.send_at_ms),
      ttd: TRANG_THAI_TD.DANG_THEO_DUOI, tt: TRANG_THAI_LICH.DA_LEN_LICH,
    });
  if (Number(kq.changes) !== 1) return { ok: false, mocKeTiepMs: null, hetLuot: false };

  // ─── TRẦN SỐ LẦN ────────────────────────────────────────────────────
  // 🔴 Lượt VỪA dành chỗ VẪN ĐƯỢC GỬI — trần 10 nghĩa là nhắc đủ 10 lần rồi
  // mới thôi, không phải 9. Đóng NGAY sau khi chạm trần để nhịp sau không
  // lấy nó ra nữa.
  // ⛔ KHÔNG dùng LY_DO_DONG.HOST_DONG ở đây: host nhìn vào phải biết nó tắt
  // vì HẾT LƯỢT chứ không phải vì ai đó đã xong việc. Im lặng tắt là bỏ rơi
  // một việc thật mà không ai hay.
  const tran = dong.max_reminds;
  const daNhac = Number(dong.remind_count ?? 0) + 1;
  const hetLuot = tran !== null && tran !== undefined && daNhac >= Number(tran);
  if (hetLuot) {
    db.prepare(
      `UPDATE schedules
          SET follow_up_status = $ttd, status = $tt, close_reason = $ly,
              closed_at_ms = $luc, ts_updated = $ts
        WHERE id = $id`,
    ).run({
      ttd: TRANG_THAI_TD.DA_XONG,
      tt: TRANG_THAI_LICH.DA_GUI,
      ly: LY_DO_DONG.HET_LUOT,
      luc: Math.floor(bayGioMs),
      ts: new Date().toISOString(),
      id: String(dong.id),
    });
  }
  return { ok: true, mocKeTiepMs: ke, hetLuot, soLanDaNhac: daNhac, tranSoLan: tran ?? null };
}

/**
 * ★ VAN XẢ — chỉnh nhịp / tạm dừng. CHỈ HOST.
 *
 * Không có trần leo thang, nên đây là thứ DUY NHẤT ngăn một lời nhắc quên đóng
 * nhắn người thật mỗi sáng vĩnh viễn. Việc HIỂU câu nói ("2 ngày check lại 1
 * lần") là của model — hàm này chỉ nhận SỐ, đúng nguyên tắc đã dùng cho thời
 * gian: model quy đổi, tool nhận giá trị tuyệt đối.
 *
 * @param {{id: string, isHost: boolean, chuKyNgay?: number, gioNhac?: string,
 *          tamDungToiMs?: number|null, bayGioMs?: number}} p
 */
export function adjustCadence(db, p) {
  if (!p.isHost) {
    // Người khác trong nhóm nói gì cũng KHÔNG đổi được nhịp — nếu không thì bất
    // kỳ ai bị nhắc cũng tự tắt được lời nhắc của chính mình.
    return { ok: false, ly: 'KHONG_PHAI_HOST' };
  }
  const dong = db.prepare('SELECT * FROM schedules WHERE id = $k OR confirm_code = $k')
    .get({ k: String(p.id ?? '') });
  if (!dong) return { ok: false, ly: 'KHONG_TIM_THAY' };
  if (Number(dong.is_follow_up) !== 1) return { ok: false, ly: 'KHONG_PHAI_THEO_DUOI' };
  if (dong.follow_up_status === TRANG_THAI_TD.DA_XONG) return { ok: false, ly: 'DA_XONG' };

  const bayGio = p.bayGioMs ?? Date.now();
  const dat = { id: dong.id, ts: new Date().toISOString() };
  const cot = ['ts_updated = $ts'];

  if (p.chuKyPhut !== undefined) {
    // null = bỏ nhịp phút, quay về nhịp ngày. Đây là đường DUY NHẤT để đổi
    // chế độ, và nó phải rõ ràng chứ không suy từ việc có/không có tham số.
    dat.ckp = p.chuKyPhut === null ? null : Math.trunc(Number(p.chuKyPhut));
    cot.push('cycle_minutes = $ckp');
  }
  if (p.tranSoLan !== undefined) {
    dat.tran = p.tranSoLan === null ? null : Math.trunc(Number(p.tranSoLan));
    cot.push('max_reminds = $tran');
  }
  if (p.chuKyNgay !== undefined && p.chuKyNgay !== null) {
    const ck = Math.trunc(Number(p.chuKyNgay));
    if (!Number.isFinite(ck) || ck < 1 || ck > NHAC_THEO_DUOI.CHU_KY_NGAY_TOI_DA) {
      return { ok: false, ly: 'CHU_KY_LA', chiTiet: `chu kỳ phải trong 1..${NHAC_THEO_DUOI.CHU_KY_NGAY_TOI_DA} ngày` };
    }
    cot.push('cycle_days = $ck'); dat.ck = ck;
  }
  if (p.gioNhac !== undefined && p.gioNhac !== null) {
    const g = parseReminderHour(p.gioNhac);
    cot.push('remind_time = $gn'); dat.gn = `${String(g.gio).padStart(2, '0')}:${String(g.phut).padStart(2, '0')}`;
  }
  if (p.tamDungToiMs !== undefined) {
    cot.push('paused_until_ms = $td'); dat.td = p.tamDungToiMs === null ? null : Math.floor(p.tamDungToiMs);
    cot.push('follow_up_status = $ttd');
    dat.ttd = p.tamDungToiMs ? TRANG_THAI_TD.TAM_DUNG : TRANG_THAI_TD.DANG_THEO_DUOI;
  }

  // 🔴 Bỏ lượt đang chờ model (A6). Van xả vừa được kéo ⇒ dữ kiện đã giao model
  // ở lượt trước là RÁC: nó dựng theo nhịp cũ / trước khi host bảo giãn ra. Không
  // xoá thì bộ quét treo vẫn bắn câu dự phòng cho lượt đó — tức trợ lý vẫn nhắn
  // dù host vừa bảo giãn hoặc tạm dừng. Chính van xả bị vô hiệu bởi lưới dự phòng.
  cot.push('model_wait_since_ms = NULL');

  db.prepare(`UPDATE schedules SET ${cot.join(', ')} WHERE id = $id`).run(dat);

  // Dời mốc kế tiếp theo nhịp MỚI ngay, đừng để lượt sau vẫn chạy theo nhịp cũ.
  const moi = db.prepare('SELECT * FROM schedules WHERE id = $id').get({ id: dong.id });
  if (moi.follow_up_status === TRANG_THAI_TD.DANG_THEO_DUOI) {
    // 🔴 `chuKyPhut` BẮT BUỘC có mặt (A4). Thiếu nó thì `parseCadence()` bên trong
    // `nextReminderAt` thấy `cycle_minutes === undefined` và rơi xuống NHÁNH NGÀY —
    // tức host bảo "3 phút một lần" thì cột DB ghi đúng 3 nhưng mốc kế tiếp nhảy
    // sang 08:00 hôm sau, mà tool VẪN BÁO OK. Van xả hỏng NGƯỢC với ý người dùng:
    // host siết nhịp lại thì nó tự giãn ra một ngày, và không có dấu hiệu nào.
    // `createFollowUp()` ở trên CÓ truyền — hai chỗ gọi cùng một hàm phải giống nhau.
    const ke = nextReminderAt(bayGio, {
      chuKyNgay: moi.cycle_days, chuKyPhut: moi.cycle_minutes, gioNhac: moi.remind_time,
      boChuNhat: Number(moi.skip_sunday) === 1, muiGio: moi.timezone,
    });
    db.prepare('UPDATE schedules SET send_at_ms = $ke WHERE id = $id').run({ ke, id: dong.id });
    moi.send_at_ms = ke;
  }
  return { ok: true, dong: moi };
}

/**
 * ★ ĐÓNG lời nhắc — CHỈ HOST.
 *
 * 🔴 Trợ lý KHÔNG được tự đóng vì "nghe như đã xong". Đọc sai một câu là im
 * lặng bỏ rơi một việc thật, mà anh không có cách nào biết để cứu. Thấy dấu
 * hiệu xong thì HỎI anh; anh gật thì mới gọi hàm này.
 */
export function closeFollowUp(db, { id, nguoiDong, isHost, bayGioMs }) {
  if (!isHost) return { ok: false, ly: 'KHONG_PHAI_HOST' };
  const dong = db.prepare('SELECT * FROM schedules WHERE id = $k OR confirm_code = $k')
    .get({ k: String(id ?? '') });
  if (!dong) return { ok: false, ly: 'KHONG_TIM_THAY' };
  if (dong.follow_up_status === TRANG_THAI_TD.DA_XONG) return { ok: false, ly: 'DA_XONG' };

  db.prepare(
    `UPDATE schedules
        SET follow_up_status = $ttd, status = $tt, closed_by = $boi,
            closed_at_ms = $luc, close_reason = $ly, ts_updated = $ts,
            model_wait_since_ms = NULL
      WHERE id = $id`,
  ).run({
    // 🔴 `model_wait_since_ms = NULL` (A6): host vừa bảo XONG. Còn để lại mốc chờ
    // model thì bộ quét treo vẫn bắn câu dự phòng ≤10 phút sau — trợ lý nhắc
    // người thật về một việc ĐÃ ĐÓNG. Đóng mà vẫn nhắn là hỏng theo kiểu tệ
    // nhất: host tin là đã tắt, người trong nhóm vẫn bị làm phiền.
    ttd: TRANG_THAI_TD.DA_XONG,
    // `da_gui` là giá trị HỢP LỆ duy nhất còn lại trong CHECK để đánh dấu "vòng
    // đời đã khép". Ý nghĩa thật nằm ở `follow_up_status` + `close_reason`.
    tt: TRANG_THAI_LICH.DA_GUI,
    boi: String(nguoiDong ?? ''),
    luc: Math.floor(bayGioMs ?? Date.now()),
    ly: LY_DO_DONG.HOST_DONG,
    ts: new Date().toISOString(),
    id: dong.id,
  });
  return { ok: true, dong: db.prepare('SELECT * FROM schedules WHERE id = $id').get({ id: dong.id }) };
}

/**
 * ★ B1 — CÁC LỊCH "ĐÃ DÀNH CHỖ MÀ KHÔNG RÕ ĐÃ GỬI HAY CHƯA".
 *
 * 🔴 VÌ SAO TRẠNG THÁI NÀY TỒN TẠI: `claimSending()` lật `da_len_lich -> da_gui`
 * TRƯỚC khi gọi mạng (đúng — gửi trước rồi mới đánh dấu thì daemon chết giữa
 * chừng là gửi lại lần nữa vào nhóm người thật). Nhưng nếu tiến trình chết
 * GIỮA `claimSending()` và `writeSendOutcome()` thì dòng nằm lại `da_gui` với
 * `sent_msg_id = NULL` và `error_reason = NULL` — KHÔNG có gì phân biệt nó với
 * một lịch đã gửi thành công.
 *
 * ⛔ Chú thích ở `runner.js` nói "host đọc `schedule_list` thấy trạng thái lỗi rồi
 * tự quyết" — nhánh đó CHỈ chạy khi `catch` bắt được. Bị `kill`, máy sập, OOM
 * thì KHÔNG có `catch` nào cả.
 *
 * 🔴 Đo trước khi vá: `grep sent_msg_id src/ bin/` ra ĐÚNG 2 kết quả, CẢ HAI
 * đều là `UPDATE`; trong `test/` ra RỖNG. Hai lần GHI, KHÔNG một lần ĐỌC —
 * dữ liệu có mà không có đường ra thì cũng như không có.
 *
 * ⛔ CỐ Ý KHÔNG TỰ GỬI LẠI. Đây đúng ca "Zalo có thể đã nhận nhưng ta không
 * biết"; gửi lại là rủi ro hai tin vào nhóm người thật. Chỉ NÓI RA, host quyết.
 *
 * @returns {Array<{id: string, ma: string|null, noiDung: string, laTheoDuoi: boolean, tsCapNhat: string}>}
 */
export function claimedButUnsent(db) {
  try {
    return db
      .prepare(
        `SELECT id, confirm_code, content, is_follow_up, ts_updated
           FROM schedules
          WHERE status = $tt AND sent_msg_id IS NULL AND error_reason IS NULL
            AND close_reason IS NULL
          ORDER BY ts_updated DESC LIMIT 50`,
      )
      .all({ tt: TRANG_THAI_LICH.DA_GUI })
      .map((r) => ({
        id: String(r.id),
        ma: r.confirm_code ? String(r.confirm_code) : null,
        noiDung: String(r.content ?? ''),
        laTheoDuoi: Number(r.is_follow_up) === 1,
        tsCapNhat: String(r.ts_updated ?? ''),
      }));
  } catch (e) {
    _log(`không đọc được danh sách "đã dành chỗ chưa rõ đã gửi": ${e?.message ?? e}`);
    return [];
  }
}

/**
 * ★ A1 (cụm 1) — bất biến bị vi phạm: dòng đã chốt sổ (`da_gui`) mà sổ theo đuổi
 * vẫn ghi `dang_theo_duoi`. Đây CHÍNH LÀ dấu vết của lỗi "bộ chạy một lần cướp
 * lời nhắc theo đuổi": tính năng đã chết mà sổ vẫn báo đang chạy.
 * Giữ phép dò lại kể cả sau khi đã vá — dòng cũ trong DB vẫn mang trạng thái đó,
 * và nếu bất biến vỡ lần nữa thì phải thấy ngay chứ không đợi anh phát hiện.
 */
export function brokenInvariantReminders(db) {
  try {
    return db
      .prepare(
        `SELECT id, confirm_code, content FROM schedules
          WHERE is_follow_up = 1 AND follow_up_status = $ttd AND status = $tt
          LIMIT 50`,
      )
      .all({ ttd: TRANG_THAI_TD.DANG_THEO_DUOI, tt: TRANG_THAI_LICH.DA_GUI })
      .map((r) => ({ id: String(r.id), ma: r.confirm_code ? String(r.confirm_code) : null, noiDung: String(r.content ?? '') }));
  } catch (e) {
    _log(`không dò được bất biến sổ nhắc: ${e?.message ?? e}`);
    return [];
  }
}

/** Danh sách lời nhắc theo đuổi (mặc định: đang chạy). */
export function listFollowUps(db, { trangThaiTd, soLuong = 50 } = {}) {
  return db
    .prepare(
      `SELECT * FROM schedules
        WHERE is_follow_up = 1 AND ($ttd IS NULL OR follow_up_status = $ttd)
        ORDER BY send_at_ms ASC LIMIT $n`,
    )
    .all({ ttd: trangThaiTd ?? null, n: Math.max(1, Math.min(200, Number(soLuong) || 50)) });
}

// ═══════════════════════════════════════════════════════════════════════
// 3. BỐI CẢNH — DỮ KIỆN cho model viết câu, KHÔNG phải mẫu câu cứng
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ Gom DỮ KIỆN để dựng câu nhắc hôm nay KHÁC hôm qua.
 *
 * 🔴 VÌ SAO KHÔNG HARDCODE MẪU CÂU: lặp y nguyên một câu mỗi sáng thì người ta
 * tắt thông báo nhóm, và lúc đó lời nhắc thành vô dụng MÀ KHÔNG AI BIẾT.
 * 🔴 VÌ SAO KHÔNG ĐỂ MODEL TỰ TÍNH SỐ NGÀY: model đếm ngày là bịa. Số ngày, mốc
 * nhắc lần trước, người đó đã nói gì — đều do TẦNG TRUY VẤN cấp, model chỉ việc
 * diễn đạt.
 *
 * Dùng lại `queryHistory` của query.js (đường đọc DUY NHẤT, có khai nguồn cho
 * luật chống rò chéo) — CỐ Ý không viết bộ đọc thứ hai. Và giới hạn đúng MỘT
 * nhóm (`target_chat_id`), nên không có chuyện lôi dữ liệu nhóm khác vào câu nhắc.
 *
 * @param {any} db
 * @param {any} dong dòng schedules
 * @param {{bayGioMs?: number, truyVan?: Function}} [t]
 */
export function reminderContext(db, dong, t = {}) {
  const bayGio = t.bayGioMs ?? Date.now();
  const chatId = String(dong.target_chat_id);
  const uid = dong.owner ? String(dong.owner) : null;

  const tuMs = dong.last_remind_ms
    ? Number(dong.last_remind_ms)
    : Math.max(Number(dong.ts_created ? Date.parse(dong.ts_created) : bayGio), bayGio - NHAC_THEO_DUOI.CUA_SO_BOI_CANH_MS);

  const boiCanh = {
    soLanDaNhac: Number(dong.remind_count ?? 0),
    nhacLanTruocMs: dong.last_remind_ms ? Number(dong.last_remind_ms) : null,
    soNgayTuLanNhacTruoc: dong.last_remind_ms
      ? Math.floor((bayGio - Number(dong.last_remind_ms)) / 86_400_000)
      : null,
    soNgayTuKhiDat: Math.floor((bayGio - Date.parse(dong.ts_created)) / 86_400_000),
    nguoiPhuTrachDaNoiGi: [],
    coAiNoiGiTrongNhom: 0,
    // ⚠️ Cố ý KHÔNG có trường "nghi là đã xong". Suy hộ chuyện đó rồi đóng là
    // đúng thứ anh cấm — trợ lý phải HỎI, không tự kết luận.
  };

  try {
    const truyVan = t.truyVan;
    if (typeof truyVan !== 'function') return boiCanh;
    const kq = truyVan(db, {
      chatId,
      tuNgay: new Date(tuMs).toISOString(),
      denNgay: new Date(bayGio).toISOString(),
      soLuong: NHAC_THEO_DUOI.SO_TIN_BOI_CANH_TOI_DA,
    });
    const rows = kq?.rows ?? [];
    boiCanh.coAiNoiGiTrongNhom = rows.length;
    if (uid) {
      boiCanh.nguoiPhuTrachDaNoiGi = rows
        .filter((r) => String(r.user_id ?? '') === uid && r.content)
        .slice(0, 5)
        .map((r) => ({ luc: Number(r.ts_zalo), noiDung: String(r.content) }));
    }
  } catch (e) {
    _log(`không lấy được bối cảnh cho ${dong.id}: ${e?.message ?? e}`);
  }
  return boiCanh;
}

/**
 * Câu nhắc DỰ PHÒNG do code dựng — CHỈ dùng khi không có phiên Claude nào để
 * viết câu.
 *
 * ⚠️ Đây KHÔNG phải "mẫu câu cứng" mà anh cấm: nó biến thiên theo dữ kiện (số
 * lần đã nhắc, số ngày trôi, người đó có nói gì chưa). Lý do phải có nó: nếu
 * thiếu, thì hễ Claude không nối được là lời nhắc BIẾN MẤT ÂM THẦM — mà cả tính
 * năng này sinh ra để chống đúng chuyện "việc rơi không ai biết".
 */
export function fallbackReminderText(dong, boiCanh) {
  const p = [];
  if (boiCanh.soLanDaNhac === 0) p.push('Em nhắc lần đầu:');
  else p.push(`Em nhắc lần ${boiCanh.soLanDaNhac + 1}`
    + (boiCanh.soNgayTuKhiDat > 0 ? ` (đã ${boiCanh.soNgayTuKhiDat} ngày)` : '') + ':');
  p.push(String(dong.content));
  if (boiCanh.nguoiPhuTrachDaNoiGi.length > 0) {
    p.push('— em thấy anh/chị có nhắn lại nhưng chưa chốt ngày giúp em.');
  }
  return p.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. SỔ NHẮC DỄ ĐỌC — SQL là GỐC, file chỉ để anh liếc
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sinh file Markdown liệt kê lời nhắc đang theo đuổi.
 *
 * 🔴 FILE NÀY LÀ BẢN SAO MỘT CHIỀU, KHÔNG PHẢI NGUỒN.
 * Không có đường nào đọc ngược từ file vào DB, và cố ý không viết đường đó:
 * hai chỗ cùng ghi một file là ghi đè nhau — case thật `30_wiki/index.md` bị
 * revert 215->206 dòng HAI LẦN trong một đêm vì 2 pane cùng sửa.
 * Sửa lời nhắc thì sửa qua tool (DB), file tự sinh lại ở lượt sau.
 *
 * Ghi NGUYÊN TỬ (file tạm + rename): anh mở đúng lúc đang ghi thì thấy bản cũ
 * trọn vẹn, không thấy file cụt.
 *
 * @param {any} db
 * @param {string} duongDan
 * @param {{bayGioMs?: number}} [t]
 * @returns {{soDong: number, duongDan: string}|null}
 */
/** Mô tả nhịp bằng lời — đi qua `parseCadence()`, nguồn sự thật DUY NHẤT về nhịp. */
function _moTaNhip(d) {
  const nhip = parseCadence(d);
  if (nhip.laPhut) return `nhịp **${nhip.phut} phút** một lần (tính từ lần nhắc trước)`;
  return `nhịp **${nhip.ngay} ngày** lúc **${d.remind_time ?? NHAC_THEO_DUOI.GIO_NHAC_MAC_DINH}**`
    + (Number(d.skip_sunday) === 1 ? ' (chừa CN)' : '');
}

export function writeReminderBook(db, duongDan, t = {}) {
  const bayGio = t.bayGioMs ?? Date.now();
  let ds;
  try {
    ds = db.prepare(
      `SELECT * FROM schedules WHERE is_follow_up = 1
        ORDER BY (follow_up_status = 'da_xong'), send_at_ms ASC LIMIT 200`,
    ).all();
  } catch (e) {
    _log(`không đọc được sổ nhắc: ${e?.message ?? e}`);
    return null;
  }

  const dong = [
    '# Sổ nhắc — lời nhắc theo đuổi',
    '',
    `> Tự sinh lúc ${new Date(bayGio).toISOString()}. **SQL là gốc, file này chỉ để liếc.**`,
    '> Sửa ở đây KHÔNG có tác dụng — lượt sau bị ghi đè. Muốn đổi thì bảo trợ lý.',
    '',
  ];

  const treo = claimedButUnsent(db);
  if (treo.length) {
    dong.push(
      `## 🔴 Đã dành chỗ, KHÔNG RÕ đã gửi hay chưa (${treo.length})`, '',
      '> Tiến trình có thể đã chết giữa lúc đánh dấu và lúc gửi. **Em KHÔNG tự gửi lại**',
      '> (Zalo có thể đã nhận rồi — gửi lại là hai tin vào nhóm). Anh xem rồi quyết.', '',
    );
    for (const t of treo) {
      dong.push(`- \`${t.ma ?? t.id}\`${t.laTheoDuoi ? ' [nhắc lặp]' : ''} — **${t.noiDung}** _(lúc ${t.tsCapNhat})_`);
    }
    dong.push('');
  }

  const dangChay = ds.filter((d) => d.follow_up_status !== TRANG_THAI_TD.DA_XONG);
  const xong = ds.filter((d) => d.follow_up_status === TRANG_THAI_TD.DA_XONG);

  dong.push(`## Đang theo đuổi (${dangChay.length})`, '');
  if (dangChay.length === 0) dong.push('_Không có lời nhắc nào đang chạy._', '');
  for (const d of dangChay) {
    const tam = d.follow_up_status === TRANG_THAI_TD.TAM_DUNG;
    dong.push(
      `- **${d.content}**`,
      // 🔴 A10 — ĐỌC NHỊP QUA `parseCadence()`, KHÔNG hardcode `cycle_days`.
      // Bản cũ luôn in "nhịp N ngày lúc HH:MM" kể cả khi nhịp là PHÚT, và không
      // bao giờ in `max_reminds`. File thật sinh lúc 00:02 ngày 21/08 ghi
      // "nhịp 1 ngày lúc 08:00" trong khi DB là 3 PHÚT / trần 10 lần.
      // Sổ này là thứ anh liếc để tự kiểm — nó nói sai thì việc kiểm thành vô nghĩa.
      `  - nhóm: \`${d.target_chat_id}\` · đã nhắc **${d.remind_count}** lần`
      + ` · ${_moTaNhip(d)}`
      + (Number(d.max_reminds) > 0 ? ` · trần **${d.max_reminds}** lần` : ' · **không trần**'),
      `  - lần tới: ${new Date(Number(d.send_at_ms)).toISOString()}${tam ? ' — ⏸ ĐANG TẠM DỪNG' : ''}`
      // 🔴 Bất biến vỡ: dòng đã chốt sổ mà sổ vẫn ghi "đang theo đuổi". Đây đúng
      // dấu vết của lỗi A1 (bộ chạy một lần cướp lời nhắc). Phải HIỆN RA ở sổ,
      // vì trước đây nó im lặng và anh tưởng lời nhắc vẫn đang chạy.
      + (String(d.status) === TRANG_THAI_LICH.DA_GUI
        ? '\n  - 🔴 **BẤT THƯỜNG**: dòng này đã chốt sổ (`status=da_gui`) nhưng vẫn nằm ở'
          + ' mục đang theo đuổi ⇒ nó **SẼ KHÔNG BAO GIỜ NHẮC NỮA**. Báo Router.'
        : ''),
      `  - mã: \`${d.confirm_code ?? d.id}\` · nguyên văn anh nói: _"${d.raw_phrasing}"_`,
      '',
    );
  }

  if (xong.length) {
    dong.push(`## Đã xong (${xong.length})`, '');
    for (const d of xong) {
      dong.push(`- ~~${d.content}~~ — đóng bởi \`${d.closed_by ?? '?'}\``
        + ` lúc ${d.closed_at_ms ? new Date(Number(d.closed_at_ms)).toISOString() : '?'}`);
    }
    dong.push('');
  }

  try {
    const f = expandPath(duongDan);
    ensureParentDir(f);
    const tam = `${f}.tmp`;
    fs.writeFileSync(tam, dong.join('\n'), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tam, f);
    try { fs.chmodSync(f, 0o600); } catch { /* nuốt */ }
    return { soDong: ds.length, duongDan: f };
  } catch (e) {
    _log(`không ghi được sổ nhắc: ${e?.message ?? e}`);
    return null;
  }
}
