/**
 * ═══════════════════════════════════════════════════════════════════════
 * CỤM 14 — BƯỚC 7: `moPhienLenh` + CLIENT DỰ PHÒNG + `tranSoClient`.
 *
 * ⚠️ Mọi id là BỊA, mở đầu `999`. ⛔ Không bài nào chạm mạng, ⛔ không spawn
 *    pane thật, ⛔ không chạy lệnh shell thật — `chay` luôn được TIÊM.
 * ═══════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dongDb, moDb } from '../src/store/db.js';
import { layHangDoiCho, taoHangDoi, upsertHoiThoai } from '../src/store/write.js';
import { LY_DO_BO_QUA, taoSoMoPhien } from '../src/ops/mo_phien.js';
import {
  GIAN_CHO_MO_PANE_MS, HAN_MO_PHIEN_MS, NGHI_SAU_GIO_MAC_DINH,
  THU_LAI_MO_PHIEN_MS, TRAN_SO_CLIENT_MAC_DINH,
} from '../src/lib/hang_so.js';
// ⚠️ `NHIP_POLL_CLIENT_MS` nằm ở `src/index.js` (cạnh vòng poll dùng nó), ⛔
// không ở `hang_so.js`. Bài `R5` cộng ba số hạng nên phải lấy đúng nguồn.
import { NHIP_POLL_CLIENT_MS } from '../src/index.js';
import { kiemCauHinh } from '../src/policy/access.js';
import { thanHam, khoiGiua, tuNeo, truocNeo } from './_cat_ma.js';

const NHOM_A = '9990000000001';
const NHOM_B = '9990000000002';
const NHOM_C = '9990000000003';
const HOST = '9991000000000000001';

const RAC = [];
process.on('exit', () => {
  for (const d of RAC) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});
function tam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ztl-cum14-'));
  RAC.push(d);
  return d;
}

/** Đồng hồ giả — ⛔ không `sleep` thật, bài test phải chạy trong mili-giây. */
function dongHo(batDau = 1_700_000_000_000) {
  let t = batDau;
  return { bayGio: () => t, tien: (ms) => { t += ms; } };
}

function dbTam() {
  const db = moDb(path.join(tam(), 'kho', 'lichsu.db'));
  for (const c of [NHOM_A, NHOM_B, NHOM_C]) {
    upsertHoiThoai(db, { chatId: c, loai: 'GROUP', ten: 'g', duocNghe: true });
  }
  return db;
}

function xepHang(db, rid, chatId, tuoiMs = 0) {
  taoHangDoi(db, {
    requestId: rid, chatIdHoi: chatId, msgId: rid, userId: HOST,
    noiDung: 'anh hỏi', tsTao: new Date(Date.now() - tuoiMs).toISOString(),
  });
  return rid;
}

// ═══════════════════════════════════════════════════════════════════════
// L — `moPhienLenh`: hợp đồng + MẶC ĐỊNH TẮT
// ═══════════════════════════════════════════════════════════════════════

test('★★★ L1 NGHIỆM THU①: `moPhienLenh` mặc định NULL -> ⛔ KHÔNG gọi gì', async () => {
  // 🔴 Mặc định có giá trị ⇒ người tải pack về bị pack tự chạy một lệnh shell
  // họ chưa từng khai. Vừa bất ngờ, vừa nguy hiểm.
  const nen = {
    hosts: [{ userId: HOST, ten: 'a', dmChatId: '9993000000000000003' }],
    groups: [{ chatId: NHOM_A, ten: 'g' }],
    cauTrungTinh: 'x',
    duongDan: { db: '/tmp/999a.db', session: '/tmp/999s', health: '/tmp/999h' },
  };
  assert.equal(kiemCauHinh({ ...nen }).tichHop.moPhienLenh, null);

  const goi = [];
  const so = taoSoMoPhien({ lenh: null, chay: async (d) => { goi.push(d); return { thanhCong: true }; } });
  const kq = await so.baoDam(NHOM_A);
  assert.deepEqual(goi, [], '🔴 lệnh null mà VẪN gọi');
  assert.equal(kq.daGoi, false);
  assert.equal(kq.lyDo, LY_DO_BO_QUA.KHONG_CO_LENH);
});

