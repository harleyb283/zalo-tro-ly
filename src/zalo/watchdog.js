/**
 * ═══════════════════════════════════════════════════════════════════════
 * G8 — WATCHDOG 2 TẦNG. CHỦ SỞ HỮU: G8. Gói khác KHÔNG sửa file này.
 *
 * 🔴 BA TRẠNG THÁI, KHÔNG PHẢI HAI. `isListenerAlive()` trả true | false | null.
 *      · null bị nhồi thành "chết" ⇒ đăng nhập lại VÔ HẠN
 *      · null bị nhồi thành "sống" ⇒ watchdog chết CÂM đúng lúc cần nhất
 *    ⇒ null PHẢI ánh xạ sang TRANG_THAI_SUC_KHOE.KHONG_BIET.
 *
 * ═══ 🔴 ĐÍNH CHÍNH HỢP ĐỒNG G0 — `_closeTimer` KHÔNG DÙNG ĐƯỢC ═══
 * G0 chốt Tầng 1 = đọc `api.listener.ws._closeTimer`. ĐO THẬT trên bản đang
 * cài (zca-js@2.1.2 + ws), chuỗi bằng chứng:
 *
 *  1. `grep -rl _closeTimer node_modules/` ⇒ chỉ trúng `ws/lib/websocket.js`.
 *     Nó là thuộc tính riêng của thư viện **ws**, KHÔNG phải của zca-js.
 *  2. Trong `ws`: khởi tạo `this._closeTimer = null` (dòng 62) và CHỈ được
 *     gán khi bắt đầu bắt tay đóng (`setCloseTimer`, dòng 1310).
 *     ⇒ Socket đang KHOẺ thì `_closeTimer === null`.
 *     ⇒ Đọc theo đúng chữ hợp đồng ("null = không đọc được = KHÔNG BIẾT") thì
 *       một socket khoẻ mạnh bị khai là KHÔNG BIẾT **vĩnh viễn**, và Tầng 1
 *       mù hoàn toàn. Đúng kiểu hỏng câm mà chính điều khoản đó sinh ra để tránh.
 *  3. Tệ hơn: lúc đóng xong, `ws` gọi `clearTimeout(websocket._closeTimer)`
 *     (dòng 1354) nhưng KHÔNG gán lại `null` ⇒ sau khi socket chết hẳn, thuộc
 *     tính này vẫn giữ một đối tượng Timeout đã huỷ, tức KHÁC null.
 *     ⇒ Suy "khác null = đang đóng" cũng sai nốt. Cờ này đảo chiều cả hai phía.
 *
 * ⇒ Tầng 1 nay đọc **`api.listener.ws.readyState`** — API CÔNG KHAI, chuẩn
 *   WebSocket, chính `zca-js` cũng dùng (`if (ws.readyState !== WebSocket.CLOSED)`
 *   trong `listen.js`). Giá trị đã đo: CONNECTING 0 · OPEN 1 · CLOSING 2 · CLOSED 3.
 *   `_closeTimer` giữ lại làm ĐƯỜNG LÙI (phòng bản zca-js khác có thật), nhưng
 *   KHÔNG còn là nguồn chính. ĐÃ BÁO ROUTER.
 *
 * ⚠️ `ws` khai `private` trong `Listener` (.d.ts) — đó là private của
 *    TypeScript, lúc chạy vẫn đọc được. Vẫn là nội bộ thư viện ⇒ bọc try/catch
 *    và mọi đường hỏng đều đổ về `null`, không đổ về `false`.
 *
 * ═══ TẦNG 3 (thêm) — sự kiện CÔNG KHAI ═══
 * G2 đọc `.d.ts` và xác minh `Listener` phát 16 sự kiện, có sẵn `closed` /
 * `error` / `connected`. Đây là tín hiệu đáng tin hơn hẳn việc dò thuộc tính
 * nội bộ, nên watchdog lắng nghe thêm và coi `closed` là bằng chứng CHẾT trực
 * tiếp. Thêm chứ không thay: `isListenerAlive()` vẫn giữ đúng hợp đồng 3 trạng thái.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi log đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  BACKOFF_NOI_LAI_MS,
  GIOI_HAN,
  TRANG_THAI_SUC_KHOE,
} from '../lib/hang_so.js';
import { safeLogText } from '../lib/redact.js';
import { lastEventAt } from './listener.js';
import { classifyLoginError } from './session.js';

/** @typedef {import('../types.d.ts').CauHinh} CauHinh */
/** @typedef {import('../types.d.ts').TrangThaiSucKhoe} TrangThaiSucKhoe */

