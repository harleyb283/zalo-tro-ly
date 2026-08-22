#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ CÀI ĐẶT TRỢ LÝ — MỘT LỆNH DUY NHẤT, DẪN TỪNG BƯỚC.
 *
 *      npm run cai-dat
 *
 * 🔴 NGƯỜI DÙNG CỦA FILE NÀY ⛔ KHÔNG PHẢI DÂN KỸ THUẬT. Mọi câu chữ in ra
 *    phải trả lời được ba câu: *đang làm gì · cần tôi làm gì · nếu hỏng thì
 *    gõ gì*. ⛔ Không in stack trace, ⛔ không bắt người ta tự sửa JSON.
 *
 * 🔴 CHẠY LẠI ĐƯỢC NHIỀU LẦN. Đã đăng nhập rồi thì ⛔ không quét QR lại (quét
 *    lại là ĐÁ VĂNG phiên đang chạy — tài khoản Zalo chỉ có MỘT suất máy tính).
 *    Đã có cấu hình thì hỏi trước khi ghi đè.
 *
 * ⚠️ Script chạy tay, có người ngồi trước màn hình ⇒ ĐƯỢC in stdout (ngoại lệ
 *    của luật "stdout là kênh MCP", giống `bin/zalo-login.js`).
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

import { moRong } from '../src/lib/duong_dan.js';
import { dangChayTest } from '../src/ops/notify_host.js';
import { kiemMoiTruong, dungConfig, phanTichLuaChon } from '../src/ops/cai_dat.js';
import {
  dangNhapBangCookie, dangNhapBangQr, docPhien, luuPhien,
  layThongTinToi, layDanhSachNhom, apDungAnTrangThai,
} from '../src/zalo/session.js';

const THU_MUC_PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THU_MUC_DL = moRong(process.env.ZTL_DATA_DIR || '~/.zalo-tro-ly');
const F_CONFIG = process.env.ZTL_CONFIG
  ? moRong(process.env.ZTL_CONFIG)
  : path.join(THU_MUC_DL, 'assistant.config.json');
const F_SESSION = path.join(THU_MUC_DL, 'session.json');
const F_MAU = path.join(THU_MUC_PACK, 'config', 'assistant.config.example.json');

const out = (s = '') => process.stdout.write(`${s}\n`);
const gach = () => out('─'.repeat(64));

let rl;
const hoi = async (cau) => (await rl.question(cau)).trim();
const hoiCo = async (cau) => /^(c|y|có|co|ok|đồng ý|dong y)$/i.test(await hoi(`${cau} [c/k]: `));

