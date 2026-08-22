/**
 * ═══════════════════════════════════════════════════════════════════════
 * LƯỚI CANH OUTBOX KẸT — bước 5 của kế hoạch tách daemon (21/08/2026)
 *
 * ═══ BỆNH NÓ CHỐNG ═══
 * Ở `cheDo:"tach"`, `tra_loi` KHÔNG gửi Zalo nữa — nó **xếp hàng** vào
 * `hang_doi_gui` rồi báo model *"đã xếp hàng gửi"*, daemon mới là bên rút ra gửi.
 * ⇒ Daemon chết / mất mạng / kẹt throttle thì:
 *     · model tưởng xong (nó xếp hàng THÀNH CÔNG),
 *     · người nhắn không nhận gì,
 *     · và KHÔNG AI BÁO.
 * Đúng họ lỗi "hỏng câm" mà pack phải chống: việc đã nhận, đã hứa, mà không có
 * gì đi ra và không ai biết.
 *
 * ═══ 🔴 BA ĐIỀU LÀM NÊN LƯỚI NÀY — ĐỌC TRƯỚC KHI SỬA ═══
 *
 *  ① **KHÔNG ĐOÁN GÌ CẢ.** Lưới canh một SỰ THẬT KHÁCH QUAN: có một dòng
 *     `hang_doi_gui` ở `'cho'`/`'dang_gui'` quá lâu. Không có chỗ nào để đoán,
 *     nên công tắc `ZTL_LUOI_OUTBOX` (đặt ở `bo_chay.js`) **mặc định BẬT**.
 *     ⚠️ Pack từng có một lưới nữa canh `hang_doi_hoi` còn `'da_day'`. Nó phải
 *     ĐOÁN *"câu này có cần trả lời không"* và đoán sai thật — đi giục trả lời
 *     cả tiếng "ok" của host — nên **anh chốt bỏ hẳn 21/08/2026**. Ghi lại để
 *     đừng ai dựng lại nó dưới tên khác: cái gì phải đoán ý người thì đừng cho
 *     nó quyền nhắn tin.
 *
 *  ② **ĐỒNG HỒ ĐỌC TỪ ĐĨA, không phải từ lúc lưới nhìn thấy.** `ts_cap_nhat` là
 *     mốc ĐÚNG: đặt lúc xếp hàng, và `nhanViecGui` cập nhật lại mỗi lần đổi
 *     trạng thái. Cứ tin nó, ⛔ đừng tự đếm từ lúc quét.
 *
 *  ③ **KHÔNG GIAO LẠI CHO AI, chỉ BÁO.**
 *     Tin đã nằm sẵn trên đĩa, chỉ có daemon mới gửi được — lưới KHÔNG
 *     tự gửi hộ (làm thế là bắn từ hai tiến trình, phá throttle toàn cục, đúng
 *     thứ bảng outbox sinh ra để chống). Nó chỉ có MỘT việc: **báo host**.
 *
 * ⛔ TUYỆT ĐỐI KHÔNG bắn gì vào NHÓM. Người trong nhóm là người thật; một câu
 *    đóng hộp kiểu *"em đang xử lý…"* làm phiền họ mà không giải quyết gì.
 *    Cả file này KHÔNG có một lời gọi gửi-vào-nhóm nào, và bài test canh điều đó.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi log đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';

import { safeLogText, redact } from '../lib/redact.js';
import { layHangDoiGuiKet } from '../store/write.js';

/**
 * ═══ NGƯỠNG 120 GIÂY — GIỮ NGUYÊN SỐ ROUTER GIAO, VÀ ĐÂY LÀ SỐ ĐO ═══
 *
 * Cận DƯỚI (không được ngắn hơn) — cộng đúng các chặng chờ HỢP LỆ:
 *   · daemon đánh thức mỗi `GIOI_HAN_LICH.NHIP_KIEM_MS` = **30 giây**
 *     (`src/lib/hang_so.js:358`) ⇒ một tin vừa xếp hàng có thể nằm chờ tới 30 s
 *     mà chẳng có gì sai cả;
 *   · throttle toàn cục **1,2 giây/tin** (`src/zalo/send.js:464`,
 *     `minKhoangCachMs: 1200`) ⇒ tin thứ N trong lô phải chờ thêm N×1,2 s.
 *   ⇒ 120 s dung được: 30 s chờ nhịp + **75 tin** tồn phía trước (90/1,2).
 *     Bot này mỗi lượt gửi 1–3 tin, nên 75 là dư rất xa.
 *
 * Cận TRÊN (không được dài hơn) — mốc nghiệm thu Router chốt là *"chặn đường gửi
 * bằng tay ⇒ có DM host trong ≤150 giây"*. Lưới chạy nhờ nhịp 30 giây của
 * `bo_chay`, nên thời gian thật = 120 + tối đa một hạt nhịp 30 = **đúng 150**.
 * ⇒ 120 là con số LỚN NHẤT còn lọt mốc ≤150. Nới lên 130 là trượt nghiệm thu.
 *
 * ⚠️ Vì vậy: ai sửa `NHIP_KIEM_MS` to hơn 30 giây thì PHẢI hạ ngưỡng này xuống,
 * không thì mốc ≤150 giây vỡ trong im lặng.
 */
