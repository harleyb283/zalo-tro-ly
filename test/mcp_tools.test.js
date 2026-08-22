/**
 * G5 — test cho src/mcp/tools.js. KHÔNG mạng, KHÔNG Zalo, KHÔNG DB thật.
 *
 * G4 (leak_guard/access) và G7 (send) lúc viết bài này CÒN LÀ STUB, nên mọi
 * bài tiêm phụ thuộc giả qua 3 khoá `kho` / `chinhSach` / `guiTin` — đúng luật
 * 8 của pack: mỗi gói phải tự nghiệm thu được, không chờ gói khác. Hàm giả bám
 * ĐÚNG chữ ký trong stub của G4/G7 để lúc ghép không lệch.
 *
 * 🔴 Bài quan trọng nhất của file này là nhóm C: chứng minh KHÔNG CÓ ĐƯỜNG NÀO
 * gửi được chữ vào nhóm khi đáp án dùng dữ liệu nhóm khác — kể cả khi các tầng
 * dưới ném lỗi.
 *
 *     node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerTools } from '../src/mcp/tools.js';
import { TEN_TOOL, TEN_TOOL_LICH, MA_LOI, GIOI_HAN, HUONG_TRA_LOI, TRANG_THAI_HANG_DOI } from '../src/lib/hang_so.js';

const CHAT_HOI = '9990000000001';
const CHAT_KHAC = '111222333444';
const DM_HOST = 'dm-host-1';
const REQ = 'req-1';

/**
 * Nuốt stderr quanh một lời gọi BẤT ĐỒNG BỘ.
 *
 * ⚠️ Bản đầu viết đồng bộ (`return { kq: fn() }`) và 4 bài đỏ oan: `fn()` trả
 * về Promise nên `.kq` là promise chứ không phải kết quả, mà `finally` thì
 * khôi phục stderr NGAY, tức là chẳng nuốt được dòng nào của phần async. Bọc
 * hàm async bằng try/finally đồng bộ là cái bẫy kinh điển.
 */
async function imLang(fn) {
  const goc = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    return await fn();
  } finally {
    process.stderr.write = goc;
  }
}

/**
 * Dựng một "server" giả chỉ để tóm handler `tools/call`, rồi trả về hàm gọi
 * tool trực tiếp. Không cần transport — nhóm này đo LOGIC, còn đường dây thật
 * đã có `test/mcp_channel.test.js` đo bằng client MCP thật.
 */
function dungTool(ghiDe = {}) {
  const daGui = { nhom: [], dm: [] };
  const nhatKy = [];
  const hangDoi = [];
  const phienDaXoa = [];

  const mac = {
    dong: {
      request_id: REQ, chat_id_hoi: CHAT_HOI, msg_id: 'm1', user_id: 'u-host',
      noi_dung: 'anh ơi', ts_tao: '2026-08-20T10:00:00.000Z',
      trang_thai: TRANG_THAI_HANG_DOI.DA_DAY,
    },
    nguon: [CHAT_HOI],
    rows: [{
      chat_id: CHAT_HOI, msg_id: 'm1', cli_msg_id: null, user_id: 'u1',
      ten_luc_gui: 'Người A', msg_type: 'chat.text', noi_dung: 'báo giá bên A',
      content_raw: null, ts_zalo: 1755678901234, ts_ghi: 'x', tu_toi: 0,
      co_tag_host: 1, da_thu_hoi: 0, thu_hoi_boi: null, thu_hoi_luc: null, do_tro_ly_tao: 0,
    }],
  };

  const kho = {
    getQueueRow: () => (ghiDe.dong === null ? null : (ghiDe.dong ?? mac.dong)),
    updateQueueState: (_db, rid, tt) => { hangDoi.push([rid, tt]); return true; },
    queryHistory: ghiDe.queryHistory ?? (() => ({
      rows: ghiDe.rows ?? mac.rows,
      nguonChatIds: ghiDe.nguonTruyVan ?? [CHAT_HOI],
    })),
    writeQueryLog: ghiDe.writeQueryLog ?? ((_db, b) => { nhatKy.push(b); }),
    storeStats: ghiDe.storeStats ?? (() => ({
      soTinDaLuu: 12, soThuHoiMoCoi: 1, soHangDoiCho: 2, soNhomDangNghe: 3,
    })),
  };

  const chinhSach = {
    getSources: ghiDe.getSources ?? (() => ghiDe.nguon ?? mac.nguon),
    recordSources: ghiDe.recordSources ?? (() => {}),
    clearSession: (_bo, rid) => { phienDaXoa.push(rid); },
    hostDmChatId: ghiDe.hostDmChatId ?? (() => DM_HOST),
    decideReplyRoute: ghiDe.decideReplyRoute ?? ((bc) => {
      const la = (bc.nguon ?? []).filter((c) => c !== bc.chatIdHoi);
      return la.length
        ? { huong: HUONG_TRA_LOI.DM_HOST, coCheo: true, nguonLa: la, lyDo: 'có nhóm khác' }
        : { huong: HUONG_TRA_LOI.NHOM, coCheo: false, nguonLa: [], lyDo: 'sạch' };
    }),
  };

  const guiTin = {
    sendToGroup: ghiDe.sendToGroup ?? (async (_api, chatId, text) => {
      daGui.nhom.push({ chatId, text }); return { msgId: 'gui-nhom-1' };
    }),
    sendHostDm: ghiDe.sendHostDm ?? (async (_api, dmChatId, text) => {
      daGui.dm.push({ dmChatId, text }); return { msgId: 'gui-dm-1' };
    }),
    notifyHost: ghiDe.notifyHost,
    sendInParts: ghiDe.sendInParts ?? (async (_api, chatId, text) => {
      const { splitMessage } = await import('../src/lib/split_message.js');
      const kq = splitMessage(text);
      for (const ph of kq.phan) daGui.nhom.push({ chatId, text: ph, phan: true });
      return { msgId: 'gui-nhieu-1', msgIds: ['gui-nhieu-1'], soPhan: kq.soPhan, daCat: kq.daCat };
    }),
  };

  let xuLy;
  const server = {
    setRequestHandler(schema, fn) {
      // Chỉ giữ handler tools/call; tools/list đã đo ở bài C1 file kia.
      // Đo thật: `schema.shape.method.value` = 'tools/call' / 'tools/list'
      // (SDK 1.30.0). KHÔNG dùng nhánh lùi "cái nào tới trước thì lấy" — lỡ
      // SDK đổi hình dạng schema thì bài test sẽ lặng lẽ đo nhầm handler.
      const ten = schema?.shape?.method?.value;
      if (ten === undefined) throw new Error('không đọc được tên method của schema — bài test đang đo mù');
      if (ten === 'tools/call') xuLy = fn;
    },
  };

  registerTools(server, {
    db: ghiDe.db ?? {},
    cauHinh: ghiDe.cauHinh ?? { cauTrungTinh: 'Em nhắn riêng anh rồi ạ.', hosts: [], groups: [] },
    boTichLuy: {},
    api: {},
    docSucKhoe: ghiDe.docSucKhoe ?? (() => ({ trangThai: 'OK', lyDo: 'ổn', tuLuc: 'x', soLanThuLai: 0 })),
    kho,
    chinhSach,
    guiTin,
    nhac: ghiDe.nhac,
    lich: ghiDe.lich,
  });

  async function goi(name, args) {
    const ra = await xuLy({ params: { name, arguments: args } });
    return { thô: ra, kq: JSON.parse(ra.content[0].text) };
  }

  return { goi, daGui, nhatKy, hangDoi, phienDaXoa };
}

// ═══ A. Cửa request_id — FAIL-CLOSED ═══
test('A1 thiếu request_id -> từ chối, KHÔNG truy vấn DB', async () => {
  let daTruyVan = 0;
  const t = dungTool({ queryHistory: () => { daTruyVan += 1; return { rows: [], nguonChatIds: [] }; } });
  const { kq } = await t.goi(TEN_TOOL.LICH_SU, {});
  assert.equal(kq.ok, false);
  assert.equal(kq.ma, MA_LOI.THIEU_REQUEST_ID);
  assert.equal(daTruyVan, 0, 'đã chặn TRƯỚC khi đọc kho');
});

