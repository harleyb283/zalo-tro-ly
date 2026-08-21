/**
 * ═══════════════════════════════════════════════════════════════════════
 * TRUY VỤ "BÁO QUÉT QR OAN" (20/08/2026)
 *
 * Anh thấy hệ thỉnh thoảng báo "cần quét QR" TRONG KHI Zalo vẫn kết nối bình
 * thường. Truy ra: nhiều chỗ trong pack đang dịch **bốn trạng thái khác hẳn
 * nhau** thành cùng một câu:
 *     ① daemon không chạy   ② chưa từng đăng nhập   ③ đang khởi động lại
 *     ④ cookie CHẾT THẬT  ← chỉ ca này mới cần quét QR
 *
 * 🔴 Vì sao kêu oan KHÔNG vô hại: tài khoản Zalo chỉ có MỘT suất "máy tính",
 * nên quét QR khi phiên còn sống sẽ ĐÁ VĂNG chính phiên đó. Lời khuyên sai
 * biến một trục trặc thoáng qua thành sự cố thật.
 *
 * File này canh đúng ranh giới đó. KHÔNG mạng, KHÔNG đăng nhập Zalo.
 *     node --test test/bao_qr_oan.test.js
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  phanLoaiLoiDangNhap, loiDangNhapThatBai, dangNhapBangCookie,
} from '../src/zalo/session.js';
import { daemonDangChay, duongDanPid, ghiTrangThai, docTrangThai } from '../src/ops/health.js';
import { phanDinh, MA } from '../bin/zalo-health.js';
import { taoWatchdog, WS } from '../src/zalo/watchdog.js';
import { main as remindMain, MA as MA_REMIND } from '../bin/zalo-remind.js';
import { TRANG_THAI_SUC_KHOE } from '../src/lib/hang_so.js';

const SAN = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-qr-'));
const sp = (t) => path.join(SAN, t);

function cauHinhGia(ghiDe = {}) {
  const thuMuc = fs.mkdtempSync(path.join(SAN, 'ch-'));
  return {
    hosts: [{ userId: '111', ten: 'Chu nha', dmChatId: 'dm111' }],
    groups: [{ chatId: 'g1', ten: 'Nhom 1', ghiLichSu: true, traLoiKhiTag: true }],
    duongDan: {
      db: path.join(thuMuc, 'lichsu.db'),
      session: path.join(thuMuc, 'session.json'),
      health: path.join(thuMuc, 'health.json'),
    },
    thoiGian: { keepAliveMs: 120000, watchdogMs: 300000, imLangMs: 900000, queueTtlMs: 1800000 },
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    notifyCommand: null,
    anTrangThai: true,
    ...ghiDe,
  };
}

const ttGia = (ma, { tuLuc = Date.now(), lyDo = '' } = {}) => ({
  trangThai: ma, lyDo, soLanThuLai: 0,
  tuLuc: new Date(tuLuc).toISOString(),
  ghiLuc: new Date(Date.now()).toISOString(),
});

// ═══ A. Phân loại lỗi đăng nhập: MẠNG ≠ COOKIE CHẾT ═══
test('A1 lỗi MẠNG được nhận ra qua mã lỗi hệ thống', () => {
  for (const ma of ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN']) {
    const e = Object.assign(new Error('gì đó'), { code: ma });
    assert.equal(phanLoaiLoiDangNhap(e), 'TAM_THOI', ma);
  }
});

test('A2 lỗi MẠNG nhận ra qua lời văn (thư viện hay nuốt mã lỗi)', () => {
  for (const s of ['fetch failed', 'socket hang up', 'request timed out', 'Bad Gateway',
    'HTTP status 503', 'network error']) {
    assert.equal(phanLoaiLoiDangNhap(new Error(s)), 'TAM_THOI', s);
  }
});

test('A3 lỗi KHÔNG có dấu hiệu mạng -> XAC_THUC (nghiêng về phía nhắc anh, không im lặng)', () => {
  // zca-js ném đúng một câu "Đăng nhập thất bại" cho mọi nguyên nhân xác thực.
  assert.equal(phanLoaiLoiDangNhap(new Error('Đăng nhập thất bại')), 'XAC_THUC');
  assert.equal(phanLoaiLoiDangNhap(new Error('')), 'XAC_THUC');
  assert.equal(phanLoaiLoiDangNhap(null), 'XAC_THUC');
});

test('🔴 A4 lỗi mạng -> KHONG_BIET và câu chữ CẤM quét QR', () => {
  const loi = loiDangNhapThatBai(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }));
  assert.equal(loi.maSucKhoe, TRANG_THAI_SUC_KHOE.KHONG_BIET,
    'mạng chớp mà ghi CAN_QR là đẩy anh đi quét QR oan');
  assert.match(loi.message, /ĐỪNG quét QR/);
  assert.match(loi.message, /CHƯA KẾT LUẬN/);
  assert.ok(!/Cách xử lý: chạy TAY/.test(loi.message),
    'không được dán bài "cookie đã chết" vào một lỗi mạng');
});

test('A5 lỗi xác thực -> CAN_QR, giữ nguyên bài giải thích cookie chết', () => {
  const loi = loiDangNhapThatBai(new Error('Đăng nhập thất bại'));
  assert.equal(loi.maSucKhoe, TRANG_THAI_SUC_KHOE.CAN_QR);
  assert.match(loi.message, /bind theo ĐỊA CHỈ IP/);
});

test('🔴 A6 CHƯA TỪNG đăng nhập -> vẫn CAN_QR (đúng) nhưng KHÔNG được nói "cookie chết"', async () => {
  const ch = cauHinhGia();
  await assert.rejects(
    () => dangNhapBangCookie(ch),
    (e) => {
      assert.equal(e.maSucKhoe, TRANG_THAI_SUC_KHOE.CAN_QR);
      assert.match(e.message, /CHƯA TỪNG ĐĂNG NHẬP/);
      assert.match(e.message, /KHÔNG phải cookie hết hạn/);
      return true;
    },
  );
});

// ═══ B. Đọc tiến trình daemon — dữ kiện tách ① và ③ khỏi ④ ═══
test('B1 pid trỏ tiến trình ĐANG SỐNG -> song=true', () => {
  const ch = cauHinhGia();
  fs.mkdirSync(path.dirname(ch.duongDan.db), { recursive: true });
  fs.writeFileSync(duongDanPid(ch), String(process.pid));
  const d = daemonDangChay(ch);
  assert.equal(d.song, true);
  assert.equal(d.pid, process.pid);
});

test('B2 KHÔNG có file pid -> song=false (chưa chạy / đã thoát sạch)', () => {
  assert.equal(daemonDangChay(cauHinhGia()).song, false);
});

test('B3 pid mồ côi (tiến trình đã chết) -> song=false', () => {
  const ch = cauHinhGia();
  fs.mkdirSync(path.dirname(ch.duongDan.db), { recursive: true });
  // pid rất lớn, gần như chắc chắn không tồn tại
  fs.writeFileSync(duongDanPid(ch), '4194303');
  const d = daemonDangChay(ch);
  assert.equal(d.song, false);
  assert.match(d.lyDo, /mồ côi/);
});

test('B4 file pid rác -> song=null (KHÔNG BIẾT), tuyệt đối không đoán bừa', () => {
  const ch = cauHinhGia();
  fs.mkdirSync(path.dirname(ch.duongDan.db), { recursive: true });
  fs.writeFileSync(duongDanPid(ch), 'không phải số');
  assert.equal(daemonDangChay(ch).song, null);
});

// ═══ C. ★ Ca chính anh gặp: health nói CAN_QR mà daemon vẫn chạy ═══
test('🔴 C1 CAN_QR + daemon ĐANG CHẠY -> KHÔNG hô quét QR, không nghiêm trọng, exit 0', () => {
  const k = phanDinh(ttGia('CAN_QR', { lyDo: 'cookie hỏng' }), cauHinhGia(), Date.now(),
    { song: true, pid: 123, lyDo: 'tiến trình 123 đang chạy' });
  assert.equal(k.nghiemTrong, false, 'đây là trạng thái CŨ còn sót, không phải sự cố đang diễn ra');
  assert.equal(k.ma, MA.OK);
  assert.match(k.tomTat, /ĐỪNG quét QR/);
  assert.match(k.tomTat, /TRẠNG THÁI CŨ/);
});

test('C2 CAN_QR + daemon KHÔNG chạy -> đúng là cần quét QR, exit 3', () => {
  const k = phanDinh(ttGia('CAN_QR'), cauHinhGia(), Date.now(),
    { song: false, pid: null, lyDo: 'không có file pid' });
  assert.equal(k.ma, MA.CAN_QR);
  assert.equal(k.nghiemTrong, true);
  assert.match(k.tomTat, /bin\/zalo-login\.js/);
});

test('C3 KHÔNG truyền tiến trình -> giữ nguyên hành vi cũ (không phá bài test có sẵn)', () => {
  const k = phanDinh(ttGia('CAN_QR'), cauHinhGia(), Date.now());
  assert.equal(k.ma, MA.CAN_QR);
});

test('🔴 C4 chưa có health.json + daemon ĐANG CHẠY -> "đang khởi động", KHÔNG phải "chưa từng chạy"', () => {
  const k = phanDinh(null, cauHinhGia(), Date.now(), { song: true, pid: 9, lyDo: 'tiến trình 9 đang chạy' });
  assert.match(k.tomTat, /ĐANG KHỞI ĐỘNG/);
  assert.match(k.tomTat, /KHÔNG cần quét QR/);
});

test('C5 chưa có health.json + daemon KHÔNG chạy -> nói rõ đây không phải bằng chứng cookie chết', () => {
  const k = phanDinh(null, cauHinhGia(), Date.now(), { song: false, pid: null, lyDo: 'x' });
  assert.equal(k.ma, MA.CHUA_CHAY);
  assert.match(k.tomTat, /KHÔNG phải bằng chứng cookie chết/);
});

// ═══ D. Watchdog: 5 lần hỏng vì MẠNG ≠ cookie chết ═══
/** Watchdog với websocket ĐÃ ĐÓNG -> `motNhip()` sẽ chạy trọn vòng nối lại. */
function wdHong(khiCanNoiLai) {
  const ghi = [];
  const wd = taoWatchdog({
    api: () => ({ listener: { ws: { readyState: WS.CLOSED } } }),
    cauHinh: cauHinhGia(),
    backoffMs: [1, 1, 1, 1, 1],
    ghiSucKhoe: (tt) => ghi.push(tt),
    khiCanNoiLai,
    khiHetCach: () => {},
  });
  return { wd, ghi };
}