export const NGUONG_KET_MS = 120_000;

/**
 * ═══ 🔴 GIAN ÂN LÚC KHỞI ĐỘNG — CHỐNG BÁO ĐỘNG GIẢ ═══
 *
 * Daemon nghỉ qua đêm, 3 câu trả lời nằm trong outbox. Daemon lên lại: các dòng
 * đó ĐANG già hơn 120 giây thật, nhưng chúng KHÔNG kẹt — daemon sắp gửi chúng
 * trong nhịp đầu tiên. Bắn DM lúc đó là báo động giả, mà báo động giả thì huỷ
 * hoại lòng tin vào cả những cảnh báo đúng (đúng bài học vụ "giục quét QR" oan:
 * báo động giả tự tạo ra sự cố nó cảnh báo).
 * ⇒ Nhường daemon TRỌN MỘT NHỊP (30 giây) kể từ lúc bộ canh được dựng.
 *
 * ⚠️ KHÔNG ảnh hưởng mốc ≤150 giây: mốc đó đo ca *"đang chạy thì chặn đường
 * gửi"*, lúc ấy tiến trình đã sống từ lâu nên gian ân đã qua từ đời nào.
 *
 * ⚠️ CHỖ CHƯA KÍN, nói thẳng: lô tồn > ~75 tin thì 30 giây gian ân KHÔNG đủ để
 * daemon đẩy hết ⇒ vẫn có thể báo một lần. Vì thế tin DM luôn kèm SỐ LƯỢNG —
 * host đọc là phân biệt được "kẹt 1 tin" với "đang tồn 100 tin".
 */
export const GIAN_AN_KHOI_DONG_MS = 30_000;

/** Trần dòng liệt kê trong một tin DM — dài quá thì host không đọc. */
export const TRAN_LIET_KE = 8;

function _log(msg) {
  process.stderr.write(`[lich/canh_outbox] ${msg}\n`);
}

/**
 * Ghi MỘT dòng JSONL. KHÔNG BAO GIỜ ném — sổ sách, không phải điều kiện sống.
 */
function _ghiSo(duongDan, dong) {
  if (!duongDan) return false;
  try {
    fs.appendFileSync(duongDan, `${JSON.stringify(dong)}\n`, { mode: 0o600 });
    return true;
  } catch (e) {
    _log(`không ghi được nhật ký lưới outbox: ${safeLogText(e)}`);
    return false;
  }
}

