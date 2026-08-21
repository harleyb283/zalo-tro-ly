/**
 * ═══════════════════════════════════════════════════════════════════════
 * TỰ CẤU HÌNH KHI BỊ THÊM VÀO NHÓM MỚI (luật anh chốt 21/08/2026)
 *
 * 🔴 File này canh đúng MỘT thứ trước hết: **cửa chặn "ai thêm"**. Bất kỳ ai
 *    cũng kéo được tài khoản trợ lý vào một nhóm bất kỳ; tự bật hết nghĩa là
 *    người lạ thêm em vào đâu thì tin của cả nhóm đó vào kho, mà ghi rồi thì
 *    ⛔ không rút lại được.
 *      · HOST thêm  ⇒ bật đủ
 *      · người khác ⇒ CHỈ NGHE + hỏi anh
 *      · ⛔ không rõ ai thêm ⇒ coi như KHÔNG PHẢI host
 *
 * 🔴 Và thứ hai: ⛔ KHÔNG được tự thêm một nhóm chỉ vì thấy có người `join` ở
 *    đó. Máy chủ Zalo đẩy sự kiện của MỌI nhóm tài khoản đang ở trong — kể cả
 *    nhóm anh cố ý ⛔ không cho trợ lý nghe.
 *
 *     node --test test/nhom_moi.test.js
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cauBaoHost, coId, quyetDinhNhomMoi, themNhomVaoConfig } from '../src/ops/nhom_moi.js';

const HOST = '9993000000000000001';
const TRO_LY = '9993000000000000002';
const NGUOI_LA = '9993000000000000003';
const NHOM_CU = '9993000000000000010';
const NHOM_MOI = '9993000000000000011';

const CAU_HINH = {
  hosts: [{ userId: HOST, ten: 'Host', dmChatId: HOST }],
  groups: [{ chatId: NHOM_CU, ten: 'Nhóm cũ', ghiLichSu: true, traLoiKhiTag: true }],
  cauTrungTinh: 'x',
};

const skThem = (nguoiThem, chatId = NHOM_MOI, ai = TRO_LY) => ({
  chatId,
  loai: 'JOIN',
  duLieu: JSON.stringify({
    groupName: 'Nhóm Kế toán',
    sourceId: nguoiThem,
    updateMembers: [{ id: ai, dName: 'Trợ lý' }],
  }),
});

// ═══════════════════════════════════════════════════════════════════════
// A · cửa chặn "ai thêm"
// ═══════════════════════════════════════════════════════════════════════

test('A1 ★★★ HOST thêm -> bật ĐỦ (ghi lịch sử + trả lời khi tag)', () => {
  const n = quyetDinhNhomMoi({ sk: skThem(HOST), cauHinh: CAU_HINH, uidTroLy: TRO_LY });
  assert.ok(n, 'phải nhận ra là nhóm mới');
  assert.equal(n.doHostThem, true);
  assert.equal(n.ghiLichSu, true);
  assert.equal(n.traLoiKhiTag, true);
  assert.equal(n.ten, 'Nhóm Kế toán');
});

test('A2 ★★★ NGƯỜI LẠ thêm -> CHỈ NGHE, ⛔ không ghi, ⛔ không nói', () => {
  const n = quyetDinhNhomMoi({ sk: skThem(NGUOI_LA), cauHinh: CAU_HINH, uidTroLy: TRO_LY });
  assert.ok(n);
  assert.equal(n.doHostThem, false);
  assert.equal(n.ghiLichSu, false, '🔴 ghi tin người khác khi chưa ai cho phép là ⛔ không rút lại được');
  assert.equal(n.traLoiKhiTag, false);
});

test('A3 ★★★ ⛔ KHÔNG rõ ai thêm -> coi như KHÔNG PHẢI host', () => {
  const sk = {
    chatId: NHOM_MOI,
    loai: 'JOIN',
    duLieu: JSON.stringify({ updateMembers: [{ id: TRO_LY }] }),   // ⛔ không có sourceId
  };
  const n = quyetDinhNhomMoi({ sk, cauHinh: CAU_HINH, uidTroLy: TRO_LY });
  assert.ok(n);
  assert.equal(n.doHostThem, false, 'thiếu thông tin thì phải nghiêng về phía AN TOÀN');
  assert.equal(n.ghiLichSu, false);
});

// ═══════════════════════════════════════════════════════════════════════
// B · ⛔ KHÔNG được nhận nhầm
// ═══════════════════════════════════════════════════════════════════════

test('B1 ★★★ người KHÁC được thêm vào nhóm lạ -> ⛔ KHÔNG tự thêm nhóm đó', () => {
  // Đây là ca nguy hiểm nhất: Zalo đẩy sự kiện của mọi nhóm tài khoản đang ở
  // trong. Nhận nhầm = lặng lẽ bật nghe một nhóm anh cố ý ⛔ không cho nghe.
  const n = quyetDinhNhomMoi({
    sk: skThem(HOST, NHOM_MOI, NGUOI_LA),   // người được thêm ⛔ KHÔNG phải trợ lý
    cauHinh: CAU_HINH,
    uidTroLy: TRO_LY,
  });
  assert.equal(n, null);
});

test('B2 ★ nhóm ĐÃ có trong config -> ⛔ không làm gì', () => {
  assert.equal(
    quyetDinhNhomMoi({ sk: skThem(HOST, NHOM_CU), cauHinh: CAU_HINH, uidTroLy: TRO_LY }),
    null,
  );
});

test('B3 ★ loại sự kiện khác (rời nhóm, đổi tên…) -> ⛔ không làm gì', () => {
  for (const loai of ['LEAVE', 'REMOVE_MEMBER', 'UPDATE_SETTING', 'UNKNOWN']) {
    const sk = { ...skThem(HOST), loai };
    assert.equal(quyetDinhNhomMoi({ sk, cauHinh: CAU_HINH, uidTroLy: TRO_LY }), null, loai);
  }
});

test('B4 ★★★ ⛔ không biết uid của chính mình -> ⛔ KHÔNG đoán', () => {
  assert.equal(quyetDinhNhomMoi({ sk: skThem(HOST), cauHinh: CAU_HINH, uidTroLy: null }), null);
});

test('B5 ★ khuôn dữ liệu lạ vẫn tìm ra được id (quét sâu)', () => {
  assert.equal(coId({ a: { b: [{ c: '123' }] } }, '123'), true);
  assert.equal(coId({ a: { b: [{ c: '123' }] } }, '124'), false);
  assert.equal(coId(null, '1'), false);
  // ⛔ không rơi vào đệ quy vô hạn với cấu trúc sâu
  let sau = { id: '9' };
  for (let i = 0; i < 50; i += 1) sau = { trong: sau };
  assert.equal(coId(sau, '9'), false, 'quá sâu thì dừng, ⛔ không treo');
});

// ═══════════════════════════════════════════════════════════════════════
// C · ghi config
// ═══════════════════════════════════════════════════════════════════════

function fileTam(noiDung) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-nhommoi-'));
  const f = path.join(d, 'assistant.config.json');
  fs.writeFileSync(f, JSON.stringify(noiDung, null, 2));
  return f;
}

test('C1 ★★★ thêm nhóm mà ⛔ KHÔNG đụng khoá nào khác', () => {
  const f = fileTam({
    _ghi_chu: ['giữ nguyên khối này'],
    hosts: CAU_HINH.hosts,
    groups: CAU_HINH.groups,
    cauTrungTinh: 'câu trung tính',
    duongDan: { db: '~/.zalo-tro-ly/lichsu.db' },
    tichHop: { moPhienLenh: 'lệnh của anh' },
  });

  const kq = themNhomVaoConfig(f, {
    chatId: NHOM_MOI, ten: 'Nhóm Kế toán', ghiLichSu: false, traLoiKhiTag: false,
  });
  assert.equal(kq.daThem, true);

  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(c._ghi_chu, ['giữ nguyên khối này'], '⛔ không được ăn mất ghi chú của anh');
  assert.equal(c.tichHop.moPhienLenh, 'lệnh của anh');
  assert.equal(c.cauTrungTinh, 'câu trung tính');
  assert.equal(c.groups.length, 2);
  const moi = c.groups.find((g) => g.chatId === NHOM_MOI);
  assert.deepEqual(moi, {
    chatId: NHOM_MOI, ten: 'Nhóm Kế toán', ghiLichSu: false, traLoiKhiTag: false,
  });
});

test('C2 ★ gọi hai lần -> ⛔ KHÔNG thêm trùng', () => {
  const f = fileTam({ hosts: CAU_HINH.hosts, groups: [], cauTrungTinh: 'x' });
  const n = { chatId: NHOM_MOI, ten: 'A', ghiLichSu: true, traLoiKhiTag: true };
  assert.equal(themNhomVaoConfig(f, n).daThem, true);
  assert.equal(themNhomVaoConfig(f, n).daThem, false);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).groups.length, 1);
});

test('C3 ★ file ghi ra phải là JSON đọc lại được (ghi tạm rồi đổi tên)', () => {
  const f = fileTam({ hosts: CAU_HINH.hosts, groups: [], cauTrungTinh: 'x' });
  themNhomVaoConfig(f, { chatId: NHOM_MOI, ten: 'A', ghiLichSu: true, traLoiKhiTag: true });
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, 'utf8')));
  const conSot = fs.readdirSync(path.dirname(f)).filter((x) => x.includes('.tam-'));
  assert.deepEqual(conSot, [], '⛔ không được để lại file tạm');
});

// ═══════════════════════════════════════════════════════════════════════
// D · câu báo host
// ═══════════════════════════════════════════════════════════════════════

test('D1 ★ người lạ thêm -> câu báo phải nói RÕ là cần anh quyết', () => {
  const s = cauBaoHost({ chatId: NHOM_MOI, ten: 'Nhóm lạ', nguoiThem: NGUOI_LA, doHostThem: false });
  assert.match(s, /CHỈ NGHE/);
  assert.match(s, /không phải anh/i);
  assert.ok(s.includes(NGUOI_LA), 'phải nêu ai đã thêm');
});

test('D2 ★ host tự thêm -> câu báo gọn, ⛔ không hỏi lại', () => {
  const s = cauBaoHost({ chatId: NHOM_MOI, ten: 'Nhóm KT', nguoiThem: HOST, doHostThem: true });
  assert.match(s, /đã tự cấu hình xong/);
  assert.ok(!/CHỈ NGHE/.test(s));
});

// ═══════════════════════════════════════════════════════════════════════
// E · NỐI DÂY — logic đúng mà ⛔ không ai gọi thì vẫn là ⛔ không có tính năng
// ═══════════════════════════════════════════════════════════════════════

test('E1 ★★★ daemon PHẢI gọi tuCauHinhNhomMoi khi có sự kiện nhóm', () => {
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const than = idx.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(than, /boPhat\.on\(SU_KIEN\.SU_KIEN_NHOM[\s\S]{0,400}?p\.tuCauHinhNhomMoi\?\.\(sk\)/,
    '🔴 nhánh sự kiện nhóm phải gọi tới hàm tự cấu hình');
  assert.match(than, /ganXuLyTin\(\{[\s\S]{0,300}?tuCauHinhNhomMoi,/,
    '🔴 daemon phải NỐI hàm đó vào — thiếu dây thì luật "tự cấu hình" ⛔ không tồn tại');
  assert.match(than, /themNhomVaoConfig\(duongDanConfig, n\)/,
    'phải ghi vào ĐÚNG file config mà bộ nạp nóng đang soi');
});

test('E3 ★★★ nhóm mới ĐƯỢC NÓI thì mở pane NGAY, nhóm "chỉ nghe" thì ⛔ KHÔNG', () => {
  // ⛔ Đợi tin đầu tiên mới mở pane ⇒ câu đầu anh nhắn vào nhóm vừa lập phải
  // chờ tới ngưỡng dự phòng (37 giây) mới có người trả lời. Mà câu đầu tiên
  // trong một nhóm mới chính là câu người ta để ý nhất.
  // ⚠️ Ngược lại, nhóm "chỉ nghe" (người lạ thêm) mà dựng sẵn pane là đốt một
  // phiên Claude cho việc ⛔ chưa ai cho phép làm.
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const than = idx.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(than, /if \(n\.traLoiKhiTag && soMoPhien\) \{[\s\S]{0,200}?soMoPhien\.baoDam\(n\.chatId/,
    '🔴 phải mở pane ngay khi nhóm mới được phép nói — và CHỈ khi được phép');
  assert.match(than, /lyDo: 'nhom-moi'/, 'ghi rõ lý do để log truy được');
});

test('E2 ★★★ CHỈ daemon ghi config — client ⛔ KHÔNG được đụng vào', () => {
  // Hai tiến trình cùng ghi một file config là hỏng file. Client có 8 bản
  // đang chạy; cho nó quyền ghi là mời tai nạn.
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const kh = idx.slice(idx.indexOf('async function chayClient'), idx.indexOf('export async function rutOutbox'));
  assert.ok(!/themNhomVaoConfig/.test(kh), '⛔ client ⛔ không được gọi hàm ghi config');
});
