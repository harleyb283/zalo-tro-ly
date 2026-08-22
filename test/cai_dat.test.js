/**
 * ═══════════════════════════════════════════════════════════════════════
 * TRÌNH CÀI ĐẶT (22/08/2026)
 *
 * Bối cảnh: anh cài trợ lý cho người nhà **không rành kỹ thuật**, trên máy
 * khác. Nghĩa là ⛔ không có ai ngồi đó đọc stack trace và sửa JSON tay.
 *
 * 🔴 Hai chỗ dễ sai nhất, và cả hai đều hỏng CÂM:
 *   ① hiểu sai câu người dùng gõ (chọn nhóm) — chọn nhầm nhóm ⇒ ghi tin của
 *     người khác vào kho, mà ghi rồi thì ⛔ KHÔNG rút lại được;
 *   ② dựng sai file cấu hình — thiếu `dmChatId` thì luật chống rò chéo ⛔ không
 *     có đích để gửi, và triệu chứng nhìn y hệt "bot chết".
 *
 *     node --test test/cai_dat.test.js
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dungConfig, kiemMoiTruong, phanTichLuaChon } from '../src/ops/cai_dat.js';

// ═══════════════════════════════════════════════════════════════════════
// A · hiểu câu người dùng gõ
// ═══════════════════════════════════════════════════════════════════════

test('A1 các kiểu gõ thường gặp đều hiểu đúng', () => {
  assert.deepEqual(phanTichLuaChon('1,3', 5), { ok: true, chon: [0, 2] });
  assert.deepEqual(phanTichLuaChon('1 3', 5), { ok: true, chon: [0, 2] });
  assert.deepEqual(phanTichLuaChon('2-4', 5), { ok: true, chon: [1, 2, 3] });
  assert.deepEqual(phanTichLuaChon(' 3 , 1 ', 5), { ok: true, chon: [0, 2] }, 'thừa khoảng trắng vẫn hiểu');
  assert.deepEqual(phanTichLuaChon('2,2,2', 5), { ok: true, chon: [1] }, 'gõ trùng thì gộp');
});

test('A2 ★ bỏ trống = KHÔNG nhóm nào (⛔ không tự chọn hộ)', () => {
  assert.deepEqual(phanTichLuaChon('', 5), { ok: true, chon: [] });
  assert.deepEqual(phanTichLuaChon('   ', 5), { ok: true, chon: [] });
});

test('A3 ★★ gõ sai thì BÁO để hỏi lại, ⛔ TUYỆT ĐỐI không đoán bừa', () => {
  // 🔴 Đoán bừa ở đây = lặng lẽ bật nghe một nhóm người ta ⛔ không chọn.
  for (const xau of ['abc', '1,abc', '0', '9', '1-9', '-2']) {
    const kq = phanTichLuaChon(xau, 5);
    assert.equal(kq.ok, false, `"${xau}" phải bị từ chối`);
    assert.ok(kq.loi.length > 0, 'và phải nói được sai ở đâu');
  }
});

test('A4 "tất cả" hiểu được, nhưng đó là việc của chỗ gọi phải hỏi lại', () => {
  assert.deepEqual(phanTichLuaChon('tất cả', 3), { ok: true, chon: [0, 1, 2] });
  assert.deepEqual(phanTichLuaChon('all', 3), { ok: true, chon: [0, 1, 2] });
});

// ═══════════════════════════════════════════════════════════════════════
// B · dựng cấu hình
// ═══════════════════════════════════════════════════════════════════════

const MAU = {
  _ghi_chu: ['khối tài liệu trong bản mẫu'],
  hosts: [{ userId: '0000', ten: 'mẫu', dmChatId: '0000' }],
  groups: [{ chatId: '0000', ten: 'mẫu' }],
  cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
  duongDan: { db: '~/.zalo-tro-ly/lichsu.db' },
  thoiGian: { keepAliveMs: 120000 },
  anTrangThai: true,
};

test('B1 ★★★ dmChatId phải được điền SẴN bằng chính userId', () => {
  // 🔴 Đây là đích của luật chống rò chéo. Người không rành kỹ thuật sẽ ⛔
  // không tự đi tìm được con số này, và bỏ trống thì trợ lý câm mà ⛔ không
  // ai hiểu vì sao.
  const c = dungConfig({ mau: MAU, toi: { userId: '777', ten: 'Chị A' }, nhomChon: [] });
  assert.equal(c.hosts.length, 1);
  assert.equal(c.hosts[0].userId, '777');
  assert.equal(c.hosts[0].dmChatId, '777');
  assert.equal(c.hosts[0].ten, 'Chị A');
});

test('B2 ★ giữ nguyên mọi khoá khác của bản mẫu', () => {
  const c = dungConfig({ mau: MAU, toi: { userId: '777' }, nhomChon: [] });
  assert.deepEqual(c._ghi_chu, MAU._ghi_chu, 'khối ghi chú là tài liệu sống, ⛔ đừng ăn mất');
  assert.equal(c.cauTrungTinh, MAU.cauTrungTinh);
  assert.deepEqual(c.duongDan, MAU.duongDan);
  assert.deepEqual(c.thoiGian, MAU.thoiGian);
});

test('B3 ★★ nhóm mẫu trong bản mẫu PHẢI bị thay hẳn, ⛔ không cộng dồn', () => {
  // Cộng dồn = cấu hình mang theo chatId "0000" của bản mẫu ⇒ pack cảnh báo
  // "chưa thay id thật" và người dùng ⛔ không hiểu chuyện gì.
  const c = dungConfig({
    mau: MAU,
    toi: { userId: '777' },
    nhomChon: [{ chatId: '111', ten: 'Nhóm nhà' }],
  });
  assert.equal(c.groups.length, 1);
  assert.deepEqual(c.groups[0], {
    chatId: '111', ten: 'Nhóm nhà', ghiLichSu: true, traLoiKhiTag: true,
  });
});

test('B4 nhóm chưa đặt tên vẫn có nhãn đọc được', () => {
  const c = dungConfig({ mau: MAU, toi: { userId: '777' }, nhomChon: [{ chatId: '222', ten: null }] });
  assert.equal(c.groups[0].ten, 'nhóm 222');
});

test('B5 ★ thiếu userId -> NÉM, ⛔ không ghi ra file cấu hình hỏng', () => {
  assert.throws(() => dungConfig({ mau: MAU, toi: {}, nhomChon: [] }), /userId/);
});

// ═══════════════════════════════════════════════════════════════════════
// C · kiểm môi trường — phải nói CÁCH SỬA, không chỉ nói LỖI
// ═══════════════════════════════════════════════════════════════════════

test('C1 ★ Node quá cũ -> nêu rõ phải làm gì', () => {
  const kq = kiemMoiTruong({ phienBanNode: 'v18.0.0', coNodeModules: true });
  assert.equal(kq.ok, false);
  assert.match(kq.van[0].loi, /Node/);
  assert.match(kq.van[0].cach, /nodejs\.org/, 'phải chỉ ra chỗ tải, ⛔ không bỏ mặc người dùng');
});

test('C2 ★ chưa npm install -> đưa đúng câu lệnh cần gõ', () => {
  const kq = kiemMoiTruong({ phienBanNode: 'v22.0.0', coNodeModules: false });
  assert.equal(kq.ok, false);
  assert.equal(kq.van[0].cach, 'Gõ: npm install');
});

test('C3 máy đủ điều kiện -> ok, ⛔ không kêu ca gì', () => {
  const kq = kiemMoiTruong({ phienBanNode: 'v26.7.0', coNodeModules: true });
  assert.deepEqual(kq, { ok: true, van: [] });
});
