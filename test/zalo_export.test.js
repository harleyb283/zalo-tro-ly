/**
 * G9 — test cho bin/zalo-export.js. KHÔNG mạng, KHÔNG Zalo.
 *
 * Dùng SQLite THẬT (file tạm, nạp chính `schema.sql` của pack) chứ không mock:
 * cả gói này chỉ có một việc là đọc DB cho đúng, mock đi thì chẳng còn gì để đo.
 * Ghi dữ liệu mẫu bằng SQL trần — CỐ Ý không gọi `store/write.js` để bài test
 * không đỏ lây khi G3 sửa gì đó.
 *
 *     node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  docThamSo, mocNgay, lechPhut, dinhDangGio, nhanLoaiTin, tenNguoiGui, tenNguoiThuHoi,
  layTin, bangThuHoi, bangHoiThoai, bangNguoi, danhSachHoiThoai, dungMarkdown, moChiDoc,
  timDuongDanDb, main,
} from '../bin/zalo-export.js';

const TZ = 'Asia/Ho_Chi_Minh';
const CHAT_A = '9990000000001';
const CHAT_B = '111222333444';
const SCHEMA = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

/** 2026-08-20 09:12:00 giờ VN = 02:12 UTC */
const T = (gioVn, phut = 0, ngay = 20) =>
  Date.UTC(2026, 7, ngay, gioVn - 7, phut, 0, 0);

function dungDb() {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-export-'));
  const p = path.join(thuMuc, 'lichsu.db');
  const db = new DatabaseSync(p);
  db.exec(SCHEMA);

  db.exec(`
    INSERT INTO hoi_thoai (chat_id, loai, ten, duoc_nghe, lan_dau_thay, lan_cuoi_thay)
    VALUES ('${CHAT_A}','GROUP','Nhóm A',1,'x','x'),
           ('${CHAT_B}','GROUP','Nhóm cũ',0,'x','x');
    INSERT INTO nguoi (user_id, ten_hien_thi, la_host, cap_nhat)
    VALUES ('u1','Tên MỚI của Người A',0,'x'), ('u2','Người B',0,'x');
  `);

  const them = db.prepare(`
    INSERT INTO tin_nhan (chat_id,msg_id,cli_msg_id,user_id,ten_luc_gui,msg_type,noi_dung,
                          content_raw,ts_zalo,ts_ghi,tu_toi,co_tag_host,da_thu_hoi,
                          thu_hoi_boi,thu_hoi_luc,do_tro_ly_tao)
    VALUES ($chat_id,$msg_id,$cli,$user_id,$ten,$msg_type,$noi_dung,$raw,$ts,'x',$tu_toi,0,
            $da_thu_hoi,$boi,$luc,$tro_ly)`);
  const mac = {
    chat_id: CHAT_A, cli: null, user_id: 'u1', ten: 'Người A lúc đó', msg_type: 'chat.text',
    raw: null, tu_toi: 0, da_thu_hoi: 0, boi: null, luc: null, tro_ly: 0,
  };
  const T09 = T(9, 12);
  them.run({ ...mac, msg_id: 'm1', noi_dung: 'chào cả nhà', ts: T09 });
  them.run({ ...mac, msg_id: 'm2', user_id: 'u2', ten: 'Người B lúc đó',
    noi_dung: 'báo giá 500 triệu bên Sao Mai', ts: T(9, 13),
    da_thu_hoi: 1, boi: 'u2', luc: T(9, 15) });
  them.run({ ...mac, msg_id: 'm3', msg_type: 'chat.image', noi_dung: null,
    raw: JSON.stringify({ _msgTypeGoc: 'chat.image', href: 'https://x/a.jpg' }), ts: T(9, 20) });
  them.run({ ...mac, msg_id: 'm4', msg_type: 'UNKNOWN', noi_dung: null,
    raw: JSON.stringify({ _msgTypeGoc: 'chat.voice', len: 3 }), ts: T(9, 21) });
  them.run({ ...mac, msg_id: 'm5', noi_dung: 'dòng 1\ndòng 2\n### không phải heading',
    ts: T(9, 30) });
  them.run({ ...mac, msg_id: 'm6', ten: null, user_id: null, noi_dung: 'em trả lời đây',
    ts: T(9, 40), tro_ly: 1 });
  // Hôm sau + hội thoại khác, để đo lọc ngày và lọc nhóm
  them.run({ ...mac, msg_id: 'm7', noi_dung: 'hôm sau', ts: T(8, 0, 21) });
  them.run({ ...mac, chat_id: CHAT_B, msg_id: 'm8', noi_dung: 'ở nhóm khác', ts: T(10, 0) });
  // Tin của hội thoại CHƯA có dòng trong hoi_thoai
  them.run({ ...mac, chat_id: '999', msg_id: 'm9', noi_dung: 'nhóm lạ', ts: T(11, 0) });

  db.prepare(`INSERT INTO su_kien_thu_hoi
    (event_id,chat_id,msg_id_dich,cli_msg_id_dich,nguoi_thu_hoi,ten_nguoi_thu_hoi,ts_zalo,ts_ghi,khop_duoc)
    VALUES ('e1',$c,'m2',NULL,'u2',NULL,$ts,'x',1)`).run({ c: CHAT_A, ts: T(9, 15) });

  db.close();
  return { duongDan: p, thuMuc };
}

