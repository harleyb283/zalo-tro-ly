/**
 * G5 — test cho src/mcp/channel.js. ĐẦU-CUỐI THẬT, không mạng, không Zalo.
 *
 * Dùng `InMemoryTransport.createLinkedPair()` của chính SDK để dựng một
 * CLIENT MCP thật nối vào server thật. Nhờ vậy bài test đo được thứ mà mock
 * không đo nổi: capability có thực sự lên tới client không, notification có
 * đúng method + đúng hình dạng params không, tools/list trả gì.
 *
 *     node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createChannel, CHANNEL_METHOD, CHANNEL_CAPABILITY, pushPendingQueue } from '../src/mcp/channel.js';
import { TEN_TOOL, TEN_TOOL_LICH, TEN_TOOL_NHAC, TEN_TOOL_GHI, TEN_TOOL_DUYET } from '../src/lib/hang_so.js';

/** Nuốt stderr — file này cố ý kêu nhiều ra stderr. */
async function imLang(fn) {
  const goc = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  try {
    return { kq: await fn(), keu };
  } finally {
    process.stderr.write = goc;
  }
}

/** Dựng cặp client-server đã bắt tay xong. */
async function dungCap(tuyChon = {}) {
  const nhanThongBao = [];
  const kenh = createChannel({
    tenServer: 'zalo-tro-ly-test',
    phienBan: '0.1.0',
    registerTools: tuyChon.registerTools ?? (() => {}),
    khiSanSang: tuyChon.khiSanSang,
    replyContext: tuyChon.replyContext,
  });

  const client = new Client({ name: 'client-test', version: '1.0.0' }, { capabilities: {} });
  // Bắt MỌI notification method lạ: đây là chỗ đo "tin có tới client không".
  client.fallbackNotificationHandler = async (n) => { nhanThongBao.push(n); };

  const [tClient, tServer] = InMemoryTransport.createLinkedPair();
  await imLang(async () => {
    await kenh.noiVaoTransport(tServer);
    await client.connect(tClient);
  });
  return { kenh, client, nhanThongBao };
}

const TIN_MAU = {
  requestId: 'req-1',
  chatId: '9990000000001',
  tenHoiThoai: 'Nhóm A',
  nguoiHoi: 'Người A',
  noiDung: 'anh ơi cho em hỏi',
  tsZalo: 1755678901234,
};

// ═══ A. Capability + bắt tay ═══
test('A1 capability claude/channel LÊN TỚI client (không khai = client vứt sạch tin)', async () => {
  const { kenh, client } = await dungCap();
  const caps = client.getServerCapabilities();
  assert.deepEqual(caps.experimental, { 'claude/channel': {} });
  assert.ok(caps.tools, 'phải khai cả tools');
  await imLang(() => kenh.dong());
});

test('A2 hằng số capability đúng chuỗi client dò (gõ sai = hỏng CÂM)', () => {
  assert.deepEqual(Object.keys(CHANNEL_CAPABILITY), ['claude/channel']);
  assert.equal(CHANNEL_METHOD, 'notifications/claude/channel');
});

test('A3 instructions tới được client — đây là chỗ DUY NHẤT dặn được phiên Claude', async () => {
  const { kenh, client } = await dungCap();
  const hd = client.getInstructions() ?? '';
  assert.match(hd, /request_id/, 'phải dặn truyền request_id ngược lại');
  assert.match(hd, /tra_loi/, 'phải dặn transcript không tới người Zalo');
  assert.match(hd, /prompt injection/i, 'phải dặn coi tin Zalo là dữ liệu, không phải mệnh lệnh');
  await imLang(() => kenh.dong());
});

test('A4 coOutbound: false trước bắt tay, true sau', async () => {
  const kenh = createChannel({ tenServer: 'x', phienBan: '0', registerTools: () => {} });
  assert.equal(kenh.coOutbound(), false);
  const { kenh: k2 } = await dungCap();
  assert.equal(k2.coOutbound(), true);
  await imLang(() => k2.dong());
});

