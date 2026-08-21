/**
 * ═══════════════════════════════════════════════════════════════════════
 * NẠP NÓNG CẤU HÌNH (21/08/2026)
 *
 * Bối cảnh: anh chốt luật "trợ lý được add vào nhóm mới thì tự cấu hình luôn".
 * Luật đó ⛔ không dùng được nếu mỗi lần thêm nhóm phải restart daemon —
 * restart giết phiên Zalo đang khoẻ, giết sổ mở-phiên trong RAM, và cắt ngang
 * mọi câu hỏi đang bay.
 *
 * Bốn thứ file này canh, và cả bốn đều là chỗ đã từng hỏng ở đâu đó:
 *   ① Áp lên CHÍNH object đang chạy — thay object là mọi closure ôm bản cũ.
 *   ② Trường KHOÁ CỨNG (hosts, duongDan…) ⛔ không được âm thầm đổi, nhưng
 *      PHẢI báo — im lặng bỏ qua là để anh tin thứ vừa sửa đã có hiệu lực.
 *   ③ Config HỎNG ⇒ GIỮ NGUYÊN bản đang chạy. Một dấu phẩy thừa ⛔ không được
 *      phép làm câm trợ lý.
 *   ④ ⛔ Không báo host khi ⛔ không có gì đổi — cảnh báo phiền là cảnh báo bị bỏ qua.
 *
 * KHÔNG mạng, KHÔNG Zalo, KHÔNG DB.
 *     node --test test/nap_nong.test.js
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  TRUONG_KHOA_CUNG,
  TRUONG_NAP_NONG,
  apDungNapNong,
  moTaThayDoi,
  soSanhNhom,
  taoBoNapNong,
} from '../src/ops/nap_nong.js';
import { docCauHinh, duongDanCauHinh } from '../src/policy/access.js';

/** Cấu hình tối thiểu ĐỦ QUA validate của access.js. */
function cauHinhMau(groups = [{ chatId: '111', ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true }]) {
  return {
    hosts: [{ userId: '900', ten: 'Host', dmChatId: '900' }],
    groups,
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    duongDan: { db: '~/.zalo-tro-ly/lichsu.db' },
    anTrangThai: true,
  };
}

function thuMucTam() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-napnong-'));
}

// ═══════════════════════════════════════════════════════════════════════
// A · soSanhNhom
// ═══════════════════════════════════════════════════════════════════════

test('A1 thêm/bỏ/đổi nhóm được nhận ra đúng', () => {
  const kq = soSanhNhom(
    [
      { chatId: '1', ten: 'A', ghiLichSu: true, traLoiKhiTag: true },
      { chatId: '2', ten: 'B', ghiLichSu: true, traLoiKhiTag: true },
    ],
    [
      { chatId: '1', ten: 'A đổi tên', ghiLichSu: true, traLoiKhiTag: true },
      { chatId: '3', ten: 'C', ghiLichSu: true, traLoiKhiTag: true },
    ],
  );
  assert.deepEqual(kq.them.map((g) => g.chatId), ['3']);
  assert.deepEqual(kq.bo.map((g) => g.chatId), ['2']);
  assert.deepEqual(kq.doi.map((d) => d.chatId), ['1']);
});

test('A2 ĐỔI THỨ TỰ trong config KHÔNG phải là thay đổi', () => {
  const a = { chatId: '1', ten: 'A', ghiLichSu: true, traLoiKhiTag: true };
  const b = { chatId: '2', ten: 'B', ghiLichSu: true, traLoiKhiTag: true };
  const kq = soSanhNhom([a, b], [b, a]);
  assert.equal(kq.them.length + kq.bo.length + kq.doi.length, 0);
});

test('A3 đổi cờ ghiLichSu bị bắt — đây là cờ quyết định có ghi tin người khác hay không', () => {
  const kq = soSanhNhom(
    [{ chatId: '1', ten: 'A', ghiLichSu: true, traLoiKhiTag: true }],
    [{ chatId: '1', ten: 'A', ghiLichSu: false, traLoiKhiTag: true }],
  );
  assert.equal(kq.doi.length, 1);
  assert.equal(kq.doi[0].sau.ghiLichSu, false);
});

