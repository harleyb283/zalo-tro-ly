/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 9 — NỀN CHO VIỆC TÁCH DAEMON/CLIENT (bước 1–3).
 *
 * 🔴 RÀNG BUỘC TRÙM: đường "một tiến trình" — cách hệ đang chạy hôm nay —
 *    KHÔNG ĐƯỢC ĐỔI HÀNH VI. Cả ba bước chỉ THÊM khả năng, mặc định TẮT.
 *    Daemon thật đang phục vụ, có lịch đã chốt. Vì thế mỗi nhóm bài dưới đây
 *    đều có một bài canh CHIỀU NGƯỢC LẠI: mặc định phải y như cũ.
 *
 * ⚠️ Mọi định danh trong file này là BỊA và mở đầu bằng `999` — quy ước do bộ
 *    quét dữ liệu riêng (`chia_tin.test.js` C1) cưỡng chế, và `test/` NAY NẰM
 *    TRONG tầm quét đó.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BUOC_MIGRATE, dongDb, kiemPhienBanHoacNem, layPhienBan, migrate, moDb, moTaSchema,
} from '../src/store/db.js';
import {
  ghiKetQuaGuiRa, layHangDoiGuiCho, layHangDoiGuiKet, nhanViec, nhanViecGui,
  taoHangDoi, upsertHoiThoai, xepHangGui,
} from '../src/store/write.js';
import {
  PHIEN_BAN_SCHEMA, TRANG_THAI_GUI, TRANG_THAI_HANG_DOI, HUONG_TRA_LOI,
} from '../src/lib/hang_so.js';
import {
  donRac, ghiNhanNguon, layNguon, quyetDinhHuongTraLoi, taoBoTichLuy, xoaPhien,
} from '../src/policy/leak_guard.js';

const NHOM = '9990000000001';
const NHOM_B = '9990000000002';
const HOST = '9991000000000000001';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

function thuMucTam(ten = 'ztl-cum9-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), ten));
  RAC.push(d);
  return d;
}

function dbTam() {
  const db = moDb(path.join(thuMucTam(), 'kho', 'lichsu.db'));
  upsertHoiThoai(db, { chatId: NHOM, loai: 'GROUP', ten: 'Nhóm thử', duocNghe: true });
  return db;
}

// ═══════════════════════════════════════════════════════════════════════
// M — SCHEMA v7 phải giống nhau ở CẢ HAI đường dựng DB
// ═══════════════════════════════════════════════════════════════════════

/** Cấu trúc thật đọc từ SQLite: bảng -> [cột:kiểu]. ⛔ không tự khai theo tài liệu. */
function moTaCot(db) {
  const ra = {};
  for (const b of moTaSchema(db).bang) {
    ra[b] = db.prepare(`PRAGMA table_info(${b})`).all()
      .map((c) => `${c.name}:${String(c.type).toUpperCase()}`)
      .sort();
  }
  return ra;
}

