/**
 * G0 — nghiệm thu hàm toId(). Chạy: node --test test/
 *
 * Ca quan trọng nhất là ca #3: số VƯỢT Number.MAX_SAFE_INTEGER phải CẢNH BÁO.
 * Không có cảnh báo thì độ chính xác mất âm thầm và UPDATE thu hồi trượt
 * mà không ai biết.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toId, toIdRequired, sameId,
  setWarningHandler, warningCount, resetWarningCount,
} from '../src/lib/ids.js';

/** Bắt cảnh báo thay vì để nó chạy ra stderr. */
const batCanhBao = [];
setWarningHandler((c) => batCanhBao.push(c));

function chuanBi() {
  batCanhBao.length = 0;
  resetWarningCount();
}

test('chuỗi dài — giữ nguyên, KHÔNG cảnh báo', () => {
  chuanBi();
  assert.equal(toId('9990000000001'), '9990000000001');
  // 25 chữ số: quá xa ngưỡng an toàn của Number, nhưng là chuỗi nên vô hại
  assert.equal(toId('1234567890123456789012345'), '1234567890123456789012345');
  assert.equal(toId('  9990000001  '), '9990000001', 'phải trim');
  assert.equal(warningCount(), 0, 'chuỗi không được sinh cảnh báo nào');
});

test('số safe integer — chuyển đúng, KHÔNG cảnh báo', () => {
  chuanBi();
  assert.equal(toId(9990000000001), '9990000000001');
  assert.equal(toId(0), '0');
  assert.equal(toId(Number.MAX_SAFE_INTEGER), '9007199254740991');
  assert.equal(warningCount(), 0);
});

test('🔴 số KHÔNG safe integer — PHẢI cảnh báo', () => {
  chuanBi();
  const qua = Number.MAX_SAFE_INTEGER + 2;      // 9007199254740993 → đã mất chính xác
  const ra = toId(qua, 'undo.globalMsgId');
  assert.equal(warningCount(), 1, 'phải cảnh báo đúng 1 lần');
  assert.equal(batCanhBao[0].loai, 'VUOT_SAFE_INTEGER');
  assert.equal(batCanhBao[0].boiCanh, 'undo.globalMsgId', 'phải kèm bối cảnh để lần ra chỗ gọi');
  assert.equal(typeof ra, 'string', 'vẫn trả chuỗi — cảnh báo chứ không nuốt dữ liệu');

  chuanBi();
  toId(1e21, 'thu');                             // số cực lớn
  assert.equal(warningCount(), 1);
  assert.equal(batCanhBao[0].loai, 'VUOT_SAFE_INTEGER');
});

test('số không nguyên / không hữu hạn — cảnh báo', () => {
  chuanBi();
  toId(1.5, 'thu');
  assert.equal(batCanhBao[0].loai, 'SO_KHONG_NGUYEN');

  chuanBi();
  assert.equal(toId(NaN, 'thu'), null);
  assert.equal(batCanhBao[0].loai, 'SO_KHONG_HUU_HAN');

  chuanBi();
  assert.equal(toId(Infinity, 'thu'), null);
  assert.equal(batCanhBao[0].loai, 'SO_KHONG_HUU_HAN');
});

test('bigint — chuyển đúng, KHÔNG cảnh báo (đây là đường AN TOÀN)', () => {
  chuanBi();
  assert.equal(toId(9007199254740993n), '9007199254740993');
  assert.equal(warningCount(), 0);
});

test('đối tượng BigNumber-like (json-bigint) — đọc qua toString()', () => {
  chuanBi();
  const gia = { toString: () => '9990000000001' };
  assert.equal(toId(gia), '9990000000001');
  assert.equal(warningCount(), 0);

  chuanBi();
  assert.equal(toId({ a: 1 }, 'thu'), null);
  assert.equal(batCanhBao[0].loai, 'DOI_TUONG_KHONG_PHAI_ID');
});

test('rỗng / null / undefined → null, không cảnh báo', () => {
  chuanBi();
  assert.equal(toId(null), null);
  assert.equal(toId(undefined), null);
  assert.equal(toId(''), null);
  assert.equal(toId('   '), null);
  assert.equal(warningCount(), 0);
});

test('toIdRequired — ném lỗi khi thiếu, thông báo có tên trường', () => {
  chuanBi();
  assert.equal(toIdRequired('123', 'chat_id'), '123');
  assert.throws(() => toIdRequired(null, 'chat_id'), /chat_id/);
});

test('🔴 sameId — chống bẫy LỆCH KIỂU string vs number', () => {
  chuanBi();
  // TMessage.msgId là string, TUndoContent.globalMsgId là number.
  // So sánh thẳng bằng === thì KHÔNG khớp → thu hồi trượt im lặng.
  assert.equal('9990000000001' === 9990000000001, false, 'đây chính là cái bẫy');
  assert.equal(sameId('9990000000001', 9990000000001), true, 'sameId phải cứu được');
  assert.equal(sameId(null, null), false, 'hai cái null KHÔNG được coi là cùng ID');
  assert.equal(sameId('1', '2'), false);
});

test('bộ xử lý cảnh báo hỏng thì KHÔNG được làm chết luồng chính', () => {
  setWarningHandler(() => { throw new Error('bộ xử lý hỏng'); });
  assert.doesNotThrow(() => toId(Number.MAX_SAFE_INTEGER + 2, 'thu'));
  setWarningHandler((c) => batCanhBao.push(c));
});
