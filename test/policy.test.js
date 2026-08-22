/**
 * G4 — test tầng chính sách. Chạy: `npm test` (node --test).
 *
 * Chạy HOÀN TOÀN không cần Zalo, không mạng, không DB, không gói khác:
 * `gate.js` và `leak_guard.decideReplyRoute()` là hàm thuần; `access.js`
 * chỉ chạm đĩa ở `readConfig()` và bài đó dùng file tạm.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_TIMINGS,
  PACK_ROOT,
  stripComments,
  hostUserIds,
  readConfig,
  validateConfig,
  isHost,
  hostDmChatId,
  findGroup,
  isGroupListened,
  groupRepliesOnTag,
  findHostByDm,
} from '../src/policy/access.js';
import { CHO_PHEP_DM, LY_DO as LY_DO_GATE, quyetDinh } from '../src/policy/gate.js';
import {
  LY_DO as LY_DO_LEAK,
  sweepStale,
  recordSources,
  getSources,
  decideReplyRoute,
  createSourceLedger,
  clearSession,
} from '../src/policy/leak_guard.js';
import { HANH_DONG_GATE, HUONG_TRA_LOI } from '../src/lib/hang_so.js';

// ── Đồ nghề ────────────────────────────────────────────────────────────────
const RAC = [];
process.on('exit', () => {
  for (const d of RAC) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* dọn rác hỏng thì thôi */
    }
  }
});

/** Config giả TỐI THIỂU HỢP LỆ — mọi bài bóp méo từ đây ra. */
function chGia(v = {}) {
  return {
    hosts: [{ userId: '111', ten: 'Anh', dmChatId: 'dm-111' }],
    groups: [
      { chatId: 'A', ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true },
      { chatId: 'B', ten: 'Nhóm B', ghiLichSu: true, traLoiKhiTag: false },
    ],
    duongDan: { db: '~/.zalo-tro-ly-test/lichsu.db' },
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    ...v,
  };
}
const CH = validateConfig(chGia());

