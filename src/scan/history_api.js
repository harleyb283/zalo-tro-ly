/**
 * ═══════════════════════════════════════════════════════════════════════
 * v3 — TỰ ĐĂNG KÝ API LẤY LỊCH SỬ NHÓM (`getrecentv2`).
 *
 * 🔴 VÌ SAO PHẢI TỰ VIẾT: `api.getGroupChatHistory()` của zca-js 2.1.2 (bản
 * ĐANG CÀI, đã kiểm `node_modules/zca-js/package.json`) trỏ vào
 *     ${zpwServiceMap.group[0]}/api/group/history
 * — endpoint Zalo ĐÃ GỠ, trả 404 (issue #367). Gọi thẳng hàm đó là thất bại,
 * không phải "chưa thử".
 *
 * Tham số bên dưới lấy từ **diff PR #370** của chính repo zca-js, KHÔNG đoán.
 * ⚠️ PR ĐÓ CHƯA MERGE. Tác giả có kiểm ("120 tin, msgIds đều duy nhất") nhưng
 * CHƯA AI CHẠY TRÊN MÁY NÀY. Vì vậy toàn bộ tính năng đối chiếu nằm sau cờ
 * tắt, và phải qua MỐC A0 (`src/scan/probe_a0.js`) trước.
 *
 * 🔴 KHÔNG VÁ THƯ VIỆN. Dùng `api.custom(name, cb)` — cơ chế mở rộng CHÍNH
 * CHỦ của zca-js (`dist/apis/custom.js`), callback nhận `{ctx, utils, props}`.
 * Vá node_modules thì `npm install` sau này xoá mất, hỏng CÂM.
 *
 * ⚠️ Tên trong `utils` là **`resolve`**, KHÔNG phải `resolveResponse` như bản
 * thiết kế ghi — đã đọc `dist/utils.d.ts` (`FactoryUtils`) để lấy tên thật.
 * Gõ sai tên là `undefined is not a function` ngay lời gọi đầu.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  A0_CHAN_DOAN, BIEN_THE_THAM_SO, GIOI_HAN_QUET, NHOM_LOI_A0,
} from '../lib/hang_so.js';
import { toId } from '../lib/ids.js';

/** Tên API tự đăng ký. Đặt tiền tố `ztl` để không bao giờ đụng tên của zca-js. */
export const HISTORY_API_NAME = 'ztlLayLichSuNhom';

function _canhBao(msg) {
  process.stderr.write(`[scan/api_lichsu] ${msg}\n`);
}

/**
 * Bỏ tiền tố "g" của groupId.
 *
 * 🔴 PR #370 làm đúng việc này và nó KHÔNG phải chi tiết vặt: threadId nhóm mà
 * zca-js đưa cho ta có thể mang tiền tố `g`, còn endpoint `getrecentv2` đòi id
 * TRẦN. Gửi kèm `g` thì Zalo trả rỗng — tức là "nhóm không có tin nào", đúng
 * cái hình dạng mà thuật toán đối chiếu sẽ đọc thành **CẢ NHÓM BỊ THU HỒI**.
 * Một ký tự thừa ở đây là vu oan cho toàn bộ thành viên.
 *
 * @param {string} groupId
 * @returns {string}
 */
export function stripGPrefix(groupId) {
  const s = String(groupId ?? '').trim();
  return s.startsWith('g') ? s.slice(1) : s;
}

/**
 * Đăng ký API vào đối tượng `api` đang sống của daemon.
 *
 * Gọi lại lần hai trên cùng `api` sẽ NÉM, vì `custom()` dùng
 * `Object.defineProperty(..., configurable: false)`. Nuốt lỗi đó là đúng: nó
 * chỉ có nghĩa "đã đăng ký rồi".
 *
 * @param {any} api
 * @returns {boolean} true = vừa đăng ký, false = đã có sẵn / không đăng ký được
 */
