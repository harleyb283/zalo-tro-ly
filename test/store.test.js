/**
 * G3 — test tầng lưu trữ. Chạy: `npm test` (node --test).
 *
 * Chạy được HOÀN TOÀN KHÔNG CẦN ZALO, không cần mạng, không cần gói khác:
 * mọi đầu vào là dữ liệu giả dựng theo `src/types.d.ts`. Đây là điều kiện để
 * 5 pane làm song song mà vẫn tự nghiệm thu được.
 *
 * Mỗi test dùng một file DB riêng trong thư mục tạm (KHÔNG dùng `:memory:`
 * cho phần lớn bài) vì có bài phải kiểm quyền 0600 trên file thật.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, migrate, openDb, describeSchema, tightenPermissions } from '../src/store/db.js';
import { PHIEN_BAN_SCHEMA } from '../src/lib/hang_so.js';
import {
  updateQueueState,
  markRecalled,
  writeQueryLog,
  writeReaction,
  writeGroupEvent,
  writeMessage,
  getQueueRow,
  takePendingQueue,
  enqueueQuestion,
  upsertConversation,
  upsertPerson,
  writeMemo,
} from '../src/store/write.js';
import { groupMembers, replyContext, latestMessages, storeStats, queryHistory } from '../src/store/query.js';
import { GIOI_HAN } from '../src/lib/hang_so.js';

// ── Đồ nghề ────────────────────────────────────────────────────────────────
const RAC = [];
function dbTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-tro-ly-test-'));
  RAC.push(d);
  const p = path.join(d, 'kho', 'lichsu.db');
  return { db: openDb(p), duongDan: p };
}
process.on('exit', () => {
  for (const d of RAC) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* dọn rác hỏng thì thôi */
    }
  }
});

/** Tin giả đúng hình dạng TinChuanHoa. */
function tinGia(v = {}) {
  return {
    chatId: '9990000000001',
    msgId: '9990000000002',
    cliMsgId: null,
    userId: '555000111',
    tenLucGui: 'Người A',
    msgType: 'chat.text',
    noiDung: 'xin chào',
    contentRaw: null,
    tsZalo: 1_700_000_000_000,
    tuToi: false,
    hasHostMention: false,
    ...v,
  };
}

/** Bật nghe cho một hội thoại — điều kiện để query.js trả dòng. */
function moNghe(db, chatId, ten = 'Nhóm thử') {
  upsertConversation(db, { chatId, loai: 'GROUP', ten, duocNghe: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// A. MỞ DB
// ═══════════════════════════════════════════════════════════════════════════

test('A1 openDb dựng đúng 17 bảng / 25 chỉ mục, bật WAL', () => {
  const { db } = dbTam();
  const s = describeSchema(db);
  // v3 (20/08/2026): +doi_chieu_lich_su, +lich_hen  -> 9 thành 11 bảng.
  // v6 (21/08/2026): +ghi_nho, +nhat_ky_cong_ghi    -> 11 thành 13 bảng.
  // v7 (21/08/2026): +hang_doi_gui, +nguon_phien     -> 13 thành 15 bảng.
  // Con số ĐỂ CỨNG có chủ đích: nó là canary bắt ca ai đó thêm bảng mà không
  // ai duyệt. Đổi số ở đây phải là hành động CÓ Ý THỨC, không phải nới cho xanh.
  // ⇒ Lần đổi 21/08: Router duyệt trước, thiết kế ở
  //   `60_output/ingest_staging/zalo_tang_tri_nho/thiet_ke.md` mục 5.
  assert.equal(s.bang.length, 17, `bảng: ${s.bang.join(',')}`);
  // v11 (21/08/2026): +yeu_cau_duyet (đường xin duyệt) và +nhat_ky_hanh_dong
  //   (ghi vết thay lớp chặn vừa gỡ) -> 15 thành 17 bảng;
  //   +idx_duyet_cho, +idx_duyet_chat, +idx_vet_chat, +idx_vet_tool -> 25 chỉ mục.
  assert.equal(s.chiMuc.length, 25);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  closeDb(db);
});

test('A2 quyền 0600 cho db + -wal + -shm, thư mục cha 0700', () => {
  const { db, duongDan } = dbTam();
  writeMessage(db, tinGia()); // ép SQLite sinh file -wal/-shm
  tightenPermissions(duongDan);
  for (const p of [duongDan, `${duongDan}-wal`, `${duongDan}-shm`]) {
    assert.ok(fs.existsSync(p), `thiếu ${path.basename(p)}`);
    assert.equal(fs.statSync(p).mode & 0o777, 0o600, `quyền sai ở ${path.basename(p)}`);
  }
  assert.equal(fs.statSync(path.dirname(duongDan)).mode & 0o777, 0o700);
  closeDb(db);
});

test('A3 migrate chạy lại KHÔNG đổi gì (idempotent)', () => {
  const { db } = dbTam();
  const kq = migrate(db);
  assert.deepEqual(kq, {
    tuPhienBan: PHIEN_BAN_SCHEMA, denPhienBan: PHIEN_BAN_SCHEMA, daDoi: false, buocDaChay: [],
  });
  closeDb(db);
});

test('A4 DB lệch schema_version thì NỔ, không im lặng chạy tiếp', () => {
  const { db, duongDan } = dbTam();
  db.exec("UPDATE meta SET gia_tri = '99' WHERE khoa = 'schema_version'");
  closeDb(db);
  assert.throws(() => openDb(duongDan), /schema_version='99'/);
});

// ═══════════════════════════════════════════════════════════════════════════
// B. GHI TIN + SPEC H
// ═══════════════════════════════════════════════════════════════════════════

test('B1 ghi 5 tin -> đếm đúng 5', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  for (let i = 1; i <= 5; i++) {
    assert.equal(writeMessage(db, tinGia({ chatId: '111', msgId: `m${i}`, tsZalo: 1000 + i })), true);
  }
  assert.equal(storeStats(db).soTinDaLuu, 5);
  closeDb(db);
});

test('B2 trùng (chat_id, msg_id) -> bỏ qua, KHÔNG ghi đè bản cũ', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'm1', noiDung: 'bản gốc' }));
  assert.equal(writeMessage(db, tinGia({ chatId: '111', msgId: 'm1', noiDung: 'bản đè' })), false);
  const { rows } = latestMessages(db, '111', 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].noi_dung, 'bản gốc');
  closeDb(db);
});

test('B3 spec H — msg_type != chat.text thì noi_dung PHẢI null', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  // Cố tình truyền noiDung cho ảnh: tầng ghi phải tự ép null, không tin
  // lời hứa của normalize.js (gói khác).
  writeMessage(db, tinGia({ chatId: '111', msgId: 'anh', msgType: 'chat.image', noiDung: 'BÍ MẬT' }));
  writeMessage(db, tinGia({ chatId: '111', msgId: 'la', msgType: 'UNKNOWN', noiDung: 'BÍ MẬT' }));
  writeMessage(db, tinGia({ chatId: '111', msgId: 'chu', msgType: 'chat.text', noiDung: 'giữ nguyên' }));

  const sot = db
    .prepare("SELECT count(*) AS c FROM tin_nhan WHERE msg_type != 'chat.text' AND noi_dung IS NOT NULL")
    .get().c;
  assert.equal(Number(sot), 0, 'có tin không phải text mà vẫn còn noi_dung');
  assert.equal(
    db.prepare("SELECT noi_dung AS n FROM tin_nhan WHERE msg_id = 'chu'").get().n,
    'giữ nguyên',
  );
  closeDb(db);
});

