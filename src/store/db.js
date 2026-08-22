/**
 * ═══════════════════════════════════════════════════════════════════════
 * G3 — MỞ DB. CHỦ SỞ HỮU: G3. Gói khác KHÔNG sửa file này.
 *
 * `node:sqlite` là BUILT-IN (Node ≥ 22, đo thật trên v26.7.0) — không cài
 * gói nào, không native addon.
 *
 * RÀNG BUỘC ĐÃ CHỐT Ở G0, GIỮ NGUYÊN:
 *  · Đường dẫn PHẢI đi qua expandPath() — Node KHÔNG nở dấu `~`, đưa thẳng
 *    "~/.zalo-tro-ly/lichsu.db" vào fs sẽ tạo thư mục tên "~" NGAY TRONG
 *    REPO, không báo lỗi, và mức siết CAO bị vô hiệu hoá âm thầm.
 *  · schema.sql là hợp đồng — NẠP file đó, KHÔNG chép CREATE TABLE vào code.
 *  · PHIEN_BAN_SCHEMA trong src/lib/hang_so.js là nguồn duy nhất.
 *
 * 🔴 QUYỀN FILE 0600 cho CẢ BA `<db>`, `<db>-wal`, `<db>-shm`.
 *    lichsu.db chứa tin nhắn CỦA NGƯỜI KHÁC; SQLite tạo file theo umask
 *    (thường 0644) ⇒ mọi user trên máy đọc được.
 *    ⚠️ Giới hạn đã biết, nói thẳng: `-wal`/`-shm` do SQLite tự sinh nên
 *    không chặn được lúc tạo, chỉ chmod BÙ sau khi mở. Và WAL xoá `-wal`
 *    khi kết nối cuối cùng đóng ⇒ tiến trình sau tạo lại nó theo umask.
 *    Vì vậy `tightenPermissions()` được gọi lại sau migrate (lúc file đã chắc chắn
 *    tồn tại) và được EXPORT để nơi khác gọi lại khi cần.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { ensureParentDir, expandPath } from '../lib/paths.js';
import { PHIEN_BAN_SCHEMA } from '../lib/hang_so.js';

/** @typedef {import('node:sqlite').DatabaseSync} TDb */

const THU_MUC_NAY = path.dirname(fileURLToPath(import.meta.url));
/** schema.sql nằm ở gốc pack — nguồn sự thật DUY NHẤT của cấu trúc bảng. */
export const SCHEMA_PATH = path.resolve(THU_MUC_NAY, '..', '..', 'schema.sql');

/**
 * Tên đặc biệt của SQLite cho DB nằm hoàn toàn trong RAM. Cố ý cho qua
 * `expandPath()` — nếu không, ':memory:' bị resolve thành `<cwd>/:memory:` và
 * test lại đi tạo file rác trong repo.
 */
const RAM = ':memory:';

/**
 * Hàm SQL tự đăng ký: hạ chữ thường ĐÚNG CHO TIẾNG VIỆT.
 *
 * 🔴 VÌ SAO PHẢI CÓ (đo thật 20/08/2026, không phải đọc doc):
 *      SELECT lower('BÁO GIÁ')            ->  'bÁo giÁ'      ← dấu KHÔNG hạ
 *      ... WHERE a LIKE '%BÁO%'           ->  0 dòng         ← TRƯỢT
 *      ... WHERE chu_thuong_vn(a) LIKE …  ->  1 dòng         ← TRÚNG
 * `lower()` và `LIKE` của SQLite chỉ gập hoa/thường cho ASCII. Chữ có dấu
 * tiếng Việt nằm ngoài ASCII ⇒ tìm "BÁO GIÁ" không ra "Báo giá". Hỏng CÂM:
 * truy vấn chạy trót lọt, chỉ là trả về rỗng.
 * `String.prototype.toLowerCase()` của JS thì gập đúng Unicode.
 *
 * Không dùng được chỉ mục (LIKE '%…%' vốn đã không dùng được), nên không mất gì.
 *
 * @param {TDb} db
 */
export function registerSqlFunctions(db) {
  try {
    db.function('chu_thuong_vn', { deterministic: true }, (s) =>
      s === null || s === undefined ? null : String(s).toLowerCase(),
    );
  } catch (e) {
    // Đăng ký trùng tên KHÔNG ném lỗi trên Node 26 (đã đo), nhưng bản khác
    // có thể khác — nuốt để việc mở DB không bao giờ chết vì chuyện phụ.
    process.stderr.write(`[store/db] không đăng ký được chu_thuong_vn: ${e.message}\n`);
  }
}