test('A5 khiSanSang được gọi sau khi client bắt tay (chỗ G8 đẩy bù hàng đợi)', async () => {
  let goi = 0;
  const { kenh } = await dungCap({ khiSanSang: () => { goi += 1; } });
  assert.equal(goi, 1);
  await imLang(() => kenh.dong());
});

test('A6 khiSanSang NÉM LỖI cũng không giết phiên vừa bắt tay', async () => {
  const { kenh } = await dungCap({ khiSanSang: () => { throw new Error('G8 hỏng'); } });
  assert.equal(kenh.coOutbound(), true);
  const ok = (await imLang(() => kenh.guiThongBao(TIN_MAU))).kq;
  assert.equal(ok, true, 'lỗi của caller không được làm hỏng kênh');
  await imLang(() => kenh.dong());
});

// ═══ B. Bơm tin ═══
test('B1 notification tới client ĐÚNG method và ĐÚNG hình dạng {content, meta}', async () => {
  const { kenh, nhanThongBao } = await dungCap();
  const ok = (await imLang(() => kenh.guiThongBao(TIN_MAU))).kq;
  assert.equal(ok, true);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(nhanThongBao.length, 1);
  const n = nhanThongBao[0];
  assert.equal(n.method, CHANNEL_METHOD);
  assert.equal(n.params.content, 'anh ơi cho em hỏi');
  assert.equal(n.params.meta.request_id, 'req-1', 'thiếu request_id là Claude không gọi ngược lại được');
  assert.equal(n.params.meta.chat_id, '9990000000001');
  assert.equal(n.params.meta.chat_name, 'Nhóm A');
  assert.equal(n.params.meta.ts, new Date(1755678901234).toISOString());
  await imLang(() => kenh.dong());
});