test('B4 boolean và undefined — 2 kiểu node:sqlite KHÔNG bind được', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  // Chứng minh bẫy có thật, không phải em phòng xa thừa:
  assert.throws(
    () => db.prepare('INSERT INTO tin_nhan (chat_id,msg_id,msg_type,ts_zalo,ts_ghi,tu_toi) VALUES (?,?,?,?,?,?)')
      .run('111', 'x', 'chat.text', 1, 'now', true),
    /cannot be bound/,
  );
  // Còn writeMessage() thì nuốt được cả hai.
  writeMessage(db, tinGia({ chatId: '111', msgId: 'bool', tuToi: true, hasHostMention: true }));
  writeMessage(db, tinGia({ chatId: '111', msgId: 'undef', cliMsgId: undefined, tenLucGui: undefined }));
  const r = db.prepare("SELECT tu_toi, co_tag_host FROM tin_nhan WHERE msg_id='bool'").get();
  assert.equal(Number(r.tu_toi), 1);
  assert.equal(Number(r.co_tag_host), 1);
  closeDb(db);
});

test('B5 ID vượt MAX_SAFE_INTEGER giữ nguyên chữ số (lưu TEXT)', () => {
  const { db } = dbTam();
  const to = '9990000000001123'; // > 9007199254740991
  moNghe(db, to);
  writeMessage(db, tinGia({ chatId: to, msgId: to }));
  const { rows } = latestMessages(db, to, 1);
  assert.equal(rows[0].chat_id, to);
  assert.equal(rows[0].msg_id, to);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// C. THU HỒI — tiêu chí nghiệm thu M2
// ═══════════════════════════════════════════════════════════════════════════

test('C1 M2: thu hồi -> da_thu_hoi=1 VÀ nội dung cũ CÒN NGUYÊN, khop_duoc=1', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'goc', noiDung: 'câu nói bị xoá' }));

  const kq = markRecalled(db, {
    eventId: 'ev-1',           // ID của CHÍNH sự kiện — KHÔNG dùng để ghép
    chatId: '111',
    msgIdDich: 'goc',          // ← tin BỊ thu hồi
    cliMsgIdDich: null,
    nguoiThuHoi: '555000111',
    tsZalo: 1_700_000_009_000,
  });
  assert.equal(kq.khopDuoc, true);
  assert.equal(kq.ghepBang, 'msg_id');

  const r = db.prepare("SELECT * FROM tin_nhan WHERE msg_id='goc'").get();
  assert.equal(Number(r.da_thu_hoi), 1);
  assert.equal(r.noi_dung, 'câu nói bị xoá', 'NỘI DUNG BỊ MẤT — đã DELETE thay vì UPDATE?');
  assert.equal(r.thu_hoi_boi, '555000111');
  assert.equal(Number(r.thu_hoi_luc), 1_700_000_009_000);

  assert.equal(storeStats(db).soTinDaLuu, 1, 'số tin giảm ⇒ đã xoá dòng');
  assert.equal(storeStats(db).soThuHoiMoCoi, 0);
  closeDb(db);
});

test('C2 M2: ghép sai ID -> vẫn ghi sự kiện MỒ CÔI, khop_duoc=0 (đo được)', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'goc', noiDung: 'còn đây' }));

  // Ghép nhầm bằng eventId (đúng bẫy số 1) -> không trúng dòng nào.
  const kq = markRecalled(db, {
    eventId: 'ev-2',
    chatId: '111',
    msgIdDich: 'ev-2',
    cliMsgIdDich: null,
    nguoiThuHoi: null,
    tsZalo: 1,
  });
  assert.equal(kq.khopDuoc, false);
  assert.equal(kq.ghepBang, null);
  assert.equal(storeStats(db).soThuHoiMoCoi, 1, 'mất dấu vết ca ghép sai');
  // Tin gốc không bị đụng tới.
  assert.equal(
    Number(db.prepare("SELECT da_thu_hoi AS d FROM tin_nhan WHERE msg_id='goc'").get().d),
    0,
  );
  closeDb(db);
});

test('C3 msg_id trượt nhưng cli_msg_id trúng -> ghép bù, báo rõ đường nào', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'goc', cliMsgId: 'cli-9', noiDung: 'giữ được' }));
  const kq = markRecalled(db, {
    eventId: 'ev-3',
    chatId: '111',
    msgIdDich: 'so-lech-kieu',
    cliMsgIdDich: 'cli-9',
    nguoiThuHoi: null,
    tsZalo: 1,
  });
  assert.equal(kq.khopDuoc, true);
  assert.equal(kq.ghepBang, 'cli_msg_id', 'phải nói rõ là ghép bằng đường dự phòng');
  assert.equal(
    db.prepare("SELECT noi_dung AS n FROM tin_nhan WHERE msg_id='goc'").get().n,
    'giữ được',
  );
  closeDb(db);
});

test('C4 cùng một sự kiện thu hồi tới 2 lần -> không nhân bản, không vỡ', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'goc' }));
  const sk = {
    eventId: 'ev-4', chatId: '111', msgIdDich: 'goc',
    cliMsgIdDich: null, nguoiThuHoi: null, tsZalo: 1,
  };
  markRecalled(db, sk);
  const lan2 = markRecalled(db, sk);
  assert.equal(lan2.khopDuoc, true);
  assert.equal(Number(db.prepare('SELECT count(*) AS c FROM su_kien_thu_hoi').get().c), 1);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// D. ★ LUẬT CHỐNG RÒ CHÉO — nguonChatIds tính từ DÒNG TRẢ VỀ
// ═══════════════════════════════════════════════════════════════════════════

/** Dựng 3 nhóm, mỗi nhóm 1 tin cùng chứa từ khoá 'báo giá'. */
function baNhom(db) {
  for (const [id, ten] of [['A', 'Nhóm A'], ['B', 'Nhóm B'], ['C', 'Nhóm C']]) {
    moNghe(db, id, ten);
    writeMessage(db, tinGia({ chatId: id, msgId: `${id}-1`, noiDung: `báo giá của ${ten}`, tsZalo: 2000 }));
  }
}

test('D1 ★ CA NGUY HIỂM NHẤT: tìm từ khoá KHÔNG truyền chatId -> nguồn phải khai ĐỦ 3 nhóm', () => {
  const { db } = dbTam();
  baNhom(db);
  const kq = queryHistory(db, { tuKhoa: 'báo giá' });
  assert.equal(kq.rows.length, 3);
  assert.deepEqual(
    [...kq.nguonChatIds].sort(),
    ['A', 'B', 'C'],
    'ĐỌC 3 nhóm mà khai nguồn thiếu ⇒ leak_guard mù ⇒ rò chéo nhóm',
  );
  closeDb(db);
});

