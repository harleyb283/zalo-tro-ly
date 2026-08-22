/**
 * ═══════════════════════════════════════════════════════════════════════
 * CHỐNG TỤT HẬU — bảng tool trong FILE LUẬT phải khớp `src/mcp/tools.js`.
 *
 * 🔴 VÌ SAO CÓ BÀI NÀY (hỏng THẬT 2 lần trong ngày 20/08/2026):
 *   1. File luật ghi "4 tool có sẵn" trong khi server đăng ký 12 ⇒ trợ lý mất
 *      8 năng lực trong im lặng.
 *   2. File luật thiếu tham số `chuKyPhut` ⇒ host bảo "3 phút nhắc lại 1 lần",
 *      trợ lý TRẢ LỜI LÀ CÔNG CỤ KHÔNG LÀM ĐƯỢC — trong khi tính năng đã chạy.
 *
 *   Cả hai lần đều hỏng CÂM: không exception, không log, chỉ là trợ lý tin bảng
 *   chép tay hơn tin mô tả tool lúc chạy. Lần đầu đã sửa con số, nhưng KHÔNG AI
 *   CHẶN nó tái diễn — nên nó tái diễn sau vài tiếng. Bài này chặn cả LOẠI lỗi.
 *
 * ═══ KHÔNG LÀM BÀI TEST GIÒN ═══
 * Bài này CHỈ canh hai thứ, đều là dữ liệu máy đọc được:
 *   · TÊN TOOL nào tồn tại
 *   · TÊN THAM SỐ của từng tool, và tham số đó bắt buộc hay tuỳ chọn
 *
 * ⛔ TUYỆT ĐỐI KHÔNG canh: câu mô tả, thứ tự dòng, tiêu đề mục, emoji, cách
 *    diễn đạt. Canh văn xuôi thì mỗi lần sửa câu chữ là đỏ oan, và chuyện gì
 *    xảy ra tiếp thì đã có tiền lệ: người ta TẮT bài test đi
 *    (bài học `ref_validator_false_alarm_traps`).
 *    ⇒ Sửa lời văn trong file luật KHÔNG bao giờ làm bài này đỏ.
 *      Chỉ đổi TÊN tool / TÊN tham số / tính bắt buộc mới đỏ.
 * ═══════════════════════════════════════════════════════════════════════
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const GOC = process.cwd();
const F_TOOLS = path.join(GOC, 'src/mcp/tools.js');
const F_HANGSO = path.join(GOC, 'src/lib/hang_so.js');
/** Bản luật TRONG PACK — thứ người khác clone về. Luôn tồn tại. */
const F_PACK = path.join(GOC, '.claude/agents/zalo-nhom.md');
/**
 * Bản ĐANG CHẠY của người vận hành — nằm NGOÀI repo, có thể không tồn tại.
 *
 * 🔴 KHAI BẰNG BIẾN MÔI TRƯỜNG, ⛔ KHÔNG dò bằng `../..` nữa (sửa 21/08/2026).
 * Bản cũ đoán đường bằng cách đi ngược hai cấp từ gốc repo — điều đó chỉ đúng
 * khi repo nằm đúng một chỗ trong cây thư mục của người vận hành. Repo đã được
 * TÁCH RA ngoài, nên đường đó thành `/Users/.claude/...` ⇒ ba bài đối chiếu
 * lặng lẽ chuyển sang SKIP mà ⛔ không ai được báo là đã mất lớp canh nào.
 *
 * ⚠️ Vắng biến ⇒ SKIP êm (người clone repo về ⛔ không có bản đang chạy). Người
 * vận hành muốn canh thì khai:
 *     ZTL_LUAT_DANG_CHAY=<đường dẫn>/.claude/agents/zalo-tro-ly.md
 *     ZTL_CORE_RULES=<đường dẫn>/core-rules.md
 */
const F_LUAT = (process.env.ZTL_LUAT_DANG_CHAY ?? '').trim();
const F_CORE = (process.env.ZTL_CORE_RULES ?? '').trim();

/**
 * 🔴 HAI FILE NGOÀI PACK PHẢI ĐƯỢC PHÉP VẮNG MẶT (sửa 21/08/2026).
 *
 * Bản đầu của bài này chỉ biết bản đang chạy, vì lúc đó pack chưa có bản luật
 * riêng. Hệ quả: ai clone pack về là suite ĐỎ ngay lần chạy đầu với lỗi ENOENT —
 * và bài test đầu tiên người ta tắt là bài đỏ vô cớ
 * (`ref_validator_false_alarm_traps`). Nay bảng tham số được canh trên **bản
 * trong pack** (luôn có), còn hai file của hệ riêng thì canh THÊM khi có mặt.
 */
