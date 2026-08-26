/**
 * Nghiệm thu `src/ops/send_retry.js` + CHỖ NỐI DÂY của nó trong `drainOutbox`.
 *
 * 🔴 BỐI CẢNH (⛔ đừng xoá, đây là lý do file này tồn tại):
 * 22–26/08/2026 mất 3 tin THẬT. `drainOutbox` gặp lỗi gửi là ghi `status='loi'`
 * — trạng thái CUỐI — rồi thôi. ⛔ Không thử lại, ⛔ không báo ai. Người phát
 * hiện ra là chính anh, bằng câu "alo không gửi câu trả lời à", sau 4 ngày.
 *
 * ⚠️ Zalo chỉ trả về "Lỗi không xác định" nên ⛔ KHÔNG ai biết nguyên nhân.
 * Vì vậy bộ này vá HẬU QUẢ (thử lại + chia nhỏ dần + kêu to), ⛔ không vá
 * nguyên nhân — và test cũng phải canh đúng như thế.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  decideRetry, readyToRetry, byteCapFor, deadLetterMessage, classifyFailure,
  MAX_LAN_GUI, BACKOFF_GUI_MS, TRAN_BYTE_THEO_LAN,
} from '../src/ops/send_retry.js';

const GOC = process.cwd();

test('R1 MÁY CHỦ TỪ CHỐI ở lượt đầu -> THỬ LẠI, ⛔ không chôn ngay', () => {
  // ⚠️ PHẢI kèm `lyDo`: ⛔ không rõ kiểu lỗi thì mặc định là ⛔ KHÔNG thử lại
  // (fail-closed, tránh gửi hai lần). Xem `classifyFailure`.
  const qd = decideRetry({ soLanDaThu: 1, lyDo: 'Lỗi không xác định' });
  assert.equal(qd.thuLai, true);
  assert.equal(qd.lanKe, 2);
  assert.ok(qd.choMs > 0, 'phải có giãn cách, ⛔ đừng bắn lại tức thì');
});

test('★★★ R2 mỗi lượt thử lại phải CHIA NHỎ HƠN lượt trước', () => {
  // Đây là cách dò xuống khi ⛔ không biết ngưỡng thật của Zalo.
  const tran = [];
  for (let n = 1; n <= MAX_LAN_GUI; n += 1) tran.push(byteCapFor({ soLanDaThu: n - 1 }));
  for (let i = 1; i < tran.length; i += 1) {
    assert.ok(tran[i] < tran[i - 1], `lượt ${i + 1} (${tran[i]}B) phải nhỏ hơn lượt ${i} (${tran[i - 1]}B)`);
  }
});

test('★★★ R3 hết lượt -> ⛔ KHÔNG thử nữa (⛔ không bắn dai vào Zalo)', () => {
  const qd = decideRetry({ soLanDaThu: MAX_LAN_GUI, lyDo: 'Lỗi không xác định' });
  assert.equal(qd.thuLai, false, 'bắn lại vô hạn là tự nộp mình cho bộ lọc spam');
});

test('★★★ R4 CÒN TRONG GIỜ CHỜ thì ⛔ KHÔNG được gửi lại', () => {
  // Nhịp rút outbox là 2 giây. Thiếu chốt này = 30 lần/phút vào đúng tin vừa
  // bị từ chối.
  const moc = 1_000_000;
  assert.equal(
    readyToRetry({ soLanDaThu: 1, tsCapNhatMs: moc }, moc + 100),
    false,
    'mới hỏng 0,1 giây mà đã bắn lại',
  );
  assert.equal(
    readyToRetry({ soLanDaThu: 1, tsCapNhatMs: moc }, moc + BACKOFF_GUI_MS[1] + 1),
    true,
    'chờ đủ rồi thì phải cho đi',
  );
});

test('R5 lượt ĐẦU (chưa thử lần nào) thì đi ngay, ⛔ không chờ', () => {
  assert.equal(readyToRetry({ soLanDaThu: 0, tsCapNhatMs: Date.now() }, Date.now()), true);
});

test('R6 ⛔ không rõ mốc thời gian -> vẫn CHO GỬI (thà gửi còn hơn kẹt)', () => {
  assert.equal(readyToRetry({ soLanDaThu: 2, tsCapNhatMs: NaN }, Date.now()), true);
});

test('★★ R7 câu báo host phải nêu ĐỦ: gửi vào đâu, thử mấy lần, nội dung gì', () => {
  const s = deadLetterMessage({
    chatIdDich: '123', soLanDaThu: 4, lyDo: 'Lỗi không xác định',
    text: 'Nhắc anh hoàn thành cập nhật thiết kế báo cáo công nợ',
  });
  assert.match(s, /123/, 'thiếu nơi gửi');
  assert.match(s, /4/, 'thiếu số lần đã thử');
  assert.match(s, /Lỗi không xác định/, 'thiếu lý do Zalo trả về');
  assert.match(s, /báo cáo công nợ/, '🔴 thiếu NỘI DUNG -> anh ⛔ không biết mình vừa mất tin gì');
});

test('🔴 R8 drainOutbox PHẢI thử lại, ⛔ KHÔNG được chôn tin ngay lần hỏng đầu', () => {
  // ⚠️ Bài này canh CHỖ NỐI DÂY. Hôm nay đã dính đúng một lần: hàm
  // `requeueOutbound` viết xong mà quên nối, `node --check` vẫn xanh vì nó
  // nằm trong destructure ĐỘNG. Test hàm lá ⇒ xanh; chỉ test chỗ nối mới bắt.
  const src = fs.readFileSync(path.join(GOC, 'src', 'index.js'), 'utf8');
  const i = src.indexOf('export async function drainOutbox');
  assert.ok(i > 0, 'cắt trượt drainOutbox ⇒ bài này vô nghĩa');
  const than = src.slice(i, src.indexOf('\n}', src.indexOf('return ra;', i)));

  assert.match(than, /decideRetry\(/, 'drainOutbox ⛔ không hỏi chính sách thử lại');
  assert.match(than, /requeueOutbound\(/, '⛔ không trả tin về hàng đợi ⇒ tin bị chôn như cũ');
  assert.match(than, /readyToRetry\(/, 'thiếu chốt backoff ⇒ bắn lại 30 lần/phút');
  assert.match(than, /baoHost/, 'hết lượt mà ⛔ không báo host = im lặng mất tin');
});

test('🔴 R9 chốt backoff phải đứng TRƯỚC claimOutbound', () => {
  // Claim rồi mới bỏ qua thì `attempt_count` vẫn cộng ⇒ đốt sạch trần thử lại
  // trong vài giây, ⛔ không tin nào kịp chờ hết backoff. Thứ tự ở đây là
  // một phần của tính đúng, ⛔ không phải chuyện thẩm mỹ.
  const src = fs.readFileSync(path.join(GOC, 'src', 'index.js'), 'utf8');
  const than = src.slice(src.indexOf('export async function drainOutbox'));
  assert.ok(
    than.indexOf('readyToRetry(') < than.indexOf('claimOutbound('),
    '🔴 backoff kiểm SAU khi nhận việc ⇒ trần thử lại bị đốt sạch',
  );
});

test('R10 hằng số công bố phải khớp nhau về SỐ LƯỢNG', () => {
  assert.equal(TRAN_BYTE_THEO_LAN.length, MAX_LAN_GUI, 'thiếu trần cho một lượt nào đó');
  assert.equal(BACKOFF_GUI_MS.length, MAX_LAN_GUI, 'thiếu giãn cách cho một lượt nào đó');
});

test('🔴 R11 ĐỨT ĐƯỜNG thì ⛔ KHÔNG thử lại — dù mới hỏng lần đầu', () => {
  // Rủi ro GỬI HAI LẦN quan trọng hơn rủi ro mất một tin: mất tin thì báo được,
  // còn hai tin giống hệt vào nhóm người thật thì ⛔ không rút lại được.
  for (const loi of ['ECONNRESET', 'socket hang up', 'fetch failed', 'ETIMEDOUT']) {
    assert.equal(classifyFailure(loi), 'KHONG_RO', loi);
    assert.equal(decideRetry({ soLanDaThu: 1, lyDo: loi }).thuLai, false, loi);
  }
});

test('🔴 R12 lỗi LẠ chưa từng thấy -> coi là ⛔ KHÔNG RÕ (fail-closed)', () => {
  assert.equal(classifyFailure('cái gì đó chưa ai gặp bao giờ'), 'KHONG_RO');
  assert.equal(classifyFailure(''), 'KHONG_RO');
  assert.equal(classifyFailure(null), 'KHONG_RO');
});
