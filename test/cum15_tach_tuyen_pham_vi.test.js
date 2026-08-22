/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 15 — GĐ3-A: TÁCH **KHOÁ ĐỊNH TUYẾN** KHỎI **PHẠM VI ĐỌC** (21/08/2026).
 *
 * Hai câu hỏi KHÁC NHAU, trước đây nhét chung một biến:
 *   · `ZTL_TUYEN`                    — *"đẩy dòng của hội thoại này cho tôi"*
 *   · `ZTL_CHAT_ID` / `ZTL_PHAM_VI`  — *"tôi được đọc tới đâu"*
 *
 * Chúng trùng nhau ở agent-mỗi-nhóm nên gộp vẫn chạy — cho tới khi cần vai
 * `zalo-router`: **NHẬN chỉ DM host** nhưng **ĐỌC cả kho**.
 *
 * ⚠️ Mọi id là BỊA, mở đầu `999`. ⛔ Không bài nào chạm mạng, ⛔ không đụng DB
 *    thật (`~/.zalo-tro-ly/` — daemon đang ghi vào đó), ⛔ không spawn pane.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, openDb } from '../src/store/db.js';
import { writeMessage, takePendingQueue, enqueueQuestion, upsertConversation } from '../src/store/write.js';
import { _xoaPhamViChoTest, setReadScope, queryHistory } from '../src/store/query.js';
import { CHE_DO, GIAN_CHO_MO_PANE_MS, VAI } from '../src/lib/hang_so.js';
import { thanHam, khoiGiua, tuNeo, truocNeo } from './_cat_ma.js';

const DM_HOST = '9993000000000000003';
const NHOM_A = '9990000000001';
const NHOM_B = '9990000000002';
const HOST = '9991000000000000001';
const GOC = process.cwd();

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) {
    // 🔴 Đường dẫn do BIẾN tính ra ⇒ KIỂM TIỀN TỐ ngay trước khi xoá.
    // Lệch là TỪ CHỐI và NÓI TO, ⛔ không im lặng xoá bừa.
    if (typeof d === 'string' && d.startsWith(path.join(os.tmpdir(), 'ztl-cum15-'))) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    } else {
      process.stderr.write(`🔴 TỪ CHỐI xoá '${d}' — không đúng tiền tố đã duyệt\n`);
    }
  }
});
function tam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum15-'));
  RAC.push(d);
  return d;
}

test.beforeEach(() => { _xoaPhamViChoTest(); });
test.after(() => { _xoaPhamViChoTest(); });

/** DB TẠM có sẵn 3 hội thoại + hàng đợi. ⛔ KHÔNG dùng DB thật. */
function dbTam() {
  const db = openDb(path.join(tam(), 'kho', 'lichsu.db'));
  for (const [c, l] of [[DM_HOST, 'DM'], [NHOM_A, 'GROUP'], [NHOM_B, 'GROUP']]) {
    upsertConversation(db, { chatId: c, loai: l, ten: 'x', duocNghe: true });
  }
  const tin = (chatId, msgId, noiDung) => writeMessage(db, {
    chatId, msgId, cliMsgId: null, userId: HOST, tenLucGui: 'Chủ máy',
    msgType: 'chat.text', noiDung, contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, coTagHost: false,
  });
  tin(DM_HOST, 'd1', 'anh hỏi riêng');
  tin(NHOM_A, 'a1', 'chuyện nhóm A');
  tin(NHOM_B, 'b1', 'chuyện nhóm B');
  return db;
}

function xepHang(db, rid, chatId, tuoiMs = 0) {
  enqueueQuestion(db, {
    requestId: rid, chatIdHoi: chatId, msgId: rid, userId: HOST,
    noiDung: 'x', tsTao: new Date(Date.now() - tuoiMs).toISOString(),
  });
}