/** Giá trị chuẩn của WebSocket.readyState (đo trên gói `ws` đang cài). */
export const WS = Object.freeze({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

/** Số chu kỳ liên tiếp phải cùng dấu hiệu thì Tầng 2 mới dám kết luận. */
export const SUSPICION_CYCLES = 2;

function _log(msg) {
  process.stderr.write(`[zalo/watchdog] ${msg}\n`);
}

/**
 * Đọc trạng thái websocket, kèm LÝ DO — để log nói được vì sao, thay vì chỉ
 * ném ra một chữ `null` trơ trọi.
 *
 * @param {any} api
 * @returns {{song: boolean|null, lyDo: string}}
 */
export function readWsState(api) {
  try {
    const bo = api?.listener;
    if (!bo || typeof bo !== 'object') {
      return { song: null, lyDo: 'không có api.listener' };
    }
    const ws = bo.ws;
    if (ws === null || ws === undefined) {
      // 5 phút sau khi start() mà vẫn chưa có socket thì không còn cách hiểu
      // nào khác ngoài "đã dừng" — `zca-js` chỉ gán `this.ws = null` ở
      // constructor và ở `stop()`.
      return { song: false, lyDo: 'api.listener.ws = null (listener đã dừng)' };
    }
    const rs = ws.readyState;
    if (typeof rs !== 'number') {
      // 🔴 CỐ Ý KHÔNG rơi về `_closeTimer` làm đường lùi. Nó SAI CẢ HAI CHIỀU
      // (xem khối ĐÍNH CHÍNH đầu file): socket khoẻ thì nó `null`, socket
      // chết hẳn thì nó giữ một Timeout đã huỷ nên KHÁC null. Một cờ đọc
      // hướng nào cũng ra kết luận ngược thì thà nói KHÔNG BIẾT.
      // Không biết ⇒ đứng yên. Đoán về phía "chết" là nối lại vô hạn; đoán
      // về phía "sống" là chết câm đúng lúc cần nhất.
      return {
        song: null,
        lyDo: `không đọc được readyState (kiểu ${typeof rs}) — thư viện đã đổi hình dạng?`,
      };
    }
    if (rs === WS.OPEN) return { song: true, lyDo: 'readyState=OPEN' };
    if (rs === WS.CLOSING) return { song: false, lyDo: 'readyState=CLOSING' };
    if (rs === WS.CLOSED) return { song: false, lyDo: 'readyState=CLOSED' };
    // CONNECTING: đang nối dở. KHÔNG phải chết, cũng chưa phải sống. Trả null
    // để watchdog đứng yên một nhịp — nối thật thì nhịp sau đã OPEN; kẹt mãi
    // ở CONNECTING thì Tầng 2 (im lặng) sẽ bắt.
    return { song: null, lyDo: 'readyState=CONNECTING (đang nối, chưa kết luận)' };
  } catch (e) {
    return { song: null, lyDo: `đọc trạng thái ws ném lỗi: ${safeLogText(e)}` };
  }
}

/**
 * @param {any} api
 * @returns {boolean|null} true=sống · false=chết · null=KHÔNG BIẾT
 */
export function isListenerAlive(api) {
  return readWsState(api).song;
}

/**
 * @param {number} ms
 * @param {{daDung: () => boolean}} [co]
 */
function _nghi(ms, co) {
  return new Promise((giai) => {
    const t = setTimeout(giai, ms);
    if (co) {
      // Đang chờ backoff mà bị tắt máy thì phải nhả ngay, không giữ tiến
      // trình sống thêm 5 phút.
      const kiem = setInterval(() => {
        if (co.daDung()) {
          clearTimeout(t);
          clearInterval(kiem);
          giai();
        }
      }, 50);
      t.unref?.();
      kiem.unref?.();
      setTimeout(() => clearInterval(kiem), ms + 10).unref?.();
    }
  });
}

/**
 * Tạo watchdog 2 tầng + vòng nối lại có backoff.
 *
 * ⚠️ `api` NHẬN CẢ HÀM: sau mỗi lần nối lại, `zca-js` trả về một đối tượng api
 * MỚI. Giữ cứng tham chiếu cũ thì từ lần nối lại thứ nhất trở đi watchdog soi
 * một socket đã chết vĩnh viễn ⇒ nối lại vô hạn. Truyền `() => api` để luôn
 * đọc bản hiện hành. (Hợp đồng G0 chỉ khai `api: any` — nhận thêm dạng hàm là
 * THÊM, không phá chữ ký cũ. Đã báo Router.)
 *
 * @param {{api: any|(() => any), cauHinh: CauHinh,
 *          khiCanNoiLai: () => Promise<void>,
 *          ghiSucKhoe: (tt: TrangThaiSucKhoe) => void,
 *          khiHetCach?: () => void|Promise<void>,
 *          kiemKeepAlive?: () => Promise<boolean>}} phuThuoc
 * @returns {{batDau: () => void, dung: () => void, motNhip: () => Promise<void>,
 *            dangNoiLai: () => boolean, soNghiNgo: () => number}}
 */
export function createWatchdog(phuThuoc) {
  const layApi =
    typeof phuThuoc?.api === 'function' ? phuThuoc.api : () => phuThuoc?.api;
  const cauHinh = phuThuoc?.cauHinh ?? {};
  const chuKyMs = Number(cauHinh?.thoiGian?.watchdogMs) || 300_000;
  // Cho phép TIÊM backoff — mặc định là hằng số thật của G0. Không có đường
  // tiêm thì bài test "đủ 5 lần rồi mới CAN_QR" phải chờ 6 PHÚT, nên trong
  // thực tế nó sẽ bị viết thành một bài cắt vòng sớm và không chứng minh
  // được gì (bản đầu của em đúng là như vậy). Đây là THÊM, không đổi mặc định.
  const backoff = Array.isArray(phuThuoc?.backoffMs) && phuThuoc.backoffMs.length
    ? phuThuoc.backoffMs
    : BACKOFF_NOI_LAI_MS;
  const soLanToiDa = Number(phuThuoc?.soLanToiDa) > 0
    ? Number(phuThuoc.soLanToiDa)
    : GIOI_HAN.SO_LAN_NOI_LAI_TOI_DA;
  const imLangMs = Number(cauHinh?.thoiGian?.imLangMs) || 900_000;

  let hen = null;
  let daDung = false;
  let dangNoiLai = false;
  let soNghiNgo = 0;
  let mocBatDau = Date.now();
  /** Sự kiện `closed` công khai — bằng chứng CHẾT mạnh nhất. */
  let daNhanSuKienDong = false;
  /** @type {Array<[any, string, Function]>} */
  const dayCongKhai = [];

  const ghi = (trangThai, lyDo, soLanThuLai = 0) => {
    try {
      phuThuoc.ghiSucKhoe?.({ trangThai, lyDo, soLanThuLai });
    } catch (e) {
      // Ghi health hỏng KHÔNG được làm chết watchdog — watchdog là thứ cuối
      // cùng còn đứng khi mọi thứ khác đã hỏng.
      _log(`ghiSucKhoe ném lỗi (đã nuốt): ${safeLogText(e)}`);
    }
  };

  /** Bắt `closed`/`error`/`connected` — tín hiệu công khai, tin hơn dò nội bộ. */
  function ganDayCongKhai() {
    const bo = layApi()?.listener;
    if (!bo || typeof bo.on !== 'function') return;
    const cap = [
      ['closed', () => {
        daNhanSuKienDong = true;
        _log('nhận sự kiện CÔNG KHAI "closed" -> coi như listener đã chết');
      }],
      ['connected', () => {
        daNhanSuKienDong = false;
        soNghiNgo = 0;
        mocBatDau = Date.now();
      }],
      ['error', (e) => _log(`sự kiện "error" từ listener: ${safeLogText(e)}`)],
    ];
    for (const [ten, fn] of cap) {
      try {
        bo.on(ten, fn);
        dayCongKhai.push([bo, ten, fn]);
      } catch {
        /* bản thư viện không có sự kiện đó -> bỏ qua, đây là tầng PHỤ */
      }
    }
  }

  function goDayCongKhai() {
    for (const [bo, ten, fn] of dayCongKhai.splice(0)) {
      try {
        bo.off?.(ten, fn);
      } catch {
        /* nuốt */
      }
    }
  }

  /**
   * Vòng nối lại: backoff 5s/15s/60s/300s/300s, tối đa 5 lần.
   * Hết cách ⇒ CAN_QR + báo host, nhưng **GIỮ TIẾN TRÌNH SỐNG** để tool
   * `status()` còn trả lời được — chết hẳn thì anh không hỏi được gì.
   */
  async function noiLai(lyDoChet) {
    if (dangNoiLai || daDung) return;
    dangNoiLai = true;
    let soLanTamThoi = 0;   // bao nhiêu lần hỏng là do MẠNG, không phải xác thực
    let loiCuoi = null;
    try {
      for (let i = 0; i < soLanToiDa; i += 1) {
        if (daDung) return;
        const cho = backoff[Math.min(i, backoff.length - 1)];
        ghi(
          TRANG_THAI_SUC_KHOE.DANG_NOI_LAI,
          `${lyDoChet} -> chờ ${cho}ms rồi thử lần ${i + 1}/${soLanToiDa}`,
          i + 1,
        );
        await _nghi(cho, { daDung: () => daDung });
        if (daDung) return;
        try {
          await phuThuoc.khiCanNoiLai();
          daNhanSuKienDong = false;
          soNghiNgo = 0;
          mocBatDau = Date.now();
          goDayCongKhai();
          ganDayCongKhai(); // api đã là đối tượng MỚI -> gắn lại dây công khai
          ghi(TRANG_THAI_SUC_KHOE.OK, `nối lại thành công ở lần ${i + 1}`, i + 1);
          _log(`nối lại thành công ở lần ${i + 1}`);
          return;
        } catch (e) {
          loiCuoi = e;
          if (classifyLoginError(e) === 'TAM_THOI') soLanTamThoi += 1;
          _log(`nối lại lần ${i + 1} thất bại: ${safeLogText(e)}`);
        }
      }
      // 🔴 5 lần hỏng KHÔNG tự động nghĩa là "cookie chết". Mất mạng 15 phút
      // cũng cho đúng 5 lần hỏng như vậy. Bảo anh quét QR lúc đó là kêu oan —
      // và quét QR thật thì ĐÁ VĂNG phiên có khi vẫn còn sống.
      // Chỉ kết luận CAN_QR khi có ÍT NHẤT MỘT lần hỏng KHÔNG phải do mạng.
      const toanLoiMang = soLanTamThoi >= soLanToiDa;
      const maCuoi = toanLoiMang ? TRANG_THAI_SUC_KHOE.KHONG_BIET : TRANG_THAI_SUC_KHOE.CAN_QR;
      ghi(
        maCuoi,
        toanLoiMang
          ? `thử nối lại ${soLanToiDa} lần đều hỏng, NHƯNG cả ${soLanToiDa} lần đều là ` +
            'lỗi mạng/hạ tầng ⇒ CHƯA kết luận được cookie chết. ⛔ ĐỪNG quét QR vì tin này ' +
            '— quét khi phiên còn sống sẽ đá văng chính nó. Kiểm mạng trước.'
          : `thử nối lại ${soLanToiDa} lần đều hỏng — cookie có thể đã chết. ` +
            'Chạy TAY: node bin/zalo-login.js để quét QR lại.' +
            (loiCuoi ? ` (lỗi cuối: ${safeLogText(loiCuoi)})` : ''),
        soLanToiDa,
      );
      try {
        // ⚠️ TRUYỀN mã đã phán sang cho caller. Trước đây `khiHetCach()` không
        // nhận gì, nên `src/index.js` DM cho anh câu "cookie có thể đã chết,
        // cần quét QR lại" bằng chuỗi CỨNG — tức là dù ở đây vừa kết luận
        // KHONG_BIET (toàn lỗi mạng) thì anh vẫn nhận đúng câu giục quét QR.
        // Caller cũ bỏ qua tham số vẫn chạy y như cũ; caller mới dùng được.
        // 🔴 `src/index.js` là file của gói khác — đã báo Router để sửa 1 dòng.
        await phuThuoc.khiHetCach?.(maCuoi, toanLoiMang);
      } catch (e) {
        _log(`khiHetCach ném lỗi (đã nuốt): ${safeLogText(e)}`);
      }
    } finally {
      dangNoiLai = false;
    }
  }

  /** Một nhịp watchdog. Tách ra để test gọi thẳng, không phải chờ 5 phút. */
  async function motNhip() {
    if (daDung || dangNoiLai) return;

    // ── Tầng 3 (công khai) — mạnh nhất, xét trước ────────────────────
    if (daNhanSuKienDong) {
      await noiLai('sự kiện công khai "closed"');
      return;
    }

    // ── Tầng 1 — trạng thái websocket ────────────────────────────────
    const { song, lyDo } = readWsState(layApi());
    if (song === false) {
      ghi(TRANG_THAI_SUC_KHOE.LISTENER_CHET, `Tầng 1: ${lyDo}`);
      await noiLai(`Tầng 1: ${lyDo}`);
      return;
    }
    if (song === null) {
      // 🔴 KHÔNG nối lại. Đây chính là lý do `KHONG_BIET` tồn tại như một
      // trạng thái ĐỘC LẬP: không biết thì đứng yên, đừng đoán.
      ghi(TRANG_THAI_SUC_KHOE.KHONG_BIET, `Tầng 1 không kết luận được: ${lyDo}`);
      return;
    }

    // ── Tầng 2 — im lặng bất thường ──────────────────────────────────
    const lanCuoi = lastEventAt();
    const imLang = Date.now() - (lanCuoi ?? mocBatDau);
    if (imLang <= imLangMs) {
      soNghiNgo = 0;
      ghi(TRANG_THAI_SUC_KHOE.OK, `Tầng 1 OK (${lyDo}), im lặng ${Math.round(imLang / 1000)}s`);
      return;
    }

    // Gửi được mà không nhận được — đúng bệnh "chết câm" của zca-js.
    let keepAliveOk = null;
    try {
      keepAliveOk = phuThuoc.kiemKeepAlive ? await phuThuoc.kiemKeepAlive() : null;
    } catch (e) {
      _log(`kiemKeepAlive ném lỗi: ${safeLogText(e)}`);
      keepAliveOk = false;
    }

    soNghiNgo += 1;
    const moTa =
      `im lặng ${Math.round(imLang / 1000)}s > ${Math.round(imLangMs / 1000)}s, ` +
      `keepAlive=${keepAliveOk === null ? 'không kiểm' : keepAliveOk}, ` +
      `chu kỳ nghi ngờ ${soNghiNgo}/${SUSPICION_CYCLES}`;

    if (soNghiNgo < SUSPICION_CYCLES) {
      // ⚠️ CHƯA hành động. Nhóm im 15 phút là chuyện hoàn toàn bình thường —
      // nối lại vì im lặng một nhịp là tự đá phiên của chính mình.
      ghi(TRANG_THAI_SUC_KHOE.KHONG_BIET, `Tầng 2 nghi ngờ: ${moTa}`);
      return;
    }
    ghi(TRANG_THAI_SUC_KHOE.LISTENER_CHET, `Tầng 2 kết luận: ${moTa}`);
    await noiLai(`Tầng 2: ${moTa}`);
  }

  return {
    batDau() {
      if (hen) return;
      daDung = false;
      mocBatDau = Date.now();
      ganDayCongKhai();
      hen = setInterval(() => {
        motNhip().catch((e) => _log(`nhịp watchdog ném lỗi (đã nuốt): ${safeLogText(e)}`));
      }, chuKyMs);
      _log(`bật watchdog: chu kỳ ${chuKyMs}ms, ngưỡng im lặng ${imLangMs}ms`);
    },
    dung() {
      daDung = true;
      if (hen) clearInterval(hen);
      hen = null;
      goDayCongKhai();
    },
    motNhip,
    dangNoiLai: () => dangNoiLai,
    soNghiNgo: () => soNghiNgo,
  };
}