/**
 * ★ Lấy base URL của dịch vụ cloud message. MỘT CHỖ DUY NHẤT trong pack.
 *
 * 🔴 BUG THẬT 20/08/2026 — ĐỌC KỸ TRƯỚC KHI SỬA:
 * Bản đầu đọc `ctx.zpwServiceMap.group_cloud_message[0]` và LUÔN LUÔN rỗng.
 * Nguyên nhân KHÔNG phải "phiên chưa sẵn sàng" — mà là **`ctx.zpwServiceMap`
 * KHÔNG BAO GIỜ TỒN TẠI LÚC CHẠY**. Nó chỉ có trong khai báo kiểu
 * `context.d.ts:123` (ContextSession), còn runtime thì không ai gán. Đã grep
 * toàn bộ `dist/`: phép gán DUY NHẤT là `apis.js:150  this.zpwServiceMap = …`,
 * tức gán lên đối tượng **API**, không phải ctx.
 *
 * Đường đi thật (`zalo.js`):
 *      ctx.loginInfo = loginInfo                                  (dòng 68)
 *      return new API(ctx, loginInfo.zpw_service_map_v3, …)       (dòng 72)
 *      -> apis.js:150  this.zpwServiceMap = zpw_service_map_v3
 * ⇒ `api.zpwServiceMap` và `ctx.loginInfo.zpw_service_map_v3` là CÙNG MỘT vật.
 *
 * Hệ quả quan trọng: chờ lâu bao nhiêu cũng VÔ ÍCH cho ca này — không có cuộc
 * đua nào cả, chỉ là đọc nhầm thuộc tính. Cả hai nguồn dưới đây đều được gán
 * XONG trước khi `login()` trả về.
 *
 * Đọc LƯỜI (mỗi lần gọi) chứ không chụp lúc đăng ký: nối lại phiên sinh ra đối
 * tượng `api` MỚI, chụp cứng là giữ URL của phiên đã chết.
 *
 * @param {any} api
 * @param {any} ctx
 * @returns {string|null}
 */
export function cloudMessageBase(api, ctx) {
  return (
    ctx?.loginInfo?.zpw_service_map_v3?.group_cloud_message?.[0]
    // Thư viện tự dùng `api.zpwServiceMap` ở mọi API của nó -> nguồn đáng tin
    // ngang hàng, giữ làm đường thứ hai phòng khi zca-js đổi chỗ đặt loginInfo.
    ?? api?.zpwServiceMap?.group_cloud_message?.[0]
    ?? null
  );
}

/** Phiên đã có đủ thứ cần để gọi `getrecentv2` chưa. */
export function sessionReady(api, ctx) {
  return Boolean(cloudMessageBase(api, ctx));
}

/**
 * Dựng bộ tham số gửi lên `getrecentv2`. TÁCH RA THÀNH HÀM THUẦN để đối chiếu
 * với diff PR #370 bằng test, thay vì bằng mắt.
 *
 * Nguyên văn spec (memory rnd `ref_zalo_msgid_khong_lien_tuc_va_getrecentv2`,
 * đọc từ diff PR, không đoán):
 *   `{groupId(BỎ tiền tố "g"), globalMsgId: cursor, count: min(50,…),
 *     msgIds: [], imei, src: 3}` -> encodeAES -> `?params=`
 *
 * 🔴 `globalMsgId` GIỮ DẠNG CHUỖI cho các trang sau, CỐ Ý lệch chữ "cursor =
 * Number(lastMsgId)" trong spec: msg_id Zalo vượt Number.MAX_SAFE_INTEGER, ép
 * Number là mất chính xác ÂM THẦM -> con trỏ trỏ sai chỗ, phân trang nhảy cóc.
 * Trang ĐẦU vẫn gửi số 0 đúng như spec.
 *
 * @param {{groupId: string, conTro: any, soLuong: any, imei: any, bienThe?: string}} p
 */