// ═══════════════════════════════════════════════════════════════════════
// B · apDungNapNong — ① áp TẠI CHỖ, ② khoá cứng
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★ áp TẠI CHỖ: object đang chạy giữ nguyên identity', () => {
  const dangChay = cauHinhMau();
  const omBoi = dangChay;            // giả lập closure trong index.js
  const moi = cauHinhMau([
    { chatId: '111', ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true },
    { chatId: '222', ten: 'Nhóm B', ghiLichSu: true, traLoiKhiTag: true },
  ]);

  apDungNapNong(dangChay, moi);

  assert.equal(omBoi, dangChay, 'phải là CÙNG một object');
  assert.equal(omBoi.groups.length, 2, 'closure cũ phải thấy nhóm mới');
  assert.ok(omBoi.groups.some((g) => g.chatId === '222'));
});

test('B2 ★ hosts đổi thì KHÔNG áp, nhưng PHẢI khai là khoá cứng', () => {
  const dangChay = cauHinhMau();
  const moi = cauHinhMau();
  moi.hosts = [{ userId: '999', ten: 'Người lạ', dmChatId: '999' }];

  const kq = apDungNapNong(dangChay, moi);

  assert.deepEqual(dangChay.hosts, [{ userId: '900', ten: 'Host', dmChatId: '900' }],
    'hosts đang chạy PHẢI y nguyên — listener đã chụp danh sách này lúc gắn');
  assert.ok(kq.khoaCungDoi.includes('hosts'));
  assert.ok(moTaThayDoi(kq).includes('khởi động lại'));
});

test('B3 khoá cứng và nạp nóng KHÔNG được giẫm chân nhau', () => {
  for (const t of TRUONG_NAP_NONG) {
    assert.ok(!TRUONG_KHOA_CUNG.includes(t), `${t} nằm ở CẢ HAI danh sách`);
  }
});

test('B4 không có gì đổi ⇒ moTaThayDoi trả null (⛔ không làm phiền host)', () => {
  const dangChay = cauHinhMau();
  const kq = apDungNapNong(dangChay, cauHinhMau());
  assert.deepEqual(kq.thayDoi, []);
  assert.equal(moTaThayDoi(kq), null);
});

test('B5 đổi cauTrungTinh được nạp nóng', () => {
  const dangChay = cauHinhMau();
  const moi = cauHinhMau();
  moi.cauTrungTinh = 'Em báo riêng anh rồi.';
  const kq = apDungNapNong(dangChay, moi);
  assert.equal(dangChay.cauTrungTinh, 'Em báo riêng anh rồi.');
  assert.ok(kq.thayDoi.includes('cauTrungTinh'));
});

// ═══════════════════════════════════════════════════════════════════════
// C · taoBoNapNong — vòng đời thật, có chạm đĩa
// ═══════════════════════════════════════════════════════════════════════

test('C1 ★ sửa file ⇒ nhóm mới có hiệu lực mà KHÔNG restart', () => {
  const thuMuc = thuMucTam();
  const f = path.join(thuMuc, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(cauHinhMau()));

  const dangChay = docCauHinh(f);
  assert.equal(dangChay.groups.length, 1);

  const bao = [];
  const bo = taoBoNapNong({
    duongDan: f,
    dich: dangChay,
    docCauHinh,
    log: () => {},
    baoHost: (s) => bao.push(s),
    tuChay: false,
  });

  fs.writeFileSync(f, JSON.stringify(cauHinhMau([
    { chatId: '111', ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true },
    { chatId: '222', ten: 'Nhóm B', ghiLichSu: true, traLoiKhiTag: true },
  ])));

  const kq = bo.kiemNgay(true);
  assert.ok(kq, 'phải nạp được');
  assert.equal(dangChay.groups.length, 2);
  assert.equal(bao.length, 1);
  assert.ok(bao[0].includes('222'), 'câu báo phải nêu nhóm vừa thêm');
  bo.dung();
});