function xuat(duongDan, loc = {}) {
  const db = moChiDoc(duongDan);
  try {
    const day = { chatId: null, tu: null, den: null, soLuong: null, ...loc };
    const { tin, tongKhopBoLoc } = layTin(db, day);
    return dungMarkdown({
      tin,
      tongKhopBoLoc,
      thuHoi: bangThuHoi(db, day.chatId),
      hoiThoai: bangHoiThoai(db),
      nguoi: bangNguoi(db),
      loc: day,
      tz: TZ,
      duongDanDb: duongDan,
      nguonDb: 'test',
      bayGio: T(18, 0),
    });
  } finally {
    db.close();
  }
}

// ═══ A. Chỉ đọc ═══
test('A1 DB mở ở chế độ CHỈ ĐỌC — mọi lệnh ghi bị chặn', () => {
  const { duongDan } = dungDb();
  const db = moChiDoc(duongDan);
  try {
    assert.throws(() => db.exec("INSERT INTO tin_nhan (chat_id,msg_id,msg_type,ts_zalo,ts_ghi) VALUES ('x','y','chat.text',1,'x')"));
    assert.throws(() => db.exec('DELETE FROM tin_nhan'));
    assert.throws(() => db.exec('DROP TABLE tin_nhan'));
  } finally {
    db.close();
  }
});

test('A2 DB không tồn tại -> lỗi NÓI RÕ, không tự tạo file', () => {
  const p = path.join(os.tmpdir(), `ztl-khong-co-${Date.now()}.db`);
  assert.throws(() => moChiDoc(p), /Không thấy file DB/);
  assert.equal(fs.existsSync(p), false, 'tuyệt đối không được tạo DB rỗng rồi báo "0 tin"');
});

test('A3b mở chỉ-đọc DB WAL vẫn sinh -shm/-wal -> phải siết 0600, đừng để 0644', () => {
  // Đo thật: SQLite tạo `<db>-shm` khi mở WAL kể cả ở chế độ chỉ đọc. Chạy tay
  // lúc trợ lý KHÔNG chạy thì không ai siết quyền sau đó — file chứa chỉ mục
  // vào WAL của tin nhắn người khác nằm 0644 cho mọi user trên máy đọc.
  const { duongDan } = dungDb();
  for (const p of [`${duongDan}-shm`, `${duongDan}-wal`]) fs.rmSync(p, { force: true });
  const db = moChiDoc(duongDan);
  try {
    for (const p of [duongDan, `${duongDan}-shm`, `${duongDan}-wal`]) {
      if (!fs.existsSync(p)) continue;
      assert.equal(fs.statSync(p).mode & 0o777, 0o600, `${path.basename(p)} phải là 0600`);
    }
  } finally {
    db.close();
  }
});

test('A3 sau khi xuất, DB không đổi một byte nào', () => {
  const { duongDan } = dungDb();
  const truoc = fs.readFileSync(duongDan);
  xuat(duongDan);
  assert.deepEqual(fs.readFileSync(duongDan), truoc);
});

