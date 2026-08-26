/**
 * ═══════════════════════════════════════════════════════════════════════
 * CHIA TIN DÀI THÀNH NHIỀU TIN — hàm THUẦN, không I/O, không mạng.
 *
 * Dùng cho `kenhPhu = "zalo"`: người tải pack về KHÔNG có kênh phụ nào, nên
 * đáp án dài phải đi hết vào Zalo. Zalo cắt cứng ở 4.000 ký tự ⇒ phải chia.
 *
 * 🔴 KHÁC HẲN `truncateSafely()` trong `src/zalo/send.js`:
 *      truncateSafely  = CẮT   → mất phần đuôi, chỉ ghi chú "đã cắt"
 *      splitMessage    = CHIA  → giữ ĐỦ nội dung, trải ra nhiều tin
 *    Đừng gọi cả hai chồng lên nhau: cắt rồi mới chia thì phần đuôi đã mất
 *    trước khi chia, mà nhìn kết quả vẫn thấy "3 tin" nên tưởng là đủ.
 *
 * ⚠️ Chia rồi thì phải THROTTLE ~1,2 giây/tin lúc gửi (send.js lo). Bắn liền
 *    tay 5 tin là đúng khuôn hành vi bị gắn cờ spam, nhất là tài khoản mới.
 *    Vì vậy `splitMessage` có trần số phần: thà cắt bớt phần cuối và nói rõ, còn
 *    hơn bắn 40 tin vào nhóm.
 *
 * ⚠️ File này CHƯA ĐƯỢC NỐI DÂY vào đường gửi (`send.js`/`tools.js` do pane
 *    khác giữ). Đã báo Router. Ở đây là hàm + test, nối dây là việc của chủ
 *    hai file kia.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { GIOI_HAN } from './hang_so.js';

/** Trần số tin cho MỘT lần trả lời. Quá thì cắt phần cuối và nói rõ. */
export const MAX_PARTS = 5;

/**
 * Độ dài "hiển thị" — đếm theo ĐIỂM MÃ, không theo đơn vị UTF-16.
 * Emoji và một số ký tự nằm ngoài mặt phẳng cơ bản chiếm 2 đơn vị `.length`;
 * đếm bằng `.length` thì một tin toàn emoji bị chia sớm gấp đôi cần thiết.
 */
export function charLength(s) {
  return [...String(s)].length;
}

/**
 * Độ dài tính bằng **BYTE UTF-8** — đơn vị Zalo thật sự đếm khi từ chối tin.
 * ⛔ Đừng thay bằng `.length`: tiếng Việt có dấu ~1,3 byte/ký tự, emoji 4.
 */
export function byteLength(s) {
  return _BO_MA.encode(String(s)).length;
}

const _BO_MA = new TextEncoder();

function catTheoDiemMa(s, tu, den) {
  return [...String(s)].slice(tu, den).join('');
}

/**
 * Tìm chỗ cắt ĐẸP NHẤT trong `khoi` (đã đúng độ dài tối đa).
 * Thứ tự ưu tiên: hết đoạn → hết dòng → hết câu → hết từ → cắt cứng.
 *
 * @param {string} khoi
 * @param {number} toiDa
 * @returns {number} số ĐIỂM MÃ nên lấy
 */
export function findSplitPoint(khoi, toiDa) {
  const n = charLength(khoi);
  if (n <= toiDa) return n;

  const cua = catTheoDiemMa(khoi, 0, toiDa);
  // Chỉ nhận chỗ cắt nằm ở nửa sau — cắt ở 5% đầu thì phần còn lại vẫn dài,
  // rốt cuộc số tin không giảm mà tin đầu lại cụt ngủn.
  const san = Math.floor(toiDa * 0.5);

  for (const dau of ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ']) {
    const i = cua.lastIndexOf(dau);
    if (i >= san) return charLength(cua.slice(0, i + dau.length));
  }
  return toiDa;   // không có chỗ nào đẹp -> cắt cứng
}

/**
 * Chia `text` thành các tin, mỗi tin ≤ `tran` ký tự KỂ CẢ tiền tố đánh số.
 *
 * @param {string} text
 * @param {{tran?: number, soTinToiDa?: number, danhSo?: boolean}} [tuyChon]
 * @returns {{phan: string[], daCat: boolean, originalLength: number, soPhan: number}}
 *   `daCat = true` nghĩa là nội dung KHÔNG được gửi đủ (chạm trần số tin).
 */