/** Tin giả đúng hình dạng TinChuanHoa. */
function tinGia(v = {}) {
  return {
    chatId: 'A',
    msgId: 'm1',
    cliMsgId: null,
    userId: '111',
    tenLucGui: 'Anh',
    msgType: 'chat.text',
    noiDung: '@troly xem giúp',
    contentRaw: null,
    tsZalo: 1_700_000_000_000,
    tuToi: false,
    hasHostMention: true,
    ...v,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A. ACCESS — FAIL-CLOSED, thà không chạy còn hơn chạy mở toang
// ═══════════════════════════════════════════════════════════════════════════

test('A1 hosts rỗng / thiếu -> TỪ CHỐI CHẠY', () => {
  assert.throws(() => validateConfig(chGia({ hosts: [] })), /hosts/);
  assert.throws(() => validateConfig(chGia({ hosts: undefined })), /hosts/);
  assert.throws(() => validateConfig(null), /rỗng hoặc không phải object/);
});

test('A2 ★ ký tự đại diện ở BẤT KỲ id nào -> TỪ CHỐI CHẠY', () => {
  const ca = [
    ['hosts[0].userId', { hosts: [{ userId: '*', dmChatId: 'd' }] }],
    ['hosts[0].dmChatId', { hosts: [{ userId: '1', dmChatId: '*' }] }],
    ['groups[0].chatId', { groups: [{ chatId: '*' }] }],
    ['groups[0].chatId ?', { groups: [{ chatId: 'a?b' }] }],
    ['groups[0].chatId %', { groups: [{ chatId: '%' }] }],
    ['groups[0].chatId _', { groups: [{ chatId: 'a_b' }] }],
    ['chữ "all"', { groups: [{ chatId: 'all' }] }],
    ['chữ "ALL" hoa', { groups: [{ chatId: 'ALL' }] }],
    ['chữ "any"', { hosts: [{ userId: 'any', dmChatId: 'd' }] }],
  ];
  for (const [ten, v] of ca) {
    assert.throws(() => validateConfig(chGia(v)), /MỞ TOANG|phải là chuỗi/, `lọt: ${ten}`);
  }
});

test('A3 id rỗng / không phải chuỗi -> TỪ CHỐI (ID Zalo phải là TEXT)', () => {
  assert.throws(() => validateConfig(chGia({ hosts: [{ userId: '', dmChatId: 'd' }] })), /chuỗi khác rỗng/);
  assert.throws(() => validateConfig(chGia({ hosts: [{ userId: '   ', dmChatId: 'd' }] })), /chuỗi khác rỗng/);
  // Số vượt MAX_SAFE_INTEGER: để dạng number là đã mất chính xác TỪ TRƯỚC khi
  // tới đây -> phải chặn ngay ở config chứ không âm thầm String() lại.
  assert.throws(
    () => validateConfig(chGia({ hosts: [{ userId: 9990000000001123, dmChatId: 'd' }] })),
    /phải là chuỗi/,
  );
});

test('A4 thiếu dmChatId của host -> TỪ CHỐI (luật chống rò chéo mất chỗ gửi)', () => {
  assert.throws(() => validateConfig(chGia({ hosts: [{ userId: '111' }] })), /dmChatId/);
});

test('A5 thiếu cauTrungTinh -> TỪ CHỐI', () => {
  assert.throws(() => validateConfig(chGia({ cauTrungTinh: '' })), /cauTrungTinh/);
  assert.throws(() => validateConfig(chGia({ cauTrungTinh: undefined })), /cauTrungTinh/);
});

test('A6 ★ duongDan.db nằm TRONG pack -> TỪ CHỐI (vô hiệu hoá mức siết CAO)', () => {
  assert.throws(
    () => validateConfig(chGia({ duongDan: { db: path.join(PACK_ROOT, 'data', 'lichsu.db') } })),
    /NGUY HIỂM|TRONG thư mục pack/,
  );
  // Đường dẫn tương đối cũng phải bị bắt — đây là dạng người ta hay gõ nhất.
  const cwd = process.cwd();
  try {
    process.chdir(PACK_ROOT);
    assert.throws(() => validateConfig(chGia({ duongDan: { db: './lichsu.db' } })), /NGUY HIỂM/);
  } finally {
    process.chdir(cwd);
  }
});

test('A7 id trùng nhau -> TỪ CHỐI (allowlist mơ hồ)', () => {
  assert.throws(
    () => validateConfig(chGia({ hosts: [
      { userId: '1', dmChatId: 'a' }, { userId: '1', dmChatId: 'b' },
    ] })),
    /trùng nhau/,
  );
  assert.throws(
    () => validateConfig(chGia({ groups: [{ chatId: 'A' }, { chatId: 'A' }] })),
    /trùng nhau/,
  );
});

test('A8 mặc định AN TOÀN: traLoiKhiTag thiếu -> false, ghiLichSu thiếu -> true', () => {
  const ch = validateConfig(chGia({ groups: [{ chatId: 'Z', ten: 'Z' }] }));
  assert.equal(ch.groups[0].traLoiKhiTag, false, 'im lặng phải là mặc định');
  assert.equal(ch.groups[0].ghiLichSu, true);
});

test('A9 khoá bắt đầu bằng _ là GHI CHÚ, phải bỏ qua (đệ quy)', () => {
  const sach = stripComments({
    _ghi_chu: ['đừng đọc tôi'],
    hosts: [{ _note: 'x', userId: '111', dmChatId: 'dm' }],
    duongDan: { _x: 1, db: '~/a.db' },
  });
  assert.equal('_ghi_chu' in sach, false);
  assert.equal('_note' in sach.hosts[0], false);
  assert.equal('_x' in sach.duongDan, false);
  assert.equal(sach.hosts[0].userId, '111');
});

test('A10 file .example.json THẬT phải qua được validate (bản mẫu không được hỏng)', () => {
  const mau = JSON.parse(
    fs.readFileSync(path.join(PACK_ROOT, 'config', 'assistant.config.example.json'), 'utf8'),
  );
  const ch = validateConfig(stripComments(mau));
  assert.equal(ch.hosts.length, 1);
  assert.equal(ch.cauTrungTinh.length > 0, true);
  assert.equal(ch.anTrangThai, true);
});

test('A11 thoiGian thiếu/rác -> dùng mặc định, KHÔNG nổ', () => {
  assert.deepEqual(validateConfig(chGia()).thoiGian, DEFAULT_TIMINGS);
  const ch = validateConfig(chGia({ thoiGian: { queueTtlMs: 'ba mươi phút', keepAliveMs: 5000 } }));
  assert.equal(ch.thoiGian.queueTtlMs, DEFAULT_TIMINGS.queueTtlMs);
  assert.equal(ch.thoiGian.keepAliveMs, 5000);
});

test('A12 readConfig: thiếu file -> lỗi ĐỌC ĐƯỢC, có hướng dẫn', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cfg-'));
  RAC.push(d);
  assert.throws(() => readConfig(path.join(d, 'khong-co.json')), /Không thấy file cấu hình/);
  fs.writeFileSync(path.join(d, 'vo.json'), '{ hỏng');
  assert.throws(() => readConfig(path.join(d, 'vo.json')), /không phải JSON hợp lệ/);
});

test('A13 readConfig đọc file thật + nở ~ trong đường dẫn', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cfg-'));
  RAC.push(d);
  const p = path.join(d, 'ch.json');
  fs.writeFileSync(p, JSON.stringify(chGia()));
  const ch = readConfig(p);
  assert.equal(path.isAbsolute(ch.duongDan.db), true, 'dấu ~ chưa được nở');
  assert.equal(ch.duongDan.db.includes('~'), false);
  assert.equal(ch.duongDan.health.endsWith('health.json'), true, 'health thiếu thì phải có mặc định');
});

