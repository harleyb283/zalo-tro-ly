/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ GỬI HỎNG THÌ TỰ XOAY XỞ — hàm THUẦN, không I/O, không mạng.
 *
 * 🔴 VÌ SAO CÓ FILE NÀY (ca thật 22–26/08/2026, mất 3 tin của người thật):
 *    Zalo từ chối một tin, `drainOutbox` ghi `status='loi'` rồi **thôi**.
 *    ⛔ Không thử lại. ⛔ Không báo ai. Tin bốc hơi, và người duy nhất phát
 *    hiện ra là anh — bằng câu *"alo không gửi câu trả lời à"*, sau 4 ngày.
 *
 * 🔴 VÌ SAO ⛔ KHÔNG VÁ "NGUYÊN NHÂN": Zalo trả về đúng chữ **"Lỗi không xác
 *    định"** — nguyên văn của máy chủ họ, ⛔ không phải lớp che của pack nuốt
 *    mất. Ta ⛔ KHÔNG biết vì sao nó từ chối, và ⛔ không có cách nào biết.
 *
 *    ⚠️ Đã từng đoán sai đúng chỗ này: thấy "3 tin lỗi là 3 tin dài nhất" rồi
 *    kết luận do độ dài, vá chia nhỏ tin — **sai**. Thử lại thì một phần
 *    2.015 byte vẫn rơi, trong khi 40 giây trước một tin 2.038 byte gửi lọt.
 *    Trùng hợp, ⛔ không phải nhân quả.
 *
 * ⇒ ⛔ Không biết nguyên nhân thì ⛔ không vá nguyên nhân. Vá HẬU QUẢ:
 *      ① thử lại có giãn cách    — lỗi chập chờn thì lượt sau là qua
 *      ② mỗi lượt lại chia nhỏ hơn — dò xuống mà ⛔ không cần biết ngưỡng thật
 *      ③ hết cách thì KÊU TO     — thà phiền còn hơn im rồi mất tin
 *
 * ⛔ ĐÂY ⛔ KHÔNG PHẢI "tự sửa code". Nó chỉ xoay xở trong ĐÚNG một việc: gửi
 *    lại tin đã nằm sẵn trong hàng đợi. ⛔ Không sinh nội dung mới, ⛔ không
 *    đụng file, ⛔ không đổi hành vi nào khác.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { TRAN_BYTE_TIN_ZALO } from '../lib/hang_so.js';

/**
 * Số lượt gửi TỐI ĐA cho một tin (kể cả lượt đầu).
 * ⚠️ 4 là cố ý, ⛔ đừng nâng: mỗi lượt là một lần Zalo thấy ta bắn lại cùng
 * một nội dung. Bắn dai vào tài khoản đang bị từ chối là đúng khuôn hành vi
 * bị gắn cờ spam — mà mất tài khoản thì hỏng nặng hơn mất một tin.
 */
export const MAX_LAN_GUI = 4;

/**
 * Giãn cách TRƯỚC lượt thứ n (n tính từ 1). Phần tử [0] = 0 vì lượt đầu ⛔
 * không phải chờ. Vượt mảng thì dùng phần tử cuối.
 * ⚠️ Cộng dồn ~85 giây cho cả 4 lượt — đủ để qua một cú chập mạng, mà ⛔ chưa
 * lâu tới mức người trong nhóm nghĩ là trợ lý chết.
 */
export const BACKOFF_GUI_MS = Object.freeze([0, 5_000, 20_000, 60_000]);

/**
 * Trần byte cho lượt thứ n. Hỏng thì lần sau chia nhỏ hơn.
 *
 * 🔴 Đây là chỗ "dò xuống": ta ⛔ KHÔNG biết ngưỡng thật của Zalo (nếu có
 * ngưỡng nào), nên thay vì khai một con số rồi tin nó, cứ hạ dần cho tới khi
 * lọt. Nếu hỏng thật sự ⛔ không do độ dài thì việc hạ trần cũng ⛔ không hại
 * gì — chỉ là tin tới nơi dưới dạng nhiều mẩu nhỏ hơn.
 */