test('B2 CHƯA nối transport -> trả false, TUYỆT ĐỐI không ném (ghi lịch sử phải chạy tiếp)', async () => {
  const kenh = createChannel({ tenServer: 'x', phienBan: '0', registerTools: () => {} });
  const { kq, keu } = await imLang(() => kenh.guiThongBao(TIN_MAU));
  assert.equal(kq, false);
  assert.match(keu.join(''), /cho'|hàng đợi|bắt tay/);
});

test('B3 thiếu requestId -> false, không bơm tin mồ côi vào phiên', async () => {
  const { kenh, nhanThongBao } = await dungCap();
  const kq = (await imLang(() => kenh.guiThongBao({ ...TIN_MAU, requestId: '' }))).kq;
  assert.equal(kq, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(nhanThongBao.length, 0);
  await imLang(() => kenh.dong());
});

test('B4 sau khi dong() thì guiThongBao trả false, không ném', async () => {
  const { kenh } = await dungCap();
  await imLang(() => kenh.dong());
  assert.equal((await imLang(() => kenh.guiThongBao(TIN_MAU))).kq, false);
});

// ⚠️ Bản cũ của B5 assert `meta.ts === null`. Chính cái đó là quả mìn: client
// validate `params.meta.*` bằng Zod và bắt CHUỖI — `null` bị từ chối y như
// object, và nó ném TRONG notification handler nên RỚT CẢ KẾT NỐI stdio.
// "Không có giá trị" phải thể hiện bằng VẮNG MẶT KHOÁ, không phải bằng null.
test('B5 ts hỏng -> meta KHÔNG có khoá ts (vắng mặt, KHÔNG phải null)', async () => {
  const { kenh, nhanThongBao } = await dungCap();
  await imLang(() => kenh.guiThongBao({ ...TIN_MAU, tsZalo: 'rác' }));
  await new Promise((r) => setTimeout(r, 20));
  const meta = nhanThongBao[0].params.meta;
  assert.equal('ts' in meta, false, 'gửi null là đứt kết nối, không phải bỏ một trường');
  assert.ok(!String(JSON.stringify(meta)).includes('Invalid Date'));
  await imLang(() => kenh.dong());
});

test('B6 soDaDay đếm số lần ĐẨY ĐI — CỐ Ý không gọi là "đã tới"', async () => {
  const { kenh } = await dungCap();
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  await imLang(() => kenh.guiThongBao({ ...TIN_MAU, requestId: 'req-2' }));
  assert.equal(kenh.soDaDay(), 2);
  await imLang(() => kenh.dong());
});

// ═══ C. tools/list qua client thật ═══
test('C1 client thấy ĐÚNG 18 tool (4 gốc + 4 lịch + 4 nhắc + 3 ghi nhớ + 3 duyệt v11), tên lấy từ hằng số', async () => {
  const { registerTools } = await import('../src/mcp/tools.js');
  const { kenh, client } = await dungCap({
    registerTools: (server) => registerTools(server, {
      db: null, cauHinh: {}, boTichLuy: null, api: null, docSucKhoe: () => null,
    }),
  });
  const ds = await client.listTools();
  assert.deepEqual(
    ds.tools.map((t) => t.name).sort(),
    // Vẫn là danh sách ĐÓNG, lấy từ hằng số — không nới thành "ít nhất 4 tool".
    // Trần này là thứ bắt được ca ai đó lỡ đăng ký thêm một tool không ai duyệt.
    [
      TEN_TOOL.LICH_SU, TEN_TOOL.NHAN_RIENG_HOST, TEN_TOOL.TRANG_THAI, TEN_TOOL.TRA_LOI,
      TEN_TOOL_LICH.DAT_LICH_NHAP, TEN_TOOL_LICH.DAT_LICH_CHOT,
      TEN_TOOL_LICH.XEM_LICH, TEN_TOOL_LICH.HUY_LICH,
      TEN_TOOL_NHAC.DAT_NHAC_THEO_DUOI, TEN_TOOL_NHAC.CHINH_NHIP_NHAC,
      TEN_TOOL_NHAC.DONG_NHAC, TEN_TOOL_NHAC.XEM_NHAC,
      TEN_TOOL_GHI.GHI_NHO, TEN_TOOL_GHI.MO_LAI_NHAC, TEN_TOOL_GHI.BO_QUA,
      TEN_TOOL_DUYET.XIN_DUYET, TEN_TOOL_DUYET.XEM_YEU_CAU, TEN_TOOL_DUYET.DUYET_YEU_CAU,
    ].sort(),
  );
  await imLang(() => kenh.dong());
});

test('C2 inputSchema PHẲNG: request_id CÙNG CẤP với chatId, và là bắt buộc', async () => {
  const { registerTools } = await import('../src/mcp/tools.js');
  const { kenh, client } = await dungCap({
    registerTools: (server) => registerTools(server, {
      db: null, cauHinh: {}, boTichLuy: null, api: null, docSucKhoe: () => null,
    }),
  });
  const ds = await client.listTools();
  const lichSu = ds.tools.find((t) => t.name === TEN_TOOL.LICH_SU);
  assert.deepEqual(lichSu.inputSchema.required, ['request_id']);
  assert.ok(lichSu.inputSchema.properties.chatId, 'chatId phải nằm CÙNG CẤP, không lồng trong object con');
  assert.ok(lichSu.inputSchema.properties.request_id);
  assert.equal(lichSu.inputSchema.properties.thamSo, undefined, 'schema lồng = Claude gửi sai hình dạng');

  for (const ten of [TEN_TOOL.TRA_LOI, TEN_TOOL.NHAN_RIENG_HOST]) {
    const t = ds.tools.find((x) => x.name === ten);
    assert.deepEqual(t.inputSchema.required.sort(), ['request_id', 'text']);
  }
  const tt = ds.tools.find((t) => t.name === TEN_TOOL.TRANG_THAI);
  assert.ok(!tt.inputSchema.required?.length, 'trang_thai KHÔNG có tham số');
  await imLang(() => kenh.dong());
});

test('C3 ĐẦU-CUỐI THẬT: client gọi tool qua transport, nhận đúng KetQuaTool', async () => {
  // Bài này đi qua ĐÚNG đường dây thật (Server + transport + handler của SDK),
  // khác nhóm test kia vốn gọi thẳng handler bằng server giả. Nó bắt được lớp
  // lỗi mà mock không bắt nổi: schema sai hình dạng, handler đăng ký nhầm
  // method, kết quả không hợp lệ với MCP.
  const { registerTools } = await import('../src/mcp/tools.js');
  const { MA_LOI } = await import('../src/lib/hang_so.js');
  const { kenh, client } = await dungCap({
    registerTools: (server) => registerTools(server, {
      db: {}, cauHinh: { cauTrungTinh: 'x' }, boTichLuy: {}, api: {},
      docSucKhoe: () => ({ trangThai: 'OK', lyDo: '', tuLuc: '', soLanThuLai: 0 }),
      kho: { getQueueRow: () => null },   // request_id lạ -> fail-closed
    }),
  });

  const ra = await imLang(() => client.callTool({
    name: TEN_TOOL.TRA_LOI,
    arguments: { request_id: 'tu-bia', text: 'rò thử xem' },
  }));
  const kq = JSON.parse(ra.kq.content[0].text);
  assert.equal(kq.ok, false);
  assert.equal(kq.ma, MA_LOI.REQUEST_ID_LA, 'fail-closed phải sống sót qua cả đường dây thật');
  assert.equal(ra.kq.isError, true);
  await imLang(() => kenh.dong());
});

// ═══ D. Đẩy bù hàng đợi trên đĩa ═══
test('D1 đẩy bù: đẩy được thì chuyển da_day, đẩy hụt thì GIỮ NGUYÊN cho', async () => {
  const capNhat = [];
  const kq = await imLang(() => pushPendingQueue({
    db: {},
    queueTtlMs: 60000,
    takePendingQueue: () => ([
      { request_id: 'r1', chat_id_hoi: 'c1', user_id: 'u1', noi_dung: 'a', ts_tao: '2026-08-20T10:00:00.000Z' },
      { request_id: 'r2', chat_id_hoi: 'c2', user_id: 'u2', noi_dung: 'b', ts_tao: '2026-08-20T10:00:01.000Z' },
    ]),
    updateQueueState: (_db, rid, tt) => { capNhat.push([rid, tt]); return true; },
    guiThongBao: async (p) => p.requestId === 'r1',   // r2 đẩy hụt
  }));
  assert.deepEqual(kq.kq, { day: 1, bo: 1 });
  assert.deepEqual(capNhat, [['r1', 'da_day']], "r2 KHÔNG được đụng vào -> vẫn 'cho', lần sau đẩy tiếp");
});

test('D2 đọc hàng đợi hỏng -> nuốt lỗi, trả 0/0, không giết tiến trình', async () => {
  const kq = await imLang(() => pushPendingQueue({
    db: {}, queueTtlMs: 1,
    takePendingQueue: () => { throw new Error('DB chết'); },
    updateQueueState: () => true,
    guiThongBao: async () => true,
  }));
  assert.deepEqual(kq.kq, { day: 0, bo: 0 });
});

// ═══ E. Luật stdout ═══
/**
 * Bỏ chú thích trước khi soi mã.
 *
 * ⚠️ Bản đầu của bài E1 quét thẳng mã nguồn và ĐỎ OAN, vì chính dòng chú thích
 * `⛔ CẤM console.log()` khớp regex. Cùng họ báo động giả với
 * `ref_validator_false_alarm_traps`: chú thích nhắc tên thứ bị cấm KHÔNG phải
 * là vi phạm — ngược lại, đó là thứ ta muốn giữ.
 */
function boChuThich(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
    .replace(/(^|\s)\/\/.*$/gm, '$1');  // // ...
}

test('E1 hai file G5 KHÔNG có console.log (stdout là kênh giao thức)', async () => {
  const fs = await import('node:fs');
  for (const f of ['src/mcp/channel.js', 'src/mcp/tools.js']) {
    const src = boChuThich(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    assert.ok(!/console\.log\s*\(/.test(src), `${f} có console.log`);
    assert.ok(!/process\.stdout\.write\s*\(/.test(src), `${f} ghi thẳng stdout`);
    assert.ok(/process\.stderr\.write/.test(src), `${f} phải log qua stderr`);
  }
});

test('E2 CHỨNG MINH BẰNG HÀNH VI: nạp 2 module không làm bẩn stdout một byte nào', async () => {
  // Soi mã chỉ bắt được chữ; bài này bắt được HÀNH VI, kể cả log lọt từ
  // module con. Chạy tiến trình riêng để không đụng stdout của test runner.
  const { execFileSync } = await import('node:child_process');
  const ra = execFileSync(process.execPath, [
    '-e',
    "import('./src/mcp/channel.js').then(m=>{m.createChannel({tenServer:'x',phienBan:'0',registerTools:()=>{}});return import('./src/mcp/tools.js')})",
  ], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(ra, '', `stdout phải RỖNG tuyệt đối, nhận được: ${JSON.stringify(ra)}`);
});

// ═══════════════════════════════════════════════════════════════════════
// G. BỐI CẢNH REPLY ĐI KÈM TIN BÁO
//
// 🔴 Bug đang sửa: 4 cột `tra_loi_*` lưu đúng từ trước nhưng KHÔNG AI ĐỌC.
//    Để bối cảnh riêng trong `meta` cũng không đủ — Claude đọc `content`, và
//    nó không biết là có gì để đi tra, nên nó sẽ không tra.
// ═══════════════════════════════════════════════════════════════════════

test('G1 ★ trích đoạn tin gốc + tác giả nằm NGAY TRONG content', async () => {
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => ({
      coTrongKho: true,
      tenNguoiGoc: 'Hảis Assistant',
      noiDungGoc: 'Dạ có, nhưng không phải qua tool em đang dùng ạ',
      msgIdGoc: '9996000000001',
    }),
  });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  const p = nhanThongBao[0].params;
  assert.match(p.content, /Hảis Assistant/, 'không có tác giả thì không biết đang trả lời ai');
  assert.match(p.content, /không phải qua tool em đang dùng/);
  assert.ok(p.content.endsWith('anh ơi cho em hỏi'), 'nội dung tin phải còn nguyên ở cuối');
  // meta.tra_loi là CHUỖI JSON (hợp đồng: mọi giá trị trong meta là chuỗi).
  assert.equal(typeof p.meta.tra_loi, 'string');
  assert.equal(JSON.parse(p.meta.tra_loi).coTrongKho, true, 'bản có cấu trúc vẫn để trong meta');
  await imLang(() => kenh.dong());
});

test('G2 🔴 tin gốc KHÔNG có trong kho -> content NÓI RÕ, cấm im lặng', async () => {
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => ({
      coTrongKho: false,
      trichDoan: 'Dạ có, nhưng không phải qua tool',
      ghiChu: 'KHÔNG có tin gốc trong kho (bot chưa nghe lúc đó)',
    }),
  });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  const c = nhanThongBao[0].params.content;
  assert.match(c, /KHÔNG có tin gốc trong kho/);
  assert.match(c, /Đừng đoán/, 'phải dặn thẳng, không thì nó tự bịa nội dung tin gốc');
  assert.match(c, /Dạ có, nhưng không phải qua tool/, 'còn trích đoạn thì vẫn đưa ra');
  await imLang(() => kenh.dong());
});

test('G3 tin thường -> content KHÔNG bị thêm gì (không nhiễu)', async () => {
  const { kenh, nhanThongBao } = await dungCap({ replyContext: () => null });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  assert.equal(nhanThongBao[0].params.content, 'anh ơi cho em hỏi');
  assert.equal('tra_loi' in nhanThongBao[0].params.meta, false,
    'không có tin gốc thì BỎ HẲN khoá — gửi null là rớt kết nối');
  await imLang(() => kenh.dong());
});

test('G4 hàm tra bối cảnh NÉM lỗi -> tin báo VẪN đi (phần phụ không giết phần chính)', async () => {
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => { throw new Error('DB đóng rồi'); },
  });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  assert.equal(nhanThongBao.length, 1, 'mất tin báo vì lỗi phụ trợ là hỏng nặng hơn nhiều');
  assert.equal(nhanThongBao[0].params.content, 'anh ơi cho em hỏi');
  await imLang(() => kenh.dong());
});