test('D2 nguồn tính từ DÒNG chứ không từ THAM SỐ — lọc ngày ra 0 dòng thì nguồn RỖNG', () => {
  const { db } = dbTam();
  baNhom(db);
  // Truyền hẳn chatId='A' nhưng khoảng ngày không trúng dòng nào.
  const kq = queryHistory(db, { chatId: 'A', tuNgay: '2030-01-01' });
  assert.equal(kq.rows.length, 0);
  assert.deepEqual(
    kq.nguonChatIds,
    [],
    "tính theo tham số thì chỗ này sẽ ra ['A'] dù KHÔNG đọc dòng nào",
  );
  closeDb(db);
});

test('D3 hội thoại KHÔNG được nghe -> không dòng nào lọt ra, nguồn rỗng', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  upsertConversation(db, { chatId: 'X', loai: 'GROUP', ten: 'Nhóm lạ', duocNghe: false });
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a1', noiDung: 'chuyện nhóm A' }));
  writeMessage(db, tinGia({ chatId: 'X', msgId: 'x1', noiDung: 'chuyện nhóm lạ' }));

  const kq = queryHistory(db, {});
  assert.deepEqual(kq.nguonChatIds, ['A']);
  assert.equal(kq.rows.every((r) => r.chat_id === 'A'), true);
  closeDb(db);
});

test('D4 hội thoại CHƯA upsert -> fail-closed, tin có trong DB nhưng không đọc ra', () => {
  const { db } = dbTam();
  writeMessage(db, tinGia({ chatId: 'chua-khai-bao', msgId: 'z1' }));
  assert.equal(storeStats(db).soTinDaLuu, 1, 'tin vẫn phải được LƯU');
  assert.equal(queryHistory(db, {}).rows.length, 0, 'nhưng KHÔNG được ĐỌC ra');
  closeDb(db);
});

test('D5 mọi hàm đọc tin đều trả KetQuaTruyVan, không hàm nào trả mảng trần', () => {
  const { db } = dbTam();
  baNhom(db);
  for (const [ten, kq] of [
    ['queryHistory', queryHistory(db, {})],
    ['latestMessages', latestMessages(db, 'A', 5)],
  ]) {
    assert.ok(!Array.isArray(kq), `${ten} trả mảng trần`);
    assert.ok(Array.isArray(kq.rows), `${ten} thiếu rows`);
    assert.ok(Array.isArray(kq.nguonChatIds), `${ten} thiếu nguonChatIds`);
  }
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// E. TRUY VẤN — trần, thu hồi, từ khoá tiếng Việt
// ═══════════════════════════════════════════════════════════════════════════

test('E1 soLuong bị chặn bởi trần cứng, không kéo cả kho vào prompt', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  for (let i = 0; i < GIOI_HAN.SO_LUONG_TOI_DA + 20; i++) {
    writeMessage(db, tinGia({ chatId: 'A', msgId: `m${i}`, tsZalo: 1000 + i }));
  }
  assert.equal(queryHistory(db, { soLuong: 999_999 }).rows.length, GIOI_HAN.SO_LUONG_TOI_DA);
  assert.equal(queryHistory(db, {}).rows.length, GIOI_HAN.SO_LUONG_MAC_DINH);
  assert.equal(queryHistory(db, { soLuong: -5 }).rows.length, GIOI_HAN.SO_LUONG_MAC_DINH);
  closeDb(db);
});

test('E2 tin đã thu hồi VẪN trả về theo mặc định (tính năng, không phải bug)', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a1', noiDung: 'tin thường' }));
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a2', noiDung: 'tin bị thu hồi', tsZalo: 3000 }));
  markRecalled(db, {
    eventId: 'e', chatId: 'A', msgIdDich: 'a2',
    cliMsgIdDich: null, nguoiThuHoi: null, tsZalo: 1,
  });
  assert.equal(queryHistory(db, {}).rows.length, 2);
  assert.equal(queryHistory(db, { boQuaDaThuHoi: true }).rows.length, 1);
  closeDb(db);
});

test('E3 từ khoá tiếng Việt VIẾT HOA vẫn tìm ra (LIKE trần thì TRƯỢT)', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a1', noiDung: 'Báo giá bên SAO MAI' }));

  // Bằng chứng bẫy có thật: LIKE trần của SQLite chỉ gập hoa/thường ASCII.
  const likeTran = db
    .prepare("SELECT count(*) AS c FROM tin_nhan WHERE noi_dung LIKE '%BÁO%'")
    .get().c;
  assert.equal(Number(likeTran), 0, 'LIKE trần lẽ ra phải TRƯỢT — bẫy đã biến mất?');

  assert.equal(queryHistory(db, { tuKhoa: 'BÁO GIÁ' }).rows.length, 1);
  assert.equal(queryHistory(db, { tuKhoa: 'báo giá' }).rows.length, 1);
  assert.equal(queryHistory(db, { tuKhoa: 'sao mai' }).rows.length, 1);
  closeDb(db);
});

test('E4 ký tự đại diện trong từ khoá bị thoát, không quét cả kho', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a1', noiDung: 'giảm 100% giá' }));
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a2', noiDung: 'không liên quan', tsZalo: 3000 }));
  assert.equal(queryHistory(db, { tuKhoa: '100%' }).rows.length, 1);
  // Tìm '%' phải khớp dòng CÓ CHỨA ký tự '%' (đúng 1 dòng), chứ không phải
  // biến thành ký tự đại diện quét sạch 2 dòng. Kỳ vọng "0 dòng" của bản test
  // đầu là SAI — 'giảm 100% giá' có chứa '%' thật.
  const dauPhanTram = queryHistory(db, { tuKhoa: '%' });
  assert.equal(dauPhanTram.rows.length, 1, 'dấu % lọt -> khớp mọi dòng');
  assert.equal(dauPhanTram.rows[0].msg_id, 'a1');
  assert.equal(queryHistory(db, { tuKhoa: '_' }).rows.length, 0, 'dấu _ lọt -> khớp mọi ký tự');
  // Không thoát thì `\` cũng vỡ pattern.
  assert.equal(queryHistory(db, { tuKhoa: '\\' }).rows.length, 0);
  closeDb(db);
});