test('🔴 D1 nối lại 5 lần đều hỏng vì MẠNG -> KHONG_BIET, không phải CAN_QR', async () => {
  const { wd, ghi } = wdHong(async () => {
    throw Object.assign(new Error('x'), { code: 'ENOTFOUND' });
  });
  await wd.motNhip();
  const cuoi = ghi.at(-1);
  assert.equal(cuoi.trangThai, TRANG_THAI_SUC_KHOE.KHONG_BIET,
    'mất mạng 15 phút cũng cho đúng 5 lần hỏng — kết luận cookie chết là kêu oan');
  assert.match(cuoi.lyDo, /ĐỪNG quét QR/);
  wd.dung();
});

test('🔴 D3 khiHetCach NHẬN ĐƯỢC mã đã phán, để caller khỏi DM câu "quét QR" cứng', async () => {
  const nhan = [];
  const wd = taoWatchdog({
    api: () => ({ listener: { ws: { readyState: WS.CLOSED } } }),
    cauHinh: cauHinhGia(),
    backoffMs: [1, 1, 1, 1, 1],
    ghiSucKhoe: () => {},
    khiCanNoiLai: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); },
    khiHetCach: (ma, toanLoiMang) => { nhan.push([ma, toanLoiMang]); },
  });
  await wd.motNhip();
  assert.deepEqual(nhan, [[TRANG_THAI_SUC_KHOE.KHONG_BIET, true]],
    'thiếu tham số này thì index.js buộc phải đoán, và nó đang đoán SAI');
  wd.dung();
});

