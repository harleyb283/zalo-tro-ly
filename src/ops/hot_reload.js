/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ NẠP NÓNG CẤU HÌNH — đổi `groups` mà ⛔ KHÔNG phải restart daemon.
 *
 * 🔴 VÌ SAO CẦN: thêm một nhóm vào config xong phải restart thì restart giết
 *    luôn phiên Zalo đang khoẻ, giết sổ mở-phiên trong RAM, và cắt ngang mọi
 *    câu hỏi đang bay. Với luật "trợ lý được add vào nhóm mới thì tự cấu hình
 *    luôn" (host chốt 21/08/2026) thì restart mỗi lần là ⛔ không dùng được.
 *
 * 🔴 CHỈ MỘT SỐ TRƯỜNG ĐƯỢC NẠP NÓNG, và danh sách đó là CÓ CHỦ Ý:
 *
 *    ✅ `groups`        — mọi chỗ đọc nó đều gọi `findGroup(cauHinh, chatId)` tại
 *                         thời điểm có tin, ⛔ không ai giữ sẵn mảng cũ. Đã soi
 *                         từng chỗ: access.js:findGroup · normalize.js:loaiHoiThoai
 *                         · mcp/tools.js · bin/zalo-remind.js.
 *    ✅ `cauTrungTinh`  — chuỗi, đọc lúc cần.
 *    ✅ `kenhPhu` · `tranSoClient` · `nghiSauGio` — van chỉnh tay, đọc lúc cần.
 *
 *    ⛔ `hosts`     — `batDauNghe()` chụp `hostUserIds` MỘT LẦN lúc gắn listener
 *                     (zalo/listener.js:222). Gán đè ở đây thì `coTagHost` vẫn
 *                     tính theo danh sách CŨ ⇒ nạp "thành công" mà hành vi
 *                     không đổi. Im lặng sai còn tệ hơn không làm.
 *    ⛔ `duongDan`  — DB đã mở, pid-lock đã giữ theo đường dẫn cũ.
 *    ⛔ `thoiGian`  — `setInterval` đã hẹn xong, đổi số không dời được nhịp đã đặt.
 *    ⛔ `cheDo`     — vai daemon/client chốt lúc khởi động.
 *    ⛔ `tichHop`   — `soMoPhien` chụp `lenh` lúc dựng (index.js:1077).
 *    ⛔ `anTrangThai` — là lệnh gọi API cấp tài khoản, ⛔ không phải giá trị đọc.
 *
 *    ⇒ Trường khoá cứng mà ĐỔI trong file thì ⛔ KHÔNG áp, nhưng PHẢI nói ra:
 *      im lặng bỏ qua là để host tin rằng thứ mình vừa sửa đã có hiệu lực.
 *
 * 🔴 CONFIG HỎNG ⇒ GIỮ NGUYÊN BẢN ĐANG CHẠY. `readConfig` ném lỗi cho mọi
 *    cấu hình mở toang; ở đây bắt lỗi đó và ⛔ KHÔNG đụng vào bản đang chạy —
 *    một dấu phẩy thừa lúc 2 giờ sáng ⛔ không được phép làm câm trợ lý.
 *
 * ⚠️ Canh bằng `mtimeMs` chứ ⛔ không phải `fs.watch`: trình soạn thảo ghi file
 *    bằng rename (ghi file tạm rồi đổi tên) làm `fs.watch` mất luôn theo dõi,
 *    và mất kiểu đó ⛔ không có lỗi nào nổ ra — nó chỉ đơn giản là ⛔ không bao
 *    giờ báo nữa. Nhịp poll rẻ hơn nhiều so với một lớp im lặng chết.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';

/** @typedef {import('../types.d.ts').CauHinh} CauHinh */

/** Trường ĐƯỢC nạp nóng. Xem khối 🔴 đầu file trước khi thêm gì vào đây. */
export const HOT_RELOADABLE_FIELDS = Object.freeze([
  'groups',
  'cauTrungTinh',
  'kenhPhu',
  'tranSoClient',
  'nghiSauGio',
]);

/** Trường KHOÁ CỨNG: đổi thì phải restart, và phải BÁO cho host biết. */
export const RESTART_REQUIRED_FIELDS = Object.freeze([
  'hosts',
  'duongDan',
  'thoiGian',
  'cheDo',
  'tichHop',
  'anTrangThai',
]);

/**
 * Nhịp soi `mtime`. 3 giây: đủ nhanh để "add vào nhóm xong là chạy" cảm giác
 * tức thì, đủ chậm để một `statSync` mỗi nhịp là con số ⛔ không đáng nhắc tới.
 */
export const HOT_RELOAD_TICK_MS = 3000;

const _log = (s) => process.stderr.write(`[hot_reload] ${s}\n`);