test('E5 mốc thời gian hỏng -> BỎ QUA điều kiện đó, không trả rỗng oan', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a1' }));
  assert.equal(queryHistory(db, { tuNgay: 'hôm qua' }).rows.length, 1);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// F. HÀNG ĐỢI HỎI — bền trên đĩa + TTL
// ═══════════════════════════════════════════════════════════════════════════

function hoiGia(v = {}) {
  return {
    requestId: 'req-1',
    chatIdHoi: 'A',
    msgId: 'm1',
    userId: 'u1',
    noiDung: 'anh hỏi gì đó',
    tsTao: new Date().toISOString(),
    ...v,
  };
}

test('F1 hàng đợi sống qua ĐÓNG/MỞ LẠI DB (bền trên đĩa, không phải RAM)', () => {
  const { db, duongDan } = dbTam();
  enqueueQuestion(db, hoiGia());
  closeDb(db);

  const db2 = openDb(duongDan);
  const r = getQueueRow(db2, 'req-1');
  assert.ok(r, 'restart là mất câu hỏi ⇒ đang buffer trong RAM');
  assert.equal(r.trang_thai, 'cho');
  assert.equal(r.noi_dung, 'anh hỏi gì đó');
  closeDb(db2);
});

test('F2 quá queueTtlMs -> het_han, KHÔNG trả lời muộn', () => {
  const { db } = dbTam();
  const cu = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 giờ trước
  enqueueQuestion(db, hoiGia({ requestId: 'cu', tsTao: cu }));
  enqueueQuestion(db, hoiGia({ requestId: 'moi' }));

  const con = takePendingQueue(db, 30 * 60 * 1000); // TTL 30 phút
  assert.deepEqual(con.map((r) => r.request_id), ['moi']);
  assert.equal(getQueueRow(db, 'cu').trang_thai, 'het_han');
  assert.equal(getQueueRow(db, 'moi').trang_thai, 'cho');
  closeDb(db);
});

test('F3 ts_tao không đọc được -> coi là CÒN HẠN, không nuốt mất câu hỏi', () => {
  const { db } = dbTam();
  enqueueQuestion(db, hoiGia({ requestId: 'hong', tsTao: 'chiều nay' }));
  const con = takePendingQueue(db, 1);
  assert.deepEqual(con.map((r) => r.request_id), ['hong']);
  assert.equal(getQueueRow(db, 'hong').trang_thai, 'cho');
  closeDb(db);
});

test('F4 trạng thái lạ bị chặn bằng lỗi ĐỌC ĐƯỢC, không phải CHECK constraint', () => {
  const { db } = dbTam();
  enqueueQuestion(db, hoiGia());
  assert.throws(() => updateQueueState(db, 'req-1', 'xong'), /trạng thái hàng đợi lạ/);
  assert.equal(updateQueueState(db, 'khong-co', 'bo'), false);
  assert.equal(updateQueueState(db, 'req-1', 'da_tra_loi'), true);
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// G. CÁC BẢNG PHỤ + THỐNG KÊ
// ═══════════════════════════════════════════════════════════════════════════

test('G1 reaction gMsgID=0 (thả từ điện thoại) -> khop_duoc=0, KHÔNG coi là hỏng', () => {
  const { db } = dbTam();
  writeReaction(db, { chatId: 'A', msgIdDich: null, userId: 'u1', bieuTuong: '👍', tsZalo: 1 });
  writeReaction(db, { chatId: 'A', msgIdDich: '0', userId: 'u1', bieuTuong: '❤️', tsZalo: 2 });
  writeReaction(db, { chatId: 'A', msgIdDich: 'm1', userId: 'u1', bieuTuong: '😀', tsZalo: 3 });
  const c = db.prepare('SELECT count(*) AS c FROM reaction WHERE khop_duoc = 0').get().c;
  assert.equal(Number(c), 2, 'gMsgID = 0 phải bị coi là mồ côi như null');
  closeDb(db);
});

test('G2 upsert hội thoại/người KHÔNG xoá trắng tên đã biết', () => {
  const { db } = dbTam();
  moNghe(db, 'A', 'Tên đầy đủ');
  upsertConversation(db, { chatId: 'A', loai: 'GROUP', ten: null, duocNghe: true });
  assert.equal(db.prepare("SELECT ten AS t FROM hoi_thoai WHERE chat_id='A'").get().t, 'Tên đầy đủ');

  upsertPerson(db, { userId: 'u1', tenHienThi: 'Người A', isHost: true });
  upsertPerson(db, { userId: 'u1', tenHienThi: null, isHost: true });
  const n = db.prepare("SELECT * FROM nguoi WHERE user_id='u1'").get();
  assert.equal(n.ten_hien_thi, 'Người A');
  assert.equal(Number(n.la_host), 1);
  closeDb(db);
});

test('G3 lan_dau_thay giữ nguyên, lan_cuoi_thay được đẩy tới', async () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  const dau = db.prepare("SELECT lan_dau_thay AS d FROM hoi_thoai WHERE chat_id='A'").get().d;
  await new Promise((r) => setTimeout(r, 5));
  moNghe(db, 'A');
  const sau = db.prepare("SELECT * FROM hoi_thoai WHERE chat_id='A'").get();
  assert.equal(sau.lan_dau_thay, dau, 'lan_dau_thay bị ghi đè');
  assert.ok(sau.lan_cuoi_thay >= dau);
  closeDb(db);
});

test('G4 sự kiện nhóm + nhật ký truy vấn ghi được, nguồn lưu dạng JSON array', () => {
  const { db } = dbTam();
  writeGroupEvent(db, { chatId: 'A', loai: 'JOIN', duLieu: '{"x":1}', tsZalo: 1 });
  writeGroupEvent(db, { chatId: 'A', loai: 'UNKNOWN', duLieu: null, tsZalo: null });
  assert.equal(Number(db.prepare('SELECT count(*) AS c FROM su_kien_nhom').get().c), 2);

  writeQueryLog(db, {
    requestId: 'req-1', chatIdHoi: 'A',
    nguonChatIds: ['A', 'B'], coCheo: true, huongTraLoi: 'dm_host',
  });
  const nk = db.prepare('SELECT * FROM nhat_ky_truy_van').get();
  assert.deepEqual(JSON.parse(nk.nguon_chat_ids), ['A', 'B']);
  assert.equal(Number(nk.co_cheo), 1);
  assert.equal(nk.huong_tra_loi, 'dm_host');
  closeDb(db);
});

test('G6 ba file của G3 KHÔNG có console.log (stdout là kênh giao thức MCP)', () => {
  const goc = path.resolve(import.meta.dirname, '..', 'src', 'store');
  for (const ten of ['db.js', 'write.js', 'query.js']) {
    const src = fs.readFileSync(path.join(goc, ten), 'utf8');
    assert.equal(/console\.log\s*\(/.test(src), false, `${ten} có console.log`);
    assert.equal(
      /process\.stdout\.write/.test(src),
      false,
      `${ten} ghi thẳng stdout — một dòng lạc là hỏng CÂM cả phiên MCP`,
    );
  }
});

test('G5 storeStats khớp số đếm thật', () => {
  const { db } = dbTam();
  moNghe(db, 'A');
  upsertConversation(db, { chatId: 'X', loai: 'GROUP', ten: null, duocNghe: false });
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a1' }));
  writeMessage(db, tinGia({ chatId: 'A', msgId: 'a2', tsZalo: 2 }));
  markRecalled(db, {
    eventId: 'e1', chatId: 'A', msgIdDich: 'khong-co',
    cliMsgIdDich: null, nguoiThuHoi: null, tsZalo: 1,
  });
  enqueueQuestion(db, hoiGia());
  assert.deepEqual(storeStats(db), {
    soTinDaLuu: 2, soThuHoiMoCoi: 1, soHangDoiCho: 1, soNhomDangNghe: 1,
  });
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// F. MIGRATE v1 -> v2 TRÊN DB ĐÃ CÓ DỮ LIỆU
//
// 🔴 Bài quan trọng nhất của đợt này. DB thật đang chạy có dữ liệu hội thoại
//    THẬT của người thật — migrate hỏng là mất hẳn, không nguồn nào phát lại.
// ═══════════════════════════════════════════════════════════════════════════

/** Dựng lại một DB Ở ĐÚNG HÌNH DẠNG v1: bỏ 4 cột reply, hạ schema_version. */
function dbV1CoDuLieu() {
  const { db, duongDan } = dbTam();
  moNghe(db, '111');
  for (let i = 1; i <= 3; i += 1) {
    writeMessage(db, tinGia({ chatId: '111', msgId: `cu${i}`, noiDung: `câu cũ ${i}`, tsZalo: 1000 + i }));
  }
  // Hạ về v1 thật sự: SQLite không DROP COLUMN ở phiên bản cũ, nên dựng lại
  // bảng theo đúng khuôn v1 rồi chép dữ liệu sang.
  db.exec(`
    CREATE TABLE tin_nhan_v1 (
      chat_id TEXT NOT NULL, msg_id TEXT NOT NULL, cli_msg_id TEXT, user_id TEXT,
      ten_luc_gui TEXT, msg_type TEXT NOT NULL, noi_dung TEXT, content_raw TEXT,
      ts_zalo INTEGER NOT NULL, ts_ghi TEXT NOT NULL,
      tu_toi INTEGER NOT NULL DEFAULT 0, co_tag_host INTEGER NOT NULL DEFAULT 0,
      da_thu_hoi INTEGER NOT NULL DEFAULT 0, thu_hoi_boi TEXT, thu_hoi_luc INTEGER,
      do_tro_ly_tao INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, msg_id));
    INSERT INTO tin_nhan_v1 SELECT chat_id,msg_id,cli_msg_id,user_id,ten_luc_gui,
      msg_type,noi_dung,content_raw,ts_zalo,ts_ghi,tu_toi,co_tag_host,da_thu_hoi,
      thu_hoi_boi,thu_hoi_luc,do_tro_ly_tao FROM tin_nhan;
    DROP TABLE tin_nhan;
    ALTER TABLE tin_nhan_v1 RENAME TO tin_nhan;
    UPDATE meta SET gia_tri = '1' WHERE khoa = 'schema_version';
  `);
  closeDb(db);
  return duongDan;
}

test('F1 ★ migrate v1 -> mới nhất TUẦN TỰ trên DB CÓ DỮ LIỆU: không mất dòng nào, không mất chữ nào', () => {
  const duongDan = dbV1CoDuLieu();
  const db = openDb(duongDan);   // openDb tự gọi migrate, chạy CẢ HAI bước 1->2->3

  // Dùng HẰNG SỐ chứ không gõ cứng số phiên bản: bài này đã mục nát một lần
  // mỗi khi ai đó thêm bước migrate, mà nội dung nó canh thì không đổi.
  assert.equal(
    db.prepare("SELECT gia_tri AS v FROM meta WHERE khoa='schema_version'").get().v,
    PHIEN_BAN_SCHEMA,
  );
  const r = db.prepare('SELECT count(*) AS c FROM tin_nhan').get();
  assert.equal(Number(r.c), 3, 'mất dòng là mất hội thoại thật, không phát lại được');
  assert.equal(
    db.prepare("SELECT noi_dung AS n FROM tin_nhan WHERE msg_id='cu2'").get().n,
    'câu cũ 2',
  );
  const cot = db.prepare('PRAGMA table_info(tin_nhan)').all().map((c) => c.name);
  for (const c of [
    'tra_loi_msg_id', 'tra_loi_cli_msg_id', 'tra_loi_user_id', 'tra_loi_trich',
    'thu_hoi_nguon', 'thu_hoi_do_tin_cay', 'vang_mat_lan_dau', 'vang_mat_so_lan',
  ]) {
    assert.ok(cot.includes(c), `thiếu cột ${c}`);
  }
  // v4: lich_hen phải có đủ cột lời nhắc theo đuổi (bước 3->4 đã chạy).
  const cotLich = db.prepare('PRAGMA table_info(lich_hen)').all().map((c) => c.name);
  for (const c of ['la_theo_duoi', 'trang_thai_td', 'chu_ky_ngay', 'gio_nhac',
    'bo_chu_nhat', 'nhac_lan_cuoi_ms', 'so_lan_da_nhac', 'nguoi_phu_trach',
    'tam_dung_toi_ms', 'dong_boi', 'dong_luc_ms', 'ly_do_dong', 'cho_model_tu_ms']) {
    assert.ok(cotLich.includes(c), `lich_hen thiếu cột ${c}`);
  }

  // Dòng cũ phải là NULL ở cột mới — không được bịa giá trị.
  assert.equal(db.prepare("SELECT tra_loi_msg_id AS x FROM tin_nhan WHERE msg_id='cu1'").get().x, null);
  // ...TRỪ đúng một chỗ có suy ngược CÓ CHỦ ĐÍCH: tin đang `da_thu_hoi = 1` từ
  // trước v3 chỉ có thể sinh từ sự kiện `undo` thật ⇒ gán nguồn SU_KIEN. Đây là
  // lần DUY NHẤT được suy ngược; sau bước này mọi kết luận tự khai nguồn.
  assert.equal(
    db.prepare("SELECT thu_hoi_nguon AS x FROM tin_nhan WHERE da_thu_hoi = 0 LIMIT 1").get()?.x ?? null,
    null,
    'tin KHÔNG bị thu hồi thì tuyệt đối không được gán nguồn',
  );
  closeDb(db);
});

test('F1b ★ DB MỚI (schema.sql) và DB CŨ (migrate) phải cho CÙNG cấu trúc', () => {
  // 🔴 Bài này sinh ra từ một lỗi THẬT ngày 20/08/2026: v3 thêm 3 cột vào
  // `su_kien_thu_hoi` bằng MIGRATION_STEPS nhưng quên thêm vào schema.sql ⇒ máy có
  // DB cũ thì chạy được, máy dựng DB mới thì nổ "no such column" giữa truy vấn.
  // Hai đường dựng DB PHẢI hội tụ, và chỉ có bài test so trực tiếp mới bắt được.
  const dbMoi = openDb(dbTam().duongDan);
  const dbCu = openDb(dbV1CoDuLieu());
  const cot = (d, bang) =>
    d.prepare(`PRAGMA table_info(${bang})`).all().map((c) => c.name).sort();
  for (const bang of ['tin_nhan', 'su_kien_thu_hoi']) {
    assert.deepEqual(cot(dbMoi, bang), cot(dbCu, bang), `bảng ${bang} lệch giữa hai đường dựng`);
  }
  assert.deepEqual(describeSchema(dbMoi).bang, describeSchema(dbCu).bang);
  closeDb(dbMoi); closeDb(dbCu);
});

test('F1c ★ v10 -> v11 TRÊN DB CÓ DỮ LIỆU: ⛔ không mất ghi nhớ nào, cột mới NULL', () => {
  // 🔴 Bước v11 là bước DUY NHẤT của đợt này đụng vào BẢNG ĐÃ CÓ (`ghi_nho`).
  // F1 chạy v1 -> mới nhất nên có phủ, nhưng nó ⛔ không nói được bước NÀO hỏng
  // khi đỏ. Bài này cô lập đúng một bước, trên dữ liệu THẬT hình dạng v10.
  //
  // ⚠️ ⛔ KHÔNG chạy trên DB thật ở `~/.zalo-tro-ly/`: daemon đang mở nó, và
  // lượt này bị cấm đụng vào thư mục đó. Dựng lại HÌNH DẠNG v10 ở đây là phép
  // thử tương đương và ⛔ không có rủi ro nào cho dữ liệu đang chạy.
  const { db, duongDan } = dbTam();
  moNghe(db, '9990000000001');
  writeMemo(db, {
    chatId: '9990000000001', requestId: 'r-cu', nguoiGhi: '9991000000000000001',
    loai: 'chot_viec', noiDung: 'ghi nhớ có từ thời v10', nguyenVan: 'anh nói y như thế',
  });
  // Hạ về ĐÚNG hình dạng v10: bỏ 2 cột nguồn, bỏ 2 bảng mới, hạ phiên bản.
  db.exec(`
    CREATE TABLE ghi_nho_v10 AS
      SELECT id, chat_id, request_id, nguoi_ghi, loai, noi_dung, nguyen_van,
             khi_nao_ms, ai_lien_quan, ts_tao FROM ghi_nho;
    DROP TABLE ghi_nho;
    ALTER TABLE ghi_nho_v10 RENAME TO ghi_nho;
    DROP TABLE IF EXISTS yeu_cau_duyet;
    DROP TABLE IF EXISTS nhat_ky_hanh_dong;
    UPDATE meta SET gia_tri = '10' WHERE khoa = 'schema_version';
  `);
  closeDb(db);

  const sau = openDb(duongDan);                      // openDb tự migrate 10 -> 11
  assert.equal(sau.prepare("SELECT gia_tri AS v FROM meta WHERE khoa='schema_version'").get().v, '11');

  const g = sau.prepare("SELECT * FROM ghi_nho WHERE request_id = 'r-cu'").get();
  assert.ok(g, '🔴 MẤT GHI NHỚ CŨ khi migrate — dữ liệu thật không phát lại được');
  assert.equal(g.noi_dung, 'ghi nhớ có từ thời v10', '🔴 mất chữ');
  assert.equal(g.nguyen_van, 'anh nói y như thế');
  // NULL = "host tự nói", đúng trạng thái của mọi ghi nhớ trước v11.
  // ⛔ KHÔNG phải "không rõ" — dòng cũ lấy đâu ra nguồn.
  assert.equal(g.nguon_nguoi, null, 'cột mới phải NULL cho dòng cũ');
  assert.equal(g.nguon_nguyen_van, null);

  // Hai bảng mới do `schema.sql` dựng lại sau khi chạy hết các bước.
  for (const bang of ['yeu_cau_duyet', 'nhat_ky_hanh_dong']) {
    assert.ok(describeSchema(sau).bang.includes(bang), `🔴 thiếu bảng '${bang}' sau migrate`);
  }
  closeDb(sau);
});

test('F2 migrate chạy LẠI trên DB đã v2 -> không làm gì thêm, không ném', () => {
  const duongDan = dbV1CoDuLieu();
  const db1 = openDb(duongDan); closeDb(db1);
  const db2 = openDb(duongDan);                   // lần mở thứ hai
  const kq = migrate(db2);
  assert.deepEqual(kq.buocDaChay, [], 'chạy lại bước ALTER là ném "duplicate column"');
  assert.equal(kq.daDoi, false);
  closeDb(db2);
});

test('F3 phiên bản LẠ (không có bước migrate) vẫn NỔ như cũ', () => {
  const { db, duongDan } = dbTam();
  db.exec("UPDATE meta SET gia_tri = '99' WHERE khoa = 'schema_version'");
  closeDb(db);
  assert.throws(() => openDb(duongDan), /schema_version='99'/);
});

test('F4 ghi + đọc lại được 4 trường reply', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'tra-loi',
    traLoiMsgId: '9996000000002', traLoiCliMsgId: '1786095000001',
    traLoiUserId: '9993000000000000003', traLoiTrich: 'Test trợ lý 1',
  }));
  const r = db.prepare("SELECT * FROM tin_nhan WHERE msg_id='tra-loi'").get();
  assert.equal(r.tra_loi_msg_id, '9996000000002');
  assert.equal(r.tra_loi_user_id, '9993000000000000003');
  assert.equal(r.tra_loi_trich, 'Test trợ lý 1');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// G. groupMembers — nguồn tra uid cho tính năng tag
// ═══════════════════════════════════════════════════════════════════════════

test('G1 chỉ trả người ĐÃ NHẮN TRONG ĐÚNG NHÓM ĐÓ', () => {
  const { db } = dbTam();
  moNghe(db, 'nhomA'); moNghe(db, 'nhomB');
  writeMessage(db, tinGia({ chatId: 'nhomA', msgId: 'a1', userId: '111', tenLucGui: 'An' }));
  writeMessage(db, tinGia({ chatId: 'nhomB', msgId: 'b1', userId: '222', tenLucGui: 'Bình' }));

  const ds = groupMembers(db, 'nhomA');
  assert.deepEqual(ds, [{ uid: '111', ten: 'An' }]);
  assert.ok(!ds.some((n) => n.uid === '222'), 'lọt người nhóm khác = tag nhầm sang người ngoài cuộc');
  closeDb(db);
});

test('G2 lấy TÊN MỚI NHẤT khi người ta đổi tên hiển thị', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'x1', userId: '9', tenLucGui: 'Tên Cũ', tsZalo: 1000 }));
  writeMessage(db, tinGia({ chatId: '111', msgId: 'x2', userId: '9', tenLucGui: 'Tên Mới', tsZalo: 2000 }));
  assert.deepEqual(groupMembers(db, '111'), [{ uid: '9', ten: 'Tên Mới' }]);
  closeDb(db);
});