export function buildApiParams(p) {
  const t = {
    groupId: stripGPrefix(p.groupId),
    globalMsgId: p.conTro === null || p.conTro === undefined ? 0 : String(p.conTro),
    count: Math.min(GIOI_HAN_QUET.SO_TIN_MOI_TRANG, Math.max(1, Number(p.soLuong) || 1)),
    msgIds: [],
    imei: p.imei,
    src: 3,
  };
  switch (p.bienThe) {
    case BIEN_THE_THAM_SO.MSG_IDS_CHUOI:
      // ⛔ ĐÃ LOẠI 22:37 — giữ lại đúng để không ai thử lại lần nữa.
      t.msgIds = JSON.stringify([]);
      break;
    case BIEN_THE_THAM_SO.SRC_1:
      t.src = 1;
      break;
    case BIEN_THE_THAM_SO.BO_IMEI:
      delete t.imei;
      break;
    case BIEN_THE_THAM_SO.CON_TRO_THAT:
      // Không đổi khoá nào — thứ đổi là GIÁ TRỊ con trỏ, do tầng gọi bơm vào
      // qua `conTro` (một msg_id THẬT lấy từ DB thay cho số 0).
      break;
    case BIEN_THE_THAM_SO.TOI_THIEU:
      // Lưới vét: chỉ giữ 3 khoá không ai nghi ngờ.
      delete t.msgIds;
      delete t.imei;
      delete t.src;
      break;
    default:
      break;
  }
  return t;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * SỔ CHẨN ĐOÁN — thứ biến `loi: "Lỗi không xác định"` thành câu trả lời.
 *
 * 🔴 VÌ SAO PHẢI LÀ ĐỐI TƯỢNG TRUYỀN VÀO, KHÔNG PHẢI BIẾN MODULE:
 * biến module thì hai lượt quét chạy chồng nhau sẽ ghi đè số của nhau, và
 * chính bộ đếm "đã chạm mạng chưa" là thứ quyết định có DỪNG phương án A hay
 * không. Đếm sai ở đây = chôn tính năng vì một con số lẫn lộn.
 *
 * `soGoiMang` cộng NGAY TRƯỚC `utils.request` — tức "một request đã rời khỏi
 * tiến trình này". Đó mới là định nghĩa đúng của "chạm mạng".
 * ═══════════════════════════════════════════════════════════════════════
 */
export function createDiagnosticLog() {
  return {
    soGoiMang: 0,       // request đã BẮN ĐI (kể cả không nối được)
    soPhanHoi: 0,       // request có phản hồi HTTP quay về
    httpMa: null,
    httpOk: null,
    loiKetNoi: null,    // request() tự ném (DNS/TCP/timeout)
    thanPhanHoi: null,
    bienThe: null,
  };
}

/**
 * Tóm tắt thân phản hồi — CHE nội dung tin của người thật.
 *
 * 🔴 Thân của Zalo khi lỗi có dạng `{"error_code":N,"error_message":"…","data":""}`.
 * Ta CHỈ giữ 3 thứ vô hại đó. Không bao giờ ghi nguyên văn `data` (đã mã hoá,
 * nhưng khi endpoint chạy được thì chính chỗ đó là tin của người ta).
 *
 * `doc` chỉ để test bơm chuỗi vào — chạy thật thì dùng `res.text()`.
 *
 * @param {any} res
 * @param {(r:any)=>Promise<string>} [doc]
 */
export async function summarizeResponseBody(res, doc) {
  try {
    const chu = String((doc ? await doc(res) : await res.text()) ?? '');
    let j = null;
    try { j = JSON.parse(chu); } catch { j = null; }
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      return {
        dang: 'JSON',
        error_code: j.error_code ?? null,
        error_message:
          typeof j.error_message === 'string' ? j.error_message.slice(0, 200) : null,
        do_dai_truong_data: typeof j.data === 'string' ? j.data.length : null,
        ghi_chu: 'CHỈ giữ error_code/error_message + ĐỘ DÀI data. Nội dung đã bỏ.',
      };
    }
    // Không phải JSON -> thường là trang lỗi HTML/gateway, không chứa tin ai cả.
    return {
      dang: 'KHONG_PHAI_JSON',
      do_dai: chu.length,
      dau: chu.slice(0, A0_CHAN_DOAN.TRAN_THAN_PHAN_HOI),
    };
  } catch (e) {
    return { dang: 'KHONG_DOC_DUOC', vi_sao: String(e?.message ?? e).slice(0, 120) };
  }
}

/**
 * Bóc một lỗi ra thành các trường đọc được.
 *
 * 🔴 CHỖ NUỐT LỖI CŨ nằm ở đây: `String(e?.message ?? e)` giữ ĐÚNG một chuỗi
 * rồi vứt hết phần còn lại. Với `ZaloApiError` thì `e.code` CHÍNH LÀ error_code
 * của máy chủ Zalo — thứ duy nhất phân biệt được nhóm nguyên nhân — mà nó bị
 * ném đi. Kết quả: `loi: "Lỗi không xác định"`, đúng nguyên văn Zalo trả về, và
 * không ai biết thêm gì.
 *
 * Lỗi KHÔNG có `message` (object trần) -> `JSON.stringify` cả nó ra, đừng để
 * rơi về `"[object Object]"`.
 */