test('A2 request_id LẠ (Claude tự bịa) -> REQUEST_ID_LA, không trả dữ liệu', async () => {
  const t = dungTool({ dong: null });
  const { kq } = await t.goi(TEN_TOOL.LICH_SU, { request_id: 'tu-bia' });
  assert.equal(kq.ma, MA_LOI.REQUEST_ID_LA);
  assert.equal(kq.duLieu, undefined);
});

test('A3 request_id LẠ cũng chặn tra_loi -> KHÔNG gửi tin nào', async () => {
  const t = dungTool({ dong: null });
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: 'tu-bia', text: 'xin chào' });
  assert.equal(kq.ma, MA_LOI.REQUEST_ID_LA);
  assert.deepEqual(t.daGui.nhom, []);
  assert.deepEqual(t.daGui.dm, []);
});

test('A4 câu hỏi đã HẾT HẠN -> từ chối cả đọc lẫn gửi', async () => {
  const t = dungTool({
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'u-host', trang_thai: TRANG_THAI_HANG_DOI.HET_HAN },
  });
  assert.equal((await t.goi(TEN_TOOL.LICH_SU, { request_id: REQ })).kq.ma, MA_LOI.HANG_DOI_HET_HAN);
  const r = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'muộn rồi' });
  assert.equal(r.kq.ma, MA_LOI.HANG_DOI_HET_HAN);
  assert.deepEqual(t.daGui.nhom, []);
});

test('A5 request_id chỉ toàn khoảng trắng cũng là THIẾU', async () => {
  const t = dungTool();
  assert.equal((await t.goi(TEN_TOOL.LICH_SU, { request_id: '   ' })).kq.ma, MA_LOI.THIEU_REQUEST_ID);
});

// ═══ B. lich_su ═══
test('B1 trả tin đã rút gọn + nguonChatIds, KHÔNG trả nguyên dòng DB', async () => {
  const t = dungTool();
  const { kq } = await t.goi(TEN_TOOL.LICH_SU, { request_id: REQ });
  assert.equal(kq.ok, true);
  assert.equal(kq.duLieu.soDong, 1);
  assert.deepEqual(kq.duLieu.nguonChatIds, [CHAT_HOI]);
  const tin = kq.duLieu.tin[0];
  // Danh sách ĐÓNG, cố ý: đây là hàng rào chặn cột nội bộ lọt vào prompt.
  // `thuHoi` thêm ở v3 — nó KHÔNG phải cột DB thô mà là mô tả độ tin cậy do
  // query.describeRecall() dựng (SU_KIEN = biết chắc giờ / DOI_CHIEU = chỉ biết khoảng).
  assert.deepEqual(Object.keys(tin).sort(),
    ['chatId', 'daThuHoi', 'msgType', 'nguoiGui', 'noiDung', 'tenHoiThoai', 'thoiGian', 'thuHoi']);
  assert.equal(tin.content_raw, undefined, 'cột nội bộ KHÔNG được lọt ra prompt');
  assert.equal(tin.thu_hoi_nguon, undefined, 'cột DB thô KHÔNG được lọt ra prompt');
  assert.equal(tin.thoiGian, new Date(1755678901234).toISOString());
});

test('B2 GHI NHẬN NGUỒN đúng requestId — cộng dồn qua nhiều lượt tra', async () => {
  const ghiNhan = [];
  const t = dungTool({
    recordSources: (_bo, rid, nguon) => ghiNhan.push([rid, nguon]),
    nguonTruyVan: [CHAT_HOI, CHAT_KHAC],
  });
  await t.goi(TEN_TOOL.LICH_SU, { request_id: REQ });
  await t.goi(TEN_TOOL.LICH_SU, { request_id: REQ, tuKhoa: 'báo giá' });
  assert.equal(ghiNhan.length, 2, 'lượt nào cũng phải ghi, không chỉ lượt đầu');
  assert.deepEqual(ghiNhan[1], [REQ, [CHAT_HOI, CHAT_KHAC]]);
});

test('B3 KHÔNG ghi nhận được nguồn -> TỪ CHỐI trả dữ liệu (đọc mà mất dấu là ca nguy hiểm nhất)', async () => {
  const t = dungTool({ recordSources: () => { throw new Error('bộ tích luỹ hỏng'); } });
  const { kq } = await t.goi(TEN_TOOL.LICH_SU, { request_id: REQ });
  assert.equal(kq.ok, false);
  assert.equal(kq.duLieu, undefined);
});

test('B4 truy vấn hỏng -> DB_LOI, không ném stack ra client', async () => {
  const t = dungTool({ queryHistory: () => { throw new Error('SQL vỡ'); } });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.LICH_SU, { request_id: REQ }));
  assert.equal(kq.ma, MA_LOI.DB_LOI);
  assert.ok(!/at Object|\.js:\d+/.test(kq.thongDiep ?? ''), 'không được rò stack');
});

// ═══ C. tra_loi — TRÁI TIM CHỐNG RÒ CHÉO ═══
test('C1 nguồn SẠCH -> gửi thẳng vào nhóm đang hỏi', async () => {
  const t = dungTool({ nguon: [CHAT_HOI] });
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'dạ 200 triệu ạ' });
  assert.equal(kq.ok, true);
  assert.equal(kq.duLieu.huong, HUONG_TRA_LOI.NHOM);
  assert.equal(kq.duLieu.coCheo, false);
  assert.deepEqual(t.daGui.nhom, [{ chatId: CHAT_HOI, text: 'dạ 200 triệu ạ' }]);
  assert.deepEqual(t.daGui.dm, []);
});

test('C2 ★ CÓ CHÉO -> text đầy đủ chỉ vào DM host, nhóm CHỈ nhận câu trung tính', async () => {
  const t = dungTool({ nguon: [CHAT_HOI, CHAT_KHAC] });
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'bên Sao Mai báo 500 triệu' });
  assert.equal(kq.duLieu.huong, HUONG_TRA_LOI.DM_HOST);
  assert.equal(kq.duLieu.coCheo, true);
  assert.deepEqual(t.daGui.dm, [{ dmChatId: DM_HOST, text: 'bên Sao Mai báo 500 triệu' }]);
  assert.equal(t.daGui.nhom.length, 1);
  assert.equal(t.daGui.nhom[0].text, 'Em nhắn riêng anh rồi ạ.', 'câu trung tính phải là HẰNG SỐ từ config');
  assert.ok(!t.daGui.nhom[0].text.includes('Sao Mai'), 'một chữ của đáp án lọt vào nhóm là rò');
});

test('C3 THỨ TỰ: DM host đi TRƯỚC, câu trung tính đi SAU', async () => {
  const thuTu = [];
  const t = dungTool({
    nguon: [CHAT_HOI, CHAT_KHAC],
    sendHostDm: async () => { thuTu.push('dm'); return { msgId: 'd' }; },
    sendToGroup: async () => { thuTu.push('nhom'); return { msgId: 'n' }; },
  });
  await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' });
  assert.deepEqual(thuTu, ['dm', 'nhom'], 'gửi câu trung tính trước rồi DM hỏng = hứa suông với cả nhóm');
});

test('C4 có chéo mà KHÔNG có DM host -> KHÔNG gửi gì cả, cả 2 kênh im', async () => {
  const t = dungTool({ nguon: [CHAT_HOI, CHAT_KHAC], hostDmChatId: () => null });
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'nhạy cảm' });
  assert.equal(kq.ma, MA_LOI.KHONG_CO_HOST);
  assert.deepEqual(t.daGui.dm, []);
  assert.deepEqual(t.daGui.nhom, [], 'CẤM gửi câu trung tính khi đáp án chưa tới được host');
});

test('C5 leak_guard NÉM LỖI -> fail-closed, không gửi gì (không có nhánh "cứ gửi cho lành")', async () => {
  const t = dungTool({ decideReplyRoute: () => { throw new Error('G4 chưa làm'); } });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' }));
  assert.equal(kq.ok, false);
  assert.deepEqual(t.daGui.nhom, []);
  assert.deepEqual(t.daGui.dm, []);
});

test('C6 leak_guard trả rác (thiếu huong) -> vẫn fail-closed', async () => {
  const t = dungTool({ decideReplyRoute: () => ({}) });
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' });
  assert.equal(kq.ok, false);
  assert.deepEqual(t.daGui.nhom, []);
});