test('G3 nhóm chưa ai nhắn -> rỗng (fail-closed: không tag được ai)', () => {
  const { db } = dbTam();
  moNghe(db, 'trong');
  assert.deepEqual(groupMembers(db, 'trong'), []);
  closeDb(db);
});

test('H1 ★ tiếng vọng: tin trợ lý quay lại qua listener KHÔNG được xoá cờ do_tro_ly_tao', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  // 1) send.js ghi trước, có cờ.
  writeMessage(db, tinGia({ chatId: '111', msgId: 'echo', noiDung: 'Dạ em xem rồi ạ', tuToi: true }),
    { doTroLyTao: true });
  // 2) listener nhận lại CHÍNH tin đó (tuToi=true) và ghi lần hai, KHÔNG cờ.
  const lanHai = writeMessage(db, tinGia({ chatId: '111', msgId: 'echo', noiDung: 'Dạ em xem rồi ạ', tuToi: true }));

  assert.equal(lanHai, false, 'INSERT OR IGNORE phải bỏ lần ghi thứ hai');
  const r = db.prepare("SELECT count(*) AS c FROM tin_nhan WHERE msg_id='echo'").get();
  assert.equal(Number(r.c), 1, 'không được nhân đôi dòng');
  const cờ = db.prepare("SELECT do_tro_ly_tao AS d FROM tin_nhan WHERE msg_id='echo'").get().d;
  assert.equal(Number(cờ), 1,
    'đổi sang INSERT OR REPLACE là bản echo đè mất cờ -> lại không truy ra câu nào của trợ lý');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// I. NỐI QUOTE/REPLY RA TẦNG ĐỌC
//
// 🔴 Số liệu THẬT lấy từ DB đang chạy (20/08/2026):
//    tin reply  msg_id 9996000000003
//    tin gốc    msg_id 9996000000001  (do trợ lý gửi, uid 999200000000000002)
//    trích đoạn "Dạ có, nhưng không phải qua tool em đang..."
// ═══════════════════════════════════════════════════════════════════════════

const GOC_ID = '9996000000001';
const REPLY_ID = '9996000000003';
const BOT_UID = '999200000000000002';
const TRICH = 'Dạ có, nhưng không phải qua tool em đang dùng';

function dbCoReply(chatGoc = '111') {
  const { db } = dbTam();
  moNghe(db, '111');
  if (chatGoc !== '111') moNghe(db, chatGoc);
  writeMessage(db, tinGia({
    chatId: chatGoc, msgId: GOC_ID, userId: BOT_UID, tenLucGui: 'Hảis Assistant',
    noiDung: 'Dạ có, nhưng không phải qua tool em đang dùng ạ', tsZalo: 1000,
  }));
  writeMessage(db, tinGia({
    chatId: '111', msgId: REPLY_ID, userId: '9993000000000000003', tenLucGui: 'Minh Hải',
    noiDung: 'thế à', tsZalo: 2000,
    traLoiMsgId: GOC_ID, traLoiUserId: BOT_UID, traLoiTrich: TRICH,
  }));
  return db;
}

test('I1 ★ tin reply trả kèm TIN GỐC: ai viết, viết gì', () => {
  const db = dbCoReply();
  const { rows } = queryHistory(db, { chatId: '111', soLuong: 10 });
  const r = rows.find((x) => x.msg_id === REPLY_ID);
  assert.ok(r._tra_loi, 'không có _tra_loi thì trợ lý nhìn tin reply y hệt tin thường');
  assert.equal(r._tra_loi.coTrongKho, true);
  assert.equal(r._tra_loi.tenNguoiGoc, 'Hảis Assistant');
  assert.equal(r._tra_loi.noiDungGoc, 'Dạ có, nhưng không phải qua tool em đang dùng ạ');
  assert.equal(r._tra_loi.msgIdGoc, GOC_ID);
  closeDb(db);
});

test('I2 tin thường -> _tra_loi = null, không bịa bối cảnh', () => {
  const db = dbCoReply();
  const { rows } = queryHistory(db, { chatId: '111', soLuong: 10 });
  assert.equal(rows.find((x) => x.msg_id === GOC_ID)._tra_loi, null);
  closeDb(db);
});

test('I3 🔴 tin gốc KHÔNG có trong kho -> NÓI RÕ, cấm im lặng bỏ qua', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({
    chatId: '111', msgId: REPLY_ID, noiDung: 'thế à',
    traLoiMsgId: '9999999999999', traLoiUserId: BOT_UID, traLoiTrich: TRICH,
  }));
  const { rows } = queryHistory(db, { chatId: '111', soLuong: 10 });
  const tl = rows[0]._tra_loi;
  assert.equal(tl.coTrongKho, false);
  assert.match(tl.ghiChu, /KHÔNG có tin gốc trong kho/,
    'im lặng thì trợ lý tưởng là tin thường và trả lời lạc đề mà không ai biết vì sao');
  assert.equal(tl.trichDoan, TRICH, 'còn trích đoạn thì phải đưa ra, đừng vứt nốt');
  closeDb(db);
});