// ═══ B. Đối chiếu số tin ═══
test('B1 số tin xuất ra KHỚP count(*) và có in ra dòng đối chiếu', () => {
  const { duongDan } = dungDb();
  const kq = xuat(duongDan, { chatId: CHAT_A });
  assert.equal(kq.soTinDaIn, 7, '7 tin của nhóm A');
  assert.equal(kq.lech, false);
  assert.match(kq.md, /\*\*Số tin xuất ra:\*\* 7 — đối chiếu `count\(\*\)` cùng bộ lọc: \*\*7\*\*.*✅ khớp/);
});

test('B2 --so N: đối chiếu với min(count, N), KHÔNG báo lệch oan', () => {
  const { duongDan } = dungDb();
  const kq = xuat(duongDan, { chatId: CHAT_A, soLuong: 3 });
  assert.equal(kq.soTinDaIn, 3);
  assert.equal(kq.lech, false, 'giới hạn là cố ý, không phải mất tin');
  assert.match(kq.md, /giới hạn `--so 3` ⇒ mong đợi 3/);
});

test('B3 --so LỚN HƠN số tin có thật -> vẫn khớp, không lệch', () => {
  const { duongDan } = dungDb();
  const kq = xuat(duongDan, { chatId: CHAT_A, soLuong: 999 });
  assert.equal(kq.soTinDaIn, 7);
  assert.equal(kq.lech, false);
});

test('B4 lệch số -> đánh dấu ❌ ĐỪNG TIN FILE NÀY (dựng lệch giả để chứng minh còn răng)', () => {
  const { duongDan } = dungDb();
  const db = moChiDoc(duongDan);
  const { tin } = layTin(db, { chatId: CHAT_A });
  const kq = dungMarkdown({
    tin: tin.slice(0, 2),          // giả cảnh "mất tin âm thầm"
    tongKhopBoLoc: 7,
    thuHoi: bangThuHoi(db, CHAT_A), hoiThoai: bangHoiThoai(db), nguoi: bangNguoi(db),
    loc: { chatId: CHAT_A, tu: null, den: null, soLuong: null },
    tz: TZ, duongDanDb: duongDan, nguonDb: 'test', bayGio: T(18, 0),
  });
  db.close();
  assert.equal(kq.lech, true);
  assert.match(kq.md, /❌ \*\*LỆCH — ĐỪNG TIN FILE NÀY\*\*/);
});

// ═══ C. ★ Tin thu hồi — lý do tồn tại của cả công cụ ═══
test('C1 tin thu hồi: hiện RÕ đã thu hồi + AI + LÚC NÀO + VẪN CÓ nội dung gốc', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_A }).md;
  assert.match(md, /🗑️ \*\*TIN ĐÃ THU HỒI\*\*/);
  assert.match(md, /Thu hồi bởi .*lúc 2026-08-20 09:15:00/);
  assert.ok(md.includes('báo giá 500 triệu bên Sao Mai'),
    'giấu nội dung gốc là mất đúng thứ anh cần — cả tính năng vô nghĩa');
});

test('C2 ten_nguoi_thu_hoi trống + người thu hồi CHÍNH LÀ người gửi -> nói rõ, không bịa tên', () => {
  const { duongDan } = dungDb();
  const db = moChiDoc(duongDan);
  const r = db.prepare('SELECT * FROM tin_nhan WHERE msg_id = ?').get('m2');
  const sk = bangThuHoi(db, CHAT_A).get(`${CHAT_A}|m2`);
  const ten = tenNguoiThuHoi(r, sk, bangNguoi(db));
  db.close();
  assert.equal(ten, 'Người B lúc đó (chính người gửi)');
});

test('C3 người thu hồi là NGƯỜI KHÁC -> dùng tên hiện tại NHƯNG phải nói rõ đó là tên hiện tại', () => {
  const { duongDan } = dungDb();
  const db = moChiDoc(duongDan);
  const r = db.prepare('SELECT * FROM tin_nhan WHERE msg_id = ?').get('m2');
  const ten = tenNguoiThuHoi({ ...r, user_id: 'u9' }, { nguoi_thu_hoi: 'u1' }, bangNguoi(db));
  db.close();
  assert.match(ten, /Tên MỚI của Người A \(tên HIỆN TẠI, không phải tên lúc thu hồi\)/);
});