const CO_LUAT = Boolean(F_LUAT) && fs.existsSync(F_LUAT);
const CO_CORE = Boolean(F_CORE) && fs.existsSync(F_CORE);

// ═══════════════════════════════════════════════════════════════════════
// NGUỒN SỰ THẬT: đọc thẳng tools.js
// ═══════════════════════════════════════════════════════════════════════

/** Đổi `TEN_TOOL_NHAC.CHINH_NHIP_NHAC` -> `'followup_adjust'` bằng hang_so.js. */
function tenThat(hangSo, nhom, khoa) {
  const than = hangSo.split(`export const ${nhom}`)[1] ?? '';
  const m = than.match(new RegExp(`${khoa}:\\s*'([^']+)'`));
  return m ? m[1] : null;
}

/**
 * -> Map<tênTool, {bat:Set, tuyChon:Set}>
 *
 * Cắt theo RANH GIỚI giữa hai khai báo `name:` liên tiếp — không dùng cửa sổ
 * ký tự cố định. Cửa sổ cố định từng làm tham số của tool này lẫn sang tool kế
 * bên (đã dính thật khi soạn tài liệu), và một bài test đọc sai nguồn sự thật
 * thì tệ hơn không có bài test nào.
 */
function docTuCode() {
  const s = fs.readFileSync(F_TOOLS, 'utf8');
  const hs = fs.readFileSync(F_HANGSO, 'utf8');
  const moc = [...s.matchAll(/name:\s*(TEN_TOOL[A-Z_]*)\.([A-Z_]+)/g)];
  const ra = new Map();

  moc.forEach((m, i) => {
    const ten = tenThat(hs, m[1], m[2]);
    assert.ok(ten, `không tra được tên thật của ${m[1]}.${m[2]} trong hang_so.js`);
    const den = i + 1 < moc.length ? moc[i + 1].index : s.length;
    const doan = s.slice(m.index, den);

    const bat = new Set(
      ((doan.match(/required:\s*\[([^\]]*)\]/) ?? [])[1] ?? '')
        .split(',').map((x) => x.replace(/['"\s]/g, '')).filter(Boolean),
    );
    // Thuộc tính của inputSchema thụt vào đúng 8 dấu cách — khớp cách viết
    // đang dùng trong tools.js.
    const tatCa = [...doan.matchAll(/^ {8}([a-zA-Z_]+):\s*\{/gm)].map((x) => x[1]);
    const tuyChon = new Set(tatCa.filter((p) => !bat.has(p)));
    ra.set(ten, { bat, tuyChon });
  });
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════
// BÊN KIA: đọc bảng trong file luật
// ═══════════════════════════════════════════════════════════════════════

/**
 * -> Map<tênTool, {bat:Set, tuyChon:Set}> lấy từ các dòng bảng markdown dạng
 *      | `ten_tool` | mô tả gì cũng được | `a`* · `b` · `c` |
 *
 * CHỈ đọc ô ĐẦU (tên tool) và ô CUỐI (tham số). Ô mô tả ở giữa bị BỎ QUA hoàn
 * toàn — đó chính là chỗ làm bài test giòn nếu đem ra so.
 */
function docTuLuat(duongDan, tenTool) {
  const s = fs.readFileSync(duongDan, 'utf8');
  const ra = new Map();
  for (const dong of s.split('\n')) {
    if (!dong.trim().startsWith('|')) continue;
    const o = dong.split('|').map((x) => x.trim());
    if (o.length < 4) continue;
    const ten = (o[1].match(/^`([a-z_]+)`/) ?? [])[1];
    if (!ten || !tenTool.has(ten)) continue;

    const oCuoi = o[o.length - 2];
    const bat = new Set();
    const tuyChon = new Set();
    for (const m of oCuoi.matchAll(/`([a-zA-Z_]+)`(\*?)/g)) {
      (m[2] === '*' ? bat : tuyChon).add(m[1]);
    }
    // Một tool có thể xuất hiện ở nhiều bảng (bảng chi tiết + bảng tóm tắt).
    // Gộp lại: chỉ cần MỘT bảng khai đủ là coi như luật có ghi.
    // ⚠️ Ghi nhận CẢ KHI ô tham số rỗng: `status` không có tham số nào và ô
    //    của nó ghi "(không có)". Bỏ qua dòng rỗng thì T1 báo thiếu tool oan —
    //    đã dính thật lúc chạy lần đầu.
    const cu = ra.get(ten);
    if (cu) {
      for (const x of bat) cu.bat.add(x);
      for (const x of tuyChon) cu.tuyChon.add(x);
    } else {
      ra.set(ten, { bat, tuyChon });
    }
  }
  return ra;
}

const CODE = docTuCode();

// ═══════════════════════════════════════════════════════════════════════

test('T0 đọc được nguồn sự thật: tools.js khai ít nhất 14 tool', () => {
  assert.ok(CODE.size >= 14, `chỉ đọc được ${CODE.size} tool — bộ đọc hỏng?`);
  for (const buoc of ['history', 'reply', 'followup_start', 'followup_adjust']) {
    assert.ok(CODE.has(buoc), `thiếu ${buoc} — bộ đọc cắt sai ranh giới?`);
  }
  // Chống lẫn tham số sang tool kế bên: `reply` chỉ có đúng 2 tham số.
  assert.deepEqual([...CODE.get('reply').bat].sort(), ['request_id', 'text']);
  // v6: `reply` có ĐÚNG hai tham số tuỳ chọn — đường thoát của chốt chặn ghi.
  // ⚠️ Vẫn là phép canh RANH GIỚI BỘ ĐỌC như bản cũ (trước đây là "0 tham số"):
  // liệt kê ĐÚNG TÊN thay vì đếm, nên bộ đọc mà lẫn sang tool kế bên là vẫn đỏ.
  assert.deepEqual([...CODE.get('reply').tuyChon].sort(), ['khongCanGhi', 'lyDo'],
    'tra_loi chỉ được có khongCanGhi + lyDo — khác đi = bộ đọc lẫn sang tool khác');
});

/**
 * Mọi bản luật đang phải khớp code. `nhan` chỉ để in ra khi đỏ.
 * Bản trong pack LUÔN có mặt; bản đang chạy chỉ có trên máy người vận hành.
 */
const CAC_BAN = [
  { f: F_PACK, nhan: '.claude/agents/zalo-nhom.md (BẢN TRONG PACK)' },
  ...(CO_LUAT ? [{ f: F_LUAT, nhan: '<gốc repo>/.claude/agents/zalo-tro-ly.md (BẢN ĐANG CHẠY)' }] : []),
];

test('🔴 T1 MỌI bản luật phải liệt kê ĐỦ 18 tool — thiếu là mất năng lực trong im lặng', () => {
  for (const { f, nhan } of CAC_BAN) {
    const luat = docTuLuat(f, CODE);
    const thieu = [...CODE.keys()].filter((t) => !luat.has(t));
    assert.deepEqual(thieu, [],
      `${nhan} thiếu bảng tham số cho: ${thieu.join(', ')}\n`
      + '  ⇒ trợ lý sẽ KHÔNG BIẾT là mình có mấy tool này.');
  }
});

test('🔴 T2 MỌI THAM SỐ trong code phải có mặt trong bảng luật (ca chuKyPhut)', () => {
  for (const { f, nhan } of CAC_BAN) {
    const luat = docTuLuat(f, CODE);
    const loi = [];
    for (const [ten, c] of CODE) {
      const l = luat.get(ten);
      if (!l) continue;                       // T1 lo ca thiếu hẳn tool
      const coTrongLuat = new Set([...l.bat, ...l.tuyChon]);
      for (const p of [...c.bat, ...c.tuyChon]) {
        if (!coTrongLuat.has(p)) loi.push(`${ten}.${p}`);
      }
    }
    assert.deepEqual(loi, [],
      `${nhan} THIẾU tham số: ${loi.join(', ')}\n`
      + '  ⇒ đúng ca 20/08/2026: thiếu `chuKyPhut` nên trợ lý báo với host là\n'
      + '    "công cụ chưa làm được kiểu đó" trong khi tính năng đã chạy.');
  }
});

test('T3 bảng luật KHÔNG được khai tham số MA (code không có)', () => {
  for (const { f, nhan } of CAC_BAN) {
    const luat = docTuLuat(f, CODE);
    const ma = [];
    for (const [ten, l] of luat) {
      const c = CODE.get(ten);
      const coTrongCode = new Set([...c.bat, ...c.tuyChon]);
      for (const p of [...l.bat, ...l.tuyChon]) {
        if (!coTrongCode.has(p)) ma.push(`${ten}.${p}`);
      }
    }
    assert.deepEqual(ma, [],
      `${nhan} khai tham số KHÔNG CÓ trong code: ${ma.join(', ')}\n`
      + '  ⇒ trợ lý sẽ gọi tool với tham số lạ và bị server từ chối.');
  }
});

test('🔴 T4 tính BẮT BUỘC phải khớp — hứa thừa/hứa thiếu đều sai', () => {
  for (const { f, nhan } of CAC_BAN) {
    const luat = docTuLuat(f, CODE);
    const lech = [];
    for (const [ten, c] of CODE) {
      const l = luat.get(ten);
      if (!l) continue;
      for (const p of c.bat) {
        if (l.tuyChon.has(p)) lech.push(`${ten}.${p}: code BẮT BUỘC, luật ghi tuỳ chọn`);
      }
      for (const p of c.tuyChon) {
        if (l.bat.has(p)) {
          lech.push(`${ten}.${p}: code TUỲ CHỌN, luật ghi bắt buộc `
            + '(trợ lý sẽ đòi host cung cấp thứ không cần)');
        }
      }
    }
    assert.deepEqual(lech, [], `${nhan}\n${lech.join('\n')}`);
  }
});

test('T5 core-rules.md nhắc đủ tên tool', { skip: !CO_CORE }, () => {
  // ⚠️ TÊN BÀI ĐÃ SỬA 21/08/2026 — bản cũ ghi `[T1] ... (nó đọc FULL mỗi lượt)`.
  // Tiền đề đó ĐÃ CHẾT: đo cả phiên không thấy MỘT lời gọi `Read` nào ⇒
  // `core-rules.md` chưa từng được nạp, và nó đã bị hạ xuống `[T2]`.
  // Tên bài test sai là một dạng tài liệu sai: người sau đọc tên rồi tin file
  // này vào context mỗi lượt, và thiết kế tiếp trên một tiền đề đã chết.
  // ✅ Phần assert GIỮ NGUYÊN — `core-rules.md` vẫn phải liệt kê đủ 12 tool cho
  // lúc nó THẬT SỰ được đọc; chuyện nó có được nạp tự động hay không là việc khác.
  //
  // Ở đây chỉ canh TÊN TOOL, KHÔNG canh tham số: `core-rules.md` cố ý là bản
  // rút gọn, bắt nó chép đủ bảng tham số là ép nó phình ra và trùng lặp.
  const s = fs.readFileSync(F_CORE, 'utf8');
  const thieu = [...CODE.keys()].filter((t) => !s.includes(`\`${t}\``));
  assert.deepEqual(thieu, [], `core-rules.md không nhắc tới: ${thieu.join(', ')}`);
});

test('🔴 T6 file luật phải có CHỐT CHẶN HÀNH VI "mô tả tool lúc chạy mới là sự thật"', () => {
  // Bảng khớp code hôm nay KHÔNG bảo đảm nó khớp ngày mai. Chốt chặn cuối cùng
  // là hành vi: thấy tham số lạ thì CỨ DÙNG, và CẤM tự phán "chưa có tính năng".
  // Canh bằng vài từ khoá ổn định, không canh nguyên câu.
  const canKiem = [
    [F_PACK, 'agent md (BẢN TRONG PACK)'],
    ...(CO_LUAT ? [[F_LUAT, 'agent md (BẢN ĐANG CHẠY)']] : []),
    ...(CO_CORE ? [[F_CORE, 'core-rules']] : []),
  ];
  for (const [f, nhan] of canKiem) {
    const s = fs.readFileSync(f, 'utf8');
    assert.match(s, /TỤT HẬU/, `${nhan}: thiếu cảnh báo bảng có thể tụt hậu`);
    assert.match(s, /lúc chạy mới là sự thật|LÚC CHẠY mới là sự thật/i,
      `${nhan}: thiếu câu "mô tả tool lúc chạy mới là sự thật"`);
    assert.match(s, /chưa có tính năng đó/,
      `${nhan}: thiếu lệnh CẤM nói "chưa có tính năng đó"`);
  }
});
