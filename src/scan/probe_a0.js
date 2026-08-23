/**
 * ═══════════════════════════════════════════════════════════════════════
 * MỐC A0 — CHỨNG MINH API TỰ VIẾT CHẠY THẬT, TRƯỚC KHI XÂY GÌ LÊN TRÊN.
 *
 * 🔴 VÌ SAO PHẢI LÀ MỘT PHÉP THỬ TRONG DAEMON, KHÔNG PHẢI SCRIPT RIÊNG:
 * tài khoản Zalo chỉ có MỘT suất "máy tính", và phiên đăng nhập đang nằm
 * trong daemon này. Chạy script riêng = đăng nhập lần hai = có thể đá văng
 * phiên thật đang phục vụ nhóm có người thật. Chưa ai đo được lần đăng nhập
 * thứ hai có đá phiên hay không, nên KHÔNG THỬ.
 *
 * ⇒ Cách duy nhất an toàn: mượn đúng phiên đang sống. Bật bằng biến môi
 * trường, chạy ĐÚNG MỘT LẦN lúc khởi động, ghi kết quả ra file rồi thôi.
 *
 *     ZTL_PROBE_A0=1   (mặc định TẮT)
 *     -> ~/.zalo-tro-ly/probe_a0.json
 *
 * 🔴 KHÔNG ghi DB, KHÔNG gửi tin, KHÔNG sửa gì. Chỉ đọc và ghi 1 file JSON.
 * 🔴 KHÔNG BAO GIỜ ném ra ngoài: A0 hỏng thì daemon vẫn phải chạy bình thường.
 *    Nó là phép đo, không phải điều kiện sống của trợ lý.
 *
 * 🔴 TIN MẪU PHẢI CHE NỘI DUNG. File này Router sẽ đọc bằng mắt, và nội dung
 *    là tin của NGƯỜI THẬT trong nhóm — chỉ ghi ĐỘ DÀI và vài ký tự đầu.
 *
 * A0 phải trả lời được HAI câu, không chỉ một:
 *   ① Gọi được endpoint không? (khả thi kỹ thuật)
 *   ② Tin ĐÃ THU HỒI biến mất hẳn hay trả về dạng "bia mộ"? — cả thuật toán
 *      hiệu tập hợp dựa vào giả định "biến mất hẳn". Nếu Zalo trả bia mộ thì
 *      việc phát hiện còn DỄ HƠN, nhưng code phải viết khác.
 *   Câu ② trả lời được bằng cách đối chiếu ngay với DB: tin nào DB có, nằm
 *   trong biên, mà Zalo không trả -> đó chính là ứng viên "biến mất hẳn".
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureParentDir, expandPath } from '../lib/paths.js';
import {
  A0_BO_DO, A0_CHO, BIEN_THE_THAM_SO, GIOI_HAN_QUET, KET_LUAN_A0, NHOM_LOI_A0,
} from '../lib/hang_so.js';
import { toId } from '../lib/ids.js';

import {
  registerHistoryApi, fetchGroupHistory, describeError, classifyErrorGroup, sessionReady,
  createDiagnosticLog, errorGroupMeaning,
} from './history_api.js';

/**
 * Chờ tới khi phiên có service map, HOẶC hết trần.
 *
 * Chờ CÓ ĐIỀU KIỆN chứ không ngủ một khoảng cố định: ngủ cố định thì hoặc phí
 * thời gian khi phiên đã sẵn sàng, hoặc vẫn hụt khi nó chậm hơn dự đoán — và
 * không có cách nào chọn đúng con số cho cả hai.
 *
 * @param {{api: any, ctx: any}} nguon  `ctx` có thể null (đọc qua api là đủ)
 * @param {{tranMs?: number, nhipMs?: number, nghi?: (ms:number)=>Promise<void>}} [t]
 * @returns {Promise<{sanSang: boolean, doiMs: number}>}
 */
