/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ PHẦN THUẦN CỦA TRÌNH CÀI ĐẶT — tách khỏi `bin/cai-dat.js` để TEST ĐƯỢC.
 *
 * 🔴 VÌ SAO TÁCH: `bin/cai-dat.js` phải quét QR, hỏi người dùng, chạm mạng —
 *    ⛔ không bài test nào với tới. Mà thứ dễ sai nhất trong đó lại là logic
 *    THUẦN: hiểu sai câu người dùng gõ, dựng sai file cấu hình. Cả hai đều
 *    hỏng CÂM: cấu hình sai kiểu "không nghe nhóm nào" trông y hệt "bot chết".
 *
 * ⚠️ Người dùng của mấy hàm này ⛔ KHÔNG phải dân kỹ thuật. Nguyên tắc:
 *    · gõ sai thì HỎI LẠI, ⛔ không đoán bừa
 *    · ⛔ KHÔNG bao giờ tự chọn hộ "tất cả các nhóm" — ghi tin của người khác
 *      vào kho là việc ⛔ không rút lại được
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Hiểu câu chọn nhóm người dùng gõ.
 *
 * Nhận: `"1 3 5"` · `"1,3,5"` · `"2-4"` · `"tất cả"` / `"all"` · rỗng (⛔ không nhóm nào).
 *
 * @param {string} tho     câu người dùng gõ
 * @param {number} soNhom  tổng số nhóm đang hiển thị
 * @returns {{ok: true, chon: number[]} | {ok: false, loi: string}}  chỉ số bắt đầu từ 0
 */
export function parseGroupChoice(tho, soNhom) {
  const s = String(tho ?? '').trim().toLowerCase();
  if (!s) return { ok: true, chon: [] };

  if (['tất cả', 'tat ca', 'all', '*'].includes(s)) {
    // ⚠️ CÓ hỗ trợ "tất cả" vì người dùng sẽ gõ, nhưng chỗ gọi PHẢI hỏi xác
    // nhận lại lần nữa — xem `bin/cai-dat.js`. Ở đây chỉ dịch chữ thành số.
    return { ok: true, chon: Array.from({ length: soNhom }, (_, i) => i) };
  }

  /** @type {Set<number>} */
  const ra = new Set();
  for (const manh of s.split(/[\s,]+/).filter(Boolean)) {
    const khoang = /^(\d+)\s*-\s*(\d+)$/.exec(manh);
    if (khoang) {
      const a = Number(khoang[1]);
      const b = Number(khoang[2]);
      if (a < 1 || b < 1 || a > soNhom || b > soNhom) {
        return { ok: false, loi: `số ${a}-${b} nằm ngoài danh sách (1..${soNhom})` };
      }
      for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) ra.add(i - 1);
      continue;
    }
    if (!/^\d+$/.test(manh)) return { ok: false, loi: `"${manh}" không phải số` };
    const n = Number(manh);
    if (n < 1 || n > soNhom) return { ok: false, loi: `số ${n} nằm ngoài danh sách (1..${soNhom})` };
    ra.add(n - 1);
  }
  return { ok: true, chon: [...ra].sort((a, b) => a - b) };
}

/**
 * Dựng nội dung file cấu hình.
 *
 * 🔴 `dmChatId = userId`: với Zalo, hộp thư riêng giữa hai người mang chính
 * `user_id` của người kia. Điền sẵn để người dùng ⛔ không phải tự đi tìm —
 * đây đúng là chỗ người ta hay bỏ trống, mà bỏ trống thì luật chống rò chéo
 * ⛔ không có đích để gửi.
 *
 * ⚠️ GIỮ NGUYÊN mọi khoá khác của bản mẫu (kể cả khối `_ghi_chu`): bản mẫu là
 * tài liệu sống, ⛔ đừng đẻ ra một cấu trúc thứ hai ở đây.
 *
 * @param {{mau: any, toi: {userId: string, ten?: string|null},
 *          nhomChon: Array<{chatId: string, ten?: string|null}>}} p
 */
export function buildConfig(p) {
  const mau = p?.mau ?? {};
  const userId = String(p?.toi?.userId ?? '').trim();
  if (!userId) throw new Error('buildConfig: thiếu userId của chủ máy');

  return {
    ...mau,
    hosts: [{
      userId,
      ten: p?.toi?.ten ? String(p.toi.ten) : 'Chủ máy',
      dmChatId: userId,
    }],
    groups: (p?.nhomChon ?? []).map((g) => ({
      chatId: String(g.chatId),
      ten: g.ten ? String(g.ten) : `nhóm ${g.chatId}`,
      ghiLichSu: true,
      traLoiKhiTag: true,
    })),
  };
}

/**
 * Kiểm môi trường trước khi cài. Trả về danh sách VIỆC PHẢI LÀM, ⛔ không ném
 * lỗi — người không rành kỹ thuật cần biết *phải gõ gì tiếp*, ⛔ không cần
 * đọc stack trace.
 *
 * @param {{phienBanNode?: string, coNodeModules?: boolean}} p
 * @returns {{ok: boolean, van: Array<{loi: string, cach: string}>}}
 */
export function checkEnvironment(p = {}) {
  const van = [];

  const chuoi = String(p.phienBanNode ?? process.version).replace(/^v/, '');
  const chinh = Number(chuoi.split('.')[0]);
  if (!Number.isFinite(chinh) || chinh < 22) {
    van.push({
      loi: `Node phiên bản ${chuoi} là quá cũ (cần từ 22 trở lên)`,
      cach: 'Cài Node mới ở nodejs.org rồi chạy lại lệnh này.',
    });
  }

  if (p.coNodeModules === false) {
    van.push({
      loi: 'Chưa cài thư viện',
      cach: 'Gõ: npm install',
    });
  }

  return { ok: van.length === 0, van };
}