test('★★★ L2 NGHIỆM THU②: gọi ĐÚNG MỘT LẦN cho mỗi nhóm (⛔ không phải mỗi tin)', async () => {
  // Nhóm bận đo thật 449 tin/ngày ⇒ mỗi tin một lần là 449 lần mở pane.
  const goi = [];
  const so = taoSoMoPhien({
    lenh: 'bash x.sh',
    chay: async (d) => { goi.push(d.chatId); return { thanhCong: true }; },
  });
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await so.baoDam(NHOM_A, { tenNhom: 'Nhóm A' });
  }
  assert.deepEqual(goi, [NHOM_A], `🔴 gọi ${goi.length} lần cho 50 tin`);
});

test('★★★ L3 hợp đồng stdin: đúng 3 khoá `chatId`/`tenNhom`/`lyDo`', async () => {
  const goi = [];
  const so = taoSoMoPhien({ lenh: 'x', chay: async (d) => { goi.push(d); return { thanhCong: true }; } });
  await so.baoDam(NHOM_A, { tenNhom: 'Nhóm A', lyDo: 'tin-moi' });
  assert.deepEqual(goi[0], { chatId: NHOM_A, tenNhom: 'Nhóm A', lyDo: 'tin-moi' });
  // Thiếu thông tin ⇒ `null`/mặc định, ⛔ không phải `undefined` (JSON nuốt mất khoá).
  await so.baoDam(NHOM_B);
  assert.deepEqual(goi[1], { chatId: NHOM_B, tenNhom: null, lyDo: 'tin-moi' });
  assert.equal(JSON.parse(JSON.stringify(goi[1])).tenNhom, null, 'khoá phải SỐNG SÓT qua JSON');
});

test('★★★ L4 THẤT BẠI -> ⛔ không đánh dấu đã mở, thử lại SAU ngưỡng', async () => {
  // Đánh dấu "đã gọi" ngay cả khi thất bại ⇒ nhóm đó VĨNH VIỄN không có pane.
  // Không đánh dấu gì ⇒ mỗi tin một lần gọi. Mốc thời gian là đường giữa.
  const dh = dongHo();
  const goi = [];
  const so = taoSoMoPhien({
    lenh: 'x', bayGio: dh.bayGio,
    chay: async (d) => { goi.push(d.chatId); return { thanhCong: false, ma: 1, lyDo: 'hỏng' }; },
  });
  await so.baoDam(NHOM_A);
  await so.baoDam(NHOM_A);
  assert.equal(goi.length, 1, 'trong ngưỡng chờ ⇒ ⛔ không gọi lại');
  dh.tien(THU_LAI_MO_PHIEN_MS + 1);
  await so.baoDam(NHOM_A);
  assert.equal(goi.length, 2, '🔴 quá ngưỡng mà KHÔNG thử lại = nhóm đó vĩnh viễn không pane');
});

test('★★★ L5 lệnh NÉM LỖI -> nuốt CÓ GHI SỔ, ⛔ không giết vòng nhận tin', async () => {
  const log = [];
  const so = taoSoMoPhien({
    lenh: 'x', log: (m) => log.push(m),
    chay: async () => { throw new Error('spawn hỏng'); },
  });
  const kq = await so.baoDam(NHOM_A);
  assert.equal(kq.thanhCong, false);
  assert.ok(log.some((l) => /NÉM LỖI/.test(l)), 'nuốt im là hỏng câm');
});

test('★★★ L6 lệnh đang chạy dở -> ⛔ KHÔNG bắn chồng cho cùng nhóm', async () => {
  let dangCho;
  const goi = [];
  const so = taoSoMoPhien({
    lenh: 'x',
    chay: async (d) => {
      goi.push(d.chatId);
      await new Promise((r) => { dangCho = r; });
      return { thanhCong: true };
    },
  });
  const p1 = so.baoDam(NHOM_A);
  const kq2 = await so.baoDam(NHOM_A);      // trong lúc p1 chưa xong
  assert.equal(kq2.lyDo, LY_DO_BO_QUA.DANG_CHAY);
  assert.equal(goi.length, 1, '🔴 hai lời gọi chồng nhau cho một nhóm');
  dangCho();
  await p1;
});