/** Rút một nhóm về đúng 4 trường có nghĩa, để so sánh ⛔ không dính rác. */
function _hinhDangNhom(g) {
  return {
    chatId: String(g?.chatId ?? ''),
    ten: typeof g?.ten === 'string' ? g.ten : '',
    ghiLichSu: g?.ghiLichSu !== false,
    traLoiKhiTag: g?.traLoiKhiTag === true,
  };
}

/**
 * So hai danh sách nhóm.
 *
 * ⚠️ Khoá theo `chatId`, ⛔ KHÔNG theo vị trí trong mảng: sắp xếp lại config
 * ⛔ không phải là thay đổi, mà so theo vị trí thì nó báo "đổi hết".
 *
 * @param {Array<any>} [cu]
 * @param {Array<any>} [moi]
 * @returns {{them: any[], bo: any[], doi: Array<{chatId: string, truoc: any, sau: any}>}}
 */
export function diffGroups(cu = [], moi = []) {
  const mCu = new Map((cu ?? []).map((g) => [String(g?.chatId ?? ''), _hinhDangNhom(g)]));
  const mMoi = new Map((moi ?? []).map((g) => [String(g?.chatId ?? ''), _hinhDangNhom(g)]));

  const them = [];
  const doi = [];
  for (const [id, sau] of mMoi) {
    const truoc = mCu.get(id);
    if (!truoc) { them.push(sau); continue; }
    if (JSON.stringify(truoc) !== JSON.stringify(sau)) doi.push({ chatId: id, truoc, sau });
  }
  const bo = [];
  for (const [id, truoc] of mCu) if (!mMoi.has(id)) bo.push(truoc);

  return { them, bo, doi };
}

/**
 * Áp bản cấu hình mới lên CHÍNH object đang chạy.
 *
 * 🔴 GÁN ĐÈ TỪNG TRƯỜNG, ⛔ TUYỆT ĐỐI KHÔNG trả về object mới: `cauHinh` đã bị
 * hàng chục closure trong `index.js` giữ tham chiếu (`findGroup(cauHinh, …)`,
 * `baoHost(cauHinh, …)`, watchdog, tool…). Thay object là mọi closure đó vẫn
 * ôm bản CŨ, tức nạp nóng "chạy" mà ⛔ không có gì thay đổi.
 *
 * @param {CauHinh|any} dich  cấu hình ĐANG CHẠY — bị sửa tại chỗ
 * @param {CauHinh|any} moi   cấu hình vừa đọc + validate xong
 * @returns {{thayDoi: string[], khoaCungDoi: string[], nhom: ReturnType<typeof diffGroups>}}
 */
export function applyHotReload(dich, moi) {
  if (!dich || typeof dich !== 'object') {
    throw new Error('applyHotReload: `dich` phải là object cấu hình đang chạy');
  }
  if (!moi || typeof moi !== 'object') {
    throw new Error('applyHotReload: `moi` phải là object cấu hình vừa đọc');
  }

  const nhom = diffGroups(dich.groups ?? [], moi.groups ?? []);

  const thayDoi = [];
  for (const truong of HOT_RELOADABLE_FIELDS) {
    if (JSON.stringify(dich[truong] ?? null) === JSON.stringify(moi[truong] ?? null)) continue;
    dich[truong] = moi[truong];
    thayDoi.push(truong);
  }

  // ⚠️ Tính SAU khi áp: các trường khoá cứng ⛔ không nằm trong HOT_RELOADABLE_FIELDS
  // nên vòng trên ⛔ không đụng tới chúng — `dich` vẫn giữ giá trị đang chạy,
  // đúng thứ cần đem ra so.
  const khoaCungDoi = RESTART_REQUIRED_FIELDS.filter(
    (t) => JSON.stringify(dich[t] ?? null) !== JSON.stringify(moi[t] ?? null),
  );

  return { thayDoi, khoaCungDoi, nhom };
}

/**
 * Dựng câu báo cho host. Trả `null` khi ⛔ không có gì đáng nói — ⛔ không báo
 * "đã nạp lại, không có gì đổi", vì cảnh báo phiền là cảnh báo bị bỏ qua.
 *
 * @param {ReturnType<typeof applyHotReload>} kq
 * @returns {string|null}
 */
export function describeChanges(kq) {
  if (!kq) return null;
  const dong = [];

  for (const g of kq.nhom.them) {
    dong.push(`+ nhóm "${g.ten}" (${g.chatId})`
      + `${g.ghiLichSu ? '' : ' · KHÔNG ghi lịch sử'}`
      + `${g.traLoiKhiTag ? '' : ' · KHÔNG trả lời khi tag'}`);
  }
  for (const g of kq.nhom.bo) dong.push(`− bỏ nhóm "${g.ten}" (${g.chatId})`);
  for (const d of kq.nhom.doi) {
    const doi = [];
    if (d.truoc.ten !== d.sau.ten) doi.push(`tên "${d.truoc.ten}" -> "${d.sau.ten}"`);
    if (d.truoc.ghiLichSu !== d.sau.ghiLichSu) doi.push(`ghiLichSu -> ${d.sau.ghiLichSu}`);
    if (d.truoc.traLoiKhiTag !== d.sau.traLoiKhiTag) doi.push(`traLoiKhiTag -> ${d.sau.traLoiKhiTag}`);
    dong.push(`~ nhóm ${d.chatId}: ${doi.join(', ')}`);
  }

  const khac = kq.thayDoi.filter((t) => t !== 'groups');
  if (khac.length) dong.push(`~ đổi: ${khac.join(', ')}`);

  if (kq.khoaCungDoi.length) {
    dong.push(
      `⚠️ ${kq.khoaCungDoi.join(', ')} có đổi trong file nhưng KHÔNG nạp nóng được `
      + '— phải khởi động lại daemon thì mới có hiệu lực.',
    );
  }

  if (!dong.length) return null;
  return `♻️ Nạp nóng cấu hình:\n${dong.join('\n')}`;
}