/**
 * chmod 0600 cho file DB và 2 file phụ của WAL.
 * @param {string} duongDanTuyetDoi
 * @returns {string[]} các file đã siết được (để nghiệm thu, đừng tự khai)
 */
export function tightenPermissions(duongDanTuyetDoi) {
  if (duongDanTuyetDoi === RAM) return [];
  const xong = [];
  for (const p of [duongDanTuyetDoi, `${duongDanTuyetDoi}-wal`, `${duongDanTuyetDoi}-shm`]) {
    try {
      if (fs.existsSync(p)) {
        fs.chmodSync(p, 0o600);
        xong.push(p);
      }
    } catch (e) {
      process.stderr.write(`[store/db] không chmod được ${p}: ${e.message}\n`);
    }
  }
  return xong;
}

/**
 * Mở (hoặc tạo) DB, bật WAL, migrate, siết quyền.
 *
 * ═══ `{ migrate: false }` — DÀNH CHO CLIENT, KHÔNG PHẢI TỐI ƯU ═══
 *
 * 🔴 `migrate()` đọc phiên bản **TRƯỚC** `BEGIN IMMEDIATE`. Nhiều tiến trình mở
 * DB cùng lúc là một CUỘC ĐUA THẬT: A đọc `'6'` → A nâng lên `'7'` → B (đã đọc
 * `'6'` từ trước, không biết gì) chạy lại đúng bước 6→7 → `ALTER TABLE` trùng
 * cột → **B chết**. Lúc máy khởi động, N client mở một lượt là ca xảy ra chắc
 * chắn nhất.
 *
 * ⇒ **Đúng MỘT tiến trình được đổi cấu trúc** (daemon). Client mở với
 * `{ migrate: false }`: không đổi gì, chỉ **kiểm** rồi **NÉM** nếu lệch.
 *
 * ⛔ KHÔNG có nhánh "lệch thì thôi kệ, chạy tiếp". Code mới đọc/ghi trên cấu
 * trúc cũ là hỏng CÂM — cột thiếu trả `undefined`, không ai báo gì cả. Thà
 * client không mở được: lệch phiên bản lộ ra NGAY, ở đúng chỗ sửa được.
 *
 * ⚠️ Mặc định `migrate: true` ⇒ **đường một-tiến-trình hôm nay không đổi một
 * hành vi nào**. Đây là điều kiện Router đặt ra cho cả ba bước.
 *
 * @param {string} duongDanDb đã hoặc chưa qua expandPath() — hàm tự gọi cho chắc
 * @param {{migrate?: boolean}} [tuyChon]
 * @returns {TDb}
 */
export function openDb(duongDanDb, tuyChon = {}) {
  const p = duongDanDb === RAM ? RAM : expandPath(duongDanDb);
  if (p !== RAM) ensureParentDir(p);

  const db = new DatabaseSync(p);

  // WAL: cho phép đọc trong lúc đang ghi. `:memory:` không hỗ trợ WAL —
  // PRAGMA im lặng giữ nguyên 'memory', không ném lỗi, nên không cần rẽ nhánh.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Hai tiến trình cùng ghi (server + bin/zalo-export.js) thì bên sau chờ
  // thay vì nổ SQLITE_BUSY ngay lập tức.
  db.exec('PRAGMA busy_timeout = 5000');

  registerSqlFunctions(db);
  if (tuyChon.migrate === false) {
    assertSchemaVersion(db, p);
  } else {
    migrate(db);
  }
  // Gọi SAU migrate: migrate có ghi, nên tới đây `-wal` mới chắc chắn tồn tại.
  tightenPermissions(p);
  return db;
}

/**
 * ★ Kiểm phiên bản cho tiến trình KHÔNG được migrate. Lệch ⇒ NÉM.
 *
 * 🔴 Thông điệp phải nêu **CẢ HAI SỐ**. Câu "phiên bản không khớp" chung chung
 * bắt người đọc đi mở hai file mới biết ai cũ ai mới; nêu cả hai số thì đọc
 * xong biết ngay phải nâng cái nào — mà lúc gặp lỗi này thường là lúc 10 pane
 * vừa chết cùng lúc và không ai bình tĩnh.
 *
 * ⚠️ DB TRẮNG (`getSchemaVersion` trả `null`) cũng NÉM. Client tự dựng schema là
 * quay lại đúng cuộc đua vừa chặn, chỉ khác tên gọi.
 *
 * @param {TDb} db
 * @param {string} duongDan chỉ để nói cho người đọc biết đang nói tới file nào
 */
