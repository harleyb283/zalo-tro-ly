/**
 * ═══════════════════════════════════════════════════════════════════════
 * HỢP ĐỒNG G0 — giải đường dẫn. MỌI gói BẮT BUỘC dùng `expandPath()` trước khi
 * đưa một đường dẫn từ config/env vào `fs.*` hay `new DatabaseSync(...)`.
 *
 * 🔴 BẪY IM LẶNG: Node **KHÔNG** nở dấu `~`. Đó là việc của shell.
 *    Config mặc định ghi "~/.zalo-tro-ly/lichsu.db" mà đưa thẳng vào fs
 *    thì Node tạo một thư mục TÊN LÀ "~" ngay trong cwd — tức là ngay
 *    TRONG repo. Không có lỗi nào được ném ra. Kết quả:
 *      · DB nằm trong project ⇒ MỨC SIẾT CAO bị vô hiệu hoá âm thầm
 *        (phiên Claude đọc thẳng được DB, vòng qua toàn bộ luật chống rò chéo)
 *      · session.json (cookie Zalo) nằm trong repo ⇒ nguy cơ lọt git
 *    Hai hậu quả này đều là hỏng CÂM, nên chốt hàm dùng chung ngay ở G0.
 * ═══════════════════════════════════════════════════════════════════════
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Nở `~` / `~/...` và biến thành đường dẫn TUYỆT ĐỐI đã chuẩn hoá.
 *
 * @param {string} p
 * @param {string} [goc]  gốc để giải đường dẫn tương đối; mặc định process.cwd()
 * @returns {string}
 */
export function expandPath(p, goc) {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new Error('expandPath(): đường dẫn rỗng hoặc không phải chuỗi');
  }
  let s = p.trim();

  if (s === '~') {
    s = os.homedir();
  } else if (s.startsWith('~/') || s.startsWith('~\\')) {
    s = path.join(os.homedir(), s.slice(2));
  } else if (s.startsWith('~')) {
    // `~user/...` — Node không giải được. Từ chối thẳng thay vì đoán.
    throw new Error(`expandPath(): không hỗ trợ dạng "~user", sửa config thành đường dẫn đầy đủ: ${p}`);
  }

  return path.resolve(goc ?? process.cwd(), s);
}

/**
 * Kiểm một đường dẫn có nằm TRONG thư mục pack không.
 * Dùng ở G8/G4 để cảnh báo khi người dùng vô tình trỏ `duongDan.db`
 * vào trong repo (phá mức siết CAO + rủi ro lọt git).
 *
 * @param {string} duongDanTuyetDoi
 * @param {string} thuMucPack
 * @returns {boolean}
 */
export function isInsidePack(duongDanTuyetDoi, thuMucPack) {
  const a = path.resolve(duongDanTuyetDoi);
  const b = path.resolve(thuMucPack);
  const rel = path.relative(b, a);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Tạo thư mục cha của một file nếu chưa có, với quyền 0700.
 * Dùng trước khi ghi lichsu.db / session.json / health.json.
 *
 * @param {string} duongDanFile  đã qua expandPath()
 * @returns {string} thư mục cha
 */
export function ensureParentDir(duongDanFile) {
  const cha = path.dirname(duongDanFile);
  fs.mkdirSync(cha, { recursive: true, mode: 0o700 });
  return cha;
}

/**
 * Ghi file bí mật với quyền 0600 ĐẶT NGAY LÚC TẠO.
 *
 * 🔴 KHÔNG được viết `fs.writeFileSync(p, data)` rồi `fs.chmodSync(p, 0o600)`.
 *    Khe hở giữa hai lệnh là THẬT: trong khoảnh khắc đó file mang quyền
 *    mặc định theo umask (thường 0644) và tiến trình khác đọc được cookie.
 *    Bằng `mode` trong lệnh mở, quyền có ngay từ inode đầu tiên.
 *
 * ⚠️ `mode` chỉ áp khi file được TẠO MỚI. File đã tồn tại thì giữ quyền cũ
 *    ⇒ hàm này chmod bù SAU khi ghi, chỉ cho trường hợp file có sẵn.
 *
 * @param {string} duongDan  đã qua expandPath()
 * @param {string} noiDung
 */
export function writeSecretFile(duongDan, noiDung) {
  ensureParentDir(duongDan);
  const daCo = fs.existsSync(duongDan);
  const fd = fs.openSync(duongDan, 'w', 0o600);
  try {
    fs.writeFileSync(fd, noiDung, { encoding: 'utf8' });
  } finally {
    fs.closeSync(fd);
  }
  if (daCo) fs.chmodSync(duongDan, 0o600);
}
