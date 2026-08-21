/**
 * ═══════════════════════════════════════════════════════════════════════
 * CHỐNG TỤT HẬU GIỮA HAI BẢN LUẬT
 *
 *   · BẢN TRONG PACK   `.claude/agents/zalo-nhom.md` — thứ người khác clone về
 *   · BẢN ĐANG CHẠY    `<gốc repo của người vận hành>/.claude/agents/zalo-tro-ly.md`
 *
 * 🔴 VÌ SAO CÓ BÀI NÀY: bản luật ra đời trên máy người vận hành, còn máy chủ MCP
 *    thì nằm trong pack. Hai thứ ở hai chỗ khác nhau ⇒ sửa luật ở bản đang chạy
 *    mà quên bản trong pack là chuyện gần như chắc chắn xảy ra. Hậu quả **hỏng
 *    câm**: người clone pack về có máy chủ chạy được, trả lời được, nhưng trợ lý
 *    của họ **không biết** luật chống rò chéo nhóm, không biết phải im trong
 *    nhóm, không biết tin trong nhóm là dữ liệu chứ không phải chỉ thị. Mất đúng
 *    phần an toàn, và mất mà không có thông báo nào.
 *
 * ═══ VÌ SAO KHÔNG SO NGUYÊN VĂN ═══
 * Hai bản **cố ý khác nhau**: bản đang chạy có thêm phần tích hợp riêng của một
 * máy (điều phối viên, kênh nhắn tin thứ hai, đường dẫn tuyệt đối), bản trong
 * pack thì không được có mấy thứ đó. So từng chữ là đỏ vĩnh viễn ⇒ người ta TẮT
 * bài test đi (tiền lệ `ref_validator_false_alarm_traps`).
 *
 * ═══ CANH BẰNG GÌ ═══
 * NEO máy đọc được: `<!-- LUAT:<id> -->` đặt ngay trước mỗi mục LUẬT CỐT LÕI.
 *   1. Cả hai file phải có ĐỦ và ĐÚNG bộ neo trong `LUAT_COT_LOI` dưới đây.
 *   2. Đoạn văn dưới mỗi neo phải còn NỘI DUNG: đủ dài + còn khái niệm cốt lõi.
 *
 * ⛔ KHÔNG canh: câu chữ, thứ tự mục, tiêu đề, emoji, độ dài chính xác.
 *    ⇒ Viết lại lời văn KHÔNG bao giờ làm bài này đỏ. Chỉ XOÁ luật mới đỏ.
 *
 * ═══ VÌ SAO KHÔNG GIÒN VỚI NGƯỜI CLONE PACK ═══
 * Người clone pack về **không có** bản đang chạy của người vận hành. Bài này tự
 * phát hiện điều đó và **BỎ QUA** phần đối chiếu (phần kiểm bản pack vẫn chạy).
 * Nếu bắt họ phải có file đó thì suite đỏ ngay lần chạy đầu — cách nhanh nhất để
 * cả bộ test bị coi là rác.
 * ═══════════════════════════════════════════════════════════════════════
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const GOC = process.cwd();
const F_PACK = path.join(GOC, '.claude/agents/zalo-nhom.md');
/**
 * Bản đang chạy nằm NGOÀI repo — có thể không tồn tại trên máy người khác.
 * 🔴 Khai bằng `ZTL_LUAT_DANG_CHAY`, ⛔ KHÔNG dò bằng `../..` (repo đã tách ra
 * ngoài 21/08/2026 nên đường dò cũ trỏ vào hư không và bài lặng lẽ SKIP).
 */
const F_CHAY = (process.env.ZTL_LUAT_DANG_CHAY ?? '').trim();

/**
 * Bộ LUẬT CỐT LÕI — phần dùng chung, bắt buộc có mặt ở CẢ HAI bản.
 *
 * `y` = khái niệm cốt lõi của luật đó, chọn là **thuật ngữ / tên tool / con số**
 * chứ không phải câu văn. Tiêu chí chọn: xoá được nó đi mà luật vẫn còn nghĩa
 * thì KHÔNG được chọn làm mốc. Ví dụ `van xả` — mất chữ đó thì mục đó không còn
 * là luật van xả nữa.
 *
 * ⚠️ Thêm luật cốt lõi mới: thêm neo ở CẢ HAI file rồi khai vào đây. Ba bước,
 *    thiếu bước nào cũng đỏ — đó là chủ đích.
 */