export function assertSchemaVersion(db, duongDan = '(không rõ)') {
  const v = getSchemaVersion(db);
  if (v === null) {
    throw new Error(
      `DB '${duongDan}' chưa có cấu trúc nào (chưa migrate lần nào), client cần `
      + `'${PHIEN_BAN_SCHEMA}'. Client KHÔNG được tự dựng schema — chạy daemon trước.`,
    );
  }
  if (v !== PHIEN_BAN_SCHEMA) {
    throw new Error(
      `DB đang v${v}, client cần v${PHIEN_BAN_SCHEMA} — daemon chưa nâng cấp xong. `
      + `File: '${duongDan}'. Client KHÔNG tự migrate (nhiều tiến trình cùng migrate là `
      + 'cuộc đua ALTER TABLE trùng cột). Chờ daemon lên đúng phiên bản rồi chạy lại.',
    );
  }
  return v;
}

/**
 * @param {TDb} db
 * @returns {void}
 */
export function closeDb(db) {
  try {
    db.close();
  } catch (e) {
    // Đóng hai lần / đã đóng sẵn không phải lỗi đáng làm chết luồng tắt máy.
    process.stderr.write(`[store/db] closeDb bỏ qua lỗi: ${e.message}\n`);
  }
}

/**
 * @param {TDb} db
 * @returns {string|null} null = DB trắng, chưa có bảng meta
 */
export function getSchemaVersion(db) {
  try {
    const r = db.prepare("SELECT gia_tri FROM meta WHERE khoa = 'schema_version'").get();
    return r ? String(r.gia_tri) : null;
  } catch {
    // Bảng meta chưa tồn tại — đúng trạng thái của một DB trắng, không phải lỗi.
    return null;
  }
}

/**
 * Cột đã có trong bảng chưa? Dùng để `ALTER TABLE ADD COLUMN` chạy lại được
 * nhiều lần mà không ném — SQLite KHÔNG có `ADD COLUMN IF NOT EXISTS`.
 *
 * @param {TDb} db
 * @param {string} bang
 * @param {string} cot
 * @returns {boolean}
 */
function _coCot(db, bang, cot) {
  try {
    return db.prepare(`PRAGMA table_info(${bang})`).all().some((c) => c.name === cot);
  } catch {
    return false;
  }
}

/** Thêm cột nếu chưa có. Trả về true nếu ĐÃ thêm thật. */
function _themCot(db, bang, cot, kieu) {
  if (_coCot(db, bang, cot)) return false;
  db.exec(`ALTER TABLE ${bang} ADD COLUMN ${cot} ${kieu}`);
  return true;
}

/**
 * CÁC BƯỚC MIGRATE, chạy tuần tự theo `tu` -> `den`.
 *
 * 🔴 LUẬT CHO MỌI BƯỚC THÊM VÀO ĐÂY:
 *  · CHỈ ĐƯỢC CỘNG THÊM (`ADD COLUMN`, `CREATE TABLE`). CẤM `DROP`, cấm
 *    `ALTER ... RENAME`, cấm dựng bảng mới rồi copy dữ liệu sang. DB này là
 *    kho lịch sử hội thoại THẬT của người thật — mất là mất hẳn, không có
 *    nguồn nào phát lại được.
 *  · Cột mới PHẢI cho phép NULL và KHÔNG có `NOT NULL` (dòng cũ lấy đâu ra
 *    giá trị). SQLite cũng từ chối `ADD COLUMN NOT NULL` không có DEFAULT.
 *  · Phải chạy lại được nhiều lần mà không ném (dùng `_themCot`).
 *
 * @type {Array<{tu: string, den: string, moTa: string, chay: (db: TDb) => void}>}
 */
