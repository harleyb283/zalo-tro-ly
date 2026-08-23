#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * LẤP LẠI `content` CHO CÁC DÒNG CŨ BỊ MẤT CHỮ
 *
 * Bối cảnh: trước bản vá `webchat` (20/08/2026), mọi tin văn bản bị xếp nhầm
 * loại nên chữ nằm kẹt trong `content_raw._text` mà cột `content` để trống.
 * Hậu quả: mỗi lần host bảo "tóm tắt nhóm" / "tìm tin về X", trợ lý bỏ sót
 * gần 1/5 hội thoại mà KHÔNG báo lỗi gì — trông y như đã trả lời đủ.
 *
 * 🔴 VÌ SAO LÀ SCRIPT RỜI, KHÔNG PHẢI BƯỚC `MIGRATION_STEPS`:
 *   Việc này KHÔNG đổi cấu trúc — chỉ ghi vào 3 cột ĐÃ CÓ (`content`,
 *   `msg_type`, `name_at_send`). Thêm một bước migrate thì phải tăng
 *   `PHIEN_BAN_SCHEMA` trong `src/lib/hang_so.js`, mà file đó đang do pane
 *   khác sửa — hai bên cùng ghi là đè nhau. Đã báo Router; muốn chuyển thành
 *   bước migrate sau này thì bê nguyên 3 câu UPDATE dưới đây, chúng đã
 *   idempotent sẵn.
 *
 * AN TOÀN:
 *   · Mặc định CHẠY THỬ (đếm, không ghi). Phải có `--that` mới ghi.
 *   · Chỉ ghi vào dòng ĐANG RỖNG — không đè lên dòng đã có chữ.
 *   · Chỉ CỘNG THÊM. Không DROP, không RENAME, không xoá dòng nào.
 *   · Chạy lại nhiều lần vô hại (lần hai không còn dòng nào khớp).
 *
 *   node bin/patch-content.js [đường/dẫn.db]          # chạy thử
 *   node bin/patch-content.js [đường/dẫn.db] --that   # ghi thật
 * ═══════════════════════════════════════════════════════════════════════
 */
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const MAC_DINH = path.join(os.homedir(), '.zalo-tro-ly', 'lichsu.db');

/**
 * 3 câu vá, mỗi câu một vấn đề độc lập. Thứ tự CÓ Ý NGHĨA: đổ chữ trước, rồi
 * mới sửa `msg_type` theo chữ đã đổ.
 *
 * ⚠️ Điều kiện `content IS NULL` trong câu 1 là chốt chặn "không đè bản cũ".
 * Đừng bỏ nó đi kể cả khi thấy thừa.
 */