test('G5 tin gốc ĐÃ THU HỒI -> đánh dấu rõ, đừng để trợ lý trích lại như thường', async () => {
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => ({
      coTrongKho: true, tenNguoiGoc: 'Minh Hải', noiDungGoc: 'câu đã xoá', daThuHoi: true,
    }),
  });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  assert.match(nhanThongBao[0].params.content, /ĐÃ BỊ THU HỒI/);
  await imLang(() => kenh.dong());
});

// ═══════════════════════════════════════════════════════════════════════
// H. HỢP ĐỒNG `params.meta` — MỌI GIÁ TRỊ PHẢI LÀ CHUỖI
//
// 🔴 SỰ CỐ THẬT 20/08/2026: trợ lý chết CÂM trên nhóm có người thật.
//    Log MCP nguyên văn:
//        Uncaught error in notification handler: $ZodError
//        path: ["params","meta","tra_loi"]  expected "string"  received "object"
//        STDIO connection dropped after 537s uptime
//
//    Client validate `params.meta.*` bằng Zod. Sai kiểu -> ném TRONG
//    notification handler -> RỚT CẢ KẾT NỐI stdio, không phải bỏ một tin.
//
// 🔴 VÌ SAO KHÔNG BÀI NÀO BẮT ĐƯỢC: bộ test cũ chỉ đọc `params` như một object
//    JS thường, KHÔNG hề áp luật kiểu của client. Nghĩa là hợp đồng với bên
//    ngoài chưa từng được canh — chỉ canh mấy trường mình quan tâm.
//    Nhóm bài này dựng lại đúng luật đó và cho MỌI notification chạy qua.
//
// ⚠️ Schema dưới là BẢN MÔ PHỎNG luật của client, dựng từ chính thông điệp lỗi
//    thật ở trên (không phải copy từ mã nguồn client — ta không có nó). Nếu
//    sau này client nới luật thì bài này chặt hơn thực tế — chấp nhận được,
//    vì hướng sai là an toàn.
// ═══════════════════════════════════════════════════════════════════════