export function describeError(e) {
  const mo = { loi: null, loi_ten: null, loi_ma: null, loi_json: null, stack_rut_gon: null };
  const msg = e?.message;
  mo.loi_ten = e?.name ?? (e === null ? 'null' : typeof e);
  mo.loi_ma = e?.code ?? null;   // ← ZaloApiError.code = error_code của Zalo
  if (typeof msg === 'string' && msg.trim() !== '') {
    mo.loi = msg.slice(0, A0_CHAN_DOAN.TRAN_LOI_KY_TU);
  } else {
    try {
      // Replacer là DANH SÁCH KHOÁ: Error có message/stack là own-property
      // không-đếm-được nên JSON.stringify trần trả về "{}".
      mo.loi_json = JSON.stringify(e, Object.getOwnPropertyNames(Object(e)))
        .slice(0, A0_CHAN_DOAN.TRAN_LOI_KY_TU);
    } catch {
      mo.loi_json = String(e).slice(0, A0_CHAN_DOAN.TRAN_LOI_KY_TU);
    }
    mo.loi = `(lỗi không có message) ${mo.loi_json}`.slice(0, A0_CHAN_DOAN.TRAN_LOI_KY_TU);
  }
  if (typeof e?.stack === 'string') {
    mo.stack_rut_gon = e.stack
      .split('\n').slice(0, 1 + A0_CHAN_DOAN.TRAN_STACK_DONG)
      .map((s) => s.trim()).join(' | ')
      .slice(0, A0_CHAN_DOAN.TRAN_LOI_KY_TU);
  }
  return mo;
}

/**
 * Xếp nhóm nguyên nhân từ BẰNG CHỨNG, không từ chữ trong thông điệp lỗi.
 *
 * ⚠️ Zalo hay trả **HTTP 200 kèm mã lỗi trong thân** — nhánh đó phải kiểm
 * riêng, chỉ nhìn mã HTTP là bỏ sót hoàn toàn.
 *
 * @param {{soGoiMang?: number, loiKetNoi?: any, httpMa?: number|null,
 *          loiMa?: any, thanPhanHoi?: any}} bc
 * @returns {string} một giá trị của NHOM_LOI_A0
 */
export function classifyErrorGroup(bc = {}) {
  if ((Number(bc.soGoiMang) || 0) === 0) return NHOM_LOI_A0.CHUA_CHAM_MANG;
  if (bc.loiKetNoi) return NHOM_LOI_A0.KHONG_KET_NOI_DUOC;

  const s = Number(bc.httpMa) || 0;
  if (s === 404 || s === 410) return NHOM_LOI_A0.ENDPOINT_CHET;
  if (s === 401 || s === 403) return NHOM_LOI_A0.QUYEN_PHIEN;
  if (s >= 500) return NHOM_LOI_A0.MAY_CHU_LOI;

  const coMaZalo = bc.loiMa !== null && bc.loiMa !== undefined;
  const coThanZalo = bc.thanPhanHoi?.dang === 'JSON'
    && bc.thanPhanHoi?.error_code !== null && bc.thanPhanHoi?.error_code !== undefined;
  if (coMaZalo || coThanZalo) return NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC;

  return NHOM_LOI_A0.CHUA_PHAN_LOAI_DUOC;
}