export const TRAN_BYTE_THEO_LAN = Object.freeze([
  TRAN_BYTE_TIN_ZALO, 1_400, 900, 600,
]);

const _lay = (mang, i) => mang[Math.min(Math.max(0, i), mang.length - 1)];

/**
 * ★★★ HỎNG KIỂU GÌ — và đây là chốt chặn QUAN TRỌNG NHẤT của cả file.
 *
 * 🔴 RỦI RO THẬT, ⛔ ĐỪNG GỠ: gửi hỏng ⛔ KHÔNG có nghĩa là Zalo chưa nhận.
 * Nếu tin đã tới nơi mà ta chỉ mất đường nghe kết quả, thì "thử lại" =
 * **hai tin giống hệt nhau vào nhóm người thật**. Bản thiết kế cũ chọn ⛔
 * KHÔNG thử lại chính vì lý do đó — quyết định ấy đúng, ⛔ không phải thiếu sót.
 *
 * ⇒ Chỉ thử lại khi **chắc chắn Zalo CHƯA nhận**, tức khi máy chủ đã TRẢ LỜI
 *   là từ chối. Máy chủ trả lời được nghĩa là nó đã xử lý xong và nói "không".
 *
 * ⇒ Còn đứt mạng, hết giờ chờ, rớt kết nối: ta ⛔ KHÔNG biết tin đã đi hay
 *   chưa ⇒ **⛔ KHÔNG thử lại**, báo host ngay. Thà anh nhắn tay một câu, còn
 *   hơn người trong nhóm nhận hai lần cùng một lời nhắc.
 *
 * ⚠️ MẶC ĐỊNH LÀ `KHONG_RO` — fail-closed. Gặp lỗi lạ chưa từng thấy thì coi
 * như ⛔ không rõ, ⛔ đừng đoán rằng nó an toàn.
 *
 * @param {string} lyDo nguyên văn lỗi đã qua lớp che
 * @returns {'TU_CHOI'|'KHONG_RO'}
 */
export function classifyFailure(lyDo) {
  const s = String(lyDo ?? '');
  // Dấu hiệu ĐỨT ĐƯỜNG — kiểm TRƯỚC, vì một thông điệp có thể chứa cả hai.
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket hang up|network|fetch failed|timeout|aborted|AbortError/i.test(s)) {
    return 'KHONG_RO';
  }
  // Dấu hiệu MÁY CHỦ ĐÃ TRẢ LỜI: có mã/thông điệp lỗi của Zalo ⇒ nó đã xử lý
  // xong và từ chối ⇒ chắc chắn CHƯA gửi ⇒ thử lại an toàn.
  if (/Lỗi không xác định|error_code|error_message/i.test(s)) return 'TU_CHOI';
  return 'KHONG_RO';
}

/**
 * ★ Sau một lượt gửi HỎNG: thử lại hay bó tay?
 *
 * @param {{soLanDaThu?: number, lyDo?: string}} dong dòng outbox (đã tính cả lượt vừa hỏng)
 * @returns {{thuLai: boolean, lanKe: number, choMs: number, tranByte: number, kieu: string}}
 *   `thuLai = false` ⇒ phải đánh dấu lỗi VÀ báo host.
 */
export function decideRetry(dong) {
  const daThu = Math.max(1, Math.floor(Number(dong?.soLanDaThu ?? 1)) || 1);
  const lanKe = daThu + 1;
  const kieu = classifyFailure(dong?.lyDo);
  // 🔴 CHỐT ĐẦU TIÊN, đứng TRƯỚC cả trần số lượt: ⛔ không rõ đã gửi hay chưa
  // thì ⛔ KHÔNG thử lại, dù mới hỏng lần đầu. Xem `classifyFailure`.
  if (kieu !== 'TU_CHOI') {
    return { thuLai: false, lanKe, choMs: 0, tranByte: _lay(TRAN_BYTE_THEO_LAN, 0), kieu };
  }
  if (lanKe > MAX_LAN_GUI) {
    return {
      thuLai: false, lanKe, choMs: 0, kieu,
      tranByte: _lay(TRAN_BYTE_THEO_LAN, MAX_LAN_GUI - 1),
    };
  }
  return {
    kieu,
    thuLai: true,
    lanKe,
    choMs: _lay(BACKOFF_GUI_MS, lanKe - 1),
    tranByte: _lay(TRAN_BYTE_THEO_LAN, lanKe - 1),
  };
}