const { z } = await import('zod');

/** `meta` = bản đồ khoá -> CHUỖI. Không nhận null, số, boolean, object. */
const LUAT_META = z.record(z.string());

/** Ném đúng kiểu $ZodError như client sẽ ném. */
function _epLuatMeta(thongBao, nhan) {
  const kq = LUAT_META.safeParse(thongBao.params.meta);
  assert.ok(
    kq.success,
    `${nhan}: meta VI PHẠM hợp đồng -> client sẽ RỚT KẾT NỐI. `
      + JSON.stringify(kq.error?.issues ?? []),
  );
  for (const [k, v] of Object.entries(thongBao.params.meta)) {
    assert.equal(typeof v, 'string', `${nhan}: meta.${k} là ${typeof v}, phải là chuỗi`);
  }
}

test('H1 ★ CÓ tin gốc — đúng ca đã làm đứt kết nối thật', async () => {
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => ({
      coTrongKho: true,
      tenNguoiGoc: 'Người A',
      noiDungGoc: 'câu gốc',
      msgIdGoc: '111',
      daThuHoi: false,
    }),
  });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  _epLuatMeta(nhanThongBao[0], 'có tin gốc');
  // Vẫn phải dùng được: chuỗi JSON parse ra đúng dữ liệu.
  assert.equal(JSON.parse(nhanThongBao[0].params.meta.tra_loi).tenNguoiGoc, 'Người A');
  await imLang(() => kenh.dong());
});