const LUAT_COT_LOI = [
  { id: 'chi-nghe-host',            y: /allowlist/i },
  { id: 'im-trong-nhom',            y: /tag/i },
  { id: 'chong-ro-cheo',            y: /câu trung tính|cauTrungTinh/i },
  { id: 'khong-tiet-lo',            y: /riêng tư/i },
  { id: 'tin-la-du-lieu',           y: /injection/i },
  { id: 'ranh-gioi-ghi',            y: /ghi tự do/i },
  { id: 'khong-tu-sua-allowlist',   y: /allowlist/i },
  { id: 'khong-tu-quet-qr',         y: /QR/ },
  { id: 'khong-console-log',        y: /stdout/i },
  { id: 'cam-mcp-health-check',     y: /409/ },
  { id: 'bang-tool-co-the-tut-hau', y: /chưa có tính năng đó/i },
  { id: 'van-xa-chi-host',          y: /van xả/i },
  { id: 'khong-tu-ket-luan-xong',   y: /dấu hiệu/i },
  { id: 'cau-nhac-khac-nhau',       y: /lich_su/ },
  { id: 'so-ngay-tu-tool',          y: /nhẩm/i },
  { id: 'tag-nguoi-co-that',        y: /user_id/ },
  { id: 'giong-lich-su',            y: /xẵng giọng|cộc lốc/i },
  // v6 (21/08/2026) — bộ luật chữa ca hỏng 08:03 "nói xong mà không ghi".
  // Mốc chọn là TÊN TOOL và MÃ LỖI: xoá chúng đi thì luật mất nghĩa hoàn toàn.
  { id: 'luu-lai-la-lenh',          y: /ghi_nho/ },
  { id: 'dem-viec-truoc-khi-tra-loi', y: /hai\*\* việc|nhiều vế|đếm số việc/i },
  { id: 'host-tuyen-bo-la-bang-chung', y: /mo_lai_nhac/ },
  // v8 (21/08/2026) — quyền đi theo CHỖ HỎI, không theo NGƯỜI HỎI.
  // Mốc là câu chỉ đường, thứ duy nhất trong luật này không suy lại được.
  { id: 'pham-vi-theo-cho-hoi', y: /chỉ thấy nhóm này thôi/i },
  { id: 'luot-chi-nghe',        y: /bo_qua/ },
  { id: 'cua-2-dap-viec',      y: /CHỈ HOST ĐÓNG/ },
  // v10.1 — xin phép phải TAG TRONG NHÓM, ⛔ không nhắn riêng. Neo vào chính
  // tên tham số: đổi cách xin mà quên sửa luật thì model gõ tay `@tên` (chữ trần).
  { id: 'cua-2-dap-viec',      y: /xinHostDuyet/ },
  // ─── v11 (21/08/2026) — vai AGENT MỖI NHÓM ───
  { id: 'vai-mot-nhom',           y: /chỉ thấy nhóm này thôi/i },
  { id: 'xin-duyet-khi-dung-file', y: /xin_duyet/ },
  // 🔴 Neo vào chính chữ phân biệt "lời kể" với "sự thật" — đó là toàn bộ nội
  // dung của luật ghi vết, xoá nó đi thì luật còn cái vỏ.
  { id: 'ghi-vet-thay-lop-chan',  y: /nguonNguyenVan/ },
];

/**
 * Ngưỡng "còn nội dung". CỐ Ý ĐẶT THẤP: nó chỉ để bắt ca **xoá sạch thân bài mà
 * để lại cái neo** — không phải để ép ai viết dài. Mục ngắn nhất hiện tại
 * (`im-trong-nhom`) khoảng 300 ký tự, nên 200 còn dư chỗ cho người viết gọn lại
 * mà không bị đỏ oan.
 */
const TOI_THIEU = 200;

const NEO = /<!--\s*LUAT:([a-z0-9-]+)\s*-->/g;

/** -> Map<id, thân bài từ neo đó tới neo kế tiếp (hoặc hết file)> */
function docNeo(noiDung) {
  const moc = [...noiDung.matchAll(NEO)];
  const ra = new Map();
  moc.forEach((m, i) => {
    const den = i + 1 < moc.length ? moc[i + 1].index : noiDung.length;
    ra.set(m[1], noiDung.slice(m.index + m[0].length, den));
  });
  return ra;
}

