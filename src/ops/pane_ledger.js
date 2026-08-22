/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ SỔ MỞ PHIÊN — chống gọi `tichHop.moPhienLenh` lặp lại.
 *
 * ═══ VÌ SAO CÓ FILE NÀY ═══
 * Nhóm bận đo thật **449 tin/ngày**. Gọi lệnh mở pane theo từng tin là **449
 * lần mở pane mỗi ngày cho một nhóm** — mà mỗi lần là một tiến trình `sh -c`.
 *
 * ═══ 🔴 VÌ SAO SỔ NẰM TRONG RAM, ⛔ KHÔNG GHI XUỐNG ĐĨA ═══
 * Đây ⛔ KHÔNG phải chọn cho rẻ — ghi bền ở đây là **SAI BẢN CHẤT**:
 * sổ này trả lời câu *"pane của nhóm X có đang sống không"*, mà **pane chết
 * theo daemon** (cùng máy, cùng lần khởi động). Một sổ bền sẽ nhớ *"đã mở
 * rồi"* trong khi pane đã biến mất ⇒ nhóm đó **vĩnh viễn không có pane**, và
 * ⛔ không lỗi nào nổ ra: câu hỏi vẫn được trả lời, chỉ là luôn rơi vào client
 * dự phòng. Đúng khuôn hỏng câm.
 *
 * ⚠️ Cái mất, nói thẳng: daemon restart ⇒ sổ trắng ⇒ mỗi nhóm bị gọi mở lại
 * **một lần**. Với 11 nhóm là **≤11 lời gọi thừa cho mỗi lần restart** — và
 * chúng ⛔ không thừa thật, vì pane cũ cũng đã chết cùng daemon.
 *
 * ⛔ File này KHÔNG biết trình quản lý pane bên kia là gì, KHÔNG chứa đường dẫn
 * máy ai, và KHÔNG tự dựng tiến trình nào. Nó chỉ giữ sổ và gọi callback do
 * người gọi truyền vào.
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  GIAN_CHO_MO_PANE_MS, NGHI_SAU_GIO_MAC_DINH,
  THU_LAI_MO_PHIEN_MS, TRAN_SO_CLIENT_MAC_DINH,
} from '../lib/hang_so.js';

/** Lý do KHÔNG gọi lệnh — mã máy, để log và test so khớp mà không so câu chữ. */
export const SKIP_REASON = Object.freeze({
  KHONG_CO_LENH: 'khong-co-lenh',
  DA_MO: 'da-mo',
  DANG_CHO_THU_LAI: 'dang-cho-thu-lai',
  QUA_TRAN: 'qua-tran',
  DANG_CHAY: 'dang-chay',
});

/**
 * @param {{
 *   chay?: (duLieu: object) => Promise<{thanhCong: boolean, ma: number|null, lyDo?: string}>,
 *   lenh?: string|null,
 *   tranSoClient?: number,
 *   nghiSauGio?: number,
 *   thuLaiMs?: number,
 *   bayGio?: () => number,
 *   log?: (s: string) => void,
 * }} p
 */