test('H2 ★ KHÔNG có tin gốc — `null` cũng bị từ chối y như object', async () => {
  const { kenh, nhanThongBao } = await dungCap({ replyContext: () => null });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  _epLuatMeta(nhanThongBao[0], 'không có tin gốc');
  assert.equal('tra_loi' in nhanThongBao[0].params.meta, false, 'phải VẮNG MẶT, không phải null');
  await imLang(() => kenh.dong());
});

test('H3 ★ tin thường không reply', async () => {
  const { kenh, nhanThongBao } = await dungCap();
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  _epLuatMeta(nhanThongBao[0], 'tin thường');
  await imLang(() => kenh.dong());
});

test('H4 🔴 payload của `lich/bo_chay.js` — quả mìn ĐÃ CÀI SẴN từ trước', async () => {
  // `bo_chay.js` truyền THẲNG `tenHoiThoai: null, nguoiHoi: null` khi giao model
  // viết câu nhắc. Tức mọi lời nhắc theo lịch cũng sẽ làm đứt kết nối y hệt —
  // bug này có trước `tra_loi`, chỉ chưa ai chạy tới.
  const { kenh, nhanThongBao } = await dungCap();
  await imLang(() => kenh.guiThongBao({
    requestId: 'req-lich', chatId: '999',
    tenHoiThoai: null, nguoiHoi: null,
    noiDung: 'tới giờ nhắc rồi', tsZalo: Date.now(),
  }));
  _epLuatMeta(nhanThongBao[0], 'payload bo_chay');
  assert.equal('chat_name' in nhanThongBao[0].params.meta, false);
  assert.equal('user' in nhanThongBao[0].params.meta, false);
  await imLang(() => kenh.dong());
});

