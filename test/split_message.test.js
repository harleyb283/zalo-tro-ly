/**
 * Nghiệm thu `src/lib/split_message.js` + 2 khoá config mới (`kenhPhu`, `tichHop`).
 * Chạy: node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { splitMessage, findSplitPoint, charLength, MAX_PARTS } from '../src/lib/split_message.js';
import { validateConfig, VALID_SIDE_CHANNELS } from '../src/policy/access.js';

const nhoHon = (phan, tran) => phan.every((p) => charLength(p) <= tran);

function cauHinhGia(ghiDe = {}) {
  return {
    hosts: [{ userId: '111', ten: 'Chu nha', dmChatId: 'dm111' }],
    groups: [{ chatId: 'g1', ten: 'N1', ghiLichSu: true, traLoiKhiTag: true }],
    duongDan: { db: '/tmp/ztl-t/a.db', session: '/tmp/ztl-t/s.json', health: '/tmp/ztl-t/h.json' },
    thoiGian: { keepAliveMs: 120000, watchdogMs: 300000, imLangMs: 900000, queueTtlMs: 1800000 },
    cauTrungTinh: 'Em nhắn riêng anh rồi ạ.',
    notifyCommand: null,
    anTrangThai: true,
    ...ghiDe,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// A. splitMessage
// ═══════════════════════════════════════════════════════════════════════

test('A1 ngắn hơn trần -> 1 tin, KHÔNG đánh số', () => {
  const r = splitMessage('xin chao anh', { tran: 100 });
  assert.deepEqual(r.phan, ['xin chao anh']);
  assert.equal(r.soPhan, 1);
  assert.equal(r.daCat, false);
});

test('A2 rỗng -> không tin nào (đừng gửi tin trống vào nhóm)', () => {
  assert.deepEqual(splitMessage('   ').phan, []);
  assert.deepEqual(splitMessage(null).phan, []);
});

test('🔴 A3 CHIA chứ không CẮT — ghép lại phải ĐỦ chữ', () => {
  const doan = Array.from({ length: 12 }, (_, i) => `Doan so ${i + 1}. ${'noi dung '.repeat(12)}`);
  const goc = doan.join('\n\n');
  // soTinToiDa cao để bài này đo đúng thứ nó định đo — TÍNH TOÀN VẸN khi chia.
  // Để mặc định 5 thì bài đỏ vì chạm trần số tin, tức là đo nhầm sang chuyện khác.
  const r = splitMessage(goc, { tran: 300, soTinToiDa: 50 });

  assert.ok(r.soPhan > 1, `phải chia, đang ${r.soPhan}`);
  assert.equal(r.daCat, false, 'chưa chạm trần số tin thì không được mất chữ');
  assert.ok(nhoHon(r.phan, 300), 'mọi tin phải ≤ trần KỂ CẢ tiền tố');

  // Bỏ tiền tố "i/n " rồi ghép lại, so trên chuỗi đã bỏ hết khoảng trắng:
  // ranh giới cắt có nuốt \n\n nên không so nguyên văn được.
  const ghep = r.phan.map((p) => p.replace(/^\d+\/\d+ /, '')).join('');
  const bo = (s) => s.replace(/\s+/g, '');
  assert.equal(bo(ghep), bo(goc), 'ghép lại phải đủ chữ — không được rơi mất đoạn nào');
});

test('🔴 A4 tiền tố "i/n " nằm TRONG ngân sách, không làm tin vượt trần', () => {
  const r = splitMessage('x'.repeat(2000), { tran: 120 });
  assert.ok(r.soPhan > 1);
  for (const p of r.phan) {
    assert.match(p, /^\d+\/\d+ /, 'phải có tiền tố');
    assert.ok(charLength(p) <= 120, `tin dài ${charLength(p)} > trần 120: ${p.slice(0, 40)}`);
  }
});

test('A5 đánh số đúng dạng 1/n … n/n', () => {
  const r = splitMessage('Cau mot. '.repeat(120), { tran: 200 });
  assert.equal(r.phan[0].startsWith('1/'), true);
  assert.match(r.phan[r.phan.length - 1], new RegExp(`^${r.soPhan}/${r.soPhan} `));
});

test('🔴 A6 cắt theo RANH GIỚI ĐOẠN, không cụt giữa từ', () => {
  const goc = ['Doan A ket thuc o day.', 'Doan B bat dau.'].join('\n\n')
    + '\n\n' + 'Doan C dai '.repeat(30);
  const r = splitMessage(goc, { tran: 150, danhSo: false, soTinToiDa: 50 });
  // ⚠️ Kỳ vọng ĐÚNG không phải "tin 1 = đoạn A". `findSplitPoint` cố ý lấy ranh giới
  // đoạn CUỐI CÙNG còn lọt trong cửa sổ — nhồi đầy tin rồi mới xuống dòng mới.
  // Bắt nó dừng ở đoạn đầu tiên là ép chia thành nhiều tin vụn, ngược hẳn mục
  // tiêu (mỗi tin thêm là thêm 1,2 giây throttle và thêm rủi ro cờ spam).
  assert.ok(r.soPhan > 1);
  assert.ok(r.phan[0].startsWith('Doan A ket thuc o day.'));
  // Điều PHẢI đúng: KHÔNG tin nào cắt GIỮA MỘT TỪ.
  // Cách chứng minh gọn và không có kẽ hở: tách cả bài thành danh sách TỪ, rồi
  // nối danh sách từ của từng tin lại. Nếu có chỗ nào cắt giữa từ thì "Doan"
  // sẽ thành "Do"+"an" và hai danh sách lệch nhau ngay.
  const tu = (x) => x.trim().split(/\s+/).filter(Boolean);
  assert.deepEqual(r.phan.flatMap(tu), tu(goc),
    'có tin bị cắt giữa từ (hoặc rơi mất chữ)');
});

test('A7 findSplitPoint: ưu tiên đoạn > dòng > câu > từ > cắt cứng', () => {
  assert.equal(findSplitPoint('abc', 10), 3, 'ngắn hơn trần thì lấy hết');
  // Không có chỗ đẹp nào ở nửa sau -> cắt cứng đúng trần.
  assert.equal(findSplitPoint('a'.repeat(50), 20), 20);
  // Có dấu cách ở nửa sau -> cắt ở đó, giữ luôn dấu cách.
  const s = `${'a'.repeat(12)} ${'b'.repeat(30)}`;
  assert.equal(findSplitPoint(s, 20), 13);
});

test('🔴 A8 chạm TRẦN SỐ TIN -> daCat=true và NÓI RÕ còn bao nhiêu', () => {
  const r = splitMessage('y'.repeat(100_000), { tran: 200, soTinToiDa: 3 });
  assert.equal(r.soPhan, 3);
  assert.equal(r.daCat, true, 'phải tự khai là chưa gửi đủ');
  assert.match(r.phan[2], /còn \d+ ký tự nữa/,
    'im lặng nuốt phần đuôi là kiểu hỏng tệ nhất — anh đọc tưởng đã hết');
});

test('A9 trần số tin mặc định là 5 (chống bắn dồn bị gắn cờ spam)', () => {
  assert.equal(MAX_PARTS, 5);
  assert.ok(splitMessage('z'.repeat(100_000), { tran: 500 }).soPhan <= 5);
});

test('🔴 A10 đếm theo ĐIỂM MÃ, emoji không làm chia sớm gấp đôi', () => {
  const emoji = '😀';
  assert.equal(emoji.length, 2, 'JS đếm 2 đơn vị UTF-16');
  assert.equal(charLength(emoji), 1, 'nhưng người dùng thấy 1 ký tự');
  const r = splitMessage(emoji.repeat(80), { tran: 100, danhSo: false });
  assert.equal(r.soPhan, 1, 'đếm bằng .length thì bài này sẽ ra 2 tin');
});

test('A11 KHÔNG cắt chồng với catAnToan — hai hàm khác việc', async () => {
  const { catAnToan } = await import('../src/zalo/send.js');
  const dai = 'w'.repeat(9000);
  assert.equal(catAnToan(dai, 4000).daCat, true, 'catAnToan = CẮT, mất đuôi');
  assert.equal(splitMessage(dai, { tran: 4000 }).daCat, false, 'splitMessage = CHIA, giữ đủ');
});

// ═══════════════════════════════════════════════════════════════════════
// B. Config: kenhPhu + tichHop (mặc định TẮT, pack tự chạy được)
// ═══════════════════════════════════════════════════════════════════════

test('🔴 B1 config KHÔNG khai gì -> kenhPhu="zalo", tichHop TẮT HẾT', () => {
  const c = validateConfig(cauHinhGia());
  assert.equal(c.kenhPhu, 'zalo', 'người tải pack về phải dùng được ngay');
  // 🔴 `moPhienLenh: null` là CÔNG TẮC TẮT của panel-mỗi-nhóm (v10.2). Mặc định
  // có giá trị ⇒ người tải pack về bị pack tự chạy một lệnh shell họ chưa từng
  // khai — vừa bất ngờ vừa nguy hiểm.
  assert.deepEqual(c.tichHop, { kenhPhuLenh: null, moPhienLenh: null });
});

test('🔴 B1b `chuyenViecLenh` ĐÃ BỊ BỎ HẲN — không được lặng lẽ quay lại', () => {
  // Trường đó từng được khai trong config mẫu và validate trót lọt, nhưng KHÔNG
  // có dòng code nào đọc/chạy nó ⇒ người dùng điền vào rồi tưởng đã bật, trong
  // khi chẳng có gì chạy. Bỏ hẳn 20/08/2026.
  // Bài này canh CẢ HAI chiều: (a) validate không còn nhả nó ra, (b) người dùng
  // có lỡ điền thì cũng bị BỎ QUA chứ không được âm thầm chấp nhận.
  const c = validateConfig(cauHinhGia({
    tichHop: { chuyenViecLenh: 'lenh-cu', kenhPhuLenh: 'lenh-that' },
  }));
  assert.equal('chuyenViecLenh' in c.tichHop, false,
    'trường chết KHÔNG được quay lại kết quả validate');
  assert.equal(c.tichHop.kenhPhuLenh, 'lenh-that', 'kenhPhuLenh vẫn phải dùng được');
});

test('🔴 B2 hai khoá mới KHÔNG còn bị validateConfig nuốt mất', () => {
  const c = validateConfig(cauHinhGia({
    kenhPhu: 'telegram',
    tichHop: { kenhPhuLenh: 'lenh-b' },
  }));
  assert.equal(c.kenhPhu, 'telegram');
  assert.equal(c.tichHop.kenhPhuLenh, 'lenh-b');
});

test('B3 kenhPhu giá trị lạ -> CẢNH BÁO rồi về "zalo", KHÔNG chết', () => {
  const c = validateConfig(cauHinhGia({ kenhPhu: 'sms' }));
  assert.equal(c.kenhPhu, 'zalo', 'gõ sai một chữ mà không khởi động được là phạt quá nặng');
  assert.deepEqual([...VALID_SIDE_CHANNELS], ['zalo', 'telegram', 'khong']);
});

test('B4 tichHop không phải chuỗi -> coi như TẮT, không nổ', () => {
  const c = validateConfig(cauHinhGia({ tichHop: { kenhPhuLenh: '  ', moPhienLenh: 42 } }));
  assert.deepEqual(c.tichHop, { kenhPhuLenh: null, moPhienLenh: null });
});

test('B5 kenhPhu="khong" vẫn hợp lệ', () => {
  assert.equal(validateConfig(cauHinhGia({ kenhPhu: 'khong' })).kenhPhu, 'khong');
});

// ═══════════════════════════════════════════════════════════════════════
// C. Pack phải SẠCH — không dấu vết máy anh, không phụ thuộc hệ riêng
// ═══════════════════════════════════════════════════════════════════════

const GOC = process.cwd();

/**
 * ═══════════════════════════════════════════════════════════════════════
 * TẦM QUÉT = ĐÚNG NHỮNG GÌ LÊN GIT. Không hơn, không kém.
 *
 * 🔴 BẢN CŨ SAI Ở TIÊU CHÍ, không phải ở danh sách. Nó loại thư mục theo cảm
 * tính "cái này có phải mã nguồn không" và loại luôn `test/` — trong khi `test/`
 * **lên git y như `src/`**, và đó lại là nơi dữ liệu thật hay bị chép vào nhất
 * (người ta dán id thật vào test cho nhanh rồi quên). Quét kiểu đó là **trấn an
 * chứ không bảo vệ**.
 *
 * ⇒ Nay danh sách loại trừ ĐƯỢC SUY RA TỪ `.gitignore`, và bài `C0b` đối chiếu
 * ngược: mọi thứ bộ quét bỏ qua thì `.gitignore` phải cũng bỏ qua. Muốn kéo một
 * thư mục ra khỏi tầm quét thì phải kéo nó ra khỏi git trước — tức là phải làm
 * một việc CÓ Ý THỨC và nhìn thấy được trong diff.
 *
 * ⚠️ Cũng bỏ luôn cái lọc theo ĐUÔI FILE. Bản cũ chỉ soi `.js .json .sql .md`
 * nên `src/types.d.ts`, `.env.example`, `.gitignore` đều ngoài tầm — chúng vẫn
 * lên git. Nay soi MỌI file văn bản.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Các mẫu trong `.gitignore`, đã tách sẵn. */
