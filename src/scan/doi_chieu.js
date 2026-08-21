/**
 * ═══════════════════════════════════════════════════════════════════════
 * v3 — DÒ TIN THU HỒI BẰNG ĐỐI CHIẾU.
 *
 * 🔴 CÁI SAI PHẢI TRÁNH TRƯỚC KHI ĐỌC TIẾP: "thiếu msg_id ⇒ tin bị thu hồi"
 * là SAI HOÀN TOÀN. Đo thật 188 tin: msg_id là ĐỒNG HỒ TOÀN CỤC của Zalo
 * (~58 đơn vị/ms), hai tin cách nhau 2 giây đã có ~116.000 id trống — phần lớn
 * thuộc hội thoại của người khác trên toàn Zalo. Dò khoảng trống thì MỌI TIN
 * đều bị vu là đã thu hồi.
 *
 * ✅ Cách đúng: HIỆU TẬP HỢP với danh sách Zalo đang trả về.
 *      Z = msg_id Zalo trả về lần này   (hiện trạng)
 *      D = msg_id trong DB cùng nhóm    (thứ ta đã bắt được)
 *      BIÊN = [minMsgId(Z), maxMsgId(Z)]
 *      D ∩ BIÊN \ Z  -> ① nghi bị thu hồi
 *      Z \ D         -> ② chưa từng nhận  (BACKFILL — vá lỗ hổng lúc trợ lý chết)
 *      D \ BIÊN      -> ③ ngoài phạm vi, KHÔNG kết luận gì
 *
 * 🔴 THIÊN VỊ BỎ SÓT. Vu oan "người này đã thu hồi tin" nặng hơn hẳn bỏ sót.
 * Bốn chốt chặn, KHÔNG được bỏ bớt cái nào:
 *   1. Chỉ kết luận TRONG BIÊN. Trang cuối bị trần cắt ⇒ THU HẸP biên.
 *   2. Phải vắng mặt ở 2 LƯỢT QUÉT LIÊN TIẾP mới nâng lên SUY_RA.
 *   3. Bỏ qua tin mới < 60 giây (có thể đang đồng bộ).
 *   4. KHÔNG BAO GIỜ ghi đè bản ghi nguồn SU_KIEN (nghe được `undo` thật).
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  DO_TIN_CAY,
  GIOI_HAN_QUET,
  KET_QUA_QUET,
  NGUON_THU_HOI,
} from '../lib/hang_so.js';
import { toId } from '../lib/ids.js';

import {
  dangKyApiLichSu, layLichSuNhom, moTaLoi, phanNhomLoi, taoSoChanDoan,
} from './api_lichsu.js';

function _log(msg) {
  process.stderr.write(`[scan/doi_chieu] ${msg}\n`);
}

/** So sánh msg_id bằng BigInt — xem ghi chú dài ở api_lichsu.js. */
function _bi(x) {
  try {
    return BigInt(x);
  } catch {
    return null;
  }
}

/**
 * Trong khoảng [lo, hi] (bao gồm 2 đầu), so bằng BigInt.
 * Không ép được BigInt ⇒ trả false (fail-closed: không kết luận).
 */
export function trongBien(id, lo, hi) {
  const a = _bi(id);
  const l = _bi(lo);
  const h = _bi(hi);
  if (a === null || l === null || h === null) return false;
  return a >= l && a <= h;
}

/**
 * ★ HÀM THUẦN — trái tim của tính năng. Không mạng, không DB, test thẳng được.
 *
 * @param {{
 *   zIds: string[],                       // msg_id Zalo trả về
 *   dsDb: Array<{msgId: string, tsZalo: number, nguonHienTai?: string|null}>,
 *   bienMin: string|null,
 *   bienMax: string|null,
 *   bayGioMs: number,
 *   boQuaMoiHonMs?: number
 * }} p
 * @returns {{vangMat: string[], backfill: string[], soNgoaiBien: number, soTrongBien: number}}
 */