test('H5 ★ payload ÁC: số / boolean / object / undefined ở mọi khoá', async () => {
  // Chốt chặn phải giữ được hợp đồng BẤT KỂ caller truyền gì — hiện có 3 caller
  // (index.js, pushPendingQueue, bo_chay.js) và sẽ còn thêm. Vá lẻ từng chỗ gọi
  // thì caller thứ tư lại làm đứt kết nối.
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => ({ coTrongKho: true, noiDungGoc: 'x'.repeat(5000) }),
  });
  await imLang(() => kenh.guiThongBao({
    requestId: 12345,                       // số
    chatId: { la: 'object' },               // object
    tenHoiThoai: true,                      // boolean
    nguoiHoi: undefined,                    // vắng
    noiDung: 'xin chào',
    tsZalo: 'rác',                          // -> _iso trả null
  }));
  _epLuatMeta(nhanThongBao[0], 'payload ác');
  const meta = nhanThongBao[0].params.meta;
  assert.equal(meta.request_id, '12345', 'số phải thành chuỗi, không được bỏ');
  assert.equal('user' in meta, false);
  assert.equal('ts' in meta, false);
  assert.ok(meta.tra_loi.length <= 2100, `tra_loi dài ${meta.tra_loi.length} — phải có trần`);
  // Cắt phải để lại JSON HỢP LỆ, không cắt giữa chừng chuỗi JSON.
  assert.doesNotThrow(() => JSON.parse(meta.tra_loi), 'tra_loi phải parse được');
  await imLang(() => kenh.dong());
});

test('H6 nội dung bối cảnh trong `content` GIỮ NGUYÊN — chỉ meta đổi', async () => {
  // Đây mới là thứ model đọc (đã chứng minh bằng đột biến M6 lượt trước).
  const { kenh, nhanThongBao } = await dungCap({
    replyContext: () => ({ coTrongKho: true, tenNguoiGoc: 'Người A', noiDungGoc: 'câu gốc' }),
  });
  await imLang(() => kenh.guiThongBao(TIN_MAU));
  const c = nhanThongBao[0].params.content;
  assert.match(c, /Người A/);
  assert.match(c, /câu gốc/);
  assert.ok(c.endsWith('anh ơi cho em hỏi'));
  await imLang(() => kenh.dong());
});
