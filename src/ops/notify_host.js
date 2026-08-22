/**
 * ═══════════════════════════════════════════════════════════════════════
 * G6 — ĐƯỜNG BÁO HOST. Ba tầng, thử theo thứ tự, tầng nào chạy được thì DỪNG.
 *
 * 🔴 KHÔNG PHỤ THUỘC TELEGRAM — và không phụ thuộc BẤT KỲ kênh cụ thể nào.
 *    Pack này chia sẻ qua git cho người khác; một kênh nhắn tin cụ thể luôn là
 *    thứ riêng của người setup, người clone về không chắc có. Chỗ duy nhất "biết" một kênh
 *    cụ thể là `cauHinh.notifyCommand` — một chuỗi lệnh shell do CHÍNH NGƯỜI
 *    SETUP điền. Trong file này không có tên kênh nào được viết cứng.
 *
 * ─── TẦNG 1 — DM qua CHÍNH ZALO ────────────────────────────────────────
 *   ⭐ Nghe ngược đời nhưng đây là tầng GIÁ TRỊ NHẤT: bệnh phổ biến nhất của
 *   zca-js là **chết câm** — listener ngừng nhận tin trong khi đường GỬI vẫn
 *   sống. Đúng trong ca đó, bot vẫn tự nhắn được cho host. Rẻ nhất, không cấu
 *   hình gì, ai clone về cũng có sẵn.
 *   ⚠️ Tầng này CHỈ dùng được khi chỗ gọi đã có sẵn `api` (tức là tiến trình
 *   daemon đang chạy). Xem cảnh báo lớn ở `bin/zalo-health.js`: script cron
 *   TUYỆT ĐỐI không tự đăng nhập Zalo chỉ để báo động.
 *
 * ─── TẦNG 2 — kênh do người setup tự cắm + thông báo hệ điều hành ──────
 *   Dùng khi tầng 1 chết (cookie hỏng ⇒ không gửi Zalo được nữa).
 *   a) `cauHinh.notifyCommand` — lệnh shell, nhận JSON qua **stdin**.
 *      Người setup cắm gì tuỳ họ: ntfy, webhook công ty, mail, Telegram
 *      của riêng họ… Pack không cần biết.
 *   b) `osascript -e 'display notification'` — CÓ SẴN trên macOS, không cài gì.
 *      ⚠️ Chỉ hiện khi có phiên đồ hoạ đang đăng nhập. Chạy trong cron/launchd
 *      nền thì có thể im lặng không hiện gì mà vẫn exit 0 ⇒ KHÔNG được coi
 *      thành công của lệnh này là bằng chứng host đã thấy.
 *
 * ─── TẦNG 3 — luôn luôn có ─────────────────────────────────────────────
 *   Ghi stderr + để lại `health.json` cho người xem tay.
 *   ⚠️ Tầng 3 KHÔNG phải "phương án cuối" mà là **nền**: nó chạy TRƯỚC, mọi
 *   lần, kể cả khi tầng 1 thành công. Một đường báo mà chính nó im lặng khi
 *   hỏng thì vô dụng.
 *
 * ⚠️ Mọi log đi stderr — stdout là kênh giao thức MCP.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { spawn } from 'node:child_process';

import { safeLogText, redact } from '../lib/redact.js';
import { hostDmChatId, hostUserIds } from '../policy/access.js';

/** @typedef {import('../types.d.ts').CauHinh} CauHinh */

/** Trần thời gian cho `notifyCommand` — lệnh của người lạ, không được treo mãi. */
export const HAN_LENH_MS = 15_000;

function log(...phan) {
  process.stderr.write(`[ops/notify_host] ${phan.join(' ')}\n`);
}

/**
 * DM của host đầu tiên trong allowlist.
 * Nhiều host thì báo cho người ĐẦU TIÊN — cố ý không rải cho tất cả: đây là
 * cảnh báo vận hành, không phải thông báo cộng đồng.
 *
 * @param {CauHinh} cauHinh
 * @returns {string|null}
 */
export function dmHostChinh(cauHinh) {
  const ds = hostUserIds(cauHinh) ?? [];
  for (const uid of ds) {
    const dm = hostDmChatId(cauHinh, uid);
    if (dm) return dm;
  }
  return null;
}