test('A14 ZTL_DATA_DIR THẮNG duongDan trong config', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-data-'));
  RAC.push(d);
  const cu = process.env.ZTL_DATA_DIR;
  try {
    process.env.ZTL_DATA_DIR = d;
    const ch = validateConfig(chGia({ duongDan: { db: '~/bi-bo-qua.db' } }));
    assert.equal(ch.duongDan.db, path.join(d, 'lichsu.db'));
    assert.equal(ch.duongDan.session, path.join(d, 'session.json'));
    assert.equal(ch.duongDan.health, path.join(d, 'health.json'));
  } finally {
    if (cu === undefined) delete process.env.ZTL_DATA_DIR;
    else process.env.ZTL_DATA_DIR = cu;
  }
});

test('A15 tra cứu: isHost / nhóm / dm', () => {
  assert.equal(isHost(CH, '111'), true);
  assert.equal(isHost(CH, '999'), false);
  assert.equal(isHost(CH, null), false);
  // Lệch KIỂU string/number vẫn phải khớp — mọi so sánh đi qua toId().
  assert.equal(isHost(CH, 111), true, 'so chuỗi trần -> trượt bẫy lệch kiểu');
  assert.equal(isGroupListened(CH, 'A'), true);
  assert.equal(isGroupListened(CH, 'Z'), false);
  assert.equal(groupRepliesOnTag(CH, 'A'), true);
  assert.equal(groupRepliesOnTag(CH, 'B'), false, 'B tắt trả lời');
  assert.equal(groupRepliesOnTag(CH, 'Z'), false, 'nhóm lạ phải là false');
  assert.equal(hostDmChatId(CH, '111'), 'dm-111');
  assert.equal(hostDmChatId(CH, '999'), null);
  assert.equal(findHostByDm(CH, 'dm-111')?.userId, '111');
  assert.equal(findHostByDm(CH, 'A'), null);
  assert.deepEqual(hostUserIds(CH), ['111']);
  assert.equal(findGroup(CH, 'B')?.ten, 'Nhóm B');
});

