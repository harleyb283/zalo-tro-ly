#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * G6 — NHẮC NHỞ. Script chạy tay/cron ⇒ ĐƯỢC in stdout.
 *
 * ═══ LỊCH NHẮC NẰM Ở ĐÂU: TRONG CRONTAB, KHÔNG Ở ĐÂU KHÁC ═══
 * Spec G anh chốt: *"Nhắc nhở dựa vào đâu → **Cron trên máy người dùng**"*.
 * Đọc đúng nghĩa đen thì **crontab CHÍNH LÀ kho lịch**: dòng cron giữ THỜI
 * ĐIỂM, tham số `--text` giữ NỘI DUNG. Script này chỉ làm đúng một việc:
 * "tới giờ rồi, gửi câu này cho host".
 *
 *   0 8 * * *   cd <pack> && $(which node) bin/zalo-remind.js --text "Sáng rồi anh ơi"
 *   0 17 * * 5  cd <pack> && $(which node) bin/zalo-remind.js --tu-file nhac/thu6.txt
 *
 * ⛔ CỐ Ý KHÔNG đẻ ra định dạng lịch riêng (file YAML/JSON danh sách nhắc +
 *    bộ so giờ). Hợp đồng G0 KHÔNG có bảng nào, kiểu nào, hay trường config
 *    nào cho việc này — tự nghĩ ra một định dạng mới là ép 7 gói còn lại phải
 *    theo một thứ chưa ai duyệt. Nếu về sau anh muốn "sổ nhắc" thật thì đó là
 *    thay đổi HỢP ĐỒNG, phải qua Router. **Đã báo Router.**
 *
 * 🔴 CHỖ CHƯA CHẮC — ĐỌC TRƯỚC KHI CẮM VÀO CRON:
 *    Script này phải ĐĂNG NHẬP ZALO bằng cookie đã lưu để gửi được tin. Mà
 *    tài khoản Zalo chỉ có MỘT suất "máy tính". Chưa ai xác minh được rằng
 *    một lần đăng nhập thứ hai — CÙNG cookie, CÙNG imei, CÙNG User-Agent —
 *    có đá phiên của daemon đang chạy hay không.
 *    · Lập luận nghiêng về AN TOÀN: định danh thiết bị của Zalo là `imei`, ở
 *      đây hai bên dùng chung một `imei` trong cùng file phiên ⇒ Zalo nhiều
 *      khả năng coi là CÙNG một thiết bị.
 *    · Nhưng đó là **PHỎNG ĐOÁN**, chưa đo. Không đo được nếu không đăng nhập
 *      thật — việc mà gói này bị cấm làm.
 *    ⇒ Dùng `--kiem-tra` để dựng và thử toàn bộ đường dây mà KHÔNG đăng nhập.
 *      Chỉ cắm lịch thật sau khi đã chạy tay một lần và thấy daemon vẫn nghe
 *      được tin. Đây là mốc M1, cần anh ngồi trước máy đúng một lần.
 *
 * MÃ THOÁT:
 *    0  đã gửi (hoặc --kiem-tra qua hết)
 *    1  lỗi bất ngờ
 *    2  cấu hình sai
 *    3  không đăng nhập được (cookie chết) — cần `node bin/zalo-login.js`
 *    9  thiếu/sai tham số
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { docCauHinh, layDmHost, danhSachHostUserId, layNhom } from '../src/policy/access.js';
import { moRong } from '../src/lib/duong_dan.js';
import { ghiLogAnToan } from '../src/lib/redact.js';
import { GIOI_HAN } from '../src/lib/hang_so.js';
import { dangNhapBangCookie, LoiPhienZalo } from '../src/zalo/session.js';
import { daemonDangChay } from '../src/ops/health.js';
import { TRANG_THAI_SUC_KHOE } from '../src/lib/hang_so.js';
import { guiDmHost, guiVaoNhom, catAnToan } from '../src/zalo/send.js';

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

export const MA = Object.freeze({
  OK: 0, LOI: 1, CAU_HINH: 2, CAN_QR: 3, THAM_SO: 9,
});

