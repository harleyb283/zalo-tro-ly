/**
 * ═══════════════════════════════════════════════════════════════════════
 * v3 — BỘ CHẠY LỊCH HẸN. Đánh thức mỗi `NHIP_KIEM_MS`, gửi lịch tới hạn.
 *
 * 🔴 MỘT LỊCH GỬI ĐÚNG MỘT LẦN. Cơ chế: `nhanDangGui()` đổi trạng thái bằng
 *    `UPDATE ... WHERE trang_thai = 'da_len_lich'` và chỉ đi tiếp khi
 *    `changes === 1`. Tức là DÀNH CHỖ TRƯỚC khi gọi mạng. Nếu gửi trước rồi
 *    mới đánh dấu thì daemon chết giữa chừng = gửi lại lần nữa lúc khởi động,
 *    và người trong nhóm nhận hai tin nhắc giống hệt nhau.
 *
 * 🔴 KHÔNG dùng `createReminder` của Zalo. Anh đã cắt phương án đó.
 *
 * ✅ TAG NGƯỜI: dùng lại nguyên tầng mention có sẵn ở `zalo/send.js`
 *    (`dungMentions` — NFC, `len` GỒM ký tự '@', tra uid qua `dsNguoiTrongNhom`).
 *    KHÔNG viết lại. Ở đây chỉ làm phần ngược: uid -> tên, để ghép chuỗi `@Tên`
 *    vào đầu tin cho tầng kia nhận ra.
 *    🔴 Uid không tra ra tên ⇒ BỎ tag đó, ghi cảnh báo. CẤM bịa tên, vì tên bịa
 *    sẽ không khớp ai và tầng dưới lại bỏ qua trong im lặng.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { CHE_DO, GIOI_HAN_LICH, TRANG_THAI_HANG_DOI } from '../lib/hang_so.js';
import { safeLogText } from '../lib/redact.js';
import { baoDamTag } from '../zalo/send.js';

import { taoBoCanhOutbox } from './canh_outbox.js';

import {
  danhDauQuaHan,
  dinhDangVn,
  ghiKetQuaGui,
  layLichDenHan,
  nhanDangGui,
  quyetDinhTre,
} from './lich_hen.js';
import {
  cauNhacDuPhong, conDangTheoDuoi, danhChoLuotNhac, docNhip, layBoiCanhNhac,
  layNhacDenHan, layNhacTreoChoModel, tranChoModelMs,
} from './theo_duoi.js';

function _log(msg) {
  process.stderr.write(`[lich/bo_chay] ${msg}\n`);
}

// ═══════════════════════════════════════════════════════════════════════
// GIAO VIỆC CHO MODEL Ở CHẾ ĐỘ TÁCH — daemon không còn phiên Claude nào
// ═══════════════════════════════════════════════════════════════════════

/**
 * Đọc một cờ dạng `--ten gia-tri` trong argv. Trả `undefined` nếu không có.
 * ⚠️ Cố ý KHÔNG nhận dạng `--ten=gia-tri`: `index.js` (nguồn sự thật) cũng chỉ
 * đọc dạng tách rời, và nhận thêm một dạng ở đây là hai nơi hiểu argv khác nhau.
 */
function _docCoArgv(argv, ten) {
  const a = Array.isArray(argv) ? argv : [];
  const i = a.indexOf(ten);
  return i >= 0 ? a[i + 1] : undefined;
}

/**
 * ★ Bộ chạy này có đang ở chế độ TÁCH không — tức CÓ client Claude riêng để
 * nhặt việc, dù bản thân daemon không cầm phiên Claude nào.
 *
 * 🔴 VÌ SAO KHÔNG ĐƯỢC SUY TỪ `p.guiThongBao == null`:
 * `--khong-mcp` (chế độ một-tiến-trình, chạy ghi lịch sử thuần) CŨNG có
 * `guiThongBao == null` nhưng KHÔNG có client nào cả. Suy từ chỗ vắng mặt là
 * biến `--khong-mcp` từ *"gửi câu dự phòng NGAY"* thành *"chờ hết trần rồi mới
 * gửi"* — đổi hành vi của một chế độ đang chạy thật, đúng thứ bị cấm.
 * ⇒ Phải có TÍN HIỆU DƯƠNG. Ba nguồn, ưu tiên từ trên xuống:
 *   ① `p.cheDo` — chỗ gọi truyền thẳng. Hôm nay `index.js` chưa truyền, nhưng
 *      để sẵn thì ngày ai đó nối chỉ mất một dòng, không phải sửa file này.
 *   ② `env.ZTL_CHE_DO` — đúng biến `chotCheDo()` đọc.
 *   ③ `argv --che-do` — đúng cờ `index.js` đọc, và `bo_chay` chạy TRONG tiến
 *      trình daemon nên `process.argv` ở đây CHÍNH LÀ argv của daemon.
 *
 * ⚠️ CHỖ CHƯA KÍN, nói thẳng: `chotCheDo()` còn đọc nguồn thứ tư là
 * `cauHinh.cheDo` (file config), mà `bo_chay` KHÔNG cầm `cauHinh`. Host chỉ khai
 * chế độ trong file config (không dùng cờ, không dùng env) ⇒ hàm này trả `false`
 * ⇒ lời nhắc rơi về câu dự phòng như hôm nay. **Hỏng về phía an toàn** (mất
 * giọng model, KHÔNG mất tin), nhưng phải nối `p.cheDo` mới kín hẳn.
 */
export function laCheDoTach(p = {}, env = process.env, argv = process.argv) {
  if (p?.cheDo !== undefined && p?.cheDo !== null && p.cheDo !== '') {
    return String(p.cheDo) === CHE_DO.TACH;
  }
  const tho = env?.ZTL_CHE_DO ?? _docCoArgv(argv, '--che-do');
  return String(tho ?? '') === CHE_DO.TACH;
}