test('I4 🔴 CHỐNG RÒ CHÉO: tin gốc ở NHÓM KHÁC không được ghép ra', () => {
  const db = dbCoReply('nhomKhac');
  const { rows, nguonChatIds } = queryHistory(db, { chatId: '111', soLuong: 10 });
  const r = rows.find((x) => x.msg_id === REPLY_ID);
  assert.equal(r._tra_loi.coTrongKho, false, 'ghép được sang nhóm khác là RÒ CHÉO');
  assert.ok(!nguonChatIds.includes('nhomKhac'), 'nguồn cũng không được nhắc tới nhóm kia');
  closeDb(db);
});

test('I5 ghép bằng CAST INTEGER — chênh định dạng vẫn ra đúng dòng', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  // msg_id có số 0 ở đầu: so CHUỖI thì trượt, CAST thì trúng. Đây là lớp
  // phòng thủ cho đúng bẫy đã dính 2 lần trong pack (undo, reaction).
  writeMessage(db, tinGia({ chatId: '111', msgId: `0${GOC_ID}`, noiDung: 'tin gốc', tsZalo: 1000 }));
  writeMessage(db, tinGia({ chatId: '111', msgId: REPLY_ID, noiDung: 'thế à', tsZalo: 2000, traLoiMsgId: GOC_ID }));
  const { rows } = queryHistory(db, { chatId: '111', soLuong: 10 });
  assert.equal(rows.find((x) => x.msg_id === REPLY_ID)._tra_loi.noiDungGoc, 'tin gốc');
  closeDb(db);
});

