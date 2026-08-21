#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * G1 — ĐĂNG NHẬP ZALO. CHẠY TAY, có người ngồi trước terminal.
 *
 * 🔴 Đây là chỗ DUY NHẤT trong pack được phép quét QR. Tiến trình nền
 *    (src/index.js) TUYỆT ĐỐI không tự mở QR — không ai đứng đó quét.
 *
 * Script chạy tay ⇒ ĐƯỢC in stdout (ngoại lệ của luật stdout-là-kênh-MCP).
 *
 * Dùng:
 *   node bin/zalo-login.js               quét QR (bỏ qua nếu phiên còn sống)
 *   node bin/zalo-login.js --force       quét QR lại dù phiên còn sống
 *   node bin/zalo-login.js --whoami      chỉ in user_id + tên + nhóm, KHÔNG quét QR
 *   node bin/zalo-login.js --nhom        in danh sách nhóm dạng dán thẳng vào config
 *   Cờ phụ: --config <p> · --qr-path <p> · --no-open · --help
 *
 * ⚠️ zca-js KHÔNG in QR ra terminal — nó ghi file PNG rồi thôi
 *    (dist/apis/loginQR.js:116 `writeFile(filepath, imageData, "base64")`).
 *    Muốn QR hiện thẳng trong terminal thì phải cài thêm gói (Rule 2 — phải
 *    xin duyệt). Ở đây dùng đường KHÔNG CẦN CÀI GÌ: ghi PNG ra ngoài project
 *    rồi mở bằng trình xem ảnh của hệ điều hành.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

import { moRong } from '../src/lib/duong_dan.js';
import { ghiLogAnToan } from '../src/lib/redact.js';
import { dangChayTest } from '../src/ops/notify_host.js';
import {
  dangNhapBangCookie,
  dangNhapBangQr,
  docPhien,
  luuPhien,
  layThongTinToi,
  layDanhSachNhom,
  apDungAnTrangThai,
  LoiPhienZalo,
} from '../src/zalo/session.js';

const THU_MUC_PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

// ═══════════════════════════════════════════════════════════════════════
// Tham số + cấu hình
// ═══════════════════════════════════════════════════════════════════════

function docThamSo(argv) {
  const t = {
    whoami: false, nhom: false, force: false, moAnh: true,
    config: null, qrPath: null, help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--whoami') t.whoami = true;
    else if (a === '--nhom' || a === '--groups') t.nhom = true;
    else if (a === '--force') t.force = true;
    else if (a === '--no-open') t.moAnh = false;
    else if (a === '--config') { t.config = argv[++i]; }
    else if (a === '--qr-path') { t.qrPath = argv[++i]; }
    else if (a === '-h' || a === '--help') t.help = true;
    else throw new Error(`Tham số lạ: ${a}  (xem --help)`);
  }
  return t;
}

/**
 * Đọc config theo kiểu KHOAN DUNG — CỐ Ý khác `policy/access.js`.
 *
 * 🔴 Vì sao không dùng `docCauHinh()` của G4: hợp đồng bắt nó TỪ CHỐI CHẠY
 *    khi `hosts[]` rỗng / còn số 0000. Nhưng chính script này mới là thứ in ra
 *    user_id để người dùng điền vào `hosts[]`. Dùng bộ validate nghiêm ở đây
 *    là khoá chết vòng: không điền được hosts vì chưa chạy được --whoami,
 *    mà không chạy được --whoami vì hosts chưa điền.
 *    Script này chỉ cần đúng 2 thứ: `duongDan.session` và `anTrangThai`.
 *
 * @returns {{cauHinh: any, tuFile: string|null}}
 */