/**
 * Chạy `notifyCommand`, truyền JSON qua stdin.
 *
 * ⚠️ CỐ Ý chạy qua shell (`sh -c`): người setup cần viết được lệnh có ống
 * (`| jq`), biến môi trường, chuỗi nối. Đây KHÔNG phải lỗ hổng tiêm lệnh —
 * chuỗi này nằm trong file cấu hình của chính máy họ, và ai sửa được file đó
 * thì đã sửa được cả mã nguồn pack rồi.
 * ⚠️ Nhưng `thongDiep` thì KHÔNG BAO GIỜ được nối vào chuỗi lệnh: nó đến từ
 * nội dung lỗi/tin nhắn, tức là dữ liệu người ngoài chi phối được. Nó chỉ đi
 * qua **stdin**.
 *
 * @param {string} lenh
 * @param {object} duLieu  sẽ được JSON hoá và bơm vào stdin
 * @param {number} [hanMs]
 * @returns {Promise<{thanhCong: boolean, ma: number|null, lyDo?: string}>}
 */
export function chayNotifyCommand(lenh, duLieu, hanMs = HAN_LENH_MS) {
  return new Promise((giai) => {
    let xong = false;
    /** @type {any} */
    let con;
    const hen = setTimeout(() => {
      if (xong) return;
      xong = true;
      try { con?.kill('SIGKILL'); } catch { /* đã chết rồi thì thôi */ }
      log(`⚠️ notifyCommand quá ${hanMs}ms -> giết. Lệnh treo không được giữ daemon lại.`);
      giai({ thanhCong: false, ma: null, lyDo: 'quá hạn' });
    }, hanMs);

    try {
      con = spawn('sh', ['-c', lenh], { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
      clearTimeout(hen);
      return giai({ thanhCong: false, ma: null, lyDo: safeLogText(e) });
    }

    let loi = '';
    con.stderr?.on('data', (b) => { loi += String(b).slice(0, 500); });

    con.on('error', (e) => {
      if (xong) return;
      xong = true;
      clearTimeout(hen);
      giai({ thanhCong: false, ma: null, lyDo: safeLogText(e) });
    });

    con.on('close', (ma) => {
      if (xong) return;
      xong = true;
      clearTimeout(hen);
      if (ma !== 0) log(`⚠️ notifyCommand thoát mã ${ma}${loi ? ` — ${loi.trim()}` : ''}`);
      giai({ thanhCong: ma === 0, ma, lyDo: loi.trim() || undefined });
    });

    try {
      con.stdin.write(JSON.stringify(duLieu));
      con.stdin.end();
    } catch (e) {
      log(`⚠️ không bơm được JSON vào stdin của notifyCommand: ${safeLogText(e)}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 CỔNG CHẶN TÁC DỤNG PHỤ RA NGOÀI TIẾN TRÌNH — thêm 20/08/2026
//
// SỰ CỐ THẬT: bộ test gọi `thongBaoHeDieuHanh()` chạy THẬT, nên mỗi lần bất kỳ
// pane nào chạy `node --test` là macOS bắn popup thật vào mặt anh. Hôm đó 4
// pane chạy song song ⇒ 5-6 popup liên tiếp với đúng những chữ đáng sợ nhất
// trong bộ test: "cookie chết rồi", "listener chết", "lỗi Cookie: zpsid=…".
// Anh tưởng trợ lý hỏng thật, trong khi Zalo readyState=OPEN, pid sống.
//
// 🔴 HẬU QUẢ NẶNG HƠN CẢ SỰ PHIỀN: cảnh báo THẬT và cảnh báo TỪ TEST trông y
// hệt nhau ⇒ đến hôm cookie chết thật, anh sẽ bỏ qua vì tưởng lại là test —
// đúng lúc cần hành động nhất. Đây là cơ chế "sói đến rồi" tự cài vào hệ.
//
// CÁCH CHẶN — MẶC ĐỊNH ĐÓNG, KHÔNG THỂ QUÊN:
// Cổng tự nhận biết mình đang chạy trong test, nên **bài test viết sau này
// không cần biết gì về nó cũng vẫn bị chặn**. ⛔ Cố ý KHÔNG sửa câu chữ trong
// từng bài test — làm vậy thì bài thứ 6 lại lặp lại y hệt.
// ═══════════════════════════════════════════════════════════════════════

/** Kịch bản AppleScript. Tách hằng số để test soi được mà không cần chạy. */
export const KICH_BAN_OSASCRIPT =
  'on run {t, n}\n display notification n with title t\nend run';

/**
 * Đang chạy trong bộ test hay không.
 *
 * Hai tín hiệu, cố ý KHÔNG dựa vào biến do người viết test tự đặt:
 *  1. `NODE_TEST_CONTEXT` — do **chính Node đặt** khi chạy `node --test`
 *     (đo thật trên v26.7.0: `child-v8`; chạy thường thì `undefined`).
 *     Đây là thứ khiến bài test mới KHÔNG THỂ QUÊN: không ai phải nhớ gì cả.
 *  2. Điểm vào là một file `*.test.js` — bắt ca chạy trực tiếp
 *     `node test/ops.test.js` (không qua `--test`), lúc đó tín hiệu 1 vắng mặt.
 *
 * ⚠️ `ZTL_CHO_PHEP_THONG_BAO_THAT=1` là cửa thoát dành cho NGƯỜI muốn tự mắt
 * kiểm popup thật. Bộ test TUYỆT ĐỐI không được đặt biến này (có bài canh).
 */
export function dangChayTest() {
  if (process.env.ZTL_CHO_PHEP_THONG_BAO_THAT === '1') return false;
  if (process.env.NODE_TEST_CONTEXT !== undefined) return true;
  const vao = process.argv[1] ?? '';
  return /\.test\.(m?js|cjs)$/.test(vao) || /[\\/]test[\\/]/.test(vao);
}

/**
 * Nhật ký các thông báo BỊ CHẶN — để test kiểm được "nó ĐỊNH gọi gì" thay vì
 * để nó gọi thật. Vòng đệm nhỏ, không phình.
 * @type {Array<{tieuDe: string, noiDung: string, lenh: string, doiSo: string[]}>}
 */
const _daChan = [];
const TRAN_NHAT_KY = 50;

/** Danh sách thông báo đã bị chặn (mới nhất ở cuối). */
export function layThongBaoDaChan() {
  return _daChan.slice();
}

/** Xoá nhật ký chặn (test gọi giữa các bài). */
export function xoaNhatKyChan() {
  _daChan.length = 0;
}

/**
 * Lệnh + đối số sẽ dùng để bắn thông báo. HÀM THUẦN — không chạy gì.
 *
 * Tách ra để bài test kiểm được ĐÚNG thứ đáng kiểm: nội dung đi qua ARGV chứ
 * KHÔNG nối vào chuỗi AppleScript (nối chuỗi thì một dấu nháy trong tin nhắn
 * là phá cú pháp, tệ hơn là chạy được AppleScript ngoài ý muốn).
 *
 * @param {string} tieuDe
 * @param {string} noiDung
 * @returns {{lenh: string, doiSo: string[]}}
 */
export function layLenhOsascript(tieuDe, noiDung) {
  return { lenh: 'osascript', doiSo: ['-e', KICH_BAN_OSASCRIPT, String(tieuDe), String(noiDung)] };
}

/**
 * Thông báo của hệ điều hành. Chỉ macOS mới có sẵn `osascript`.
 *
 * 🔴 Trong bộ test: KHÔNG bắn gì, chỉ ghi ý định vào `layThongBaoDaChan()` rồi
 * trả `false`. `false` ở đây nghĩa "không có popup nào tới người dùng" — đúng
 * sự thật, và đúng cái mà `baoHost()` cần biết để không tự khai là đã báo được.
 *
 * @param {string} tieuDe
 * @param {string} noiDung
 * @returns {Promise<boolean>}
 */
export function thongBaoHeDieuHanh(tieuDe, noiDung) {
  const { lenh, doiSo } = layLenhOsascript(tieuDe, noiDung);

  if (dangChayTest()) {
    if (_daChan.length >= TRAN_NHAT_KY) _daChan.shift();
    _daChan.push({ tieuDe: String(tieuDe), noiDung: String(noiDung), lenh, doiSo });
    log(`[CHẶN] đang chạy test -> KHÔNG bắn thông báo hệ điều hành: ${tieuDe}`);
    return Promise.resolve(false);
  }

  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((giai) => {
    try {
      const con = spawn(lenh, doiSo, { stdio: 'ignore' });
      con.on('error', () => giai(false));
      con.on('close', (ma) => giai(ma === 0));
    } catch {
      giai(false);
    }
  });
}

/**
 * Tiêu đề có dấu THẬT: giờ hiện tại. Chạy trong test (qua cửa thoát) thì đóng
 * dấu ngược lại — một thông báo giả lập TUYỆT ĐỐI không được phép trông như thật.
 * @param {string} tieuDe
 */
export function dongDauThat(tieuDe) {
  const gio = new Date().toTimeString().slice(0, 5);
  if (process.env.NODE_TEST_CONTEXT !== undefined) return `[GIẢ LẬP] ${tieuDe}`;
  return `⚠️ ${tieuDe} · ${gio}`;
}

/**
 * Thân thông báo + dòng kiểm chứng. `pid` cho phép anh đối chiếu với file pid
 * của daemon — cảnh báo thật thì hai số đó khớp nhau.
 * @param {string} sach  thông điệp ĐÃ redact
 */
export function thanThongBao(sach) {
  const luc = new Date().toTimeString().slice(0, 8);
  return `${String(sach).slice(0, 160)}\n[trợ lý Zalo · pid ${process.pid} · ${luc}]`;
}

/**
 * Báo cho host. Trả về TẦNG NÀO đã ăn.
 *
 * @param {CauHinh} cauHinh
 * @param {string} thongDiep
 * @param {{api?: any, trangThai?: import('../types.d.ts').TrangThaiSucKhoe|null,
 *          tieuDe?: string, boTang1?: boolean}} [phuThuoc]
 *        `boTang1: true` ⇒ KHÔNG thử gửi Zalo. Bắt buộc dùng ở tiến trình cron
 *        (xem `bin/zalo-health.js`).
 * @returns {Promise<{tang: number, thanhCong: boolean, chiTiet: string[]}>}
 */
export async function baoHost(cauHinh, thongDiep, phuThuoc = {}) {
  const chiTiet = [];
  const tieuDe = phuThuoc.tieuDe || 'Trợ lý Zalo';
  // redact ngay đầu vào, không tin chỗ gọi: thông điệp hay được ghép từ lỗi
  // của thư viện HTTP, mà stack của nó có header Cookie.
  const sach = String(redact(thongDiep ?? ''));

  // ── TẦNG 3 chạy TRƯỚC và LUÔN chạy (nền, không phải phương án cuối) ──
  log(`BÁO HOST: ${sach}`);
  chiTiet.push('tầng 3: đã ghi log');

  // ── TẦNG 1 — DM qua chính Zalo ──────────────────────────────────────
  if (!phuThuoc.boTang1 && phuThuoc.api) {
    const dm = dmHostChinh(cauHinh);
    if (!dm) {
      chiTiet.push('tầng 1 bỏ qua: không có hosts[].dmChatId trong config');
    } else {
      try {
        // Nạp muộn: `bin/zalo-health.js` không bao giờ đi vào nhánh này, và
        // nó cũng không nên kéo theo cả zca-js chỉ để đọc một file JSON.
        const { guiDmHost } = await import('../zalo/send.js');
        // 🔴 v11 — `ghiLai` PHẢI đi kèm. Thiếu nó thì tin trợ lý vừa gửi ⛔
        // KHÔNG vào kho: đọc lại lịch sử chỉ thấy câu anh hỏi, ⛔ không thấy
        // câu em đáp — và cảnh báo (thứ đáng tra cứu nhất khi có sự cố) là
        // loại tin ⛔ mất trắng nhiều nhất, vì nó đi thẳng đường này.
        // ⚠️ Chỗ gọi ⛔ không truyền `ghiLai` thì `send.js` vẫn kêu lên stderr
        // như cũ — ⛔ không im lặng nuốt.
        await guiDmHost(phuThuoc.api, dm, `[${tieuDe}] ${sach}`, {
          ghiLai: phuThuoc.ghiLai,
          uidTroLy: phuThuoc.uidTroLy ?? null,
        });
        chiTiet.push('tầng 1: đã gửi DM Zalo cho host');
        return { tang: 1, thanhCong: true, chiTiet };
      } catch (e) {
        // Rất có thể chính là ca cookie chết — nên mới phải báo động.
        // Ghi lại rồi ĐI TIẾP xuống tầng 2, không dừng.
        chiTiet.push(`tầng 1 hỏng: ${safeLogText(e)}`);
        log(`⚠️ tầng 1 (DM Zalo) hỏng -> xuống tầng 2: ${safeLogText(e)}`);
      }
    }
  } else {
    chiTiet.push(phuThuoc.boTang1
      ? 'tầng 1 bỏ qua: bị tắt (tiến trình cron KHÔNG được tự đăng nhập Zalo)'
      : 'tầng 1 bỏ qua: chỗ gọi không có sẵn phiên Zalo');
  }

  // ══ TẦNG 1b — XẾP HÀNG cho daemon gửi hộ. DÀNH RIÊNG CHO CLIENT ══════
  //
  // 🔴 VÌ SAO PHẢI CÓ: ở chế độ tách, thứ phát hiện ra sự cố là CLIENT — nó
  // là bên quét hàng đợi, nên nó là bên biết "3 câu của anh vừa quá hạn".
  // Nhưng client CỐ Ý ⛔ không có `api` Zalo (nó tự nhắn là mở lại đúng cái
  // cửa vừa đóng), và `notifyCommand` mặc định `null` ⇒ báo động của nó
  // ⛔ KHÔNG có đường nào ra tới anh: nó chết trong log.
  //
  // ⛔ ĐÃ XẢY RA THẬT 21/08/2026: ba câu (12:47, 13:42, 14:29) quá hạn, client
  // phát hiện đủ cả ba, và anh ⛔ KHÔNG nhận được một chữ nào. Cảnh báo không
  // tới nơi thì đúng bằng không có cảnh báo.
  //
  // ⇒ Client đưa vào đây một hàm xếp hàng; tin đi đường OUTBOX, daemon rút ra
  // gửi. ⚠️ Đây là ĐÚNG con đường `tra_loi` của client đang đi — ⛔ không mở
  // thêm cửa gửi nào, ⛔ không có kết nối Zalo thứ hai.
  if (!phuThuoc.boTang1 && !phuThuoc.api && typeof phuThuoc.xepHangDm === 'function') {
    const dm = dmHostChinh(cauHinh);
    if (!dm) {
      chiTiet.push('tầng 1b bỏ qua: không có hosts[].dmChatId trong config');
    } else {
      try {
        await phuThuoc.xepHangDm(dm, `[${tieuDe}] ${sach}`);
        chiTiet.push('tầng 1b: đã XẾP HÀNG DM để daemon gửi');
        return { tang: 1, thanhCong: true, chiTiet };
      } catch (e) {
        chiTiet.push(`tầng 1b hỏng: ${safeLogText(e)}`);
        log(`⚠️ tầng 1b (xếp hàng DM) hỏng -> xuống tầng 2: ${safeLogText(e)}`);
      }
    }
  }

  // ── TẦNG 2a — kênh do người setup tự cắm ────────────────────────────
  let an2 = false;
  if (cauHinh?.notifyCommand) {
    const kq = await chayNotifyCommand(cauHinh.notifyCommand, {
      tieuDe,
      thongDiep: sach,
      trangThai: phuThuoc.trangThai ?? null,
      luc: new Date().toISOString(),
    });
    chiTiet.push(kq.thanhCong
      ? 'tầng 2a: notifyCommand chạy xong (mã 0)'
      : `tầng 2a hỏng: mã ${kq.ma}${kq.lyDo ? ` — ${kq.lyDo}` : ''}`);
    an2 = an2 || kq.thanhCong;
  } else {
    chiTiet.push('tầng 2a bỏ qua: config.notifyCommand = null');
  }

  // ── TẦNG 2b — thông báo hệ điều hành ────────────────────────────────
  // Chạy KỂ CẢ khi 2a đã thành công: hai đường này nhắm vào hai hoàn cảnh
  // khác nhau (đang ngồi trước máy vs đang ở xa), và chúng rẻ.
  //
  // 🔴 ĐÓNG DẤU "THẬT" — xem lý do ở khối CỔNG CHẶN đầu file.
  // Cơ chế chính bảo đảm popup là thật đã nằm ở cổng chặn (test không bắn được
  // popup nữa, nên thứ gì hiện lên màn hình đều là thật). Dấu này là lớp thứ
  // hai, để anh KIỂM CHỨNG được chứ không phải chỉ tin: `pid` phải khớp
  // `~/.zalo-tro-ly/zalo-tro-ly.pid`, và giờ phải là GIỜ NÀY.
  const osOk = await thongBaoHeDieuHanh(dongDauThat(tieuDe), thanThongBao(sach));
  chiTiet.push(osOk
    ? 'tầng 2b: đã bắn thông báo hệ điều hành (KHÔNG bảo đảm host nhìn thấy)'
    : `tầng 2b bỏ qua/hỏng (nền tảng ${process.platform})`);
  an2 = an2 || osOk;

  if (an2) return { tang: 2, thanhCong: true, chiTiet };

  // ── Chỉ còn tầng 3 ──────────────────────────────────────────────────
  log('⚠️ KHÔNG có đường báo nào ăn — chỉ còn log + health.json. '
    + 'Cắm config.notifyCommand để có cảnh báo thật.');
  chiTiet.push('tầng 1 và 2 đều không ăn');
  return { tang: 3, thanhCong: false, chiTiet };
}