function _gio(tsIso) {
  const m = Date.parse(String(tsIso));
  if (!Number.isFinite(m)) return '??:??';
  return new Date(m).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** Tên hội thoại đích, tra lúc gửi. Không tra ra ⇒ null, ⛔ CẤM bịa. */
function _tenHoiThoai(db, chatId) {
  try {
    return db.prepare('SELECT ten FROM hoi_thoai WHERE chat_id = ?').get(String(chatId))?.ten ?? null;
  } catch {
    return null;
  }
}

/**
 * ═══ MẪU SỐ — ĐẾM CẢ LÚC KHOẺ, KHÔNG CHỈ LÚC NỔ ═══
 *
 * 🔴 Bài học rút ra sáng nay: đếm số lần lưới NỔ mà không có mẫu số thì tuần sau
 * không trả lời được câu *"kẹt bao nhiêu lần trên TỔNG bao nhiêu tin"* — mà đó
 * mới là câu quyết định giữ hay bỏ lưới.
 *
 * ⚠️ Nhưng ⛔ KHÔNG ghi mỗi nhịp: nhịp 30 giây = 2.880 dòng/ngày rác. Ghi theo
 * kiểu ĐỔI-MỚI-GHI (state-diff): phân bố trạng thái y hệt lần trước thì im.
 * Lúc hệ đứng yên thì sổ không nở một dòng nào; mà mỗi lần có tin đi ra là số
 * `da_gui` đổi ⇒ có dòng. Đúng thứ cần để dựng mẫu số.
 */
function _demTheoTrangThai(db) {
  const r = db.prepare(
    'SELECT trang_thai, count(*) AS c FROM hang_doi_gui GROUP BY trang_thai',
  ).all();
  const dem = { cho: 0, dang_gui: 0, da_gui: 0, loi: 0 };
  for (const d of r) dem[String(d.trang_thai)] = Number(d.c);
  return dem;
}

/**
 * @param {{nguongKetMs?: number, duongDanSo?: string|null, mocKhoiDongMs?: number,
 *          gianAnMs?: number, layKet?: Function}} [tuyChon]
 */
export function taoBoCanhOutbox(tuyChon = {}) {
  const nguongKet = Number.isFinite(Number(tuyChon.nguongKetMs))
    ? Number(tuyChon.nguongKetMs) : NGUONG_KET_MS;
  const gianAn = Number.isFinite(Number(tuyChon.gianAnMs))
    ? Number(tuyChon.gianAnMs) : GIAN_AN_KHOI_DONG_MS;
  const duongDanSo = tuyChon.duongDanSo ?? null;
  // 🔴 TÁI DÙNG `layHangDoiGuiKet` của bước 2 chứ ⛔ KHÔNG chép lại SQL. Hàm đó
  // được viết SẴN CHO lưới này ("Dành cho lưới canh outbox") và nó lọc theo
  // `ts_cap_nhat`, ⛔ không phải `ts_tao` — chép tay rất dễ chép nhầm sang
  // `ts_tao`, và lúc đó một dòng vừa được `nhanViecGui` đụng vào vẫn bị tính là
  // kẹt từ đầu. Một nguồn sự thật, không hai bản trôi khỏi nhau.
  const layKet = typeof tuyChon.layKet === 'function' ? tuyChon.layKet : layHangDoiGuiKet;
  const mocKhoiDong = Number.isFinite(Number(tuyChon.mocKhoiDongMs))
    ? Number(tuyChon.mocKhoiDongMs) : null;

  /** @type {Map<string, {daBaoHost: boolean, lanDauKet: number}>} */
  const so = new Map();
  const tong = { ket: 0, baoHost: 0, thoatKet: 0, boQuaGianAn: 0, loi: 0 };
  /** Phân bố trạng thái lần cuối ĐÃ GHI SỔ — dùng cho state-diff. */
  let demCu = null;
  let daDungMoc = mocKhoiDong;

  /**
   * Chạy MỘT nhịp canh.
   *
   * @param {{db: any, bayGioMs?: number,
   *          baoHost?: ((loiNhan: string) => Promise<any>)|null}} p
   * @returns {Promise<{ket: number, baoHost: number, thoatKet: number,
   *                    boQuaGianAn: number, loi: number}>}
   */
  async function chayMotNhip(p) {
    const bayGio = p?.bayGioMs ?? Date.now();
    const ra = { ket: 0, baoHost: 0, thoatKet: 0, boQuaGianAn: 0, loi: 0 };
    if (daDungMoc === null) daDungMoc = bayGio;   // nhịp đầu tiên = mốc khởi động

    // ── MẪU SỐ: ghi khi phân bố ĐỔI, im khi đứng yên ────────────────────
    try {
      const dem = _demTheoTrangThai(p.db);
      const khoa = JSON.stringify(dem);
      if (khoa !== demCu) {
        demCu = khoa;
        _ghiSo(duongDanSo, {
          luc: new Date(bayGio).toISOString(), su_kien: 'dem_outbox', ...dem,
        });
      }
    } catch (e) {
      // Bảng chưa tồn tại (DB đời cũ) là ca HỢP LỆ, không phải lỗi đáng kêu to.
      _log(`không đếm được outbox (bỏ qua mẫu số nhịp này): ${safeLogText(e)}`);
    }

    // ── GIAN ÂN: nhường daemon trọn một nhịp để đẩy lô tồn ───────────────
    if (bayGio - daDungMoc < gianAn) {
      ra.boQuaGianAn += 1; tong.boQuaGianAn += 1;
      return ra;
    }

    let ds;
    try {
      ds = layKet(p.db, nguongKet, bayGio) ?? [];
    } catch (e) {
      ra.loi += 1; tong.loi += 1;
      _log(`không đọc được outbox kẹt (bỏ nhịp này): ${safeLogText(e)}`);
      return ra;
    }

    const conKet = new Set();
    /** Dòng VỪA vượt ngưỡng trong nhịp này — gom lại báo MỘT tin. */
    const moiKet = [];

    for (const d of ds) {
      const id = String(d.id);
      conKet.add(id);
      ra.ket += 1;
      let m = so.get(id);
      if (!m) {
        m = { daBaoHost: false, lanDauKet: bayGio };
        so.set(id, m);
        tong.ket += 1;
      }
      // 🔴 BÁO ĐÚNG MỘT LẦN cho mỗi dòng. Nhịp 30 giây mà báo mỗi nhịp là 120
      // tin/giờ vào DM của host — tự tay biến cảnh báo thật thành rác.
      if (m.daBaoHost) continue;
      m.daBaoHost = true;
      moiKet.push(d);
    }

    if (moiKet.length) {
      ra.baoHost += 1; tong.baoHost += 1;
      for (const d of moiKet) {
        _ghiSo(duongDanSo, {
          luc: new Date(bayGio).toISOString(), su_kien: 'ket',
          id: String(d.id), request_id: String(d.request_id ?? ''),
          chat_id_dich: String(d.chat_id_dich), trang_thai: String(d.trang_thai),
          so_lan_thu: Number(d.so_lan_thu ?? 0),
          ket_ms: bayGio - (Date.parse(String(d.ts_cap_nhat)) || bayGio),
        });
      }
      _log(`${moiKet.length} tin kẹt trong outbox quá ${Math.round(nguongKet / 1000)}s -> BÁO HOST`);
      if (typeof p.baoHost === 'function') {
        // ⛔ Fire-and-forget: DM host hỏng thì tuyệt đối không được làm chết nhịp.
        Promise.resolve(p.baoHost(_dungTin(p.db, moiKet, nguongKet))).catch((e) => {
          _log(`không DM được host về outbox kẹt: ${safeLogText(e)}`);
        });
      } else {
        _log('KHÔNG có đường DM host -> host sẽ không biết. Chỉ còn dòng log này.');
      }
    }

    // ── Dọn sổ: dòng đã rời khỏi 'cho'/'dang_gui' ────────────────────────
    // Ghi lại ca ĐÃ BÁO rồi mới thoát kẹt — đó là bằng chứng lưới có kêu oan hay
    // không, thứ tuần sau phải trả lời được.
    for (const [id, m] of so) {
      if (conKet.has(id)) continue;
      so.delete(id);
      if (!m.daBaoHost) continue;
      let tt = null;
      try {
        tt = p.db.prepare('SELECT trang_thai FROM hang_doi_gui WHERE id = ?')
          .get(id)?.trang_thai ?? null;
      } catch { /* mất một dòng thống kê, không đáng để hỏng nhịp */ }
      ra.thoatKet += 1; tong.thoatKet += 1;
      _ghiSo(duongDanSo, {
        luc: new Date(bayGio).toISOString(), su_kien: 'thoat_ket',
        id, trang_thai_cuoi: tt,
      });
    }

    return ra;
  }

  return {
    chayMotNhip,
    thongKe: () => ({ ...tong, dangTheoDoi: so.size }),
    /** Chỉ dùng cho test. */
    _so: so,
  };
}

/**
 * Câu DM cho host.
 *
 * 🔴 CỐ Ý KHÔNG kèm NỘI DUNG tin đang kẹt. Tin đó soạn cho một hội thoại cụ
 * thể; bê nguyên văn sang DM host là tự tay mở đúng đường mà `leak_guard` cấm
 * (đáp án của nhóm này chảy sang chỗ khác). Host cần biết *có tin chưa đi ra và
 * đi đâu*, ⛔ không cần đọc lại nội dung — muốn xem thì tra DB.
 * ⚠️ Tên hội thoại thì CÓ kèm: đó là nhóm của chính host, và host cần biết tin
 * kẹt đi ĐÂU mới xử được.
 */
function _dungTin(db, ds, nguongMs) {
  const giay = Math.round(Number(nguongMs) / 1000);
  const dong = ds.slice(0, TRAN_LIET_KE).map((d) => {
    const ten = _tenHoiThoai(db, String(d.chat_id_dich));
    const noi = ten ? String(redact(ten)) : `chat ${String(d.chat_id_dich)}`;
    const lan = Number(d.so_lan_thu ?? 0);
    return `· ${_gio(d.ts_tao)} -> ${noi} [${String(d.trang_thai)}`
      + `${lan ? `, đã thử ${lan} lần` : ''}]`;
  });
  const con = ds.length - dong.length;
  return (
    `🔴 Có ${ds.length} tin đã XẾP HÀNG gửi mà chưa ra khỏi máy (quá ${giay} giây).\n`
    + `${dong.join('\n')}${con > 0 ? `\n· …và ${con} tin nữa` : ''}\n`
    + 'Nghĩa là em đã nhận việc và báo là "đã xếp hàng", nhưng bộ gửi chưa đẩy đi được — '
    + 'nhiều khả năng daemon chết, mất mạng, hoặc bị Zalo chặn.\n'
    + '⚠️ Người trong nhóm KHÔNG nhận được gì và em KHÔNG bắn gì vào nhóm để khỏi làm phiền họ. '
    + 'Anh kiểm giúp em daemon còn sống không ạ.'
  );
}