function docThamSo(argv) {
  const t = {
    text: null, tuFile: null, nhom: null, host: null,
    kiemTra: false, imLang: false, config: null, help: false, duBietRuiRo: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--text') t.text = argv[++i];
    else if (a === '--tu-file') t.tuFile = argv[++i];
    else if (a === '--nhom') t.nhom = argv[++i];
    else if (a === '--host') t.host = argv[++i];
    else if (a === '--kiem-tra' || a === '--dry-run') t.kiemTra = true;
    else if (a === '--du-biet-rui-ro') t.duBietRuiRo = true;
    else if (a === '--im-lang' || a === '--quiet') t.imLang = true;
    else if (a === '--config') t.config = argv[++i];
    else if (a === '-h' || a === '--help') t.help = true;
    else throw new Error(`Tham số lạ: ${a}  (xem --help)`);
  }
  return t;
}

function inHelp() {
  out(`
zalo-remind — gửi một lời nhắc cho host (lịch nằm trong CRONTAB)

  node bin/zalo-remind.js --text "Nội dung nhắc"
  node bin/zalo-remind.js --tu-file nhac/sang.txt
  node bin/zalo-remind.js --text "..." --nhom <chatId>    gửi vào nhóm thay vì DM
  node bin/zalo-remind.js --text "..." --kiem-tra         thử KHÔNG đăng nhập

  --host <userId>   chọn host cụ thể (mặc định: host đầu tiên trong config)
  --im-lang         không in gì khi thành công (hợp với cron)
  --config <p>      file cấu hình khác
  --du-biet-rui-ro  vẫn gửi dù daemon đang chạy (MẶC ĐỊNH TỪ CHỐI — xem dưới)

CÁCH ĐẶT LỊCH — crontab CHÍNH LÀ kho lịch, không có file lịch riêng:
  0 8 * * *    cd <pack> && $(which node) bin/zalo-remind.js --im-lang --text "Sáng rồi anh"
  30 16 * * 5  cd <pack> && $(which node) bin/zalo-remind.js --im-lang --tu-file nhac/thu6.txt

🔴 TRƯỚC KHI CẮM VÀO CRON: script phải đăng nhập Zalo để gửi được tin, mà tài
   khoản chỉ có MỘT suất "máy tính". Chưa xác minh được lần đăng nhập thứ hai
   (cùng cookie/imei/UA) có đá phiên daemon hay không.
   ⇒ Chạy TAY một lần trước, rồi kiểm daemon còn nhận được tin không.
   ⇒ Chạy thử an toàn: thêm --kiem-tra (không đăng nhập).

Mã thoát: 0 đã gửi · 1 lỗi (gồm cả "từ chối vì daemon đang chạy" và lỗi MẠNG)
          · 2 cấu hình · 3 cần quét QR THẬT (chưa từng đăng nhập / cookie chết) · 9 tham số

🔴 Daemon đang chạy thì script này TỪ CHỐI GỬI. Nó phải đăng nhập Zalo lần thứ
   hai, mà tài khoản chỉ có MỘT suất "máy tính" — chưa ai đo được là có đá phiên
   daemon hay không, và đá nhầm thì trợ lý ngưng nghe tin theo kiểu hỏng CÂM.
`.trim());
}

/**
 * Lấy nội dung nhắc. Hàm THUẦN để test được.
 * @param {{text: string|null, tuFile: string|null}} t
 * @returns {string}
 */
export function layNoiDung(t) {
  if (t.text && t.tuFile) {
    throw new Error('Chỉ được dùng MỘT trong hai: --text hoặc --tu-file');
  }
  let s = t.text;
  if (t.tuFile) {
    const p = moRong(t.tuFile);
    if (!fs.existsSync(p)) throw new Error(`Không thấy file nội dung: ${p}`);
    s = fs.readFileSync(p, 'utf8');
  }
  s = (s ?? '').trim();
  if (!s) {
    // Gửi một tin RỖNG vào nhóm/DM là chuyện rất khó chịu và rất khó lần ra
    // nguyên nhân. Thà không gửi.
    throw new Error('Nội dung nhắc rỗng — cần --text "..." hoặc --tu-file <p>');
  }
  return s;
}

