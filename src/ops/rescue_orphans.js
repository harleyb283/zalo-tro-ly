/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ LƯỚI VỚT CÂU HỎI MỒ CÔI — dựng lại lớp đã BIẾN MẤT.
 *
 * 🔴 CHUYỆN THẬT, ngày 21/08/2026, ba lần trong một buổi chiều:
 *      12:47 nhóm Haceco  "nói các rule e cần tuân theo đi"
 *      13:42 DM host      "Xong thì báo a nhé"
 *      14:29 DM host      "Alo xong chưa"
 *    Cả ba nằm lại ở `da_day` — nghĩa là ĐÃ ĐẨY, ⛔ CHƯA AI TRẢ LỜI. Anh ngồi
 *    chờ hơn một tiếng và tưởng trợ lý lờ mình.
 *
 * 🔴 VÌ SAO KHÔNG AI VỚT:
 *    · `gomDaDay` (đẩy bù dòng mồ côi) CHỈ chạy lúc daemon khởi động và lúc
 *      Claude bắt tay lại. Vòng poll truyền `gomDaDay: false` — đúng, vì bật
 *      nó mỗi 2 giây là đẩy lại chính câu đang soạn dở.
 *    · Lưới "hết hạn 30 phút rồi báo host" nghe thì có, nhưng nó chỉ được TÍNH
 *      khi có ai đó QUÉT tới dòng đó — mà không ai quét `da_day` cả. Dòng 12:47
 *      nằm im hơn hai tiếng, ⛔ không hết hạn, ⛔ không báo. Một lưới không bao
 *      giờ được chạm tới thì ⛔ không phải là lưới.
 *    ⇒ Giữa hai lần bắt tay, ⛔ KHÔNG có lớp nào cứu. Đó là lỗ hổng, không phải
 *      thiết kế.
 *
 * ★ LƯỚI NÀY: mỗi `RESCUE_TICK_MS`, quét dòng `da_day`/`dang_xu_ly` đã quá
 *   `ORPHAN_AGE_MS` mà chưa ai trả lời -> ĐẨY LẠI. Quá `MAX_RESCUE_ATTEMPTS` lần vẫn im
 *   thì BÁO HOST ngay, ⛔ không đợi hết 30 phút.
 *
 * ⚠️ ⛔ KHÔNG SỢ TRẢ LỜI HAI LẦN: `tra_loi` đã chặn sẵn ở tầng tool — câu đã
 *   trả lời rồi thì gọi lần hai bị từ chối bằng mã `HANG_DOI_HET_HAN`. Đẩy
 *   thừa một lượt model là phí, ⛔ không phải là hai tin vào nhóm người thật.
 *
 * ⚠️ Sổ đếm nằm trong RAM — CÓ CHỦ Ý. Client chết thì sổ mất, nhưng client mới
 *   khởi động lại chạy `gomDaDay` ở `khiSanSang` nên mọi dòng mồ côi được đẩy
 *   lại từ đầu. ⛔ Không cần thêm cột vào DB cho một con số sống 3 phút.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Bao lâu thì coi một dòng `da_day` là MỒ CÔI.
 *
 * 🔴 12 PHÚT, ⛔ KHÔNG PHẢI 3. Bản đầu để 3 phút (bằng lưới `giao_lai` cũ) và
 *    ⛔ ĐÃ GÂY LỖI THẬT ngày 22/08/2026: anh hỏi trong nhóm Haceco lúc 10:53,
 *    pane của nhóm đang soạn câu trả lời — một việc bình thường mất vài phút —
 *    thì tới phút thứ 3 lưới vớt kết luận "mồ côi" và đẩy câu đó sang pane
 *    THỨ HAI. Hai pane cùng làm một câu; pane gốc trả lời lúc 10:56:37.
 *
 * 🔴 GỐC CỦA SAI LẦM: `da_day` mang HAI nghĩa — "đã đẩy, ⛔ không ai nhận" và
 *    "đã đẩy, đang có người soạn dở". Trạng thái ⛔ không phân biệt được hai ca
 *    đó, nên thứ duy nhất phân biệt được là THỜI GIAN. Ngưỡng phải cao hơn hẳn
 *    một lượt model bình thường, ⛔ không phải bằng nó.
 *
 * ⚠️ Vẫn thấp hơn nhiều `queueTtlMs` (mặc định 30 phút) ⇒ còn kịp vớt trước
 *    khi câu hỏi hết hạn. Đó là ràng buộc thật, có bài test canh.
 */
