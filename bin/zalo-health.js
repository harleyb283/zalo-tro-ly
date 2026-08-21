#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * G6 — KIỂM SỨC KHOẺ, chạy bằng cron. Script chạy tay/cron ⇒ ĐƯỢC in stdout.
 *
 *   0,10,20,30,40,50 * * * *  cd <pack> && $(which node) bin/zalo-health.js
 *
 * ⚠️ Viết `0,10,20,...` chứ KHÔNG viết dạng chia-đôi-sao-gạch-chéo ở đây: cặp
 *    ký tự đó ĐÓNG khối chú thích /* *\/ và làm cả file lỗi cú pháp. Hai cách
 *    viết cron này tương đương nhau. (Trong chuỗi backtick ở `inHelp()` thì
 *    viết dạng nào cũng được — chỉ chú thích mới dính.)
 *
 * Cron gửi mail local cho user MỖI KHI lệnh in ra stdout/stderr HOẶC thoát
 * mã ≠ 0 — đó là "tầng 2" của đường báo host, không cài gì thêm.
 * ⇒ Vì vậy khi MỌI THỨ BÌNH THƯỜNG script phải **im hoàn toàn và exit 0**.
 *   In một dòng "OK" mỗi 10 phút là 144 mail/ngày, và sau hai ngày thì không
 *   ai đọc mail của nó nữa — cảnh báo thật lúc đó cũng chìm luôn.
 *   Muốn xem trạng thái thì gọi tay `--xem`.
 *
 * 🔴 SCRIPT NÀY TUYỆT ĐỐI KHÔNG ĐĂNG NHẬP ZALO.
 *    Lý do (PHỎNG ĐOÁN có căn cứ, xem mục "chỗ còn mù" trong báo cáo G6):
 *    tài khoản Zalo chỉ có MỘT suất "máy tính". Một tiến trình cron chạy 10
 *    phút/lần mà cũng đăng nhập thì có nguy cơ **đá chính cái daemon nó đang
 *    canh** — bộ theo dõi tự tay gây ra sự cố nó sinh ra để phát hiện. Chưa
 *    ai xác minh được là an toàn, mà thiệt hại nếu sai thì rất lớn ⇒ không làm.
 *    ⇒ Ở đây `baoHost()` luôn được gọi với `boTang1: true`.
 *
 * MÃ THOÁT (cron chỉ đọc được cái này):
 *    0  bình thường  (hoặc --xem, luôn 0)
 *    1  lỗi bất ngờ
 *    2  không đọc/không hiểu được cấu hình
 *    3  CAN_QR          — cần người quét QR lại  (khớp bin/zalo-login.js)
 *    4  LISTENER_CHET
 *    5  DANG_NOI_LAI mắc kẹt quá lâu
 *    6  KHONG_BIET
 *    7  NHỊP TIM CHẾT — không ai ghi health.json từ lâu (tiến trình chết hẳn)
 *    8  chưa có health.json (daemon chưa từng chạy)
 * ═══════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { docCauHinh, THOI_GIAN_MAC_DINH } from '../src/policy/access.js';
import { moRong } from '../src/lib/duong_dan.js';
import { ghiLogAnToan } from '../src/lib/redact.js';
import { TRANG_THAI_SUC_KHOE } from '../src/lib/hang_so.js';
import {
  docTrangThai, tuoiNhipTimMs, tuoiTrangThaiMs, moTaKhoangThoiGian, daemonDangChay,
} from '../src/ops/health.js';
import { baoHost } from '../src/ops/notify_host.js';

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

export const MA = Object.freeze({
  OK: 0, LOI: 1, CAU_HINH: 2, CAN_QR: 3, LISTENER_CHET: 4,
  NOI_LAI_KET: 5, KHONG_BIET: 6, NHIP_TIM_CHET: 7, CHUA_CHAY: 8,
});

/**
 * Nhịp tim được coi là CHẾT sau bao lâu.
 * Lấy 3 chu kỳ watchdog: một chu kỳ lỡ là chuyện thường (máy ngủ, hệ bận),
 * ba chu kỳ liên tiếp thì không còn là ngẫu nhiên. Sàn 15 phút để cấu hình
 * watchdog quá ngắn không sinh báo động giả liên miên.
 */
export function hanNhipTimMs(cauHinh) {
  const w = cauHinh?.thoiGian?.watchdogMs || THOI_GIAN_MAC_DINH.watchdogMs;
  return Math.max(15 * 60_000, w * 3);
}

/**
 * `DANG_NOI_LAI` bao lâu thì coi là MẮC KẸT.
 * Backoff của thiết kế là 5s→15s→60s→300s→300s, tối đa 5 lần ⇒ một vòng nối
 * lại tử tế xong trong ~12 phút. Quá 30 phút mà vẫn "đang nối lại" nghĩa là
 * nó đang quay vòng chứ không phải đang hồi phục.
 */
