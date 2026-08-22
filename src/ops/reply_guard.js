/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ CHỐT CUỐI: ⛔ KHÔNG ĐƯỢC KẾT THÚC LƯỢT KHI CÂU HỎI CHƯA ĐƯỢC GỬI ĐI.
 *
 * 🔴 SỰ CỐ 22/08/2026, 11:20 — nhóm Haceco:
 *      anh hỏi  -> pane nhận -> pane SOẠN câu trả lời trong cửa sổ của nó
 *      -> ⛔ QUÊN gọi tool gửi -> kết thúc lượt.
 *    Trong nhóm ⛔ không có gì xuất hiện. Chính pane đó lúc 11:22 thừa nhận:
 *    *"Dạ đúng rồi, em quên gọi gửi thật"*. Dòng hàng đợi nằm lại `da_day`.
 *
 * 🔴 VÌ SAO LUẬT VIẾT TRONG FILE ⛔ KHÔNG ĐỦ: bản luật đã nói rõ "chữ viết ra
 *    ⛔ không bao giờ tới người nhắn, phải gọi tool". Model vẫn quên — vì với
 *    nó, soạn xong câu trả lời CẢM GIÁC như đã xong việc. Chỗ này cần một
 *    CHỐT CƠ HỌC, ⛔ không phải một lời dặn kỹ hơn.
 *
 * ⇒ Hook `Stop` đọc kho: còn dòng nào của đúng hội thoại này, đủ mới, mà chưa
 *   được trả lời ⇒ CHẶN kết thúc lượt và nói thẳng cho model biết phải gọi
 *   tool nào.
 *
 * ⚠️ NGUYÊN TẮC SỐNG CÒN CỦA HOOK: HỎNG THÌ MỞ, ⛔ KHÔNG ĐÓNG. Hook lỗi mà
 *    chặn nhầm là pane kẹt vĩnh viễn ⇒ tệ hơn nhiều so với bỏ sót một lượt.
 *    Mọi nhánh ⛔ không chắc chắn đều trả `null` = cho đi tiếp.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Chỉ xét dòng ĐỦ MỚI. Dòng cũ hơn cửa sổ này là của lượt trước (đã hết hạn,
 * hoặc đã có lưới vớt lo) — chặn vì nó là chặn oan, và chặn oan thì lần sau
 * ⛔ không ai tin cái chốt này nữa.
 */
export const RECENT_WINDOW_MS = 10 * 60_000;

/**
 * @param {{dong?: any[], stopHookActive?: boolean, bayGio?: number, cuaSoMs?: number}} p
 * @returns {{soCau: number, ds: Array<{requestId: string, luc: string, trich: string}>}|null}
 *          `null` = CHO kết thúc lượt.
 */
export function decideBlock(p = {}) {
  // 🔴 Đã chặn một lần rồi mà model vẫn kết thúc ⇒ THÔI. Chặn tiếp là vòng lặp
  // vô hạn: hook chặn -> model chạy -> hook chặn… Cửa thoát này bắt buộc phải
  // có, kể cả khi nó có nghĩa là thỉnh thoảng lọt một lượt.
  if (p.stopHookActive) return null;

  const bayGio = Number.isFinite(p.bayGio) ? Number(p.bayGio) : Date.now();
  const cuaSo = Number.isFinite(p.cuaSoMs) ? Number(p.cuaSoMs) : RECENT_WINDOW_MS;

  const con = (p.dong ?? []).filter((r) => {
    const moc = Date.parse(String(r?.ts_tao ?? ''));
    if (!Number.isFinite(moc)) return false;      // ⛔ không đọc được mốc ⇒ ⛔ không chặn
    return bayGio - moc <= cuaSo && bayGio - moc >= 0;
  });

  if (!con.length) return null;

  return {
    soCau: con.length,
    ds: con.map((r) => ({
      requestId: String(r.request_id ?? ''),
      luc: String(r.ts_tao ?? '').slice(11, 19),
      trich: String(r.noi_dung ?? '').replace(/\s+/g, ' ').slice(0, 70),
      chiNghe: Number(r.chi_nghe) === 1,
    })),
  };
}

/**
 * Câu nói cho model. Phải nêu ĐÍCH DANH tool cần gọi và request_id — model vừa
 * quên một lần, nhắc chung chung ("nhớ trả lời nhé") là mời nó quên lần nữa.
 *
 * @param {NonNullable<ReturnType<typeof decideBlock>>} kq
 */
export function blockMessage(kq) {
  const dong = kq.ds.map((d) => `  · ${d.luc} [${d.requestId}] "${d.trich}"`
    + `${d.chiNghe ? '  (lượt CHỈ NGHE -> gọi bo_qua)' : ''}`).join('\n');

  return `⛔ CHƯA XONG: còn ${kq.soCau} lượt Zalo bạn ĐÃ NHẬN nhưng CHƯA GỬI GÌ ĐI.\n${dong}\n\n`
    + '🔴 Chữ bạn viết trong cửa sổ này KHÔNG tới người nhắn. Chỉ có tool mới gửi được:\n'
    + '   · cần trả lời      -> gọi `reply` với đúng request_id ở trên\n'
    + '   · lượt chỉ nghe    -> gọi `skip` với request_id đó\n'
    + '   · nội dung nhạy cảm -> gọi `dm_host`\n\n'
    + '⚠️ Đây là lỗi ĐÃ XẢY RA THẬT (22/08/2026, nhóm Haceco): câu trả lời soạn xong, '
    + 'không ai gọi tool, và trong nhóm không có gì xuất hiện. Gọi tool ngay bây giờ.';
}