test('★★★ M1 DB TRẮNG và DB CŨ ĐÃ MIGRATE phải ra CÙNG MỘT cấu trúc', () => {
  // 🔴 Pack đã dính đúng lỗi họ này: `schema.sql` còn hardcode phiên bản cũ nên
  // DB TRẮNG sinh ra ở phiên bản sai. Cột thiếu ở một trong hai đường là hỏng
  // CÂM — máy người mới cài có cấu trúc khác máy đang chạy, và không ai báo gì.
  const trang = moDb(path.join(thuMucTam(), 'kho', 'a.db'));

  // Dựng một DB "cũ": nạp schema rồi HẠ phiên bản xuống v6 và bỏ hai bảng của
  // v7 đi — đúng hình dạng một DB đang chạy trước lượt nâng cấp này.
  const pCu = path.join(thuMucTam(), 'kho', 'b.db');
  const cu = moDb(pCu);
  cu.exec('DROP TABLE IF EXISTS hang_doi_gui');       // v7
  cu.exec('DROP TABLE IF EXISTS nguon_phien');        // v7
  // v8 thêm CỘT vào bảng đã có ⇒ dựng lại bảng đó ở hình dạng CHƯA có cột,
  // không thì "DB cũ" của bài này không trung thực và bài mất hết ý nghĩa.
  cu.exec('DROP TABLE IF EXISTS nhat_ky_truy_van');
  cu.exec(`CREATE TABLE nhat_ky_truy_van (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL,
    chat_id_hoi TEXT NOT NULL, nguon_chat_ids TEXT NOT NULL,
    co_cheo INTEGER NOT NULL, huong_tra_loi TEXT, ts TEXT NOT NULL)`);
  cu.prepare("UPDATE meta SET gia_tri = '6' WHERE khoa = 'schema_version'").run();
  assert.equal(layPhienBan(cu), '6', 'dựng sai tiền đề thì bài này vô nghĩa');

  const kq = migrate(cu);
  assert.equal(kq.daDoi, true);
  // ⚠️ Danh sách bước KHÔNG để cứng: mỗi lần lên phiên bản mà phải sửa bài này
  // là bài sẽ bị sửa cho xanh thay vì được đọc. Canh ĐIỂM ĐẦU và ĐIỂM CUỐI.
  assert.equal(kq.buocDaChay[0], '6->7');
  assert.equal(kq.buocDaChay.at(-1), `${Number(PHIEN_BAN_SCHEMA) - 1}->${PHIEN_BAN_SCHEMA}`);
  assert.equal(layPhienBan(cu), PHIEN_BAN_SCHEMA);

  assert.deepEqual(moTaCot(cu), moTaCot(trang),
    'hai đường dựng DB ra cấu trúc KHÁC nhau -> máy người mới cài khác máy đang chạy');
  dongDb(trang); dongDb(cu);
});

test('★★★ M2 `schema.sql` và `PHIEN_BAN_SCHEMA` phải nói CÙNG MỘT SỐ', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
  const m = /VALUES \('schema_version', '(\d+)'\)/.exec(sql);
  assert.ok(m, 'không tìm thấy dòng ghi schema_version trong schema.sql');
  assert.equal(m[1], PHIEN_BAN_SCHEMA,
    'lệch nhau ⇒ DB TRẮNG sinh ra ở phiên bản cũ rồi migrate ngay lần mở đầu');
});

test('★★★ M3 có bước migrate cho MỌI khoảng phiên bản, không đứt quãng', () => {
  // Thiếu một bước ở giữa thì DB cũ vừa đủ tuổi sẽ NÉM lúc mở — và nó chỉ lộ
  // trên máy có DB cũ, tức trên máy anh chứ không phải trên máy đang code.
  const co = new Set(BUOC_MIGRATE.map((b) => b.tu));
  for (let v = 1; v < Number(PHIEN_BAN_SCHEMA); v += 1) {
    assert.ok(co.has(String(v)), `thiếu bước migrate từ v${v}`);
  }
});