export const HAN_NOI_LAI_MS = 30 * 60_000;

function docThamSo(argv) {
  const t = { xem: false, json: false, config: null, imLang: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--xem') t.xem = true;
    else if (a === '--json') t.json = true;
    else if (a === '--im-lang' || a === '--quiet') t.imLang = true;
    else if (a === '--config') t.config = argv[++i];
    else if (a === '-h' || a === '--help') t.help = true;
    else throw new Error(`Tham số lạ: ${a}  (xem --help)`);
  }
  return t;
}

function inHelp() {
  out(`
zalo-health — kiểm sức khoẻ trợ lý Zalo (dành cho cron)

  node bin/zalo-health.js            im lặng nếu bình thường; kêu khi có chuyện
  node bin/zalo-health.js --xem      in trạng thái rồi thoát 0 (xem tay)
  node bin/zalo-health.js --json     in JSON cho script khác đọc
  node bin/zalo-health.js --im-lang  không báo host, chỉ trả mã thoát
  --config <p>                       file cấu hình khác

Cron gợi ý (10 phút/lần):
  */10 * * * *  cd <pack> && $(which node) bin/zalo-health.js

Mã thoát: 0 ok · 1 lỗi · 2 cấu hình · 3 CAN_QR · 4 LISTENER_CHET
          5 nối lại mắc kẹt · 6 KHONG_BIET · 7 nhịp tim chết · 8 chưa chạy

🔴 Script này KHÔNG đăng nhập Zalo (tránh đá phiên của daemon nó đang canh)
   ⇒ không dùng được tầng báo "DM qua Zalo". Cắm config.notifyCommand để có
   cảnh báo thật khi ở xa máy.
`.trim());
}

/**
 * Phán trạng thái. Hàm THUẦN — không I/O, để test được không cần đĩa.
 *
 * @param {object|null} tt  kết quả docTrangThai()
 * @param {object} cauHinh
 * @param {number} [bayGioMs]
 * @returns {{ma: number, nghiemTrong: boolean, tomTat: string, chiTiet: object}}
 */
