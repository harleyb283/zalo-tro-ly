#!/usr/bin/env node
/**
 * CHỦ SỞ HỮU: G9. Xuất SQLite → .md để anh đọc bằng mắt.
 *
 * · Chỉ ĐỌC DB, không đụng gì khác ⇒ làm được ngay khi G3 xong, KHÔNG cần chờ G8.
 * · Nghiệm thu: số tin trong file .md khớp `SELECT count(*)` trong DB.
 * · Tin đã thu hồi phải hiện RÕ là đã thu hồi kèm nội dung cũ — đó là lý do
 *   tồn tại của cả tính năng này.
 *
 * Script chạy tay ⇒ ĐƯỢC in stdout (ngoại lệ duy nhất của luật stdout, xem
 * CANH_BAO_STDOUT trong src/lib/hang_so.js).
 *
 * ═══ 4 QUYẾT ĐỊNH ĐÁNG ĐỌC TRƯỚC KHI SỬA FILE NÀY ═══
 *
 * 1. 🔴 MỞ DB Ở CHẾ ĐỘ READONLY THẬT (`new DatabaseSync(p, { readOnly: true })`).
 *    Đo trên Node v26.7.0: mở được, `INSERT` bị chặn bằng ERR_SQLITE_ERROR, và
 *    `db.function()` vẫn đăng ký được. CỐ Ý KHÔNG dùng `openDb()` của G3 — hàm đó
 *    mở đọc-ghi VÀ chạy `migrate()`. Một công cụ "xem lại lịch sử" mà lỡ tay
 *    migrate kho của anh là chuyện không được phép xảy ra.
 *
 * 2. 🔴 KHÔNG JOIN `conversations.listened = 1` như `store/query.js`.
 *    `query.js` fail-closed vì nó phục vụ MODEL (nhóm rời allowlist thì model
 *    không được đọc nữa). File này phục vụ CHÍNH ANH, chạy tay trên máy anh:
 *    lọc mất tin của nhóm đã rời allowlist là GIẤU DỮ LIỆU của chủ sở hữu.
 *    Thay vào đó, hội thoại có `listened = 0` được xuất kèm ghi chú.
 *
 * 3. 🔴 `--so N` lấy N tin MỚI NHẤT rồi in theo thứ tự TĂNG DẦN.
 *    Viết thẳng `ORDER BY ts_zalo ASC LIMIT N` là lấy nhầm N tin CŨ NHẤT —
 *    trông vẫn "chạy đúng", chỉ là trả lời sai câu hỏi. Nên: DESC + LIMIT ở
 *    SQL, rồi `reverse()` trong JS.
 *
 * 4. 🔴 `--den 2026-08-20` phải bao TRỌN ngày 20 THEO MÚI GIỜ HIỂN THỊ.
 *    `Date.parse('2026-08-20')` = 00:00 UTC = 07:00 giờ VN ⇒ cắt mất gần cả
 *    ngày mà không báo gì. Xem `dayBoundary()`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { expandPath } from '../src/lib/paths.js';
import { toId } from '../src/lib/ids.js';
import { tightenPermissions } from '../src/store/db.js';

const PACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_MAC_DINH = '~/.zalo-tro-ly/lichsu.db';

/** Nhãn cho các msgType đã xác minh; loại lạ giữ nguyên tên gốc, KHÔNG đoán. */
const NHAN_LOAI = Object.freeze({
  'chat.text': null,          // null = in nội dung thẳng
  'chat.image': 'ảnh',
  'chat.link': 'liên kết',
});

// ═══════════════════════════════════════════════════════════════════════
// Tham số dòng lệnh
// ═══════════════════════════════════════════════════════════════════════