export function phanLoai(p) {
  const ra = { vangMat: [], backfill: [], soNgoaiBien: 0, soTrongBien: 0 };
  const boQua = p.boQuaMoiHonMs ?? GIOI_HAN_QUET.BO_QUA_TIN_MOI_HON_MS;
  const Z = new Set((p.zIds ?? []).map((x) => String(x)));

  // Không có biên ⇒ Zalo trả rỗng ⇒ TUYỆT ĐỐI không kết luận gì.
  // 🔴 Đây là ca nguy hiểm nhất của cả tính năng: một lần gọi mạng hỏng trả
  // danh sách rỗng, mà nếu coi rỗng là "hiện trạng" thì CẢ NHÓM bị đánh dấu
  // thu hồi trong một lượt. Chặn ngay tại đây, trước mọi vòng lặp.
  if (!p.bienMin || !p.bienMax) {
    for (const d of p.dsDb ?? []) if (!Z.has(String(d.msgId))) ra.soNgoaiBien += 1;
    return ra;
  }

  for (const d of p.dsDb ?? []) {
    const id = String(d.msgId);
    if (!trongBien(id, p.bienMin, p.bienMax)) {
      ra.soNgoaiBien += 1;      // ③ ngoài phạm vi quét
      continue;
    }
    ra.soTrongBien += 1;
    if (Z.has(id)) continue;    // vẫn còn -> bình thường

    // Chốt 4: đã CHẮC CHẮN bị thu hồi nhờ nghe sự kiện `undo` thì thôi, không
    // đụng nữa. Đối chiếu không được HẠ CẤP một kết luận chắc chắn.
    if (d.nguonHienTai === NGUON_THU_HOI.SU_KIEN) continue;

    // Chốt 3: tin quá mới có thể đang đồng bộ, chưa kịp lên cloud.
    if (p.bayGioMs - Number(d.tsZalo ?? 0) < boQua) continue;

    ra.vangMat.push(id);        // ① nghi bị thu hồi
  }

  const D = new Set((p.dsDb ?? []).map((d) => String(d.msgId)));
  for (const z of Z) if (!D.has(z)) ra.backfill.push(z);   // ② backfill

  return ra;
}

/**
 * Thu hẹp biên khi trang cuối bị trần cắt (chốt 1).
 *
 * Trần `TRAN_MOI_LAN_QUET` chạm ⇒ ta CHƯA lấy hết lịch sử trong cửa sổ. Những
 * tin cũ hơn trang cuối cùng đã lấy trọn thì ta không có quyền nói gì về
 * chúng — chúng vắng mặt chỉ vì ta chưa đọc tới, không phải vì bị thu hồi.
 *
 * @param {{cutTrang: boolean, minMsgId: string|null, maxMsgId: string|null,
 *          minMsgIdTrangCuoiTron: string|null}} kq
 * @returns {{bienMin: string|null, bienMax: string|null, daThuHep: boolean}}
 */
export function chotBien(kq) {
  if (!kq.cutTrang) {
    return { bienMin: kq.minMsgId, bienMax: kq.maxMsgId, daThuHep: false };
  }
  const min = kq.minMsgIdTrangCuoiTron ?? kq.minMsgId;
  return {
    bienMin: min,
    bienMax: kq.maxMsgId,
    daThuHep: min !== kq.minMsgId,
  };
}

/** Có nằm trong giờ yên (không quét) không? */
export function trongGioYen(bayGioMs, gioYen = GIOI_HAN_QUET.QUET_GIO_YEN) {
  const h = new Date(bayGioMs).getHours();
  const [tu, den] = gioYen;
  return tu <= den ? h >= tu && h < den : h >= tu || h < den;
}

/**
 * Nhóm nào CÓ TIN trong cửa sổ ⇒ mới cần quét.
 *
 * 🔴 CẮT TỈA QUAN TRỌNG NHẤT VỀ CHI PHÍ: nhóm im lìm thì không tồn tại tin nào
 * còn quyền bị thu hồi ⇒ 0 request. Suy trực tiếp từ ràng buộc "chỉ thu hồi
 * được trong 1 giờ", không phải mẹo. Kiểm bằng 1 câu SQL cục bộ, KHÔNG gọi mạng.
 *
 * @param {any} db
 * @param {number} tuMs
 * @returns {string[]}
 */
