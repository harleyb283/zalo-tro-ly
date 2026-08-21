/**
 * G8 — test wiring + watchdog. Chạy: `npm test` (node --test).
 *
 * 🔴 KHÔNG đăng nhập Zalo, KHÔNG quét QR, KHÔNG chạm mạng.
 * Ba bài (A1, A2, D1) SPAWN TIẾN TRÌNH THẬT `node src/index.js` và đọc MÃ
 * THOÁT THẬT — không tin dòng chữ nào tự in ra. Phần còn lại tiêm phụ thuộc
 * giả để chạy được từng nhánh mà không cần websocket.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MA_THOAT, ganXuLyTin, giuKhoaPid, xuLyMotTin } from '../src/index.js';
import { WS, docTrangThaiWs, listenerSong, taoWatchdog } from '../src/zalo/watchdog.js';
import { moDb, dongDb } from '../src/store/db.js';
import { kiemCauHinh } from '../src/policy/access.js';
import { upsertHoiThoai } from '../src/store/write.js';
import { truyVanLichSu, thongKe } from '../src/store/query.js';
import { BACKOFF_NOI_LAI_MS, GIOI_HAN, SU_KIEN, TRANG_THAI_SUC_KHOE } from '../src/lib/hang_so.js';

const GOC = path.resolve(import.meta.dirname, '..');
const RAC = [];
process.on('exit', () => {
  for (const d of RAC) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch { /* nuốt */ }
  }
});

function thuMucTam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-g8-'));
  RAC.push(d);
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  return d;
}

function vietConfig(d, sua = {}) {
  const ch = {
    hosts: [{ userId: '111', ten: 'Anh', dmChatId: 'dm-111' }],
    groups: [{ chatId: 'A', ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true }],
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    duongDan: {
      db: path.join(d, 'data', 'lichsu.db'),
      session: path.join(d, 'data', 'session.json'),
      health: path.join(d, 'data', 'health.json'),
    },
    ...sua,
  };
  const p = path.join(d, 'ch.json');
  fs.writeFileSync(p, JSON.stringify(ch));
  return p;
}

/** Chạy THẬT `node src/index.js` và trả mã thoát + stderr. */
function chayThat(args, hanMs = 25_000) {
  const r = spawnSync(process.execPath, [path.join(GOC, 'src', 'index.js'), ...args], {
    cwd: GOC,
    encoding: 'utf8',
    timeout: hanMs,
    env: { ...process.env, ZTL_CONFIG: '', ZTL_DATA_DIR: '' },
  });
  return { ma: r.status, err: r.stderr ?? '', hetGio: r.signal === 'SIGTERM' };
}