/**
 * Quyết định gửi ĐI ĐÂU. Hàm THUẦN.
 *
 * Mặc định là DM host chứ KHÔNG phải nhóm: lời nhắc là việc riêng của host.
 * Bắn nhầm vào nhóm thì cả nhóm đọc được lịch cá nhân của anh — hỏng theo kiểu
 * không rút lại được.
 *
 * @param {import('../src/types.d.ts').CauHinh} cauHinh
 * @param {{nhom: string|null, host: string|null}} t
 * @returns {{loai: 'nhom'|'dm', chatId: string, nhan: string}}
 */
export function chonDich(cauHinh, t) {
  if (t.nhom) {
    const n = layNhom(cauHinh, t.nhom);
    if (!n) {
      // Không cho gửi vào nhóm LẠ: allowlist là allowlist, kể cả chiều gửi ra.
      throw new Error(
        `Nhóm ${t.nhom} không có trong config.groups[] — từ chối gửi. `
        + 'Thêm nhóm vào config trước, hoặc bỏ --nhom để gửi DM cho host.',
      );
    }
    return { loai: 'nhom', chatId: n.chatId, nhan: n.ten || n.chatId };
  }

  const ds = danhSachHostUserId(cauHinh) ?? [];
  const uid = t.host || ds[0];
  if (!uid) throw new Error('config.hosts[] rỗng — không biết nhắc cho ai');
  if (t.host && !ds.includes(t.host)) {
    throw new Error(`--host ${t.host} không có trong config.hosts[]`);
  }
  const dm = layDmHost(cauHinh, uid);
  if (!dm) {
    throw new Error(
      `Host ${uid} chưa có dmChatId trong config. Điền hosts[].dmChatId — `
      + 'đó là threadId của cuộc trò chuyện riêng giữa anh và trợ lý.',
    );
  }
  return { loai: 'dm', chatId: dm, nhan: uid };
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

  let noiDung;
  let dich;
  try {
    noiDung = layNoiDung(t);
    dich = chonDich(cauHinh, t);
  } catch (e) {
    err(`⛔ ${e.message}`);
    return MA.THAM_SO;
  }

  // ⚠️ `catAnToan()` trả về OBJECT `{text, daCat, doDaiGoc}`, KHÔNG phải chuỗi.
  //    Dùng nhầm như chuỗi thì `.slice` không tồn tại và script chết ở đúng
  //    bước cuối — bản unit test không bắt được vì nó không đi qua main().
  // ⚠️ Ở đây CHỈ dùng để XEM TRƯỚC. Bước gửi thật (`guiDmHost`/`guiVaoNhom`
  //    trong send.js) đã tự cắt rồi; cắt hai lần là dán hai lần cái đuôi
  //    "…[cắt bớt]".
  const xemTruoc = catAnToan(noiDung, GIOI_HAN.DO_DAI_TIN_TOI_DA);

  if (t.kiemTra) {
    // Kiểm được TẤT CẢ trừ đúng bước chạm mạng: cấu hình đọc được, đích hợp lệ,
    // nội dung không rỗng, phiên có tồn tại không. Đủ để dựng dòng cron yên tâm.
    out('═══ KIỂM TRA (KHÔNG đăng nhập, KHÔNG gửi) ═══');
    out(`  gửi tới : ${dich.loai === 'dm' ? 'DM host' : 'nhóm'} ${dich.nhan} (${dich.chatId})`);
    out(`  độ dài  : ${noiDung.length} ký tự${xemTruoc.daCat ? ' → sẽ bị CẮT bớt' : ''}`);
    out(`  nội dung: ${xemTruoc.text.slice(0, 200)}${xemTruoc.text.length > 200 ? '…' : ''}`);
    const ps = moRong(cauHinh.duongDan.session);
    const coPhien = fs.existsSync(ps);
    // ⚠️ "Không có FILE phiên" nghĩa là CHƯA TỪNG ĐĂNG NHẬP trên máy này —
    // KHÔNG phải "cookie đã chết". Câu chữ phải tách hai ca đó ra, vì lời
    // khuyên cho chúng khác nhau và một trong hai lời khuyên (quét QR) sẽ
    // ĐÁ VĂNG phiên đang khoẻ nếu dùng nhầm chỗ.
    out(`  phiên   : ${coPhien ? 'CÓ file' : '⛔ CHƯA CÓ FILE — chưa từng đăng nhập trên máy này'} (${ps})`);
    const dt = daemonDangChay(cauHinh);
    out(`  daemon  : ${dt.lyDo}`);
    out('');
    if (!coPhien) {
      out('  ⚠️ Chưa từng đăng nhập ⇒ chạy: node bin/zalo-login.js (đây là lần đầu, KHÔNG phải cookie hết hạn)');
    } else {
      out('  ✅ Mọi thứ trừ bước gửi đều ổn.');
    }
    return coPhien ? MA.OK : MA.CAN_QR;
  }

  // 🔴 CHỐT CHẶN THÊM 20/08/2026 — KHÔNG đăng nhập lần hai khi daemon còn sống.
  // Đầu file này đã thú nhận: chưa ai ĐO được lần đăng nhập thứ hai có đá phiên
  // daemon hay không, mà tài khoản chỉ có MỘT suất "máy tính". Rủi ro thì thật,
  // lợi ích thì bằng không (chờ vài phút chạy lại là được), nên mặc định TỪ CHỐI.
  // Muốn thử để ĐO thì phải nói rõ ý định bằng --du-biet-rui-ro — cố ý bắt gõ
  // dài, để không ai vô tình cắm nó vào crontab.
  const dt = daemonDangChay(cauHinh);
  if (dt.song === true && !t.duBietRuiRo) {
    err(`⛔ TỪ CHỐI GỬI: ${dt.lyDo}.`);
    err('   Script này phải đăng nhập Zalo lần thứ hai để gửi, mà tài khoản chỉ có MỘT suất');
    err('   "máy tính" — chưa ai đo được là có đá phiên của daemon hay không. Đá nhầm thì');
    err('   trợ lý ngưng nghe tin, và đó là hỏng CÂM (vẫn chạy, chỉ không nhận được gì).');
    err('   · Muốn nhắc mà không rủi ro: để trợ lý tự gửi qua tool, hoặc dừng daemon trước.');
    err('   · Muốn ĐO xem có đá thật không: thêm --du-biet-rui-ro và ngồi canh log daemon.');
    return MA.LOI;
  }
  if (dt.song === true && t.duBietRuiRo) {
    err('⚠️ --du-biet-rui-ro: vẫn đăng nhập lần hai dù daemon đang chạy. Theo dõi xem');
    err('   daemon có bị đá không — đây chính là phép đo còn thiếu, ghi lại kết quả.');
  }

  let api;
  try {
    // ⚠️ Xem cảnh báo đầu file: đây là lần đăng nhập THỨ HAI trong khi daemon
    // có thể đang chạy. Cùng cookie/imei/UA nên NHIỀU KHẢ NĂNG Zalo coi là cùng
    // thiết bị — nhưng chưa đo được.
    api = await dangNhapBangCookie(cauHinh);
  } catch (e) {
    if (e instanceof LoiPhienZalo) {
      err(`⛔ ${e.message}`);
      // Lỗi MẠNG không phải bằng chứng cookie chết ⇒ KHÔNG trả mã "cần quét QR".
      // Trả nhầm mã ở đây là cron/người vận hành đi quét QR oan, và quét QR khi
      // phiên còn sống thì đá văng chính phiên đó.
      return e.maSucKhoe === TRANG_THAI_SUC_KHOE.CAN_QR ? MA.CAN_QR : MA.LOI;
    }
    err(`⛔ Không đăng nhập được: ${ghiLogAnToan(e)}`);
    return MA.LOI;
  }

  try {
    // Truyền NGUYÊN VĂN: send.js tự cắt và báo lại `daCat`.
    const kq = dich.loai === 'nhom'
      ? await guiVaoNhom(api, dich.chatId, noiDung)
      : await guiDmHost(api, dich.chatId, noiDung);
    if (!t.imLang) {
      out(`✅ Đã nhắc ${dich.loai === 'dm' ? 'DM host' : `nhóm ${dich.nhan}`}`
        + `${kq.msgId ? ` (msgId ${kq.msgId})` : ''}${kq.daCat ? ' — nội dung đã bị cắt' : ''}`);
    }
    return MA.OK;
  } catch (e) {
    // Gửi hỏng thì PHẢI kêu: cron chỉ đọc được mã thoát, im lặng ở đây nghĩa là
    // lời nhắc bốc hơi mà không ai hay.
    err(`⛔ Gửi thất bại: ${ghiLogAnToan(e)}`);
    return MA.LOI;
  }
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