// ═══════════════════════════════════════════════════════════════════════════
// B. GATE — im lặng là mặc định
// ═══════════════════════════════════════════════════════════════════════════

const bo = (t) => quyetDinh(t, CH);

test('B1 host tag trong nhóm được nghe -> ALLOW', () => {
  const kq = bo(tinGia());
  assert.equal(kq.action, HANH_DONG_GATE.ALLOW);
  assert.equal(kq.payload.chatId, 'A');
  assert.equal(kq.payload.lyDo, LY_DO_GATE.HOST_TAG_TRONG_NHOM);
});

test('B2 [ĐỔI v9] người KHÔNG phải host -> NGHE (trước v9: DROP), vẫn IM', () => {
  // 🔴 HÀNH VI ĐỔI CÓ CHỦ ĐÍCH, anh chốt 21/08/2026: trợ lý phải LUÔN THEO KỊP
  // NHÓM. Tin người khác nay TẠO MỘT LƯỢT thay vì bị vứt.
  // ⚠️ Nhưng luật "im trong nhóm trừ khi host tag" KHÔNG ĐỔI MỘT CHỮ — nó
  // chuyển từ *"không nghe"* sang *"nghe mà không nói"*. Bài `S*` trong
  // cum12 canh phần "không nói" bằng cách đếm tin ĐI RA.
  const kq = bo(tinGia({ userId: '9990000000999' }));
  assert.equal(kq.action, HANH_DONG_GATE.NGHE);
  assert.equal(kq.payload.lyDo, LY_DO_GATE.NGHE_NGUOI_KHAC);
  // Vẫn phải IM tại chỗ: không có text nào để lỡ gửi ra ngoài.
  assert.equal(kq.payload.text, undefined);
});

test('B3 host nhưng KHÔNG tag -> DROP (spec B)', () => {
  assert.equal(bo(tinGia({ hasHostMention: false })).payload.lyDo, LY_DO_GATE.KHONG_TAG);
  assert.equal(bo(tinGia({ hasHostMention: undefined })).payload.lyDo, LY_DO_GATE.KHONG_TAG);
});

test('B4 nhóm ngoài allowlist -> DROP, kể cả host có tag', () => {
  assert.equal(bo(tinGia({ chatId: 'Z' })).payload.lyDo, LY_DO_GATE.NHOM_NGOAI_ALLOWLIST);
});

test('B5 nhóm traLoiKhiTag=false -> DROP dù host tag đúng', () => {
  assert.equal(bo(tinGia({ chatId: 'B' })).payload.lyDo, LY_DO_GATE.NHOM_TAT_TRA_LOI);
});

test('B6 ★ tin của HOST có tuToi=true VẪN ALLOW (trợ lý chạy trên tài khoản host)', () => {
  // Đây là ca sống-chết của cả hệ: spec chốt "giao toàn bộ quyền đăng nhập
  // zalo web cho tool" ⇒ anh gõ trong nhóm thì tin về với isSelf = true.
  // Bỏ mù theo tuToi là trợ lý CÂM VĨNH VIỄN mà không có lỗi nào để lần ra.
  const kq = bo(tinGia({ tuToi: true }));
  assert.equal(kq.action, HANH_DONG_GATE.ALLOW, 'luật "tuToi -> drop" đang giết đường kích hoạt');
});

test('B7 tin tự gửi từ tài khoản KHÔNG phải host -> DROP (chống vòng lặp)', () => {
  const kq = bo(tinGia({ tuToi: true, userId: 'bot-la' }));
  assert.equal(kq.payload.lyDo, LY_DO_GATE.TIN_CUA_TRO_LY);
});