export async function waitForSession(nguon, t = {}) {
  const tran = t.tranMs ?? A0_CHO.TRAN_MS;
  const nhip = t.nhipMs ?? A0_CHO.TICK_MS;
  const nghi = t.nghi ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // 🔴 KHÔNG CÓ `api` thì chờ bao lâu cũng vô ích — không có gì để trở nên sẵn
  // sàng cả. Vòng chờ này chỉ có nghĩa cho ca NỐI LẠI PHIÊN (api có thật, service
  // map chưa kịp gán). Bỏ nhánh này thì phép thử ngồi ngủ đúng 60 giây rồi mới
  // báo cùng một kết luận — và bộ test cũng đứng im 60 giây y hệt.
  if (!nguon?.api) return { sanSang: false, doiMs: 0 };
  let doi = 0;
  for (;;) {
    if (sessionReady(nguon.api, nguon.ctx ?? nguon.api?.ctx ?? null)) {
      return { sanSang: true, doiMs: doi };
    }
    if (doi >= tran) return { sanSang: false, doiMs: doi };
    await nghi(nhip);
    doi += nhip;
  }
}

function _log(msg) {
  process.stderr.write(`[scan/probe_a0] ${msg}\n`);
}

/** Bật hay không — đọc env, mặc định TẮT. */
export function isProbeA0Enabled(env = process.env) {
  return String(env?.ZTL_PROBE_A0 ?? '') === '1';
}

/**
 * Che nội dung tin của người thật: chỉ giữ độ dài + 12 ký tự đầu.
 * @param {any} m
 */
export function maskSampleMessage(m) {
  const noiDung =
    typeof m?.data?.content === 'string'
      ? m.data.content
      : typeof m?.content === 'string'
        ? m.content
        : null;
  return {
    msgId: toId(m?.msgId ?? m?.globalMsgId ?? m?.data?.msgId, 'a0.msgId'),
    ts: Number(m?.ts ?? m?.timestamp ?? 0) || null,
    // KHÔNG in nguyên văn. Đủ để Router thấy "có chữ thật", không đủ để đọc trộm.
    doDaiNoiDung: noiDung === null ? null : noiDung.length,
    dauNoiDung: noiDung === null ? null : `${noiDung.slice(0, 12)}…`,
    coTruongContent: noiDung !== null,
  };
}

/**
 * Chạy A0 đúng một lần.
 *
 * @param {{api: any, db: any, chatId: string, duongDanRa: string,
 *          bayGioMs?: number, tranGoi?: number}} p
 * @returns {Promise<object>} chính bản ghi đã ghi ra file
 */
export async function runProbeA0(p) {
  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 LƯỚI CUỐI CÙNG — runProbeA0() KHÔNG BAO GIỜ ĐƯỢC NÉM.
  //
  // Anh sắp ngồi test trợ lý. A0 là PHÉP ĐO, không phải điều kiện sống của
  // trợ lý: nó nổ kiểu gì thì daemon vẫn phải khởi động và nghe tin bình
  // thường. `index.js` đã fire-and-forget kèm `.catch()`, nhưng dựa vào tầng
  // gọi để giữ an toàn là dựa vào thứ người khác có thể sửa mất — nên chốt
  // luôn ở đây. Bài K1 canh đúng điều này.
  // ═══════════════════════════════════════════════════════════════════════
  try {
    return await _chayA0(p ?? {});
  } catch (e) {
    const ra = {
      chay_luc: new Date().toISOString(),
      goi_duoc: false, so_tin: 0, net_call_count: 0,
      ket_luan: KET_LUAN_A0.CHUA_SAN_SANG,
      nhom_loi: NHOM_LOI_A0.CHUA_CHAM_MANG,
      y_nghia_nhom: errorGroupMeaning(NHOM_LOI_A0.CHUA_CHAM_MANG),
      co_bang_chung_ve_endpoint: false,
      loi: `PHÉP THỬ A0 TỰ NỔ: ${describeError(e).loi}`,
      doc_the_nao: 'Chính phép đo hỏng, KHÔNG nói gì về endpoint. Trợ lý vẫn chạy bình thường.',
      tong_ket: 'Phép đo A0 tự nổ — sửa phép đo, đừng kết luận gì về phương án A.',
    };
    _log(`A0 tự nổ (đã nuốt, daemon không hề hấn): ${e?.message ?? e}`);
    try { _ghiRa(p?.duongDanRa, ra); } catch { /* nuốt: file chỉ là phụ */ }
    return ra;
  }
}