test('C4 chỉ có cờ da_thu_hoi mà KHÔNG có bản ghi sự kiện -> vẫn hiện, ghi "không rõ ai"', () => {
  const { duongDan } = dungDb();
  const db = moChiDoc(duongDan);
  const ten = tenNguoiThuHoi({ user_id: 'u1', thu_hoi_boi: null }, undefined, bangNguoi(db));
  db.close();
  assert.equal(ten, 'không rõ ai');
});

// ═══ D. Tên người gửi = ẢNH CHỤP lúc gửi ═══
test('D1 dùng ten_luc_gui, TUYỆT ĐỐI không tra tên hiện tại trong bảng nguoi', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_A }).md;
  assert.ok(md.includes('Người A lúc đó'));
  assert.ok(!md.includes('Tên MỚI của Người A'),
    'tên đổi thì lịch sử phải giữ nguyên bối cảnh lúc đó');
});

test('D2 tin do trợ lý tự gửi có nhãn riêng', () => {
  const { duongDan } = dungDb();
  // Giờ in kèm GIÂY (09:40:00) — trong nhóm đông, mấy tin cùng phút mà không
  // có giây thì đọc lại không biết cái nào trước cái nào.
  assert.match(xuat(duongDan, { chatId: CHAT_A }).md, /\*\*\[09:40:00\] Trợ lý \(tự gửi\)\*\*/);
});

test('D3 thiếu cả tên lẫn user_id -> nói không rõ, không in "null"', () => {
  assert.equal(tenNguoiGui({ ten_luc_gui: null, user_id: null, do_tro_ly_tao: 0 }),
    '<không rõ người gửi>');
});

// ═══ E. Loại tin không phải chữ ═══
test('E1 ảnh: không có nội dung, ghi rõ là ảnh, KHÔNG bịa', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_A }).md;
  assert.match(md, /_\[ảnh\]_ — nội dung không được lưu/);
});

test('E2 msgType lạ: lấy tên GỐC từ content_raw._msgTypeGoc', () => {
  assert.equal(nhanLoaiTin({ msg_type: 'UNKNOWN', content_raw: '{"_msgTypeGoc":"chat.voice"}' }),
    'loại khác: chat.voice');
});

test('E3 content_raw hỏng -> "không rõ", không nổ', () => {
  assert.equal(nhanLoaiTin({ msg_type: 'UNKNOWN', content_raw: '{{{hỏng' }), 'loại khác: không rõ');
});

// ═══ F. Lọc ═══
test('F1 --chat chỉ lấy đúng hội thoại đó', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_B }).md;
  assert.ok(md.includes('ở nhóm khác'));
  assert.ok(!md.includes('chào cả nhà'));
});

test('F2 ★ --den NGÀY TRẦN bao TRỌN ngày theo múi giờ hiển thị (bẫy lệch 7 tiếng)', () => {
  const { duongDan } = dungDb();
  const den = mocNgay('2026-08-20', TZ, true);
  const kq = xuat(duongDan, { chatId: CHAT_A, den });
  assert.equal(kq.soTinDaIn, 6, 'phải còn đủ 6 tin ngày 20, chỉ rụng tin ngày 21');
  assert.ok(!kq.md.includes('hôm sau'));

  // Chính là cái bẫy: Date.parse ra 00:00 UTC = 07:00 giờ VN.
  const naive = Date.parse('2026-08-20');
  assert.ok(den > naive, 'mốc cuối ngày phải muộn hơn hẳn mốc UTC ngây thơ');
  assert.equal(den - naive, 24 * 3600_000 - 1 - 7 * 3600_000 + 24 * 3600_000 - 24 * 3600_000);
});

test('F3 --tu NGÀY TRẦN = 00:00 giờ VN = 17:00 UTC hôm trước', () => {
  const tu = mocNgay('2026-08-20', TZ, false);
  assert.equal(new Date(tu).toISOString(), '2026-08-19T17:00:00.000Z');
});