test('I6 đường lùi cli_msg_id khi globalMsgId = 0 (Zalo không trả id)', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: 'g1', cliMsgId: '555000', noiDung: 'tin gốc', tsZalo: 1000 }));
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'r1', noiDung: 'thế à', tsZalo: 2000,
    traLoiMsgId: null, traLoiCliMsgId: '555000',
  }));
  const { rows } = queryHistory(db, { chatId: '111', soLuong: 10 });
  assert.equal(rows.find((x) => x.msg_id === 'r1')._tra_loi.noiDungGoc, 'tin gốc');
  closeDb(db);
});

test('I7 tin gốc là ẢNH (không có chữ) -> nói rõ chứ không trả null im lặng', () => {
  const { db } = dbTam();
  moNghe(db, '111');
  writeMessage(db, tinGia({ chatId: '111', msgId: GOC_ID, msgType: 'chat.image', noiDung: null, tsZalo: 1000 }));
  writeMessage(db, tinGia({ chatId: '111', msgId: REPLY_ID, noiDung: 'ảnh đẹp', tsZalo: 2000, traLoiMsgId: GOC_ID }));
  const { rows } = queryHistory(db, { chatId: '111', soLuong: 10 });
  const tl = rows.find((x) => x.msg_id === REPLY_ID)._tra_loi;
  assert.equal(tl.coTrongKho, true);
  assert.match(tl.ghiChu, /KHÔNG phải tin văn bản/);
  closeDb(db);
});