export function nhomCanQuet(db, tuMs) {
  return db
    .prepare(
      `SELECT DISTINCT t.chat_id
         FROM tin_nhan t
         JOIN hoi_thoai h ON h.chat_id = t.chat_id AND h.duoc_nghe = 1
        WHERE h.loai = 'GROUP' AND t.ts_zalo >= $tu`,
    )
    .all({ tu: Math.floor(tuMs) })
    .map((r) => String(r.chat_id));
}

/**
 * Tin trong DB thuộc cửa sổ, kèm nguồn thu hồi hiện tại (để thi hành chốt 4).
 * @param {any} db
 * @param {string} chatId
 * @param {number} tuMs
 */
export function tinTrongCuaSo(db, chatId, tuMs) {
  return db
    .prepare(
      `SELECT msg_id, ts_zalo, thu_hoi_nguon, vang_mat_so_lan
         FROM tin_nhan WHERE chat_id = $c AND ts_zalo >= $tu`,
    )
    .all({ c: String(chatId), tu: Math.floor(tuMs) })
    .map((r) => ({
      msgId: String(r.msg_id),
      tsZalo: Number(r.ts_zalo ?? 0),
      nguonHienTai: r.thu_hoi_nguon ?? null,
      vangMatSoLan: Number(r.vang_mat_so_lan ?? 0),
    }));
}

/**
 * Áp kết quả phân loại vào DB — nơi thi hành CHỐT 2 (xác nhận 2 lượt).
 *
 * Ba đường ghi:
 *  · vắng lần đầu   -> vang_mat_so_lan = 1, do_tin_cay = NGHI_NGO, CHƯA đánh
 *                      dấu `da_thu_hoi` (chưa đủ chắc để nói ra)
 *  · vắng đủ số lần -> da_thu_hoi = 1, nguon = DOI_CHIEU, do_tin_cay = SUY_RA
 *  · xuất hiện lại  -> XOÁ dấu nghi ngờ. Quan trọng: một lần mạng hỏng làm tin
 *                      "vắng" rồi lượt sau thấy lại thì phải quên đi, nếu không
 *                      bộ đếm cứ cộng dồn qua nhiều ngày và cuối cùng vu oan.
 *
 * @param {any} db
 * @param {{chatId: string, vangMat: string[], hienDien: string[], bayGioIso: string,
 *          quetTruocMs: number|null, bayGioMs: number, soLanCanThiet?: number}} p
 * @returns {{soNghiNgo: number, soXacNhan: number, soXoaNghi: number}}
 */