test('C7 huong=tu_choi -> im lặng hoàn toàn nhưng VẪN ghi nhật ký', async () => {
  const t = dungTool({
    decideReplyRoute: () => ({ huong: HUONG_TRA_LOI.TU_CHOI, coCheo: true, nguonLa: [CHAT_KHAC], lyDo: 'x' }),
  });
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' });
  assert.equal(kq.ok, true);
  assert.deepEqual(t.daGui.nhom, []);
  assert.deepEqual(t.daGui.dm, []);
  assert.equal(t.nhatKy.length, 1);
});

test('C8 nhật ký ghi ĐÚNG nguồn đã đọc + cờ chéo (bằng chứng nghiệm thu M4)', async () => {
  const t = dungTool({ nguon: [CHAT_HOI, CHAT_KHAC] });
  await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' });
  assert.deepEqual(t.nhatKy[0], {
    // v8: `clientId = null` là MỘT CÂU TRẢ LỜI — "chế độ một tiến trình, không
    // có pane nào cả", ⛔ không phải "không rõ pane nào". Bài này chạy đúng chế
    // độ đó nên null là giá trị đúng.
    clientId: null,
    requestId: REQ, chatIdHoi: CHAT_HOI,
    nguonChatIds: [CHAT_HOI, CHAT_KHAC], coCheo: true, huongTraLoi: HUONG_TRA_LOI.DM_HOST,
  });
});

test('C9 gửi xong -> hàng đợi da_tra_loi + xoá phiên tích luỹ', async () => {
  const t = dungTool();
  await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' });
  assert.deepEqual(t.hangDoi, [[REQ, TRANG_THAI_HANG_DOI.DA_TRA_LOI]]);
  assert.deepEqual(t.phienDaXoa, [REQ]);
});

test('C10 gửi Zalo hỏng -> ZALO_CHUA_SAN_SANG, VẪN ghi nhật ký với huong=null', async () => {
  const t = dungTool({ sendToGroup: async () => { throw new Error('mất mạng'); } });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' }));
  assert.equal(kq.ma, MA_LOI.ZALO_CHUA_SAN_SANG);
  assert.equal(t.nhatKy[0].huongTraLoi, null, 'không được khai là đã gửi khi chưa gửi được');
});

test('C11 câu trung tính hỏng nhưng DM đã tới -> VẪN báo thành công', async () => {
  const t = dungTool({
    nguon: [CHAT_HOI, CHAT_KHAC],
    sendToGroup: async () => { throw new Error('nhóm chặn'); },
  });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' }));
  assert.equal(kq.ok, true, 'đáp án đã tới tay anh rồi, hỏng câu xã giao không phải thất bại');
  assert.equal(t.daGui.dm.length, 1);
});

test('C12 cauTrungTinh RỖNG -> im lặng trong nhóm, TUYỆT ĐỐI không tự sinh câu thay', async () => {
  const t = dungTool({ nguon: [CHAT_HOI, CHAT_KHAC], cauHinh: { cauTrungTinh: '  ' } });
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' }));
  assert.deepEqual(t.daGui.nhom, [], 'model tự viết câu thay thế là lộ chủ đề');
  assert.equal(t.daGui.dm.length, 1);
});

test('C13 text rỗng -> không gửi tin trống', async () => {
  const t = dungTool();
  const { kq } = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: '   ' });
  assert.equal(kq.ok, false);
  assert.deepEqual(t.daGui.nhom, []);
});

test('C14 text quá dài -> cắt theo GIOI_HAN.DO_DAI_TIN_TOI_DA', async () => {
  const t = dungTool();
  await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x'.repeat(GIOI_HAN.DO_DAI_TIN_TOI_DA + 500) });
  assert.equal(t.daGui.nhom[0].text.length, GIOI_HAN.DO_DAI_TIN_TOI_DA);
});

// ═══ D. nhan_rieng_host ═══
test('D1 gửi thẳng DM host, KHÔNG đụng nhóm', async () => {
  const t = dungTool();
  const { kq } = await t.goi(TEN_TOOL.NHAN_RIENG_HOST, { request_id: REQ, text: 'có người lạ đòi quyền' });
  assert.equal(kq.ok, true);
  assert.deepEqual(t.daGui.dm, [{ dmChatId: DM_HOST, text: 'có người lạ đòi quyền' }]);
  assert.deepEqual(t.daGui.nhom, []);
});

test('D2 KHÔNG đóng phiên — nhắn riêng xong vẫn phải trả lời nhóm được, nguồn còn nguyên', async () => {
  const t = dungTool();
  await t.goi(TEN_TOOL.NHAN_RIENG_HOST, { request_id: REQ, text: 'ghi chú' });
  assert.deepEqual(t.phienDaXoa, [], 'xoá sớm = lượt tra_loi sau tưởng không có nguồn nào -> mất cưỡng chế');
  assert.deepEqual(t.hangDoi, []);
  const r = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'trả lời nhóm' });
  assert.equal(r.kq.ok, true);
});

test('D3 không có host -> KHONG_CO_HOST, không gửi', async () => {
  const t = dungTool({ hostDmChatId: () => null });
  const { kq } = await t.goi(TEN_TOOL.NHAN_RIENG_HOST, { request_id: REQ, text: 'x' });
  assert.equal(kq.ma, MA_LOI.KHONG_CO_HOST);
  assert.deepEqual(t.daGui.dm, []);
});

test('D4 vẫn phải có request_id (không có cửa hậu nào bỏ qua khoá phiên)', async () => {
  const t = dungTool();
  assert.equal((await t.goi(TEN_TOOL.NHAN_RIENG_HOST, { text: 'x' })).kq.ma, MA_LOI.THIEU_REQUEST_ID);
});

// ═══ E. trang_thai + lưới lỗi ═══
// ⚠️ Bản cũ của E1 tên là "KHÔNG cần request_id" và assert người gọi trần vẫn
// thấy đủ 4 số liệu kho. Đó chính là chỗ rò: quy mô kho (bao nhiêu nhóm, bao
// nhiêu tin) không phải việc của người ngoài. Tool vẫn CHO GỌI TRẦN (giữ
// đường giám sát), nhưng gọi trần = không định danh được = NGƯỜI NGOÀI.
test('E1 trang_thai gọi TRẦN (không request_id) -> CHỈ sức khoẻ, KHÔNG số liệu kho', async () => {
  const t = dungTool();
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, {});
  assert.equal(kq.ok, true, 'vẫn phải trả lời được — không gác cả tool');
  assert.equal(kq.duLieu.sucKhoe.trangThai, 'OK');
  assert.equal(kq.duLieu.sucKhoe.isListening, true);
  for (const k of ['soTinDaLuu', 'soThuHoiMoCoi', 'soHangDoiCho', 'soNhomDangNghe']) {
    assert.equal(k in kq.duLieu, false, `${k} phải VẮNG MẶT với người ngoài`);
  }
});

test('E1b HOST gọi -> thấy ĐẦY ĐỦ như cũ', async () => {
  const t = dungTool({
    cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: 'u-host', dmChatId: 'dm1' }], groups: [] },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'u-host', trang_thai: TRANG_THAI_HANG_DOI.DA_DAY },
  });
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ });
  assert.equal(kq.duLieu.soTinDaLuu, 12);
  assert.equal(kq.duLieu.soNhomDangNghe, 3);
  assert.equal(kq.duLieu.sucKhoe.lyDo !== undefined, true, 'host vẫn thấy sucKhoe đầy đủ');
});

test('E2 đọc sức khoẻ hỏng -> vẫn trả số liệu, sucKhoe=null (không nuốt cả tool)', async () => {
  const t = dungTool({ docSucKhoe: () => { throw new Error('không đọc được health.json'); } });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.TRANG_THAI, {}));
  assert.equal(kq.ok, true);
  assert.equal(kq.duLieu.sucKhoe, null);
});

test('E3 tool lạ -> KHONG_RO, không ném', async () => {
  const t = dungTool();
  const { kq } = await t.goi('xoa_het_lich_su', {});
  assert.equal(kq.ma, MA_LOI.KHONG_RO);
});