test('C2 ★ config HỎNG ⇒ GIỮ NGUYÊN bản đang chạy + báo host ĐÚNG MỘT LẦN', () => {
  const thuMuc = thuMucTam();
  const f = path.join(thuMuc, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(cauHinhMau()));

  const dangChay = docCauHinh(f);
  const bao = [];
  const bo = taoBoNapNong({
    duongDan: f, dich: dangChay, docCauHinh, log: () => {}, baoHost: (s) => bao.push(s), tuChay: false,
  });

  fs.writeFileSync(f, '{ "hosts": [ this is not json');
  bo.kiemNgay(true);
  bo.kiemNgay(true);
  bo.kiemNgay(true);

  assert.equal(dangChay.groups.length, 1, 'bản đang chạy PHẢI y nguyên');
  assert.equal(dangChay.hosts.length, 1);
  assert.equal(bao.length, 1, 'cùng một lỗi thì báo ĐÚNG một lần, ⛔ không bắn mỗi nhịp');
  assert.ok(bao[0].includes('GIỮ NGUYÊN'));
  bo.dung();
});

test('C3 ★ config MỞ TOANG (chatId = "*") ⇒ TỪ CHỐI nạp', () => {
  const thuMuc = thuMucTam();
  const f = path.join(thuMuc, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(cauHinhMau()));
  const dangChay = docCauHinh(f);

  const bo = taoBoNapNong({ duongDan: f, dich: dangChay, docCauHinh, log: () => {}, tuChay: false });
  fs.writeFileSync(f, JSON.stringify(cauHinhMau([{ chatId: '*', ten: 'tất cả' }])));

  assert.equal(bo.kiemNgay(true), null, 'mở toang thì phải TỪ CHỐI');
  assert.equal(dangChay.groups[0].chatId, '111');
  bo.dung();
});

test('C4 file BIẾN MẤT ⇒ giữ nguyên, ⛔ không coi là "không nhóm nào"', () => {
  const thuMuc = thuMucTam();
  const f = path.join(thuMuc, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(cauHinhMau()));
  const dangChay = docCauHinh(f);
  const bao = [];
  const bo = taoBoNapNong({
    duongDan: f, dich: dangChay, docCauHinh, log: () => {}, baoHost: (s) => bao.push(s), tuChay: false,
  });

  fs.rmSync(f);
  bo.kiemNgay(true);

  assert.equal(dangChay.groups.length, 1);
  assert.equal(bao.length, 1);
  bo.dung();
});

test('C5 mtime KHÔNG đổi ⇒ ⛔ không đọc lại file (nhịp poll phải rẻ)', () => {
  const thuMuc = thuMucTam();
  const f = path.join(thuMuc, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(cauHinhMau()));
  const dangChay = docCauHinh(f);

  let soLanDoc = 0;
  const bo = taoBoNapNong({
    duongDan: f,
    dich: dangChay,
    docCauHinh: (d) => { soLanDoc += 1; return docCauHinh(d); },
    log: () => {},
    tuChay: false,
  });

  bo.kiemNgay();
  bo.kiemNgay();
  assert.equal(soLanDoc, 0, 'file chưa đổi thì ⛔ không đọc lại');
  bo.dung();
});

// ═══════════════════════════════════════════════════════════════════════
// D · duongDanCauHinh — MỘT nguồn sự thật
// ═══════════════════════════════════════════════════════════════════════

test('D1 ★ watcher và docCauHinh phải trỏ CÙNG một file', () => {
  const thuMuc = thuMucTam();
  const f = path.join(thuMuc, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(cauHinhMau()));

  // Tham số tường minh thắng mọi thứ khác.
  assert.equal(duongDanCauHinh(f), f);

  // Vắng tham số thì cả hai cùng rơi về ZTL_CONFIG.
  const cu = process.env.ZTL_CONFIG;
  process.env.ZTL_CONFIG = f;
  try {
    assert.equal(duongDanCauHinh(), f);
    assert.equal(docCauHinh().groups[0].chatId, '111');
  } finally {
    if (cu === undefined) delete process.env.ZTL_CONFIG; else process.env.ZTL_CONFIG = cu;
  }
});