test('F4 mốc ISO đầy đủ vẫn dùng được nguyên vẹn', () => {
  assert.equal(mocNgay('2026-08-20T10:00:00Z', TZ), Date.parse('2026-08-20T10:00:00Z'));
});

test('F5 mốc rác -> NÉM lỗi rõ ràng chứ không im lặng bỏ qua điều kiện', () => {
  assert.throws(() => mocNgay('tuần trước', TZ), /Không đọc được mốc thời gian/);
});

test('F6 ★ --so N lấy N tin MỚI NHẤT nhưng in theo thứ tự TĂNG DẦN', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_A, soLuong: 2 }).md;
  assert.ok(md.includes('hôm sau'), 'phải là 2 tin MỚI NHẤT, không phải 2 tin cũ nhất');
  assert.ok(!md.includes('chào cả nhà'));
  assert.ok(md.indexOf('em trả lời đây') < md.indexOf('hôm sau'), 'in ra phải tăng dần theo thời gian');
});

// ═══ G. Hình thức Markdown ═══
test('G1 header ghi rõ MÚI GIỜ kèm độ lệch', () => {
  const { duongDan } = dungDb();
  assert.match(xuat(duongDan, { chatId: CHAT_A }).md,
    /\*\*Múi giờ hiển thị:\*\* Asia\/Ho_Chi_Minh \(UTC\+07:00\)/);
});

test('G2 nội dung nhiều dòng + ký tự markdown KHÔNG phá cấu trúc (bọc blockquote)', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_A }).md;
  assert.ok(md.includes('> dòng 1\n> dòng 2\n> ### không phải heading'),
    'dòng bắt đầu bằng ### mà không bọc thì thành heading, vỡ cả mục lục');
});

test('G3 gom theo NGÀY, tiêu đề ngày tiếng Việt', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan, { chatId: CHAT_A }).md;
  assert.match(md, /## Thứ Năm, 20\/08\/2026/);
  assert.match(md, /## Thứ Sáu, 21\/08\/2026/);
});

test('G4 xuất TẤT CẢ hội thoại -> mỗi tin có nhãn nhóm để không lẫn', () => {
  const { duongDan } = dungDb();
  const md = xuat(duongDan).md;
  assert.match(md, /_Nhóm A_/);
  assert.match(md, /_Nhóm cũ_/);
});

test('G5 hội thoại duoc_nghe=0 VẪN xuất, kèm ghi chú (không giấu dữ liệu của chủ kho)', () => {
  const { duongDan } = dungDb();
  const kq = xuat(duongDan, { chatId: CHAT_B });
  assert.equal(kq.soTinDaIn, 1);
  assert.match(kq.md, /không còn trong danh sách nghe/);
});

test('G6 hội thoại chưa có dòng trong hoi_thoai vẫn xuất được, có cảnh báo', () => {
  const { duongDan } = dungDb();
  const kq = xuat(duongDan, { chatId: '999' });
  assert.equal(kq.soTinDaIn, 1);
  assert.match(kq.md, /Không có dòng nào trong bảng `hoi_thoai`/);
});

test('G7 không có tin nào -> file vẫn hợp lệ và nói rõ 0 tin', () => {
  const { duongDan } = dungDb();
  const kq = xuat(duongDan, { chatId: 'khong-ton-tai' });
  assert.equal(kq.soTinDaIn, 0);
  assert.equal(kq.lech, false);
  assert.match(kq.md, /_Không có tin nào khớp bộ lọc._/);
});

// ═══ H. --danh-sach ═══
test('H1 liệt kê hội thoại kèm số tin, số thu hồi, trạng thái nghe', () => {
  const { duongDan } = dungDb();
  const db = moChiDoc(duongDan);
  const ds = danhSachHoiThoai(db);
  db.close();
  const a = ds.find((r) => String(r.chat_id) === CHAT_A);
  assert.equal(Number(a.so_tin), 7);
  assert.equal(Number(a.so_thu_hoi), 1);
  assert.ok(ds.find((r) => String(r.chat_id) === '999'), 'hội thoại lạ cũng phải hiện');
});