// ═══════════════════════════════════════════════════════════════════════
// LƯỚI AN TOÀN CHO CÂU HỎI KHÔNG ĐƯỢC TRẢ LỜI — nối vào ĐÚNG nhịp này
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══ LƯỚI CANH OUTBOX KẸT (bước 5) ═══
 *
 * 🔴 CÔNG TẮC RIÊNG `ZTL_LUOI_OUTBOX`, MẶC ĐỊNH BẬT.
 * Lưới này canh một SỰ THẬT KHÁCH QUAN — có dòng `hang_doi_gui` nằm ở
 * `'cho'`/`'dang_gui'` quá lâu ⇒ **không có chỗ nào để đoán sai**, nên bật mặc
 * định là an toàn.
 * ⚠️ Đây từng là "lưới thứ hai": pack có một lưới nữa canh `hang_doi_hoi` còn
 * `'da_day'`, nhưng nó phải ĐOÁN *"câu này có cần trả lời không"* và đoán sai
 * thật (đi giục trả lời cả tiếng "ok" của host) ⇒ **anh chốt bỏ hẳn 21/08/2026**,
 * thay bằng cách A (mọi tin trong nhóm đều tạo một lượt nên trợ lý luôn theo kịp).
 * Ghi lại đây để ai đó đừng dựng lại nó dưới một cái tên khác.
 *
 * 🔴 VÌ SAO NỐI Ở ĐÂY CHỨ KHÔNG NỐI Ở `index.js`: nối ở đó là thêm một DÂY TREO
 * nữa — pack đã dính hai lần (`recordSources`, `dmHostChatId`): code viết đủ,
 * test xanh, mà chỗ gọi quên truyền nên tính năng chết câm. Ở đây không có gì
 * để quên: `chayNhipTheoDuoi` đã được `index.js` gọi mỗi 30 giây từ trước, và
 * mọi thứ lưới cần đã nằm sẵn trong `p`.
 * ⚠️ CÁI GIÁ: lưới ăn theo cờ `ZTL_LICH_HEN` — tắt bộ chạy lịch là tắt luôn nó.
 *
 * ⚠️ CỐ Ý KHÔNG cộng số liệu của lưới vào `ra.loi` của `chayNhipTheoDuoi`:
 * `taoBoDemLoiGui` đọc đúng trường đó để kết luận "bộ chạy GỬI hỏng 2 nhịp liên
 * tiếp" rồi báo động cho host. Trộn vào là báo động sai chuyện.
 *
 * ⚠️ Ở `cheDo:"mot-tien-trinh"` outbox LUÔN RỖNG ⇒ lưới chạy không tải, vô hại.
 * Cơ chế (đọc lại 21/08 SAU khi pane `coding` nối xong bước 4 — chú thích bản
 * đầu của em nói "chưa ai gọi `xepHangGui`" và nay đã SAI, giữ lại đây để không
 * ai tin nhầm lần nữa): `mcp/tools.js` chọn cửa gửi bằng
 *     const xepHang = typeof kho?.xepHangGuiRa === 'function' ? ... : null;
 * mà `kho.xepHangGuiRa` CHỈ được truyền ở MỘT trong hai chỗ gọi `dangKyTool` —
 * nhánh client (chế độ tách). Nhánh một-tiến-trình không truyền ⇒ `xepHang` là
 * `null` ⇒ `tra_loi` gửi thẳng như cũ, không dòng nào rơi vào `hang_doi_gui`.
 * ⚠️ Đây là điều em ĐỌC MÃ NGUỒN xác nhận, ⛔ chưa chạy thật ở chế độ tách.
 * Bài O5 canh phần thuộc về lưới: outbox rỗng ⇒ im tuyệt đối.
 * Tắt bằng ZTL_LUOI_OUTBOX=0.
 */
const _boCanhOutboxTheoDb = new Map();

function _layBoCanhOutbox(db) {
  let noi = null;
  try { noi = db?.location?.() ?? null; } catch { noi = null; }
  const khoa = noi ?? ':khong-ro:';
  let bo = _boCanhOutboxTheoDb.get(khoa);
  if (!bo) {
    bo = taoBoCanhOutbox({
      duongDanSo: noi ? path.join(path.dirname(noi), 'luoi_outbox.log') : null,
    });
    _boCanhOutboxTheoDb.set(khoa, bo);
  }
  return bo;
}

async function _chayLuoiOutbox(p, bayGio) {
  if (process.env.ZTL_LUOI_OUTBOX === '0') return null;
  const bo = p.canhOutbox ?? _layBoCanhOutbox(p.db);
  try {
    return await bo.chayMotNhip({
      db: p.db,
      bayGioMs: bayGio,
      // ⛔ CHỈ có đường DM host. Cố ý KHÔNG truyền `guiVaoNhom` xuống đây —
      // thiếu đường thì không ai lỡ tay gọi nhầm.
      baoHost: (p.guiDmHost && p.dmHostChatId)
        ? (loiNhan) => p.guiDmHost(p.api, p.dmHostChatId, loiNhan, {
            uidTroLy: p.uidTroLy ?? null, ghiLai: p.ghiLai, laDm: true,
          })
        : null,
    });
  } catch (e) {
    _log(`lưới canh outbox ném lỗi (đã nuốt): ${safeLogText(e)}`);
    return null;
  }
}

/**
 * ═══ 🔴 ĐÓNG PHIÊN MODEL ĐÃ BỊ LƯỚI GIÀNH MẤT ═══
 *
 * Lưới an toàn vừa gửi câu dự phòng ⇒ phiên model của lượt đó đã VÔ NGHĨA.
 * Không đóng thì nó nằm trong `hang_doi_hoi` tới hết `queueTtlMs` (30 phút), rồi
 * bị đánh `het_han` và **host nhận một tin báo động GIẢ**: *"quá 30 phút nên em
 * không trả lời muộn nữa"* — cho một lời nhắc đã được gửi tới nơi đàng hoàng.
 *
 * 🔴 Nhánh này NGỦ suốt vì hai lớp che nhau, và vừa thức dậy do CHÍNH hai bản vá
 * gần đây: A5 (21/08) hạ trần chờ xuống dưới nhịp nên lưới mới bắn lần đầu tiên,
 * và bản vá "báo câu hỏi quá hạn" (20/08) mới biến việc đánh `het_han` âm thầm
 * thành một tin nhắn thật gửi cho host.
 *
 * ⚠️ Đóng SAU khi gửi thành công. Gửi hỏng mà đã đóng thì mất luôn cơ hội cuối:
 * model tỉnh muộn cũng không cứu được lượt đó nữa.
 * Đặt `da_tra_loi` cũng là LỚP THỨ HAI sau token — model tỉnh muộn gặp chốt A7.
 */