export const MIGRATION_STEPS = [
  {
    tu: '1',
    den: '2',
    moTa: 'tin_nhan: thêm 4 cột thông tin REPLY/QUOTE (tin này trả lời tin nào)',
    chay(db) {
      _themCot(db, 'tin_nhan', 'tra_loi_msg_id', 'TEXT');
      _themCot(db, 'tin_nhan', 'tra_loi_cli_msg_id', 'TEXT');
      _themCot(db, 'tin_nhan', 'tra_loi_user_id', 'TEXT');
      _themCot(db, 'tin_nhan', 'tra_loi_trich', 'TEXT');
    },
  },
  {
    tu: '2',
    den: '3',
    moTa: 'nguồn/độ tin cậy của kết luận thu hồi + khoảng thời gian cho ca DOI_CHIEU',
    chay(db) {
      // ── tin_nhan: PHÂN BIỆT "biết chắc" với "suy ra" ──────────────────
      // Dòng CŨ không được đụng tới: dòng nào đang `da_thu_hoi = 1` là do nghe
      // được sự kiện `undo` thật, nên phải mang nguồn SU_KIEN. Đây là lần DUY
      // NHẤT ta được phép suy ngược như vậy — sau bước này thì mọi kết luận
      // đều tự khai nguồn của nó.
      _themCot(db, 'tin_nhan', 'thu_hoi_nguon', 'TEXT');
      _themCot(db, 'tin_nhan', 'thu_hoi_do_tin_cay', 'TEXT');
      _themCot(db, 'tin_nhan', 'vang_mat_lan_dau', 'TEXT');
      _themCot(db, 'tin_nhan', 'vang_mat_so_lan', 'INTEGER NOT NULL DEFAULT 0');
      db.exec(
        "UPDATE tin_nhan SET thu_hoi_nguon = 'SU_KIEN', thu_hoi_do_tin_cay = 'CHAC_CHAN' "
          + 'WHERE da_thu_hoi = 1 AND thu_hoi_nguon IS NULL',
      );

      // ── su_kien_thu_hoi ──────────────────────────────────────────────
      // `nguon` có DEFAULT 'SU_KIEN' nên mọi dòng cũ tự đúng — chúng đều sinh
      // từ sự kiện undo thật.
      _themCot(db, 'su_kien_thu_hoi', 'nguon', "TEXT NOT NULL DEFAULT 'SU_KIEN'");
      // 🔴 HAI CỘT NÀY KHÔNG CÓ TRONG BẢN THIẾT KẾ — thêm có chủ ý, đã báo Router.
      // Thiết kế đòi "với DOI_CHIEU chỉ được nói 'biến mất trong khoảng
      // 14:00–14:30', không nói một mốc". Muốn nói được câu đó thì phải LƯU
      // được cái khoảng ấy. Chỉ có cột `nguon` thì tầng trên biết là mình không
      // chắc, nhưng KHÔNG có số nào để nói ra — và thứ duy nhất sẵn có lại là
      // `ts_zalo` (= lúc quét), tức đúng con số dễ bị đọc nhầm thành giờ thu hồi.
      _themCot(db, 'su_kien_thu_hoi', 'khoang_tu_ms', 'INTEGER');
      _themCot(db, 'su_kien_thu_hoi', 'khoang_den_ms', 'INTEGER');
    },
  },
  {
    tu: '3',
    den: '4',
    moTa: 'lich_hen: lời nhắc THEO ĐUỔI tới khi xong (lặp, chu kỳ, ai đóng)',
    chay(db) {
      // ⚠️ `trang_thai` KHÔNG đụng tới: ràng buộc CHECK của nó liệt kê cứng 6
      // giá trị, muốn thêm giá trị thứ 7 phải DỰNG LẠI BẢNG — mà luật migrate
      // của pack cấm DROP/RENAME/copy-bảng. Nên trạng thái riêng của lời nhắc
      // theo đuổi đi vào cột MỚI `trang_thai_td`, chỉ có nghĩa khi la_theo_duoi=1.
      _themCot(db, 'lich_hen', 'la_theo_duoi', 'INTEGER NOT NULL DEFAULT 0');
      _themCot(db, 'lich_hen', 'trang_thai_td', 'TEXT');
      _themCot(db, 'lich_hen', 'chu_ky_ngay', 'INTEGER NOT NULL DEFAULT 1');
      _themCot(db, 'lich_hen', 'gio_nhac', 'TEXT');
      _themCot(db, 'lich_hen', 'bo_chu_nhat', 'INTEGER NOT NULL DEFAULT 1');
      _themCot(db, 'lich_hen', 'nhac_lan_cuoi_ms', 'INTEGER');
      _themCot(db, 'lich_hen', 'so_lan_da_nhac', 'INTEGER NOT NULL DEFAULT 0');
      _themCot(db, 'lich_hen', 'nguoi_phu_trach', 'TEXT');
      _themCot(db, 'lich_hen', 'tam_dung_toi_ms', 'INTEGER');
      _themCot(db, 'lich_hen', 'dong_boi', 'TEXT');
      _themCot(db, 'lich_hen', 'dong_luc_ms', 'INTEGER');
      _themCot(db, 'lich_hen', 'ly_do_dong', 'TEXT');
      _themCot(db, 'lich_hen', 'cho_model_tu_ms', 'INTEGER');
      // CỐ Ý KHÔNG đụng dòng cũ: mọi lịch đã có đều là lịch MỘT LẦN
      // (la_theo_duoi = 0 nhờ DEFAULT). Biến chúng thành lời nhắc lặp là tự ý
      // bật một thứ nhắn vào nhóm người thật mỗi sáng mà không ai duyệt.
    },
  },
  {
    tu: '4',
    den: '5',
    moTa: 'lich_hen: nhịp nhắc theo PHÚT (chu_ky_phut) + trần số lần (tran_so_lan)',
    chay(db) {
      // Cả hai đều CHO PHÉP NULL: dòng cũ không có giá trị nào để điền, và
      // NULL ở đây MANG NGHĨA — `chu_ky_phut` NULL = vẫn chạy theo nhịp ngày,
      // `tran_so_lan` NULL = không trần (đúng luật cũ "nhắc tới khi xong").
      _themCot(db, 'lich_hen', 'chu_ky_phut', 'INTEGER');
      _themCot(db, 'lich_hen', 'tran_so_lan', 'INTEGER');
    },
  },
  {
    tu: '5',
    den: '6',
    moTa: 'ghi_nho + nhat_ky_cong_ghi: chỗ đáp cho chữ "lưu lại" và sổ đo chốt chặn ghi',
    chay(db) {
      // 🔴 Bước này CỐ Ý RỖNG, và đó là điều đúng — không phải quên.
      // Cả hai bảng đều MỚI HOÀN TOÀN, không sửa bảng cũ, không thêm cột vào
      // bảng cũ. Mà `migrate()` luôn nạp lại `schema.sql` SAU khi chạy hết các
      // bước, và mọi lệnh trong đó là `CREATE TABLE IF NOT EXISTS` ⇒ hai bảng
      // được tạo ở đó.
      // ⛔ ĐỪNG `CREATE TABLE` lặp lại ở đây: hai bản định nghĩa cùng một bảng
      // là hai thứ sẽ trôi xa nhau, và bản trong `schema.sql` mới là bản DB
      // trắng dùng — tức bản đang chạy trên máy người khác sẽ khác bản migrate.
      // Giữ MỘT nguồn sự thật cho cấu trúc bảng.
      void db;
    },
  },
  {
    tu: '6',
    den: '7',
    moTa: 'hang_doi_gui (outbox) + nguon_phien (sổ nguồn chống rò chéo) — nền cho tách daemon/client',
    chay(db) {
      // 🔴 CỐ Ý RỖNG, giống bước 5->6, và đây là điều ĐÚNG.
      // Hai bảng đều MỚI HOÀN TOÀN — không thêm cột vào bảng cũ, không sửa gì.
      // `migrate()` luôn nạp lại `schema.sql` SAU khi chạy hết các bước, mà mọi
      // lệnh trong đó là `CREATE TABLE IF NOT EXISTS` ⇒ hai bảng sinh ra ở đó.
      // ⛔ ĐỪNG chép `CREATE TABLE` vào đây: hai bản định nghĩa cùng một bảng là
      // hai thứ sẽ trôi xa nhau, và bản `schema.sql` mới là bản DB TRẮNG dùng —
      // tức máy người khác sẽ có cấu trúc khác máy mình mà không ai biết.
      // ⚠️ Bài `M1` trong `test/cum9_tach_daemon.test.js` canh đúng chuyện đó:
      // dựng DB bằng CẢ HAI đường rồi so từng cột.
      void db;
    },
  },
  {
    tu: '7',
    den: '8',
    moTa: 'nhat_ky_truy_van: thêm client_id — trả lời được "PANE NÀO đã đọc nhóm nào"',
    chay(db) {
      // ⚠️ KHÁC hai bước trước: đây là THÊM CỘT vào bảng ĐÃ CÓ, nên phải làm
      // thật ở đây — `schema.sql` chỉ `CREATE TABLE IF NOT EXISTS`, bảng đã tồn
      // tại thì nó bỏ qua và cột mới KHÔNG BAO GIỜ được tạo trên DB cũ.
      // ⛔ Cột mới PHẢI cho phép NULL: dòng cũ lấy đâu ra giá trị.
      _themCot(db, 'nhat_ky_truy_van', 'client_id', 'TEXT');
    },
  },
  {
    tu: '8',
    den: '9',
    moTa: "hang_doi_hoi: thêm chi_nghe (lượt chỉ để nghe) + trạng thái 'dang_xu_ly'",
    chay(db) {
      // ⚠️ THÊM CỘT vào bảng ĐÃ CÓ ⇒ phải làm thật ở đây; `schema.sql` chỉ
      // `CREATE TABLE IF NOT EXISTS` nên bảng cũ không bao giờ nhận cột mới.
      // Dòng cũ mặc định 0 = "lượt được nói" — đúng, vì trước v9 mọi lượt đều thế.
      _themCot(db, 'hang_doi_hoi', 'chi_nghe', 'INTEGER NOT NULL DEFAULT 0');

      // 🔴 CHECK constraint của `trang_thai` phải nới cho 'dang_xu_ly'.
      // SQLite KHÔNG có `ALTER TABLE … ALTER CONSTRAINT` ⇒ phải dựng bảng mới
      // rồi chép sang. ⛔ Đừng bỏ qua bước này: thiếu nó thì CAS nhận việc ném
      // "CHECK constraint failed" NGAY nhịp poll đầu tiên trên DB thật, mà DB
      // trắng (dựng từ schema.sql) lại chạy ngon ⇒ mọi bài test đều xanh.
      db.exec(`
        CREATE TABLE hang_doi_hoi_v9 (
          request_id   TEXT PRIMARY KEY,
          chat_id_hoi  TEXT NOT NULL,
          msg_id       TEXT NOT NULL,
          user_id      TEXT NOT NULL,
          noi_dung     TEXT NOT NULL,
          ts_tao       TEXT NOT NULL,
          trang_thai   TEXT NOT NULL CHECK (trang_thai IN ('cho','da_day','dang_xu_ly','da_tra_loi','het_han','bo')),
          chi_nghe     INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO hang_doi_hoi_v9
          (request_id, chat_id_hoi, msg_id, user_id, noi_dung, ts_tao, trang_thai, chi_nghe)
          SELECT request_id, chat_id_hoi, msg_id, user_id, noi_dung, ts_tao, trang_thai, chi_nghe
            FROM hang_doi_hoi;
        DROP TABLE hang_doi_hoi;
        ALTER TABLE hang_doi_hoi_v9 RENAME TO hang_doi_hoi;
      `);
    },
  },
  {
    tu: '9',
    den: '10',
    moTa: 'hang_doi_hoi: thêm id_viec_mo_cua — CỬA 2 (người đang bị nhắc được nói)',
    chay(db) {
      // ⚠️ THÊM CỘT vào bảng ĐÃ CÓ ⇒ phải làm thật ở đây.
      // ⛔ Cho phép NULL: dòng cũ lấy đâu ra giá trị, và NULL = cửa 2 đóng —
      // đúng trạng thái của mọi lượt trước v10.
      // ✅ KHÔNG phải dựng lại bảng: không đụng CHECK constraint nào.
      _themCot(db, 'hang_doi_hoi', 'id_viec_mo_cua', 'TEXT');
    },
  },
  {
    tu: '10',
    den: '11',
    moTa: 'yeu_cau_duyet + nhat_ky_hanh_dong (ghi vết) + ghi_nho.nguon_* (ghi nhớ phải kèm nguồn)',
    chay(db) {
      // ⚠️ `yeu_cau_duyet` và `nhat_ky_hanh_dong` là bảng MỚI HOÀN TOÀN ⇒
      // `schema.sql` tự tạo chúng sau
      // khi chạy hết các bước (mọi lệnh trong đó là CREATE TABLE IF NOT EXISTS).
      // ⛔ ĐỪNG chép CREATE TABLE vào đây: hai bản định nghĩa một bảng là mầm
      // trôi lệch — sửa một chỗ thì DB cũ và DB mới khác cấu trúc mà ⛔ không
      // ai báo.
      //
      // Còn hai cột dưới đây là THÊM VÀO BẢNG ĐÃ CÓ ⇒ phải làm thật ở đây.
      // ⛔ Cho phép NULL: dòng cũ lấy đâu ra nguồn, và NULL mang đúng nghĩa
      // "host tự nói" — trạng thái của mọi ghi nhớ trước v11.
      _themCot(db, 'ghi_nho', 'nguon_nguoi', 'TEXT');
      _themCot(db, 'ghi_nho', 'nguon_nguyen_van', 'TEXT');
    },
  },
];