test('I8 replyContext tra được từ requestId trong hàng đợi', () => {
  const db = dbCoReply();
  enqueueQuestion(db, {
    requestId: 'R-test-1', chatIdHoi: '111', msgId: REPLY_ID,
    userId: '9993000000000000003', noiDung: 'thế à', tsTao: new Date().toISOString(),
  });
  const tl = replyContext(db, 'R-test-1');
  assert.equal(tl.coTrongKho, true);
  assert.equal(tl.noiDungGoc, 'Dạ có, nhưng không phải qua tool em đang dùng ạ');
  assert.equal(replyContext(db, 'R-khong-co'), null);
  closeDb(db);
});

test('I9 hàng đợi KHÔNG phải cửa sau: hội thoại tắt nghe thì không tra ra gì', () => {
  const db = dbCoReply();
  db.exec("UPDATE hoi_thoai SET duoc_nghe = 0 WHERE chat_id = '111'");
  enqueueQuestion(db, {
    requestId: 'R-test-2', chatIdHoi: '111', msgId: REPLY_ID,
    userId: '1', noiDung: 'thế à', tsTao: new Date().toISOString(),
  });
  assert.equal(replyContext(db, 'R-test-2'), null, 'fail-closed y như mọi đường đọc khác');
  closeDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// J. BACKFILL — bin/va_lai_noi_dung.js
// ═══════════════════════════════════════════════════════════════════════════

const { vaLai } = await import('../bin/va_lai_noi_dung.js');

/** DB có đúng 3 ca như kho thật: mất chữ, đã có chữ, và tin không phải text. */
function dbCanVa() {
  const { db, duongDan } = dbTam();
  moNghe(db, '111');
  // (a) mất chữ — nguyên văn từ kho thật
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'mat1', msgType: 'UNKNOWN', noiDung: null, tsZalo: 1000,
    contentRaw: JSON.stringify({ _msgTypeGoc: 'webchat', _khongPhaiJson: true, _text: 'Test trợ lý 1' }),
  }));
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'mat2', msgType: 'UNKNOWN', noiDung: null, tsZalo: 1100,
    contentRaw: JSON.stringify({ _msgTypeGoc: 'webchat', _khongPhaiJson: true, _text: '@Hải Ai tin này có tag nhé' }),
  }));
  // đã có chữ — CẤM đè
  writeMessage(db, tinGia({ chatId: '111', msgId: 'co1', noiDung: 'chữ sẵn có', tsZalo: 1200 }));
  // 🔴 CA NGUY HIỂM NHẤT: đã có chữ ĐÚNG mà content_raw vẫn còn `_text` cũ.
  // Đây là dòng đã được vá một lần rồi (hoặc listener ghi sau send.js). Bỏ
  // chốt "chỉ ghi dòng đang rỗng" là ghi đè bản đúng bằng bản cũ.
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'ca_hai', msgType: 'chat.text', noiDung: 'BẢN ĐÚNG', tsZalo: 1250,
    contentRaw: JSON.stringify({ _msgTypeGoc: 'webchat', _khongPhaiJson: true, _text: 'bản cũ SAI' }),
  }));
  // sticker: đúng ra phải NULL (spec H), backfill KHÔNG được đụng
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'stk', msgType: 'UNKNOWN', noiDung: null, tsZalo: 1300,
    contentRaw: JSON.stringify({ _msgTypeGoc: 'chat.sticker', id: 27182 }),
  }));
  // tin trợ lý thiếu tên
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'bot1', userId: '999200000000000002', tenLucGui: null,
    noiDung: 'Dạ em xem rồi ạ', tsZalo: 1400,
  }), { doTroLyTao: true });
  writeMessage(db, tinGia({
    chatId: '111', msgId: 'bot0', userId: '999200000000000002', tenLucGui: 'Hảis Assistant',
    noiDung: 'câu trước', tsZalo: 1350,
  }));
  closeDb(db);
  return duongDan;
}

test('J1 ★ chạy thử KHÔNG ghi gì — mặc định phải an toàn', () => {
  const dd = dbCanVa();
  const kq = vaLai(dd, false);
  assert.equal(kq.truoc.co_chu, kq.sau.co_chu, 'chạy thử mà ghi là mất an toàn mặc định');
  assert.equal(kq.ketQua.find((b) => b.ten === 'do-chu').soKhop, 2, 'vẫn phải ĐẾM đúng');
});

test('J2 ★ ghi thật: số dòng KHÔNG đổi, số dòng có chữ CHỈ TĂNG', () => {
  const dd = dbCanVa();
  const kq = vaLai(dd, true);
  assert.equal(Number(kq.sau.tong), Number(kq.truoc.tong));
  assert.equal(Number(kq.sau.co_chu), Number(kq.truoc.co_chu) + 2);
});

test('J3 🔴 KHÔNG đè lên dòng đã có chữ', () => {
  const dd = dbCanVa();
  vaLai(dd, true);
  const db = openDb(dd);
  assert.equal(db.prepare("SELECT noi_dung AS n FROM tin_nhan WHERE msg_id='co1'").get().n, 'chữ sẵn có');
  closeDb(db);
});

test('J3b 🔴 dòng đã có chữ mà content_raw còn `_text` cũ -> TUYỆT ĐỐI không đè', () => {
  const dd = dbCanVa();
  vaLai(dd, true);
  const db = openDb(dd);
  assert.equal(
    db.prepare("SELECT noi_dung AS n FROM tin_nhan WHERE msg_id='ca_hai'").get().n,
    'BẢN ĐÚNG',
    'đè bản đúng bằng bản cũ là làm hỏng dữ liệu THẬT, không phải lấp chỗ trống',
  );
  closeDb(db);
});

test('J4 sticker KHÔNG bị đụng (spec H: loại khác text thì noi_dung phải NULL)', () => {
  const dd = dbCanVa();
  vaLai(dd, true);
  const db = openDb(dd);
  const r = db.prepare("SELECT noi_dung AS n, msg_type AS t FROM tin_nhan WHERE msg_id='stk'").get();
  assert.equal(r.n, null);
  assert.equal(r.t, 'UNKNOWN');
  closeDb(db);
});

test('J5 msg_type của dòng vừa lấp phải thành chat.text, không để nửa vời', () => {
  const dd = dbCanVa();
  vaLai(dd, true);
  const db = openDb(dd);
  const r = db.prepare("SELECT noi_dung AS n, msg_type AS t FROM tin_nhan WHERE msg_id='mat1'").get();
  assert.equal(r.n, 'Test trợ lý 1');
  assert.equal(r.t, 'chat.text', 'để nguyên UNKNOWN là vẫn bị bỏ sót ở tầng đọc');
  closeDb(db);
});

test('J6 tên bot lấy TỪ DB, không viết cứng', () => {
  const dd = dbCanVa();
  vaLai(dd, true);
  const db = openDb(dd);
  assert.equal(
    db.prepare("SELECT ten_luc_gui AS t FROM tin_nhan WHERE msg_id='bot1'").get().t,
    'Hảis Assistant',
  );
  closeDb(db);
});

test('J7 chạy lại lần hai là no-op (idempotent)', () => {
  const dd = dbCanVa();
  vaLai(dd, true);
  const lan2 = vaLai(dd, true);
  for (const b of lan2.ketQua) assert.equal(b.soKhop, 0, `bước ${b.ten} còn khớp ${b.soKhop} dòng`);
});