async function _chayA0(p) {
  const bayGio = p.bayGioMs ?? Date.now();
  // 🔴 TRẦN GỌI MẠNG CỦA CẢ PHÉP THỬ, gồm cả lượt chẩn đoán. Vẫn là 2 — lượt
  // biến thể ăn vào phần CÒN LẠI, không nới thêm.
  const tranTong = p.tranGoi ?? 2;
  const so = createDiagnosticLog();
  /** @type {any} */
  const ra = {
    chay_luc: new Date(bayGio).toISOString(),
    chat_id: String(p.chatId ?? ''),
    goi_duoc: false,
    so_tin: 0,
    msg_id_nho_nhat: null,
    msg_id_lon_nhat: null,
    net_call_count: 0,
    so_lan_thu_goi: 0,
    doi_phien_ms: 0,
    cut_trang: false,
    loi: null,
    // ── Chẩn đoán: sinh ra vì lượt A0 thứ hai chỉ ghi được "Lỗi không xác định"
    loi_ten: null,
    loi_ma: null,          // ← ZaloApiError.code = error_code của chính Zalo
    loi_json: null,
    stack_rut_gon: null,
    http_ma: null,
    http_ok: null,
    than_phan_hoi: null,
    nhom_loi: null,
    y_nghia_nhom: null,
    bien_the: null,
    bo_bien_the: null,        // kết quả từng giả thuyết, xem HO_SO_BIEN_THE
    so_request_ca_bo: 0,      // tổng request cả bộ — PHẢI ≤ TRAN_REQUEST_CA_BO
    dung_som: null,           // vì sao dừng giữa chừng (nếu có)
    tong_ket: null,           // MỘT DÒNG nói Router phải làm gì tiếp
    tin_mau: null,
    // ② câu hỏi "bia mộ hay biến mất hẳn"
    doi_chieu_db: null,
    ket_luan: null,
  };

  try {
    registerHistoryApi(p.api);

    // ── Chờ phiên sẵn sàng TRƯỚC KHI gọi ────────────────────────────────
    const cho = await waitForSession(
      { api: p.api, ctx: p.ctx ?? null },
      { tranMs: p.tranChoMs, nhipMs: p.nhipChoMs, nghi: p.nghi },
    );
    ra.doi_phien_ms = cho.doiMs;
    if (!cho.sanSang) {
      // 🔴 TRẠNG THÁI RIÊNG, KHÔNG phải DO. Chưa gọi mạng lần nào thì KHÔNG có
      // bằng chứng gì về endpoint — kết luận "phương án A không khả thi" ở đây
      // là chôn tính năng vì một lỗi phiên.
      ra.ket_luan = KET_LUAN_A0.CHUA_SAN_SANG;
      ra.loi =
        `Chờ ${cho.doiMs}ms mà phiên Zalo vẫn chưa có group_cloud_message. `
        + 'CHƯA GỌI MẠNG LẦN NÀO -> đây KHÔNG phải bằng chứng endpoint hỏng. '
        + 'Kiểm phiên đăng nhập rồi chạy lại phép thử.';
      _log(ra.loi);
      // ⚠️ PHẢI gọi _chotBangChung ở ĐÂY NỮA. Bản đầu chỉ gắn 2 trường đó sau
      // try/catch nên nhánh trả về sớm này ghi ra file THIẾU chúng — mà đây lại
      // đúng là ca cần chúng nhất. Bài test I8 bắt được.
      _chotBangChung(ra);
      _ghiRa(p.duongDanRa, ra);
      return ra;
    }

    const kq = await fetchGroupHistory(p.api, p.chatId, {
      tuMs: bayGio - GIOI_HAN_QUET.CUA_SO_QUET_MS,
      tranGoi: tranTong, // A0 cố ý DÈ DẶT: chỉ 2 request, đủ để trả lời
      so,
    });

    ra.goi_duoc = true;
    ra.so_tin = kq.tin.length;
    ra.msg_id_nho_nhat = kq.minMsgId;
    ra.msg_id_lon_nhat = kq.maxMsgId;
    ra.net_call_count = so.soGoiMang || kq.soGoi;
    ra.so_lan_thu_goi = kq.soGoi;
    ra.http_ma = so.httpMa;
    ra.http_ok = so.httpOk;
    ra.bien_the = so.bienThe ?? BIEN_THE_THAM_SO.CHUAN;
    ra.cut_trang = kq.cutTrang;
    ra.tin_mau = kq.tin.length ? maskSampleMessage(kq.tin[0]) : null;

    // ── ② Zalo có trả "bia mộ" cho tin đã thu hồi không? ────────────────
    // Ta đã biết trong DB có tin nào bị thu hồi (nguồn SU_KIEN, chắc chắn).
    // Nếu id đó CÓ trong danh sách Zalo vừa trả -> Zalo trả bia mộ.
    // Nếu KHÔNG có -> Zalo bỏ hẳn, đúng giả định của thuật toán hiệu tập hợp.
    if (p.db && kq.minMsgId && kq.maxMsgId) {
      const zSet = new Set(
        kq.tin.map((m) => toId(m?.msgId ?? m?.globalMsgId ?? m?.data?.msgId, 'a0.z')).filter(Boolean),
      );
      const daThuHoi = p.db
        .prepare(
          `SELECT msg_id FROM messages
            WHERE chat_id = $c AND recalled = 1
              AND CAST(msg_id AS INTEGER) BETWEEN CAST($lo AS INTEGER) AND CAST($hi AS INTEGER)`,
        )
        .all({ c: String(p.chatId), lo: kq.minMsgId, hi: kq.maxMsgId })
        .map((r) => String(r.msg_id));
      const conTrongZalo = daThuHoi.filter((id) => zSet.has(id));
      ra.doi_chieu_db = {
        so_tin_da_thu_hoi_trong_bien: daThuHoi.length,
        so_van_con_trong_ket_qua_zalo: conTrongZalo.length,
        // 0 tin để đối chiếu thì KHÔNG được kết luận gì — nói thẳng.
        y_nghia:
          daThuHoi.length === 0
            ? 'CHUA_KET_LUAN_DUOC: trong biên không có tin nào đã thu hồi để đối chiếu'
            : conTrongZalo.length === 0
              ? 'BIEN_MAT_HAN: đúng giả định của thuật toán hiệu tập hợp'
              : 'BIA_MO: Zalo VẪN trả tin đã thu hồi -> phải đổi cách phát hiện',
      };
    }

    ra.ket_luan = ra.so_tin > 0 ? KET_LUAN_A0.XANH : KET_LUAN_A0.GOI_DUOC_NHUNG_0_TIN;
  } catch (e) {
    ra.goi_duoc = false;
    // Số lượt đã CHẠM MẠNG THẬT — do sổ chẩn đoán giữ, cộng ngay trước
    // `utils.request`. KHÔNG lấy từ số lần gọi hàm (bản cũ đếm nhầm chỗ đó).
    ra.net_call_count = Number(so.soGoiMang) || 0;
    ra.so_lan_thu_goi = Number(e?.soLanThuGoi ?? 0) || 0;

    // ★ BÓC LỖI RA HẾT. `loi: "Lỗi không xác định"` là nguyên văn error_message
    // của Zalo; thứ thật sự phân biệt được nhóm nguyên nhân là `loi_ma`.
    Object.assign(ra, describeError(e));
    ra.http_ma = so.httpMa;
    ra.http_ok = so.httpOk;
    ra.than_phan_hoi = so.thanPhanHoi;
    ra.bien_the = so.bienThe ?? BIEN_THE_THAM_SO.CHUAN;

    ra.nhom_loi = classifyErrorGroup({
      soGoiMang: ra.net_call_count,
      loiKetNoi: so.loiKetNoi,
      httpMa: so.httpMa,
      loiMa: ra.loi_ma,
      thanPhanHoi: so.thanPhanHoi,
    });

    ra.ket_luan = ra.net_call_count > 0 ? KET_LUAN_A0.DO : KET_LUAN_A0.CHUA_SAN_SANG;
    if (ra.net_call_count === 0) {
      ra.loi += ' | CHƯA GỌI MẠNG LẦN NÀO -> KHÔNG phải bằng chứng endpoint hỏng.';
    }

    // ── BỘ BIẾN THỂ: nhiều giả thuyết trong MỘT lần khởi động ─────────────
    // Chỉ chạy khi đã biết endpoint SỐNG. Endpoint chết thật thì đổi tham số
    // kiểu gì cũng vô ích, bắn thêm chỉ tổ rủi ro gắn cờ spam.
    if (p.thuBienThe !== false && ra.nhom_loi === NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC) {
      // 🔴 BỌC RIÊNG. Bộ biến thể chạy TRONG khối catch — nó mà ném thì cả
      // runProbeA0() ném, và anh mất luôn kết quả của lượt CHUẨN đã đo xong.
      // Phần phụ tuyệt đối không được kéo phần chính xuống theo.
      try {
        ra.bo_bien_the = await _chayBoBienThe(p, ra, bayGio, ra.net_call_count);
        if (ra.bo_bien_the.some((x) => x.goi_duoc)) {
          // Có biến thể LẤY ĐƯỢC TIN THẬT trong khi bộ chuẩn hỏng ⇒ hết đoán.
          ra.nhom_loi = NHOM_LOI_A0.THAM_SO_SAI_DA_CHUNG_MINH;
        }
      } catch (e2) {
        ra.bo_bien_the = [{ bien_the: 'LOI_BO_DO', bo_qua: true, loi: describeError(e2).loi }];
        _log(`bộ biến thể ném (đã nuốt): ${e2?.message ?? e2}`);
      }
    }
    ra.y_nghia_nhom = errorGroupMeaning(ra.nhom_loi);
  }

  _chotBangChung(ra);
  _ghiRa(p.duongDanRa, ra);
  return ra;
}