/**
 * Đưa DB lên `PHIEN_BAN_SCHEMA`.
 *
 * Ba đường:
 *  1. DB TRẮNG (chưa có bảng meta) -> nạp thẳng schema.sql, xong.
 *  2. DB đúng phiên bản           -> nạp lại schema.sql (mọi lệnh đều
 *     IF NOT EXISTS / INSERT OR IGNORE nên vô hại), xong.
 *  3. DB CŨ HƠN                   -> chạy tuần tự `MIGRATION_STEPS` cho tới khi
 *     bằng phiên bản đích, MỖI BƯỚC trong một transaction riêng, rồi mới nạp
 *     schema.sql để tạo nốt bảng/chỉ mục mới.
 *
 * 🔴 Không tìm được bước cho một phiên bản thì VẪN NÉM như cũ. Chạy tiếp
 * nghĩa là code mới đọc/ghi trên cấu trúc cũ mà không ai biết — đúng kiểu
 * hỏng câm pack này phải tránh. Thà không mở được DB.
 *
 * ⚠️ DB mới hơn code (vd DB '2', code cần '1' vì ai đó chạy bản cũ) cũng ném:
 * không có bước nào `tu: '2'` để đi tới '1'. Đúng ý — hạ cấp âm thầm còn tệ hơn.
 *
 * @param {TDb} db
 * @returns {{tuPhienBan: string|null, denPhienBan: string, daDoi: boolean, buocDaChay: string[]}}
 */