function _dongPhienModelBiGianh(db, idNhac) {
  try {
    const ds = db.prepare(
      "SELECT request_id FROM hang_doi_hoi WHERE trang_thai = $cho AND msg_id LIKE $mau",
    ).all({ cho: TRANG_THAI_HANG_DOI.CHO, mau: `nhac:${idNhac}:%` });
    for (const r of ds) {
      db.prepare('UPDATE hang_doi_hoi SET trang_thai = $tt WHERE request_id = $rid')
        .run({ tt: TRANG_THAI_HANG_DOI.DA_TRA_LOI, rid: r.request_id });
    }
    return ds.length;
  } catch (e) {
    _log(`không đóng được phiên model của lời nhắc ${idNhac}: ${safeLogText(e)}`);
    return 0;
  }
}

/**
 * uid -> tên hiển thị trong ĐÚNG nhóm đó.
 * @param {Array<{uid: string, ten: string}>} dsNguoi
 * @param {string[]} uids
 * @returns {{ten: string[], khongTraRa: string[]}}
 */
export function uidSangTen(dsNguoi, uids) {
  const bang = new Map((dsNguoi ?? []).map((n) => [String(n.uid), String(n.ten)]));
  const ten = [];
  const khongTraRa = [];
  for (const u of uids ?? []) {
    const t = bang.get(String(u));
    if (t) ten.push(t);
    else khongTraRa.push(String(u));
  }
  return { ten, khongTraRa };
}

/**
 * Dựng nội dung tin nhắc: tiền tố trễ + bảo đảm tag + nội dung.
 *
 * 🔴 KHÔNG còn tự dán `@Tên` nữa — luật "mention phải có mặt ĐÚNG MỘT LẦN" nay
 * nằm ở MỘT chỗ duy nhất: `baoDamTag()` trong `zalo/send.js`. Bản cũ ở đây dán
 * tiền tố VÔ ĐIỀU KIỆN, không đọc `noiDung`, nên nội dung đã có sẵn `@Trọng Nguyễn`
 * thì tin đi ra thành "@Trọng Nguyễn @Trọng Nguyễn ơi…" (anh gặp thật 20/08).
 *
 * ⚠️ `tienTo` (vd "(nhắc muộn) ") vẫn dán Ở ĐÂY, SAU khi đã bảo đảm tag: nó là
 * việc riêng của bộ chạy lịch, không thuộc luật tag.
 *
 * @returns {{text: string, tenTag: string[], khongTraRa: string[],
 *            daCoSan: string[], trungTen: string[], khongKhop: string[]}}
 */
export function dungNoiDung({ noiDung, tienTo = '', dsNguoi = [], tagUserIds = [] }) {
  const kq = baoDamTag(String(noiDung ?? ''), dsNguoi, tagUserIds);
  const { ten } = uidSangTen(dsNguoi, kq.daThem);
  return {
    text: `${tienTo}${kq.text}`,
    tenTag: ten,
    // Giữ nguyên nghĩa cũ cho caller: uid nào KHÔNG tag được, vì bất kỳ lý do gì.
    khongTraRa: [...kq.khongTraRa, ...kq.trungTen],
    daCoSan: kq.daCoSan,
    trungTen: kq.trungTen,
    khongKhop: kq.khongKhop,
  };
}

/**
 * Nhắn riêng host: lời nhắc vừa dừng vì HẾT LƯỢT, không phải vì xong việc.
 *
 * Đi qua `p.guiDmHost` + `p.dmHostChatId` — hai thứ vòng chạy đã có sẵn, nên
 * không phải nối thêm phụ thuộc nào ở `index.js`.
 * KHÔNG BAO GIỜ ném: đây là tin phụ trợ, hỏng thì cũng không được làm chết
 * vòng nhắc.
 */
async function _baoHetLuot(p, d, cho) {
  if (typeof p.guiDmHost !== 'function' || !p.dmHostChatId) {
    _log(`lời nhắc ${d.id} hết lượt nhưng KHÔNG có đường DM host -> host sẽ không biết`);
    return;
  }
  const tran = cho.tranSoLan ?? '?';

  // ═══ 🔴 B2 — CÂU NÀY TỪNG NÓI DỐI, VÀ NÓI DỐI ĐÚNG CHỖ ĐAU NHẤT ═══
  // Bản cũ: *"Đã nhắc đủ N lần và DỪNG"*. Nhưng `so_lan_da_nhac` đếm **LƯỢT ĐÃ
  // DÀNH CHỖ**, KHÔNG phải **TIN ĐÃ GỬI TỚI NƠI**. Bot bị kick / mất mạng thì
  // mỗi nhịp vẫn tiêu một lượt rồi gửi hỏng, và host nhận đúng câu "đã nhắc đủ
  // 10 lần" cho một việc CHƯA AI ĐƯỢC NHẮC LẦN NÀO. Sổ sách nói dối lần thứ hai,
  // cùng họ với A1 (sổ nhắc báo "đang theo đuổi" cho dòng đã chết).
  //
  // ✅ Nay nói ĐÚNG thứ đếm được: "dùng hết N LƯỢT" (lượt thì đếm chắc chắn).
  // ⚠️ Và khai thẳng chỗ KHÔNG biết: pack không có cột đếm số tin gửi thành công.
  // `msg_id_da_gui` chỉ được đặt ở đường DỰ PHÒNG — đường model gửi qua `tra_loi`
  // KHÔNG đặt nó. Nên `NULL` chỉ chứng minh "không có BẰNG CHỨNG nào đã gửi",
  // ⛔ KHÔNG chứng minh "chưa gửi lần nào". Viết câu đúng mức đó, không hơn:
  // nói quá lên một lần là lần sau anh thôi tin cả những cảnh báo đúng.
  const chuaCoBangChung = !d.msg_id_da_gui;

  try {
    await p.guiDmHost(
      p.api,
      p.dmHostChatId,
      `⏹️ Đã dùng hết ${tran} lượt nhắc và DỪNG: "${d.noi_dung}"\n`
      + 'Dừng vì HẾT LƯỢT, KHÔNG phải vì việc đã xong. '
      + 'Muốn nhắc tiếp thì anh đặt lại, hoặc nới trần bằng chinh_nhip_nhac.'
      + (chuaCoBangChung
        ? '\n⚠️ Em KHÔNG có bằng chứng tin nhắc nào đã gửi thành công vào nhóm '
          + '(không có msg_id nào được ghi lại). Anh xem trong nhóm giúp em — '
          + 'nếu không thấy tin nhắc nào thì việc này chưa từng được nhắc tới ai.'
        : ''),
      { uidTroLy: p.uidTroLy ?? null, ghiLai: p.ghiLai, laDm: true },
    );
  } catch (e) {
    _log(`không báo được host chuyện hết lượt (${d.id}): ${safeLogText(e)}`);
  }
}

