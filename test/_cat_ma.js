// Cắt vùng mã nguồn cho các bài test QUÉT CẤU TRÚC.
//
// 🔴 VÌ SAO CÓ FILE NÀY — bẫy `slice(a, indexOf(x))` (gặp thật 21/08/2026):
//
//   const than = src.slice(src.indexOf('function A('), src.indexOf('function B('));
//
// Ba kiểu hỏng CÂM của một dòng như trên, cả ba đều làm bài test XANH mãi mãi:
//   1. Đổi tên `A` ⇒ `indexOf` trả **-1** ⇒ `slice(-1, n)` cắt từ ký tự CUỐI ⇒
//      vùng gần như rỗng ⇒ mọi `assert.ok(!than.includes(...))` đều đúng.
//   2. Đổi tên `B` ⇒ `slice(i, -1)` ⇒ chuỗi RỖNG ⇒ y hệt trên.
//   3. Ai đó chèn hàm `C` vào GIỮA A và B ⇒ vùng cắt nuốt luôn `C`, nên bài
//      test "A không chạm mạng" bỗng đi soi cả `C` và đỏ vì lý do KHÔNG liên quan.
//      (Đúng ca này: `_ghiNho` nằm giữa `_boQua` và `_moLaiNhac`.)
//
// Nên: cắt theo NGOẶC CÂN BẰNG của đúng một hàm, và NÉM khi không tìm ra neo —
// ⛔ không bao giờ trả về chuỗi rỗng để bài test tự khen mình.

/** Thân của đúng MỘT hàm, cắt bằng ngoặc cân bằng. Không thấy neo ⇒ NÉM. */
export function thanHam(src, neo) {
  const i = src.indexOf(neo);
  if (i < 0) throw new Error(`[_cat_ma] ⛔ KHÔNG thấy neo '${neo}' — hàm đã đổi tên? Bài test đang đo hư không.`);
  if (src.indexOf(neo, i + 1) >= 0) throw new Error(`[_cat_ma] neo '${neo}' xuất hiện >1 lần — cắt sẽ mơ hồ.`);

  // ⚠️ ĐÃ HỎNG MỘT LẦN NGAY TẠI ĐÂY: nhảy thẳng tới `{` đầu tiên thì với
  // `function _boQua({ kho, db }, thamSo) {` nó vớ phải ngoặc THAM SỐ BÓC TÁCH,
  // cắt ra đúng 27 ký tự `function _boQua({ kho, db }` — một vùng gần rỗng mà
  // vẫn qua được chốt độ dài. ⇒ Phải đóng ngoặc TRÒN của danh sách tham số
  // trước, rồi mới lấy `{` kế tiếp làm đầu thân.
  const troMo = src.indexOf('(', i);
  if (troMo < 0) throw new Error(`[_cat_ma] neo '${neo}' không có danh sách tham số.`);
  let tron = 0, sauTron = -1;
  for (let k = troMo; k < src.length; k++) {
    if (src[k] === '(') tron++;
    else if (src[k] === ')') { tron--; if (tron === 0) { sauTron = k; break; } }
  }
  if (sauTron < 0) throw new Error(`[_cat_ma] danh sách tham số của '${neo}' không đóng.`);

  const mo = src.indexOf('{', sauTron);
  if (mo < 0) throw new Error(`[_cat_ma] neo '${neo}' không có thân hàm.`);
  let sau = 0;
  for (let k = mo; k < src.length; k++) {
    const c = src[k];
    if (c === '{') sau++;
    else if (c === '}') {
      sau--;
      if (sau === 0) {
        const than = src.slice(i, k + 1);
        // Thân thật luôn xuống dòng. Chốt này bắt được ca cắt hụt ở trên,
        // thứ mà chốt "đủ dài" ⛔ không bắt nổi.
        if (!than.includes('\n')) throw new Error(`[_cat_ma] thân '${neo}' nằm gọn 1 dòng (${than.length} ký tự) — nghi cắt hụt.`);
        return than;
      }
    }
  }
  throw new Error(`[_cat_ma] ⛔ ngoặc của '${neo}' không đóng — file hỏng hoặc neo sai.`);
}

/** Khối giữa hai neo. NÉM khi thiếu neo hoặc khi thứ tự ngược (⇒ vùng rỗng). */
export function khoiGiua(src, neoDau, neoCuoi) {
  const a = src.indexOf(neoDau);
  const b = src.indexOf(neoCuoi);
  if (a < 0) throw new Error(`[_cat_ma] ⛔ KHÔNG thấy neo đầu '${neoDau}'.`);
  if (b < 0) throw new Error(`[_cat_ma] ⛔ KHÔNG thấy neo cuối '${neoCuoi}'.`);
  if (b <= a) throw new Error(`[_cat_ma] neo cuối '${neoCuoi}' đứng TRƯỚC neo đầu — vùng cắt sẽ rỗng.`);
  const kh = src.slice(a, b);
  if (kh.length < 20) throw new Error(`[_cat_ma] vùng giữa hai neo ngắn bất thường (${kh.length} ký tự).`);
  return kh;
}

/** Từ neo tới hết (hoặc `dai` ký tự). Thiếu neo ⇒ NÉM, ⛔ không trả 1 ký tự cuối. */
export function tuNeo(src, neo, dai) {
  const i = src.indexOf(neo);
  if (i < 0) throw new Error(`[_cat_ma] ⛔ KHÔNG thấy neo '${neo}' — vùng cắt sẽ là rác.`);
  return dai == null ? src.slice(i) : src.slice(i, i + dai);
}

/** Phần đứng TRƯỚC neo. Thiếu neo ⇒ NÉM (nếu không sẽ nuốt cả file). */
export function truocNeo(src, neo) {
  const i = src.indexOf(neo);
  if (i < 0) throw new Error(`[_cat_ma] ⛔ KHÔNG thấy neo '${neo}' — vùng 'trước neo' sẽ nuốt cả file.`);
  return src.slice(0, i);
}