/**
 * ★ Hai trường tồn tại để KHÔNG AI đọc nhầm file này lần nữa.
 *
 * Ngày 20/08/2026 lượt A0 đầu ra `ket_luan: "DO"` với `net_call_count: 0`, và
 * Router suýt kết luận "endpoint chết ⇒ dừng hẳn phương án A". Thực tế chưa hề
 * có lời gọi mạng nào — file đó KHÔNG nói được gì về endpoint cả.
 *
 * ⇒ Chỉ khi `co_bang_chung_ve_endpoint === true` thì `ket_luan` mới có ý nghĩa
 * với endpoint. `doc_the_nao` viết thẳng câu đó ra để người đọc khỏi phải suy.
 *
 * PHẢI gọi ở MỌI đường thoát của runProbeA0().
 */
function _chotBangChung(ra) {
  try { ra.tong_ket = _tongKet(ra); } catch { ra.tong_ket = null; }
  ra.co_bang_chung_ve_endpoint = ra.net_call_count > 0;
  if (!ra.nhom_loi) {
    ra.nhom_loi = ra.co_bang_chung_ve_endpoint ? null : NHOM_LOI_A0.CHUA_CHAM_MANG;
  }
  if (ra.nhom_loi && !ra.y_nghia_nhom) ra.y_nghia_nhom = errorGroupMeaning(ra.nhom_loi);

  if (!ra.co_bang_chung_ve_endpoint) {
    ra.doc_the_nao = 'CHƯA gọi mạng lần nào -> ket_luan KHÔNG nói gì về endpoint. '
      + 'Sửa phiên rồi chạy lại.';
    return;
  }
  // 🔴 "Đã gọi mạng thật" KHÔNG đồng nghĩa "endpoint chết". Bản trước dừng ở
  // đúng câu đó, và với `loi: "Lỗi không xác định"` thì người đọc chỉ còn cách
  // đoán. Giờ câu này phải NÓI RÕ nhóm — nhất là nhóm "endpoint SỐNG".
  ra.doc_the_nao = ra.goi_duoc
    ? 'Đã gọi mạng thật và LẤY ĐƯỢC dữ liệu -> ket_luan nói đúng về endpoint.'
    : `Đã gọi mạng thật rồi hỏng. Nhóm nguyên nhân: ${ra.nhom_loi}. `
      + '⚠️ CHỈ nhóm ENDPOINT_CHET mới là điều kiện dừng phương án A — '
      + 'đọc `y_nghia_nhom` trước khi kết luận bất cứ điều gì.';
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * HỒ SƠ TỪNG GIẢ THUYẾT — mỗi cái phải trả lời được 3 câu ngay trong file:
 * đổi GÌ · vì sao NGHI (bằng chứng ở đâu) · hỏng thì LOẠI được gì.
 *
 * 🔴 Bằng chứng LẤY TỪ `node_modules/zca-js/dist/` — xem các API CÙNG HỌ đang
 * chạy được gọi thế nào. KHÔNG đoán từ tài liệu, KHÔNG bịa bảng mã lỗi Zalo.
 * ═══════════════════════════════════════════════════════════════════════
 */
const HO_SO_BIEN_THE = Object.freeze({
  [BIEN_THE_THAM_SO.SRC_1]: {
    doi_gi: 'src: 3 -> 1',
    vi_sao_nghi: 'PR #370 ghi src:3, nhưng KHÔNG API nào của zca-js dùng số 3.',
    bang_chung: 'dist/apis/createPoll.js:26 `src: 1` · createReminder.js:33+48 `src: 1` '
      + '· createNote.js:27 `src: 1` — 3/3 API gửi `src` đều dùng 1.',
    hong_thi_loai_duoc: 'Giá trị `src` KHÔNG phải nguyên nhân.',
  },
  [BIEN_THE_THAM_SO.BO_IMEI]: {
    doi_gi: 'bỏ hẳn khoá `imei`',
    vi_sao_nghi: 'zca-js gửi imei có CHỌN LỌC, và đúng nhánh NHÓM thì nó BỎ.',
    bang_chung: 'dist/apis/deleteMessage.js:39 `if (!isGroup) params.imei = ctx.imei` '
      + '-> nhánh nhóm KHÔNG có imei. (sendSeenEvent.js:51 làm NGƯỢC LẠI: '
      + '`isGroup ? {imei} : {}` — hai API mâu thuẫn nhau, nên phải ĐO chứ không suy.)',
    hong_thi_loai_duoc: 'Thừa `imei` KHÔNG phải nguyên nhân.',
  },
  [BIEN_THE_THAM_SO.CON_TRO_THAT]: {
    doi_gi: 'globalMsgId: 0 -> một msg_id THẬT lấy từ DB (tin mới nhất của nhóm)',
    vi_sao_nghi: 'Trong toàn bộ zca-js, `globalMsgId` CHƯA BAO GIỜ mang giá trị 0 — '
      + 'luôn là một id tin thật. Số 0 cho trang đầu là suy diễn của PR, chưa ai đo.',
    bang_chung: 'dist/apis/deleteMessage.js:31 `globalMsgId: data.msgId` — chỗ DUY NHẤT '
      + 'khác dùng khoá này, và luôn truyền id thật.',
    hong_thi_loai_duoc: 'Giá trị con trỏ trang đầu KHÔNG phải nguyên nhân.',
  },
  [BIEN_THE_THAM_SO.TOI_THIEU]: {
    doi_gi: 'chỉ giữ {groupId, globalMsgId, count} — bỏ msgIds, imei, src',
    vi_sao_nghi: 'LƯỚI VÉT, chạy cuối: nếu ba lượt đơn lẻ trên đều hỏng thì nguyên nhân '
      + 'có thể là TỔ HỢP, hoặc một khoá thừa mà từng cái riêng lẻ chưa đủ gây lỗi.',
    bang_chung: 'dist/apis/getGroupInviteBoxInfo.js — API nhóm GET chỉ gửi 3 khoá '
      + '(grId/mcount/mpage), không imei, không src. Bộ tham số gọn là bình thường.',
    hong_thi_loai_duoc: '🔴 Toàn bộ hướng "thừa/sai một khoá phụ" bị loại -> phải nghi '
      + 'QUYỀN/PHIÊN, hoặc chính 3 khoá lõi (nhất là groupId có/không tiền tố "g").',
  },
});

/** Lấy msg_id mới nhất của nhóm để dựng con trỏ THẬT. Chỉ ĐỌC, nuốt mọi lỗi. */
function _msgIdMoiNhat(db, chatId) {
  try {
    const r = db
      ?.prepare(
        'SELECT msg_id FROM messages WHERE chat_id = $c '
          + 'ORDER BY CAST(msg_id AS INTEGER) DESC LIMIT 1',
      )
      .get({ c: String(chatId) });
    return r?.msg_id ? String(r.msg_id) : null;
  } catch (e) {
    _log(`không lấy được msg_id thật: ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Chạy CẢ BỘ giả thuyết trong MỘT lần khởi động.
 *
 * 🔴 BA ĐIỀU KIỆN DỪNG SỚM, thiếu cái nào cũng là bắn thừa vào tài khoản thật:
 *   · một biến thể XANH (lấy được tin)  -> xong việc, thử tiếp là vô nghĩa
 *   · gặp ENDPOINT_CHET (404/410)       -> endpoint đã gỡ, mọi tham số đều vô ích
 *   · chạm trần 5 request cả bộ         -> trần cứng, không nới
 *
 * Nuốt mọi lỗi: đây là phần PHỤ, hỏng thì kết quả chính vẫn phải ghi ra file.
 */
async function _chayBoBienThe(p, ra, bayGio, daTieu) {
  const nghi = p.nghi ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tranBo = p.tranRequestCaBo ?? A0_BO_DO.TRAN_REQUEST_CA_BO;
  const day = p.dsBienThe ?? A0_BO_DO.DAY_BIEN_THE;
  const ds = [];
  let tieu = daTieu;

  for (const bt of day) {
    const hoSo = HO_SO_BIEN_THE[bt] ?? {};
    if (tieu >= tranBo) {
      ds.push({
        bien_the: bt, bo_qua: true,
        vi_sao_bo_qua: `chạm trần ${tranBo} request cho cả bộ -> DỪNG. `
          + 'Trần là để không bị Zalo gắn cờ spam, KHÔNG được nới.',
        ...hoSo,
      });
      continue;
    }

    // Con trỏ thật phải lấy được TRƯỚC, không thì bỏ lượt (và KHÔNG tiêu request).
    let conTroDau = null;
    if (bt === BIEN_THE_THAM_SO.CON_TRO_THAT) {
      conTroDau = _msgIdMoiNhat(p.db, p.chatId);
      if (!conTroDau) {
        ds.push({
          bien_the: bt, bo_qua: true,
          vi_sao_bo_qua: 'DB không có msg_id nào của nhóm này -> không dựng được con trỏ '
            + 'thật. KHÔNG bịa một id ra để thử.',
          ...hoSo,
        });
        continue;
      }
    }

    // Giãn nhịp TRƯỚC mỗi lần bắn (lượt chuẩn đã bắn rồi nên luôn cần nghỉ).
    await nghi(A0_BO_DO.NGHI_GIUA_BIEN_THE_MS);

    const so2 = createDiagnosticLog();
    /** @type {any} */
    const kq = {
      bien_the: bt, bo_qua: false, ...hoSo,
      con_tro_dung: conTroDau,
      goi_duoc: false, so_tin: 0, net_call_count: 0,
      loi: null, loi_ma: null, http_ma: null, than_phan_hoi: null, nhom_loi: null,
    };
    try {
      const r = await fetchGroupHistory(p.api, p.chatId, {
        tuMs: bayGio - GIOI_HAN_QUET.CUA_SO_QUET_MS,
        tranGoi: 1, // ĐÚNG 1 request mỗi biến thể, không phân trang
        so: so2, bienThe: bt, conTroDau,
      });
      kq.goi_duoc = true;
      kq.so_tin = r.tin.length;
    } catch (e) {
      const mo = describeError(e);
      kq.loi = mo.loi;
      kq.loi_ma = mo.loi_ma;
    }
    kq.net_call_count = so2.soGoiMang;
    kq.http_ma = so2.httpMa;
    kq.than_phan_hoi = so2.thanPhanHoi;
    kq.nhom_loi = kq.goi_duoc
      ? null
      : classifyErrorGroup({
        soGoiMang: so2.soGoiMang, loiKetNoi: so2.loiKetNoi,
        httpMa: so2.httpMa, loiMa: kq.loi_ma, thanPhanHoi: so2.thanPhanHoi,
      });
    kq.ket_luan_luot = kq.goi_duoc
      ? `🟢 CHẠY ĐƯỢC (${kq.so_tin} tin) -> ĐÂY LÀ CHỖ SAI. Sửa buildApiParams() theo bien_the này.`
      : `hỏng (ma=${kq.loi_ma}) -> LOẠI: ${hoSo.hong_thi_loai_duoc ?? 'giả thuyết này'}`;

    tieu += so2.soGoiMang;
    ds.push(kq);

    if (kq.goi_duoc) {
      ra.dung_som = `XANH ở biến thể ${bt} -> dừng ngay, không thử tiếp`;
      break;
    }
    if (kq.nhom_loi === NHOM_LOI_A0.ENDPOINT_CHET) {
      ra.dung_som = `ENDPOINT_CHET ở biến thể ${bt} -> dừng ngay, tham số nào cũng vô ích`;
      break;
    }
  }

  ra.so_request_ca_bo = tieu;
  return ds;
}

/**
 * Một dòng tổng kết để Router khỏi phải tự suy từ mảng kết quả.
 * Đây là thứ quyết định "một lần restart nói được nhiều điều" hay không.
 */
function _tongKet(ra) {
  const ds = ra.bo_bien_the ?? [];
  const thang = ds.find((x) => x.goi_duoc);
  if (ra.goi_duoc) return '🟢 XANH ngay ở bộ tham số CHUẨN — không cần biến thể nào.';
  if (thang) {
    return `🟢 TÌM RA CHỖ SAI: biến thể ${thang.bien_the} (${thang.doi_gi}) chạy được `
      + `${thang.so_tin} tin. Sửa buildApiParams() theo đúng biến thể đó là A0 xanh.`;
  }
  const daChay = ds.filter((x) => !x.bo_qua);
  const boQua = ds.filter((x) => x.bo_qua);
  if (daChay.length === 0) {
    return `Chưa chạy được biến thể nào (${ra.nhom_loi ?? 'không rõ nhóm'}). `
      + 'Đọc nhom_loi của lượt chuẩn trước.';
  }
  const ma = [...new Set(daChay.map((x) => x.loi_ma).filter((x) => x !== null))];
  return `Cả ${daChay.length} biến thể đều hỏng (mã ${ma.join(', ') || 'không rõ'}). `
    + `ĐÃ LOẠI: ${daChay.map((x) => x.bien_the).join(', ')}`
    + (boQua.length ? ` | CHƯA thử: ${boQua.map((x) => x.bien_the).join(', ')}` : '')
    + '. Endpoint SỐNG nhưng mọi hình dạng tham số phụ đều bị từ chối '
    + '-> nghi QUYỀN/PHIÊN trên nhóm này, hoặc chính khoá `groupId`.';
}

/**
 * Ghi file kết quả. GHI ĐÈ mỗi lần chạy — Router sẽ chạy lại nhiều lượt, và
 * một file cũ còn nằm đó là chuyện nguy hiểm: đọc phải kết quả của lượt trước
 * mà tưởng của lượt này. CỐ Ý không có nhánh "đã tồn tại thì bỏ qua".
 */
function _ghiRa(duongDanRa, ra) {
  try {
    const f = expandPath(duongDanRa);
    ensureParentDir(f);
    fs.writeFileSync(f, JSON.stringify(ra, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(f, 0o600); } catch { /* nuốt */ }
    _log(`đã ghi ${f} — kết luận: ${ra.ket_luan} (net_call_count=${ra.net_call_count})`);
  } catch (e) {
    _log(`KHÔNG ghi được file kết quả: ${e?.message ?? e}`);
  }
}

/**
 * Chọn nhóm để thử: nhóm CÓ TIN GẦN NHẤT trong các nhóm đang nghe.
 * Nhóm im lìm thì gọi cũng không có gì để đối chiếu.
 * @param {any} db
 * @returns {string|null}
 */
export function pickTestGroup(db) {
  try {
    const r = db
      .prepare(
        `SELECT t.chat_id, MAX(t.ts_zalo) m
           FROM messages t JOIN conversations h ON h.chat_id = t.chat_id AND h.listened = 1
          WHERE h.kind = 'GROUP'
          GROUP BY t.chat_id ORDER BY m DESC LIMIT 1`,
      )
      .get();
    return r ? String(r.chat_id) : null;
  } catch (e) {
    _log(`không chọn được nhóm thử: ${e?.message ?? e}`);
    return null;
  }
}

/** Đường dẫn file kết quả, đặt cạnh DB. */
export function probeResultPath(duongDanDb) {
  return path.join(path.dirname(expandPath(duongDanDb)), 'probe_a0.json');
}