/** Câu giải thích đi kèm `nhom_loi`, để không ai phải tra nghĩa ở chỗ khác. */
export function errorGroupMeaning(nhom) {
  switch (nhom) {
    case NHOM_LOI_A0.CHUA_CHAM_MANG:
      return 'Chưa có request nào rời khỏi tiến trình -> KHÔNG nói gì được về endpoint. '
        + 'ĐỪNG kết luận phương án A. Kiểm phiên rồi chạy lại.';
    case NHOM_LOI_A0.KHONG_KET_NOI_DUOC:
      return 'Bắn đi nhưng không nối được (DNS/TCP/timeout). Có thể chỉ là mạng lúc đó '
        + '-> chạy lại trước khi kết luận gì.';
    case NHOM_LOI_A0.ENDPOINT_CHET:
      return '🔴 ĐÂY LÀ ĐIỀU KIỆN DỪNG PHƯƠNG ÁN A: endpoint trả 404/410, đã bị gỡ.';
    case NHOM_LOI_A0.QUYEN_PHIEN:
      return 'Bị từ chối vì quyền/phiên (401/403) -> hướng khác hẳn: chữ ký, cookie, '
        + 'đăng nhập lại. KHÔNG phải endpoint chết.';
    case NHOM_LOI_A0.MAY_CHU_LOI:
      return 'Lỗi 5xx phía Zalo -> chạy lại lượt sau, chưa kết luận gì.';
    case NHOM_LOI_A0.THAM_SO_SAI_DA_CHUNG_MINH:
      return '🟢 ĐÃ CHỨNG MINH LÀ SAI THAM SỐ, không phải đoán: bộ tham số chuẩn hỏng '
        + 'nhưng lượt biến thể LẤY ĐƯỢC TIN THẬT. Sửa `buildApiParams()` theo `bien_the` rồi '
        + 'chạy lại A0. PHƯƠNG ÁN A VẪN SỐNG.';
    case NHOM_LOI_A0.ENDPOINT_SONG_LOI_GIAO_THUC:
      return '✅ ENDPOINT SỐNG (HTTP OK, Zalo trả đúng khuôn giao thức của nó, chỉ kèm '
        + 'error_code). ⇒ KHÔNG PHẢI nhóm "endpoint chết". Còn lại là THAM SỐ SAI hoặc '
        + 'QUYỀN — đọc `loi_ma` + `bien_the` để biết đi tiếp đường nào.';
    default:
      return 'Không đủ bằng chứng để xếp nhóm. Nói thẳng ra thay vì đoán bừa.';
  }
}

export function registerHistoryApi(api) {
  if (!api || typeof api.custom !== 'function') {
    _canhBao('api.custom không tồn tại -> không đăng ký được (zca-js quá cũ?)');
    return false;
  }
  if (typeof api[HISTORY_API_NAME] === 'function') return false;

  try {
    api.custom(HISTORY_API_NAME, async ({ ctx, utils, props }) => {
      const {
        groupId, conTro = null, soLuong = GIOI_HAN_QUET.SO_TIN_MOI_TRANG,
        so = null, bienThe = BIEN_THE_THAM_SO.CHUAN,
      } = props ?? {};

      // `api` lấy từ closure: callback của `api.custom()` CHỈ nhận
      // {ctx, utils, props} — không có `api`. Đây chính là lý do bản đầu quay
      // sang ctx rồi đọc nhầm thuộc tính.
      const base = cloudMessageBase(api, ctx);
      if (!base) {
        // Không bịa URL. Gọi tiếp chỉ tạo request rác vào một host bịa ra.
        throw new Error(
          'Không tìm thấy group_cloud_message ở CẢ HAI nguồn '
            + '(ctx.loginInfo.zpw_service_map_v3 và api.zpwServiceMap) '
            + '-> phiên Zalo chưa sẵn sàng, KHÔNG gọi mạng.',
        );
      }

      const thamSo = buildApiParams({ groupId, conTro, soLuong, imei: ctx.imei, bienThe });

      const mahoa = utils.encodeAES(JSON.stringify(thamSo));
      if (!mahoa) throw new Error('encodeAES trả rỗng — không mã hoá được tham số.');

      // 🔴 GỌI makeURL HAI LẦN, ĐÚNG NHƯ MỌI API CỦA zca-js làm:
      //   serviceURL = makeURL(path)              -> path?zpw_ver&zpw_type
      //   makeURL(serviceURL, { params })         -> …&params=…
      // Gọi một lần với {params} cho ra ĐỦ 3 tham số nhưng THỨ TỰ khác
      // (params đứng trước zpw_ver). Không ai đo được Zalo có xét thứ tự hay
      // không, nên bỏ nốt điểm lệch này cho khỏi phải nghi — nó KHÔNG tốn thêm
      // request nào, không như một biến thể.
      const url = utils.makeURL(
        utils.makeURL(`${base}/api/cm/getrecentv2`),
        { params: mahoa },
      );

      // ── TỪ ĐÂY TRỞ XUỐNG MỚI LÀ "CHẠM MẠNG" ────────────────────────────
      // 🔴 Cộng TRƯỚC khi bắn, không phải sau: request có thể ném (DNS/TCP) mà
      // vẫn là một lần đã chạm mạng thật.
      if (so) { so.soGoiMang += 1; so.bienThe = bienThe; }

      let res;
      try {
        res = await utils.request(url, { method: 'GET' });
      } catch (e) {
        if (so) so.loiKetNoi = String(e?.message ?? e).slice(0, 200);
        throw e;
      }
      if (so) {
        so.soPhanHoi += 1;
        so.httpMa = Number(res?.status) || null;
        so.httpOk = res?.ok ?? null;
      }

      // Nhân bản TRƯỚC khi utils.resolve nuốt mất thân (body đọc được đúng 1 lần).
      let ban = null;
      if (so && typeof res?.clone === 'function') {
        try { ban = res.clone(); } catch { ban = null; }
      }

      try {
        const d = await utils.resolve(res, (kq) => {
          let x = kq?.data;
          if (typeof x === 'string') x = JSON.parse(x);
          return x;
        });
        // Thành công thì bản sao vô dụng — trả luồng lại cho runtime.
        try { ban?.body?.cancel?.(); } catch { /* nuốt */ }
        return d;
      } catch (e) {
        // ★ CHỖ NÀY LÀ CẢ ĐIỂM MẤU CHỐT: Zalo trả HTTP 200 kèm error_code trong
        // THÂN, nên chỉ nhìn mã HTTP là không thấy gì. Đọc thân từ bản sao.
        if (so && ban) so.thanPhanHoi = await summarizeResponseBody(ban);
        throw e;
      }
    });
    return true;
  } catch (e) {
    _canhBao(`đăng ký ${HISTORY_API_NAME} thất bại: ${e?.message ?? e}`);
    return false;
  }
}