// ═══ I. Tham số + chạy thật ═══
test('I1 đọc tham số: cờ và giá trị', () => {
  const ts = docThamSo(['--chat', 'abc', '--so', '10', '--danh-sach']);
  assert.deepEqual(ts, { chat: 'abc', so: '10', 'danh-sach': true });
});

test('I2 tham số thiếu giá trị -> nổ ngay chứ không nuốt', () => {
  assert.throws(() => docThamSo(['--chat']), /thiếu giá trị/);
});

test('I3 --db thắng env và config', () => {
  const p = path.join(os.tmpdir(), 'x.db');
  assert.equal(timDuongDanDb({ db: p }).duongDan, p);
  assert.equal(timDuongDanDb({ db: p }).nguon, '--db');
});

test('I4 CHẠY THẬT đầu-cuối: ghi file .md, mã thoát 0, số tin khớp', async () => {
  const { duongDan, thuMuc } = dungDb();
  const ra = path.join(thuMuc, 'out.md');
  const gocOut = process.stdout.write.bind(process.stdout);
  const in_ = [];
  process.stdout.write = (s) => { in_.push(String(s)); return true; };
  let ma;
  try {
    ma = await main(['node', 'zalo-export.js', '--db', duongDan, '--chat', CHAT_A,
      '--tz', TZ, '--ra', ra]);
  } finally {
    process.stdout.write = gocOut;
  }
  assert.equal(ma, 0);
  const md = fs.readFileSync(ra, 'utf8');
  assert.match(md, /✅ khớp/);
  assert.ok(md.includes('báo giá 500 triệu bên Sao Mai'));
  assert.match(in_.join(''), /Đã xuất 7 tin/);
  // File .md là tin nhắn của người khác ở dạng chữ trần — còn dễ đọc hơn DB.
  assert.equal(fs.statSync(ra).mode & 0o777, 0o600, 'file xuất phải 0600 như lichsu.db');
});

test('I4b ghi ĐÈ lên file cũ đang 0644 -> vẫn phải về 0600', async () => {
  const { duongDan, thuMuc } = dungDb();
  const ra = path.join(thuMuc, 'cu.md');
  fs.writeFileSync(ra, 'nội dung cũ', { mode: 0o644 });
  fs.chmodSync(ra, 0o644);
  const goc = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    await main(['node', 'x', '--db', duongDan, '--chat', CHAT_A, '--tz', TZ, '--ra', ra]);
  } finally {
    process.stdout.write = goc;
  }
  // `mode` của writeFileSync KHÔNG áp cho file đã tồn tại — đây chính là bẫy.
  assert.equal(fs.statSync(ra).mode & 0o777, 0o600);
});

test('I5 --tu muộn hơn --den -> nổ, không lặng lẽ trả 0 tin', async () => {
  const { duongDan } = dungDb();
  await assert.rejects(
    () => main(['node', 'x', '--db', duongDan, '--tu', '2026-08-21', '--den', '2026-08-20', '--tz', TZ]),
    /--tu muộn hơn --den/,
  );
});

test('I6 --so không phải số dương -> nổ', async () => {
  const { duongDan } = dungDb();
  await assert.rejects(
    () => main(['node', 'x', '--db', duongDan, '--so', '0', '--tz', TZ]),
    /--so phải là số nguyên dương/,
  );
});

test('I7 múi giờ rác -> nổ với hướng dẫn, không âm thầm dùng giờ máy', async () => {
  const { duongDan } = dungDb();
  await assert.rejects(
    () => main(['node', 'x', '--db', duongDan, '--tz', 'Sao/Hoa']),
    /Múi giờ không hợp lệ/,
  );
});

test('I8 lechPhut đọc đúng offset của vùng', () => {
  assert.equal(lechPhut(T(9, 0), 'Asia/Ho_Chi_Minh'), 420);
  assert.equal(lechPhut(T(9, 0), 'UTC'), 0);
});

test('I9 dinhDangGio trả ngày/giờ theo đúng vùng, không theo giờ máy', () => {
  const g = dinhDangGio(Date.UTC(2026, 7, 20, 2, 12, 0), TZ);
  assert.equal(g.ngay, '2026-08-20');
  assert.equal(g.gio, '09:12:00');
});