test('★★★ L7 lệnh TREO ⛔ KHÔNG chặn vòng chính — trần nằm ở `chayNotifyCommand`', async () => {
  // 🔴 Đây là bài chứng minh trần THẬT SỰ tồn tại, ⛔ không phải "tin là có".
  // Dùng lệnh `sleep` — ⛔ KHÔNG chạm mạng, ⛔ không bắn thông báo.
  const { chayNotifyCommand } = await import('../src/ops/notify_host.js');
  const t0 = Date.now();
  const kq = await chayNotifyCommand('sleep 30', { chatId: NHOM_A }, 300);
  const troi = Date.now() - t0;
  assert.equal(kq.thanhCong, false, 'treo phải tính là THẤT BẠI');
  assert.ok(troi < 3000, `🔴 chờ ${troi}ms — trần không có tác dụng, vòng chính bị giữ`);
});

test('★★★ L8 pack ⛔ KHÔNG tự đọc `HAN_MO_PHIEN_MS` sai chỗ — trần đúng 5s', () => {
  assert.equal(HAN_MO_PHIEN_MS, 5_000);
});

// ═══════════════════════════════════════════════════════════════════════
// R — ĐỊNH TUYẾN + CLIENT DỰ PHÒNG
// ═══════════════════════════════════════════════════════════════════════

test('★★★ R1 client khoá nhóm A -> CHỈ nhặt dòng của A (⛔ không nhặt của B)', () => {
  // 🔴 Thiếu bộ lọc này thì pane A nhặt câu hỏi của B rồi TRẢ LỜI VÀO NHÓM B.
  // Khoá phạm vi ĐỌC (bước 6) nằm ở tầng khác và ⛔ KHÔNG canh đường này.
  const db = dbTam();
  xepHang(db, 'a1', NHOM_A);
  xepHang(db, 'b1', NHOM_B);
  const ds = layHangDoiCho(db, 600_000, { chatIdHoi: NHOM_A });
  assert.deepEqual(ds.map((r) => String(r.chat_id_hoi)), [NHOM_A]);
  dongDb(db);
});

test('★★★ R2 KHÔNG khoá -> nhặt hết (đường một-tiến-trình, ⛔ không vá quá tay)', () => {
  const db = dbTam();
  xepHang(db, 'a1', NHOM_A);
  xepHang(db, 'b1', NHOM_B);
  assert.equal(layHangDoiCho(db, 600_000).length, 2);
  dongDb(db);
});

test('★★★ R3 NGHIỆM THU③: DỰ PHÒNG chỉ nhặt dòng đã chờ QUÁ ngưỡng', () => {
  // ⛔ Không có ngưỡng thì dự phòng CƯỚP VIỆC ngay giây đầu ⇒ mọi câu rơi vào
  // pane đọc-nhiều-nhóm, tức panel-mỗi-nhóm mất tác dụng cô lập TRONG IM LẶNG.
  const db = dbTam();
  xepHang(db, 'moi', NHOM_A, 1_000);                       // vừa tới
  xepHang(db, 'cu', NHOM_B, GIAN_CHO_MO_PANE_MS + 5_000);  // đã chờ quá lâu
  const ds = layHangDoiCho(db, 3_600_000, { treToiThieuMs: GIAN_CHO_MO_PANE_MS });
  assert.deepEqual(ds.map((r) => String(r.request_id)), ['cu'],
    '🔴 dự phòng cướp việc của pane riêng');
  dongDb(db);
});

