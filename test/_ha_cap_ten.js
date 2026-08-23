// Hạ TÊN bảng/cột về đúng hình dạng TIẾNG VIỆT của v11 trở về trước.
//
// 🔴 VÌ SAO PHẢI CÓ: các bài test migrate dựng "DB đời cũ" bằng cách nạp
// `schema.sql` MỚI rồi hạ số phiên bản xuống. Từ v12 trở đi, `schema.sql` sinh
// ra bảng tên TIẾNG ANH ⇒ cái gọi là "DB v6" ấy ⛔ không còn trung thực: mọi
// bước migrate cũ (`ALTER TABLE tin_nhan ...`) đều trượt vì không có bảng nào
// tên như vậy.
//
// ⛔ Đường sai đã cân nhắc và BỎ: cho các bước migrate cũ "bỏ qua nếu thiếu
// bảng". Làm thế thì mọi bài migrate vẫn XANH nhưng ⛔ không chạy qua một bước
// nào cả — đúng kiểu bài test tự khen mình mà pack này sợ nhất.
//
// ⇒ Dựng tiền đề cho ĐÚNG: đổi tên ngược lại, rồi mới hạ phiên bản.

import { DOI_TEN_V12 } from '../src/store/db.js';

/** @typedef {import('node:sqlite').DatabaseSync} TDb */

function coBang(db, bang) {
  return db.prepare("SELECT 1 AS c FROM sqlite_master WHERE type='table' AND name = ?")
    .get(bang) !== undefined;
}

function coCot(db, bang, cot) {
  try {
    return db.prepare(`PRAGMA table_info(${bang})`).all().some((c) => c.name === cot);
  } catch {
    return false;
  }
}

/**
 * Đổi NGƯỢC bản đồ v11->v12: bảng/cột tiếng Anh quay về tên tiếng Việt.
 * Chạy lại được nhiều lần.
 * @param {TDb} db
 * @returns {{bang: number, cot: number}} số lượt đã đổi, để bài test khẳng định
 *   tiền đề dựng được THẬT chứ không im lặng không làm gì.
 */
export function haCapTenV11(db) {
  let bang = 0;
  let cot = 0;
  // Cột trước, bảng sau: bản đồ cột đánh khoá theo TÊN BẢNG CŨ, nên phải đổi
  // cột lúc bảng còn mang tên mới thì mới tra được... nên tra qua tên mới.
  for (const [bangCu, dsCot] of Object.entries(DOI_TEN_V12.cot)) {
    const bangMoi = DOI_TEN_V12.bang[bangCu] ?? bangCu;
    if (!coBang(db, bangMoi)) continue;
    for (const [cu, moi] of Object.entries(dsCot)) {
      if (coCot(db, bangMoi, moi) && !coCot(db, bangMoi, cu)) {
        db.exec(`ALTER TABLE ${bangMoi} RENAME COLUMN ${moi} TO ${cu}`);
        cot += 1;
      }
    }
  }
  for (const [cu, moi] of Object.entries(DOI_TEN_V12.bang)) {
    if (coBang(db, moi) && !coBang(db, cu)) {
      db.exec(`ALTER TABLE ${moi} RENAME TO ${cu}`);
      bang += 1;
    }
  }
  return { bang, cot };
}