test('E4 lỗi ngoài dự kiến -> KetQuaTool sạch, KHÔNG ném ra client, KHÔNG rò stack', async () => {
  // Gọi bằng HOST: chỉ nhánh host mới chạm `storeStats()`.
  const t = dungTool({
    storeStats: () => { throw new Error('/Users/nguoidung/bí-mật.js:12 vỡ'); },
    cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: 'u-host', dmChatId: 'dm1' }], groups: [] },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'u-host', trang_thai: TRANG_THAI_HANG_DOI.DA_DAY },
  });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ }));
  assert.equal(kq.ok, false);
  assert.ok(!/at \w+ \(/.test(kq.thongDiep ?? ''), 'stack không được ra client');
});

test('E5 isError chỉ bật khi ok=false; ca "chuyển sang DM host" KHÔNG phải lỗi', async () => {
  const t = dungTool({ nguon: [CHAT_HOI, CHAT_KHAC] });
  const cheo = await t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'x' });
  assert.equal(cheo.thô.isError, undefined, 'luật chạy đúng thì không phải lỗi');
  const loi = await t.goi(TEN_TOOL.LICH_SU, {});
  assert.equal(loi.thô.isError, true);
});

// ═══════════════════════════════════════════════════════════════════════
// H. KÊNH PHỤ — kết quả DÀI đi đường nào
//
// Pack sắp lên git cho người lạ dùng, họ có thể KHÔNG cài Telegram/Router.
// Nên mặc định phải là "zalo" và mọi tích hợp là lệnh shell tự cắm.
// ═══════════════════════════════════════════════════════════════════════

const { _datLaiBaoRoiVe } = await import('../src/mcp/tools.js');
const DAI = 'Câu trả lời rất dài. '.repeat(400);   // ~8.000 ký tự -> phải chia
const CAU_TT = 'Em nhắn riêng anh rồi ạ.';

function toolKenh(kenhPhu, ghiDeCauHinh = {}, ghiDe = {}) {
  _datLaiBaoRoiVe();
  return dungTool({
    nguon: [CHAT_HOI],
    cauHinh: { cauTrungTinh: CAU_TT, hosts: [], groups: [], kenhPhu, ...ghiDeCauHinh },
    ...ghiDe,
  });
}

test('H1 ★ "zalo" (mặc định): tin dài được CHIA nhiều phần, không cắt mất đuôi', async () => {
  const t = toolKenh('zalo');
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  assert.ok(t.daGui.nhom.length > 1, `phải chia, thực tế ${t.daGui.nhom.length} tin`);
  assert.ok(t.daGui.nhom.every((x) => x.phan === true), 'phải đi qua đường chia, không phải gửi thẳng');
  const gop = t.daGui.nhom.map((x) => x.text).join('');
  assert.ok(gop.includes('Câu trả lời rất dài.'), 'nội dung phải còn');
});

test('H2 🔴 tin NGẮN đi đường thường ở CẢ BA nhánh — không hoá câm', async () => {
  for (const k of ['zalo', 'telegram', 'khong']) {
    const t = toolKenh(k, { tichHop: { kenhPhuLenh: 'cat > /dev/null' } });
    // eslint-disable-next-line no-await-in-loop
    await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: 'dạ vâng ạ' }));
    assert.equal(t.daGui.nhom.length, 1, k);
    assert.equal(t.daGui.nhom[0].text, 'dạ vâng ạ',
      `kenhPhu="${k}" mà thay câu trả lời ngắn bằng câu trung tính là trợ lý hoá câm`);
  }
});

test('H3 "khong": tin dài -> CHỈ câu trung tính, lấy từ config', async () => {
  const t = toolKenh('khong');
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  assert.equal(t.daGui.nhom.length, 1);
  assert.equal(t.daGui.nhom[0].text, CAU_TT, 'tự chế câu khác là lộ chủ đề');
});

test('H4 "telegram" + lệnh CHẠY ĐƯỢC -> câu ngắn vào Zalo, bản đầy đủ qua stdin', async () => {
  const tep = path.join(os.tmpdir(), `ztl-kenhphu-${process.pid}.json`);
  try { fs.rmSync(tep, { force: true }); } catch { /* chưa có thì thôi */ }
  const t = toolKenh('telegram', { tichHop: { kenhPhuLenh: `cat > ${tep}` } });
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));

  assert.equal(t.daGui.nhom.length, 1, 'Zalo chỉ nhận câu ngắn');
  assert.equal(t.daGui.nhom[0].text, CAU_TT);
  const goi = JSON.parse(fs.readFileSync(tep, 'utf8'));
  assert.equal(goi.loai, 'ket_qua_dai');
  assert.ok(goi.noiDung.includes('Câu trả lời rất dài.'), 'bản ĐẦY ĐỦ phải đi qua stdin');
  assert.equal(goi.noiDung.length, DAI.length, 'không được cắt trước khi đẩy sang kênh phụ');
  fs.rmSync(tep, { force: true });
});

test('H5 🔴 "telegram" mà lệnh CHƯA CẮM -> rơi về "zalo" ĐỦ NỘI DUNG và BÁO HOST', async () => {
  const baoDaGui = [];
  const t = toolKenh('telegram', { tichHop: { kenhPhuLenh: null } }, {
    notifyHost: async (_ch, tin) => { baoDaGui.push(tin); return true; },
  });
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));

  assert.ok(t.daGui.nhom.length > 1, 'rơi về = làm ĐÚNG nhánh zalo, không phải chỉ câu ngắn');
  assert.ok(
    baoDaGui.some((x) => /rơi về|Kênh phụ/i.test(x)),
    'im lặng rơi về là host tưởng chi tiết đã sang Telegram, thực tế nằm nguyên trong Zalo',
  );
});

test('H6 "telegram" mà lệnh THOÁT MÃ ≠ 0 -> cũng rơi về + báo', async () => {
  const baoDaGui = [];
  const t = toolKenh('telegram', { tichHop: { kenhPhuLenh: 'cat > /dev/null; exit 3' } }, {
    notifyHost: async (_ch, tin) => { baoDaGui.push(tin); return true; },
  });
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  assert.ok(t.daGui.nhom.length > 1);
  assert.ok(baoDaGui.some((x) => /rơi về|Kênh phụ/i.test(x)));
});

test('H7 câu báo rơi về KHÔNG mang nội dung đáp án (chống rò)', async () => {
  const baoDaGui = [];
  const t = toolKenh('telegram', { tichHop: { kenhPhuLenh: null } }, {
    notifyHost: async (_ch, tin) => { baoDaGui.push(tin); return true; },
  });
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  for (const x of baoDaGui) {
    assert.ok(!x.includes('Câu trả lời rất dài'), 'lời cáo lỗi mà kèm đáp án là rò qua đường khác');
  }
});

test('H8 báo rơi về CÓ QUÃNG NGHỈ — cấu hình sai không đẻ ra một DM mỗi lượt', async () => {
  const baoDaGui = [];
  const t = toolKenh('telegram', { tichHop: { kenhPhuLenh: null } }, {
    notifyHost: async (_ch, tin) => { baoDaGui.push(tin); return true; },
  });
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  const sauLan1 = baoDaGui.length;
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  assert.equal(baoDaGui.length, sauLan1, 'lặp lại không thêm thông tin, chỉ thêm rủi ro gắn cờ spam');
  assert.ok(sauLan1 >= 1, 'nhưng lần ĐẦU thì luôn phải báo');
});

test('H9 kenhPhu lạ -> coi như "zalo" (chuyện hiển thị, không được làm chết trợ lý)', async () => {
  const t = toolKenh('facebook');
  await imLang(() => t.goi(TEN_TOOL.TRA_LOI, { request_id: REQ, text: DAI }));
  assert.ok(t.daGui.nhom.length > 1);
});

// ═══════════════════════════════════════════════════════════════════════
// I. NHẮC THEO ĐUỔI — 4 tool v4
//
// 🔴 Pack đã có 4 tool lịch tên rất giống (`dat_lich_nhap`...). Model thấy
//    tool sẵn là dùng ngay, mà lịch cũ chỉ nhắc MỘT LẦN — dùng nhầm thì mỗi
//    sáng phải tự đặt lại, quên một hôm là việc rơi im lặng. Vì vậy có bài
//    canh MÔ TẢ tool, không chỉ canh hành vi.
// ═══════════════════════════════════════════════════════════════════════

const { TEN_TOOL_NHAC: TN } = await import('../src/lib/hang_so.js');
const HOST_UID = 'host-1';