test('★★★ R4 dòng QUÁ HẠN vẫn được đánh `het_han` dù chưa đủ tuổi tối thiểu', () => {
  // ⚠️ Đặt tuổi-tối-thiểu TRƯỚC phép kiểm hết hạn là dòng quá hạn nằm lại MÃI
  // MÃI: không ai nhặt, không ai đánh dấu, không ai báo.
  const db = dbTam();
  xepHang(db, 'qh', NHOM_A, 10_000);
  const bao = [];
  layHangDoiCho(db, 5_000, {
    treToiThieuMs: 3_600_000,               // ngưỡng khổng lồ
    khiHetHan: (r) => bao.push(String(r.request_id)),
  });
  assert.deepEqual(bao, ['qh'], '🔴 dòng quá hạn bị ngưỡng tuổi che mất');
  dongDb(db);
});

test('★★★ R5 NGƯỠNG 37s = TỔNG CÓ TÊN, ⛔ không phải số chọn cho tròn', () => {
  // Ba số hạng, mỗi số hạng một lý do. Đổi một số hạng mà tổng không đổi theo
  // là dấu hiệu ai đó vừa "làm tròn" nó.
  assert.equal(GIAN_CHO_MO_PANE_MS, HAN_MO_PHIEN_MS + 30_000 + NHIP_POLL_CLIENT_MS);
  assert.equal(GIAN_CHO_MO_PANE_MS, 37_000);
  // Ngắn hơn TTL hàng đợi (30 phút) rất nhiều ⇒ ⛔ không có ca "chờ dự phòng
  // lâu tới mức câu hỏi hết hạn".
  assert.ok(GIAN_CHO_MO_PANE_MS < 30 * 60_000 / 10);
});

// ═══════════════════════════════════════════════════════════════════════
// T — TRẦN SỐ PHIÊN
// ═══════════════════════════════════════════════════════════════════════

test('★★★ T1 NGHIỆM THU④: quá trần -> RƠI VỀ DỰ PHÒNG, ⛔ không im lặng', async () => {
  const log = [];
  const goi = [];
  const so = taoSoMoPhien({
    lenh: 'x', tranSoClient: 2, log: (m) => log.push(m),
    chay: async (d) => { goi.push(d.chatId); return { thanhCong: true }; },
  });
  await so.baoDam(NHOM_A);
  await so.baoDam(NHOM_B);
  const kq = await so.baoDam(NHOM_C);
  assert.deepEqual(goi, [NHOM_A, NHOM_B], '🔴 mở quá trần');
  assert.equal(kq.daGoi, false);
  assert.equal(kq.lyDo, LY_DO_BO_QUA.QUA_TRAN, '🔴 phải nói RÕ vì sao, ⛔ không im');
  assert.ok(log.some((l) => /ĐỦ TRẦN/.test(l) && /dự phòng/.test(l)),
    'quá trần mà im = nhóm mới bị bỏ rơi không dấu vết');
});

test('★★★ T2 trần chỉ đếm phiên mở THÀNH CÔNG (thất bại ⛔ không chiếm chỗ)', () => {
  // Đếm cả lần thất bại là một nhóm hỏng chiếm suốt đời một suất trong trần.
  const so = taoSoMoPhien({
    lenh: 'x', tranSoClient: 1,
    chay: async () => ({ thanhCong: false, ma: 1 }),
  });
  return so.baoDam(NHOM_A)
    .then(() => so.baoDam(NHOM_B))
    .then((kq) => {
      assert.notEqual(kq.lyDo, LY_DO_BO_QUA.QUA_TRAN,
        '🔴 lần mở HỎNG cũng chiếm suất trong trần');
      assert.equal(so._so().daMo, 0);
    });
});

test('★★ T3 mặc định trần = 4, và nó là VAN CHỈNH TAY (⛔ không phải kết luận đo)', () => {
  assert.equal(TRAN_SO_CLIENT_MAC_DINH, 4);
  const so = taoSoMoPhien({ lenh: 'x' });
  assert.equal(so._so().tran, 4);
  assert.equal(taoSoMoPhien({ lenh: 'x', tranSoClient: 9 })._so().tran, 9, 'phải chỉnh được');
});

// ═══════════════════════════════════════════════════════════════════════
// N — VÒNG ĐỜI: NGỦ = QUÊN, ⛔ KHÔNG GIẾT
// ═══════════════════════════════════════════════════════════════════════