export function apKetQua(db, p) {
  const can = p.soLanCanThiet ?? GIOI_HAN_QUET.SO_LAN_VANG_DE_KET_LUAN;
  const ra = { soNghiNgo: 0, soXacNhan: 0, soXoaNghi: 0 };

  const doc = db.prepare(
    'SELECT vang_mat_so_lan, thu_hoi_nguon FROM tin_nhan WHERE chat_id = $c AND msg_id = $m',
  );
  const ghiNghi = db.prepare(
    `UPDATE tin_nhan SET vang_mat_so_lan = $n, vang_mat_lan_dau = COALESCE(vang_mat_lan_dau, $iso),
            thu_hoi_do_tin_cay = $tc
      WHERE chat_id = $c AND msg_id = $m`,
  );
  const ghiXacNhan = db.prepare(
    `UPDATE tin_nhan SET vang_mat_so_lan = $n, da_thu_hoi = 1,
            thu_hoi_nguon = $nguon, thu_hoi_do_tin_cay = $tc
      WHERE chat_id = $c AND msg_id = $m AND thu_hoi_nguon IS NOT 'SU_KIEN'`,
  );
  const xoaNghi = db.prepare(
    `UPDATE tin_nhan SET vang_mat_so_lan = 0, vang_mat_lan_dau = NULL,
            thu_hoi_do_tin_cay = NULL
      WHERE chat_id = $c AND msg_id = $m AND vang_mat_so_lan > 0
        AND thu_hoi_nguon IS NOT 'SU_KIEN'`,
  );
  const ghiSuKien = db.prepare(
    `INSERT OR IGNORE INTO su_kien_thu_hoi
       (event_id, chat_id, msg_id_dich, cli_msg_id_dich, nguoi_thu_hoi,
        ten_nguoi_thu_hoi, ts_zalo, ts_ghi, khop_duoc, nguon, khoang_tu_ms, khoang_den_ms)
     VALUES ($e, $c, $m, NULL, $boi, NULL, $ts, $iso, 1, $nguon, $tu, $den)`,
  );
  // Người thu hồi SUY RA ĐƯỢC CHẮC CHẮN: Zalo chỉ cho thu hồi tin của CHÍNH
  // MÌNH ⇒ người thu hồi chính là người đã gửi tin đó. Đọc thẳng từ DB, không đoán.
  const layNguoiGui = db.prepare(
    'SELECT user_id FROM tin_nhan WHERE chat_id = $c AND msg_id = $m',
  );

  for (const m of p.vangMat) {
    const cu = doc.get({ c: p.chatId, m });
    if (!cu) continue;
    if (cu.thu_hoi_nguon === NGUON_THU_HOI.SU_KIEN) continue;   // chốt 4
    const n = Number(cu.vang_mat_so_lan ?? 0) + 1;
    if (n < can) {
      ghiNghi.run({ c: p.chatId, m, n, iso: p.bayGioIso, tc: DO_TIN_CAY.NGHI_NGO });
      ra.soNghiNgo += 1;
      continue;
    }
    ghiXacNhan.run({
      c: p.chatId, m, n,
      nguon: NGUON_THU_HOI.DOI_CHIEU,
      tc: DO_TIN_CAY.SUY_RA,
    });
    ghiSuKien.run({
      // Không có event_id thật (không nghe được sự kiện nào) ⇒ khoá tự dựng,
      // có tiền tố `dc:` để nhìn là biết ngay dòng này do đối chiếu sinh ra.
      e: `dc:${p.chatId}:${m}`,
      c: p.chatId,
      m,
      boi: layNguoiGui.get({ c: p.chatId, m })?.user_id ?? null,
      // ⚠️ ts_zalo ở đây là LÚC QUÉT, KHÔNG phải lúc thu hồi. Thứ ta biết thật
      // nằm ở cặp khoang_tu_ms/khoang_den_ms ngay dưới.
      ts: p.bayGioMs,
      iso: p.bayGioIso,
      nguon: NGUON_THU_HOI.DOI_CHIEU,
      tu: p.quetTruocMs ?? null,
      den: p.bayGioMs,
    });
    ra.soXacNhan += 1;
  }

  for (const m of p.hienDien) {
    const kq = xoaNghi.run({ c: p.chatId, m });
    if (Number(kq.changes) > 0) ra.soXoaNghi += 1;
  }
  return ra;
}

/** Ghi một dòng nhật ký quét. */
export function ghiNhatKyQuet(db, r) {
  db.prepare(
    `INSERT INTO doi_chieu_lich_su
       (chat_id, ts_bat_dau, ts_ket_thuc, cua_so_tu_ms, cua_so_den_ms,
        bien_min_msg_id, bien_max_msg_id, so_tin_zalo, so_tin_db, so_nghi_ngo,
        so_xac_nhan, so_backfill, so_goi_mang, ket_qua, ghi_chu)
     VALUES ($chat_id, $ts_bat_dau, $ts_ket_thuc, $cua_so_tu_ms, $cua_so_den_ms,
             $bien_min, $bien_max, $so_tin_zalo, $so_tin_db, $so_nghi_ngo,
             $so_xac_nhan, $so_backfill, $so_goi_mang, $ket_qua, $ghi_chu)`,
  ).run({
    chat_id: String(r.chatId),
    ts_bat_dau: r.tsBatDau,
    ts_ket_thuc: r.tsKetThuc,
    cua_so_tu_ms: Math.floor(r.cuaSoTuMs),
    cua_so_den_ms: Math.floor(r.cuaSoDenMs),
    bien_min: r.bienMin ?? null,
    bien_max: r.bienMax ?? null,
    so_tin_zalo: r.soTinZalo | 0,
    so_tin_db: r.soTinDb | 0,
    so_nghi_ngo: r.soNghiNgo | 0,
    so_xac_nhan: r.soXacNhan | 0,
    so_backfill: r.soBackfill | 0,
    so_goi_mang: r.soGoiMang | 0,
    ket_qua: String(r.ketQua),
    ghi_chu: r.ghiChu ?? null,
  });
}