/**
 * Bộ canh file config. Trả về `{kiemNgay, dung}` — `kiemNgay()` tách riêng để
 * bài test gọi thẳng, ⛔ không phải ngồi chờ đồng hồ.
 *
 * @param {{
 *   duongDan: string,
 *   dich: CauHinh|any,
 *   readConfig: (d?: string) => any,
 *   log?: (s: string) => void,
 *   baoHost?: (s: string) => any,
 *   nhipMs?: number,
 *   tuChay?: boolean,
 * }} p
 */
export function createHotReloader(p) {
  const duongDan = String(p?.duongDan ?? '');
  const dich = p?.dich;
  const doc = p?.readConfig;
  if (!duongDan) throw new Error('createHotReloader: thiếu `duongDan` file cấu hình');
  if (!dich || typeof dich !== 'object') throw new Error('createHotReloader: thiếu `dich`');
  if (typeof doc !== 'function') throw new Error('createHotReloader: thiếu `readConfig`');

  const log = typeof p.log === 'function' ? p.log : _log;
  const baoHost = typeof p.baoHost === 'function' ? p.baoHost : null;
  const nhipMs = Number(p.nhipMs) > 0 ? Number(p.nhipMs) : HOT_RELOAD_TICK_MS;

  const _mtime = () => {
    try { return fs.statSync(duongDan).mtimeMs; } catch { return null; }
  };

  let mocCuoi = _mtime();
  // 🔴 Nhớ lỗi ĐÃ BÁO để ⛔ không bắn lại mỗi 3 giây khi file hỏng: file hỏng
  // thì `mtime` đứng yên, nhưng người đang sửa dở sẽ ghi liên tục. Báo một lần
  // cho mỗi thông điệp lỗi KHÁC NHAU.
  let loiDaBao = null;
  let dangChay = false;

  /** @returns {ReturnType<typeof applyHotReload>|null} */
  const kiemNgay = (ep = false) => {
    if (dangChay) return null;
    dangChay = true;
    try {
      const moc = _mtime();
      if (moc === null) {
        // File biến mất: ⛔ KHÔNG coi là "config rỗng" (rỗng = mở toang).
        // Giữ nguyên bản đang chạy và kêu đúng một lần.
        const msg = `không thấy file cấu hình: ${duongDan}`;
        if (loiDaBao !== msg) {
          loiDaBao = msg;
          log(`${msg} -> GIỮ NGUYÊN bản đang chạy`);
          baoHost?.(`⚠️ Nạp nóng: ${msg}. Em giữ nguyên cấu hình đang chạy.`);
        }
        return null;
      }
      if (!ep && moc === mocCuoi) return null;
      mocCuoi = moc;

      let moi;
      try {
        moi = doc(duongDan);
      } catch (e) {
        const msg = String(e?.message ?? e).split('\n')[0];
        if (loiDaBao !== msg) {
          loiDaBao = msg;
          log(`config KHÔNG hợp lệ -> GIỮ NGUYÊN bản đang chạy: ${msg}`);
          baoHost?.(
            `⚠️ Nạp nóng cấu hình THẤT BẠI — em GIỮ NGUYÊN bản đang chạy:\n${msg}\n`
            + 'Sửa lại file là em tự nạp, không cần restart.',
          );
        }
        return null;
      }
      loiDaBao = null;

      const kq = applyHotReload(dich, moi);
      const mo = describeChanges(kq);
      if (mo) {
        log(mo.replace(/\n/g, ' · '));
        baoHost?.(mo);
      }
      return kq;
    } finally {
      dangChay = false;
    }
  };

  let hen = null;
  if (p.tuChay !== false) {
    hen = setInterval(() => {
      try { kiemNgay(); } catch (e) { log(`nhịp soi lỗi (đã nuốt): ${e?.message ?? e}`); }
    }, nhipMs);
    // ⛔ Không giữ tiến trình sống chỉ vì cái đồng hồ này.
    hen.unref?.();
  }

  return {
    kiemNgay,
    dung: () => { if (hen) clearInterval(hen); hen = null; },
  };
}