test('★★★ M4 CHẠM DB THẬT: kiểu từng cột của hai bảng mới đúng như khai', () => {
  // 🔴 `ref_test_hang_gia_khong_bat_duoc_loi_kieu_o_tang_db`: tiêm hàng giả cho
  // tầng ghi thì lỗi SAI KIỂU không lộ. SQLite có "type affinity" — nhét chuỗi
  // vào cột INTEGER thì nó im lặng đổi kiểu, hoặc im lặng GIỮ NGUYÊN chuỗi.
  const db = dbTam();
  const { dong } = xepHangGui(db, {
    requestId: 'r1', chatIdDich: NHOM, text: 'xin chào', tagUserIds: [HOST],
  });
  assert.equal(typeof dong.id, 'string');
  assert.equal(typeof dong.chat_id_dich, 'string', 'chat_id là TEXT — số hoá là mất chữ số ID Zalo');
  assert.equal(typeof dong.text, 'string');
  assert.equal(typeof dong.tag_user_ids, 'string', 'tag_user_ids là JSON dạng TEXT');
  assert.deepEqual(JSON.parse(dong.tag_user_ids), [HOST]);
  assert.equal(typeof dong.so_lan_thu, 'number', 'so_lan_thu phải là SỐ, không phải chuỗi');
  assert.equal(dong.so_lan_thu, 0);
  assert.equal(dong.msg_id, null);
  assert.equal(dong.ly_do, null);
  assert.equal(dong.trang_thai, TRANG_THAI_GUI.CHO);

  const bo = taoBoTichLuy({ db });
  bo.ghiNhan('r1', [NHOM]);
  const r = db.prepare('SELECT * FROM nguon_phien LIMIT 1').get();
  assert.equal(typeof r.request_id, 'string');
  assert.equal(typeof r.chat_id, 'string');
  assert.equal(typeof r.ts, 'number', 'ts phải là SỐ — donRac so sánh nó với Date.now()');
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// B1 — moDb({migrate:false}) + kiểm phiên bản
// ═══════════════════════════════════════════════════════════════════════

/** Dựng một DB ở phiên bản CŨ hơn code. */
function dbPhienBanCu(v = '6') {
  const p = path.join(thuMucTam(), 'kho', 'cu.db');
  const db = moDb(p);
  db.prepare('UPDATE meta SET gia_tri = ? WHERE khoa = ?').run(v, 'schema_version');
  dongDb(db);
  return p;
}

test('★★★ B1a client mở DB LỆCH PHIÊN BẢN -> NÉM, thông điệp nêu CẢ HAI số', () => {
  const p = dbPhienBanCu('6');
  let loi = null;
  try { moDb(p, { migrate: false }); } catch (e) { loi = e; }
  assert.ok(loi, '🔴 client chạy tiếp trên cấu trúc cũ = hỏng CÂM, cột thiếu trả undefined');
  assert.match(loi.message, /v6/, 'thiếu số của DB');
  assert.match(loi.message, new RegExp(`v${PHIEN_BAN_SCHEMA}`), 'thiếu số client cần');
  assert.match(loi.message, /daemon/i, 'phải nói ai là người nâng cấp');
});

test('★★★ B1b client mở DB TRẮNG -> cũng NÉM (⛔ không tự dựng schema)', () => {
  // Client tự dựng schema là quay lại đúng cuộc đua vừa chặn, chỉ khác tên gọi.
  const p = path.join(thuMucTam(), 'kho', 'trang.db');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // ⚠️ Canh ĐÚNG câu của nhánh DB-trắng. Bản đầu em canh `/…|daemon/i` — quá
  // lỏng: gỡ nhánh này đi thì câu "lệch phiên bản" (cũng có chữ daemon) lọt
  // qua, và đột biến M3 sống sót đúng vì thế.
  assert.throws(() => moDb(p, { migrate: false }), /chưa có cấu trúc nào/);
});

test('★★★ B1c DB ĐÚNG phiên bản -> mở được, và KHÔNG migrate gì', () => {
  const p = path.join(thuMucTam(), 'kho', 'ok.db');
  dongDb(moDb(p));                       // daemon dựng trước
  const db = moDb(p, { migrate: false }); // client mở sau
  assert.equal(layPhienBan(db), PHIEN_BAN_SCHEMA);
  assert.equal(db.prepare('SELECT count(*) c FROM hang_doi_gui').get().c, 0, 'bảng v7 phải có mặt');
  dongDb(db);
});

test('★★★ B1d MẶC ĐỊNH vẫn migrate — đường một-tiến-trình KHÔNG đổi hành vi', () => {
  // Đây là bài canh ràng buộc trùm. Vá quá tay ở đây là daemon thật không mở
  // nổi DB cũ, tức hệ đang chạy chết ngay lần restart kế tiếp.
  const p = dbPhienBanCu('6');
  const db = moDb(p);                    // ⛔ không truyền tuỳ chọn
  assert.equal(layPhienBan(db), PHIEN_BAN_SCHEMA, 'daemon phải TỰ nâng cấp như trước giờ');
  dongDb(db);
});

test('★★ B1e `kiemPhienBanHoacNem` trả về phiên bản khi khớp', () => {
  const db = dbTam();
  assert.equal(kiemPhienBanHoacNem(db, 'x.db'), PHIEN_BAN_SCHEMA);
  dongDb(db);
});

test('★★★ B1f TIẾN TRÌNH THẬT: client lệch phiên bản thoát với mã ≠ 0', () => {
  // ⚠️ `moDb` chỉ NÉM; "thoát mã ≠0" là việc của tiến trình. Bài này chạy một
  // tiến trình node thật để chứng minh chuỗi đó nối được, ⛔ không suy từ code.
  const p = dbPhienBanCu('6');
  const goc = process.cwd();
  let ma = 0;
  let ra = '';
  try {
    execFileSync(process.execPath, ['-e',
      `import(${JSON.stringify(path.join(goc, 'src/store/db.js'))})`
      + `.then(m => m.moDb(${JSON.stringify(p)}, { migrate: false }))`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ma = e.status; ra = String(e.stderr ?? '');
  }
  assert.notEqual(ma, 0, 'client lệch phiên bản mà thoát mã 0 -> bộ nuôi tiến trình tưởng nó chạy tốt');
  assert.match(ra, /v6/);
  assert.match(ra, new RegExp(`v${PHIEN_BAN_SCHEMA}`));
});

// ═══════════════════════════════════════════════════════════════════════
// B2 — nhanViec (CAS)
// ═══════════════════════════════════════════════════════════════════════

test('★★★ B2a HAI người cùng nhận một việc -> ĐÚNG MỘT người được true', () => {
  const db = dbTam();
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'hỏi', tsTao: new Date().toISOString(),
  });
  const a = nhanViec(db, 'r1', TRANG_THAI_HANG_DOI.CHO, TRANG_THAI_HANG_DOI.DA_DAY);
  const b = nhanViec(db, 'r1', TRANG_THAI_HANG_DOI.CHO, TRANG_THAI_HANG_DOI.DA_DAY);
  assert.deepEqual([a, b], [true, false],
    'cả hai cùng thắng = cả hai cùng gửi = hai tin vào nhóm người thật');
  dongDb(db);
});

test('★★★ B2b trạng thái ĐẦU không khớp -> KHÔNG nhận được, và KHÔNG đổi gì', () => {
  const db = dbTam();
  taoHangDoi(db, {
    requestId: 'r1', chatIdHoi: NHOM, msgId: 'm1', userId: HOST,
    noiDung: 'hỏi', tsTao: new Date().toISOString(),
  });
  assert.equal(nhanViec(db, 'r1', TRANG_THAI_HANG_DOI.DA_TRA_LOI, TRANG_THAI_HANG_DOI.BO), false);
  assert.equal(
    db.prepare('SELECT trang_thai t FROM hang_doi_hoi WHERE request_id = ?').get('r1').t,
    TRANG_THAI_HANG_DOI.CHO, 'thua CAS mà vẫn ghi đè là hỏng đúng thứ CAS sinh ra để chặn',
  );
  dongDb(db);
});

test('★★ B2c request_id lạ -> false, không nổ', () => {
  const db = dbTam();
  assert.equal(nhanViec(db, 'khong-co', TRANG_THAI_HANG_DOI.CHO, TRANG_THAI_HANG_DOI.DA_DAY), false);
  dongDb(db);
});

test('★★★ B2d trạng thái lạ -> NÉM ngay ở JS, không để CHECK của SQLite nổ', () => {
  // Thông điệp "CHECK constraint failed" của SQLite không nói sai ở đâu, sai
  // giá trị gì — cùng lý do `capNhatHangDoi` đã chặn ở JS từ trước.
  const db = dbTam();
  assert.throws(() => nhanViec(db, 'r1', 'linh_tinh', TRANG_THAI_HANG_DOI.BO), /Hợp lệ/);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// B2' — hang_doi_gui (outbox)
// ═══════════════════════════════════════════════════════════════════════

test('★★★ B3a HAI bộ chạy cùng nhặt một tin -> ĐÚNG MỘT được gửi', () => {
  const db = dbTam();
  const { id } = xepHangGui(db, { requestId: 'r1', chatIdDich: NHOM, text: 'tin' });
  const a = nhanViecGui(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
  const b = nhanViecGui(db, id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
  assert.deepEqual([a, b], [true, false]);
  assert.equal(db.prepare('SELECT so_lan_thu s FROM hang_doi_gui WHERE id = ?').get(id).s, 1,
    'đếm lượt thử phải cộng lúc NHẬN — cộng lúc gửi xong thì tiến trình chết giữa chừng là mất lượt');
  dongDb(db);
});

test('★★★ B3b gửi xong ghi msg_id; gửi hỏng ghi LÝ DO, ⛔ không để rỗng', () => {
  const db = dbTam();
  const a = xepHangGui(db, { requestId: 'r1', chatIdDich: NHOM, text: 'A' });
  const b = xepHangGui(db, { requestId: 'r2', chatIdDich: NHOM, text: 'B' });
  ghiKetQuaGuiRa(db, a.id, { msgId: '9992000000000000002' });
  ghiKetQuaGuiRa(db, b.id, { lyDo: 'mạng rớt' });

  const ra = db.prepare('SELECT * FROM hang_doi_gui WHERE id = ?').get(a.id);
  assert.equal(ra.trang_thai, TRANG_THAI_GUI.DA_GUI);
  assert.equal(ra.ly_do, null);
  const rb = db.prepare('SELECT * FROM hang_doi_gui WHERE id = ?').get(b.id);
  assert.equal(rb.trang_thai, TRANG_THAI_GUI.LOI);
  assert.match(rb.ly_do, /mạng rớt/);
  assert.equal(rb.msg_id, null, 'gửi hỏng mà ghi msg_id = sổ sách nói dối');
  dongDb(db);
});

test('★★★ B3c `layHangDoiGuiCho` CHỈ trả việc CHƯA AI NHẬN', () => {
  const db = dbTam();
  const a = xepHangGui(db, { requestId: 'r1', chatIdDich: NHOM, text: 'A' });
  xepHangGui(db, { requestId: 'r2', chatIdDich: NHOM, text: 'B' });
  nhanViecGui(db, a.id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
  const ds = layHangDoiGuiCho(db);
  assert.equal(ds.length, 1, "trả cả 'dang_gui' là bốc lại việc người khác đang cầm");
  assert.equal(ds[0].text, 'B');
  dongDb(db);
});

test("★★★ B3d tin KẸT gồm cả 'cho' lẫn 'dang_gui' quá lâu", () => {
  // 'dang_gui' quá lâu nghĩa là tiến trình cầm nó đã chết giữa chừng. Bỏ sót ca
  // đó thì tin nằm lại vĩnh viễn mà lưới canh không thấy — im lặng, đúng thứ
  // pack đã xây cả một module để chống.
  const db = dbTam();
  const a = xepHangGui(db, { requestId: 'r1', chatIdDich: NHOM, text: 'A' });
  const b = xepHangGui(db, { requestId: 'r2', chatIdDich: NHOM, text: 'B' });
  nhanViecGui(db, b.id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
  const cu = new Date(Date.now() - 600_000).toISOString();
  db.prepare('UPDATE hang_doi_gui SET ts_cap_nhat = ?').run(cu);

  const ket = layHangDoiGuiKet(db, 120_000);
  assert.deepEqual(ket.map((x) => x.id).sort(), [a.id, b.id].sort());
  // và tin vừa gửi xong thì KHÔNG phải tin kẹt
  ghiKetQuaGuiRa(db, a.id, { msgId: '9992000000000000002' });
  assert.deepEqual(layHangDoiGuiKet(db, 120_000).map((x) => x.id), [b.id]);
  dongDb(db);
});

test('★★ B3e text rỗng -> NÉM (Zalo cũng từ chối tin trống)', () => {
  const db = dbTam();
  assert.throws(() => xepHangGui(db, { requestId: 'r', chatIdDich: NHOM, text: '   ' }), /rỗng/);
  assert.equal(db.prepare('SELECT count(*) c FROM hang_doi_gui').get().c, 0);
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════
// B3 — sổ nguồn xuống SQLite. 🔴 PHẦN QUAN TRỌNG NHẤT.
// ═══════════════════════════════════════════════════════════════════════

test('★★★ V1 NGHIỆM THU VÀNG: ghi nguồn ở TIẾN TRÌNH A, tiến trình B THẤY', () => {
  // 🔴 Đây là thứ hôm nay KHÔNG làm được: sổ nguồn sống trong RAM một tiến
  // trình, nên `bo_chay` (daemon) ghi một quyển còn `tra_loi` (client) tra
  // quyển khác ⇒ lá chắn mù đúng ca cần nó.
  // ⚠️ Tiến trình A là node THẬT, ⛔ không giả lập bằng hai đối tượng trong
  // cùng một tiến trình — làm thế thì bài này xanh cả trên sổ RAM.
  const p = path.join(thuMucTam(), 'kho', 'chung.db');
  dongDb(moDb(p));                                    // daemon dựng cấu trúc
  const goc = process.cwd();

  execFileSync(process.execPath, ['-e', `
    const dbMod = ${JSON.stringify(path.join(goc, 'src/store/db.js'))};
    const lgMod = ${JSON.stringify(path.join(goc, 'src/policy/leak_guard.js'))};
    Promise.all([import(dbMod), import(lgMod)]).then(([d, l]) => {
      const db = d.moDb(${JSON.stringify(p)}, { migrate: false });
      l.ghiNhanNguon(l.taoBoTichLuy({ db }), 'r-chung', [${JSON.stringify(NHOM_B)}]);
      d.dongDb(db);
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });

  // ── TIẾN TRÌNH B (chính bài test này) ──
  const db = moDb(p, { migrate: false });
  const bo = taoBoTichLuy({ db });
  assert.deepEqual(layNguon(bo, 'r-chung'), [NHOM_B],
    'tiến trình B KHÔNG thấy nguồn của A -> hai sổ khác nhau -> lá chắn mù');

  const qd = quyetDinhHuongTraLoi({
    requestId: 'r-chung', chatIdHoi: NHOM, nguon: layNguon(bo, 'r-chung'), tonTaiHangDoi: true,
  });
  assert.equal(qd.huong, HUONG_TRA_LOI.DM_HOST,
    'đáp án mang dữ liệu nhóm khác mà vẫn gửi thẳng vào nhóm đang hỏi');
  assert.deepEqual(qd.nguonLa, [NHOM_B]);
  dongDb(db);
});

test('★★★ V2 sổ đĩa SỐNG QUA restart (đóng DB rồi mở lại vẫn còn nguồn)', () => {
  // Sổ RAM mất trắng khi restart, và mất trí nhớ ở đây fail-OPEN.
  const p = path.join(thuMucTam(), 'kho', 'ben.db');
  const d1 = moDb(p);
  ghiNhanNguon(taoBoTichLuy({ db: d1 }), 'r1', [NHOM_B]);
  dongDb(d1);

  const d2 = moDb(p);
  assert.deepEqual(layNguon(taoBoTichLuy({ db: d2 }), 'r1'), [NHOM_B]);
  dongDb(d2);
});

test('★★★ V3 🔴 ĐỌC HỎNG thì NÉM — ⛔ TUYỆT ĐỐI KHÔNG trả []', () => {
  // `lay()` trả `[]` là một lời KHẲNG ĐỊNH ("phiên này chưa đọc nhóm nào khác"),
  // không phải một chỗ trống. DB hỏng nghĩa là mình KHÔNG BIẾT — và "không biết"
  // ⛔ không được đóng gói thành "không có gì", vì `quyetDinhHuongTraLoi` sẽ
  // kết luận sạch rồi gửi thẳng chuyện nhóm khác vào nhóm đang hỏi.
  const db = dbTam();
  const bo = taoBoTichLuy({ db });
  db.exec('DROP TABLE nguon_phien');
  assert.throws(() => bo.lay('r1'), /nguon_phien/i,
    'nuốt lỗi rồi trả [] = fail-OPEN, đúng cái tật của sổ RAM mà bản này sinh ra để chữa');
  dongDb(db);
});

test('★★★ V3b GHI hỏng cũng NÉM (sổ khuyết một nguồn trông y như sổ sạch)', () => {
  const db = dbTam();
  const bo = taoBoTichLuy({ db });
  db.exec('DROP TABLE nguon_phien');
  assert.throws(() => bo.ghiNhan('r1', [NHOM_B]), /nguon_phien/i);
  dongDb(db);
});

test('★★★ V4 ghi cùng một nguồn NHIỀU LẦN -> gộp, không đẻ dòng trùng', () => {
  const db = dbTam();
  const bo = taoBoTichLuy({ db });
  bo.ghiNhan('r1', [NHOM_B, NHOM_B]);
  bo.ghiNhan('r1', [NHOM_B]);
  assert.deepEqual(layNguon(bo, 'r1'), [NHOM_B]);
  assert.equal(db.prepare('SELECT count(*) c FROM nguon_phien').get().c, 1);
  dongDb(db);
});

test('★★★ V5 donRac xoá theo TUỔI, ⛔ không đụng phiên còn trẻ', () => {
  // Dọn theo SỐ LƯỢNG là fail-open: đuổi mất tập nguồn của một phiên ĐANG SỐNG
  // ⇒ lay() trả rỗng ⇒ kết luận "không có nguồn lạ".
  const db = dbTam();
  const bo = taoBoTichLuy({ db });
  bo.ghiNhan('cu', [NHOM_B]);
  bo.ghiNhan('moi', [NHOM_B]);
  db.prepare('UPDATE nguon_phien SET ts = ? WHERE request_id = ?')
    .run(Date.now() - 7_200_000, 'cu');

  assert.equal(donRac(bo, 3_600_000), 1);
  assert.deepEqual(layNguon(bo, 'cu'), []);
  assert.deepEqual(layNguon(bo, 'moi'), [NHOM_B], 'dọn nhầm phiên đang sống = mở đường rò');
  dongDb(db);
});

test('★★ V5b donRac với ngưỡng rác -> KHÔNG dọn gì (thà giữ rác còn hơn mở đường rò)', () => {
  const db = dbTam();
  const bo = taoBoTichLuy({ db });
  bo.ghiNhan('r1', [NHOM_B]);
  for (const xau of [0, -1, NaN, 'ba tiếng']) {
    assert.equal(donRac(bo, xau), 0);
  }
  assert.deepEqual(layNguon(bo, 'r1'), [NHOM_B]);
  dongDb(db);
});

test('★★ V6 xoaPhien chỉ xoá đúng phiên đó', () => {
  const db = dbTam();
  const bo = taoBoTichLuy({ db });
  bo.ghiNhan('r1', [NHOM_B]);
  bo.ghiNhan('r2', [NHOM_B]);
  xoaPhien(bo, 'r1');
  assert.deepEqual(layNguon(bo, 'r1'), []);
  assert.deepEqual(layNguon(bo, 'r2'), [NHOM_B]);
  assert.equal(bo.soPhien(), 1);
  dongDb(db);
});

test('★★★ V7 MẶC ĐỊNH vẫn là sổ RAM — đường một-tiến-trình KHÔNG đổi hành vi', () => {
  // Ràng buộc trùm. `src/index.js` gọi `taoBoTichLuy()` không tham số; đổi mặc
  // định là đổi hành vi của hệ đang phục vụ anh.
  const bo = taoBoTichLuy();
  assert.equal(bo._db, undefined, 'mặc định KHÔNG được dính tới DB');
  assert.ok(bo._kho instanceof Map, 'mặc định phải là sổ RAM y như trước');
  ghiNhanNguon(bo, 'r1', [NHOM_B]);
  assert.deepEqual(layNguon(bo, 'r1'), [NHOM_B]);
  assert.equal(donRac(bo, 3_600_000), 0, 'phiên còn trẻ thì không dọn');
  dongDb(dbTam());
});

test('★★ V8 hai kiểu sổ có CÙNG một hợp đồng (cùng API, cùng kết quả)', () => {
  // Khác hợp đồng thì bật cờ lùi về RAM là đổi hành vi ngầm — đúng thứ đường
  // lùi sinh ra để tránh.
  const db = dbTam();
  for (const bo of [taoBoTichLuy(), taoBoTichLuy({ db })]) {
    ghiNhanNguon(bo, 'r1', [NHOM_B, NHOM]);
    assert.deepEqual(layNguon(bo, 'r1'), [NHOM, NHOM_B].sort());
    assert.deepEqual(layNguon(bo, 'khong-co'), []);
    assert.deepEqual(layNguon(bo, '   '), [], 'requestId rỗng phải trả rỗng, không nổ');
    assert.equal(bo.soPhien(), 1);
  }
  dongDb(db);
});