const GIUP = `Xuất lịch sử Zalo đã lưu ra Markdown để đọc bằng mắt.

  node bin/zalo-export.js --danh-sach
  node bin/zalo-export.js --chat <chatId> [--tu 2026-08-01] [--den 2026-08-20] [--so 200] [--ra lichsu.md]

  --danh-sach     Liệt kê các hội thoại đang có trong kho (kèm số tin, khoảng thời gian)
  --chat <id>     Chỉ xuất một hội thoại. Bỏ trống = xuất TẤT CẢ
  --tu <ngày>     Từ ngày (YYYY-MM-DD hoặc ISO đầy đủ). Ngày trần = 00:00 theo múi giờ hiển thị
  --den <ngày>    Đến ngày. Ngày trần = 23:59:59.999 theo múi giờ hiển thị (bao TRỌN ngày đó)
  --so <N>        Chỉ lấy N tin MỚI NHẤT (vẫn in theo thứ tự thời gian tăng dần)
  --ra <file>     Ghi ra file. Bỏ trống = in ra màn hình
  --db <đường>    Đường dẫn DB. Mặc định: ZTL_DB > config > ${DB_MAC_DINH}
  --tz <vùng>     Múi giờ hiển thị, vd Asia/Ho_Chi_Minh. Mặc định = múi giờ máy
  --giup          In trợ giúp này

DB luôn được mở ở chế độ CHỈ ĐỌC.`;

/**
 * @param {string[]} argv
 * @returns {Record<string, string|boolean>}
 */
export function parseArgs(argv) {
  const ra = {};
  const co = new Set(['--danh-sach', '--giup', '-h', '--help']);
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--') && t !== '-h') continue;
    const ten = t.replace(/^--/, '').replace(/^-h$/, 'giup');
    if (co.has(t)) {
      ra[ten === 'help' ? 'giup' : ten] = true;
      continue;
    }
    const kt = argv[i + 1];
    if (kt === undefined || kt.startsWith('--')) {
      throw new Error(`Tham số ${t} thiếu giá trị.`);
    }
    ra[ten] = kt;
    i += 1;
  }
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════
// Thời gian
// ═══════════════════════════════════════════════════════════════════════

/**
 * Độ lệch múi giờ (phút) của một vùng tại một thời điểm.
 * Tính bằng Intl chứ không hardcode +7: người khác clone pack về dùng ở vùng
 * khác, và có vùng đổi giờ theo mùa.
 * @param {number} ms
 * @param {string} tz
 * @returns {number} phút, vd 420 cho UTC+07:00
 */
export function tzOffsetMinutes(ms, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms))
    .find((x) => x.type === 'timeZoneName');
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(p?.value ?? '');
  if (!m) return 0;   // 'GMT' trần = UTC
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Chuỗi ngày/giờ người dùng gõ -> epoch ms.
 *
 * 🔴 Dạng NGÀY TRẦN (`2026-08-20`) được hiểu theo MÚI GIỜ HIỂN THỊ, không phải
 * UTC: `Date.parse('2026-08-20')` ra 00:00 UTC = 07:00 giờ VN, tức `--den` cắt
 * mất 17 tiếng cuối ngày và `--tu` nuốt 7 tiếng đầu ngày — sai lặng lẽ, không
 * có lỗi nào.
 *
 * @param {string} chuoi
 * @param {string} tz
 * @param {boolean} cuoiNgay  true = 23:59:59.999 của ngày đó
 * @returns {number}
 */
export function dayBoundary(chuoi, tz, cuoiNgay = false) {
  const s = String(chuoi).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) {
      throw new Error(`Không đọc được mốc thời gian: '${chuoi}' (dùng YYYY-MM-DD hoặc ISO đầy đủ).`);
    }
    return t;
  }
  const [, y, thang, ngay] = m.map(Number);
  const gio = cuoiNgay ? [23, 59, 59, 999] : [0, 0, 0, 0];
  const utcTam = Date.UTC(y, thang - 1, ngay, ...gio);
  // Lấy độ lệch TẠI CHÍNH NGÀY ĐÓ (không phải hôm nay) — vùng có đổi giờ theo
  // mùa thì lệch tháng 1 khác lệch tháng 7.
  return utcTam - tzOffsetMinutes(utcTam, tz) * 60_000;
}

/**
 * @param {number} ms
 * @param {string} tz
 * @returns {{ngay: string, tieuDeNgay: string, gio: string}}
 */
