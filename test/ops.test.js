/**
 * G6 — nghiệm thu ops: health.js · notify_host.js · bin/zalo-health.js · bin/zalo-remind.js
 * Chạy: node --test
 *
 * ⛔ KHÔNG đăng nhập Zalo, KHÔNG gọi mạng. `api` là đối tượng giả.
 * Riêng `runNotifyCommand` CÓ chạy tiến trình con thật (`sh -c`) — đó là thứ
 * duy nhất trong gói này đáng chạy thật, vì cả điểm của nó là bơm JSON qua
 * stdin cho một lệnh của người lạ.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  writeHealth, readHealth, isValidHealthCode, isBroken, isUnknown,
  heartbeatAgeMs, stateAgeMs, describeDuration,
} from '../src/ops/health.js';
import {
  notifyHost, runNotifyCommand, primaryHostDm, osNotify,
  isRunningTests, getBlockedNotifications, clearBlockedLog, osascriptArgs,
  OSASCRIPT_SOURCE, stampReal,
} from '../src/ops/notify_host.js';
import { judgeHealth, MA, heartbeatDeadlineMs, RECONNECT_DEADLINE_MS } from '../bin/zalo-health.js';
import { reminderBody, pickTarget, MA as MA_REMIND } from '../bin/zalo-remind.js';
import { TRANG_THAI_SUC_KHOE, DANH_SACH_TRANG_THAI_SUC_KHOE } from '../src/lib/hang_so.js';

const SAN = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-g6-'));
const hp = (t = 'health.json') => path.join(SAN, t);

/** Config tối thiểu, đúng tên trường của types.d.ts. */
function cauHinhGia(ghiDe = {}) {
  return {
    hosts: [{ userId: '111', ten: 'Chu nha', dmChatId: 'dm111' },
            { userId: '222', ten: 'Host 2', dmChatId: 'dm222' }],
    groups: [{ chatId: 'g1', ten: 'Nhom 1', ghiLichSu: true, traLoiKhiTag: true }],
    duongDan: { db: hp('db'), session: hp('s.json'), health: hp() },
    thoiGian: { keepAliveMs: 120000, watchdogMs: 300000, imLangMs: 900000, queueTtlMs: 1800000 },
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    notifyCommand: null,
    anTrangThai: true,
    ...ghiDe,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// A. health.js — 5 mã, và KHONG_BIET không bị gộp
// ═══════════════════════════════════════════════════════════════════════

test('A1 đúng 5 mã trạng thái, không thừa không thiếu', () => {
  assert.deepEqual([...DANH_SACH_TRANG_THAI_SUC_KHOE].sort(),
    ['CAN_QR', 'DANG_NOI_LAI', 'KHONG_BIET', 'LISTENER_CHET', 'OK']);
  for (const m of DANH_SACH_TRANG_THAI_SUC_KHOE) assert.ok(isValidHealthCode(m));
  assert.equal(isValidHealthCode('LISTENER_CHET '), false, 'có dấu cách thừa là mã khác');
  assert.equal(isValidHealthCode('listener_chet'), false, 'phân biệt hoa thường');
});

test('🔴 A2 KHONG_BIET KHÔNG bị xếp vào nhóm "hỏng" (nếu không: nối lại vô hạn)', () => {
  assert.equal(isBroken(TRANG_THAI_SUC_KHOE.KHONG_BIET), false);
  assert.equal(isUnknown(TRANG_THAI_SUC_KHOE.KHONG_BIET), true);
  assert.equal(isBroken(TRANG_THAI_SUC_KHOE.LISTENER_CHET), true);
  assert.equal(isBroken(TRANG_THAI_SUC_KHOE.CAN_QR), true);
  assert.equal(isBroken(TRANG_THAI_SUC_KHOE.OK), false);
  // Và nó cũng KHÔNG phải "khoẻ" — phải có nhánh riêng, không được gộp bên nào.
  assert.notEqual(isBroken(TRANG_THAI_SUC_KHOE.KHONG_BIET),
    isUnknown(TRANG_THAI_SUC_KHOE.KHONG_BIET));
});

test('A3 mã lạ -> NÉM LỖI, không âm thầm ép về KHONG_BIET', () => {
  assert.throws(() => writeHealth(hp('x.json'), { trangThai: 'CHET_ROI' }),
    /không hợp lệ/);
  assert.throws(() => writeHealth(hp('x.json'), {}), /không hợp lệ/);
  assert.equal(fs.existsSync(hp('x.json')), false, 'không để lại file rác');
});

test('🔴 A4 tuLuc GIỮ NGUYÊN khi trạng thái không đổi, ĐỔI khi trạng thái đổi', async () => {
  const p = hp('a4.json');
  const l1 = writeHealth(p, { trangThai: 'OK', lyDo: 'lần 1' });
  await new Promise((r) => setTimeout(r, 12));
  const l2 = writeHealth(p, { trangThai: 'OK', lyDo: 'lần 2' });
  assert.equal(l2.tuLuc, l1.tuLuc, 'cùng mã -> tuLuc là mốc VÀO trạng thái, không đổi');
  assert.notEqual(l2.ghiLuc, l1.ghiLuc, 'ghiLuc là NHỊP TIM -> phải đổi mỗi lần ghi');

  await new Promise((r) => setTimeout(r, 12));
  const l3 = writeHealth(p, { trangThai: 'CAN_QR', lyDo: 'cookie chết' });
  assert.notEqual(l3.tuLuc, l1.tuLuc, 'đổi mã -> đóng dấu mốc mới');
  assert.equal(readHealth(p).trangThai, 'CAN_QR');
});

test('A5 tuLuc truyền tay thì được tôn trọng (dùng cho khôi phục sau restart)', () => {
  const p = hp('a5.json');
  const t = '2026-01-02T03:04:05.000Z';
  assert.equal(writeHealth(p, { trangThai: 'OK', tuLuc: t }).tuLuc, t);
});

test('🔴 A6 lyDo đi qua redact() NGAY TẠI health.js, không tin chỗ gọi', () => {
  const p = hp('a6.json');
  writeHealth(p, { trangThai: 'CAN_QR', lyDo: 'fail Cookie: zpsid=SIEU_BI_MAT_XYZ' });
  const doc = fs.readFileSync(p, 'utf8');
  assert.ok(!doc.includes('SIEU_BI_MAT_XYZ'),
    'file này người khác đọc được và cron có thể MAIL nó đi');
});

test('A7 lyDo quá dài bị cắt (stack trace lọt vào thì đừng để phình file)', () => {
  const p = hp('a7.json');
  // Dùng CÂU CHỮ chứ không phải 5000 ký tự 'x': redact() gom một dải chữ-số
  // dài liền mạch thành «đã che» (nó ngờ đó là khoá phiên), nên chuỗi 'xxxx…'
  // co lại còn 8 ký tự và chẳng bao giờ chạm ngưỡng cắt. Muốn kiểm bước CẮT
  // thì đầu vào phải là thứ redact để nguyên.
  const dai = 'at moduleA (file line 10) '.repeat(60);
  assert.ok(dai.length > 1000);
  const r = writeHealth(p, { trangThai: 'OK', lyDo: dai });
  assert.ok(r.lyDo.length < 700, String(r.lyDo.length));
  assert.match(r.lyDo, /đã cắt/);
});

test('A8 ghi NGUYÊN TỬ + quyền 0600, không để lại file .tmp', () => {
  const p = hp('a8.json');
  writeHealth(p, { trangThai: 'OK' });
  assert.equal((fs.statSync(p).mode & 0o777).toString(8), '600');
  assert.equal(fs.readdirSync(SAN).filter((f) => f.includes('.tmp-')).length, 0,
    'file tạm phải được rename, không bỏ lại');
});

test('A9 readHealth: chưa có file / JSON hỏng / mã lạ -> null, KHÔNG ném', () => {
  assert.equal(readHealth(hp('khong-co.json')), null);
  const p1 = hp('hong.json'); fs.writeFileSync(p1, '{ khong phai json');
  assert.equal(readHealth(p1), null);
  const p2 = hp('malạ.json'); fs.writeFileSync(p2, JSON.stringify({ trangThai: 'XYZ' }));
  assert.equal(readHealth(p2), null);
});

test('A10 file bản CŨ chưa có ghiLuc -> lùi về mtime, không mất nhịp tim', () => {
  const p = hp('cu.json');
  fs.writeFileSync(p, JSON.stringify({
    trangThai: 'OK', lyDo: '', tuLuc: '2020-01-01T00:00:00.000Z', soLanThuLai: 0,
  }));
  const tt = readHealth(p);
  assert.ok(tt.ghiLuc, 'phải có ghiLuc suy ra từ mtime');
  assert.ok(heartbeatAgeMs(tt) < 60_000, 'mtime là vừa xong nên nhịp tim còn tươi');
});

test('A11 describeDuration đọc được bằng tiếng Việt', () => {
  assert.equal(describeDuration(5_000), '5 giây');
  assert.equal(describeDuration(90_000), '1 phút');
  assert.equal(describeDuration(3_600_000), '1 giờ');
  assert.equal(describeDuration(3 * 86_400_000), '3 ngày');
  assert.equal(describeDuration(null), 'không rõ');
});

// ═══════════════════════════════════════════════════════════════════════
// B. judgeHealth() — bộ não của cron. Hàm thuần, test không cần đĩa.
// ═══════════════════════════════════════════════════════════════════════

const CH = cauHinhGia();
const T0 = Date.parse('2026-08-20T10:00:00.000Z');
const tt = (ma, { tuLucMs = T0, ghiLucMs = T0, thu = 0, lyDo = '' } = {}) => ({
  trangThai: ma, lyDo, soLanThuLai: thu,
  tuLuc: new Date(tuLucMs).toISOString(),
  ghiLuc: new Date(ghiLucMs).toISOString(),
});

test('B1 chưa có health.json -> mã CHUA_CHAY, nghiêm trọng', () => {
  const k = judgeHealth(null, CH, T0);
  assert.equal(k.ma, MA.CHUA_CHAY);
  assert.equal(k.nghiemTrong, true);
});

test('B2 OK và nhịp tim tươi -> exit 0, KHÔNG nghiêm trọng', () => {
  const k = judgeHealth(tt('OK'), CH, T0 + 60_000);
  assert.equal(k.ma, MA.OK);
  assert.equal(k.nghiemTrong, false);
});

test('🔴 B3 NHỊP TIM CHẾT thắng cả trạng thái "OK" — ca hỏng câm tệ nhất', () => {
  // Tiến trình chết hẳn: không ai ghi nữa, trangThai đông cứng ở "OK".
  // Nếu chỉ nhìn trangThai thì cron báo khoẻ mạnh trong khi bot đã chết.
  const han = heartbeatDeadlineMs(CH);
  const k = judgeHealth(tt('OK'), CH, T0 + han + 1000);
  assert.equal(k.ma, MA.NHIP_TIM_CHET, 'phải bắt được, không được trả OK');
  assert.equal(k.nghiemTrong, true);
  assert.match(k.tomTat, /NHỊP TIM CHẾT/);
});

test('B4 ngưỡng nhịp tim = 3 chu kỳ watchdog, sàn 15 phút', () => {
  assert.equal(heartbeatDeadlineMs(CH), 900_000, '300s x 3 = 15 phút');
  assert.equal(heartbeatDeadlineMs({ thoiGian: { watchdogMs: 10_000 } }), 900_000,
    'watchdog ngắn bất thường vẫn phải có sàn, không thì báo động giả liên miên');
  assert.equal(heartbeatDeadlineMs({ thoiGian: { watchdogMs: 600_000 } }), 1_800_000);
  assert.equal(heartbeatDeadlineMs({}), 900_000, 'thiếu config -> mặc định');
});

test('B5 CAN_QR -> exit 3, chỉ đúng lệnh phải chạy tay', () => {
  const k = judgeHealth(tt('CAN_QR', { lyDo: 'cookie hỏng' }), CH, T0 + 60_000);
  assert.equal(k.ma, MA.CAN_QR);
  assert.equal(k.nghiemTrong, true);
  assert.match(k.tomTat, /bin\/zalo-login\.js/);
});

test('B6 LISTENER_CHET -> exit 4, nói rõ tin trong khoảng đó MẤT HẲN', () => {
  const k = judgeHealth(tt('LISTENER_CHET'), CH, T0 + 60_000);
  assert.equal(k.ma, MA.LISTENER_CHET);
  assert.match(k.tomTat, /KHÔNG.*ghi lại|không lấy lại được/);
});

test('🔴 B7 DANG_NOI_LAI mới -> IM (exit 0); mắc kẹt -> KÊU (exit 5)', () => {
  // Mạng chớp một cái mà bắn mail ngay thì 10 phút một mail, hai ngày sau
  // không ai đọc mail của nó nữa — cảnh báo thật cũng chìm theo.
  const moi = judgeHealth(tt('DANG_NOI_LAI', { thu: 2 }), CH, T0 + 120_000);
  assert.equal(moi.ma, MA.OK);
  assert.equal(moi.nghiemTrong, false);

  // ⚠️ `ghiLuc` phải TƯƠI: một daemon đang kẹt trong vòng nối lại thì VẪN
  // SỐNG và vẫn ghi health mỗi chu kỳ watchdog. Nếu để ghiLuc cũ luôn thì
  // NHIP_TIM_CHET (mã 7) thắng trước — và nó thắng ĐÚNG, vì lúc đó nghĩa là
  // tiến trình chết hẳn chứ không phải đang nối lại.
  const bayGio = T0 + RECONNECT_DEADLINE_MS + 1000;
  const ket = judgeHealth(
    tt('DANG_NOI_LAI', { thu: 5, ghiLucMs: bayGio - 30_000 }), CH, bayGio);
  assert.equal(ket.ma, MA.NOI_LAI_KET);
  assert.equal(ket.nghiemTrong, true);
  assert.match(ket.tomTat, /MẮC KẸT/);
});

test('🔴 B7b nhịp tim chết THẮNG "đang nối lại" — chết hẳn khác với đang hồi phục', () => {
  // Cùng trạng thái DANG_NOI_LAI, chỉ khác ở chỗ có ai còn ghi health không.
  const bayGio = T0 + RECONNECT_DEADLINE_MS + 1000;
  const chetHan = judgeHealth(tt('DANG_NOI_LAI', { thu: 5 }), CH, bayGio); // ghiLuc cũ
  assert.equal(chetHan.ma, MA.NHIP_TIM_CHET,
    'không ai ghi nữa ⇒ tiến trình chết hẳn, không phải đang nối lại');
});

test('🔴 B8 KHONG_BIET có MÃ RIÊNG, không trùng LISTENER_CHET', () => {
  const k = judgeHealth(tt('KHONG_BIET'), CH, T0 + 60_000);
  assert.equal(k.ma, MA.KHONG_BIET);
  assert.notEqual(k.ma, MA.LISTENER_CHET);
  assert.equal(k.nghiemTrong, true, 'không phải "chết" nhưng vẫn phải cho người biết');
  assert.match(k.tomTat, /KHÔNG phải "đã chết"/);
});

test('B9 mọi mã thoát KHÁC NHAU (cron chỉ đọc được con số này)', () => {
  const v = Object.values(MA);
  assert.equal(new Set(v).size, v.length, JSON.stringify(MA));
  assert.equal(MA.OK, 0);
  assert.equal(MA.CAN_QR, 3, 'trùng quy ước exit 3 của bin/zalo-login.js');
  assert.ok(v.every((x) => Number.isInteger(x) && x >= 0 && x < 126));
});

// ═══════════════════════════════════════════════════════════════════════
// C. notify_host.js — 3 tầng, không hardcode kênh nào
// ═══════════════════════════════════════════════════════════════════════

test('🔴 C1 KHÔNG hardcode kênh nào trong PHẦN CODE của G6', () => {
  // Kiểm trên CODE đã bóc hết chú thích. Nhắc tên kênh trong chú thích là
  // hợp lệ và cần thiết — chỗ giải thích "vì sao KHÔNG phụ thuộc Telegram"
  // buộc phải viết chữ Telegram, và ví dụ "ntfy/webhook" giúp người clone về
  // biết cắm gì vào notifyCommand. Cái phải cấm là kênh nằm trong LOGIC.
  const boChuThich = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // /* … */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');  // // … (chừa "https://")
  // ⚠️ `t\.me` KHÔNG có biên từ sẽ khớp nhầm bên trong `import.meta.url`
  //    (impor-**t.me**-ta.url) — dương tính giả, và nó bắt oan MỌI file ESM.
  //    Phải có `\b` hai đầu.
  const cam = /telegram|\bt\.me\b|\bntfy\b|\bslack\b|\bdiscord\b|webhook|pushover|zapier|https?:\/\//i;
  for (const f of ['src/ops/notify_host.js', 'src/ops/health.js',
                   'bin/zalo-health.js', 'bin/zalo-remind.js']) {
    const code = boChuThich(fs.readFileSync(path.join(process.cwd(), f), 'utf8'));
    const dinh = code.match(cam);
    assert.equal(dinh, null, `${f} có kênh/URL cụ thể trong code: ${dinh?.[0]}`);
  }
});

test('C1b đường ra duy nhất là config.notifyCommand — do NGƯỜI SETUP điền', () => {
  const s = fs.readFileSync(path.join(process.cwd(), 'src/ops/notify_host.js'), 'utf8');
  assert.match(s, /cauHinh\.notifyCommand/, 'phải đọc kênh từ config');

  // Chỉ 2 tiến trình con được phép sinh ra: lệnh của NGƯỜI DÙNG (`sh`), và
  // `osascript` (có sẵn trên macOS, không phải "kênh"). Cái thứ ba nghĩa là
  // đã hardcode một kênh vào pack.
  //
  // ⚠️ Đo bằng HAI cách, cố ý: bản cũ chỉ grep chuỗi trong `spawn('…')`, nên
  // khi tên lệnh chuyển thành biến (để cổng chặn dùng lại được) thì bài test
  // đỏ dù chẳng có gì sai — grep mã nguồn luôn mong manh kiểu đó.
  const chuoiSpawn = [...s.matchAll(/spawn\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chuoiSpawn.sort(), ['sh'], `spawn chuỗi cứng: ${JSON.stringify(chuoiSpawn)}`);
  // Lệnh còn lại đi qua biến -> hỏi thẳng nguồn của biến đó lúc CHẠY. Mạnh hơn
  // grep: nó đo giá trị thật chứ không đo cách viết.
  assert.equal(osascriptArgs('a', 'b').lenh, 'osascript');
  const spawnBien = [...s.matchAll(/spawn\(\s*([A-Za-z_$][\w$]*)\s*,/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(spawnBien)], ['lenh'],
    `chỉ được có MỘT biến lệnh (từ osascriptArgs): ${JSON.stringify(spawnBien)}`);
});

test('C2 primaryHostDm lấy host ĐẦU TIÊN có dmChatId', () => {
  assert.equal(primaryHostDm(cauHinhGia()), 'dm111');
  assert.equal(primaryHostDm(cauHinhGia({ hosts: [] })), null);
});

test('C3 runNotifyCommand: bơm JSON qua STDIN, exit 0 -> thành công', async () => {
  const ra = path.join(SAN, 'nhan.json');
  const kq = await runNotifyCommand(`cat > ${JSON.stringify(ra)}`, { a: 1, thongDiep: 'xin chao' });
  assert.equal(kq.thanhCong, true);
  const j = JSON.parse(fs.readFileSync(ra, 'utf8'));
  assert.equal(j.a, 1);
  assert.equal(j.thongDiep, 'xin chao');
});

test('C4 lệnh thoát khác 0 -> thất bại, KHÔNG ném', async () => {
  const kq = await runNotifyCommand('exit 7', {});
  assert.equal(kq.thanhCong, false);
  assert.equal(kq.ma, 7);
});

test('C5 lệnh TREO bị giết theo hạn, không giữ tiến trình lại mãi', async () => {
  const t = Date.now();
  const kq = await runNotifyCommand('sleep 30', {}, 400);
  assert.equal(kq.thanhCong, false);
  assert.equal(kq.lyDo, 'quá hạn');
  assert.ok(Date.now() - t < 3000, 'phải bị giết chứ không chờ hết 30 giây');
});

test('🔴 C6 thongDiep KHÔNG BAO GIỜ nối vào chuỗi lệnh (chỉ đi qua stdin)', async () => {
  // Nội dung tin nhắn do người ngoài chi phối được. Nối vào chuỗi shell là
  // biến một cảnh báo thành lệnh chạy.
  const bay = path.join(SAN, 'BI_TIEM.txt');
  const doc = path.join(SAN, 'stdin.json');
  await runNotifyCommand(`cat > ${JSON.stringify(doc)}`, {
    thongDiep: `hi"; touch ${bay}; echo "`,
  });
  assert.equal(fs.existsSync(bay), false, 'lệnh tiêm KHÔNG được chạy');
  assert.match(JSON.parse(fs.readFileSync(doc, 'utf8')).thongDiep, /touch/,
    'nội dung vẫn tới nơi nguyên vẹn, chỉ là qua stdin');
});

test('🔴 C7 osNotify TRONG TEST: KHÔNG bắn popup thật, chỉ ghi ý định', async () => {
  // Sự cố thật 20/08/2026: bài này gọi thẳng và CHẠY THẬT ⇒ mỗi lần bất kỳ pane
  // nào chạy `node --test` là macOS bắn popup vào mặt anh, với đúng những chữ
  // đáng sợ nhất trong bộ test ("cookie chết rồi", "listener chết").
  clearBlockedLog();
  const r = await osNotify('t', 'n');
  assert.equal(r, false, 'trong test PHẢI trả false — không có popup nào tới người dùng');
  const dc = getBlockedNotifications();
  assert.equal(dc.length, 1, 'vẫn phải GHI LẠI ý định để kiểm được');
  assert.equal(dc[0].tieuDe, 't');
});

test('🔴 C7b cổng chặn tự nhận biết test — bài viết SAU NÀY không cần nhớ gì', () => {
  // Tín hiệu do CHÍNH Node đặt, không phải biến người viết test tự khai.
  assert.equal(process.env.NODE_TEST_CONTEXT !== undefined, true,
    'node --test phải đặt NODE_TEST_CONTEXT — nền tảng của cổng chặn');
  assert.equal(isRunningTests(), true);
});

test('🔴 C7c bộ test KHÔNG được tự mở cửa thoát', () => {
  assert.notEqual(process.env.ZTL_CHO_PHEP_THONG_BAO_THAT, '1',
    'cửa thoát chỉ dành cho NGƯỜI kiểm bằng mắt, test đặt biến này là quay lại vạch xuất phát');
});

test('C7d VẪN kiểm được đường osascript — soi lệnh sẽ gọi, không gọi thật', () => {
  const { lenh, doiSo } = osascriptArgs('Tiêu "đề"', 'nội dung có dấu " và \'');
  assert.equal(lenh, 'osascript');
  assert.equal(doiSo[0], '-e');
  assert.equal(doiSo[1], OSASCRIPT_SOURCE);
  // ★ Điều đáng kiểm nhất: nội dung đi qua ARGV, KHÔNG nối vào chuỗi AppleScript.
  assert.equal(doiSo[2], 'Tiêu "đề"');
  assert.equal(doiSo[3], 'nội dung có dấu " và \'');
  assert.ok(!OSASCRIPT_SOURCE.includes('Tiêu'), 'kịch bản phải là HẰNG SỐ, không nội suy dữ liệu');
});

test('🔴 C8 tầng 1 (DM Zalo) chạy khi có api — ca chết câm vẫn báo được', async () => {
  const daGui = [];
  const api = { __gia: true };
  // send.js được nạp muộn trong notifyHost; ở đây kiểm qua kết quả trả về.
  const kq = await notifyHost(cauHinhGia(), 'listener chết', {
    api,
    // sendHostDm thật sẽ ném vì api giả -> chứng minh nó CÓ thử tầng 1 rồi mới
    // xuống tầng 2, chứ không bỏ qua.
  });
  assert.ok(kq.chiTiet.some((d) => d.startsWith('tầng 1')), JSON.stringify(kq.chiTiet));
  assert.equal(daGui.length, 0);
});

test('🔴 C9 boTang1 -> KHÔNG đụng Zalo (cron không được tự đăng nhập)', async () => {
  const kq = await notifyHost(cauHinhGia(), 'thử', { api: {}, boTang1: true });
  assert.ok(kq.chiTiet.some((d) => d.includes('tầng 1 bỏ qua: bị tắt')),
    JSON.stringify(kq.chiTiet));
  assert.notEqual(kq.tang, 1);
});

test('C10 không có api -> bỏ tầng 1, xuống tầng 2 qua notifyCommand', async () => {
  const ra = path.join(SAN, 'tang2.json');
  const kq = await notifyHost(
    cauHinhGia({ notifyCommand: `cat > ${JSON.stringify(ra)}` }),
    'cookie chết rồi',
    { boTang1: true },
  );
  assert.equal(kq.tang, 2);
  assert.equal(kq.thanhCong, true);
  const j = JSON.parse(fs.readFileSync(ra, 'utf8'));
  assert.equal(j.thongDiep, 'cookie chết rồi');
  assert.ok(j.luc, 'phải kèm mốc thời gian');
});

test('🔴 C11 tầng 3 (log) LUÔN chạy, kể cả khi tầng khác ăn — nền chứ không phải phương án cuối', async () => {
  const ra = path.join(SAN, 'tang3.json');
  const kq = await notifyHost(
    cauHinhGia({ notifyCommand: `cat > ${JSON.stringify(ra)}` }), 'x', { boTang1: true });
  assert.ok(kq.chiTiet[0].startsWith('tầng 3'), 'tầng 3 phải là việc ĐẦU TIÊN làm');
});

test('🔴 C12 không có đường nào ăn -> ĐÚNG tầng 3, thanhCong=false (không còn "chấp nhận cả hai")', async () => {
  // Bản cũ viết `assert.ok([2,3].includes(kq.tang))` với lý do "trên macOS
  // osascript có thể chạy được". Một bài test chấp nhận cả hai nhánh mà MỘT
  // trong hai nhánh là GỬI THÔNG BÁO THẬT CHO NGƯỜI DÙNG thì đó không phải
  // test, đó là tác dụng phụ — và nó chính là thứ đã bắn popup vào máy anh.
  // Nay cổng chặn làm nhánh đó không tồn tại trong test ⇒ chốt cứng được.
  clearBlockedLog();
  const kq = await notifyHost(cauHinhGia({ notifyCommand: null }), 'x', { boTang1: true });
  assert.equal(kq.tang, 3, 'không có notifyCommand, popup bị chặn ⇒ chỉ còn tầng 3');
  assert.equal(kq.thanhCong, false, 'CẤM tự khai thành công khi chẳng có gì tới tay anh');
  assert.equal(getBlockedNotifications().length, 1, 'vẫn chứng minh được nó CÓ thử tầng 2b');
});

test('🔴 C12b notifyHost đóng dấu KIỂM CHỨNG ĐƯỢC vào thông báo thật', async () => {
  clearBlockedLog();
  await notifyHost(cauHinhGia({ notifyCommand: null }), 'cookie chết rồi', { boTang1: true });
  const { tieuDe, noiDung } = getBlockedNotifications()[0];
  // Trong test thì dấu phải là [GIẢ LẬP] — thông báo giả TUYỆT ĐỐI không được
  // trông như thật, nếu không thì "sói đến rồi" và hôm cookie chết thật anh bỏ qua.
  assert.match(tieuDe, /^\[GIẢ LẬP\]/);
  // Thân tin mang pid + giờ để anh đối chiếu với file pid của daemon.
  assert.match(noiDung, new RegExp(`pid ${process.pid}`));
  assert.match(noiDung, /\d{2}:\d{2}:\d{2}/);
});

test('C12c chạy THẬT (ngoài test) thì tiêu đề mang dấu cảnh báo + giờ, không có [GIẢ LẬP]', () => {
  const goc = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const t = stampReal('Trợ lý Zalo cần xem');
    assert.match(t, /^⚠️ Trợ lý Zalo cần xem · \d{2}:\d{2}$/);
    assert.ok(!t.includes('GIẢ LẬP'));
  } finally {
    if (goc !== undefined) process.env.NODE_TEST_CONTEXT = goc;
  }
});

test('🔴 C12e TRIPWIRE: file MỚI nào sinh tiến trình con cũng phải qua cổng chặn', () => {
  // Cổng `isRunningTests()` chỉ che được những đường ĐÃ BIẾT. Bài này che phần
  // còn lại: ai thêm một tiến trình con ở file mới sẽ làm bài này ĐỎ và buộc
  // phải nghĩ — đúng yêu cầu "bài thứ 6 không được lặp lại y hệt".
  //
  // ⚠️ Đo bằng IMPORT `node:child_process`, KHÔNG grep chữ `exec(`. Bản đầu
  // grep `exec(` và bắt oan 7 file — vì `db.exec(...)` của SQLite và
  // `regex.exec(...)` cũng khớp. File không import child_process thì KHÔNG có
  // cách nào sinh tiến trình con, nên đây là tín hiệu vừa đủ vừa không oan.
  const GOC_PACK = process.cwd();
  const quet = (thuMuc) => {
    const ra = [];
    for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      if (m.name === 'node_modules' || m.name.startsWith('.')) continue;
      const f = path.join(thuMuc, m.name);
      if (m.isDirectory()) ra.push(...quet(f));
      else if (m.name.endsWith('.js')) ra.push(f);
    }
    return ra;
  };
  const dinh = [];
  for (const f of [...quet(path.join(GOC_PACK, 'src')), ...quet(path.join(GOC_PACK, 'bin'))]) {
    if (/from\s+'node:child_process'|require\(\s*'node:child_process'\s*\)/.test(fs.readFileSync(f, 'utf8'))) {
      dinh.push(path.relative(GOC_PACK, f));
    }
  }
  assert.deepEqual(dinh.sort(), [
    // ⚠️ Thêm 22/08/2026 — bài này đã ĐỎ đúng lúc `bin/cai-dat.js` ra đời, tức
    // tripwire làm đúng việc của nó. Hai đường sinh tiến trình con ở đó:
    //   · mở ảnh QR      -> ĐÃ chốt cổng `isRunningTests()`, cùng khuôn zalo-login
    //   · chạy `init-db` -> tiến trình con NODE có chủ đích, ⛔ KHÔNG chạm màn
    //     hình. Cố ý spawn thay vì `import`: init-db là script, nạp bằng import
    //     là chạy luôn `main()` + `process.exit` của nó trong tiến trình cài đặt.
    'bin/cai-dat.js',
    'bin/check-syntax.js',      // công cụ dev, chỉ chạy `node --check`
    'bin/zalo-login.js',        // mở ảnh QR — ĐÃ có cổng isRunningTests()
    'src/ops/notify_host.js',   // notifyCommand của người dùng + osascript — ĐÃ có cổng
  ], `File MỚI sinh tiến trình con: ${JSON.stringify(dinh)}. `
    + 'Thêm cổng isRunningTests() rồi mới thêm tên vào danh sách này.');
});

test('🔴 C12d RÀ CÙNG HỌ: mở ảnh QR cũng bị chặn trong test (không bật Preview lên màn hình)', async () => {
  const { openImageWithOs } = await import('../bin/zalo-login.js');
  assert.equal(openImageWithOs('/tmp/khong-co-that.png'), false,
    'đây cũng là một đường CHẠM RA NGOÀI tiến trình — cùng họ với popup osascript');
});

test('C13 notifyHost redact thông điệp trước khi đưa ra ngoài', async () => {
  const ra = path.join(SAN, 'redact.json');
  await notifyHost(cauHinhGia({ notifyCommand: `cat > ${JSON.stringify(ra)}` }),
    'lỗi Cookie: zpsid=RAT_BI_MAT_999', { boTang1: true });
  assert.ok(!fs.readFileSync(ra, 'utf8').includes('RAT_BI_MAT_999'));
});

// ═══════════════════════════════════════════════════════════════════════
// D. zalo-remind — lịch nằm trong crontab, không đẻ định dạng mới
// ═══════════════════════════════════════════════════════════════════════

test('D1 reminderBody: --text, --tu-file, và các ca từ chối', () => {
  assert.equal(reminderBody({ text: '  xin chao  ', tuFile: null }), 'xin chao');
  const f = path.join(SAN, 'nhac.txt');
  fs.writeFileSync(f, '\nNhac hop 3h\n');
  assert.equal(reminderBody({ text: null, tuFile: f }), 'Nhac hop 3h');
  assert.throws(() => reminderBody({ text: 'a', tuFile: f }), /MỘT trong hai/);
  assert.throws(() => reminderBody({ text: '   ', tuFile: null }), /rỗng/);
  assert.throws(() => reminderBody({ text: null, tuFile: null }), /rỗng/);
  assert.throws(() => reminderBody({ text: null, tuFile: hp('khong-co.txt') }), /Không thấy file/);
});

test('🔴 D2 mặc định gửi DM host, KHÔNG phải nhóm (lịch cá nhân không vào nhóm)', () => {
  const d = pickTarget(cauHinhGia(), { nhom: null, host: null });
  assert.equal(d.loai, 'dm');
  assert.equal(d.chatId, 'dm111');
});

test('D3 --host chọn đúng người; host lạ bị từ chối', () => {
  assert.equal(pickTarget(cauHinhGia(), { nhom: null, host: '222' }).chatId, 'dm222');
  assert.throws(() => pickTarget(cauHinhGia(), { nhom: null, host: '999' }), /không có trong config/);
});

test('🔴 D4 --nhom LẠ bị từ chối (allowlist áp cho cả chiều GỬI RA)', () => {
  assert.equal(pickTarget(cauHinhGia(), { nhom: 'g1', host: null }).chatId, 'g1');
  assert.throws(() => pickTarget(cauHinhGia(), { nhom: 'nhom-la', host: null }),
    /không có trong config\.groups/);
});

test('D5 hosts rỗng / thiếu dmChatId -> báo rõ cách sửa', () => {
  assert.throws(() => pickTarget(cauHinhGia({ hosts: [] }), { nhom: null, host: null }),
    /hosts\[\] rỗng/);
  assert.throws(
    () => pickTarget(cauHinhGia({ hosts: [{ userId: '111', ten: 'x', dmChatId: '' }] }),
      { nhom: null, host: null }),
    /dmChatId/);
});

test('🔴 D5b truncateSafely trả OBJECT chứ không phải chuỗi — và remind KHÔNG cắt hai lần', async () => {
  // Bug thật, bắt được bằng chạy CLI chứ unit test không thấy: `truncateSafely()`
  // trả `{text, daCat, originalLength}`, dùng như chuỗi thì `.slice` không tồn tại
  // và script chết đúng ở bước cuối.
  const { truncateSafely } = await import('../src/zalo/send.js');
  const r = truncateSafely('abc', 100);
  assert.equal(typeof r, 'object');
  assert.equal(typeof r.text, 'string');
  assert.equal(r.daCat, false);
  assert.equal(truncateSafely('x'.repeat(500), 100).daCat, true);

  // Và bước GỬI (send.js) đã tự cắt rồi ⇒ remind phải truyền NGUYÊN VĂN,
  // không thì dán hai lần cái đuôi "…[cắt bớt]".
  const s = fs.readFileSync(path.join(process.cwd(), 'bin/zalo-remind.js'), 'utf8');
  assert.match(s, /sendHostDm\(api, dich\.chatId, noiDung\)/,
    'phải truyền noiDung gốc, không truyền bản đã cắt');
  assert.match(s, /sendToGroup\(api, dich\.chatId, noiDung\)/);
});

test('D6 mã thoát của remind khác nhau và OK = 0', () => {
  const v = Object.values(MA_REMIND);
  assert.equal(new Set(v).size, v.length);
  assert.equal(MA_REMIND.OK, 0);
  assert.equal(MA_REMIND.CAN_QR, 3, 'giữ chung quy ước exit 3 với login/health');
});

test.after(() => fs.rmSync(SAN, { recursive: true, force: true }));