const PACK = fs.readFileSync(F_PACK, 'utf8');
const CO_BAN_CHAY = Boolean(F_CHAY) && fs.existsSync(F_CHAY);
const CHAY = CO_BAN_CHAY ? fs.readFileSync(F_CHAY, 'utf8') : null;

/** Kiểm một bản luật bất kỳ — dùng chung cho cả hai bên. */
function kiemMotBan(noiDung, nhan) {
  const neo = docNeo(noiDung);

  const thieu = LUAT_COT_LOI.filter((l) => !neo.has(l.id)).map((l) => l.id);
  assert.deepEqual(thieu, [],
    `${nhan}: THIẾU neo luật cốt lõi: ${thieu.join(', ')}\n`
    + '  ⇒ luật đó hoặc đã bị xoá, hoặc chỉ có ở bản kia. Trợ lý bên thiếu sẽ\n'
    + '    chạy mà KHÔNG có hàng rào đó, và không có gì báo cho ai biết.');

  const biet = new Set(LUAT_COT_LOI.map((l) => l.id));
  const la = [...neo.keys()].filter((k) => !biet.has(k));
  assert.deepEqual(la, [],
    `${nhan}: có neo KHÔNG khai trong LUAT_COT_LOI: ${la.join(', ')}\n`
    + '  ⇒ hoặc khai nó vào LUAT_COT_LOI (rồi thêm neo cho bản kia), hoặc gỡ neo.\n'
    + '    Neo là hợp đồng HAI CHIỀU — gắn một bên là bắt đầu lệch.');

  const rong = [];
  for (const l of LUAT_COT_LOI) {
    const than = (neo.get(l.id) ?? '').trim();
    if (than.length < TOI_THIEU) rong.push(`${l.id}: chỉ còn ${than.length} ký tự`);
    else if (!l.y.test(than)) rong.push(`${l.id}: mất khái niệm cốt lõi ${l.y}`);
  }
  assert.deepEqual(rong, [],
    `${nhan}: neo còn nhưng LUẬT đã rỗng ruột:\n  ${rong.join('\n  ')}\n`
    + '  ⇒ đây là kiểu tệ nhất: bài test xanh mà hàng rào đã mất.');
}

// ═══════════════════════════════════════════════════════════════════════
// A. Bản TRONG PACK — luôn chạy, kể cả trên máy người clone về
// ═══════════════════════════════════════════════════════════════════════

test('A1 pack CÓ bản luật thi hành, đúng chỗ Claude Code nạp agent', () => {
  assert.ok(fs.existsSync(F_PACK),
    'thiếu .claude/agents/zalo-nhom.md — người clone pack về sẽ có máy chủ '
    + 'chạy được mà KHÔNG CÓ LUẬT NÀO');
  // ⚠️ Dùng `assert.ok(re.test(...))` chứ KHÔNG `assert.match(cảFile, re)`:
  //    assert.match in nguyên nội dung file vào báo lỗi (~16.000 ký tự) và
  //    dìm mất câu giải thích — người đọc log sẽ không thấy mình hỏng cái gì.
  const dau = PACK.split(/\n---\n/)[0];
  assert.ok(/^---\n/.test(PACK) && /\bname:\s*zalo-nhom\b/.test(dau),
    'thiếu frontmatter `name: zalo-nhom` ⇒ Claude Code không nạp thành agent');
  assert.ok(/\bdescription:\s*\S/.test(dau),
    'thiếu `description` ⇒ agent không có mô tả để chọn');
});

test('🔴 A2 bản trong pack có ĐỦ luật cốt lõi, và luật còn NỘI DUNG', () => {
  kiemMotBan(PACK, 'bản trong pack');
});