function docCauHinhKhoanDung(chiDinh) {
  const p = chiDinh
    ? moRong(chiDinh)
    : process.env.ZTL_CONFIG
      ? moRong(process.env.ZTL_CONFIG)
      : path.join(THU_MUC_PACK, 'config', 'assistant.config.json');

  let ch = {};
  let tuFile = null;
  if (fs.existsSync(p)) {
    try {
      ch = JSON.parse(fs.readFileSync(p, 'utf8'));
      tuFile = p;
    } catch (e) {
      throw new Error(`Config không phải JSON hợp lệ: ${p}\n  ${e.message}`);
    }
  }

  // ZTL_DATA_DIR thắng config — giữ đúng thứ tự mà bin/init-db.js đã chốt.
  const thuMucDuLieu = process.env.ZTL_DATA_DIR ? moRong(process.env.ZTL_DATA_DIR) : null;
  const session = thuMucDuLieu
    ? path.join(thuMucDuLieu, 'session.json')
    : moRong(ch?.duongDan?.session || '~/.zalo-tro-ly/session.json');

  return {
    tuFile,
    cauHinh: {
      duongDan: { session },
      // Mặc định BẬT ẩn trạng thái, khớp assistant.config.example.json.
      anTrangThai: ch?.anTrangThai !== false,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Tiện ích
// ═══════════════════════════════════════════════════════════════════════

function laTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function hoiCo(cauHoi) {
  if (!laTty()) {
    throw new Error(
      'Cần xác nhận của người dùng nhưng đây không phải terminal tương tác.\n' +
      '  Script này PHẢI chạy tay. Không đặt nó vào cron/launchd.',
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const tl = (await rl.question(`${cauHoi} [c/K] `)).trim().toLowerCase();
    return tl === 'c' || tl === 'co' || tl === 'có' || tl === 'y' || tl === 'yes';
  } finally {
    rl.close();
  }
}

export function moAnhBangHeDieuHanh(duongDan) {
  // 🔴 CÙNG HỌ LỖI với vụ popup osascript (20/08/2026): đây cũng là một đường
  // CHẠM RA NGOÀI tiến trình — nó mở hẳn trình xem ảnh trên màn hình anh.
  // Hôm nay chưa bài test nào với tới (phải đăng nhập QR thật mới gọi được),
  // nhưng chốt cổng luôn: bài test sau này giả lập được luồng QR thì nó KHÔNG
  // được bật Preview lên giữa lúc anh đang làm việc.
  if (dangChayTest()) {
    process.stderr.write(`[zalo-login] [CHẶN] đang chạy test -> KHÔNG mở ảnh QR: ${duongDan}\n`);
    return false;
  }
  const lenh = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'explorer'
      : 'xdg-open';
  try {
    spawn(lenh, [duongDan], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

function inThongTinTaiKhoan({ userId, ten }, phien) {
  out('');
  out('═══ TÀI KHOẢN ĐANG ĐĂNG NHẬP ═══');
  out(`  user_id : ${userId}`);
  out(`  tên     : ${ten || '(không lấy được)'}`);
  if (phien?.imei) {
    out('');
    out('  Hai giá trị dưới đây đã được lưu SẴN trong file phiên (cùng chỗ với');
    out('  cookie). Chỉ chép vào .env nếu muốn có bản dự phòng — KHÔNG bắt buộc.');
    out(`  ZALO_IMEI=${phien.imei}`);
    out(`  ZALO_USER_AGENT=${phien.userAgent}`);
  }
  out('');
  out('  → Chép user_id ở trên vào  hosts[].userId  trong config/assistant.config.json');
}

function inDanhSachNhom(nhom) {
  out('');
  out(`═══ ${nhom.length} NHÓM ĐANG THAM GIA ═══`);
  if (!nhom.length) {
    out('  (không có nhóm nào)');
    return;
  }
  for (const n of nhom) out(`  ${n.chatId}  ${n.ten || '(không lấy được tên)'}`);
  out('');
  out('  → Dán khối dưới đây vào  "groups"  trong config/assistant.config.json:');
  out('');
  out(JSON.stringify(
    nhom.map((n) => ({
      chatId: n.chatId,
      ten: n.ten || 'chua-dat-ten',
      ghiLichSu: true,
      traLoiKhiTag: true,
    })),
    null,
    2,
  ).split('\n').map((d) => `  ${d}`).join('\n'));
  out('');
  out('  ⚠️ Bỏ BỚT nhóm không muốn nghe. Có mặt trong danh sách này = sẽ bị ghi lại.');
}

function inHelp() {
  out(`
zalo-login — đăng nhập Zalo cho pack trợ lý (CHẠY TAY, cần người quét QR)

  node bin/zalo-login.js              quét QR nếu chưa có phiên dùng được
  node bin/zalo-login.js --force      quét QR lại dù phiên còn sống
  node bin/zalo-login.js --whoami     chỉ in user_id + tên (dùng cookie sẵn có)
  node bin/zalo-login.js --nhom       in danh sách nhóm để dán vào config

  --config <p>    file cấu hình khác (mặc định config/assistant.config.json)
  --qr-path <p>   nơi ghi ảnh QR (mặc định cạnh file phiên, NGOÀI project)
  --no-open       không tự mở ảnh QR bằng trình xem ảnh
  -h, --help      bản trợ giúp này

LƯU Ý VẬN HÀNH
  · Tài khoản dùng cho trợ lý KHÔNG được đăng nhập Zalo Web/PC ở nơi khác —
    sẽ đá phiên của trợ lý (một tài khoản chỉ có MỘT suất "máy tính").
    Dùng điện thoại bình thường thì không sao (2 suất riêng).
  · Cookie bind theo IP + User-Agent. Đổi IP nhà là phải quét QR lại.
  · File phiên chứa cookie Zalo — quyền 0600, KHÔNG BAO GIỜ commit.
`.trim());
}

// ═══════════════════════════════════════════════════════════════════════
// Các lệnh
// ═══════════════════════════════════════════════════════════════════════

async function lenhDungPhienSanCo(cauHinh, { canNhom }) {
  const api = await dangNhapBangCookie(cauHinh);
  const toi = await layThongTinToi(api);
  const phien = await docPhien(cauHinh.duongDan.session);
  inThongTinTaiKhoan(toi, phien);
  if (canNhom) inDanhSachNhom(await layDanhSachNhom(api));
  return { api, toi };
}

async function lenhQuetQr(cauHinh, tuyChon) {
  const duongDanSession = cauHinh.duongDan.session;
  const qrPath = tuyChon.qrPath
    ? moRong(tuyChon.qrPath)
    : path.join(path.dirname(duongDanSession), 'qr.png');

  out('');
  out('═══ QUÉT QR ĐĂNG NHẬP ZALO ═══');
  out('  Đang xin mã QR từ Zalo…');

  const kq = await dangNhapBangQr({
    qrPath,
    khiCoSuKien: (loai, dl) => {
      if (loai === 'QR_DA_TAO') {
        out('');
        out(`  ✅ Ảnh QR đã ghi: ${dl.qrPath}`);
        if (tuyChon.moAnh) {
          moAnhBangHeDieuHanh(dl.qrPath)
            ? out('  Đã mở bằng trình xem ảnh của máy.')
            : out('  (không tự mở được — hãy tự mở file trên)');
        }
        out('');
        out('  📱 Mở app Zalo trên ĐIỆN THOẠI → Thêm → Mã QR → quét ảnh trên.');
        out('  ⏳ QR có hạn. Hết hạn thì chạy lại lệnh này.');
      } else if (loai === 'QR_DA_QUET') {
        out(`  ✅ Đã quét — xác nhận trên điện thoại giúp em (${dl?.ten ?? '?'})`);
      } else if (loai === 'QR_HET_HAN') {
        err('  ⛔ Mã QR hết hạn. Chạy lại: node bin/zalo-login.js');
      } else if (loai === 'QR_BI_TU_CHOI') {
        err('  ⛔ Đăng nhập bị từ chối trên điện thoại.');
      } else if (loai === 'CO_THONG_TIN_DANG_NHAP') {
        out('  ✅ Nhận được thông tin đăng nhập.');
      }
    },
  });

  const toi = await layThongTinToi(kq.api);

  await luuPhien(duongDanSession, {
    cookie: kq.cookie,
    imei: kq.imei,
    userAgent: kq.userAgent,
    language: kq.language,
    userId: toi.userId,
    ten: toi.ten,
  });
  out('');
  out(`  ✅ Đã lưu phiên (quyền 0600): ${moRong(duongDanSession)}`);

  // ⚠️ Cài đặt CẤP TÀI KHOẢN — hỏi MỘT LẦN, không tự ý làm.
  if (cauHinh.anTrangThai) {
    out('');
    out('  ⚠️  "Ẩn trạng thái" là cài đặt CẤP TÀI KHOẢN Zalo, KHÔNG tách riêng cho');
    out('     trợ lý được. Bật thì anh ẩn "đang online" và "đã xem" với TẤT CẢ');
    out('     mọi người, trên mọi thiết bị — kể cả khi dùng Zalo trên điện thoại.');
    const dongY = await hoiCo('     Ẩn trạng thái online + đã xem cho tài khoản này?');
    if (dongY) {
      await apDungAnTrangThai(kq.api, true);
      out('     → đã ẩn.');
    } else {
      out('     → giữ nguyên. Trợ lý vẫn chạy được, chỉ là kém kín đáo hơn.');
      out('     (Sửa "anTrangThai": false trong config để khỏi bị hỏi lại.)');
    }
  }

  const phien = await docPhien(duongDanSession);
  inThongTinTaiKhoan(toi, phien);
  inDanhSachNhom(await layDanhSachNhom(kq.api));

  out('');
  out('═══ BƯỚC TIẾP THEO ═══');
  out('  1. Điền hosts[] và groups[] vào config/assistant.config.json');
  out('  2. node bin/init-db.js          (tạo kho lịch sử)');
  out('  3. node src/index.js --khong-mcp (chạy thử, chỉ nghe + ghi DB)');
  return kq.api;
}

// ═══════════════════════════════════════════════════════════════════════

export async function main(argv) {
  const t = docThamSo(argv);
  if (t.help) { inHelp(); return; }

  const { cauHinh, tuFile } = docCauHinhKhoanDung(t.config);
  err(`[zalo-login] config: ${tuFile ?? '(chưa có, dùng mặc định)'}`);
  err(`[zalo-login] phiên : ${cauHinh.duongDan.session}`);

  if (t.whoami || t.nhom) {
    try {
      await lenhDungPhienSanCo(cauHinh, { canNhom: t.nhom });
    } catch (e) {
      if (e instanceof LoiPhienZalo) {
        err('');
        err(`⛔ ${e.message}`);
        process.exitCode = 3;   // 3 = CAN_QR, khớp thiết kế 5.1
        return;
      }
      throw e;
    }
    return;
  }

  if (!t.force) {
    const phien = await docPhien(cauHinh.duongDan.session);
    if (phien) {
      out('Đã có file phiên — thử dùng lại trước khi quét QR…');
      try {
        await lenhDungPhienSanCo(cauHinh, { canNhom: true });
        out('');
        out('✅ Phiên còn sống, KHÔNG cần quét QR.');
        out('   Muốn quét lại thì thêm cờ --force');
        return;
      } catch (e) {
        err('');
        err(`⚠️ Phiên cũ không dùng được:\n  ${e.message}`);
        err('');
        if (!laTty()) {
          err('⛔ Cần quét QR nhưng đây không phải terminal tương tác. Dừng.');
          process.exitCode = 3;
          return;
        }
        const dongY = await hoiCo('Quét QR mới bây giờ?');
        if (!dongY) { out('Đã huỷ.'); return; }
      }
    }
  }

  if (!laTty()) {
    err('⛔ Quét QR cần người ngồi trước terminal. Đây không phải TTY — dừng.');
    err('   ĐỪNG đặt lệnh này vào cron/launchd.');
    process.exitCode = 3;
    return;
  }

  await lenhQuetQr(cauHinh, t);
}

const laFileChinh = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (laFileChinh) {
  main(process.argv).catch((e) => {
    err('');
    err(`⛔ ${e?.message ?? ghiLogAnToan(e)}`);
    process.exitCode = process.exitCode || 1;
  });
}