test('★★★ N1 nhóm im quá `nghiSauGio` -> QUÊN khỏi sổ, có tin thì mở lại', async () => {
  const dh = dongHo();
  const goi = [];
  const so = taoSoMoPhien({
    lenh: 'x', nghiSauGio: 1, bayGio: dh.bayGio,
    chay: async (d) => { goi.push(d.chatId); return { thanhCong: true }; },
  });
  await so.baoDam(NHOM_A);
  assert.equal(goi.length, 1);
  dh.tien(2 * 3_600_000);                    // im 2 giờ
  await so.baoDam(NHOM_A);
  assert.equal(goi.length, 2, 'quên rồi thì phải mở lại được');
});

test('★★★ N2 pack ⛔ KHÔNG có đường nào GIẾT tiến trình nó không tạo ra', () => {
  // 🔴 GỠ CHÚ THÍCH TRƯỚC KHI SO. Canh trên mã thô là canh CHỮ: một dòng giải
  // thích *"file này KHÔNG spawn gì cả"* cũng làm bài đỏ. Đã dính đúng lỗi này
  // hai lần (`V1`, `P2` của cụm 12) — ghi lại để đừng lặp lần ba.
  const tho = fs.readFileSync(path.join(process.cwd(), 'src/ops/mo_phien.js'), 'utf8');
  const src = tho.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cam of ['kill', 'spawn', 'exec', 'child_process', 'dongPhienLenh']) {
    assert.ok(!src.includes(cam), `🔴 \`mo_phien.js\` chạm '${cam}' — pack đụng vào thứ của người khác`);
  }
  assert.equal(NGHI_SAU_GIO_MAC_DINH, 12);
});

// ═══════════════════════════════════════════════════════════════════════
// W — NỐI DÂY THẬT (`xuLyMotTin` + `chayClient`) — chỗ 8 đột biến từng SỐNG
// ═══════════════════════════════════════════════════════════════════════

test('★★★ W1 ĐẦU-CUỐI: tin mới -> GỌI baoDam đúng nhóm, SAU khi ghi hàng đợi', async () => {
  // 🔴 Bốn đột biến ở `index.js` từng sống vì ⛔ không bài nào chạy qua đường
  // nối dây: "không gọi baoDam", "gọi trước khi ghi hàng đợi", … Cả bốn làm
  // tính năng CHẾT CÂM.
  const { xuLyMotTin } = await import('../src/index.js');
  const db = dbTam();
  const goi = [];
  xuLyMotTin({
    db,
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Chủ máy', dmChatId: '9993000000000000003' }],
      groups: [{ chatId: NHOM_A, ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true }],
    },
    guiThongBao: async () => true,
    tenHoiThoai: () => 'Nhóm A',
    log: () => {},
    soMoPhien: {
      baoDam: async (chatId, tt) => {
        // 🔴 Phải gọi SAU khi hàng đợi đã có dòng — mở pane cho một câu hỏi
        // chưa tồn tại là mở cho một câu hỏi đã mất.
        const n = db.prepare('SELECT COUNT(*) n FROM hang_doi_hoi').get().n;
        goi.push({ chatId, tenNhom: tt?.tenNhom, soDongLucGoi: n });
        return { daGoi: true };
      },
    },
  }, {
    chatId: NHOM_A, msgId: 'w1', cliMsgId: null, userId: HOST, tenLucGui: 'Chủ máy',
    msgType: 'chat.text', noiDung: 'anh hỏi', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, coTagHost: true,
  });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(goi.length, 1, '🔴 KHÔNG gọi mở phiên — tính năng chết câm');
  assert.equal(goi[0].chatId, NHOM_A);
  assert.equal(goi[0].tenNhom, 'Nhóm A', 'phải truyền tên nhóm cho lệnh của người dùng');
  assert.equal(goi[0].soDongLucGoi, 1, '🔴 gọi TRƯỚC khi ghi hàng đợi');
  dongDb(db);
});