test('D2 có ít nhất một lần hỏng KHÔNG do mạng -> vẫn CAN_QR như cũ', async () => {
  let lan = 0;
  const { wd, ghi } = wdHong(async () => {
    lan += 1;
    throw lan === 3
      ? new Error('Đăng nhập thất bại')
      : Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
  });
  await wd.motNhip();
  assert.equal(ghi.at(-1).trangThai, TRANG_THAI_SUC_KHOE.CAN_QR);
  wd.dung();
});

// ═══ E. Lịch sử đổi trạng thái — để lần sau khỏi phải đoán ═══
test('E1 ĐỔI mã thì ghi một dòng lịch sử; nhịp tim cùng mã thì KHÔNG ghi thêm', () => {
  const h = sp(`lich-su-${Date.now()}.json`);
  const nk = path.join(path.dirname(h), 'health-history.log');
  const truoc = fs.existsSync(nk) ? fs.readFileSync(nk, 'utf8').split('\n').length : 0;

  ghiTrangThai(h, { trangThai: 'OK', lyDo: 'khởi động xong' });
  ghiTrangThai(h, { trangThai: 'OK', lyDo: 'nhịp tim' });
  ghiTrangThai(h, { trangThai: 'CAN_QR', lyDo: 'cookie hỏng' });

  const dong = fs.readFileSync(nk, 'utf8').trim().split('\n');
  assert.equal(dong.length - Math.max(0, truoc - 1), 2, 'đúng 2 lần ĐỔI mã, nhịp tim không ghi');
  assert.match(dong[dong.length - 1], /OK\t->\tCAN_QR/);
});

// ═══ F. zalo-remind: KHÔNG đăng nhập lần hai khi daemon còn sống ═══
test('🔴 F1 daemon đang chạy -> TỪ CHỐI gửi, KHÔNG đăng nhập lần hai', async () => {
  const ch = cauHinhGia();
  fs.mkdirSync(path.dirname(ch.duongDan.db), { recursive: true });
  fs.writeFileSync(duongDanPid(ch), String(process.pid));   // "daemon" = chính tiến trình test
  const fCauHinh = sp(`ch-${Date.now()}.json`);
  fs.writeFileSync(fCauHinh, JSON.stringify(ch));

  const gocErr = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  let ma;
  try {
    ma = await remindMain(['node', 'zalo-remind.js', '--config', fCauHinh, '--text', 'thử']);
  } finally {
    process.stderr.write = gocErr;
  }
  assert.equal(ma, MA_REMIND.LOI, 'phải từ chối, và KHÔNG được trả mã "cần quét QR"');
  assert.match(keu.join(''), /TỪ CHỐI GỬI/);
  assert.match(keu.join(''), /MỘT suất/);
});