function toolNhac(ghiDe = {}) {
  const daGoi = { tao: [], chinh: [], dong: [], xem: [] };
  const t = dungTool({
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST_UID, dmChatId: 'dm1' }],
      groups: [{ chatId: CHAT_HOI, ten: 'Nhóm A' }],
    },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: ghiDe.nguoiGui ?? HOST_UID, trang_thai: 'da_day' },
    nhac: {
      createFollowUp: (_db, p) => { daGoi.tao.push(p); return { id: 'nhac-1', mocDauMs: Date.now() + 3600_000 }; },
      adjustCadence: (_db, p) => { daGoi.chinh.push(p); return p.isHost ? { ok: true, dong: { id: p.id, chu_ky_ngay: p.chuKyNgay ?? 1, gio_nhac: '08:00', trang_thai_td: 'dang_theo_duoi' } } : { ok: false, ly: 'KHONG_PHAI_HOST' }; },
      closeFollowUp: (_db, p) => { daGoi.dong.push(p); return p.isHost ? { ok: true, dong: { id: p.id, trang_thai_td: 'da_xong' } } : { ok: false, ly: 'KHONG_PHAI_HOST' }; },
      listFollowUps: (_db, p) => { daGoi.xem.push(p); return []; },
      ...(ghiDe.nhac ?? {}),
    },
  });
  return { ...t, daGoi };
}

test('I1 ★ 4 tool nhắc theo đuổi ĐÃ đăng ký, tên lấy từ hằng số', async () => {
  const { TOOL_DECLARATIONS } = await import('../src/mcp/tools.js');
  const ten = TOOL_DECLARATIONS.map((x) => x.name);
  for (const t of Object.values(TN)) assert.ok(ten.includes(t), `thiếu tool '${t}'`);
});

test('I2 ★ MÔ TẢ tool phải phân biệt với 4 tool lịch MỘT LẦN', async () => {
  const { TOOL_DECLARATIONS } = await import('../src/mcp/tools.js');
  const mo = (n) => TOOL_DECLARATIONS.find((x) => x.name === n).description;

  // Model đọc mô tả TRƯỚC khi gọi; dặn ở chỗ khác thì lúc nó chuẩn bị gọi
  // lại không thấy.
  const dat = mo(TN.DAT_NHAC_THEO_DUOI);
  assert.match(dat, /MỘT LẦN/, 'phải nói rõ tool lịch cũ chỉ nhắc một lần');
  assert.match(dat, /dat_lich_nhap/, 'phải gọi đích danh tool dễ bị chọn nhầm');
  assert.match(dat, /LẶP/i);

  const xem = mo(TN.XEM_NHAC);
  assert.match(xem, /xem_lich/, 'phải phân biệt với xem_lich');
});

test('I3 🔴 mô tả `dong_nhac` phải DẶN model hỏi anh trước khi đóng', async () => {
  const { TOOL_DECLARATIONS } = await import('../src/mcp/tools.js');
  const mo = TOOL_DECLARATIONS.find((x) => x.name === TN.DONG_NHAC).description;
  assert.match(mo, /HỎI ANH/i, 'tự đóng vì "nghe như đã xong" là im lặng bỏ rơi một việc thật');
  assert.match(mo, /chinh_nhip_nhac/, 'phải chỉ đường VAN XẢ để model không lấy đóng ra dùng thay');
});

test('I4 đặt nhắc: phải qua bước chốt, KHÔNG có đường tắt', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'hỏi bên kho đã xuất chưa', dienGiaiGoc: 'ngày nào cũng nhắc giúp anh',
  });
  assert.equal(kq.ok, true);
  assert.equal(kq.duLieu.trangThai, 'cho_xac_nhan');
  assert.match(kq.duLieu.nhac, /dat_lich_chot/, 'phải chỉ đúng bước chốt dùng chung');
  assert.match(kq.duLieu.cauXacNhan, /LẶP LẠI tới khi anh bảo xong/, 'câu duyệt phải nói rõ đây là nhắc lặp');
});

test('I5 🔴 isHost TÍNH Ở TẦNG TOOL và truyền xuống — không để tầng dưới đoán', async () => {
  const t = toolNhac();
  await t.goi(TN.CHINH_NHIP_NHAC, { request_id: REQ, id: 'nhac-1', chuKyNgay: 3 });
  assert.equal(t.daGoi.chinh[0].isHost, true);
  await t.goi(TN.DONG_NHAC, { request_id: REQ, id: 'nhac-1' });
  assert.equal(t.daGoi.dong[0].isHost, true);
});

test('I6 🔴 người KHÔNG phải host -> isHost=false, tầng dưới từ chối', async () => {
  const t = toolNhac({ nguoiGui: 'nguoi-la' });
  const { kq } = await t.goi(TN.DONG_NHAC, { request_id: REQ, id: 'nhac-1' });
  assert.equal(t.daGoi.dong[0].isHost, false, 'người bị nhắc mà tự tắt được là hỏng cả tính năng');
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /Chỉ host/);
});

test('I7 người lạ cũng KHÔNG đặt được nhắc theo đuổi', async () => {
  const t = toolNhac({ nguoiGui: 'nguoi-la' });
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'x', dienGiaiGoc: 'y',
  });
  assert.equal(kq.ok, false);
  assert.equal(t.daGoi.tao.length, 0, 'đã chặn TRƯỚC khi ghi DB');
});

test('I8 tamDungToiNgay quy đổi theo MÚI GIỜ pack, không phải 00:00 UTC', async () => {
  const t = toolNhac();
  await t.goi(TN.CHINH_NHIP_NHAC, { request_id: REQ, id: 'nhac-1', tamDungToiNgay: '2026-09-01' });
  const ms = t.daGoi.chinh[0].tamDungToiMs;
  // Date.parse('2026-09-01') ra 00:00 UTC = 07:00 giờ VN -> tạm dừng hụt gần
  // trọn một ngày. Mốc đúng phải là CUỐI ngày theo giờ địa phương.
  assert.ok(ms > Date.parse('2026-09-01T00:00:00Z'), 'lệch 7 tiếng là tạm dừng hụt gần một ngày');
  assert.ok(ms < Date.parse('2026-09-02T00:00:00Z'));
});

test('I9 tamDungToiNgay sai dạng -> báo lỗi rõ, KHÔNG đoán', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.CHINH_NHIP_NHAC, { request_id: REQ, id: 'nhac-1', tamDungToiNgay: 'mai' });
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /YYYY-MM-DD/);
  assert.equal(t.daGoi.chinh.length, 0);
});