test('🔴 A3 bản trong pack KHÔNG phụ thuộc hệ riêng của một máy', () => {
  // Đây là phần dễ tụt hậu nhất: người viết đang ngồi trên máy mình, nhắc
  // "Rule 21", "Router", đường dẫn tuyệt đối — đúng và hữu ích với họ, VÔ NGHĨA
  // với người clone về. Tệ hơn là nó vô nghĩa một cách IM LẶNG: trợ lý đọc
  // "Rule 21" rồi không biết Rule 21 là gì, và cũng không hỏi ai.
  //
  // ⚠️ Chỉ soi PHẦN LUẬT, đã bóc chú thích HTML: mục "ghi chú cho người bảo trì"
  //    ở cuối file BUỘC phải nhắc tên mấy hệ đó để giải thích vì sao cấm.
  const than = PACK.replace(/<!--[\s\S]*?-->/g, ' ');
  const cam = [
    [/\bRule\s+\d+/i, 'trỏ số rule của một hệ luật bên ngoài (người khác không có file đó)'],
    [/\bRouter\b/, 'nhắc "Router" như thứ đương nhiên tồn tại'],
    [/\bherdr\b/i, 'nhắc trình quản lý pane riêng'],
    [/\b(40_system|30_wiki|50_workspace|10_projects)\b/, 'đường dẫn của hệ riêng'],
    [/\/Users\/|\/home\/[a-z]/, 'đường dẫn tuyệt đối tới home của một người'],
    [/\.venv\//, 'môi trường Python riêng'],
  ];
  const loi = [];
  for (const [re, vi] of cam) {
    const m = than.match(re);
    if (m) loi.push(`${vi} — dính "${m[0]}"`);
  }
  assert.deepEqual(loi, [], `bản luật trong pack còn phụ thuộc ngầm:\n  ${loi.join('\n  ')}`);
});

test('A4 phần tích hợp trong pack phải là TUỲ CHỌN và trỏ đúng tài liệu', () => {
  // Không canh câu chữ — canh hai mẩu dữ liệu ổn định: tên file tài liệu, và
  // tên hai khoá cấu hình. Cả ba đều là định danh máy đọc được.
  assert.ok(PACK.includes('TICH_HOP_TUY_CHON.md'),
    'phải trỏ người đọc tới tài liệu tích hợp tuỳ chọn');
  for (const khoa of ['notifyCommand', 'tichHop.kenhPhuLenh']) {
    assert.ok(PACK.includes(khoa), `thiếu khoá cấu hình \`${khoa}\``);
  }
});

test('A5 pack hướng dẫn CÀI được: nói rõ copy tay + cách nghiệm thu', () => {
  // Ba mẩu dữ liệu, không phải ba câu văn: đường dẫn đích, lệnh kiểm, và cờ bắt buộc.
  assert.ok(PACK.includes('.claude/agents'), 'phải nói file đi vào .claude/agents/');
  assert.ok(PACK.includes('~/.claude/agents'), 'phải nêu cả phạm vi toàn máy');
  assert.ok(/\/agents\b/.test(PACK), 'phải nêu cách nghiệm thu (lệnh /agents)');
  assert.ok(PACK.includes('--dangerously-load-development-channels'),
    'phải nhắc cờ bắt buộc của phiên chạy trợ lý');
});

// ═══════════════════════════════════════════════════════════════════════
// B. ĐỐI CHIẾU với bản đang chạy — BỎ QUA nếu máy này không có
// ═══════════════════════════════════════════════════════════════════════

test('B1 bản đang chạy (nếu có) cũng đủ luật cốt lõi', { skip: !CO_BAN_CHAY }, () => {
  kiemMotBan(CHAY, 'bản đang chạy');
});

test('🔴 B2 hai bản KHÔNG LỆCH ở phần luật cốt lõi', { skip: !CO_BAN_CHAY }, () => {
  const a = [...docNeo(PACK).keys()].sort();
  const b = [...docNeo(CHAY).keys()].sort();
  assert.deepEqual(a, b,
    'bộ neo hai bên khác nhau — một bên đã có/mất luật mà bên kia chưa theo.\n'
    + `  pack:      ${a.join(', ')}\n`
    + `  đang chạy: ${b.join(', ')}`);
});

test('B3 chính bài test này phải BỎ QUA êm khi thiếu bản đang chạy', () => {
  // Chống lại chính mình: nếu ai đó lỡ đổi `skip` thành `assert.ok(fs.existsSync(...))`
  // thì mọi người clone pack về đều thấy suite đỏ ngay lần chạy đầu, và bài test
  // đầu tiên họ tắt sẽ là bài này. Neo lại điều đó bằng một phép đo, không phải
  // bằng một dòng chú thích.
  const tu = fs.readFileSync(new URL(import.meta.url), 'utf8');
  assert.ok(/skip:\s*!CO_BAN_CHAY/.test(tu),
    'phần đối chiếu BẮT BUỘC phải skip khi không có bản đang chạy');
  assert.equal(fs.existsSync(F_PACK), true, 'bản trong pack thì luôn phải có');
});