test('B8 tiếng vọng lời của chính trợ lý (không tag) -> DROP, không thành vòng lặp', () => {
  // Trợ lý trả lời bằng tài khoản host: tuToi=true, userId=host, nhưng câu
  // trả lời không mang mentions ⇒ hasHostMention=false ⇒ rơi ở bước "không tag".
  const kq = bo(tinGia({ tuToi: true, hasHostMention: false, noiDung: 'Dạ em xem rồi ạ' }));
  assert.equal(kq.action, HANH_DONG_GATE.DROP);
  assert.equal(kq.payload.lyDo, LY_DO_GATE.KHONG_TAG);
});

test('B9 thiếu chatId / thiếu tin -> DROP, không nổ', () => {
  assert.equal(bo(tinGia({ chatId: null })).payload.lyDo, LY_DO_GATE.THIEU_DU_LIEU);
  assert.equal(bo(null).payload.lyDo, LY_DO_GATE.THIEU_DU_LIEU);
  assert.equal(quyetDinh(tinGia(), null).payload.lyDo, LY_DO_GATE.THIEU_DU_LIEU);
});

test('B10 DM của host -> ALLOW mà KHÔNG cần tag (DM không có mentions)', () => {
  assert.equal(CHO_PHEP_DM, true, 'nếu đổi mặc định thì sửa cả bài test này');
  const kq = bo(tinGia({ chatId: 'dm-111', hasHostMention: false }));
  assert.equal(kq.action, HANH_DONG_GATE.ALLOW);
  assert.equal(kq.payload.lyDo, LY_DO_GATE.HOST_NHAN_DM);
});

test('B11 DM của host nhưng người gửi là NGƯỜI KHÁC -> DROP', () => {
  // Xảy ra thật nếu dmChatId bị điền nhầm thành một NHÓM.
  assert.equal(
    bo(tinGia({ chatId: 'dm-111', userId: '999', hasHostMention: false })).payload.lyDo,
    LY_DO_GATE.KHONG_PHAI_HOST,
  );
});

test('B12 gate là HÀM THUẦN — không sửa tin, không sửa config', () => {
  const t = tinGia();
  const banSaoTin = JSON.parse(JSON.stringify(t));
  const banSaoCh = JSON.parse(JSON.stringify(CH));
  quyetDinh(t, CH);
  assert.deepEqual(t, banSaoTin);
  assert.deepEqual(JSON.parse(JSON.stringify(CH)), banSaoCh);
});

// ═══════════════════════════════════════════════════════════════════════════
// C. ★ LEAK GUARD — spec I
// ═══════════════════════════════════════════════════════════════════════════

test('C1 nguồn CHỈ gồm nhóm đang hỏi -> trả lời TRONG NHÓM, coCheo=false', () => {
  const kq = decideReplyRoute({
    requestId: 'r1', chatIdHoi: 'A', nguon: ['A'], tonTaiHangDoi: true,
  });
  assert.equal(kq.huong, HUONG_TRA_LOI.NHOM);
  assert.equal(kq.coCheo, false);
  assert.deepEqual(kq.nguonLa, []);
});

test('C2 ★ có nguồn nhóm KHÁC -> DM_HOST, coCheo=true, liệt kê nguồn lạ', () => {
  const kq = decideReplyRoute({
    requestId: 'r1', chatIdHoi: 'A', nguon: ['A', 'B', 'C'], tonTaiHangDoi: true,
  });
  assert.equal(kq.huong, HUONG_TRA_LOI.DM_HOST);
  assert.equal(kq.coCheo, true);
  assert.deepEqual(kq.nguonLa, ['B', 'C']);
});

test('C3 KHÔNG đọc gì cả (nguồn rỗng) -> vẫn trả lời trong nhóm', () => {
  // Ca hợp lệ: Claude trả lời bằng kiến thức chung, không tra kho.
  const kq = decideReplyRoute({
    requestId: 'r1', chatIdHoi: 'A', nguon: [], tonTaiHangDoi: true,
  });
  assert.equal(kq.huong, HUONG_TRA_LOI.NHOM);
  assert.equal(kq.coCheo, false);
});