const CAC_BUOC = [
  {
    ten: 'do-chu',
    moTa: 'đổ content_raw._text sang content cho tin văn bản còn rỗng',
    dem: `SELECT count(*) AS c FROM messages
           WHERE content IS NULL
             AND json_extract(content_raw, '$._msgTypeGoc') IN ('webchat','chat.text')
             AND json_extract(content_raw, '$._text') IS NOT NULL
             AND trim(json_extract(content_raw, '$._text')) != ''`,
    chay: `UPDATE messages
              SET content = json_extract(content_raw, '$._text')
            WHERE content IS NULL
              AND json_extract(content_raw, '$._msgTypeGoc') IN ('webchat','chat.text')
              AND json_extract(content_raw, '$._text') IS NOT NULL
              AND trim(json_extract(content_raw, '$._text')) != ''`,
  },
  {
    ten: 'sua-loai',
    moTa: "msg_type 'UNKNOWN' -> 'chat.text' cho đúng dòng vừa có chữ",
    // Nếu để nguyên UNKNOWN thì dòng vừa lấp lại vi phạm spec H (loại khác
    // text mà có content) và mọi truy vấn lọc theo loại vẫn bỏ sót nó —
    // tức vá nửa vời, vẫn mất chữ ở tầng đọc.
    dem: `SELECT count(*) AS c FROM messages
           WHERE msg_type = 'UNKNOWN' AND content IS NOT NULL
             AND json_extract(content_raw, '$._msgTypeGoc') IN ('webchat','chat.text')`,
    chay: `UPDATE messages SET msg_type = 'chat.text'
            WHERE msg_type = 'UNKNOWN' AND content IS NOT NULL
              AND json_extract(content_raw, '$._msgTypeGoc') IN ('webchat','chat.text')`,
  },
  {
    ten: 'ten-bot',
    moTa: 'điền name_at_send còn rỗng cho tin do trợ lý tạo',
    // Tên lấy TỪ CHÍNH DB (dòng khác cùng user_id đã có tên) chứ không viết
    // cứng — viết cứng là lần sau đổi tên hiển thị thì sai lặng lẽ.
    dem: `SELECT count(*) AS c FROM messages
           WHERE made_by_assistant = 1 AND name_at_send IS NULL AND user_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM messages t2
                          WHERE t2.user_id = messages.user_id AND t2.name_at_send IS NOT NULL)`,
    chay: `UPDATE messages
              SET name_at_send = (SELECT t2.name_at_send FROM messages t2
                                  WHERE t2.user_id = messages.user_id
                                    AND t2.name_at_send IS NOT NULL
                                  ORDER BY t2.ts_zalo DESC LIMIT 1)
            WHERE made_by_assistant = 1 AND name_at_send IS NULL AND user_id IS NOT NULL`,
  },
];

const SOAT = `SELECT count(*) AS tong,
                     sum(content IS NOT NULL) AS co_chu,
                     sum(made_by_assistant = 1 AND name_at_send IS NULL) AS bot_thieu_ten
                FROM messages`;

/**
 * @param {string} duongDan
 * @param {boolean} ghiThat
 */
export function patchContent(duongDan, ghiThat) {
  const db = new DatabaseSync(duongDan);
  try {
    const truoc = db.prepare(SOAT).get();
    const ketQua = [];
    for (const b of CAC_BUOC) {
      const soKhop = Number(db.prepare(b.dem).get().c);
      if (ghiThat && soKhop > 0) db.prepare(b.chay).run();
      ketQua.push({ ten: b.ten, moTa: b.moTa, soKhop });
    }
    const sau = db.prepare(SOAT).get();

    // 🔴 CHỐT NGHIỆM THU — sai một trong hai là DỪNG, đừng chữa.
    if (Number(sau.tong) !== Number(truoc.tong)) {
      throw new Error(`SỐ DÒNG ĐỔI: ${truoc.tong} -> ${sau.tong}. Vá này chỉ được CỘNG THÊM.`);
    }
    if (Number(sau.co_chu) < Number(truoc.co_chu)) {
      throw new Error(`SỐ DÒNG CÓ CHỮ GIẢM: ${truoc.co_chu} -> ${sau.co_chu}. Đã đè mất dữ liệu.`);
    }
    return { truoc, sau, ketQua, ghiThat };
  } finally {
    db.close();
  }
}

const laChayTruocTiep = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (laChayTruocTiep) {
  const dd = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ?? MAC_DINH;
  const that = process.argv.includes('--that');
  const kq = patchContent(dd, that);
  process.stdout.write(`DB: ${dd}\n${that ? '★ GHI THẬT' : '(chạy thử — thêm --that để ghi)'}\n\n`);
  for (const b of kq.ketQua) process.stdout.write(`  ${b.soKhop === 0 ? '·' : '✔'} ${b.ten}: ${b.soKhop} dòng — ${b.moTa}\n`);
  process.stdout.write(
    `\n  tổng dòng   : ${kq.truoc.tong} -> ${kq.sau.tong}\n`
    + `  dòng có chữ : ${kq.truoc.co_chu} -> ${kq.sau.co_chu}\n`
    + `  bot thiếu tên: ${kq.truoc.bot_thieu_ten} -> ${kq.sau.bot_thieu_ten}\n`,
  );
}