/**
 * Lấy lịch sử một nhóm, phân trang lùi về quá khứ.
 *
 * 🔴 BA ĐIỀU KIỆN DỪNG, thiếu cái nào cũng thành VÒNG LẶP VÔ HẠN gọi mạng:
 *   · `!hasMore`
 *   · không có con trỏ kế
 *   · con trỏ kế TRÙNG con trỏ hiện tại  ← ca Zalo trả cùng một trang mãi
 * Cộng thêm trần cứng `TRAN_MOI_LAN_QUET` — vòng lặp gọi mạng mà chỉ dựa vào
 * cờ của máy chủ để dừng thì máy chủ đổi hành vi là ta bắn tới khi bị khoá.
 *
 * `datTran` chạm ⇒ trả `cutTrang = true`. Tầng trên PHẢI thu hẹp biên kết luận
 * khi thấy cờ này, nếu không sẽ vu oan cho đúng những tin chưa lấy tới.
 *
 * @param {any} api
 * @param {string} groupId
 * @param {{tuMs?: number, tranGoi?: number, nghiMs?: number,
 *          nghi?: (ms: number) => Promise<void>}} [tuyChon]
 * @returns {Promise<{tin: any[], soGoi: number, cutTrang: boolean, minMsgId: string|null,
 *                    maxMsgId: string|null, minMsgIdTrangCuoiTron: string|null}>}
 */