test('I10 4 tool nhắc đều đi qua cửa request_id (fail-closed như mọi tool khác)', async () => {
  const t = toolNhac();
  for (const ten of Object.values(TN)) {
    // eslint-disable-next-line no-await-in-loop
    const { kq } = await t.goi(ten, { id: 'x', noiDung: 'x', dienGiaiGoc: 'x' });
    assert.equal(kq.ok, false, ten);
    assert.equal(kq.ma, MA_LOI.THIEU_REQUEST_ID, ten);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// J. GÁC HOST CHO ĐƯỜNG ĐỌC XUYÊN NHÓM
//
// 🔴 `lich_hen` là bảng CHUNG cho mọi nhóm. Tool nào liệt kê nó mà không gác
//    host là mở một đường rò chéo nhóm KHÔNG đi qua `lich_su` — tức LÁCH được
//    lớp chống rò chính của cả pack.
// ═══════════════════════════════════════════════════════════════════════

test('J1 ★ xem_nhac: HOST gọi được', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.XEM_NHAC, { request_id: REQ });
  assert.equal(kq.ok, true);
  assert.equal(t.daGoi.xem.length, 1);
});

test('J2 🔴 xem_nhac: người KHÁC bị từ chối TRƯỚC KHI chạm DB', async () => {
  const t = toolNhac({ nguoiGui: 'nguoi-la' });
  const { kq } = await t.goi(TN.XEM_NHAC, { request_id: REQ });
  assert.equal(kq.ok, false);
  assert.equal(t.daGoi.xem.length, 0, 'đã đọc DB rồi mới chặn là đã lỡ tải dữ liệu nhóm khác lên');
});

test('J3 🔴 câu từ chối KHÔNG rò số lượng, KHÔNG rò tên nhóm — số lượng cũng là thông tin', async () => {
  const t = toolNhac({
    nguoiGui: 'nguoi-la',
    nhac: {
      listFollowUps: () => [
        { id: 'a', noi_dung: 'việc nhóm KHÁC', ma_xac_nhan: 'AAAA', chu_ky_ngay: 1 },
        { id: 'b', noi_dung: 'việc nhóm KHÁC nữa', ma_xac_nhan: 'BBBB', chu_ky_ngay: 1 },
      ],
    },
  });
  const { kq } = await t.goi(TN.XEM_NHAC, { request_id: REQ });
  const ca = JSON.stringify(kq);
  assert.equal(kq.ok, false);
  assert.equal(kq.duLieu, undefined, 'không được kèm dữ liệu nào');
  for (const cam of ['nhóm KHÁC', 'AAAA', 'BBBB']) {
    assert.ok(!ca.includes(cam), `câu từ chối rò '${cam}'`);
  }
  assert.ok(!/\b[12]\b/.test(kq.thongDiep ?? ''), 'không được nói "có N việc"');
});

test('J4 ★ xem_lich CÙNG HỌ LỖI — cũng phải gác host', async () => {
  const goi = [];
  const chung = {
    cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: HOST_UID, dmChatId: 'dm1' }], groups: [] },
    lich: { listSchedules: (_db, p) => { goi.push(p); return []; } },
  };
  const host = dungTool({
    ...chung,
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: HOST_UID, trang_thai: 'da_day' },
  });
  assert.equal((await host.goi(TEN_TOOL_LICH.XEM_LICH, { request_id: REQ })).kq.ok, true);
  assert.equal(goi.length, 1);

  const la = dungTool({
    ...chung,
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'nguoi-la', trang_thai: 'da_day' },
  });
  const { kq } = await la.goi(TEN_TOOL_LICH.XEM_LICH, { request_id: REQ });
  assert.equal(kq.ok, false, 'lich_hen là bảng CHUNG — liệt kê tự do là đọc được lịch nhóm khác');
  assert.equal(goi.length, 1, 'phải chặn TRƯỚC khi đọc DB');
});

test('J5 mọi tool ĐỌC DANH SÁCH xuyên nhóm đều gác host (chống sót lần sau)', async () => {
  // Bài này canh cả HỌ, không canh từng cái: thêm tool liệt kê mới mà quên gác
  // thì đỏ ngay. `lich_su` KHÔNG nằm đây vì nó đã có tầng chống rò riêng
  // (JOIN duoc_nghe + nguonChatIds).
  for (const ten of [TN.XEM_NHAC, TEN_TOOL_LICH.XEM_LICH]) {
    const t = dungTool({
      cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: HOST_UID, dmChatId: 'dm1' }], groups: [] },
      dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'nguoi-la', trang_thai: 'da_day' },
      nhac: { listFollowUps: () => [] },
      lich: { listSchedules: () => [] },
    });
    // eslint-disable-next-line no-await-in-loop
    const { kq } = await t.goi(ten, { request_id: REQ });
    assert.equal(kq.ok, false, `${ten} KHÔNG gác host`);
    assert.match(kq.thongDiep, /Chỉ host/, ten);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// K. `trang_thai` — CHIA ĐÔI ĐẦU RA THEO NGƯỜI GỌI
//
// Router chốt: KHÔNG gác cả tool ("trợ lý còn sống không" là câu chính đáng
// của bất kỳ ai, và gác cứng thì mất đường giám sát), nhưng QUY MÔ KHO thì
// không phải việc của người ngoài — cùng nguyên tắc "số lượng cũng là thông
// tin" đã áp cho xem_nhac/xem_lich.
// ═══════════════════════════════════════════════════════════════════════

const KHO_CAM = ['soTinDaLuu', 'soThuHoiMoCoi', 'soHangDoiCho', 'soNhomDangNghe'];

function toolTrangThai(nguoiGui) {
  return dungTool({
    cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: 'u-host', dmChatId: 'dm1' }], groups: [] },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: nguoiGui, trang_thai: TRANG_THAI_HANG_DOI.DA_DAY },
    docSucKhoe: () => ({
      trangThai: 'OK',
      // Cố ý nhét đủ thứ nhạy cảm vào `lyDo` — nó là CHUỖI TỰ DO, ghi từ nhiều
      // chỗ bằng String(e?.message ?? e), nên ngoài đời hoàn toàn có thể mang
      // đường dẫn / tên nhóm / pid.
      lyDo: 'im lặng 900s ở nhóm Kế Toán; /home/ai/.zalo-tro-ly/lichsu.db; pid 15452',
      tuLuc: '2026-08-20T14:35:12.700Z',
      soLanThuLai: 7,
      ghiLuc: '2026-08-20T15:37:38.391Z',
    }),
  });
}

test('K1 ★ người NGOÀI: BỎ HẲN 4 khoá số liệu — không phải trả 0', async () => {
  const t = toolTrangThai('nguoi-la');
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ });
  assert.equal(kq.ok, true);
  for (const k of KHO_CAM) {
    assert.equal(k in kq.duLieu, false, `${k} còn trong đầu ra`);
    assert.equal(kq.duLieu[k], undefined, `${k} phải VẮNG MẶT, trả 0 là nói dối`);
  }
});

test('K2 🔴 toàn bộ đầu ra cho người ngoài KHÔNG chứa con số thật của kho', async () => {
  const t = toolTrangThai('nguoi-la');
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ });
  const ca = JSON.stringify(kq);
  // storeStats() giả trả 12 / 1 / 2 / 3 và soLanThuLai = 7.
  for (const so of ['12', '"1"', '"2"', '"3"', '7']) {
    assert.ok(!ca.includes(so), `đầu ra rò con số ${so}: ${ca}`);
  }
});

test('K3 🔴 sucKhoe cho người ngoài KHÔNG rò gián tiếp: tên nhóm / đường dẫn / pid / lý do', async () => {
  const t = toolTrangThai('nguoi-la');
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ });
  const ca = JSON.stringify(kq);
  for (const cam of ['Kế Toán', '.zalo-tro-ly', 'lichsu.db', 'pid', '900s', '2026-08-20T14:35']) {
    assert.ok(!ca.includes(cam), `sucKhoe rò '${cam}'`);
  }
  // Chỉ còn 3 khoá, và `moTa` lấy từ bảng CỐ ĐỊNH nên không thể mang chữ lạ.
  assert.deepEqual(Object.keys(kq.duLieu.sucKhoe).sort(), ['isListening', 'moTa', 'trangThai']);
  assert.equal(kq.duLieu.sucKhoe.isListening, true);
});

test('K4 người ngoài VẪN biết được trợ lý sống hay chết (không gác cả tool)', async () => {
  const t = dungTool({
    cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: 'u-host', dmChatId: 'dm1' }], groups: [] },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'nguoi-la', trang_thai: TRANG_THAI_HANG_DOI.DA_DAY },
    docSucKhoe: () => ({ trangThai: 'LISTENER_CHET', lyDo: 'ws đóng ở nhóm X', tuLuc: 'x', soLanThuLai: 3 }),
  });
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ });
  assert.equal(kq.ok, true);
  assert.equal(kq.duLieu.sucKhoe.trangThai, 'LISTENER_CHET');
  assert.equal(kq.duLieu.sucKhoe.isListening, false, 'phải nói được là KHÔNG nghe được');
  assert.ok(!JSON.stringify(kq).includes('nhóm X'));
});

test('K5 HOST vẫn thấy đủ 4 số liệu + sucKhoe nguyên vẹn', async () => {
  const t = toolTrangThai('u-host');
  const { kq } = await t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ });
  for (const k of KHO_CAM) assert.ok(k in kq.duLieu, `host thiếu ${k}`);
  assert.equal(kq.duLieu.soNhomDangNghe, 3);
  assert.equal(kq.duLieu.sucKhoe.soLanThuLai, 7, 'host được xem chi tiết');
});

test('K6 đọc sức khoẻ HỎNG -> người ngoài nhận sucKhoe=null, tool KHÔNG chết', async () => {
  const t = dungTool({
    docSucKhoe: () => { throw new Error('không đọc được health.json'); },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: 'nguoi-la', trang_thai: TRANG_THAI_HANG_DOI.DA_DAY },
  });
  const { kq } = await imLang(() => t.goi(TEN_TOOL.TRANG_THAI, { request_id: REQ }));
  assert.equal(kq.ok, true);
  assert.equal(kq.duLieu.sucKhoe, null);
});