/** Đếm số request đã tiêu trong NGÀY HÔM NAY (theo giờ máy). */
export function soGoiTrongNgay(db, bayGioMs) {
  const d = new Date(bayGioMs);
  const dau = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  const r = db
    .prepare('SELECT COALESCE(SUM(so_goi_mang), 0) s FROM doi_chieu_lich_su WHERE ts_ket_thuc >= $d')
    .get({ d: dau });
  return Number(r?.s ?? 0);
}

/**
 * Một LƯỢT quét đầy đủ (mọi nhóm cần quét).
 *
 * @param {{db: any, api: any, bayGioMs?: number, tranNgay?: number,
 *          baoHost?: (s: string) => void, nghi?: (ms: number) => Promise<void>}} p
 * @returns {Promise<{daQuet: number, boQua: string|null, tong: object}>}
 */
export async function quetMotLuot(p) {
  const bayGio = p.bayGioMs ?? Date.now();
  const tong = { soNghiNgo: 0, soXacNhan: 0, soBackfill: 0, soGoiMang: 0, soNhom: 0 };

  if (trongGioYen(bayGio)) return { daQuet: 0, boQua: 'GIO_YEN', tong };

  const tranNgay = p.tranNgay ?? GIOI_HAN_QUET.TRAN_MOI_NGAY;
  const daTieu = soGoiTrongNgay(p.db, bayGio);
  if (daTieu >= tranNgay) {
    // Chạm trần ⇒ NGỪNG tới nửa đêm và BÁO HOST. Im lặng dừng là tệ nhất: tính
    // năng chết mà không ai biết, rồi tưởng "không có tin nào bị thu hồi".
    p.baoHost?.(
      `Đối chiếu thu hồi đã dùng ${daTieu}/${tranNgay} request hôm nay -> NGỪNG quét tới nửa đêm.`,
    );
    return { daQuet: 0, boQua: 'TRAN_NGAY', tong };
  }

  const tuMs = bayGio - GIOI_HAN_QUET.CUA_SO_QUET_MS;
  const ds = nhomCanQuet(p.db, tuMs);
  tong.soNhom = ds.length;
  if (ds.length === 0) return { daQuet: 0, boQua: 'KHONG_CO_NHOM_HOAT_DONG', tong };

  dangKyApiLichSu(p.api);

  for (const chatId of ds) {
    if (daTieu + tong.soGoiMang >= tranNgay) {
      p.baoHost?.(`Chạm trần ${tranNgay} request/ngày giữa lượt quét -> dừng.`);
      break;
    }
    const tsBatDau = new Date().toISOString();
    let kq = null;
    // Sổ chẩn đoán RIÊNG cho từng nhóm: gộp chung thì lỗi của nhóm này bị đọc
    // thành lỗi của nhóm kia.
    const so = taoSoChanDoan();
    try {
      kq = await layLichSuNhom(p.api, chatId, { tuMs, nghi: p.nghi, so });
    } catch (e) {
      // 🔴 CÙNG CĂN BỆNH VỚI A0 (sửa 20/08/2026): bản cũ ghi đúng một chuỗi
      // `e.message` vào nhật ký. Với ZaloApiError thì chuỗi đó là error_message
      // của máy chủ — hay gặp nhất là "Lỗi không xác định", tức nhật ký quét
      // ghi lại một câu KHÔNG NÓI GÌ CẢ. Thứ phân biệt được nguyên nhân là
      // `e.code` + mã HTTP, nên phải ghi kèm.
      const mo = moTaLoi(e);
      const nhom = phanNhomLoi({
        soGoiMang: so.soGoiMang, loiKetNoi: so.loiKetNoi,
        httpMa: so.httpMa, loiMa: mo.loi_ma, thanPhanHoi: so.thanPhanHoi,
      });
      // Trần NGÀY đếm theo LƯỢT THỬ, cố ý dè dặt: một lỗi lặp trước cả lúc bắn
      // request mà tính 0 thì vòng quét chạy tự do, đúng thứ làm tài khoản bị
      // gắn cờ. Nhật ký bên dưới vẫn ghi con số THẬT.
      tong.soGoiMang += Math.max(1, so.soGoiMang);
      ghiNhatKyQuet(p.db, {
        chatId, tsBatDau, tsKetThuc: new Date().toISOString(),
        cuaSoTuMs: tuMs, cuaSoDenMs: bayGio,
        bienMin: null, bienMax: null, soTinZalo: 0, soTinDb: 0,
        soNghiNgo: 0, soXacNhan: 0, soBackfill: 0, soGoiMang: so.soGoiMang,
        ketQua: KET_QUA_QUET.LOI_MANG,
        ghiChu: `[${nhom}] ${mo.loi}`
          + (mo.loi_ma === null || mo.loi_ma === undefined ? '' : ` | ma=${mo.loi_ma}`)
          + (so.httpMa ? ` | http=${so.httpMa}` : '')
          + ` | da_ban=${so.soGoiMang}`,
      });
      _log(`quét ${chatId} lỗi [${nhom}]: ${mo.loi}`);
      continue;
    }

    tong.soGoiMang += kq.soGoi;
    const bien = chotBien(kq);
    const dsDb = tinTrongCuaSo(p.db, chatId, tuMs);
    const zIds = kq.tin
      .map((m) => toId(m?.msgId ?? m?.globalMsgId ?? m?.data?.msgId, 'quet.z'))
      .filter(Boolean);

    const pl = phanLoai({ zIds, dsDb, bienMin: bien.bienMin, bienMax: bien.bienMax, bayGioMs: bayGio });
    const hienDien = dsDb
      .map((d) => d.msgId)
      .filter((m) => zIds.includes(m));

    const quetTruoc = _lanQuetTruoc(p.db, chatId);
    const ap = apKetQua(p.db, {
      chatId,
      vangMat: pl.vangMat,
      hienDien,
      bayGioIso: new Date(bayGio).toISOString(),
      bayGioMs: bayGio,
      quetTruocMs: quetTruoc,
    });

    tong.soNghiNgo += ap.soNghiNgo;
    tong.soXacNhan += ap.soXacNhan;
    tong.soBackfill += pl.backfill.length;

    ghiNhatKyQuet(p.db, {
      chatId, tsBatDau, tsKetThuc: new Date().toISOString(),
      cuaSoTuMs: tuMs, cuaSoDenMs: bayGio,
      bienMin: bien.bienMin, bienMax: bien.bienMax,
      soTinZalo: zIds.length, soTinDb: pl.soTrongBien,
      soNghiNgo: ap.soNghiNgo, soXacNhan: ap.soXacNhan,
      soBackfill: pl.backfill.length, soGoiMang: kq.soGoi,
      ketQua: kq.cutTrang ? KET_QUA_QUET.CUT_TRANG : KET_QUA_QUET.OK,
      ghiChu: bien.daThuHep ? 'trần cắt trang -> đã THU HẸP biên kết luận' : null,
    });
  }

  return { daQuet: ds.length, boQua: null, tong };
}

/** Mốc kết thúc của lượt quét TRƯỚC cho nhóm này — cận dưới của khoảng thu hồi. */
function _lanQuetTruoc(db, chatId) {
  try {
    const r = db
      .prepare(
        `SELECT cua_so_den_ms FROM doi_chieu_lich_su
          WHERE chat_id = $c ORDER BY id DESC LIMIT 1`,
      )
      .get({ c: String(chatId) });
    return r ? Number(r.cua_so_den_ms) : null;
  } catch {
    return null;
  }
}

/** Cờ bật/tắt — MẶC ĐỊNH TẮT. A0 chưa xanh thì không được tự chạy. */
export function batQuet(env = process.env) {
  return String(env?.ZTL_QUET_DOI_CHIEU ?? '') === '1';
}