export function migrate(db) {
  const tuPhienBan = getSchemaVersion(db);
  /** @type {string[]} */
  const buocDaChay = [];

  if (tuPhienBan !== null && tuPhienBan !== PHIEN_BAN_SCHEMA) {
    let v = tuPhienBan;
    // Chặn vòng lặp vô hạn nếu ai đó khai một bước `tu === den`.
    for (let i = 0; v !== PHIEN_BAN_SCHEMA; i += 1) {
      const buoc = MIGRATION_STEPS.find((b) => b.tu === v);
      if (!buoc || i > MIGRATION_STEPS.length) {
        throw new Error(
          `DB đang ở schema_version='${v}' nhưng code cần '${PHIEN_BAN_SCHEMA}'. `
            + 'Chưa có bước migrate nào được viết cho khoảng này — dừng lại thay vì '
            + 'ghi đè lên cấu trúc cũ. Báo Router trước khi làm gì tiếp.',
        );
      }
      // Transaction cho TỪNG bước: hỏng giữa chừng thì phiên bản không bị đẩy
      // lên, lần chạy sau làm lại từ đúng bước đó chứ không nhảy cóc.
      db.exec('BEGIN IMMEDIATE');
      try {
        buoc.chay(db);
        db.prepare("UPDATE meta SET gia_tri = ? WHERE khoa = 'schema_version'").run(buoc.den);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* rollback hỏng thì lỗi gốc quan trọng hơn */ }
        throw new Error(`Migrate ${buoc.tu} -> ${buoc.den} thất bại (${buoc.moTa}): ${e.message}`);
      }
      buocDaChay.push(`${buoc.tu}->${buoc.den}`);
      v = buoc.den;
    }
  }

  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);

  const denPhienBan = getSchemaVersion(db) ?? PHIEN_BAN_SCHEMA;
  return { tuPhienBan, denPhienBan, daDoi: tuPhienBan !== denPhienBan, buocDaChay };
}

/**
 * Đếm bảng + chỉ mục thật trong DB. Dùng để nghiệm thu (G0 đo được 9 bảng /
 * 10 chỉ mục) — đọc từ sqlite_master chứ không tự khai theo tài liệu.
 * @param {TDb} db
 * @returns {{bang: string[], chiMuc: string[]}}
 */
export function describeSchema(db) {
  const lay = (loai) =>
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all(loai)
      .map((r) => String(r.name));
  return { bang: lay('table'), chiMuc: lay('index') };
}