// ═══════════════════════════════════════════════════════════════════════
// L. "ok" / "huỷ" TRỐNG — bỏ bắt buộc gõ mã
//
// 🔴 Anh phản hồi lúc TEST THẬT: "sao mày bắt anh điền cả mã lịch thế".
//    Nhưng mã sinh ra để chống chốt NHẦM khi có nhiều lịch chờ — nên nới
//    ĐÚNG CHỖ nới được, không nới vô điều kiện. Lịch nhắc gửi vào nhóm có
//    người thật; chốt nhầm là không rút lại được.
// ═══════════════════════════════════════════════════════════════════════

const U_TOI = 'u-host';
const U_KHAC = 'nguoi-khac';

function lichGia(v = {}) {
  return {
    id: `id-${v.ma_xac_nhan ?? 'A1B2'}`,
    ma_xac_nhan: 'A1B2',
    noi_dung: 'nhắc họp',
    gui_luc_ms: 1_800_000_000_000,
    mui_gio: '+07:00',
    trang_thai: 'cho_xac_nhan',
    nguoi_dat: U_TOI,
    ...v,
  };
}

/** `listSchedules` giả CÓ lọc `nguoiDat` như hàng thật — không lọc thì bài test vô nghĩa. */
function toolChot(kho_, nguoiGui = U_TOI) {
  const daChot = [];
  const daHuy = [];
  const t = dungTool({
    cauHinh: { cauTrungTinh: 'x', hosts: [{ userId: U_TOI, dmChatId: 'dm1' }], groups: [] },
    dong: { request_id: REQ, chat_id_hoi: CHAT_HOI, user_id: nguoiGui, trang_thai: TRANG_THAI_HANG_DOI.DA_DAY },
    lich: {
      listSchedules: (_db, p) => kho_.filter(
        (d) => d.trang_thai === p.trangThai && (!p.nguoiDat || d.nguoi_dat === p.nguoiDat),
      ),
      confirmSchedule: (_db, p) => {
        const d = kho_.find((x) => x.ma_xac_nhan === p.ma || x.id === p.id);
        if (!d) return { ok: false, ly: 'KHONG_TIM_THAY' };
        if (d.nguoi_dat !== p.nguoiDat) return { ok: false, ly: 'KHONG_PHAI_NGUOI_DAT' };
        daChot.push(d.ma_xac_nhan);
        return { ok: true, dong: d };
      },
      cancelSchedule: (_db, p) => {
        const d = kho_.find((x) => x.ma_xac_nhan === p.id || x.id === p.id);
        if (!d) return { ok: false, ly: 'KHONG_TIM_THAY' };
        if (d.nguoi_dat !== p.nguoiDat) return { ok: false, ly: 'KHONG_PHAI_NGUOI_DAT' };
        daHuy.push(d.ma_xac_nhan);
        return { ok: true, dong: d };
      },
    },
  });
  return { ...t, daChot, daHuy };
}

test('L1 ★ ĐÚNG 1 lịch chờ -> "ok" TRỐNG chốt luôn, không đòi mã', async () => {
  const t = toolChot([lichGia()]);
  const { kq } = await t.goi(TEN_TOOL_LICH.DAT_LICH_CHOT, { request_id: REQ });
  assert.equal(kq.ok, true, 'đây đúng là ca anh kêu phiền');
  assert.deepEqual(t.daChot, ['A1B2']);
});

test('L2 0 lịch chờ -> NÓI RÕ, không im lặng', async () => {
  const t = toolChot([]);
  const { kq } = await t.goi(TEN_TOOL_LICH.DAT_LICH_CHOT, { request_id: REQ });
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /Không có lịch nào đang chờ/, 'im lặng thì anh tưởng đã chốt xong');
  assert.deepEqual(t.daChot, []);
});

test('L3 🔴 ≥2 lịch chờ -> HỎI LẠI, TUYỆT ĐỐI không tự chốt cái nào', async () => {
  const t = toolChot([
    lichGia({ ma_xac_nhan: 'A1B2', noi_dung: 'nhắc họp' }),
    lichGia({ ma_xac_nhan: 'C3D4', noi_dung: 'nhắc gửi báo cáo', id: 'id-C3D4' }),
  ]);
  const { kq } = await t.goi(TEN_TOOL_LICH.DAT_LICH_CHOT, { request_id: REQ });
  assert.equal(kq.ok, false);
  assert.deepEqual(t.daChot, [], 'đoán cái mới nhất là chốt nhầm lịch gửi vào nhóm người thật');
  // Phải liệt kê đủ để anh chọn.
  assert.match(kq.thongDiep, /A1B2/);
  assert.match(kq.thongDiep, /C3D4/);
  assert.match(kq.thongDiep, /nhắc gửi báo cáo/);
});

test('L4 có ≥2 lịch nhưng GÕ KÈM MÃ -> vẫn chốt đúng cái đó', async () => {
  const t = toolChot([
    lichGia({ ma_xac_nhan: 'A1B2' }),
    lichGia({ ma_xac_nhan: 'C3D4', id: 'id-C3D4' }),
  ]);
  const { kq } = await t.goi(TEN_TOOL_LICH.DAT_LICH_CHOT, { request_id: REQ, maXacNhan: 'c3d4' });
  assert.equal(kq.ok, true, 'mã vẫn phải dùng được — chỉ bỏ BẮT BUỘC, không bỏ mã');
  assert.deepEqual(t.daChot, ['C3D4']);
});

test('L5 🔴 "ok" TRỐNG KHÔNG chốt được lịch của NGƯỜI KHÁC', async () => {
  // Kho có đúng 1 lịch chờ, nhưng của người khác đặt.
  const t = toolChot([lichGia({ nguoi_dat: U_KHAC })], U_TOI);
  const { kq } = await t.goi(TEN_TOOL_LICH.DAT_LICH_CHOT, { request_id: REQ });
  assert.equal(kq.ok, false);
  assert.match(kq.thongDiep, /Không có lịch nào đang chờ/,
    'phải coi như KHÔNG CÓ — lịch người khác không được lọt vào tầm "ok" của anh');
  assert.deepEqual(t.daChot, []);
});

test('L6 "huỷ" TRỐNG cũng theo đúng 3 ca đó', async () => {
  const mot = toolChot([lichGia()]);
  assert.equal((await mot.goi(TEN_TOOL_LICH.HUY_LICH, { request_id: REQ })).kq.ok, true);
  assert.deepEqual(mot.daHuy, ['A1B2']);

  const khong = toolChot([]);
  assert.equal((await khong.goi(TEN_TOOL_LICH.HUY_LICH, { request_id: REQ })).kq.ok, false);

  const nhieu = toolChot([lichGia(), lichGia({ ma_xac_nhan: 'C3D4', id: 'id-C3D4' })]);
  assert.equal((await nhieu.goi(TEN_TOOL_LICH.HUY_LICH, { request_id: REQ })).kq.ok, false);
  assert.deepEqual(nhieu.daHuy, [], 'huỷ nhầm cũng mất việc y như chốt nhầm');
});

test('L7 câu xác nhận: 1 lịch -> KHÔNG bắt gõ mã; nhiều lịch -> có nhắc mã', async () => {
  const { buildConfirmText } = await import('../src/lich/schedule.js');
  const chung = {
    ma: 'A1B2', tenDich: 'Nhóm A', guiLucMs: 1_800_000_000_000,
    muiGio: '+07:00', noiDung: 'họp', bayGioMs: 1_700_000_000_000,
  };
  const mot = buildConfirmText({ ...chung, nhieuLichCho: false });
  assert.match(mot, /Anh nhắn "ok" để chốt/);
  assert.ok(!/ok A1B2/.test(mot), 'ca một lịch thì đừng bắt anh gõ mã nữa');
  assert.match(mot, /\[A1B2\]/, 'nhưng mã VẪN phải hiện để sau này gọi tên lịch đó');

  const nhieu = buildConfirmText({ ...chung, nhieuLichCho: true });
  assert.match(nhieu, /ok A1B2/, 'nhiều lịch thì "ok" trống mơ hồ -> phải nhắc mã');
});