export function createPaneLedger(p = {}) {
  /** chatId -> {daMo: boolean, lucGoiMs: number, lucChamMs: number} */
  const so = new Map();
  const dangChay = new Set();
  const bayGio = p.bayGio ?? (() => Date.now());
  const log = p.log ?? (() => {});
  const tran = Number.isFinite(Number(p.tranSoClient))
    ? Number(p.tranSoClient) : TRAN_SO_CLIENT_MAC_DINH;
  const nghiMs = (Number(p.nghiSauGio) > 0 ? Number(p.nghiSauGio) : NGHI_SAU_GIO_MAC_DINH) * 3_600_000;
  const thuLaiMs = Number(p.thuLaiMs) > 0 ? Number(p.thuLaiMs) : THU_LAI_MO_PHIEN_MS;

  /** Quên các nhóm im quá lâu — "ngủ". ⛔ KHÔNG giết pane, chỉ quên. */
  function donNgu() {
    const t = bayGio();
    for (const [chat, m] of so) {
      if (t - m.lucChamMs > nghiMs) {
        so.delete(chat);
        log(`[moPhien] nhóm ${chat} im quá ${nghiMs}ms -> QUÊN khỏi sổ (⛔ không giết pane)`);
      }
    }
  }

  /** Số nhóm đang được tính vào trần. */
  function demDaMo() {
    let n = 0;
    for (const m of so.values()) if (m.daMo) n += 1;
    return n;
  }

  return {
    /**
     * ★ Bảo đảm nhóm này đã được gọi mở phiên. KHÔNG BAO GIỜ ném.
     *
     * 🔴 `await` được nhưng người gọi ⛔ KHÔNG PHẢI chờ: `chay()` đã có trần
     * thời gian riêng. Vòng nhận tin nên gọi rồi bỏ đi (fire-and-forget) —
     * xem chú thích tại chỗ gọi trong `index.js`.
     *
     * @returns {Promise<{daGoi: boolean, thanhCong?: boolean, lyDo?: string}>}
     */
    async baoDam(chatId, thongTin = {}) {
      const chat = String(chatId ?? '').trim();
      if (!chat) return { daGoi: false, lyDo: SKIP_REASON.KHONG_CO_LENH };
      donNgu();

      const m = so.get(chat) ?? { daMo: false, lucGoiMs: 0, lucChamMs: 0 };
      m.lucChamMs = bayGio();
      so.set(chat, m);

      // ⚠️ MẶC ĐỊNH `null` ⇒ ⛔ KHÔNG có panel-mỗi-nhóm, y hệt hôm nay.
      if (!p.lenh) return { daGoi: false, lyDo: SKIP_REASON.KHONG_CO_LENH };
      if (m.daMo) return { daGoi: false, lyDo: SKIP_REASON.DA_MO };
      // Lệnh đang chạy dở cho chính nhóm này ⇒ ⛔ đừng bắn chồng.
      if (dangChay.has(chat)) return { daGoi: false, lyDo: SKIP_REASON.DANG_CHAY };
      if (m.lucGoiMs && bayGio() - m.lucGoiMs < thuLaiMs) {
        return { daGoi: false, lyDo: SKIP_REASON.DANG_CHO_THU_LAI };
      }
      // 🔴 Quá trần ⇒ dồn về client DỰ PHÒNG, ⛔ KHÔNG bỏ rơi câu hỏi, và
      // ⛔ KHÔNG im lặng.
      if (demDaMo() >= tran) {
        log(`[moPhien] ĐÃ ĐỦ TRẦN ${tran} phiên -> nhóm ${chat} dùng client dự phòng`);
        return { daGoi: false, lyDo: SKIP_REASON.QUA_TRAN };
      }

      m.lucGoiMs = bayGio();
      dangChay.add(chat);
      try {
        const kq = await p.chay({
          chatId: chat,
          tenNhom: thongTin.tenNhom ?? null,
          lyDo: thongTin.lyDo ?? 'tin-moi',
        });
        if (kq?.thanhCong) {
          m.daMo = true;
          log(`[moPhien] mở phiên cho nhóm ${chat}: OK`);
        } else {
          // ⛔ KHÔNG đánh dấu `daMo` — thất bại thì phải còn đường thử lại.
          log(`[moPhien] mở phiên cho nhóm ${chat} THẤT BẠI (${kq?.lyDo ?? 'không rõ'})`
            + ` -> dùng client dự phòng, thử lại sau ${thuLaiMs}ms`);
        }
        return { daGoi: true, thanhCong: kq?.thanhCong === true, lyDo: kq?.lyDo };
      } catch (e) {
        // ⚠️ Nuốt CÓ GHI SỔ. Ném lên là giết vòng nhận tin vì một việc phụ.
        log(`[moPhien] mở phiên cho nhóm ${chat} NÉM LỖI: ${e?.message ?? e}`);
        return { daGoi: true, thanhCong: false, lyDo: String(e?.message ?? e) };
      } finally {
        dangChay.delete(chat);
      }
    },

    /** Chỉ để nghiệm thu/log — ⛔ đừng dùng làm căn cứ quyết định. */
    _so: () => ({ tong: so.size, daMo: demDaMo(), tran, gianCho: GIAN_CHO_MO_PANE_MS }),
    _quen: (chatId) => so.delete(String(chatId ?? '')),
  };
}