test('★★★ W1b DM CỦA HOST ⇒ ⛔ TUYỆT ĐỐI KHÔNG mở pane nhóm', async () => {
  // ⛔ ĐÃ XẢY RA THẬT 21/08/2026 22:16: anh nhắn một câu trong DM, daemon gọi
  // lệnh mở pane cho chính DM đó, và một pane `zalo-nhom` mọc lên ôm hộp thư
  // riêng của anh. DM đã có chủ (pane router) ⇒ HAI pane tranh nhau một hộp
  // thư, và bên thắng lại là agent NHÓM — sai cả vai lẫn bộ luật.
  // Tên tính năng là "panel-mỗi-NHÓM": ⛔ không phải nhóm thì ⛔ không mở.
  const { xuLyMotTin } = await import('../src/index.js');
  const db = dbTam();
  const DM_HOST = '9993000000000000003';
  const goi = [];
  xuLyMotTin({
    db,
    cauHinh: {
      cauTrungTinh: 'x',
      hosts: [{ userId: HOST, ten: 'Chủ máy', dmChatId: DM_HOST }],
      groups: [{ chatId: NHOM_A, ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true }],
    },
    guiThongBao: async () => true,
    tenHoiThoai: () => 'Chủ máy',
    log: () => {},
    soMoPhien: { baoDam: async (chatId) => { goi.push(chatId); return { daGoi: true }; } },
  }, {
    chatId: DM_HOST, msgId: 'w1b', cliMsgId: null, userId: HOST, tenLucGui: 'Chủ máy',
    msgType: 'chat.text', noiDung: 'anh nhắn riêng', contentRaw: null,
    tsZalo: 1_700_000_000_000, tuToi: false, coTagHost: true,
  });
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(goi, [], '🔴 mở pane cho DM = hai phiên tranh nhau hộp thư riêng của anh');
  const n = db.prepare('SELECT COUNT(*) n FROM hang_doi_hoi').get().n;
  assert.equal(n, 1, 'nhưng câu hỏi trong DM VẪN phải vào hàng đợi như thường');
  dongDb(db);
});

