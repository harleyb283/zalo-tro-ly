/**
 * G1 — nghiệm thu src/zalo/session.js. Chạy: node --test
 *
 * ⛔ KHÔNG đăng nhập Zalo thật. Dùng `api` giả duck-typed theo ĐÚNG chữ ký đã
 *    đọc từ mã nguồn zca-js@2.1.2 trong node_modules.
 *
 * Có một nhóm test đối chiếu THẲNG với thư viện đã cài (enum UpdateSettingsType,
 * chữ ký Zalo.prototype). Nhóm đó sẽ GÃY nếu ai nâng zca-js mà đổi hợp đồng —
 * đúng là điều ta muốn biết, thay vì phát hiện lúc chạy thật.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readSession, saveSession, keepAlive, applyHiddenStatus,
  fetchSelfInfo, fetchGroupList, currentCookie,
  loginWithCookie, zaloClientOptions, ZaloSessionError, SESSION_VERSION,
} from '../src/zalo/session.js';
import { TRANG_THAI_SUC_KHOE } from '../src/lib/hang_so.js';

// ── sân chơi tạm, NGOÀI project ────────────────────────────────────────
const SAN = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-g1-'));
const duongDanSession = (ten = 'session.json') => path.join(SAN, ten);

const COOKIE_GIA = [
  { key: 'zpsid', value: 'gia-lap-khong-phai-that', domain: 'chat.zalo.me', path: '/' },
];
const PHIEN_GIA = {
  cookie: COOKIE_GIA,
  imei: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0123456789abcdef0123456789abcdef',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  language: 'vi',
  userId: '9990000001',
  ten: 'Nguoi Dung Gia',
};

/** api giả — chỉ có đúng những phương thức session.js dùng. */
function taoApiGia(ghiDe = {}) {
  const nhatKy = [];
  const api = {
    nhatKy,
    getOwnId: () => '9990000000001',
    fetchAccountInfo: async () => ({ profile: { displayName: 'Trợ Lý Zalo', zaloName: 'troly' } }),
    keepAlive: async () => ({ config_vesion: 1 }),
    updateSettings: async (loai, giaTri) => { nhatKy.push(['updateSettings', loai, giaTri]); return ''; },
    getAllGroups: async () => ({ version: '1', gridVerMap: { 111: 'a', 222: 'b' } }),
    getGroupInfo: async (ids) => ({
      gridInfoMap: Object.fromEntries(
        [].concat(ids).map((g) => [g, { groupId: String(g), name: `Nhom ${g}` }]),
      ),
    }),
    getCookie: () => ({ toJSON: () => ({ cookies: COOKIE_GIA }) }),
    getContext: () => ({ uid: '9990000000001', imei: PHIEN_GIA.imei, userAgent: PHIEN_GIA.userAgent }),
    ...ghiDe,
  };
  return api;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Tuỳ chọn khởi tạo — hai cờ CHỐNG HỎNG CÂM
// ═══════════════════════════════════════════════════════════════════════

test('🔴 zaloClientOptions tắt logging (console.log của zca-js đi thẳng vào stdout = kênh MCP)', () => {
  const t = zaloClientOptions();
  assert.equal(t.logging, false, 'logging PHẢI false — mặc định của thư viện là true');
  assert.equal(t.checkUpdate, false, 'checkUpdate PHẢI false — nó gọi mạng npm + log stdout mỗi lần login');
  assert.equal(t.selfListen, true, 'selfListen PHẢI true — spec là lưu TOÀN BỘ lịch sử, gồm tin của chính mình');
});

test('🔴 đối chiếu với zca-js ĐÃ CÀI: mặc định của thư viện đúng là thứ ta phải ghi đè', () => {
  // `zca-js` khoá "exports" chỉ cho import từ gốc gói ⇒ không import được
  // dist/context.js. Đọc thẳng file trên đĩa: vẫn là đối chiếu với thư viện
  // THẬT đang cài, không phải chép từ tài liệu.
  const goc = path.join(process.cwd(), 'node_modules', 'zca-js', 'dist');
  const ctx = fs.readFileSync(path.join(goc, 'context.js'), 'utf8');
  assert.match(ctx, /logging:\s*true/, 'mặc định logging của thư viện là true — nên ta phải tắt');
  assert.match(ctx, /checkUpdate:\s*true/);
  assert.match(ctx, /selfListen:\s*false/);

  // Và đây là lý do phải tắt: logger ghi bằng console.log = STDOUT = kênh MCP.
  const utils = fs.readFileSync(path.join(goc, 'utils.js'), 'utf8');
  assert.match(utils, /export const logger[\s\S]{0,400}console\.log/,
    'logger của zca-js vẫn dùng console.log ⇒ luật logging:false còn nguyên giá trị');

  // Và login() luôn bắn một dòng log, kể cả khi mọi thứ bình thường.
  const zalo = fs.readFileSync(path.join(goc, 'zalo.js'), 'utf8');
  assert.match(zalo, /logger\(ctx\)\.info\("Logged in as"/);
});

test('🔴 zca-js KHÔNG in QR ra terminal — nó ghi file PNG (căn cứ để KHÔNG xin cài thêm gói)', () => {
  const qr = fs.readFileSync(
    path.join(process.cwd(), 'node_modules', 'zca-js', 'dist', 'apis', 'loginQR.js'), 'utf8',
  );
  assert.match(qr, /writeFile\(filepath,\s*imageData,\s*"base64"\)/, 'QR được ghi ra file ảnh');
  assert.match(qr, /qrPath\s*=\s*.*"qr\.png"/,
    'mặc định của thư viện là "qr.png" trong cwd ⇒ ta BẮT BUỘC phải truyền qrPath ra ngoài project');
  assert.ok(!/qrcode-terminal|toString\(\)\s*\/\/\s*ascii/.test(qr), 'không có đường in QR dạng chữ');
});

test('🔴 IMEI sinh NGẪU NHIÊN — mất là phải quét QR lại, nên phải lưu cùng cookie', () => {
  const utils = fs.readFileSync(
    path.join(process.cwd(), 'node_modules', 'zca-js', 'dist', 'utils.js'), 'utf8',
  );
  assert.match(utils, /generateZaloUUID\(userAgent\)\s*\{[\s\S]{0,120}randomUUID\(\)/,
    'nếu đổi thành hàm tất định thì xem lại chú thích trong session.js');
});

// ═══════════════════════════════════════════════════════════════════════
// 2. File phiên — quyền 0600 + vòng ghi/đọc
// ═══════════════════════════════════════════════════════════════════════

test('🔴 saveSession đặt quyền 0600 NGAY LÚC TẠO (cookie Zalo lộ = mất tài khoản)', async () => {
  const p = duongDanSession('quyen.json');
  await saveSession(p, PHIEN_GIA);
  const che = fs.statSync(p).mode & 0o777;
  assert.equal(che.toString(8), '600', `quyền phải là 0600, đang là 0${che.toString(8)}`);
});

test('ghi rồi đọc lại giữ nguyên cookie/imei/userAgent', async () => {
  const p = duongDanSession('vong.json');
  await saveSession(p, PHIEN_GIA);
  const doc = await readSession(p);
  assert.equal(doc.imei, PHIEN_GIA.imei);
  assert.equal(doc.userAgent, PHIEN_GIA.userAgent);
  assert.deepEqual(doc.cookie, COOKIE_GIA);
  assert.equal(doc.phienBan, SESSION_VERSION);
  assert.ok(doc.taoLuc && doc.capNhat, 'phải có mốc thời gian');
});

test('ghi đè giữ nguyên taoLuc, chỉ đổi capNhat', async () => {
  const p = duongDanSession('motoc.json');
  await saveSession(p, PHIEN_GIA);
  const lan1 = await readSession(p);
  await saveSession(p, { ...PHIEN_GIA, ten: 'Ten Moi' });
  const lan2 = await readSession(p);
  assert.equal(lan2.taoLuc, lan1.taoLuc, 'taoLuc là mốc quét QR đầu tiên, không được đổi');
  assert.equal(lan2.ten, 'Ten Moi');
});

test('saveSession TỪ CHỐI ghi phiên khuyết (thà không có còn hơn có mà chết câm)', async () => {
  const p = duongDanSession('khuyet.json');
  await assert.rejects(() => saveSession(p, { cookie: COOKIE_GIA, imei: 'x' }), /thiếu cookie \/ imei \/ userAgent/);
  await assert.rejects(() => saveSession(p, { ...PHIEN_GIA, cookie: null }), /thiếu/);
  assert.equal(fs.existsSync(p), false, 'không được để lại file rác');
});

test('readSession: chưa có file → null (không ném lỗi)', async () => {
  assert.equal(await readSession(duongDanSession('khong-ton-tai.json')), null);
});

test('🔴 readSession coi phiên THIẾU MẢNH là chưa có phiên, không phải lỗi', async () => {
  // Thiếu imei là cookie thành rác — IMEI sinh ngẫu nhiên, không tái tạo được.
  const p = duongDanSession('thieu-imei.json');
  fs.writeFileSync(p, JSON.stringify({ cookie: COOKIE_GIA, userAgent: 'x' }));
  assert.equal(await readSession(p), null);

  const p2 = duongDanSession('cookie-rong.json');
  fs.writeFileSync(p2, JSON.stringify({ ...PHIEN_GIA, cookie: [] }));
  assert.equal(await readSession(p2), null);
});

test('readSession: JSON hỏng → ném lỗi có nêu đường dẫn', async () => {
  const p = duongDanSession('hong.json');
  fs.writeFileSync(p, '{ khong phai json');
  await assert.rejects(() => readSession(p), /File phiên hỏng/);
});

test('🔴 dấu ~ trong đường dẫn được NỞ, không tạo thư mục tên "~" trong repo', async () => {
  const p = await readSession('~/khong-bao-gio-ton-tai-ztl-test.json');
  assert.equal(p, null);
  assert.equal(fs.existsSync(path.join(process.cwd(), '~')), false, 'KHÔNG được có thư mục "~" trong cwd');
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Đăng nhập bằng cookie — nhánh KHÔNG chạm mạng
// ═══════════════════════════════════════════════════════════════════════

test('🔴 chưa có phiên → ZaloSessionError mang maSucKhoe CAN_QR, KHÔNG tự mở QR', async () => {
  const cauHinh = { duongDan: { session: duongDanSession('chua-co.json') } };
  await assert.rejects(
    () => loginWithCookie(cauHinh),
    (e) => {
      assert.ok(e instanceof ZaloSessionError, 'phải là ZaloSessionError để G8 khỏi dò chuỗi');
      assert.equal(e.maSucKhoe, TRANG_THAI_SUC_KHOE.CAN_QR);
      assert.match(e.message, /bin\/zalo-login\.js/, 'phải chỉ đúng lệnh phải chạy');
      return true;
    },
  );
});

test('thiếu cauHinh.duongDan.session → báo rõ, không đoán mặc định', async () => {
  await assert.rejects(() => loginWithCookie({}), /thiếu cauHinh\.duongDan\.session/);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. keepAlive / ẩn trạng thái / tra cứu — dùng api giả
// ═══════════════════════════════════════════════════════════════════════

test('keepAlive: OK → true; ném lỗi → false (không làm chết luồng)', async () => {
  assert.equal(await keepAlive(taoApiGia()), true);
  const hong = taoApiGia({ keepAlive: async () => { throw new Error('mất mạng'); } });
  assert.equal(await keepAlive(hong), false);
});

test('🔴 applyHiddenStatus(bat=true) gọi ĐÚNG 2 cài đặt với giá trị 0', async () => {
  const api = taoApiGia();
  await applyHiddenStatus(api, true);
  const goi = api.nhatKy.filter((x) => x[0] === 'updateSettings');
  assert.equal(goi.length, 2);
  assert.deepEqual(goi.map((x) => x[1]).sort(), ['display_seen_status', 'show_online_status']);
  assert.ok(goi.every((x) => x[2] === 0), 'giá trị phải là 0 = ẩn');
});

test('🔴 applyHiddenStatus(bat=false) KHÔNG đụng cài đặt tài khoản của người dùng', async () => {
  const api = taoApiGia();
  await applyHiddenStatus(api, false);
  assert.equal(api.nhatKy.length, 0, 'không được tự bật lại "hiện online" cho tài khoản người ta');
});

test('ẩn trạng thái thất bại thì CẢNH BÁO chứ không ném (trợ lý vẫn phải chạy)', async () => {
  const api = taoApiGia({ updateSettings: async () => { throw new Error('Zalo từ chối'); } });
  await assert.doesNotReject(() => applyHiddenStatus(api, true));
});

test('🔴 enum UpdateSettingsType của zca-js ĐÃ CÀI đúng như code giả định', async () => {
  const { UpdateSettingsType } = await import('zca-js');
  assert.equal(UpdateSettingsType.ShowOnlineStatus, 'show_online_status');
  assert.equal(UpdateSettingsType.DisplaySeenStatus, 'display_seen_status');
});

test('fetchSelfInfo trả userId dạng CHUỖI + tên hiển thị', async () => {
  const tt = await fetchSelfInfo(taoApiGia());
  assert.equal(typeof tt.userId, 'string', 'ID phải là chuỗi — đã qua toId()');
  assert.equal(tt.userId, '9990000000001');
  assert.equal(tt.ten, 'Trợ Lý Zalo');
});

test('không lấy được tên thì vẫn trả userId (tên chỉ là phụ)', async () => {
  const api = taoApiGia({ fetchAccountInfo: async () => { throw new Error('lỗi mạng'); } });
  const tt = await fetchSelfInfo(api);
  assert.equal(tt.userId, '9990000000001');
  assert.equal(tt.ten, '');
});

test('không đọc được getOwnId → ném lỗi rõ ràng', async () => {
  await assert.rejects(
    () => fetchSelfInfo(taoApiGia({ getOwnId: () => null })),
    /Không đọc được user_id/,
  );
});

test('🔴 fetchGroupList KÈM TÊN (getAllGroups một mình chỉ ra toàn số)', async () => {
  const ds = await fetchGroupList(taoApiGia());
  assert.equal(ds.length, 2);
  assert.deepEqual(ds.map((x) => x.chatId).sort(), ['111', '222']);
  assert.ok(ds.every((x) => x.ten.startsWith('Nhom ')), 'phải có tên, không chỉ ID');
});

test('getGroupInfo hỏng → vẫn trả ID để còn chép vào config, chỉ mất tên', async () => {
  const api = taoApiGia({ getGroupInfo: async () => { throw new Error('429'); } });
  const ds = await fetchGroupList(api);
  assert.equal(ds.length, 2);
  assert.ok(ds.every((x) => x.ten === ''));
});

test('không có nhóm nào → mảng rỗng, không ném', async () => {
  const api = taoApiGia({ getAllGroups: async () => ({ gridVerMap: {} }) });
  assert.deepEqual(await fetchGroupList(api), []);
});

test('getAllGroups hỏng → ném lỗi ĐÃ QUA redact', async () => {
  const api = taoApiGia({
    getAllGroups: async () => { throw new Error('fail Cookie: zpsid=SIEU_BI_MAT_123'); },
  });
  await assert.rejects(() => fetchGroupList(api), (e) => {
    assert.match(e.message, /Không lấy được danh sách nhóm/);
    assert.ok(!e.message.includes('SIEU_BI_MAT_123'), 'cookie KHÔNG được lọt vào thông điệp lỗi');
    return true;
  });
});

test('currentCookie: lấy được → mảng; api hỏng → null, không ném', () => {
  assert.deepEqual(currentCookie(taoApiGia()), COOKIE_GIA);
  assert.equal(currentCookie({ getCookie: () => { throw new Error('x'); } }), null);
  assert.equal(currentCookie({ getCookie: () => ({ toJSON: () => ({ cookies: [] }) }) }), null);
});

test.after(() => {
  fs.rmSync(SAN, { recursive: true, force: true });
});