export async function fetchGroupHistory(api, groupId, tuyChon = {}) {
  const tranGoi = tuyChon.tranGoi ?? GIOI_HAN_QUET.TRAN_MOI_LAN_QUET;
  const nghiMs = tuyChon.nghiMs ?? GIOI_HAN_QUET.NGHI_GIUA_2_REQUEST_MS;
  const nghi = tuyChon.nghi ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tuMs = tuyChon.tuMs ?? null;
  const so = tuyChon.so ?? null;
  const bienThe = tuyChon.bienThe ?? BIEN_THE_THAM_SO.CHUAN;
  // Con trỏ KHỞI ĐẦU. Bình thường là null (trang mới nhất). Biến thể
  // CON_TRO_THAT bơm vào đây một msg_id THẬT để thử thay cho số 0.
  const conTroDau = tuyChon.conTroDau ?? null;

  if (typeof api?.[HISTORY_API_NAME] !== 'function') {
    throw new Error(`Chưa đăng ký ${HISTORY_API_NAME} — gọi registerHistoryApi(api) trước.`);
  }

  /** @type {Map<string, any>} khử trùng NGAY trong vòng lặp, không để tới cuối */
  const theoId = new Map();
  let conTro = conTroDau;
  let soGoi = 0;
  let cutTrang = false;
  let minTrangTron = null;

  for (;;) {
    if (soGoi >= tranGoi) {
      cutTrang = true;
      break;
    }
    if (soGoi > 0) await nghi(nghiMs);

    let d;
    try {
      d = await api[HISTORY_API_NAME]({ groupId, conTro, so, bienThe });
      soGoi += 1;
    } catch (e) {
      // 🔴 SỬA SAI 20/08/2026 — bản cũ ghi `e.soGoi = soGoi + 1`, tức ĐẾM SỐ LẦN
      // GỌI HÀM chứ không phải số lần chạm mạng. Mọi lỗi xảy ra TRƯỚC khi bắn
      // request (thiếu base URL, encodeAES rỗng, props hỏng) đều bị đếm thành
      // "đã chạm mạng 1 lần" -> `co_bang_chung_ve_endpoint: true` -> đúng cái
      // kết luận "endpoint chết, dừng phương án A" mà file này sinh ra để chặn.
      // Con số thật giờ do `so.soGoiMang` giữ, cộng ngay trước `utils.request`.
      e.soGoi = so ? so.soGoiMang : 0;
      e.soLanThuGoi = soGoi + 1;
      e.chanDoan = so;
      throw e;
    }

    const ds = Array.isArray(d?.groupMsgs) ? d.groupMsgs : [];
    let minTrang = null;
    for (const m of ds) {
      const id = toId(m?.msgId ?? m?.globalMsgId ?? m?.data?.msgId, 'quet.msgId');
      if (id === null) continue;
      if (!theoId.has(id)) theoId.set(id, m);
      if (minTrang === null || _nhoHon(id, minTrang)) minTrang = id;
    }
    // Trang này đã lấy TRỌN (không bị trần cắt) ⇒ biên an toàn có thể xuống tới
    // đây. Ghi lại để tầng trên biết chỗ nào còn dám kết luận.
    if (minTrang !== null) minTrangTron = minTrang;

    const hasMore = d?.hasMore === true || d?.hasMore === 1;
    const ke = d?.lastMsgId === undefined || d?.lastMsgId === null ? null : String(d.lastMsgId);
    // Đã lùi quá xa so với cửa sổ cần quét ⇒ dừng, khỏi tốn request.
    const quaCuaSo =
      tuMs !== null && ds.length > 0 && ds.every((m) => Number(m?.ts ?? m?.timestamp ?? 0) < tuMs);

    if (!hasMore || !ke || ke === conTro || quaCuaSo) break;
    conTro = ke;
  }

  const ids = [...theoId.keys()];
  return {
    tin: [...theoId.values()],
    soGoi,
    cutTrang,
    minMsgId: ids.length ? ids.reduce((a, b) => (_nhoHon(a, b) ? a : b)) : null,
    maxMsgId: ids.length ? ids.reduce((a, b) => (_nhoHon(a, b) ? b : a)) : null,
    minMsgIdTrangCuoiTron: minTrangTron,
  };
}

/**
 * So sánh 2 msg_id dạng chuỗi bằng BigInt.
 *
 * 🔴 KHÔNG so chuỗi: msg_id lưu TEXT, mà so chuỗi thì '9' > '10'. Đo thật cho
 * thấy msg_id là đồng hồ toàn cục ~58 đơn vị/ms, tăng đơn điệu theo thời gian
 * ⇒ dùng làm biên khoảng thì phải so ĐÚNG THỨ TỰ SỐ.
 * 🔴 KHÔNG dùng Number: id Zalo vượt Number.MAX_SAFE_INTEGER, ép Number là mất
 * chính xác ÂM THẦM — hai id khác nhau thành bằng nhau.
 * Đây đúng cái bẫy số-vs-TEXT vừa dính ở `quote.globalMsgId`.
 *
 * @param {string} a
 * @param {string} b
 */
function _nhoHon(a, b) {
  try {
    return BigInt(a) < BigInt(b);
  } catch {
    return String(a) < String(b);
  }
}

export const _choTest = { _nhoHon };