export const ORPHAN_AGE_MS = 12 * 60_000;

/**
 * Bao lâu thì coi dòng đó là VÔ CHỦ — ⛔ không pane nào nhận nữa — để pane
 * toàn quyền nhặt hộ, kể cả dòng ⛔ không thuộc tuyến của nó.
 *
 * 🔴 PHẢI LỚN HƠN `ORPHAN_AGE_MS`: cho pane CHỦ của nhóm đó một cơ hội nữa
 * trước khi người ngoài nhảy vào. Bằng nhau là hai pane cùng lao vào một lúc —
 * đúng lỗi 22/08 nhưng ở quy mô rộng hơn.
 */
export const UNCLAIMED_AGE_MS = 24 * 60_000;

/** Mỗi phút quét một lần. Rẻ: một câu SELECT có index. */
export const RESCUE_TICK_MS = 60_000;

/** Đẩy lại tối đa 2 lần rồi báo host — đẩy mãi là vòng lặp câm. */
export const MAX_RESCUE_ATTEMPTS = 2;

const _log = (s) => process.stderr.write(`[vot] ${s}\n`);

/**
 * Sổ đếm số lần đã vớt cho từng câu hỏi.
 *
 * @param {{tran?: number, log?: (s: string) => void, notifyHost?: (s: string) => any}} [p]
 */
export function createRescueLedger(p = {}) {
  const tran = Number.isFinite(Number(p.tran)) && Number(p.tran) > 0 ? Number(p.tran) : MAX_RESCUE_ATTEMPTS;
  const log = typeof p.log === 'function' ? p.log : _log;
  const notifyHost = typeof p.notifyHost === 'function' ? p.notifyHost : null;

  /** @type {Map<string, number>} */
  const dem = new Map();
  /** @type {Set<string>} */
  const daBao = new Set();

  return {
    /**
     * Dòng này có được đẩy (lại) không?
     *
     * 🔴 Dòng `cho` LUÔN được đẩy và ⛔ KHÔNG bị đếm: nó là câu hỏi bình thường
     * chưa từng tới ai. Đếm nó là tự đặt trần lên đường đi chính.
     *
     * @param {{request_id?: any, status?: any, ts_created?: any, content?: any}} r
     * @returns {boolean}
     */
    choPhep(r) {
      if (String(r?.status ?? '') === 'cho') return true;

      const rid = String(r?.request_id ?? '');
      if (!rid) return false;

      const n = (dem.get(rid) ?? 0) + 1;
      dem.set(rid, n);

      if (n <= tran) {
        log(`vớt lần ${n}/${tran}: ${rid} (${String(r?.status)}, ${String(r?.ts_created)})`);
        return true;
      }

      if (!daBao.has(rid)) {
        daBao.add(rid);
        const gio = String(r?.ts_created ?? '').slice(11, 16);
        const trich = String(r?.content ?? '').replace(/\s+/g, ' ').slice(0, 80);
        log(`vớt QUÁ ${tran} lần vẫn im -> báo host: ${rid}`);
        notifyHost?.(
          `⚠️ Câu hỏi lúc ${gio} "${trich}" em đã đẩy lại ${tran} lần mà phiên trả lời `
          + 'vẫn không nhận. Anh nhắn lại giúp em, hoặc kiểm xem pane trợ lý còn sống không.',
        );
      }
      return false;
    },

    /** Câu đã được trả lời -> quên đi, ⛔ đừng để sổ phình mãi. */
    quen(requestId) {
      const rid = String(requestId ?? '');
      dem.delete(rid);
      daBao.delete(rid);
    },

    /** Chỉ để test/log. */
    soDong() { return dem.size; },
  };
}