test('C4 ★ FAIL-CLOSED: request_id lạ / hàng đợi hết hạn -> TU_CHOI, không gửi gì', () => {
  for (const boiCanh of [
    { requestId: 'r-la', chatIdHoi: 'A', nguon: ['A'], tonTaiHangDoi: false },
    { requestId: '', chatIdHoi: 'A', nguon: ['A'], tonTaiHangDoi: true },
    { requestId: '   ', chatIdHoi: 'A', nguon: ['A'], tonTaiHangDoi: true },
    { requestId: 'r1', chatIdHoi: null, nguon: ['A'], tonTaiHangDoi: true },
    { requestId: 'r1', chatIdHoi: '', nguon: ['B'], tonTaiHangDoi: true },
  ]) {
    const kq = decideReplyRoute(boiCanh);
    assert.equal(kq.huong, HUONG_TRA_LOI.TU_CHOI, JSON.stringify(boiCanh));
    assert.equal(kq.coCheo, false);
  }
  assert.equal(decideReplyRoute({}).huong, HUONG_TRA_LOI.TU_CHOI);
  assert.equal(decideReplyRoute(null).huong, HUONG_TRA_LOI.TU_CHOI);
});

test('C5 lệch KIỂU string/number không được làm nguồn hoá "lạ"', () => {
  const kq = decideReplyRoute({
    requestId: 'r1', chatIdHoi: '9990000000001', nguon: [9990000000001], tonTaiHangDoi: true,
  });
  // Số này > MAX_SAFE_INTEGER nên String(number) vẫn ra đúng chữ số ở đây;
  // điều cần chứng minh là hàm KHÔNG so bằng === trên hai kiểu khác nhau.
  assert.equal(kq.huong, HUONG_TRA_LOI.NHOM, 'so kiểu khác nhau -> tưởng nhầm là nhóm lạ');
});

test('C6 ★ tích luỹ theo requestId qua NHIỀU lượt gọi tool, không reset giữa chừng', () => {
  const b = createSourceLedger();
  // Claude tra 3 lần rồi mới trả lời. Reset giữa chừng thì lần cuối trông
  // "sạch" và luật bị lách mà không ai cố ý.
  recordSources(b, 'r1', ['A']);
  recordSources(b, 'r1', ['B']);
  recordSources(b, 'r1', ['A', 'C']);
  assert.deepEqual(getSources(b, 'r1'), ['A', 'B', 'C']);

  const kq = decideReplyRoute({
    requestId: 'r1', chatIdHoi: 'A', nguon: getSources(b, 'r1'), tonTaiHangDoi: true,
  });
  assert.equal(kq.huong, HUONG_TRA_LOI.DM_HOST, 'lượt cuối chỉ đọc A nhưng phiên đã đọc B, C');
  assert.deepEqual(kq.nguonLa, ['B', 'C']);
});

test('C7 hai phiên KHÁC nhau không lẫn nguồn của nhau', () => {
  const b = createSourceLedger();
  recordSources(b, 'r1', ['A']);
  recordSources(b, 'r2', ['B']);
  assert.deepEqual(getSources(b, 'r1'), ['A']);
  assert.deepEqual(getSources(b, 'r2'), ['B']);
  clearSession(b, 'r1');
  assert.deepEqual(getSources(b, 'r1'), []);
  assert.deepEqual(getSources(b, 'r2'), ['B'], 'xoá phiên này làm mất phiên kia');
});

test('C8 requestId rỗng khi ghi nhận -> BỎ QUA, không gộp nhầm vào phiên khác', () => {
  const b = createSourceLedger();
  recordSources(b, 'r1', ['A']);
  recordSources(b, '', ['BI-MAT']);
  recordSources(b, null, ['BI-MAT']);
  assert.deepEqual(getSources(b, 'r1'), ['A'], 'nguồn của phiên rỗng đã lẫn sang r1');
  assert.equal(b.soPhien(), 1);
});