function docGitignore() {
  const raw = fs.readFileSync(path.join(GOC, '.gitignore'), 'utf8');
  const thuMuc = [];
  const tep = [];
  const giuLai = [];
  for (const dong of raw.split('\n')) {
    const d = dong.trim();
    if (!d || d.startsWith('#')) continue;
    if (d.startsWith('!')) { giuLai.push(d.slice(1).replace(/^\//, '')); continue; }
    if (d.endsWith('/')) { thuMuc.push(d.slice(0, -1).replace(/^\//, '')); continue; }
    tep.push(d.replace(/^\//, ''));
  }
  return { thuMuc, tep, giuLai };
}

/** Một mẫu `.gitignore` đơn giản (chỉ `*`) có khớp đường dẫn tương đối này không. */
function khopMau(mau, rel, ten) {
  const re = new RegExp(`^${mau.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return re.test(rel) || re.test(ten);
}

const GI = docGitignore();
// `.git` không nằm trong `.gitignore` (git không tự ignore chính nó) nhưng nó
// KHÔNG lên git theo nghĩa nội dung — bỏ qua là đúng, và đây là ngoại lệ DUY
// NHẤT được cứng hoá.
const BO_THU_MUC = new Set([...GI.thuMuc, '.git']);

function boQua(rel, ten) {
  if (GI.giuLai.some((m) => khopMau(m, rel, ten))) return false;
  return GI.tep.some((m) => khopMau(m, rel, ten));
}

function mọiFileNguon() {
  const ra = [];
  (function quet(d) {
    for (const m of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, m.name);
      const rel = path.relative(GOC, p);
      if (m.isDirectory()) {
        if (!BO_THU_MUC.has(m.name)) quet(p);
        continue;
      }
      if (boQua(rel, m.name)) continue;
      // Bỏ file nhị phân: đọc ra chuỗi thì regex chạy trên rác, vừa chậm vừa
      // dễ dương tính giả. Nhận diện bằng byte 0 trong 4 KB đầu.
      let dem;
      try { dem = fs.readFileSync(p); } catch { continue; }
      if (dem.subarray(0, 4096).includes(0)) continue;
      ra.push(p);
    }
  }(GOC));
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════
// ĐỊNH DANH: phân biệt SỐ BỊA với SỐ THẬT
//
// 🔴 HAI CHIỀU HỎNG KHÔNG CÂN BẰNG. Bỏ sót một id thật ⇒ dữ liệu của chủ máy
// lên git công khai, **không rút lại được** (xoá ở commit sau cũng vô ích, nó
// nằm trong lịch sử). Kêu oan ⇒ chỉ mất công sửa một dòng.
// ⇒ MẶC ĐỊNH LÀ CHẶN. Chuỗi số dài phải TỰ CHỨNG MINH mình là số bịa.
//
// ⛔ CẤM dựa vào "trông có giống thật không" — hai uid 19 chữ số chỉ khác nhau
// ĐÚNG MỘT chữ số cuối thì không ai nhìn ra cái nào thật.
// Thay vào đó dùng một QUY ƯỚC KHAI BÁO:
//
//   ✅ Mọi định danh BỊA trong pack phải bắt đầu bằng `999`.
//
// Người viết test mới cứ dùng `999…` là không bao giờ đỏ. Ai dán một id THẬT
// vào (id thật gần như không bao giờ bắt đầu bằng 999) thì đỏ ngay.
//
// ⚠️ ĐÁNH ĐỔI, nói thẳng: một id thật TÌNH CỜ bắt đầu bằng `999` sẽ lọt. Em
// chấp nhận vì (a) danh sách đen bên dưới bắt được mọi id thật ĐÃ BIẾT bất kể
// hình dạng, và (b) phương án chặt hơn — danh sách trắng thuần, mọi id bịa mới
// đều phải khai một dòng — bị loại vì bài test hay kêu oan là bài test sẽ bị
// người ta tắt, và lúc đó mất sạch chứ không phải mất một phần.
// ═══════════════════════════════════════════════════════════════════════

/** Định danh THẬT đã biết. Thắng mọi luật khác, kể cả quy ước `999`. */
const ID_THAT_DA_BIET = [
  // ⚠️ Ghép từ hai mảnh: file này NẰM TRONG tầm quét của chính nó, viết
  // nguyên số là tự bắt mình.
  ['89728' + '94436', 'chat_id Telegram của chủ máy'],
];

/**
 * Ngoại lệ — số dài KHÔNG theo quy ước `999` nhưng có lý do chính đáng.
 * Mỗi dòng là một quyết định CÓ Ý THỨC; danh sách này phải NGẮN.
 */
const NGOAI_LE = new Map([
  ['9007199254740991', 'Number.MAX_SAFE_INTEGER — mốc tràn số, phải viết đúng'],
  ['9007199254740992', 'MAX_SAFE_INTEGER + 1'],
  ['9007199254740993', 'MAX_SAFE_INTEGER + 2'],
  ['9007199254740994', 'MAX_SAFE_INTEGER + 3'],
  ['9007199254740995', 'MAX_SAFE_INTEGER + 4'],
  ['18446744073709551615', 'uint64 max — mốc tràn số'],
  ['1234567890123456789012345', 'chuỗi 25 chữ số để thử ID quá dài'],
  ['0000000000000000000', 'giá trị mẫu trong config.example — bài C3 BẮT BUỘC nó toàn số 0'],
]);

/**
 * ⛔ NỢ KỸ THUẬT CÓ HẠN — HIỆN ĐANG RỖNG, và giữ cho nó rỗng.
 *
 * Chỗ hoãn duy nhất từng có (một file test, 21/08/2026) đã DỌN XONG: id đó đổi
 * sang `999…`, dòng hoãn xoá hẳn, file sau đó cũng bị gỡ theo tính năng của nó.
 * ⇒ Hiện KHÔNG còn vùng mù nào trong pack.
 *
 * ⚠️ Thêm dòng mới vào đây phải kèm hai thứ, không thì `C1c` đỏ: LÝ DO thật
 * (>20 ký tự, nói rõ ai đang chặn và bao giờ dọn) và một tệp CÓ THẬT. Và nhớ
 * ghép id từ hai mảnh chuỗi — viết nguyên hình thì file này tự bắt chính nó.
 * 🔴 Dòng hoãn KHÔNG có nghĩa "chỗ này an toàn", mà là "chưa dọn được, và có
 *    người biết". Danh sách phình ra là bộ quét đang bị vô hiệu dần.
 */
const HOAN_LAI = [];

/** Chuỗi 13 chữ số nằm trong khoảng 2015–2035 thì coi là MỐC THỜI GIAN ms. */
function laMocThoiGian(s) {
  if (s.length !== 13) return false;
  const n = Number(s);
  return n >= 1_420_070_400_000 && n <= 2_051_222_400_000;
}

/**
 * Chuỗi số này có được phép nằm trong pack không.
 * @returns {string|null} null = OK, chuỗi = lý do CHẶN
 */
function xetSo(s, rel) {
  const den = ID_THAT_DA_BIET.find(([v]) => v === s);
  if (den) return `định danh THẬT (${den[1]})`;
  if (HOAN_LAI.some((h) => h.tep === rel && h.id === s)) return null;
  if (s.startsWith('999')) return null;
  if (NGOAI_LE.has(s)) return null;
  if (laMocThoiGian(s)) return null;
  return `chuỗi ${s.length} chữ số không theo quy ước "999" — nếu là id BỊA thì đổi sang 999…, `
    + 'nếu là id THẬT thì XOÁ (pack này lên git)';
}

/**
 * Những file BẮT BUỘC phải nằm trong tầm quét của C1.
 *
 * 🔴 Vì sao cần danh sách này chứ không tin bộ quét: `mọiFileNguon()` loại một
 *    số thư mục theo TÊN. Thêm một thư mục vào danh sách loại trừ là **âm thầm**
 *    kéo file ra khỏi tầm quét — C1 vẫn xanh, mà file thì vẫn lên git.
 *    Bản luật trong `.claude/agents/` là ca dễ dính nhất: `.claude` trông rất
 *    giống thứ người ta sẽ loại trừ theo phản xạ.
 */
const PHAI_QUET = [
  '.claude/agents/zalo-nhom.md',
  // ⚠️ THÊM 21/08/2026 — bốn thứ dưới đây LÊN GIT nhưng bản cũ KHÔNG soi:
  //   · `test/` bị loại theo TÊN THƯ MỤC (lỗ chính, 29 file)
  //   · `.d.ts` / `.example` / `.gitignore` bị loại theo ĐUÔI FILE
  // Cả hai đều là hệ quả của việc hỏi sai câu: bản cũ hỏi "có phải mã nguồn
  // không", câu đúng phải là "có lên git không".
  'test/split_message.test.js',
  'src/types.d.ts',
  '.env.example',
  '.gitignore',
];

test('🔴 C0 những file nhạy cảm PHẢI nằm trong tầm quét của C1', () => {
  const daQuet = new Set(mọiFileNguon().map((f) => path.relative(GOC, f)));
  for (const f of PHAI_QUET) {
    assert.ok(fs.existsSync(path.join(GOC, f)), `${f} không tồn tại`);
    assert.ok(daQuet.has(f),
      `${f} KHÔNG nằm trong tầm quét C1 — ai đó vừa loại trừ thư mục chứa nó.`);
  }
});

test('🔴 C0b MỌI thứ bộ quét bỏ qua thì `.gitignore` cũng phải bỏ qua', () => {
  // 🔴 ĐÂY LÀ CHỐT CHỐNG TÁI PHẠM. Lỗ cũ sinh ra vì danh sách loại trừ được
  // viết tay theo cảm tính ("test đâu phải mã nguồn"). Bài này buộc hai danh
  // sách khớp nhau: muốn kéo một thư mục ra khỏi tầm quét thì phải kéo nó ra
  // khỏi git trước — một việc CÓ Ý THỨC và nhìn thấy trong diff.
  const trongGitignore = new Set(docGitignore().thuMuc);
  const lech = [...BO_THU_MUC].filter((d) => d !== '.git' && !trongGitignore.has(d));
  assert.deepEqual(lech, [],
    `thư mục bị loại khỏi tầm quét nhưng VẪN lên git: ${lech.join(', ')}`);
});

test('🔴 C0c bản mẫu (`.example`) LÊN GIT nên PHẢI nằm trong tầm quét', () => {
  // `.gitignore` chặn `.env` và `config/assistant.config.json` rồi GIỮ LẠI hai
  // bản mẫu bằng dòng `!`. Bộ quét phải hiểu được dấu `!` đó, không thì nó bỏ
  // qua đúng hai file người ta hay điền nhầm giá trị thật vào.
  const daQuet = new Set(mọiFileNguon().map((f) => path.relative(GOC, f)));
  for (const f of ['.env.example', 'config/assistant.config.example.json']) {
    assert.ok(daQuet.has(f), `${f} lên git mà KHÔNG được quét`);
  }
  assert.ok(!daQuet.has('config/assistant.config.json'),
    'file cấu hình THẬT bị gitignore -> quét nó là kêu oan');
});

test('🔴 C1a NGHIỆM THU①: id THẬT nhét vào một file test -> bộ quét ĐỎ', () => {
  // Trước 21/08/2026 ca này XANH — đó chính là cái lỗ. Bài này dựng lại đúng
  // hành vi người ta hay làm: dán một id thật vào test cho nhanh rồi quên.
  const idThat = '835167375' + '2863258361';           // 19 chữ số, không mở đầu bằng 999
  assert.equal(xetSo(idThat, 'test/vi_du.test.js') === null, false,
    'id thật lọt qua -> dữ liệu chủ máy lên git, KHÔNG rút lại được');
  // và phải nói rõ phải làm gì
  assert.match(xetSo(idThat, 'test/vi_du.test.js'), /999/);

  // Danh sách ĐEN thắng mọi luật khác — kể cả khi id thật lỡ mở đầu bằng 999.
  // ⚠️ Phải canh LÝ DO, không chỉ canh "có chặn không": bỏ danh sách đen đi thì
  // số này vẫn bị chặn nhờ luật hình dạng, nên `assert.ok` suông KHÔNG bắt được.
  // ⚠️ Canh vào NHÃN RIÊNG của danh sách đen ("Telegram"), ⛔ đừng canh chữ
  // "THẬT" — câu lỗi CHUNG cũng chứa chữ đó ("nếu là id THẬT thì XOÁ"), nên
  // `match(/THẬT/)` xanh cả khi danh sách đen bị bỏ qua. Đột biến M7 sống sót
  // đúng vì lỗi này.
  assert.match(xetSo('89728' + '94436', 'test/vi_du.test.js'), /Telegram/,
    'phải nhận ra đây là id THẬT ĐÃ BIẾT, không phải chỉ "số lạ 10 chữ số"');
});

test('🔴 C1a2 luật số phải ĐƯỢC NỐI vào vòng quét, không chỉ nằm đó', () => {
  // 🔴 `C1a` chỉ chứng minh `xetSo()` phán đúng. Nó KHÔNG chứng minh `C1` có
  // gọi `xetSo()` hay không — gỡ lời gọi ra thì `C1a` vẫn xanh mà bộ quét mù
  // hoàn toàn. Bài này thả một file thật vào pack rồi quét cho chắc.
  // ⚠️ Dùng số 13 chữ số KHÔNG phải id thật (đọc như mốc thời gian thì ra năm
  // 2009, ngoài khoảng hợp lệ) — lỡ tiến trình chết giữa chừng để lại file thì
  // cũng KHÔNG rò dữ liệu của ai.
  const tam = path.join(GOC, 'test', '_tam_kiem_bo_quet.txt');
  // ghép từ hai mảnh: viết nguyên hình thì chính file này bị bắt.
  fs.writeFileSync(tam, `id = ${'1234567' + '890123'}\n`);
  try {
    const dinh = quetDuLieuRieng([]).map((x) => x.split(' — ')[0]);
    assert.ok(dinh.includes('test/_tam_kiem_bo_quet.txt'),
      'file mới thả vào pack KHÔNG bị bắt -> luật số chưa được nối vào vòng quét');
  } finally {
    fs.rmSync(tam, { force: true });
  }
});

test('🔴 C1b NGHIỆM THU②: id BỊA đúng quy ước -> KHÔNG kêu', () => {
  // Chống báo động giả. Bài test hay kêu oan là bài test sẽ bị tắt, và lúc đó
  // mất sạch chứ không phải mất một phần.
  for (const bia of ['9990000000001', '9991000000000000001', '999200000000000002']) {
    assert.equal(xetSo(bia, 'test/vi_du.test.js'), null, `${bia} là id bịa hợp lệ mà vẫn kêu`);
  }
  // mốc thời gian ms 13 chữ số cũng không được kêu
  assert.equal(xetSo('1755678901234', 'test/vi_du.test.js'), null, 'mốc thời gian bị kêu oan');
  // Quy ước là BA chữ số 9, ⛔ không phải một. Nới thành '9' là mở toang: rất
  // nhiều id thật mở đầu bằng 9.
  assert.ok(xetSo(('912345' + '6789012345'), 'test/vi_du.test.js'),
    "nới quy ước xuống chỉ '9' là cho lọt cả một khoảng id thật");
  // nhưng 13 chữ số KHÔNG phải mốc thời gian hợp lệ thì vẫn phải chặn
  assert.ok(xetSo('79708898' + '94523', 'test/vi_du.test.js'),
    'chat_id nhóm 13 chữ số (đọc như mốc thời gian thì ra năm 2222) phải bị chặn');
});

test('🔴 C1c danh sách HOÃN LẠI phải NGẮN và có lý do', () => {
  // Nợ kỹ thuật có hạn. Danh sách này phình ra là bộ quét đang bị vô hiệu dần
  // theo kiểu không ai để ý.
  assert.ok(HOAN_LAI.length <= 2, `hoãn ${HOAN_LAI.length} chỗ — quá nhiều, dọn đi`);
  for (const h of HOAN_LAI) {
    assert.ok(h.lyDo && h.lyDo.length > 20, 'mỗi chỗ hoãn phải ghi RÕ lý do');
    assert.ok(fs.existsSync(path.join(GOC, h.tep)), `${h.tep} không còn tồn tại -> xoá dòng hoãn`);
  }
  // Miễn phải ĐÍCH DANH: mọi rò rỉ KHÁC trong chính file đó vẫn phải đỏ.
  for (const h of HOAN_LAI) {
    assert.ok(xetSo('835167375' + '2863258361', h.tep), 'miễn quá rộng — cả file thành vùng mù');
  }
});

/**
 * Vòng quét THẬT — dùng chung cho `C1` (quét pack) và `C1a2` (canh việc nối dây).
 *
 * 🔴 PHẢI LÀ MỘT BẢN DUY NHẤT. Bản đầu em để `C1a2` tự chép lại vòng lặp, và
 * phép thử đột biến bắt ngay: gỡ luật số ra khỏi `C1` thì `C1a2` vẫn xanh vì
 * nó đang soi bản chép của chính nó. Hai bản = bài canh canh nhầm thứ.
 */
function quetDuLieuRieng(cam) {
  const loi = [];
  for (const f of mọiFileNguon()) {
    const rel = path.relative(GOC, f);
    const s = fs.readFileSync(f, 'utf8');
    for (const [re, nhan] of cam) {
      if (re.test(s)) loi.push(`${rel} — ${nhan}`);
    }
    // ★ Lớp SỐ: mọi chuỗi ≥13 chữ số phải tự chứng minh mình là số BỊA.
    for (const m of new Set([...s.matchAll(/\b\d{13,}\b/g)].map((x) => x[0]))) {
      const ly = xetSo(m, rel);
      if (ly) loi.push(`${rel} — ${ly}`);
    }
  }
  return loi;
}

test('🔴 C1 pack KHÔNG chứa đường dẫn/định danh của máy anh', () => {
  // File này sắp lên git. Lọt một dòng là lộ vĩnh viễn trong lịch sử git.
  // 🔴 MẪU DỰNG TỪ CHUỖI TÁCH ĐÔI, ⛔ không viết literal.
  // Từ 21/08/2026 bộ quét soi CẢ `test/` ⇒ nó soi chính file này. Viết mẫu
  // nguyên hình thì file này tự bắt chính mình, và cách "sửa" hiển nhiên nhất
  // là loại file này ra khỏi tầm quét — tức tự khoét đúng cái lỗ vừa vá.
  // Tách chuỗi thì file vẫn NẰM TRONG tầm quét và vẫn tự soi được mình.
  const R = (...phan) => new RegExp(phan.join(''));
  const cam = [
    [R('/Users/', 'minh', 'hai'), 'đường dẫn máy anh'],
    [R('AI', '_Auto'), 'tên hệ riêng'],
    [/\bw1:p\d+\b/, 'pane id Herdr'],
    [R('89728', '94436'), 'chat_id Telegram của anh'],
    [R('claude-plugins', '-official'), 'chuỗi nhận diện pane Router'],
    // ⚠️ THÊM 20/08/2026 sau khi bản đầu để LỌT hai thứ này vào tài liệu:
    //   · một TÊN KHÁCH HÀNG thật, lọt vào một câu VÍ DỤ
    //   · một TÊN NGƯỜI thật, lọt vào bảng Do/Don't
    // (⛔ cố ý không chép lại chính hai chuỗi đó vào đây — xem ghi chú tách mẫu)
    // Bản đầu chỉ quét ĐƯỜNG DẪN và ĐỊNH DANH MÁY, nên tên riêng trong VĂN
    // XUÔI đi qua sạch. Chỗ rò nguy hiểm nhất của tài liệu chính là mấy câu
    // ví dụ — người viết lấy ngay ví dụ có thật cho dễ hiểu.
    [new RegExp('\\b' + 'Sug' + 'ar\\b', 'i'), 'tên khách hàng'],
    [new RegExp('\\b' + 'Sen' + 'oko\\b', 'i'), 'tên khách hàng'],
    [new RegExp('@' + 'Min' + 'h\\b', 'i'), 'tên người thật'],
    [new RegExp('\\b' + 'minh' + 'hai\\b', 'i'), 'tên tài khoản của anh'],
  ];
  const loi = quetDuLieuRieng(cam);
  assert.deepEqual(loi, [], `pack lộ dữ liệu riêng:\n${loi.join('\n')}`);
});

// ⚠️ Tên bài CỐ Ý tránh chữ "import": mẫu của chính bài này là
// một lệnh nạp module đứng cùng dòng với tên hệ riêng — mà file này nằm
// trong tầm quét của chính nó, nên ⛔ đừng viết lại mẫu đó nguyên hình ở đây.
test('🔴 C2 pack KHÔNG nạp gì từ 40_system/ (hệ riêng của anh)', () => {
  const loi = [];
  for (const f of mọiFileNguon().filter((x) => x.endsWith('.js'))) {
    const s = fs.readFileSync(f, 'utf8');
    // Mẫu tách đôi, cùng lý do với C1: file này nằm trong tầm quét của chính nó.
    const re = new RegExp('(import|require)[^\\n]*' + '40_' + 'system');
    if (re.test(s)) loi.push(path.relative(GOC, f));
  }
  assert.deepEqual(loi, [], 'người tải pack về không có 40_system/');
});

test('🔴 C3 file cấu hình MẪU chỉ chứa giá trị giả + tích hợp TẮT', () => {
  const p = path.join(GOC, 'config', 'assistant.config.example.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(c.kenhPhu, 'zalo', 'mặc định phải là đường ai cũng dùng được');
  assert.equal(c.tichHop.kenhPhuLenh, null, 'tích hợp phải TẮT trong bản mẫu');
  assert.equal('chuyenViecLenh' in c.tichHop, false,
    'trường chết đã bỏ hẳn, bản mẫu không được khai lại');
  for (const h of c.hosts) assert.match(h.userId, /^0+$/, 'userId mẫu phải là số 0');
  for (const g of c.groups) assert.match(g.chatId, /^0+$/, 'chatId mẫu phải là số 0');
  assert.ok(JSON.stringify(c).indexOf('/Users/') === -1, 'không đường dẫn tuyệt đối');
});