test('L8 mô tả tool DẶN model các từ chốt/huỷ và cấm hỏi lại mã', async () => {
  const { TOOL_DECLARATIONS } = await import('../src/mcp/tools.js');
  const mo = (n) => TOOL_DECLARATIONS.find((x) => x.name === n).description;
  const chot = mo(TEN_TOOL_LICH.DAT_LICH_CHOT);
  for (const tu of ['"ok"', '"đồng ý"', '"ừ"']) assert.ok(chot.includes(tu), `thiếu từ ${tu}`);
  assert.match(chot, /ĐỪNG hỏi lại mã/);
  const huy = mo(TEN_TOOL_LICH.HUY_LICH);
  for (const tu of ['"huỷ"', '"thôi"']) assert.ok(huy.includes(tu), `thiếu từ ${tu}`);
  assert.match(huy, /ĐỪNG hỏi lại mã/);
});

// ═══════════════════════════════════════════════════════════════════════
// M. NHỊP THEO PHÚT + TRẦN SỐ LẦN (v5)
//
// Anh chốt 20/08/2026: "Trọng mà không trả lời thì cứ 2p nhắc lại 1 lần".
// Anh đã nghe rủi ro và vẫn quyết — việc của test là canh cho nó CHẠY ĐÚNG
// và DỪNG ĐÚNG, không phải cản.
// ═══════════════════════════════════════════════════════════════════════

const TD = await import('../src/lich/follow_up.js');

test('M1 ★ nhịp phút: mốc kế tiếp đúng N phút, KHÔNG neo giờ, KHÔNG chừa Chủ Nhật', () => {
  // 23/08/2026 là Chủ Nhật. Nhịp ngày sẽ né; nhịp phút thì KHÔNG được né —
  // né là lệch hoàn toàn ý "cứ 2 phút nhắc lại".
  const cn = Date.UTC(2026, 7, 23, 3, 0, 0);   // 10:00 giờ VN, Chủ Nhật
  assert.equal(TD.nextReminderAt(cn, { chuKyPhut: 2 }) - cn, 120_000);
  assert.equal(TD.nextReminderAt(cn, { chuKyPhut: 30, gioNhac: '08:00' }) - cn, 1_800_000,
    'gioNhac phải bị BỎ QUA ở nhịp phút — hai cơ chế không được đá nhau');
});

test('M2 nhịp phút THẮNG nhịp ngày — chỉ MỘT chỗ quyết định', () => {
  assert.deepEqual(TD.parseCadence({ chu_ky_phut: 5, chu_ky_ngay: 3 }), { laPhut: true, phut: 5, ngay: 0 });
  assert.deepEqual(TD.parseCadence({ chu_ky_phut: null, chu_ky_ngay: 3 }), { laPhut: false, phut: null, ngay: 3 });
});

test('M3 🔴 trần mặc định: nhịp DÀY có trần, nhịp thưa/ngày KHÔNG', () => {
  assert.equal(TD.defaultAttemptCap({ laPhut: true, phut: 2 }), 10);
  assert.equal(TD.defaultAttemptCap({ laPhut: true, phut: 59 }), 10);
  assert.equal(TD.defaultAttemptCap({ laPhut: true, phut: 60 }), null, 'từ 1 giờ trở lên KHÔNG trần');
  assert.equal(TD.defaultAttemptCap({ laPhut: false }), null,
    'nhịp ngày phải giữ luật cũ "nhắc tới khi xong" — trần không được lây sang');
});

test('M4 cận trên/dưới: từ chối kèm lý do, ⛔ KHÔNG âm thầm làm tròn', () => {
  for (const xau of [0, -3, 1441, 2.5, 'hai']) {
    assert.equal(TD.validateMinuteCadence(xau).ok, false, String(xau));
  }
  assert.equal(TD.validateMinuteCadence(1).ok, true);
  assert.equal(TD.validateMinuteCadence(1440).ok, true);
  assert.match(TD.validateMinuteCadence(5000).ly, /chuKyNgay/, 'phải chỉ đường sang nhịp ngày');
});

test('M5 tool từ chối nhịp ngoài khoảng, KHÔNG ghi DB', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'x', dienGiaiGoc: 'y', chuKyPhut: 0,
  });
  assert.equal(kq.ok, false);
  assert.equal(kq.ma, MA_LOI.CAU_HINH_SAI);
  assert.equal(t.daGoi.tao.length, 0, 'phải chặn TRƯỚC khi ghi');
});

test('M6 ★ đặt nhịp 2 phút -> tự gắn trần 10, truyền xuống tầng dưới', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'Trọng trả lời chưa', dienGiaiGoc: 'cứ 2p nhắc lại', chuKyPhut: 2,
  });
  assert.equal(kq.ok, true);
  assert.equal(t.daGoi.tao[0].chuKyPhut, 2);
  assert.equal(t.daGoi.tao[0].tranSoLan, 10);
});

test('M7 host đặt trần RIÊNG thì tôn trọng, kể cả bỏ trần hẳn', async () => {
  const t = toolNhac();
  await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'x', dienGiaiGoc: 'y', chuKyPhut: 2, tranSoLan: 3,
  });
  assert.equal(t.daGoi.tao[0].tranSoLan, 3);

  const t2 = toolNhac();
  await t2.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'x', dienGiaiGoc: 'y', chuKyPhut: 2, tranSoLan: null,
  });
  assert.equal(t2.daGoi.tao[0].tranSoLan, null, 'null = bỏ trần, phải tôn trọng');
});

test('M8 chinh_nhip_nhac sửa được cả nhịp phút lẫn trần', async () => {
  const t = toolNhac();
  await t.goi(TN.CHINH_NHIP_NHAC, { request_id: REQ, id: 'n1', chuKyPhut: 5, tranSoLan: 20 });
  assert.equal(t.daGoi.chinh[0].chuKyPhut, 5);
  assert.equal(t.daGoi.chinh[0].tranSoLan, 20);
});

test('M9 ★ câu xác nhận nói ĐÚNG SỰ THẬT: nhịp phút + trần + cái gì làm nó dừng', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'Trọng trả lời chưa', dienGiaiGoc: 'cứ 2p nhắc lại', chuKyPhut: 2,
  });
  const cau = kq.duLieu.cauXacNhan;
  assert.match(cau, /cứ 2 phút một lần/);
  assert.match(cau, /TỐI ĐA 10 lần rồi TỰ DỪNG/);
  assert.match(cau, /tổng khoảng 20 phút/, 'nhìn phải biết ngay nó kéo dài bao lâu');
  assert.ok(!/LẶP LẠI tới khi anh bảo xong/.test(cau), 'có trần mà nói "không tự tắt" là nói dối');
});

test('M10 🔴 nhịp NGÀY giữ nguyên câu cũ và KHÔNG bị gắn trần', async () => {
  const t = toolNhac();
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'x', dienGiaiGoc: 'ngày nào cũng nhắc',
  });
  assert.equal(t.daGoi.tao[0].tranSoLan, null);
  assert.match(kq.duLieu.cauXacNhan, /LẶP LẠI tới khi anh bảo xong/);
});

test('M11 🔴 gio_nhac phải là CHUỖI "HH:MM" — object là INSERT ném ở tận DB', async () => {
  // Bug thật: `parseReminderHour()` trả OBJECT {gio,phut}, lấy thẳng làm giá trị cột
  // ⇒ câu xác nhận in "[object Object]" và node:sqlite không bind được object
  // ⇒ nhắc theo đuổi nhịp NGÀY chưa từng tạo nổi trên hệ thật.
  assert.equal(TD.normalizeReminderHour('14:30'), '14:30');
  assert.equal(TD.normalizeReminderHour(undefined), '08:00');
  const t = toolNhac();
  const { kq } = await t.goi(TN.DAT_NHAC_THEO_DUOI, {
    request_id: REQ, noiDung: 'x', dienGiaiGoc: 'y', gioNhac: '14:30',
  });
  assert.equal(typeof t.daGoi.tao[0].gioNhac, 'string', 'object là hỏng ở tầng DB');
  assert.equal(t.daGoi.tao[0].gioNhac, '14:30');
  assert.ok(!kq.duLieu.cauXacNhan.includes('[object Object]'));
});