export function formatTime(ms, tz) {
  const d = new Date(ms);
  const bo = (o) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(d);
  return {
    ngay: bo({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    tieuDeNgay: new Intl.DateTimeFormat('vi-VN', {
      timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(d),
    gio: bo({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  };
}

function nhanLech(phut) {
  const dau = phut < 0 ? '-' : '+';
  const a = Math.abs(phut);
  return `UTC${dau}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Mở DB — CHỈ ĐỌC
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tìm đường dẫn DB. Thứ tự: --db > env ZTL_DB > config > mặc định.
 * Trả kèm NGUỒN để in ra — người dùng phải biết mình đang đọc kho nào, nhất là
 * khi máy có nhiều bản.
 * @param {Record<string, any>} ts
 * @returns {{duongDan: string, nguon: string}}
 */
export function findDbPath(ts) {
  if (ts.db) return { duongDan: expandPath(String(ts.db)), nguon: '--db' };
  if (process.env.ZTL_DB) return { duongDan: expandPath(process.env.ZTL_DB), nguon: 'env ZTL_DB' };
  try {
    // Đọc config chỉ để LẤY ĐƯỜNG DẪN. Config hỏng/thiếu không được chặn việc
    // xem lại lịch sử — đây là công cụ đọc, không phải tiến trình chạy nền.
    const f = process.env.ZTL_CONFIG
      ? expandPath(process.env.ZTL_CONFIG)
      : path.join(PACK_ROOT, 'config', 'assistant.config.json');
    if (fs.existsSync(f)) {
      const ch = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (ch?.duongDan?.db) return { duongDan: expandPath(ch.duongDan.db), nguon: `config ${f}` };
    }
  } catch (e) {
    process.stderr.write(`[export] không đọc được config (bỏ qua): ${e.message}\n`);
  }
  return { duongDan: expandPath(DB_MAC_DINH), nguon: 'mặc định' };
}

/**
 * @param {string} duongDan
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openReadOnly(duongDan) {
  if (!fs.existsSync(duongDan)) {
    throw new Error(
      `Không thấy file DB: ${duongDan}\n` +
        '  Trợ lý đã chạy lần nào chưa? Chỉ đường khác bằng --db <đường dẫn>.',
    );
  }
  const db = new DatabaseSync(duongDan, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');

  // 🔴 ĐO THẬT: mở CHỈ ĐỌC một DB đang ở chế độ WAL vẫn khiến SQLite TẠO
  // `<db>-shm` (và `<db>-wal` rỗng) nếu chúng chưa tồn tại — theo umask, tức
  // thường là 0644. Đúng ca hay xảy ra nhất: anh chạy tay lệnh này lúc trợ lý
  // KHÔNG chạy, nên không ai siết quyền sau đó cả.
  // `tightenPermissions()` là hàm G3 export sẵn cho đúng việc này. Nó chỉ SIẾT CHẶT,
  // không bao giờ nới, và không đụng một byte dữ liệu nào — nên vẫn đúng lời
  // hứa "chỉ đọc DB".
  try {
    tightenPermissions(duongDan);
  } catch (e) {
    process.stderr.write(`[export] không siết được quyền file WAL (bỏ qua): ${e.message}\n`);
  }
  return db;
}

// ═══════════════════════════════════════════════════════════════════════
// Truy vấn
// ═══════════════════════════════════════════════════════════════════════

function dieuKien(loc) {
  const dk = [];
  const bien = {};
  if (loc.chatId) {
    dk.push('t.chat_id = $chat_id');
    bien.chat_id = loc.chatId;
  }
  if (loc.tu !== null && loc.tu !== undefined) {
    dk.push('t.ts_zalo >= $tu');
    bien.tu = loc.tu;
  }
  if (loc.den !== null && loc.den !== undefined) {
    dk.push('t.ts_zalo <= $den');
    bien.den = loc.den;
  }
  return { menh: dk.length ? ` WHERE ${dk.join(' AND ')}` : '', bien };
}

/**
 * -> { tin, tongKhopBoLoc }.
 *
 * `tongKhopBoLoc` đếm bằng câu SQL RIÊNG, KHÔNG suy ra từ mảng đã lấy — đó
 * chính là phép đối chiếu chống lệch âm thầm mà nghiệm thu đòi.
 */
export function fetchMessages(db, loc) {
  const { menh, bien } = dieuKien(loc);
  const tong = Number(
    db.prepare(`SELECT count(*) AS c FROM messages t${menh}`).get(bien)?.c ?? 0,
  );

  const gioiHan = Number.isFinite(loc.soLuong) && loc.soLuong > 0 ? Math.floor(loc.soLuong) : null;
  // DESC + LIMIT rồi reverse: xem quyết định số 3 ở đầu file.
  const sql =
    `SELECT t.* FROM messages t${menh} ORDER BY t.ts_zalo DESC, t.msg_id DESC` +
    (gioiHan ? ' LIMIT $gioi_han' : '');
  const rows = db.prepare(sql).all(gioiHan ? { ...bien, gioi_han: gioiHan } : bien);
  return { tin: rows.reverse(), tongKhopBoLoc: tong };
}

/** Sự kiện thu hồi theo (chat_id, target_msg_id) — để biết AI thu hồi và LÚC NÀO. */
export function recallTable(db, chatId) {
  const rows = chatId
    ? db.prepare('SELECT * FROM recall_events WHERE chat_id = ?').all(chatId)
    : db.prepare('SELECT * FROM recall_events').all();
  const ra = new Map();
  for (const r of rows) ra.set(`${r.chat_id}|${r.target_msg_id}`, r);
  return ra;
}

export function conversationTable(db) {
  const ra = new Map();
  for (const r of db.prepare('SELECT * FROM conversations').all()) ra.set(String(r.chat_id), r);
  return ra;
}

export function peopleTable(db) {
  const ra = new Map();
  for (const r of db.prepare('SELECT * FROM people').all()) ra.set(String(r.user_id), r);
  return ra;
}

/** Danh sách hội thoại + số tin + khoảng thời gian, cho `--danh-sach`. */
export function listConversations(db) {
  return db.prepare(`
    SELECT h.chat_id, h.name, h.kind, h.listened,
           count(t.msg_id) AS so_tin,
           min(t.ts_zalo)  AS som_nhat,
           max(t.ts_zalo)  AS muon_nhat,
           sum(t.recalled) AS so_thu_hoi
    FROM conversations h LEFT JOIN messages t ON t.chat_id = h.chat_id
    GROUP BY h.chat_id
    UNION ALL
    -- Hội thoại có tin nhưng CHƯA có dòng trong conversations: vẫn phải hiện, nếu
    -- không thì tin nằm trong kho mà không ai biết đường nào tra ra.
    SELECT t.chat_id, NULL, NULL, NULL,
           count(*), min(t.ts_zalo), max(t.ts_zalo), sum(t.recalled)
    FROM messages t
    WHERE t.chat_id NOT IN (SELECT chat_id FROM conversations)
    GROUP BY t.chat_id
    ORDER BY muon_nhat DESC
  `).all();
}

// ═══════════════════════════════════════════════════════════════════════
// Dựng Markdown
// ═══════════════════════════════════════════════════════════════════════

/** Nội dung tin -> khối blockquote, giữ nguyên xuống dòng, không phá cấu trúc .md */
function trichDan(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((d) => `> ${d}`)
    .join('\n');
}

/**
 * Nhãn loại tin cho các tin KHÔNG phải text.
 * msgType lạ ⇒ lấy tên gốc từ `content_raw._msgTypeGoc` (G2 cố ý giữ lại), chứ
 * KHÔNG đoán tên. Không có thì nói thẳng là không rõ.
 */
export function messageKindLabel(r) {
  const loai = String(r.msg_type ?? '');
  if (loai in NHAN_LOAI && NHAN_LOAI[loai] !== null) return NHAN_LOAI[loai];
  if (loai === 'UNKNOWN' || !(loai in NHAN_LOAI)) {
    let goc = null;
    try {
      goc = JSON.parse(r.content_raw ?? 'null')?._msgTypeGoc ?? null;
    } catch { /* content_raw hỏng thì thôi, không được nổ vì một dòng */ }
    return goc ? `loại khác: ${goc}` : 'loại khác: không rõ';
  }
  return loai;
}

/**
 * Tên người gửi — LUÔN dùng `name_at_send` (ảnh chụp lúc gửi).
 * ⚠️ CỐ Ý KHÔNG tra `people.display_name`: người đổi tên thì lịch sử phải giữ
 * nguyên bối cảnh lúc đó, nếu không đọc lại sẽ hiểu sai ai nói câu gì.
 */
export function senderName(r) {
  if (r.made_by_assistant === 1) return 'Trợ lý (tự gửi)';
  const ten = (r.name_at_send ?? '').trim();
  if (ten) return ten;
  const uid = toId(r.user_id, 'export.user_id');
  return uid ? `<${uid}>` : '<không rõ người gửi>';
}

/**
 * Ai thu hồi. Nguồn tin cậy giảm dần, và LUÔN nói rõ đang dùng nguồn nào —
 * cấm để người đọc tưởng đây là tên lúc thu hồi trong khi thực ra là tên hiện tại.
 */
export function recallerName(r, sk, nguoi) {
  const boi = toId(sk?.recaller_id ?? r.recalled_by, 'export.recalled_by');
  const tenLuu = (sk?.recaller_name ?? '').trim();
  if (tenLuu) return tenLuu;
  if (!boi) return 'không rõ ai';
  if (boi === toId(r.user_id, 'export.user_id')) return `${senderName(r)} (chính người gửi)`;
  const ht = (nguoi.get(boi)?.display_name ?? '').trim();
  return ht ? `${ht} (tên HIỆN TẠI, không phải tên lúc thu hồi)` : `<${boi}>`;
}

/**
 * @param {object} p
 * @returns {{md: string, soTinDaIn: number, soThuHoi: number, lech: boolean}}
 */
export function buildMarkdown(p) {
  const { tin, tongKhopBoLoc, thuHoi, hoiThoai, nguoi, loc, tz, duongDanDb, nguonDb, bayGio } = p;
  const lech = Number(tzOffsetMinutes(bayGio, tz));
  const d = [];

  const nhieuHoiThoai = !loc.chatId;
  const ht = loc.chatId ? hoiThoai.get(loc.chatId) : null;
  const tenHt = (ht?.ten ?? '').trim() || (loc.chatId ? `<${loc.chatId}>` : 'TẤT CẢ hội thoại');

  d.push(`# Lịch sử Zalo — ${tenHt}`, '');
  if (loc.chatId) {
    d.push(`- **Hội thoại:** ${tenHt} (\`${loc.chatId}\`${ht?.kind ? `, ${ht.kind}` : ''})`);
    if (ht && Number(ht.listened) === 0) {
      d.push('- ⚠️ Hội thoại này **không còn trong danh sách nghe** — tin cũ vẫn được xuất đầy đủ.');
    }
    if (!ht) {
      d.push('- ⚠️ Không có dòng nào trong bảng `conversations` cho mã này (tin vẫn còn trong kho).');
    }
  } else {
    d.push('- **Hội thoại:** TẤT CẢ (không lọc theo `--chat`)');
  }
  d.push(
    `- **Khoảng lọc:** ${loc.tu === null ? 'từ đầu' : formatTime(loc.tu, tz).ngay}` +
      ` → ${loc.den === null ? 'tới nay' : formatTime(loc.den, tz).ngay}`,
  );

  const soThuHoi = tin.filter((r) => Number(r.recalled) === 1).length;
  const monG = Number.isFinite(loc.soLuong) && loc.soLuong > 0
    ? Math.min(tongKhopBoLoc, Math.floor(loc.soLuong))
    : tongKhopBoLoc;
  const khop = tin.length === monG;

  d.push(
    `- **Số tin xuất ra:** ${tin.length}` +
      ` — đối chiếu \`count(*)\` cùng bộ lọc: **${tongKhopBoLoc}**` +
      (loc.soLuong ? ` (giới hạn \`--so ${loc.soLuong}\` ⇒ mong đợi ${monG})` : '') +
      (khop ? ' ✅ khớp' : ' ❌ **LỆCH — ĐỪNG TIN FILE NÀY**'),
  );
  d.push(`- **Trong đó đã thu hồi:** ${soThuHoi}`);
  d.push(`- **Múi giờ hiển thị:** ${tz} (${nhanLech(lech)})`);
  d.push(`- **Xuất lúc:** ${formatTime(bayGio, tz).ngay} ${formatTime(bayGio, tz).gio}`);
  d.push(`- **Nguồn:** \`${duongDanDb}\` (mở CHỈ ĐỌC, chọn theo ${nguonDb})`);
  d.push('');
  d.push(
    '> ⚠️ Kho chỉ có tin **từ lúc trợ lý bắt đầu nghe** — Zalo không cho lấy lịch sử trước đó.',
    '> Tin không phải chữ (ảnh/file/thoại) chỉ lưu **metadata**, không lưu nội dung.',
    '',
    '---',
    '',
  );

  if (tin.length === 0) {
    d.push('_Không có tin nào khớp bộ lọc._', '');
    return { md: d.join('\n'), soTinDaIn: 0, soThuHoi: 0, lech: !khop };
  }

  let ngayHienTai = null;
  for (const r of tin) {
    const g = formatTime(Number(r.ts_zalo), tz);
    if (g.ngay !== ngayHienTai) {
      ngayHienTai = g.ngay;
      d.push('', `## ${g.tieuDeNgay}`, '');
    }

    const ten = senderName(r);
    const nhomNhan = nhieuHoiThoai
      ? ` · _${(hoiThoai.get(String(r.chat_id))?.name ?? `<${r.chat_id}>`)}_`
      : '';
    const daThuHoi = Number(r.recalled) === 1;
    const sk = thuHoi.get(`${r.chat_id}|${r.msg_id}`);

    if (daThuHoi) {
      // 🔴 ĐÂY LÀ LÝ DO TỒN TẠI CỦA CẢ CÔNG CỤ: hiện RÕ là đã thu hồi, nói AI
      // và LÚC NÀO, nhưng VẪN IN NGUYÊN NỘI DUNG GỐC.
      const lucMs = Number(sk?.ts_zalo ?? r.recalled_at ?? 0);
      const luc = lucMs > 0 ? `${formatTime(lucMs, tz).ngay} ${formatTime(lucMs, tz).gio}` : 'không rõ lúc nào';
      d.push(`**[${g.gio}] ${ten}${nhomNhan}** — 🗑️ **TIN ĐÃ THU HỒI**`);
      d.push(`_Thu hồi bởi ${recallerName(r, sk, nguoi)} lúc ${luc}. Nội dung gốc vẫn giữ:_`);
      d.push('');
    } else {
      d.push(`**[${g.gio}] ${ten}${nhomNhan}**`);
    }

    const nhan = messageKindLabel(r);
    if (r.content !== null && r.content !== undefined && String(r.content) !== '') {
      d.push(trichDan(r.content));
    } else if (nhan) {
      d.push(`> _[${nhan}]_ — nội dung không được lưu (chỉ lưu tin chữ).`);
    } else {
      d.push('> _[tin rỗng]_');
    }
    d.push('');
  }

  return { md: d.join('\n'), soTinDaIn: tin.length, soThuHoi, lech: !khop };
}

function mdDanhSach(ds, tz) {
  const d = ['# Các hội thoại trong kho', '', `Múi giờ: ${tz}`, '',
    '| Mã hội thoại | Tên | Loại | Đang nghe | Số tin | Đã thu hồi | Tin cũ nhất | Tin mới nhất |',
    '|---|---|---|---|---|---|---|---|'];
  for (const r of ds) {
    const som = r.som_nhat ? formatTime(Number(r.som_nhat), tz).ngay : '—';
    const muon = r.muon_nhat ? formatTime(Number(r.muon_nhat), tz).ngay : '—';
    const nghe = r.listened === null ? '⚠️ chưa có trong conversations' : (Number(r.listened) === 1 ? 'có' : 'KHÔNG');
    d.push(
      `| \`${r.chat_id}\` | ${(r.name ?? '').trim() || '—'} | ${r.kind ?? '—'} | ${nghe} ` +
        `| ${Number(r.so_tin ?? 0)} | ${Number(r.so_thu_hoi ?? 0)} | ${som} | ${muon} |`,
    );
  }
  d.push('');
  return d.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════════

export async function main(argv) {
  const ts = parseArgs(argv.slice(2));
  if (ts.giup) {
    process.stdout.write(`${GIUP}\n`);
    return 0;
  }

  const tz = String(ts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  try {
    formatTime(Date.now(), tz);
  } catch {
    throw new Error(`Múi giờ không hợp lệ: '${tz}' (dùng dạng IANA, vd Asia/Ho_Chi_Minh).`);
  }

  const { duongDan, nguon } = findDbPath(ts);
  const db = openReadOnly(duongDan);
  try {
    if (ts['danh-sach']) {
      const md = mdDanhSach(listConversations(db), tz);
      return ghiRa(md, ts, `Đã liệt kê hội thoại từ ${duongDan}`);
    }

    const loc = {
      chatId: ts.chat ? toId(String(ts.chat), 'export.--chat') : null,
      tu: ts.tu ? dayBoundary(String(ts.tu), tz, false) : null,
      den: ts.den ? dayBoundary(String(ts.den), tz, true) : null,
      soLuong: ts.so ? Number(ts.so) : null,
    };
    if (ts.so && (!Number.isFinite(loc.soLuong) || loc.soLuong <= 0)) {
      throw new Error(`--so phải là số nguyên dương, nhận được '${ts.so}'.`);
    }
    if (loc.tu !== null && loc.den !== null && loc.tu > loc.den) {
      throw new Error('--tu muộn hơn --den, không có tin nào lọt qua. Kiểm lại hai mốc.');
    }

    const { tin, tongKhopBoLoc } = fetchMessages(db, loc);
    const kq = buildMarkdown({
      tin,
      tongKhopBoLoc,
      thuHoi: recallTable(db, loc.chatId),
      hoiThoai: conversationTable(db),
      nguoi: peopleTable(db),
      loc,
      tz,
      duongDanDb: duongDan,
      nguonDb: nguon,
      bayGio: Date.now(),
    });

    const tomTat =
      `Đã xuất ${kq.soTinDaIn} tin (đối chiếu count(*) = ${tongKhopBoLoc}` +
      `${loc.soLuong ? `, giới hạn ${loc.soLuong}` : ''}), trong đó ${kq.soThuHoi} tin đã thu hồi.`;
    const ma = ghiRa(kq.md, ts, tomTat);

    if (kq.lech) {
      // Lệch số là hỏng CÂM điển hình: file vẫn mở được, vẫn đọc được, chỉ
      // thiếu tin. Phải kêu ra stderr VÀ trả mã thoát khác 0.
      process.stderr.write(
        `[export] ❌ LỆCH SỐ TIN: xuất ${kq.soTinDaIn} nhưng bộ lọc khớp ${tongKhopBoLoc}. ` +
          'Đừng tin file vừa xuất — đi kiểm truy vấn.\n',
      );
      return 2;
    }
    return ma;
  } finally {
    db.close();
  }
}

function ghiRa(md, ts, tomTat) {
  if (ts.ra) {
    const f = expandPath(String(ts.ra));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, md, 'utf8');
    // File này là tin nhắn CỦA NGƯỜI KHÁC ở dạng chữ trần — còn dễ đọc hơn cả
    // DB. Cùng mức siết 0600 với `lichsu.db` (xem src/store/db.js). `mode` của
    // writeFileSync chỉ áp lúc TẠO MỚI nên phải chmod rời, không thì ghi đè
    // lên file cũ 0644 sẽ giữ nguyên 0644.
    try {
      fs.chmodSync(f, 0o600);
    } catch (e) {
      process.stderr.write(`[export] không chmod 0600 được ${f}: ${e.message}\n`);
    }
    process.stdout.write(`${tomTat}\nĐã ghi: ${f} (quyền 0600)\n`);
  } else {
    process.stdout.write(md);
  }
  return 0;
}

// Chỉ chạy khi được gọi TRỰC TIẾP. Bản stub gọi main() ngay lúc nạp module, nên
// bộ test vừa `import` là script chạy luôn — không test được hàm nào.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv)
    .then((ma) => { process.exitCode = ma ?? 0; })
    .catch((e) => {
      process.stderr.write(`${e?.message ?? e}\n`);
      process.exitCode = 1;
    });
}