test('★★★ W2 lời gọi mở pane ⛔ KHÔNG được `await` (chặn callback websocket)', () => {
  // Lệnh do NGƯỜI VẬN HÀNH viết và có thể treo. `await` ở đây là giữ luôn
  // callback của websocket ⇒ MỌI nhóm câm, không riêng nhóm đang mở pane.
  // ⚠️ Canh CẤU TRÚC vì hành vi khó dựng: `xuLyMotTin` không phải `async`, nên
  // thêm `await` là LỖI CÚ PHÁP — mà lỗi cú pháp thì cả file test không nạp
  // được và bộ đo báo "chết" vì lý do sai. (Đã dính đúng thế: một lần chạy chỉ
  // 87/107 bài mà vẫn được tính là CHẾT.)
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const than = khoiGiua(idx, 'export function xuLyMotTin', '// MAIN')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(than, /p\.soMoPhien\.baoDam\(/, 'phải có lời gọi mở phiên');
  assert.ok(!/await\s+p\.soMoPhien/.test(than), '🔴 `await` lời gọi mở pane');
  // 🔴 NEO VÀO ĐÚNG LỜI GỌI. Bản đầu canh `/\.catch\(/` trên cả thân hàm và
  // đột biến "bỏ .catch của baoDam" SỐNG SÓT — vì trong thân còn MỘT `.catch(`
  // khác (của `guiThongBao`). Một assertion khớp được nhiều chỗ thì nó không
  // canh chỗ nào cả.
  const goiBaoDam = tuNeo(than, 'p.soMoPhien.baoDam(');
  assert.match(goiBaoDam.slice(0, 260), /\.catch\(/,
    '🔴 fire-and-forget mà không có .catch = unhandled rejection, có thể giết tiến trình');
});

test('★★★ W3 daemon truyền ĐÚNG trần thời gian cho lệnh mở pane', () => {
  // Đột biến đổi trần thành 1 giờ SỐNG SÓT vì `L7` gọi thẳng
  // `chayNotifyCommand` với trần riêng — nó ⛔ không đi qua `index.js`.
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(idx, /_chayLenh\(cauHinh\.tichHop\.moPhienLenh, duLieu, HAN_MO_PHIEN_MS\)/,
    '🔴 trần phải là HẰNG SỐ CHUNG, ⛔ không phải số viết tay tại chỗ');
});

test('★★★ W4 client: `chatIdHoi` và `treToiThieuMs` nối ĐÚNG nguồn', () => {
  // Ba đột biến sống ở đây: bỏ `chatIdHoi`, bỏ ngưỡng cho dự phòng, và áp
  // ngưỡng cho CẢ client riêng (làm pane riêng chậm 37 giây). Cả ba đều ⛔
  // không có bài hành vi nào với tới — muốn chạm phải spawn cả tiến trình.
  const idx = fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8');
  const kh = khoiGiua(idx, 'async function chayClient', 'export async function rutOutbox')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // 🔴 v10.3 — định tuyến nay lấy từ `ZTL_TUYEN` TRƯỚC, rồi mới tới `ZTL_CHAT_ID`.
  // 🔴 v11 — thêm đường ĐÈ cho LƯỚI VỚT, nhưng MẶC ĐỊNH phải y như cũ.
  assert.match(kh, /: \(tuyenTho \|\| phamViTho \|\| null\)/,
    '🔴 client riêng phải lọc theo chỗ mình nhận, ⛔ không nhặt hết');
  // 🔴 Và chỉ pane khai `toan_bo` mới được ĐÈ khoá đó (lưới vớt dòng vô chủ).
  // Bỏ điều kiện `toanBo` ⇒ pane khoá vào nhóm A vớt câu hỏi của nhóm B rồi
  // trả lời vào B trong khi chỉ đọc được A. Đúng lỗ hổng v10.2 sinh ra để bịt.
  // 🔴 v11.1 — nhịp vớt "vô chủ" nay là MỘT NHÁNH RIÊNG có ngưỡng riêng
  // (`UNCLAIMED_AGE_MS`), ⛔ không còn là tham số đè trong nhịp vớt thường: dùng
  // chung ngưỡng thì pane toàn quyền nhảy vào ĐÚNG LÚC pane chủ được thử lại.
  assert.match(kh, /if \(toanBo\) \{[\s\S]{0,220}?chatIdHoi: null/,
    '🔴 chỉ pane toàn quyền mới được vớt dòng vô chủ');
  // 🔴 Điều kiện phải là `laDuPhong`, ⛔ KHÔNG phải `toanBo`: `zalo-router` cũng
  // khai `toan_bo` nhưng nó là chủ sở hữu DM host và phải nhặt NGAY.
  assert.match(kh, /treToiThieuMs: laDuPhong \? nguongDuPhongMs : 0/,
    '🔴 ngưỡng chờ CHỈ dành cho vai dự phòng');
  assert.match(kh, /const laDuPhong = !tuyenTho && !phamViTho/,
    'vai dự phòng = KHÔNG khai chỗ nhận nào');
  assert.match(kh, /nguongDuPhongMs = cauHinh\.tichHop\?\.moPhienLenh \? GIAN_CHO_MO_PANE_MS : 0/,
    '🔴 moPhienLenh vắng ⇒ ngưỡng 0 — chờ 37 giây một pane KHÔNG BAO GIỜ tới');
});

test('★★★ W5 `tranSoClient` / `nghiSauGio` lạ -> cảnh báo rồi về mặc định, ⛔ KHÔNG ném', () => {
  // Ném ở đây là daemon CHẾT lúc khởi động vì một van chỉnh tay gõ sai.
  const nen = {
    hosts: [{ userId: HOST, ten: 'a', dmChatId: '9993000000000000003' }],
    groups: [{ chatId: NHOM_A, ten: 'g' }],
    cauTrungTinh: 'x',
    duongDan: { db: '/tmp/999a.db', session: '/tmp/999s', health: '/tmp/999h' },
  };
  for (const xau of ['bậy', -1, 0, {}, [], NaN]) {
    let c;
    assert.doesNotThrow(() => { c = kiemCauHinh({ ...nen, tranSoClient: xau, nghiSauGio: xau }); },
      `🔴 giá trị ${JSON.stringify(xau)} làm daemon CHẾT lúc khởi động`);
    assert.equal(c.tranSoClient, TRAN_SO_CLIENT_MAC_DINH);
    assert.equal(c.nghiSauGio, NGHI_SAU_GIO_MAC_DINH);
  }
  assert.equal(kiemCauHinh({ ...nen, tranSoClient: 7 }).tranSoClient, 7, 'phải chỉnh được');
});

test('★★★ W6 ĐÃ MỞ thì ⛔ không gọi lại, KỂ CẢ khi đã quá ngưỡng thử lại', async () => {
  // Đột biến "bỏ chốt đã-mở" SỐNG vì `L2` chạy trong vài mili-giây nên bị chốt
  // THỬ-LẠI chặn hộ. Hai lá chắn che nhau ⇒ phải tách: cho đồng hồ tiến quá
  // ngưỡng thử lại, lúc đó CHỈ còn chốt đã-mở làm việc.
  const dh = dongHo();
  const goi = [];
  const so = taoSoMoPhien({
    lenh: 'x', bayGio: dh.bayGio,
    chay: async (d) => { goi.push(d.chatId); return { thanhCong: true }; },
  });
  await so.baoDam(NHOM_A);
  assert.equal(goi.length, 1);
  for (let i = 0; i < 5; i += 1) {
    dh.tien(THU_LAI_MO_PHIEN_MS + 1_000);
    // eslint-disable-next-line no-await-in-loop
    await so.baoDam(NHOM_A);
  }
  assert.equal(goi.length, 1, `🔴 gọi ${goi.length} lần — chốt "đã mở" không làm việc`);
});

// ═══════════════════════════════════════════════════════════════════════
// P — PACK PHẢI SẠCH
// ═══════════════════════════════════════════════════════════════════════

test('★★★ P1 NGHIỆM THU⑤: ⛔ `grep -rn "herdr" src/` = 0 kết quả', () => {
  // Pack sắp lên git. Herdr là công cụ riêng của người vận hành; pack chỉ chạy
  // chuỗi lệnh người ta khai, ⛔ không biết bên kia là gì.
  const dinh = [];
  const di = (thu) => {
    for (const t of fs.readdirSync(thu, { withFileTypes: true })) {
      const p = path.join(thu, t.name);
      if (t.isDirectory()) { di(p); continue; }
      if (!/\.(js|json|sql)$/.test(t.name)) continue;
      const noi = fs.readFileSync(p, 'utf8');
      // ⚠️ Ghép từ mảnh để chính bài test này ⛔ không tự khớp.
      if (new RegExp(['her', 'dr'].join(''), 'i').test(noi)) dinh.push(p);
    }
  };
  di(path.join(process.cwd(), 'src'));
  assert.deepEqual(dinh, [], `🔴 pack nhắc tới công cụ riêng của người dùng: ${dinh.join(', ')}`);
});

test('★★★ P2 `mo_phien.js` ⛔ không chứa đường dẫn máy ai', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/ops/mo_phien.js'), 'utf8');
  assert.ok(!/\/Users\//.test(src), 'có đường dẫn tuyệt đối của một máy cụ thể');
  assert.ok(!/40_system/.test(src), 'có đường dẫn hệ riêng của người vận hành');
});

test('★★★ P3 tài liệu tích hợp phải nói RÕ giới hạn của client dự phòng', () => {
  // ⛔ Đừng bán client dự phòng là "an toàn hơn". Nó đọc nhiều nhóm ⇒ mức cô
  // lập ĐÚNG BẰNG hôm nay. Người vận hành phải biết trước khi bật.
  const doc = fs.readFileSync(path.join(process.cwd(), 'TICH_HOP_TUY_CHON.md'), 'utf8');
  assert.match(doc, /moPhienLenh/);
  assert.match(doc, /dự phòng/i);
  assert.match(doc, /đúng\s*\*?\*?bằng/i, 'phải nói mức cô lập ĐÚNG BẰNG hôm nay');
  assert.match(doc, /không spawn/i, 'phải nói rõ pack ⛔ không spawn gì');
});