function moAnh(duongDan) {
  // 🔴 CỔNG CHẶN LÚC CHẠY TEST — cùng khuôn `bin/zalo-login.js`.
  // Mở ảnh là CHẠM RA NGOÀI tiến trình: nó bật hẳn trình xem ảnh trên màn hình
  // người dùng. Bài test nào lỡ gọi tới đây ⛔ không được phép làm điều đó.
  if (dangChayTest()) {
    process.stderr.write(`[cai-dat] [CHẶN] đang chạy test -> KHÔNG mở ảnh QR: ${duongDan}\n`);
    return false;
  }
  const lenh = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(lenh, [duongDan], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

async function main() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  out('');
  gach();
  out('  CÀI ĐẶT TRỢ LÝ ZALO');
  gach();

  // ── ① Môi trường ────────────────────────────────────────────────────
  const kiem = kiemMoiTruong({ coNodeModules: fs.existsSync(path.join(THU_MUC_PACK, 'node_modules')) });
  if (!kiem.ok) {
    out('\n⛔ Chưa chạy được, còn thiếu:');
    for (const v of kiem.van) out(`   · ${v.loi}\n     -> ${v.cach}`);
    out('\nSửa xong rồi chạy lại: npm run cai-dat\n');
    rl.close();
    process.exitCode = 1;
    return;
  }
  out('\n✅ Bước 1/5 — máy đủ điều kiện chạy.');

  // ── ② Thư mục dữ liệu ───────────────────────────────────────────────
  fs.mkdirSync(THU_MUC_DL, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(THU_MUC_DL, 0o700); } catch { /* nuốt */ }
  out(`✅ Bước 2/5 — kho dữ liệu: ${THU_MUC_DL}`);
  out('   (Tin nhắn và phiên đăng nhập nằm ở đây, NGOÀI thư mục mã nguồn,');
  out('    nên không bao giờ bị đẩy nhầm lên mạng.)');

  // ── ③ Đăng nhập Zalo ────────────────────────────────────────────────
  out('\n── Bước 3/5 — đăng nhập Zalo ──');
  let api = null;
  let toi = null;

  const phienCu = await docPhien(F_SESSION).catch(() => null);
  if (phienCu) {
    try {
      api = await dangNhapBangCookie({ duongDan: { session: F_SESSION } });
      toi = await layThongTinToi(api);
      out(`✅ Đang đăng nhập sẵn: ${toi.ten ?? '(không rõ tên)'} — không cần quét QR lại.`);
    } catch {
      out('⚠️ Phiên cũ không dùng được nữa, phải quét QR lại.');
      api = null;
    }
  }

  if (!api) {
    out('\n📱 Chuẩn bị điện thoại có Zalo của BẠN (không phải của người khác).');
    out('   Ảnh mã QR sẽ tự mở ra. Trên điện thoại: Zalo -> dấu + -> Mã QR -> quét ảnh đó.');
    out('   Rồi bấm Đồng ý trên điện thoại.\n');
    await hoi('   Bấm Enter khi đã sẵn sàng… ');

    const qrPath = path.join(THU_MUC_DL, 'qr.png');
    const kq = await dangNhapBangQr({
      qrPath,
      khiCoSuKien: (loai, dl) => {
        if (loai === 'QR_DA_TAO') { out(`   Ảnh QR: ${dl.qrPath}`); moAnh(dl.qrPath); }
        else if (loai === 'QR_DA_QUET') out(`   ✅ Đã quét — xác nhận trên điện thoại giúp em (${dl?.ten ?? '?'})`);
        else if (loai === 'QR_HET_HAN') out('   ⛔ Mã QR hết hạn. Chạy lại: npm run cai-dat');
        else if (loai === 'QR_BI_TU_CHOI') out('   ⛔ Bị từ chối trên điện thoại.');
      },
    });
    api = kq.api;
    toi = await layThongTinToi(api);
    await luuPhien(F_SESSION, {
      cookie: kq.cookie, imei: kq.imei, userAgent: kq.userAgent,
      language: kq.language, userId: toi.userId, ten: toi.ten,
    });
    out(`✅ Đăng nhập xong: ${toi.ten ?? '(không rõ tên)'}`);
  }

  // ── ④ Chọn nhóm ─────────────────────────────────────────────────────
  out('\n── Bước 4/5 — chọn nhóm cho trợ lý nghe ──');
  const nhom = await layDanhSachNhom(api);
  if (!nhom.length) {
    out('   (Tài khoản này chưa ở trong nhóm nào. Không sao — sau này được thêm vào');
    out('    nhóm mới thì trợ lý tự hỏi bạn.)');
  } else {
    out(`   Bạn đang ở trong ${nhom.length} nhóm:\n`);
    nhom.forEach((n, i) => out(`   ${String(i + 1).padStart(2)}. ${n.ten || '(nhóm chưa đặt tên)'}`));
    out('');
    out('   🔴 QUAN TRỌNG: nhóm nào bạn chọn thì MỌI TIN trong nhóm đó sẽ được lưu lại,');
    out('      kể cả tin của người khác. Lưu rồi thì không xoá lại được.');
    out('      ⇒ Nên chọn ít trước. Sau này thêm lúc nào cũng được, không phải cài lại.');
    out('');
    out('   Gõ số nhóm muốn chọn, cách nhau bằng dấu phẩy (ví dụ: 1,3 hoặc 2-4).');
    out('   Bỏ trống rồi bấm Enter = chưa chọn nhóm nào.');
  }

  let chon = [];
  while (nhom.length) {
    const tra = await hoi('\n   Chọn nhóm: ');
    const kq = phanTichLuaChon(tra, nhom.length);
    if (!kq.ok) { out(`   ⚠️ ${kq.loi} — thử lại nhé.`); continue; }
    if (kq.chon.length === nhom.length && nhom.length > 1) {
      out(`   ⚠️ Bạn đang chọn TẤT CẢ ${nhom.length} nhóm — tin của mọi người trong mọi nhóm sẽ được lưu.`);
      if (!await hoiCo('   Chắc chưa?')) continue;
    }
    chon = kq.chon;
    break;
  }
  out(chon.length
    ? `   ✅ Đã chọn ${chon.length} nhóm.`
    : '   ✅ Chưa chọn nhóm nào — trợ lý vẫn chạy, chỉ chưa nghe nhóm nào.');

  // ── ⑤ Ghi cấu hình + tạo kho ────────────────────────────────────────
  out('\n── Bước 5/5 — ghi cấu hình và tạo kho ──');
  if (fs.existsSync(F_CONFIG)) {
    out(`   ⚠️ Đã có cấu hình cũ: ${F_CONFIG}`);
    if (!await hoiCo('   Ghi đè bằng cấu hình mới?')) {
      out('   -> Giữ nguyên cấu hình cũ, không đụng vào.');
      out('\n✅ Xong. Chạy trợ lý bằng: npm start\n');
      rl.close();
      return;
    }
    const luu = `${F_CONFIG}.cu-${Date.now()}`;
    fs.copyFileSync(F_CONFIG, luu);
    out(`   (Đã cất bản cũ ở ${luu} phòng khi cần lùi lại.)`);
  }

  const mau = JSON.parse(fs.readFileSync(F_MAU, 'utf8'));
  const cauHinh = dungConfig({ mau, toi, nhomChon: chon.map((i) => nhom[i]) });
  fs.writeFileSync(F_CONFIG, `${JSON.stringify(cauHinh, null, 2)}\n`, { mode: 0o600 });
  out(`   ✅ Đã ghi cấu hình: ${F_CONFIG}`);

  // 🔴 CHẠY `init-db` BẰNG TIẾN TRÌNH CON, ⛔ KHÔNG `import`.
  // `bin/init-db.js` là SCRIPT: nạp nó bằng import là chạy luôn `main()` của nó
  // trong tiến trình này, kèm cả `process.exit` của nó ⇒ trình cài đặt chết
  // giữa chừng ngay trước bước cuối, mà nhìn log thì tưởng đã xong.
  const maInit = await new Promise((giai) => {
    const con = spawn(process.execPath, [path.join(THU_MUC_PACK, 'bin', 'init-db.js')], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ZTL_CONFIG: F_CONFIG, ZTL_DATA_DIR: THU_MUC_DL },
    });
    let loi = '';
    con.stderr.on('data', (b) => { loi += String(b).slice(0, 400); });
    con.on('close', (ma) => { if (ma !== 0 && loi) out(`   (chi tiết: ${loi.trim().split('\n').slice(-2).join(' ')})`); giai(ma); });
    con.on('error', () => giai(1));
  });
  out(maInit === 0
    ? '   ✅ Đã tạo kho lịch sử.'
    : '   ⚠️ Chưa tạo được kho. Gõ thử: npm run init-db');

  // ⚠️ Cài đặt CẤP TÀI KHOẢN — hỏi, ⛔ không tự ý bật.
  out('');
  out('   Trợ lý có thể ẨN trạng thái "đang online" và "đã xem" của bạn.');
  out('   ⚠️ Đây là cài đặt của CẢ TÀI KHOẢN Zalo, áp cho mọi người và mọi thiết bị,');
  out('      kể cả khi bạn dùng Zalo trên điện thoại.');
  if (await hoiCo('   Bật ẩn?')) {
    await apDungAnTrangThai(api, true).catch(() => out('   (không bật được, bỏ qua)'));
    out('   ✅ Đã ẩn.');
  } else {
    out('   -> Giữ nguyên.');
  }

  gach();
  out('  ✅ CÀI XONG');
  gach();
  out('');
  out('  Chạy trợ lý:      npm start');
  out('  Kiểm tình trạng:  npm run health');
  out('');
  out('  Trợ lý sẽ nghe và lưu lịch sử các nhóm bạn vừa chọn, và trả lời khi');
  out('  bạn nhắc tên nó trong nhóm.');
  out('');
  rl.close();
}

main().catch((e) => {
  out('');
  out(`⛔ Cài đặt dừng giữa chừng: ${e?.message ?? e}`);
  out('   Chạy lại: npm run cai-dat  (đã làm được bước nào thì giữ nguyên bước đó)');
  out('');
  try { rl?.close(); } catch { /* nuốt */ }
  process.exitCode = 1;
});