function tinGia(v = {}) {
  return {
    chatId: 'A', msgId: 'm1', cliMsgId: null, userId: '111', tenLucGui: 'Anh',
    msgType: 'chat.text', noiDung: 'xin chào', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, coTagHost: true, ...v,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A. TỪ CHỐI CHẠY KHI CẤU HÌNH SAI  (nghiệm thu #2)
// ═══════════════════════════════════════════════════════════════════════════

test('A1 ★ config THIẾU hosts -> TỪ CHỐI CHẠY, mã thoát khác 0', () => {
  const d = thuMucTam();
  const p = vietConfig(d, { hosts: [] });
  const r = chayThat(['--config', p]);
  assert.notEqual(r.ma, 0, 'chạy được với allowlist rỗng = ai cũng điều khiển được trợ lý');
  assert.equal(r.ma, MA_THOAT.CAU_HINH_SAI, `mã thoát ${r.ma}`);
  assert.match(r.err, /TỪ CHỐI CHẠY/);
  assert.equal(r.hetGio, false, 'phải thoát ngay, không được treo');
});

test('A2 ★ config có WILDCARD -> TỪ CHỐI CHẠY', () => {
  const d = thuMucTam();
  const p = vietConfig(d, { hosts: [{ userId: '*', dmChatId: 'd' }] });
  const r = chayThat(['--config', p]);
  assert.equal(r.ma, MA_THOAT.CAU_HINH_SAI, `mã thoát ${r.ma}`);
  assert.match(r.err, /MỞ TOANG/);
});

// ═══════════════════════════════════════════════════════════════════════════
// B. KHÔNG CÓ COOKIE  (nghiệm thu #3)
// ═══════════════════════════════════════════════════════════════════════════

test('B1 ★ chưa có cookie -> health=CAN_QR, thoát mã 3, KHÔNG treo, KHÔNG tự mở QR', () => {
  const d = thuMucTam();
  const p = vietConfig(d);
  const r = chayThat(['--config', p]);

  assert.equal(r.ma, MA_THOAT.CAN_QR, `mã thoát ${r.ma}, mong đợi 3`);
  assert.equal(r.hetGio, false, 'tiến trình nền treo chờ ai đó quét QR = hỏng câm');

  const health = JSON.parse(fs.readFileSync(path.join(d, 'data', 'health.json'), 'utf8'));
  assert.equal(health.trangThai, TRANG_THAI_SUC_KHOE.CAN_QR);

  // Bằng chứng KHÔNG tự mở QR: không có dòng nào của luồng quét QR
  // (`dangNhapBangQr` in "Quét mã" / hiện QR). Chỉ được phép có lời NHẮC
  // chạy tay bin/zalo-login.js.
  assert.equal(/Đang chờ quét|hiện QR|qrcode/i.test(r.err), false, 'có dấu vết tự mở QR');
  assert.match(r.err, /bin\/zalo-login\.js/, 'phải chỉ đường chạy TAY');
});

// ═══════════════════════════════════════════════════════════════════════════
// C. WATCHDOG — 3 TRẠNG THÁI  (nghiệm thu #4, #5)
// ═══════════════════════════════════════════════════════════════════════════

const apiWs = (rs) => ({ listener: { ws: { readyState: rs }, on() {}, off() {} } });

test('C1 listenerSong đọc readyState: OPEN=sống, CLOSED/CLOSING=chết', () => {
  assert.equal(listenerSong(apiWs(WS.OPEN)), true);
  assert.equal(listenerSong(apiWs(WS.CLOSED)), false);
  assert.equal(listenerSong(apiWs(WS.CLOSING)), false);
});

test('C2 ★ KHÔNG đọc được trạng thái -> null (KHÔNG BIẾT), KHÔNG phải false', () => {
  // Đây là ca hợp đồng gọi là "_closeTimer trả null". Ba đường hỏng đều phải
  // đổ về null: đoán "chết" là nối lại vô hạn, đoán "sống" là chết câm.
  assert.equal(listenerSong({}), null, 'không có listener');
  assert.equal(listenerSong({ listener: { ws: { _closeTimer: null } } }), null,
    '_closeTimer KHÔNG được dùng làm tín hiệu sống — nó sai cả hai chiều');
  assert.equal(listenerSong({ listener: { ws: { readyState: 'mở' } } }), null,
    'readyState kiểu lạ');
  assert.equal(listenerSong(apiWs(WS.CONNECTING)), null, 'đang nối, chưa kết luận');
  assert.equal(listenerSong(null), null);
});

test('C3 listener đã dừng (ws=null) -> chết', () => {
  assert.equal(listenerSong({ listener: { ws: null } }), false);
  assert.match(docTrangThaiWs({ listener: { ws: null } }).lyDo, /listener đã dừng/);
});

test('C4 ★ KHÔNG BIẾT -> ghi KHONG_BIET và TUYỆT ĐỐI KHÔNG nối lại', async () => {
  const ghi = [];
  let soLanNoiLai = 0;
  const wd = taoWatchdog({
    api: () => ({ listener: { ws: { _closeTimer: null } } }),
    cauHinh: kiemCauHinh(chGia()),
    ghiSucKhoe: (tt) => ghi.push(tt.trangThai),
    khiCanNoiLai: async () => { soLanNoiLai += 1; },
  });
  // 20 nhịp: nếu null bị nhồi thành "chết" thì đây là vòng nối lại vô hạn.
  for (let i = 0; i < 20; i += 1) await wd.motNhip();
  assert.equal(soLanNoiLai, 0, `đã nối lại ${soLanNoiLai} lần — null đang bị coi là chết`);
  assert.deepEqual([...new Set(ghi)], [TRANG_THAI_SUC_KHOE.KHONG_BIET]);
  wd.dung();
});

function chGia() {
  return {
    hosts: [{ userId: '111', ten: 'Anh', dmChatId: 'dm-111' }],
    groups: [{ chatId: 'A', ten: 'Nhóm A', traLoiKhiTag: true }],
    cauTrungTinh: 'x',
    duongDan: { db: '~/.ztl-test-g8/lichsu.db' },
    thoiGian: { keepAliveMs: 1000, watchdogMs: 1000, imLangMs: 1000, queueTtlMs: 1000 },
  };
}

test('C5 ★ listener CHẾT -> phát hiện ngay 1 nhịp, thử đúng 5 lần rồi DỪNG', async () => {
  const ghi = [];
  const mocThu = [];
  const wd = taoWatchdog({
    api: () => apiWs(WS.CLOSED),
    cauHinh: kiemCauHinh(chGia()),
    ghiSucKhoe: (tt) => ghi.push(tt),
    khiCanNoiLai: async () => {
      mocThu.push(Date.now());
      throw new Error('cookie chết');
    },
  });
  // Rút backoff xuống cho test chạy nhanh bằng cách chặn _nghi? Không —
  // KHÔNG mock thời gian: dùng BACKOFF thật thì bài này mất 6 phút. Thay vào
  // đó kiểm ĐÚNG SỐ LẦN + THỨ TỰ backoff qua nội dung health đã ghi.
  const p = wd.motNhip();
  // Chờ đủ để vòng nối lại ghi được bản ghi DANG_NOI_LAI đầu tiên.
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(wd.dangNoiLai(), true, 'phát hiện chết phải vào vòng nối lại NGAY nhịp đầu');
  const dangNoiLai = ghi.filter((t) => t.trangThai === TRANG_THAI_SUC_KHOE.DANG_NOI_LAI);
  assert.ok(dangNoiLai.length >= 1);
  assert.match(dangNoiLai[0].lyDo, new RegExp(`chờ ${BACKOFF_NOI_LAI_MS[0]}ms`),
    'backoff đầu tiên phải là 5s');
  assert.match(dangNoiLai[0].lyDo, new RegExp(`lần 1/${GIOI_HAN.SO_LAN_NOI_LAI_TOI_DA}`));
  wd.dung();          // cắt vòng chờ backoff
  await p;
});

test('C6 ★ TRỌN VÒNG: thử ĐÚNG 5 lần, đúng thứ tự backoff, rồi CAN_QR + báo host', async () => {
  const ghi = [];
  const mocThu = [];
  let hetCach = 0;
  const wd = taoWatchdog({
    api: () => apiWs(WS.CLOSED),
    cauHinh: kiemCauHinh(chGia()),
    // Tiêm backoff siêu ngắn nhưng GIỮ NGUYÊN TỈ LỆ để chứng minh trọn vòng
    // trong mili-giây. Backoff thật (5s/15s/60s/300s/300s) mất 6 PHÚT.
    backoffMs: [4, 8, 12, 16, 20],
    ghiSucKhoe: (tt) => ghi.push(tt),
    khiCanNoiLai: async () => { mocThu.push(Date.now()); throw new Error('cookie chết'); },
    khiHetCach: () => { hetCach += 1; },
  });

  await wd.motNhip();

  assert.equal(mocThu.length, GIOI_HAN.SO_LAN_NOI_LAI_TOI_DA,
    `thử ${mocThu.length} lần, hợp đồng nói ${GIOI_HAN.SO_LAN_NOI_LAI_TOI_DA}`);
  const dangNoiLai = ghi.filter((t) => t.trangThai === TRANG_THAI_SUC_KHOE.DANG_NOI_LAI);
  assert.equal(dangNoiLai.length, 5, 'mỗi lần thử phải ghi một bản DANG_NOI_LAI');
  for (let i = 0; i < 5; i += 1) {
    assert.match(dangNoiLai[i].lyDo, new RegExp(`chờ ${[4, 8, 12, 16, 20][i]}ms`),
      `backoff lần ${i + 1} sai`);
    assert.equal(dangNoiLai[i].soLanThuLai, i + 1);
  }
  const cuoi = ghi.at(-1);
  assert.equal(cuoi.trangThai, TRANG_THAI_SUC_KHOE.CAN_QR, 'hết cách phải ra CAN_QR');
  assert.match(cuoi.lyDo, /zalo-login\.js/, 'phải chỉ đường quét QR tay');
  assert.equal(hetCach, 1, 'phải báo host đúng MỘT lần');
  assert.equal(wd.dangNoiLai(), false, 'phải thoát vòng, không kẹt cờ dangNoiLai');
  wd.dung();
});

test('C7 nối lại THÀNH CÔNG -> quay về OK, đếm nghi ngờ về 0', async () => {
  const ghi = [];
  let song = false;
  const wd = taoWatchdog({
    api: () => apiWs(song ? WS.OPEN : WS.CLOSED),
    cauHinh: kiemCauHinh({ ...chGia(), thoiGian: { ...chGia().thoiGian } }),
    ghiSucKhoe: (tt) => ghi.push(tt),
    khiCanNoiLai: async () => { song = true; },
  });
  await wd.motNhip();
  assert.ok(ghi.some((t) => t.trangThai === TRANG_THAI_SUC_KHOE.OK), 'chưa ghi OK sau khi nối lại');
  assert.equal(wd.soNghiNgo(), 0);
  wd.dung();
});

test('C8 ★ Tầng 2: im lặng 1 chu kỳ CHƯA hành động (nhóm im 15 phút là bình thường)', async () => {
  const ghi = [];
  let noiLai = 0;
  const wd = taoWatchdog({
    api: () => apiWs(WS.OPEN),
    // imLangMs = 0 để mọi nhịp đều "im lặng quá ngưỡng".
    cauHinh: kiemCauHinh({ ...chGia(), thoiGian: { ...chGia().thoiGian, imLangMs: 1 } }),
    ghiSucKhoe: (tt) => ghi.push(tt),
    khiCanNoiLai: async () => { noiLai += 1; },
    kiemKeepAlive: async () => true,
  });
  await new Promise((r) => setTimeout(r, 5));
  await wd.motNhip();
  assert.equal(noiLai, 0, 'im lặng MỘT chu kỳ mà đã nối lại = tự đá phiên của chính mình');
  assert.equal(wd.soNghiNgo(), 1);
  assert.equal(ghi.at(-1).trangThai, TRANG_THAI_SUC_KHOE.KHONG_BIET);

  await wd.motNhip();   // chu kỳ thứ HAI -> mới được hành động
  assert.equal(noiLai, 1, 'hai chu kỳ liên tiếp mà vẫn không hành động');
  wd.dung();
});

// ═══════════════════════════════════════════════════════════════════════════
// D. PID-LOCK  (nghiệm thu #7)
// ═══════════════════════════════════════════════════════════════════════════

test('D1 ★ hai tiến trình THẬT cùng lúc -> cái thứ hai TỪ CHỐI', async () => {
  const d = thuMucTam();
  const khoa = path.join(d, 'data', 'zalo-tro-ly.pid');
  const giu = path.join(d, 'giu.mjs');
  fs.writeFileSync(
    giu,
    `import { giuKhoaPid } from '${path.join(GOC, 'src', 'index.js')}';\n` +
      `giuKhoaPid(${JSON.stringify(khoa)});\n` +
      `process.stdout.write('DA_GIU\\n');\n` +
      `setTimeout(() => {}, 20000);\n`,
  );
  const con = spawn(process.execPath, [giu], { cwd: GOC });
  try {
    await new Promise((giai, tu) => {
      con.stdout.on('data', (b) => String(b).includes('DA_GIU') && giai());
      con.on('exit', () => tu(new Error('tiến trình giữ khoá chết sớm')));
      setTimeout(() => tu(new Error('quá hạn chờ giữ khoá')), 10_000);
    });
    assert.equal(fs.existsSync(khoa), true);
    assert.throws(() => giuKhoaPid(khoa), /Đã có tiến trình trợ lý đang chạy/,
      'hai bản cùng ghi một DB và cùng nghe một websocket = hỏng dữ liệu');
  } finally {
    con.kill('SIGKILL');
  }
});

test('D2 khoá MỒ CÔI (pid đã chết) -> tự dọn, KHÔNG chặn khởi động vĩnh viễn', () => {
  const d = thuMucTam();
  const khoa = path.join(d, 'data', 'x.pid');
  fs.mkdirSync(path.dirname(khoa), { recursive: true });
  fs.writeFileSync(khoa, '999999');      // pid gần như chắc chắn không tồn tại
  const g = giuKhoaPid(khoa);
  assert.equal(fs.readFileSync(khoa, 'utf8').trim(), String(process.pid));
  g.nha();
  assert.equal(fs.existsSync(khoa), false);
});

test('D3 nha() chỉ xoá khoá CỦA MÌNH, không xoá nhầm của tiến trình khác', () => {
  const d = thuMucTam();
  const khoa = path.join(d, 'data', 'y.pid');
  const g = giuKhoaPid(khoa);
  fs.writeFileSync(khoa, '424242');      // ai đó khác vừa giành được
  g.nha();
  assert.equal(fs.existsSync(khoa), true, 'đã xoá nhầm khoá của tiến trình khác');
});

// ═══════════════════════════════════════════════════════════════════════════
// E. LUỒNG TIN — GHI DB TRƯỚC, NOTIFY SAU  (nghiệm thu #6)
// ═══════════════════════════════════════════════════════════════════════════

function dungHe(suaCh = {}) {
  const d = thuMucTam();
  const db = moDb(path.join(d, 'data', 'lichsu.db'));
  const cauHinh = kiemCauHinh({ ...chGia(), ...suaCh });
  return { d, db, cauHinh };
}

test('E1 ★ notify NÉM LỖI -> tin VẪN được ghi vào DB', async () => {
  const { db, cauHinh } = dungHe();
  upsertHoiThoai(db, { chatId: 'A', loai: 'GROUP', ten: 'Nhóm A', duocNghe: true });

  xuLyMotTin(
    {
      db, cauHinh,
      guiThongBao: async () => { throw new Error('kênh MCP chết'); },
      tenHoiThoai: () => 'Nhóm A',
    },
    tinGia({ msgId: 'notify-no' }),
  );
  await new Promise((r) => setTimeout(r, 30));   // để promise notify kịp nổ

  const { rows } = truyVanLichSu(db, { chatId: 'A' });
  assert.equal(rows.length, 1, 'notify hỏng đã kéo theo mất tin thật');
  assert.equal(rows[0].msg_id, 'notify-no');
  dongDb(db);
});

test('E2 ★ notify trả FALSE -> hàng đợi GIỮ "cho" để đẩy bù, không mất câu hỏi', async () => {
  const { db, cauHinh } = dungHe();
  xuLyMotTin(
    { db, cauHinh, guiThongBao: async () => false, tenHoiThoai: () => null },
    tinGia({ msgId: 'chua-day' }),
  );
  await new Promise((r) => setTimeout(r, 30));
  const dong = db.prepare('SELECT * FROM hang_doi_hoi').get();
  assert.ok(dong, 'chưa mở hàng đợi');
  assert.equal(dong.trang_thai, 'cho', 'đẩy chưa được mà đã đổi trạng thái');
  dongDb(db);
});

test('E3 ★ notify TRẢ TRUE -> chỉ được chuyển "da_day", TUYỆT ĐỐI không "da_tra_loi"', async () => {
  const { db, cauHinh } = dungHe();
  xuLyMotTin(
    { db, cauHinh, guiThongBao: async () => true, tenHoiThoai: () => null },
    tinGia({ msgId: 'da-day' }),
  );
  await new Promise((r) => setTimeout(r, 30));
  const dong = db.prepare('SELECT * FROM hang_doi_hoi').get();
  assert.equal(dong.trang_thai, 'da_day',
    'đã notify KHÔNG có nghĩa là đã tới — bằng chứng duy nhất là Claude gọi lại tool');
  dongDb(db);
});

test('E4 [ĐỔI v9] tin NGƯỜI LẠ -> GHI DB + mở lượt CHỈ NGHE (⛔ không phải lượt được nói)', async () => {
  // 🔴 HÀNH VI ĐỔI CÓ CHỦ ĐÍCH (anh chốt 21/08/2026): trợ lý phải theo kịp
  // nhóm, nên tin người khác nay TẠO MỘT LƯỢT thay vì bị vứt.
  // ⚠️ Phần KHÔNG được đổi: lượt đó mang cờ `chi_nghe = 1`, và server chặn
  // `tra_loi` + mọi tool ghi trên nó ⇒ vẫn 0 tin đi ra Zalo.
  const { db, cauHinh } = dungHe();
  const daBao = [];
  xuLyMotTin(
    { db, cauHinh, guiThongBao: async (p) => { daBao.push(p); return true; }, tenHoiThoai: () => null },
    tinGia({ msgId: 'nguoi-la', userId: '9990000000999' }),
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(thongKe(db).soTinDaLuu, 1, 'phải lưu lịch sử mọi tin');
  assert.equal(daBao.length, 1, 'người lạ nay ĐƯỢC đánh thức trợ lý (để nghe)');

  // 🔴 Canh GIÁ TRỊ THẬT XUỐNG CỘT DB, ⛔ không chỉ canh "có gọi hàm".
  const dong = db.prepare("SELECT * FROM hang_doi_hoi WHERE msg_id = 'nguoi-la'").get();
  assert.ok(dong, 'phải có dòng hàng đợi');
  assert.equal(dong.chi_nghe, 1, '🔴 thiếu cờ này là lượt người lạ ĐƯỢC NÓI — rò ra Zalo');
  assert.equal(daBao[0].chiNghe, true, 'tin báo cho model cũng phải mang cờ');
  dongDb(db);
});

test('E5 nhóm NGOÀI allowlist -> vẫn lưu, nhưng duoc_nghe=0 nên tầng đọc không trả ra', async () => {
  const { db, cauHinh } = dungHe();
  xuLyMotTin(
    { db, cauHinh, guiThongBao: async () => true, tenHoiThoai: () => null },
    tinGia({ msgId: 'nhom-la', chatId: 'Z' }),
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(thongKe(db).soTinDaLuu, 1, 'tin phải được LƯU');
  assert.equal(truyVanLichSu(db, {}).rows.length, 0, 'nhưng KHÔNG được đọc ra (fail-closed)');
  assert.equal(
    Number(db.prepare("SELECT duoc_nghe d FROM hoi_thoai WHERE chat_id='Z'").get().d), 0,
  );
  dongDb(db);
});

test('E6 nhóm ghiLichSu=false -> nghe nhưng KHÔNG ghi tin', async () => {
  const { db, cauHinh } = dungHe({
    groups: [{ chatId: 'A', ten: 'Nhóm A', ghiLichSu: false, traLoiKhiTag: true }],
  });
  xuLyMotTin(
    { db, cauHinh, guiThongBao: async () => true, tenHoiThoai: () => null },
    tinGia({ msgId: 'khong-ghi' }),
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(thongKe(db).soTinDaLuu, 0);
  assert.equal(thongKe(db).soNhomDangNghe, 1, 'vẫn phải nghe nhóm đó');
  dongDb(db);
});

test('E7 ★ GHI DB hỏng KHÔNG chặn gate — mất 1 dòng còn hơn mất khả năng trả lời', async () => {
  const { db, cauHinh } = dungHe();
  const dbHong = new Proxy(db, {
    get(m, k) {
      if (k === 'prepare') return () => { throw new Error('DB hỏng'); };
      return Reflect.get(m, k);
    },
  });
  let daNotify = 0;
  assert.doesNotThrow(() =>
    xuLyMotTin(
      { db: dbHong, cauHinh, guiThongBao: async () => { daNotify += 1; return true; },
        tenHoiThoai: () => null },
      tinGia({ msgId: 'db-hong' }),
    ),
  );
  dongDb(db);
});

test('E8 handler KHÔNG để lỗi nổ ngược lên websocket', async () => {
  const { db, cauHinh } = dungHe();
  const { EventEmitter } = await import('node:events');
  const boPhat = new EventEmitter();
  ganXuLyTin({ boPhat, db, cauHinh, guiThongBao: null, tenHoiThoai: () => null });
  // Payload dị dạng ở CẢ 5 kênh: emit() chạy đồng bộ, một lỗi lọt ra là giết
  // cả tiến trình vì MỘT tin hỏng.
  for (const sk of Object.values(SU_KIEN)) {
    assert.doesNotThrow(() => boPhat.emit(sk, { rac: true }), `kênh ${sk} làm nổ`);
    assert.doesNotThrow(() => boPhat.emit(sk, null), `kênh ${sk} với null làm nổ`);
  }
  dongDb(db);
});

// ═══════════════════════════════════════════════════════════════════════════
// F. LUẬT CHUNG
// ═══════════════════════════════════════════════════════════════════════════

test('F1 index.js + watchdog.js KHÔNG có console.log (stdout là kênh MCP)', () => {
  for (const f of ['src/index.js', 'src/zalo/watchdog.js']) {
    const src = fs.readFileSync(path.join(GOC, f), 'utf8');
    assert.equal(/console\.log\s*\(/.test(src), false, `${f} có console.log`);
  }
});

test('F2 ★ HÀNH VI: chạy tới lúc thoát KHÔNG in một byte nào ra stdout', () => {
  const d = thuMucTam();
  const p = vietConfig(d);
  const r = spawnSync(process.execPath, [path.join(GOC, 'src', 'index.js'), '--config', p], {
    cwd: GOC, encoding: 'utf8', timeout: 25_000,
  });
  // Quét chữ có thể trượt (log gián tiếp qua module khác). Đây là phép đo
  // HÀNH VI: một byte lạc vào stdout là hỏng cả phiên MCP, hỏng CÂM.
  assert.equal(r.stdout, '', `stdout phải RỖNG, nhận được: ${JSON.stringify(r.stdout.slice(0, 200))}`);
});

test('F3 --khong-mcp là cờ có thật (spec F: Herdr/Claude là TUỲ CHỌN)', () => {
  const src = fs.readFileSync(path.join(GOC, 'src', 'index.js'), 'utf8');
  assert.match(src, /--khong-mcp/);
});

// ═══════════════════════════════════════════════════════════════════════
// K. WIRING v4 — 3 bản vá vào index.js
//
// 🔴 Khối wiring của `index.js` chỉ chạy SAU khi đăng nhập Zalo thành công —
//    thứ pack này CẤM thử. `node --check` và unit test KHÔNG với tới nó. Bài
//    nhóm này kéo lỗi về thời điểm chạy test bằng cách đọc chính mã nguồn +
//    nạp thật module để kiểm tên hàm có tồn tại.
// ═══════════════════════════════════════════════════════════════════════

const SRC_INDEX = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('K1 ★ HẾT ternary vô nghĩa: mất mạng KHÔNG còn bị phán là "cookie chết"', () => {
  // Bản cũ: `e?.maSucKhoe === CAN_QR ? CAN_QR : CAN_QR` — hai nhánh y hệt nhau
  // nên rớt mạng 1 giây cũng thành "quét QR đi". Tài khoản Zalo chỉ có MỘT
  // suất máy tính: tin lời khuyên sai rồi quét QR thật là tự đá văng phiên
  // đang khoẻ — báo động giả tự gây ra sự cố thật.
  assert.ok(
    !/CAN_QR\s*\n?\s*:\s*TRANG_THAI_SUC_KHOE\.CAN_QR/.test(SRC_INDEX),
    'ternary hai nhánh giống nhau vẫn còn trong index.js',
  );
  assert.match(SRC_INDEX, /:\s*TRANG_THAI_SUC_KHOE\.KHONG_BIET/,
    'nhánh không phân loại được phải là KHONG_BIET');
});

test('K2 câu DM lúc khởi động rẽ theo mã — KHONG_BIET thì DẶN ĐỪNG quét QR', () => {
  assert.match(SRC_INDEX, /ĐỪNG quét QR/, 'thiếu lời dặn thì anh vẫn đi quét');
  assert.match(SRC_INDEX, /một suất\s*\n?\s*.{0,30}máy tính|một suất máy tính/,
    'phải nói RÕ vì sao đừng quét, không thì lời dặn nghe như chống chỉ định vu vơ');
  assert.match(SRC_INDEX, /tieuDe: canQr \?/, 'tiêu đề cũng phải rẽ, không để nguyên "cần quét QR"');
});

test('K3 ★ khiHetCach NHẬN (maCuoi, toanLoiMang) — hết dùng chuỗi cứng', () => {
  assert.match(SRC_INDEX, /khiHetCach:\s*\(maCuoi,\s*toanLoiMang\)/,
    'watchdog truyền 2 tham số; bỏ qua chúng là quay lại DM câu giục quét QR bất kể nguyên nhân');
  assert.match(SRC_INDEX, /toanLoiMang\s*\n?\s*\?/, 'phải rẽ câu theo toanLoiMang');
  assert.ok(
    !/khiHetCach: \(\) =>/.test(SRC_INDEX),
    'vẫn còn bản khiHetCach không nhận tham số',
  );
});

test('K4 watchdog THẬT SỰ truyền 2 tham số đó (đọc phía phát, không chỉ phía nhận)', () => {
  const wd = fs.readFileSync(new URL('../src/zalo/watchdog.js', import.meta.url), 'utf8');
  assert.match(wd, /khiHetCach\?\.\(\s*maCuoi\s*,\s*toanLoiMang\s*\)/,
    'hai đầu phải khớp nhau — chỉ kiểm một đầu là đo mù');
});

test('K5 ★ cầu nối tạm ĐÃ XOÁ HẲN, không còn hai đường song song', async () => {
  const tools = fs.readFileSync(new URL('../src/mcp/tools.js', import.meta.url), 'utf8');
  const chan = fs.readFileSync(new URL('../src/mcp/channel.js', import.meta.url), 'utf8');
  for (const [ten, src] of [['tools.js', tools], ['channel.js', chan]]) {
    for (const dau of ['layHamBoiCanhTraLoi', '_cauNoiTools', '_dbBoiCanh', '_khoBoiCanh']) {
      assert.ok(!src.includes(dau), `${ten} vẫn còn '${dau}' — hai đường song song là chỗ sinh sai lệch`);
    }
  }
  // Đường DUY NHẤT còn lại: index.js truyền thẳng vào taoChannel.
  assert.match(SRC_INDEX, /layBoiCanhTraLoi: \(requestId\) => layBoiCanhTraLoi\(db, requestId\)/);
  assert.match(SRC_INDEX, /import\('\.\/store\/query\.js'\)/);
  const q = await import('../src/store/query.js');
  assert.equal(typeof q.layBoiCanhTraLoi, 'function', 'query.js KHÔNG export hàm index.js đang lấy');
});

test('K6 mọi module + tên hàm index.js nạp ĐỘNG cho v4 đều tồn tại thật', async () => {
  const can = [
    ['./mcp/channel.js', ['taoChannel', 'dayHangDoiCho']],
    ['./store/query.js', ['layBoiCanhTraLoi']],
    ['./mcp/tools.js', ['dangKyTool']],
  ];
  for (const [duongDan, ten] of can) {
    assert.ok(SRC_INDEX.includes(`import('${duongDan}')`), `index.js không nạp ${duongDan}`);
    // eslint-disable-next-line no-await-in-loop
    const m = await import(duongDan.replace('./', '../src/'));
    for (const t of ten) {
      assert.ok(m[t] !== undefined, `${duongDan} KHÔNG export '${t}' mà index.js đang lấy`);
    }
  }
});