export function phanDinh(tt, cauHinh, bayGioMs = Date.now(), tienTrinh = null) {
  // 🔴 BỐN TRẠNG THÁI KHÁC HẲN NHAU, lâu nay bị gộp thành một câu "cần quét QR":
  //   ① daemon không chạy   ② chưa từng đăng nhập   ③ đang khởi động lại   ④ cookie chết thật
  // CHỈ ④ mới cần quét QR. `tienTrinh` (daemonDangChay) là dữ kiện để tách ① và ③
  // ra khỏi ④ — thiếu nó thì mọi câu trả lời đều là phỏng đoán.
  const dt = tienTrinh ?? { song: null, pid: null, lyDo: 'chưa kiểm tiến trình' };
  const moTaTienTrinh = dt.song === true
    ? `Tiến trình daemon VẪN ĐANG CHẠY (pid ${dt.pid}).`
    : dt.song === false
      ? 'Tiến trình daemon KHÔNG chạy.'
      : `Không xác định được tiến trình daemon (${dt.lyDo}).`;

  if (!tt) {
    return {
      ma: MA.CHUA_CHAY,
      nghiemTrong: true,
      tomTat: dt.song === true
        // Có tiến trình mà chưa có file trạng thái ⇒ nó vừa mới lên, chưa kịp
        // ghi. Đây là ca ③, KHÔNG phải "chưa từng chạy".
        ? `Chưa có health.json nhưng ${moTaTienTrinh.toLowerCase()} `
          + '⇒ nhiều khả năng trợ lý ĐANG KHỞI ĐỘNG, chưa kịp ghi trạng thái. '
          + 'Chờ một nhịp rồi xem lại. KHÔNG cần quét QR.'
        : 'Chưa có health.json — daemon chưa từng chạy, hoặc đang trỏ sai đường dẫn. '
          + 'Đây KHÔNG phải bằng chứng cookie chết.',
      chiTiet: { trangThai: null, tienTrinh: dt },
    };
  }

  const nhipTim = tuoiNhipTimMs(tt, bayGioMs);
  const tuoiTt = tuoiTrangThaiMs(tt, bayGioMs);
  const han = hanNhipTimMs(cauHinh);
  const chiTiet = {
    trangThai: tt.trangThai,
    lyDo: tt.lyDo,
    soLanThuLai: tt.soLanThuLai,
    nhipTimMs: nhipTim,
    tuoiTrangThaiMs: tuoiTt,
    hanNhipTimMs: han,
    tienTrinh: dt,
  };

  // 🔴 KIỂM NHỊP TIM TRƯỚC MỌI THỨ. Tiến trình chết hẳn thì `trangThai` đông
  // cứng ở giá trị cuối cùng — rất có thể là "OK" — và mọi phép kiểm dựa vào
  // `trangThai` sẽ báo khoẻ mạnh. Đây là ca hỏng CÂM tệ nhất của cả cơ chế.
  if (nhipTim !== null && nhipTim > han) {
    return {
      ma: MA.NHIP_TIM_CHET,
      nghiemTrong: true,
      tomTat:
        `NHỊP TIM CHẾT: ${moTaKhoangThoiGian(nhipTim)} rồi không ai ghi health.json `
        + `(ngưỡng ${moTaKhoangThoiGian(han)}). Trạng thái ghi lần cuối là `
        + `"${tt.trangThai}" nhưng con số đó đã cũ — nhiều khả năng tiến trình chết hẳn.`,
      chiTiet,
    };
  }

  switch (tt.trangThai) {
    case TRANG_THAI_SUC_KHOE.OK:
      return { ma: MA.OK, nghiemTrong: false, tomTat: 'Bình thường.', chiTiet };

    case TRANG_THAI_SUC_KHOE.CAN_QR: {
      // 🔴 MÂU THUẪN ĐÁNG NGỜ: trạng thái nói "cần quét QR" mà tiến trình vẫn
      // đang chạy. Đường ghi CAN_QR trong `src/index.js` là đường THOÁT (mã 3)
      // — ghi xong là chết. Nên "CAN_QR + daemon còn sống" gần như chắc chắn là
      // TRẠNG THÁI CŨ còn sót của một lần khởi động hỏng trước đó, trong khi
      // bản đang chạy vẫn khoẻ. Đây đúng là cảnh anh mô tả: "báo quét QR mà
      // Zalo vẫn connect bình thường".
      // ⇒ KHÔNG hô "đi quét QR" trong ca này. Quét nhầm là đá văng phiên đang sống.
      if (dt.song === true) {
        return {
          ma: MA.OK, nghiemTrong: false,
          tomTat:
            `health.json ghi CAN_QR (đã ${moTaKhoangThoiGian(tuoiTt)}) NHƯNG ${moTaTienTrinh} `
            + '⇒ nhiều khả năng đây là TRẠNG THÁI CŨ của một lần khởi động hỏng trước đó, '
            + 'không phải sự cố đang diễn ra. ⛔ ĐỪNG quét QR — quét khi phiên còn sống sẽ ĐÁ VĂNG nó. '
            + 'Kiểm bằng cách gửi thử một tin vào nhóm rồi xem có được ghi không.'
            + (tt.lyDo ? `\n  Lý do đã ghi: ${tt.lyDo}` : ''),
          chiTiet,
        };
      }
      return {
        ma: MA.CAN_QR, nghiemTrong: true,
        tomTat:
          `CẦN QUÉT QR LẠI (đã ${moTaKhoangThoiGian(tuoiTt)}). ${moTaTienTrinh} Chạy TAY: `
          + `node bin/zalo-login.js — trợ lý KHÔNG tự làm được việc này.`
          + (tt.lyDo ? `\n  Lý do: ${tt.lyDo}` : ''),
        chiTiet,
      };
    }

    case TRANG_THAI_SUC_KHOE.LISTENER_CHET:
      return {
        ma: MA.LISTENER_CHET, nghiemTrong: true,
        tomTat:
          `LISTENER CHẾT (đã ${moTaKhoangThoiGian(tuoiTt)}). Tin nhắn mới KHÔNG `
          + 'được ghi lại trong khoảng này — và sẽ không lấy lại được, Zalo không '
          + 'cho đọc lịch sử trước lúc bot nghe.'
          + (tt.lyDo ? `\n  Lý do: ${tt.lyDo}` : ''),
        chiTiet,
      };

    case TRANG_THAI_SUC_KHOE.DANG_NOI_LAI: {
      // Đang nối lại là chuyện BÌNH THƯỜNG trong chốc lát — báo động ngay thì
      // mỗi lần mạng chớp là một mail. Chỉ kêu khi nó KẸT.
      const ket = tuoiTt !== null && tuoiTt > HAN_NOI_LAI_MS;
      return {
        ma: ket ? MA.NOI_LAI_KET : MA.OK,
        nghiemTrong: ket,
        tomTat: ket
          ? `NỐI LẠI MẮC KẸT: đã ${moTaKhoangThoiGian(tuoiTt)} vẫn chưa xong `
            + `(thử ${tt.soLanThuLai} lần). Vòng nối lại đáng ra xong trong ~12 phút.`
          : `Đang nối lại (${moTaKhoangThoiGian(tuoiTt)}, thử ${tt.soLanThuLai} lần) — `
            + 'còn trong khoảng bình thường, chưa báo động.',
        chiTiet,
      };
    }

    case TRANG_THAI_SUC_KHOE.KHONG_BIET:
      return {
        ma: MA.KHONG_BIET, nghiemTrong: true,
        tomTat:
          `KHÔNG XÁC ĐỊNH ĐƯỢC listener còn sống hay không (đã `
          + `${moTaKhoangThoiGian(tuoiTt)}). Đây KHÔNG phải "đã chết" — watchdog `
          + 'cố ý không tự nối lại ở trạng thái này để khỏi rơi vào vòng vô hạn. '
          + 'Thường là do zca-js lên version và đổi thuộc tính nội bộ. '
          + 'Kiểm bằng cách gửi thử một tin vào nhóm rồi xem có được ghi không.'
          + (tt.lyDo ? `\n  Lý do: ${tt.lyDo}` : ''),
        chiTiet,
      };

    default:
      // health.js đã lọc mã lạ, tới đây coi như không thể xảy ra. Nhưng nếu có
      // thì phải kêu, không được im.
      return {
        ma: MA.LOI, nghiemTrong: true,
        tomTat: `Mã trạng thái không xử lý được: ${tt.trangThai}`,
        chiTiet,
      };
  }
}