/**
 * Chạy MỘT nhịp: xử mọi lịch đã tới hạn.
 *
 * @param {{
 *   db: any, api: any, bayGioMs?: number,
 *   guiVaoNhom: Function, guiDmHost: Function,
 *   dsNguoiTrongNhom: (db: any, chatId: string) => Array<{uid: string, ten: string}>,
 *   ghiLai?: (tin: any) => void,
 *   uidTroLy?: string|null,
 *   dmHostChatId?: string|null,
 * }} p
 * @returns {Promise<{daGui: number, quaHan: number, loi: number}>}
 */
export async function chayMotNhip(p) {
  const bayGio = p.bayGioMs ?? Date.now();
  const ra = { daGui: 0, quaHan: 0, loi: 0 };

  let ds;
  try {
    ds = layLichDenHan(p.db, bayGio);
  } catch (e) {
    _log(`không đọc được lịch tới hạn: ${safeLogText(e)}`);
    return ra;
  }
  if (!ds.length) return ra;

  for (const l of ds) {
    const tre = bayGio - Number(l.gui_luc_ms);
    const qd = quyetDinhTre(tre);

    // ── Quá trần trễ: KHÔNG GỬI VÀO NHÓM, báo riêng host ────────────────
    if (qd.hanhDong === 'BO_QUA_HAN') {
      try {
        danhDauQuaHan(
          p.db, l.id,
          `trễ ${Math.round(tre / 60000)} phút, vượt trần ${Math.round(GIOI_HAN_LICH.TRAN_TRE_MS / 60000)} phút`,
        );
        ra.quaHan += 1;
        const loiNhan =
          `⏰ Lịch [${l.ma_xac_nhan ?? l.id}] lẽ ra gửi lúc ${dinhDangVn(Number(l.gui_luc_ms), l.mui_gio)} `
          + `nhưng em vừa dậy lúc ${dinhDangVn(bayGio, l.mui_gio)}.\n`
          + 'Em KHÔNG gửi vào nhóm (nhắc muộn còn tệ hơn không nhắc). '
          + 'Anh muốn gửi bây giờ thì bảo em.';
        if (p.dmHostChatId && p.guiDmHost) {
          await p.guiDmHost(p.api, p.dmHostChatId, loiNhan, {
            ghiLai: p.ghiLai, uidTroLy: p.uidTroLy,
          }).catch((e) => _log(`không DM được host về lịch quá hạn: ${safeLogText(e)}`));
        } else {
          _log(`lịch ${l.id} quá hạn nhưng KHÔNG có DM host để báo — chỉ ghi log`);
        }
      } catch (e) {
        _log(`xử lý lịch quá hạn ${l.id} thất bại: ${safeLogText(e)}`);
      }
      continue;
    }

    // ── 🔴 DÀNH CHỖ TRƯỚC KHI GỌI MẠNG ─────────────────────────────────
    if (!nhanDangGui(p.db, l.id)) {
      _log(`lịch ${l.id} đã được xử lý bởi nhịp khác -> bỏ qua (chống gửi hai lần)`);
      continue;
    }

    try {
      const laDm = String(l.loai_dich) === 'DM';
      const dsNguoi = laDm ? [] : p.dsNguoiTrongNhom(p.db, String(l.chat_id_dich));
      /** @type {string[]} */
      let tagUserIds = [];
      try {
        tagUserIds = l.tag_user_ids ? JSON.parse(l.tag_user_ids) : [];
      } catch {
        tagUserIds = [];
      }

      const nd = dungNoiDung({
        noiDung: String(l.noi_dung),
        tienTo: qd.tienTo,
        dsNguoi,
        tagUserIds,
      });
      for (const u of nd.khongTraRa) {
        _log(`lịch ${l.id}: uid ${u} không tra ra tên trong nhóm -> BỎ tag đó (cấm bịa tên)`);
      }

      const kq = laDm
        ? await p.guiDmHost(p.api, String(l.chat_id_dich), nd.text, {
            ghiLai: p.ghiLai, uidTroLy: p.uidTroLy,
          })
        : await p.guiVaoNhom(p.api, String(l.chat_id_dich), nd.text, {
            dsNguoi, ghiLai: p.ghiLai, uidTroLy: p.uidTroLy,
          });

      ghiKetQuaGui(p.db, l.id, { msgId: kq?.msgId ?? null });
      ra.daGui += 1;
    } catch (e) {
      // Đã ở trạng thái `da_gui` (dành chỗ ở trên) ⇒ ghi lại thành `loi` kèm lý do.
      // CỐ Ý KHÔNG trả về `da_len_lich` để thử lại: gửi lại tự động thì ca "Zalo
      // đã nhận nhưng trả lỗi mạng" thành gửi hai lần vào nhóm người thật.
      // Host đọc `xem_lich` thấy trạng thái `loi` và tự quyết.
      ghiKetQuaGui(p.db, l.id, { loi: String(e?.message ?? e) });
      ra.loi += 1;
      _log(`gửi lịch ${l.id} thất bại: ${safeLogText(e)}`);
    }
  }
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════
// v4 — LỜI NHẮC THEO ĐUỔI
// ═══════════════════════════════════════════════════════════════════════

/**
 * Một nhịp cho các lời nhắc THEO ĐUỔI.
 *
 * 🔴 HAI ĐƯỜNG GỬI, và đường thứ hai là thứ giữ cho tính năng không hỏng câm:
 *   (a) CÓ phiên Claude  -> đẩy DỮ KIỆN sang model, model viết câu rồi gửi bằng
 *       tool `tra_loi`. Đây là đường chính: câu hôm nay phải KHÁC hôm qua, mà
 *       chỉ model mới viết được câu bám bối cảnh.
 *   (b) KHÔNG có Claude, HOẶC model im quá `TRAN_CHO_MODEL_MS` -> code tự gửi
 *       câu dự phòng. Thiếu đường này thì Claude rớt là lời nhắc BIẾN MẤT ÂM
 *       THẦM — đúng thứ cả tính năng sinh ra để chống.
 *
 * 🔴 Mốc kế tiếp được DỜI NGAY lúc dành chỗ (`danhChoLuotNhac`), TRƯỚC khi gọi
 * mạng. Hai nhịp timer chồng nhau không thể gửi hai tin vào nhóm người thật.
 *
 * @param {{db: any, api: any, bayGioMs?: number,
 *          guiVaoNhom: Function, guiDmHost: Function,
 *          dsNguoiTrongNhom: Function, truyVanLichSu?: Function,
 *          guiThongBao?: ((p: any) => Promise<boolean>)|null,
 *          taoHangDoi?: Function, ghiLai?: Function, uidTroLy?: string|null}} p
 */
export async function chayNhipTheoDuoi(p) {
  const bayGio = p.bayGioMs ?? Date.now();
  const ra = { daNhac: 0, giaoModel: 0, duPhong: 0, loi: 0 };

  // 🔴 ĐẶT TRƯỚC MỌI `return` — kể cả nhánh "không đọc được lời nhắc" ngay dưới.
  // Lưới câu hỏi không liên quan gì tới bảng `lich_hen`; để nó sau một `return`
  // sớm là tự tay dựng một đường hỏng câm mới.
  await _chayLuoiOutbox(p, bayGio);

  let ds;
  try {
    ds = layNhacDenHan(p.db, bayGio);
  } catch (e) {
    _log(`không đọc được lời nhắc tới hạn: ${safeLogText(e)}`);
    return ra;
  }

  // ── (b2) Lượt đã giao model mà model im quá lâu -> code gửi bù ────────
  // 🔴 Trần chờ là HÀM CỦA NHỊP, không phải hằng số — xem `tranChoModelMs()`.
  // Truy vấn chỉ lọc THÔ bằng trần nhỏ nhất có thể; trần thật của từng dòng phải
  // tính lại ở đây bằng `docNhip()`, vì `docNhip()` là nguồn sự thật DUY NHẤT về
  // luật "nhịp phút thắng nhịp ngày" và không được viết lại bằng SQL.
  try {
    const treo = layNhacTreoChoModel(p.db, bayGio);
    for (const d of treo) {
      const tran = tranChoModelMs(docNhip(d));
      if (bayGio - Number(d.cho_model_tu_ms) < tran) continue;   // chưa tới trần của CHÍNH dòng này
      // Dành chỗ trước khi gọi mạng, cùng nguyên tắc với `danhChoLuotNhac`:
      // `WHERE cho_model_tu_ms = $cu` để hai nhịp chồng nhau không cùng gửi bù.
      const daNhan = p.db.prepare(
        'UPDATE lich_hen SET cho_model_tu_ms = NULL WHERE id = $id AND cho_model_tu_ms = $cu',
      ).run({ id: d.id, cu: Number(d.cho_model_tu_ms) });
      if (Number(daNhan.changes) !== 1) continue;
      _log(`lời nhắc ${d.id}: model im quá ${Math.round(tran / 1000)} giây (trần theo nhịp) -> gửi câu dự phòng`);
      // eslint-disable-next-line no-await-in-loop
      const ok = await _guiNhac(p, d, bayGio);
      if (ok) {
        ra.duPhong += 1;
        _dongPhienModelBiGianh(p.db, d.id);
      } else ra.loi += 1;
    }
  } catch (e) {
    _log(`quét lượt treo chờ model thất bại: ${safeLogText(e)}`);
  }

  for (const d of ds) {
    const cho = danhChoLuotNhac(p.db, d, bayGio);
    if (!cho.ok) {
      _log(`lời nhắc ${d.id} đã được nhịp khác xử lý -> bỏ qua (chống nhắc hai lần)`);
      continue;
    }
    ra.daNhac += 1;

    // 🔴 CHẠM TRẦN -> BÁO HOST. Lượt này vẫn gửi (trần 10 = nhắc đủ 10 lần),
    // nhưng sau đó lời nhắc đã tự đóng với `ly_do_dong = HET_LUOT`.
    // ⛔ Im lặng tắt là host tưởng việc đã xong — đúng thứ nguy hiểm nhất của
    // tính năng này. Gửi SAU khi đã dành chỗ xong nên không chặn luồng nhắc.
    if (cho.hetLuot) {
      _baoHetLuot(p, d, cho).catch(() => {});
    }

    // ═══ 🔴 B5 — BẮT VẾT NGUỒN CỦA BỐI CẢNH, KHÔNG TIN VÀO TRÍ NHỚ NGƯỜI VIẾT ═══
    // `layBoiCanhNhac` bơm dữ liệu THẲNG vào context model (qua `_tomTatDuKien`),
    // KHÔNG đi qua tool nào ⇒ nó ĐI VÒNG QUA chỗ `_lichSu` khai nguồn cho
    // `leak_guard`. Đo trước khi vá: `recordSources(` chỉ xuất hiện ĐÚNG MỘT chỗ
    // trong cả `src/` (tools.js, trong `_lichSu`), và `boTichLuy` KHÔNG xuất hiện
    // dòng nào trong `src/lich/`.
    //
    // Hôm nay chưa rò vì `layBoiCanhNhac` tự giới hạn đúng một nhóm. NHƯNG lúc đó
    // `boTichLuy[requestId]` RỖNG ⇒ ai nới bối cảnh sau này (vd "xem người này có
    // nhắc việc đó ở nhóm khác không" — cải tiến rất tự nhiên) thì `leak_guard`
    // thấy nguồn = ∅ ⊆ {chat_id_hoi} và CHO GỬI THẲNG vào nhóm. Lá chắn thất bại
    // IM LẶNG, đúng ca nó sinh ra để chặn.
    //
    // ✅ Cách làm: BỌC `truyVanLichSu` để hứng `nguonChatIds` do CHÍNH TẦNG TRUY VẤN
    // khai ra. Nhờ vậy nó đúng bất kể `layBoiCanhNhac` sau này đọc thêm những gì —
    // không phụ thuộc người sửa có nhớ cập nhật chỗ này hay không.
    // (Đúng nguyên tắc đã chốt ở `leak_guard.js`: *cờ do TẦNG TRUY VẤN đặt*.)
    const nguonDaCham = new Set();
    const truyVanCoVet = typeof p.truyVanLichSu === 'function'
      ? (dbIn, tv) => {
        const kq = p.truyVanLichSu(dbIn, tv);
        for (const c of kq?.nguonChatIds ?? []) nguonDaCham.add(String(c));
        return kq;
      }
      : undefined;
    const boiCanh = layBoiCanhNhac(p.db, d, { bayGioMs: bayGio, truyVan: truyVanCoVet });
    const nguonLa = [...nguonDaCham].filter((c) => c !== String(d.chat_id_dich));

    // 🔴 A3 — TRA TÊN NGƯỜI PHỤ TRÁCH **LÚC GỬI**, không dùng chuỗi đóng băng.
    // Gói dữ kiện cũ chỉ nói "Tag thẳng người phụ trách" mà KHÔNG cho tên, KHÔNG
    // cho uid, KHÔNG cho cú pháp — model không có cách nào biết phải gõ chuỗi gì,
    // nên nó viết tên thân mật ("Trọng ơi") và không tag được ai.
    // ⚠️ Đây chỉ để model VIẾT CÂU CHO TỰ NHIÊN. Việc bảo đảm mention có mặt là
    // của `tra_loi` (cưỡng chế bằng uid) — KHÔNG giao model làm.
    const phuTrach = _tenPhuTrach(p, d);

    // 🔴 FAIL-CLOSED. Bối cảnh có chạm nhóm KHÁC mà KHÔNG có đường khai nguồn
    // (`p.recordSources` chưa được nối) ⇒ TUYỆT ĐỐI KHÔNG giao model. Rơi xuống câu
    // dự phòng do code dựng — câu đó chỉ dùng `d.noi_dung` của chính dòng nhắc nên
    // không thể mang dữ liệu nhóm khác ra ngoài.
    // ⛔ Không có nhánh "không chắc thì cứ gửi": đó đúng là thứ `leak_guard` cấm.
    // ═══ 🔴 CHẾ ĐỘ TÁCH: GIAO VIỆC QUA HÀNG ĐỢI, KHÔNG QUA NOTIFICATION ═══
    // Ở `cheDo:"tach"` daemon KHÔNG cầm phiên Claude nào ⇒ `p.guiThongBao` là
    // null. Bản cũ đọc chỗ đó thành "không có model" và rơi thẳng xuống câu dự
    // phòng ⇒ MỌI lời nhắc thành máy móc — đúng thứ chặn việc bật chế độ tách.
    //
    // Thứ model thật sự cần KHÔNG phải cái notification, mà là **dòng
    // `hang_doi_hoi`**. `taoHangDoi` đã ghi nó ở trạng thái `'cho'`; client (pane
    // Claude) nhặt bằng `dayHangDoiCho` rồi tự bơm vào phiên của nó.
    // ⇒ Ở chế độ tách ta vẫn đi nhánh (a), chỉ BỎ lời gọi notify.
    //
    // 🔴 LƯỚI AN TOÀN KHÔNG SUY SUYỂN — đây là điều kiện để làm việc này:
    // `cho_model_tu_ms` vẫn được đặt y như cũ, nên nhánh (b2) ở đầu hàm vẫn gửi
    // câu dự phòng khi quá `tranChoModelMs()`. Không client nào nhặt ⇒ vẫn có
    // tin đi ra. ⛔ Không đổi giọng văn lấy sự im lặng.
    const coClient = laCheDoTach(p);
    const giaoDuocChoModel = p.taoHangDoi
      && (typeof p.guiThongBao === 'function' || coClient)
      && (nguonLa.length === 0 || typeof p.recordSources === 'function');
    if (nguonLa.length && typeof p.recordSources !== 'function') {
      _log(
        `lời nhắc ${d.id}: bối cảnh chạm ${nguonLa.length} nhóm KHÁC nhưng chưa nối `
        + 'recordSources -> KHÔNG giao model (fail-closed), dùng câu dự phòng.',
      );
    }

    // (a) Giao model viết câu.
    if (giaoDuocChoModel) {
      try {
        const requestId = randomUUID();
        // ★ KHAI NGUỒN TRƯỚC KHI ĐẨY — khai sau thì có một khoảnh khắc model đã
        // cầm dữ liệu mà `leak_guard` chưa biết gì.
        if (typeof p.recordSources === 'function') {
          p.recordSources(requestId, [...nguonDaCham, String(d.chat_id_dich)]);
        }
        // 🔴 THỨ TỰ CÓ CHỦ ĐÍCH: đặt TOKEN trước, tạo hàng đợi sau.
        // `cho_model_tu_ms` là quyền gửi của lượt này (xem `giuQuyenGuiNhac`).
        // Đặt SAU thì có một khe: chết giữa hai lệnh ⇒ tồn tại một phiên nhắc
        // KHÔNG có token ⇒ model trả lời bị từ chối, mà lưới an toàn cũng không
        // bắn (nó chỉ nhặt dòng có token) ⇒ lượt nhắc mất ÂM THẦM.
        // Đặt TRƯỚC thì khe đó lệch về phía an toàn: có token mà chưa có phiên
        // ⇒ tới trần, lưới gửi câu dự phòng. Thà thừa một câu dự phòng còn hơn
        // im lặng bỏ rơi một việc thật.
        p.db.prepare('UPDATE lich_hen SET cho_model_tu_ms = $t WHERE id = $id')
          .run({ t: Math.floor(bayGio), id: d.id });
        p.taoHangDoi(p.db, {
          requestId,
          // chat_id_hoi = nhóm ĐÍCH: `tra_loi` gửi vào đúng đây, và luật chống
          // rò chéo vẫn tính nguồn trên chính nhóm đó.
          chatIdHoi: String(d.chat_id_dich),
          msgId: `nhac:${d.id}:${d.so_lan_da_nhac ?? 0}`,
          userId: String(d.nguoi_dat ?? ''),
          noiDung: _tomTatDuKien(d, boiCanh, phuTrach),
          tsTao: new Date(bayGio).toISOString(),
        });
        // eslint-disable-next-line no-await-in-loop
        if (typeof p.guiThongBao === 'function') {
          // eslint-disable-next-line no-await-in-loop
          await p.guiThongBao({
            requestId,
            chatId: String(d.chat_id_dich),
            tenHoiThoai: null,
            nguoiHoi: null,
            noiDung: _tomTatDuKien(d, boiCanh, phuTrach),
            tsZalo: bayGio,
          });
        } else {
          // Chế độ TÁCH: không có ai để notify. Dòng hàng đợi vừa tạo đang ở
          // `'cho'` — client nhặt bằng `dayHangDoiCho`. ⛔ KHÔNG được coi đây là
          // thất bại: `cho_model_tu_ms` đã đặt nên nhánh (b2) vẫn bù đúng hạn.
          _log(
            `lời nhắc ${d.id}: chế độ TÁCH -> để hàng đợi ${requestId} ở 'cho' cho client nhặt`
            + `; không ai nhặt trong ${Math.round(tranChoModelMs(docNhip(d)) / 1000)}s thì code gửi câu dự phòng`,
          );
        }
        ra.giaoModel += 1;
        continue;
      } catch (e) {
        _log(`giao model viết câu nhắc ${d.id} hỏng (${safeLogText(e)}) -> dùng câu dự phòng`);
      }
    }

    // (b1) Không có Claude -> gửi thẳng câu dự phòng.
    // eslint-disable-next-line no-await-in-loop
    const ok = await _guiNhac(p, d, bayGio);
    if (ok) ra.duPhong += 1; else ra.loi += 1;
  }
  return ra;
}

/**
 * Gói DỮ KIỆN thành chữ cho model đọc.
 *
 * ⚠️ Đây là DỮ KIỆN, KHÔNG phải mẫu câu. Model tự viết câu từ đây. Số ngày và
 * mốc thời gian do tầng truy vấn cấp — model tính ngày là bịa.
 */
/**
 * Tên hiển thị của người phụ trách, tra từ danh sách người CÓ THẬT trong nhóm
 * tại thời điểm gọi. Không tra ra ⇒ trả `null`, ⛔ CẤM bịa tên.
 */
function _tenPhuTrach(p, d) {
  const uid = d?.nguoi_phu_trach ? String(d.nguoi_phu_trach) : null;
  if (!uid || String(d.loai_dich) === 'DM') return null;
  try {
    const ds = p.dsNguoiTrongNhom(p.db, String(d.chat_id_dich)) ?? [];
    const ten = ds.find((n) => String(n.uid) === uid)?.ten ?? null;
    return ten ? { uid, ten: String(ten) } : { uid, ten: null };
  } catch (e) {
    _log(`không tra được tên người phụ trách của ${d.id}: ${safeLogText(e)}`);
    return { uid, ten: null };
  }
}

function _tomTatDuKien(d, bc, phuTrach = null) {
  const p = [
    '[LỜI NHẮC THEO ĐUỔI — viết một câu nhắc cho nhóm, ĐỪNG lặp lại câu hôm trước]',
    `Việc: ${d.noi_dung}`,
    `Đã nhắc: ${bc.soLanDaNhac} lần · đặt từ ${bc.soNgayTuKhiDat} ngày trước`,
  ];
  if (bc.nhacLanTruocMs) p.push(`Lần nhắc trước: ${new Date(bc.nhacLanTruocMs).toISOString()}`);
  if (bc.nguoiPhuTrachDaNoiGi.length) {
    p.push(
      'Người phụ trách CÓ nhắn lại sau lần nhắc trước (nhưng chưa chốt ngày): '
      + bc.nguoiPhuTrachDaNoiGi.map((x) => `"${x.noiDung.slice(0, 120)}"`).join(' | '),
    );
  } else {
    p.push('Người phụ trách CHƯA nói gì kể từ lần nhắc trước.');
  }
  // 🔴 Nói RÕ người phụ trách là AI. Không có dòng này thì model đoán, và nó đã
  // đoán sai thật (viết "Trọng ơi" thay vì tên hiển thị "Trọng Nguyễn").
  if (phuTrach?.ten) {
    p.push(`Người phụ trách: ${phuTrach.ten} (uid ${phuTrach.uid})`);
    p.push('Viết câu tự nhiên, nhắc thẳng người đó. Gọi tool tra_loi để gửi —');
    p.push('server TỰ bảo đảm tag đúng người, bạn KHÔNG cần tự gõ chuỗi @.');
  } else if (phuTrach?.uid) {
    p.push(`Người phụ trách: uid ${phuTrach.uid} — CHƯA tra ra tên trong nhóm này`);
    p.push('(người đó chưa từng nhắn trong nhóm) ⇒ lượt nhắc này SẼ KHÔNG TAG ĐƯỢC AI.');
    p.push('Viết câu nhắc bình thường và NÓI CHO HOST BIẾT là chưa tag được.');
  } else {
    p.push('Lời nhắc này KHÔNG khai người phụ trách ⇒ sẽ không tag ai.');
  }
  p.push('Gọi tool tra_loi để gửi.');
  return p.join('\n');
}

/**
 * Gửi câu nhắc DỰ PHÒNG do code dựng.
 *
 * ⚠️ KHÔNG CÒN tham số `laBu` (B3). Bản cũ nhận nó rồi dùng đúng một chỗ:
 * `tienTo: laBu ? '' : ''` — HAI NHÁNH GIỐNG HỆT NHAU, tức tham số CHẾT. Nó
 * không hề phân biệt được gì, nhưng người đọc code sau sẽ tin là CÓ phân biệt.
 * Quét cả pack thì đây là ternary hai-nhánh-giống-nhau DUY NHẤT còn lại.
 *
 * Vì sao BỎ chứ không cho nó một tiền tố thật: người trong nhóm không cần biết
 * câu này do code hay do model viết — thêm nhãn vào tin gửi người thật là thêm
 * nhiễu. Thứ CẦN phân biệt là phía HOST, và chỗ đó đã có sẵn: hai lời gọi hàm
 * này nằm ở hai nhánh khác nhau, mỗi nhánh tự ghi log riêng. B2 (cụm 3) sẽ dựng
 * đường báo host tử tế trên đúng hai điểm gọi đó.
 */
async function _guiNhac(p, d, bayGioMs) {
  try {
    // 🔴 LỚP CANH THỨ HAI (A6) — đọc lại NGAY TRƯỚC khi chạm mạng. Giữa lúc
    // `SELECT` và lúc này, host có thể vừa gọi `dong_nhac`/`chinh_nhip_nhac`
    // (tool chạy trong CÙNG tiến trình). Một dòng DB rẻ hơn một tin không rút lại được.
    //
    // ⚠️ NÓI THẲNG — LỜI GỌI NÀY HIỆN KHÔNG CÓ BÀI TEST NÀO CHẠM TỚI.
    // Phép thử đột biến 21/08/2026: vô hiệu hoá đúng dòng `if` này thì CẢ 11 bài
    // của cụm 1 vẫn XANH. Lý do: mọi đường vào `_guiNhac` đều đã bị chặn trước đó
    // bởi một phép dành chỗ nguyên tử —
    //   · đường (b1): `danhChoLuotNhac` khoá `trang_thai_td` + `trang_thai`
    //   · đường (b2): CAS `WHERE cho_model_tu_ms = $cu`, mà `dongNhac`/`chinhNhip`
    //     đều xoá cột đó ⇒ CAS hỏng trước khi tới đây
    // ⇒ Đây là PHÒNG THỦ NHIỀU LỚP thật sự: dư thừa CHỪNG NÀO các lớp trên còn
    //   nguyên. Giữ lại vì nó rẻ (một `SELECT` ba cột) và vì lớp trên có thể bị
    //   ai đó nới ra sau này. Logic của `conDangTheoDuoi` thì CÓ bài canh riêng
    //   (T1d-4) — chỉ riêng LỜI GỌI ở đây là không.
    // ⛔ Ai xoá dòng này vì "test vẫn xanh" thì phải đọc hết đoạn trên trước đã.
    if (!conDangTheoDuoi(p.db, d.id, bayGioMs)) {
      _log(`lời nhắc ${d.id}: vừa bị đóng/tạm dừng trước khi gửi -> BỎ lượt này`);
      return false;
    }
    const laDm = String(d.loai_dich) === 'DM';
    const dsNguoi = laDm ? [] : p.dsNguoiTrongNhom(p.db, String(d.chat_id_dich));
    let tagUserIds = [];
    try {
      tagUserIds = d.tag_user_ids ? JSON.parse(d.tag_user_ids) : [];
    } catch { tagUserIds = []; }
    if (d.nguoi_phu_trach && !tagUserIds.includes(String(d.nguoi_phu_trach))) {
      tagUserIds.push(String(d.nguoi_phu_trach));
    }

    const bc = layBoiCanhNhac(p.db, d, { bayGioMs, truyVan: p.truyVanLichSu });
    const nd = dungNoiDung({
      noiDung: cauNhacDuPhong(d, bc),
      dsNguoi,
      tagUserIds,
    });
    for (const u of nd.khongTraRa) {
      _log(`lời nhắc ${d.id}: uid ${u} không tra ra tên -> BỎ tag đó (cấm bịa tên)`);
    }

    const kq = laDm
      ? await p.guiDmHost(p.api, String(d.chat_id_dich), nd.text, { ghiLai: p.ghiLai, uidTroLy: p.uidTroLy })
      : await p.guiVaoNhom(p.api, String(d.chat_id_dich), nd.text, {
        dsNguoi, ghiLai: p.ghiLai, uidTroLy: p.uidTroLy,
      });
    p.db.prepare('UPDATE lich_hen SET msg_id_da_gui = $m, cho_model_tu_ms = NULL WHERE id = $id')
      .run({ m: kq?.msgId ? String(kq.msgId) : null, id: d.id });
    return true;
  } catch (e) {
    _log(`gửi lời nhắc ${d.id} thất bại: ${safeLogText(e)}`);
    return false;
  }
}

/** Cờ bật/tắt bộ chạy lịch — mặc định BẬT (khác phần quét, vốn phải chờ A0). */
export function batLich(env = process.env) {
  return String(env?.ZTL_LICH_HEN ?? '1') !== '0';
}

export const NHIP_MS = GIOI_HAN_LICH.NHIP_KIEM_MS;