test('C9 sweepStale chỉ dọn theo TUỔI, và KHÔNG dọn khi tham số vô nghĩa', () => {
  const b = createSourceLedger();
  recordSources(b, 'r1', ['A', 'B']);
  assert.equal(sweepStale(b, 60_000), 0, 'phiên mới toanh mà đã bị dọn');
  assert.deepEqual(getSources(b, 'r1'), ['A', 'B']);

  // Giả lập phiên già bằng cách đẩy lùi mốc tạo.
  b._kho.get('r1').taoLuc = Date.now() - 10 * 60_000;
  assert.equal(sweepStale(b, -1), 0, 'tham số rác mà vẫn dọn -> tự mở đường rò');
  assert.equal(sweepStale(b, 'ba phút'), 0);
  assert.equal(sweepStale(b, 5 * 60_000), 1);
  assert.equal(b.soPhien(), 0);
});

test('C10 nguồn lạ chỉ để GHI LOG — quyết định không mang theo câu chữ nào', () => {
  const kq = decideReplyRoute({
    requestId: 'r1', chatIdHoi: 'A', nguon: ['B'], tonTaiHangDoi: true,
  });
  // cauTrungTinh phải do caller lấy từ config, KHÔNG do file này sinh ra.
  assert.equal('text' in kq, false, 'leak_guard đang tự sinh câu nói -> model/hàm lộ chủ đề');
  assert.equal('cauTrungTinh' in kq, false);
  assert.deepEqual(Object.keys(kq).sort(), ['coCheo', 'huong', 'lyDo', 'nguonLa']);
});

test('C11 mã lý do có mặt đủ để G8 ghi log phân biệt được các ca', () => {
  assert.equal(
    decideReplyRoute({ requestId: 'r', chatIdHoi: 'A', nguon: ['A'], tonTaiHangDoi: false }).lyDo,
    LY_DO_LEAK.HANG_DOI_KHONG_CON,
  );
  assert.equal(
    decideReplyRoute({ requestId: 'r', chatIdHoi: 'A', nguon: ['B'], tonTaiHangDoi: true }).lyDo,
    LY_DO_LEAK.CO_NGUON_LA,
  );
  assert.equal(
    decideReplyRoute({ requestId: 'r', chatIdHoi: 'A', nguon: ['A'], tonTaiHangDoi: true }).lyDo,
    LY_DO_LEAK.KHONG_CO_NGUON_LA,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// D. LUẬT CHUNG CỦA PACK
// ═══════════════════════════════════════════════════════════════════════════

test('D1 ba file của G4 KHÔNG có console.log (stdout là kênh giao thức MCP)', () => {
  const goc = path.join(PACK_ROOT, 'src', 'policy');
  for (const ten of ['access.js', 'gate.js', 'leak_guard.js']) {
    const src = fs.readFileSync(path.join(goc, ten), 'utf8');
    assert.equal(/console\.log\s*\(/.test(src), false, `${ten} có console.log`);
    assert.equal(/process\.stdout\.write/.test(src), false, `${ten} ghi thẳng stdout`);
  }
});

test('D2 policy KHÔNG import gì từ src/mcp/ hay src/store/ (tầng dưới không biết tầng trên)', () => {
  const goc = path.join(PACK_ROOT, 'src', 'policy');
  for (const ten of ['access.js', 'gate.js', 'leak_guard.js']) {
    const src = fs.readFileSync(path.join(goc, ten), 'utf8');
    assert.equal(/from\s+['"][^'"]*\/mcp\//.test(src), false, `${ten} import từ src/mcp/`);
    assert.equal(/from\s+['"][^'"]*\/store\//.test(src), false, `${ten} import từ src/store/`);
    assert.equal(/from\s+['"]zca-js['"]/.test(src), false, `${ten} import zca-js`);
  }
});