export async function main(argv) {
  const t = docThamSo(argv);
  if (t.help) { inHelp(); return MA.OK; }

  let cauHinh;
  try {
    cauHinh = docCauHinh(t.config);
  } catch (e) {
    err(`⛔ Cấu hình: ${e.message}`);
    return MA.CAU_HINH;
  }

  const duongDanHealth = moRong(
    process.env.ZTL_DATA_DIR
      ? path.join(moRong(process.env.ZTL_DATA_DIR), 'health.json')
      : cauHinh.duongDan.health,
  );

  const tt = docTrangThai(duongDanHealth);
  // Đọc tiến trình daemon TRƯỚC khi phán: thiếu dữ kiện này thì không tách nổi
  // "đang khởi động lại" với "cookie chết thật" (xem chú thích ở phanDinh).
  const tienTrinh = daemonDangChay(cauHinh);
  const kq = phanDinh(tt, cauHinh, Date.now(), tienTrinh);

  if (t.json) {
    out(JSON.stringify({ duongDanHealth, ma: kq.ma, ...kq, ...{ chiTiet: kq.chiTiet } }, null, 2));
    return t.xem ? MA.OK : kq.ma;
  }

  if (t.xem) {
    // Gọi tay ⇒ in đầy đủ và LUÔN thoát 0, để dùng trong pipeline mà không
    // làm hỏng `set -e` của người ta.
    out('═══ SỨC KHOẺ TRỢ LÝ ZALO ═══');
    out(`  file        : ${duongDanHealth}`);
    out(`  trạng thái  : ${tt?.trangThai ?? '(chưa có file)'}`);
    if (tt) {
      out(`  vào lúc     : ${tt.tuLuc}  (${moTaKhoangThoiGian(tuoiTrangThaiMs(tt))} trước)`);
      out(`  ghi lần cuối: ${tt.ghiLuc}  (${moTaKhoangThoiGian(tuoiNhipTimMs(tt))} trước)`);
      out(`  số lần thử  : ${tt.soLanThuLai}`);
      if (tt.lyDo) out(`  lý do       : ${tt.lyDo}`);
    }
    out(`  tiến trình  : ${tienTrinh.lyDo}`);
    out('');
    out(`  ${kq.nghiemTrong ? '🔴' : '✅'} ${kq.tomTat}`);
    out(`  mã thoát nếu chạy tự động: ${kq.ma}`);
    return MA.OK;
  }

  // ── Chế độ cron ──────────────────────────────────────────────────────
  // Bình thường thì IM HOÀN TOÀN (xem lý do ở đầu file).
  if (!kq.nghiemTrong) return MA.OK;

  err(`🔴 [trợ lý Zalo] ${kq.tomTat}`);

  if (!t.imLang) {
    try {
      // 🔴 boTang1: KHÔNG đăng nhập Zalo từ tiến trình cron.
      await baoHost(cauHinh, kq.tomTat, {
        boTang1: true,
        trangThai: tt,
        tieuDe: 'Trợ lý Zalo — cần xem',
      });
    } catch (e) {
      err(`⚠️ không báo host được: ${ghiLogAnToan(e)}`);
    }
  }

  return kq.ma;
}

const laFileChinh = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (laFileChinh) {
  main(process.argv)
    .then((ma) => { process.exitCode = ma; })
    .catch((e) => {
      err(`⛔ ${e?.message ?? ghiLogAnToan(e)}`);
      process.exitCode = MA.LOI;
    });
}