export function splitMessage(text, tuyChon = {}) {
  const tranByte = tuyChon.tranByte ?? null;
  if (!tranByte) return _chiaTheoDiemMa(text, tuyChon);

  // ═══ CHIA THEO BYTE — vòng CO DẦN ═══
  //
  // 🔴 Bộ chia bên dưới đo bằng ĐIỂM MÃ, còn Zalo đếm BYTE. Không có tỉ lệ cố
  // định giữa hai đơn vị: ASCII 1 byte/điểm mã, tiếng Việt có dấu ~1,3, emoji 4.
  // Nên: ước tỉ lệ từ CHÍNH đoạn chữ này, chia thử, rồi ĐO LẠI từng phần bằng
  // byte. Phần nào vượt thì co ngân sách 15% và chia lại.
  //
  // ⛔ ĐỪNG thay bằng một hằng số kiểu "chia 1.500 ký tự cho chắc": đoạn toàn
  // emoji vẫn vượt, mà đoạn toàn ASCII thì bị chẻ vụn vô cớ thành 3 tin.
  const s0 = String(text ?? '').trim();
  const soDiem = charLength(s0);
  if (soDiem === 0) return { phan: [], daCat: false, originalLength: 0, soPhan: 0 };

  const tyLe = Math.max(1, byteLength(s0) / soDiem);   // byte mỗi điểm mã
  let tran = Math.max(80, Math.floor(tranByte / tyLe));

  let kq = _chiaTheoDiemMa(text, { ...tuyChon, tran });
  for (let lan = 0; lan < 5; lan += 1) {
    if (kq.phan.every((p) => byteLength(p) <= tranByte)) return kq;
    tran = Math.max(80, Math.floor(tran * 0.85));
    kq = _chiaTheoDiemMa(text, { ...tuyChon, tran });
  }
  // Hết lượt co mà vẫn vượt: trả về bản cuối. Tầng gửi có cảnh báo riêng cho
  // ca này (`sendInParts` kêu khi một phần bị `truncateSafely` cắt), nên ⛔
  // không nuốt im — nhưng cũng ⛔ không ném, vì gửi thiếu còn hơn ⛔ không gửi.
  return kq;
}

/**
 * Bộ chia gốc, đo bằng ĐIỂM MÃ. Giữ nguyên hành vi cũ cho mọi lời gọi ⛔ không
 * khai `tranByte` — đó là điều kiện để bản vá này ⛔ không đổi gì ở đường cũ.
 *
 * @param {string} text
 * @param {{tran?: number, soTinToiDa?: number, danhSo?: boolean}} [tuyChon]
 * @returns {{phan: string[], daCat: boolean, originalLength: number, soPhan: number}}
 */
function _chiaTheoDiemMa(text, tuyChon = {}) {
  const tran = tuyChon.tran ?? GIOI_HAN.DO_DAI_TIN_TOI_DA;
  const soTinToiDa = tuyChon.soTinToiDa ?? MAX_PARTS;
  const danhSo = tuyChon.danhSo !== false;

  const s = String(text ?? '').trim();
  const originalLength = charLength(s);

  if (originalLength === 0) return { phan: [], daCat: false, originalLength: 0, soPhan: 0 };
  if (originalLength <= tran) {
    return { phan: [s], daCat: false, originalLength, soPhan: 1 };
  }

  // 🔴 VÒNG LẶP CÓ CHỦ ĐÍCH: tiền tố "12/34 " ăn vào ngân sách ký tự, mà độ
  // dài tiền tố lại phụ thuộc TỔNG SỐ PHẦN — thứ chỉ biết sau khi chia xong.
  // Vòng luẩn quẩn. Cách giải: đoán số phần, chia thử, nếu ra khác thì đoán
  // lại bằng chính kết quả vừa ra. Hội tụ sau 1–2 lượt; chặn cứng ở 6 lượt.
  let doanSoPhan = Math.ceil(originalLength / tran);
  let phan = [];

  // 🔴 Phần đuôi "còn N ký tự nữa" cũng ăn ngân sách. Quên trừ nó ra là tin
  // CUỐI vượt trần — và vượt đúng lúc nội dung đã dài, tức là bị Zalo cắt
  // thật. Dự trù theo ca xấu nhất (N = cả bài) rồi mới dựng tin cuối.
  const duTruDuoi = charLength(_duoi(originalLength));

  for (let lan = 0; lan < 6; lan += 1) {
    const chiPhiTienTo = danhSo ? charLength(`${doanSoPhan}/${doanSoPhan} `) : 0;
    const ngan = Math.max(50, tran - chiPhiTienTo);
    // Tin cuối cùng ĐƯỢC PHÉP có thể phải mang thêm phần đuôi.
    const nganCuoi = Math.max(30, ngan - duTruDuoi);

    phan = [];
    let conLai = s;
    while (charLength(conLai) > 0 && phan.length < soTinToiDa) {
      const laTinCuoiChoPhep = phan.length === soTinToiDa - 1;
      const budget = laTinCuoiChoPhep ? nganCuoi : ngan;
      const lay = findSplitPoint(conLai, budget);
      phan.push(catTheoDiemMa(conLai, 0, lay).trim());
      conLai = catTheoDiemMa(conLai, lay, charLength(conLai)).replace(/^\n+/, '');
    }

    const conThua = charLength(conLai) > 0;
    const soThat = phan.length;
    if (soThat === doanSoPhan || conThua) {
      // conThua = đã chạm trần số tin, số phần không tăng thêm được nữa.
      if (conThua) {
        const cuoi = phan.length - 1;
        phan[cuoi] = `${phan[cuoi]}${_duoi(charLength(conLai))}`;
      }
      return {
        phan: danhSo ? _danhSo(phan) : phan,
        daCat: conThua,
        originalLength,
        soPhan: phan.length,
      };
    }
    doanSoPhan = soThat;
  }

  return {
    phan: danhSo ? _danhSo(phan) : phan,
    daCat: false,
    originalLength,
    soPhan: phan.length,
  };
}

/** Phần đuôi báo "chưa gửi hết". Tách hàm để chỗ dự trù và chỗ dùng KHÔNG lệch nhau. */
function _duoi(soConLai) {
  return `\n…[còn ${soConLai} ký tự nữa, hỏi tiếp để em gửi phần sau]`;
}

function _danhSo(phan) {
  if (phan.length <= 1) return phan;
  return phan.map((p, i) => `${i + 1}/${phan.length} ${p}`);
}