/**
 * Chạy `--kiem-khoi-dong` với env khai sẵn. ⛔ KHÔNG nối MCP, ⛔ không chạm
 * Zalo, ⛔ không đụng DB thật — mỗi lần một thư mục tạm riêng.
 */
function khoiDong(env, tuyChonCauHinh = {}) {
  const d = tam();
  const pDb = path.join(d, 'kho', 'lichsu.db');
  closeDb(openDb(pDb));                       // dựng schema cho client mở được
  const cfg = path.join(d, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({
    hosts: [{ userId: HOST, ten: 'Chủ máy', dmChatId: DM_HOST }],
    groups: [{ chatId: NHOM_A, ten: 'Nhóm A' }, { chatId: NHOM_B, ten: 'Nhóm B' }],
    cauTrungTinh: 'x',
    duongDan: { db: pDb, session: path.join(d, 's.json'), health: path.join(d, 'h.json') },
    ...tuyChonCauHinh,
  }));
  const r = spawnSync(process.execPath, [path.join(GOC, 'src/index.js'), '--config', cfg, '--kiem-khoi-dong'], {
    encoding: 'utf8',
    timeout: 15_000,
    // ⚠️ Xoá SẠCH ba biến trước khi đặt lại: env của tiến trình test có thể đã
    // mang chúng, và một biến rò vào đây làm bài đo nhầm ca.
    env: {
      ...process.env,
      ZTL_CHAT_ID: '', ZTL_PHAM_VI: '', ZTL_TUYEN: '', ZTL_CLIENT_ID: '',
      ZTL_CHE_DO: CHE_DO.TACH, ZTL_VAI: VAI.CLIENT,
      ...env,
    },
  });
  return { ma: r.status ?? -1, ra: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ═══════════════════════════════════════════════════════════════════════
// K — KHAI BÁO: ba vai, và các ca phải NÉM
// ═══════════════════════════════════════════════════════════════════════

test('★★★ K1 NGHIỆM THU①: `ZTL_TUYEN` + `toan_bo` -> chạy, log HAI DÒNG RIÊNG', () => {
  const r = khoiDong({ ZTL_TUYEN: DM_HOST, ZTL_PHAM_VI: 'toan_bo' });
  assert.equal(r.ma, 0, r.ra);
  // 🔴 HAI DÒNG RIÊNG. Gộp lại là đúng nhầm lẫn mà v10.3 sinh ra để gỡ:
  // người đọc log phải trả lời được NGAY "pane này nhận gì" và "đọc tới đâu".
  assert.match(r.ra, new RegExp(`NHẬN: chỉ dòng của ${DM_HOST}`), 'thiếu dòng NHẬN');
  assert.match(r.ra, /ĐỌC : TOÀN BỘ kho/, 'thiếu dòng ĐỌC');
  const iN = r.ra.indexOf('NHẬN:');
  const iD = r.ra.indexOf('ĐỌC :');
  assert.ok(iN >= 0 && iD >= 0 && iN !== iD, 'hai dòng phải TÁCH, ⛔ không gộp một dòng');
});

test('★★★ K2 NGHIỆM THU④: `ZTL_TUYEN` thiếu phạm vi -> NÉM, ⛔ không đoán', () => {
  // ⛔ Đoán "chắc ý là chỉ đọc chỗ đó" là đoán theo chiều MỞ — và mặc định
  // "đọc hết" là mặc định rò dữ liệu.
  const r = khoiDong({ ZTL_TUYEN: DM_HOST });
  assert.notEqual(r.ma, 0, '🔴 khai mỗi ZTL_TUYEN mà vẫn chạy');
  assert.match(r.ra, /KHÔNG biết phạm vi đọc/);
  // Phải NÓI RÕ vì sao — thông điệp chung chung thì người khai đi tìm mò.
  assert.match(r.ra, /khoá ĐỊNH TUYẾN/, 'phải giải thích ZTL_TUYEN KHÁC phạm vi đọc');
  assert.match(r.ra, /ZTL_PHAM_VI=toan_bo/, 'phải chỉ luôn cách khai đúng');
});

test('★★★ K3 `ZTL_TUYEN` + `ZTL_CHAT_ID` -> NÉM (mơ hồ, ⛔ không đoán)', () => {
  const r = khoiDong({ ZTL_TUYEN: DM_HOST, ZTL_CHAT_ID: NHOM_A });
  assert.notEqual(r.ma, 0);
  assert.match(r.ra, /Khai CẢ ZTL_TUYEN/);
});

test('★★★ K4 CHỐT CŨ GIỮ NGUYÊN: thiếu cả hai -> KHÔNG khởi động', () => {
  const r = khoiDong({});
  assert.notEqual(r.ma, 0, '🔴 nới lỏng chốt cũ = mặc định rò dữ liệu');
  assert.match(r.ra, /KHÔNG biết phạm vi đọc/);
});

test('★★★ K5 CHỐT CŨ GIỮ NGUYÊN: `ZTL_CHAT_ID` + `toan_bo` -> NÉM', () => {
  const r = khoiDong({ ZTL_CHAT_ID: NHOM_A, ZTL_PHAM_VI: 'toan_bo' });
  assert.notEqual(r.ma, 0);
  assert.match(r.ra, /Khai CẢ HAI/);
});

test('★★★ K6 agent nhóm khai y hệt hôm nay -> nhận nhóm đó, đọc nhóm đó', () => {
  const r = khoiDong({ ZTL_CHAT_ID: NHOM_A });
  assert.equal(r.ma, 0, r.ra);
  assert.match(r.ra, new RegExp(`NHẬN: chỉ dòng của ${NHOM_A}`));
  assert.match(r.ra, new RegExp(`ĐỌC : KHOÁ vào ${NHOM_A}`));
});

test('★★★ K7 vai DỰ PHÒNG: `toan_bo` KHÔNG `ZTL_TUYEN` -> nhận dòng không ai nhặt', () => {
  const r = khoiDong({ ZTL_PHAM_VI: 'toan_bo' });
  assert.equal(r.ma, 0, r.ra);
  assert.match(r.ra, /NHẬN: dòng KHÔNG AI nhặt/);
  assert.match(r.ra, /ĐỌC : TOÀN BỘ kho/);
});

// ═══════════════════════════════════════════════════════════════════════
// R — 🔴 `ZTL_TUYEN` ⛔ KHÔNG ĐƯỢC NỚI PHẠM VI ĐỌC
// ═══════════════════════════════════════════════════════════════════════

test('★★★ R1 NGHIỆM THU②: router chỉ NHẶT dòng của DM host (tầng truy vấn)', () => {
  // Canh ở TẦNG TRUY VẤN, ⛔ không đếm lời gọi hàm: thứ quyết định pane nhận
  // gì là câu SQL, ⛔ không phải một biến đọc lên rồi bỏ đó.
  const db = dbTam();
  xepHang(db, 'r-dm', DM_HOST);
  xepHang(db, 'r-a', NHOM_A);
  xepHang(db, 'r-b', NHOM_B);
  const ds = takePendingQueue(db, 600_000, { chatIdHoi: DM_HOST });
  assert.deepEqual(ds.map((r) => String(r.request_id)), ['r-dm'],
    '🔴 router nhặt cả tin nhóm — nó sẽ trả lời vào nhóm bằng giọng của Router');
  closeDb(db);
});

test('★★★ R2 NGHIỆM THU③: router ĐỌC ĐƯỢC nhóm khác (đó là CHỦ ĐÍCH)', () => {
  // Chiều ngược của R1. Anh chốt: *"host DM trực tiếp thì được hỏi về toàn bộ
  // DB"*. Vá quá tay ở đây là router mù trên chính việc nó sinh ra để làm.
  const db = dbTam();
  setReadScope(null);                       // đúng thứ `ZTL_PHAM_VI=toan_bo` đặt
  const kq = queryHistory(db, {});
  assert.equal(kq.rows.length, 3, 'router phải đọc được cả kho');
  assert.deepEqual([...new Set(kq.rows.map((r) => String(r.chat_id)))].sort(),
    [NHOM_A, NHOM_B, DM_HOST].sort());
  const kqA = queryHistory(db, { chatId: NHOM_A });
  assert.equal(kqA.rows.length, 1, 'hỏi thẳng một nhóm cũng phải ra');
  closeDb(db);
});

test('★★★ R3 🔴 `ZTL_TUYEN` ⛔ KHÔNG tự nới phạm vi đọc', () => {
  // Kiểu hỏng này ⛔ KHÔNG có triệu chứng nào ngoài dữ liệu rò ra: pane vẫn
  // nhận đúng dòng, vẫn trả lời, chỉ là nó đọc được thứ không được phép.
  const idx = fs.readFileSync(path.join(GOC, 'src/index.js'), 'utf8');
  const kh = khoiGiua(idx, 'async function chayClient', 'export async function rutOutbox')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/setReadScope\([^)]*tuyenTho/.test(kh),
    '🔴 `tuyenTho` đi vào setReadScope = khoá định tuyến mở luôn quyền đọc');
  assert.match(kh, /setReadScope\(toanBo \? null : phamViTho\)/,
    'phạm vi đọc CHỈ suy từ ZTL_PHAM_VI / ZTL_CHAT_ID');
  // 🔴 Hậu kiểm cũng ⛔ không được dính `tuyenTho`.
  // ⚠️ `indexOf('log(')` KHÔNG dùng được làm mốc kết thúc: trong `chayClient`
  // có nhiều `log(` NẰM TRƯỚC `const epThu`, nên nó trả vị trí sớm hơn mốc bắt
  // đầu ⇒ `slice` ra CHUỖI RỖNG ⇒ assertion luôn đúng, canh chẳng gì. Đột biến
  // "chen tuyenTho vào hậu kiểm" SỐNG SÓT đúng vì thế. Phải tìm TỪ vị trí bắt đầu.
  const iEp = kh.indexOf('const epThu');
  assert.ok(iEp > 0, 'không tìm thấy khối hậu kiểm');
  const hau = kh.slice(iEp, kh.indexOf('log(', iEp));
  assert.ok(hau.length > 40, `khối hậu kiểm cắt được quá ngắn (${hau.length} ký tự) — mốc sai`);
  assert.ok(!hau.includes('tuyenTho'), '🔴 hậu kiểm phạm vi bị `tuyenTho` chen vào');

  // 🔴 Dòng log ĐỌC phải in `epThu` — thứ vừa ĐO ĐƯỢC từ tầng truy vấn — chứ
  // ⛔ KHÔNG in lại `phamViTho` (lời khai từ env). Hai giá trị đó bằng nhau khi
  // mọi thứ đúng, và chỉ TÁCH RA đúng lúc code hỏng — tức đúng lúc cần log nhất.
  const dongDoc = tuNeo(kh, 'ĐỌC : KHOÁ vào');
  assert.match(dongDoc.slice(0, 80), /\$\{epThu\}/,
    '🔴 log in lại LỜI KHAI: bỏ mất `setReadScope` thì dòng này vẫn đúng y hệt');
});

test('★★★ R4 router khai `ZTL_TUYEN` ⇒ hậu kiểm phạm vi VẪN chạy và VẪN là toàn bộ', () => {
  const r = khoiDong({ ZTL_TUYEN: NHOM_A, ZTL_PHAM_VI: 'toan_bo' });
  assert.equal(r.ma, 0, r.ra);
  // ⚠️ `ZTL_TUYEN=NHOM_A` mà log ĐỌC vẫn phải là TOÀN BỘ — nếu nó in
  // "KHOÁ vào 999...001" nghĩa là tuyến đã lặng lẽ thành phạm vi.
  assert.match(r.ra, /ĐỌC : TOÀN BỘ kho/, '🔴 tuyến vừa nuốt mất phạm vi');
  assert.doesNotMatch(r.ra, /ĐỌC : KHOÁ vào/);
});

test('★★★ R5 `client_id` của router KHÁC của dự phòng (⛔ không trùng tên)', () => {
  // Cả hai đều khai `toan_bo`. Lấy nguyên chữ đó làm danh tính là HAI PANE
  // TRÙNG TÊN trong `nhat_ky_truy_van.client_id` — cột sinh ra để trả lời
  // "PANE NÀO đã đọc nhóm nào".
  const idx = fs.readFileSync(path.join(GOC, 'src/index.js'), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(idx, /tuyenTho \? `tuyen:\$\{tuyenTho\}` : ''/,
    'danh tính phải phân biệt được router với dự phòng');
});

// ═══════════════════════════════════════════════════════════════════════
// N — NGƯỠNG DỰ PHÒNG THEO `moPhienLenh`
// ═══════════════════════════════════════════════════════════════════════

test('★★★ N1 NGHIỆM THU⑤: `moPhienLenh` VẮNG ⇒ ngưỡng 0 (⛔ không chờ thứ không tồn tại)', () => {
  const r = khoiDong({ ZTL_PHAM_VI: 'toan_bo' });
  assert.equal(r.ma, 0, r.ra);
  assert.match(r.ra, /vai DỰ PHÒNG: nhặt NGAY/);
  assert.match(r.ra, /không có pane riêng nào để chờ/);
  assert.doesNotMatch(r.ra, /chờ \d+ms/, '🔴 vẫn chờ = mọi tin chậm 37 giây vô cớ');
});

test('★★★ N2 NGHIỆM THU⑤: `moPhienLenh` CÓ KHAI ⇒ ngưỡng 37000', () => {
  const r = khoiDong({ ZTL_PHAM_VI: 'toan_bo' }, { tichHop: { moPhienLenh: 'bash 999-khong-chay.sh' } });
  assert.equal(r.ma, 0, r.ra);
  assert.match(r.ra, new RegExp(`chờ ${GIAN_CHO_MO_PANE_MS}ms`));
  assert.equal(GIAN_CHO_MO_PANE_MS, 37_000, 'số thật, ⛔ không phải "một khoảng nào đó"');
});

test('★★★ N3 ROUTER ⛔ KHÔNG phải dự phòng — nhặt NGAY dù khai `toan_bo`', () => {
  // Điều kiện phải là `laDuPhong`, ⛔ không phải `toanBo`. Sai chỗ này thì DM
  // của anh chậm 37 giây mỗi tin, và ⛔ không lỗi nào nổ ra.
  const r = khoiDong({ ZTL_TUYEN: DM_HOST, ZTL_PHAM_VI: 'toan_bo' },
    { tichHop: { moPhienLenh: 'bash 999-khong-chay.sh' } });
  assert.equal(r.ma, 0, r.ra);
  assert.doesNotMatch(r.ra, /vai DỰ PHÒNG/, '🔴 router bị coi là dự phòng ⇒ DM host chậm 37 giây');
});

test('★★★ N4 HÀNH VI: ngưỡng 0 nhặt dòng MỚI, ngưỡng 37s thì KHÔNG', () => {
  // Bài anh em với N1/N2: hai bài kia canh CẤU HÌNH, bài này canh HÀNH VI.
  const db = dbTam();
  xepHang(db, 'moi', NHOM_A, 1_000);
  assert.equal(takePendingQueue(db, 600_000, { treToiThieuMs: 0 }).length, 1,
    'ngưỡng 0 ⇒ nhặt ngay');
  assert.equal(takePendingQueue(db, 600_000, { treToiThieuMs: GIAN_CHO_MO_PANE_MS }).length, 0,
    'ngưỡng 37s ⇒ dòng mới chưa tới lượt');
  closeDb(db);
});