/**
 * ★ Đã tới lượt gửi lại chưa? Dùng để BỎ QUA dòng còn trong thời gian chờ.
 *
 * 🔴 Nhịp rút outbox là 2 giây. ⛔ Không có chốt này thì "thử lại" biến thành
 * bắn 30 lần/phút vào đúng cái tin Zalo vừa từ chối — tức là tự nộp mình cho
 * bộ lọc spam. Chốt nằm ở ĐÂY chứ ⛔ không ở tầng SQL, để còn test được.
 *
 * @param {{soLanDaThu?: number, tsCapNhatMs?: number|null}} dong
 * @param {number} bayGioMs
 * @returns {boolean}
 */
export function readyToRetry(dong, bayGioMs) {
  const daThu = Math.floor(Number(dong?.soLanDaThu ?? 0)) || 0;
  if (daThu <= 0) return true;                       // lượt đầu: đi ngay
  const moc = Number(dong?.tsCapNhatMs);
  if (!Number.isFinite(moc)) return true;            // ⛔ không rõ mốc ⇒ cho đi, thà gửi
  return bayGioMs - moc >= _lay(BACKOFF_GUI_MS, daThu);
}

/**
 * Trần byte nên dùng cho lượt SẮP TỚI của một dòng.
 * @param {{soLanDaThu?: number}} dong
 * @returns {number}
 */
export function byteCapFor(dong) {
  const daThu = Math.floor(Number(dong?.soLanDaThu ?? 0)) || 0;
  return _lay(TRAN_BYTE_THEO_LAN, daThu);
}

/**
 * Câu báo host khi một tin CHẾT HẲN sau khi đã thử hết lượt.
 *
 * 🔴 PHẢI nêu ĐỦ ba thứ: gửi vào đâu, thử mấy lần, và ĐOẠN ĐẦU của nội dung.
 * Thiếu đoạn đầu thì anh ⛔ không biết mình vừa mất tin gì — mà đó mới là thứ
 * quyết định anh có cần nhắn tay lại hay không.
 *
 * @param {{chatIdDich?: string, soLanDaThu?: number, text?: string, lyDo?: string}} p
 * @returns {string}
 */
export function deadLetterMessage(p) {
  const dau = String(p?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const khongRo = p?.kieu === 'KHONG_RO';
  return [
    '🔴 MỘT TIN ⛔ KHÔNG GỬI ĐƯỢC',
    '',
    `- Gửi vào: ${p?.chatIdDich ?? '(không rõ)'}`,
    `- Đã thử: ${p?.soLanDaThu ?? '?'} lần`,
    `- Zalo báo: ${p?.lyDo ?? '(không rõ)'}`,
    ...(khongRo ? [
      '',
      '⚠️ Em CỐ Ý ⛔ KHÔNG thử lại tin này: lỗi thuộc loại **⛔ không rõ Zalo đã',
      'nhận hay chưa** (đứt mạng/hết giờ chờ). Thử lại mà hoá ra nó đã tới nơi',
      'thì nhóm nhận **hai tin giống hệt nhau** — em chọn phiền anh một câu còn',
      'hơn làm loạn nhóm người thật.',
    ] : []),
    '',
    `Nội dung bị kẹt: "${dau}${dau.length >= 140 ? '…' : ''}"`,
    '',
    '⚠️ Tin này ⛔ KHÔNG tới nơi. Nếu là việc gấp thì anh nhắn tay giúp em.',
  ].join('\n');
}
