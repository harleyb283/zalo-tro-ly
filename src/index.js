/**
 * ═══════════════════════════════════════════════════════════════════════
 * G8 — WIRING. CHỦ SỞ HỮU: G8. Gói khác KHÔNG sửa file này.
 * Đây là gói DUY NHẤT import mọi module — ai cũng sửa thì mọi gói đụng nhau.
 *
 * THỨ TỰ KHỞI ĐỘNG (thiết kế 5.1) — KHÔNG ĐẢO:
 *   ① pid-lock          — có tiến trình khác giữ ⇒ THOÁT NGAY (2 bản cùng ghi DB = hỏng)
 *   ② validate config   — wildcard / thiếu hosts ⇒ TỪ CHỐI CHẠY
 *   ③ mở DB + migrate
 *   ④ login bằng COOKIE — hỏng ⇒ health=CAN_QR, báo host, THOÁT mã 3
 *   ⑤ ẩn trạng thái
 *   ⑥ gắn 4 listener
 *   ⑦ keepAlive mỗi keepAliveMs
 *   ⑧ watchdog mỗi watchdogMs
 *   ⑨ nối stdio MCP + đẩy bù hàng đợi 'cho'
 *
 * 🔴 KHÔNG BAO GIỜ tự mở QR trong tiến trình nền — không có ai đứng đó quét.
 *    QR chỉ đi qua `bin/zalo-login.js` chạy tay.
 *
 * 🔴 LUỒNG TIN — THỨ TỰ TUYỆT ĐỐI KHÔNG ĐẢO:
 *       listener → normalize → store GHI TRƯỚC (mọi tin) → gate → notify
 *    `notify` là best-effort và KHÔNG BAO GIỜ raise. Notify trước rồi mới ghi
 *    thì phiên Claude chết là MẤT TIN THẬT — mà tin thật thì không lấy lại
 *    được (`getGroupChatHistory` của zca-js đang 404).
 *
 * ⚠️ Cờ `--khong-mcp`: bỏ hẳn tầng MCP, chạy như daemon ghi lịch sử thuần
 *    (thoả spec F — trình quản lý pane và Claude đều là TUỲ CHỌN).
 * ⛔ stdout là kênh giao thức MCP ⇒ MỌI log đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ensureParentDir, expandPath } from './lib/paths.js';
import {
  CHE_DO, resolveRunMode, GIAN_CHO_MO_PANE_MS, HAN_MO_PHIEN_MS, HANH_DONG_GATE,
  LOAI_HOI_THOAI, SU_KIEN,
  TRANG_THAI_GUI, TRANG_THAI_HANG_DOI, TRANG_THAI_SUC_KHOE,
} from './lib/hang_so.js';
import { toId } from './lib/ids.js';
import { safeLogText } from './lib/redact.js';

import { readConfig, configPath, findGroup, findHostByDm } from './policy/access.js';
import { decideGate } from './policy/gate.js';
import { findGate2Task } from './store/query.js';
import { sweepStale, recordSources, createSourceLedger } from './policy/leak_guard.js';

import { closeDb, openDb } from './store/db.js';
import {
  updateQueueState,
  markRecalled,
  writeReaction,
  writeGroupEvent,
  writeMessage,
  takePendingQueue,
  claimQuestion,
  enqueueQuestion,
  upsertConversation,
  upsertPerson,
} from './store/write.js';

import { startListening, stopListening } from './zalo/listener.js';
import { applyHiddenStatus, loginWithCookie, keepAlive } from './zalo/session.js';
import { createWatchdog } from './zalo/watchdog.js';

import { writeHealth } from './ops/health.js';
import { notifyHost } from './ops/notify_host.js';
import { createPaneLedger } from './ops/pane_ledger.js';
import { createHotReloader } from './ops/hot_reload.js';
import {
  decideRetry, readyToRetry, byteCapFor, deadLetterMessage,
} from './ops/send_retry.js';
import { newGroupHostMessage, decideNewGroup, addGroupToConfig } from './ops/new_group.js';
import {
  RESCUE_TICK_MS, MAX_RESCUE_ATTEMPTS, ORPHAN_AGE_MS, UNCLAIMED_AGE_MS, createRescueLedger,
} from './ops/rescue_orphans.js';

/** @typedef {import('./types.d.ts').CauHinh} CauHinh */
/** @typedef {import('./types.d.ts').TinChuanHoa} TinChuanHoa */

export const EXIT_CODE = Object.freeze({
  OK: 0,
  LOI_CHUNG: 1,
  CAU_HINH_SAI: 2,
  CAN_QR: 3,
  DANG_CHAY_ROI: 4,
});

const TEN_SERVER = 'zalo-tro-ly';
const PHIEN_BAN = '0.1.0';

function log(msg) {
  // ⛔ KHÔNG console.log — stdout là kênh giao thức MCP.
  process.stderr.write(`[index] ${msg}\n`);
}

// ═══════════════════════════════════════════════════════════════════════
// ① PID-LOCK
// ═══════════════════════════════════════════════════════════════════════

/**
 * Khoá theo file PID. Node KHÔNG có `flock` built-in (`fs.flock` không tồn
 * tại, `proper-lockfile` là gói ngoài — Rule 2 cấm cài thêm), nên dùng đúng
 * nguyên lý của flock bằng thứ POSIX bảo đảm: `open(..., 'wx')` là thao tác
 * TẠO-ĐỘC-QUYỀN, nguyên tử ở tầng hệ điều hành.
 *
 * 🔴 Chỉ `wx` thì chưa đủ: máy sập giữa chừng để lại file khoá mồ côi và lần
 * sau KHÔNG bao giờ khởi động được nữa. Nên khoá cũ phải được kiểm bằng
 * `process.kill(pid, 0)` — tín hiệu 0 không giết ai, chỉ hỏi "pid này còn
 * sống không". Chết rồi ⇒ dọn khoá và giành lại; còn sống ⇒ TỪ CHỐI.
 *
 * @param {string} duongDan
 * @returns {{nha: () => void, pid: number}}
 */
export function acquirePidLock(duongDan) {
  const p = expandPath(duongDan);
  ensureParentDir(p);

  for (let lan = 0; lan < 2; lan += 1) {
    try {
      const fd = fs.openSync(p, 'wx', 0o600);
      fs.writeFileSync(fd, String(process.pid), { encoding: 'utf8' });
      fs.closeSync(fd);
      let daNha = false;
      return {
        pid: process.pid,
        nha() {
          if (daNha) return;
          daNha = true;
          try {
            // Chỉ xoá nếu khoá vẫn là CỦA MÌNH — tránh xoá nhầm khoá của
            // tiến trình khác vừa giành được sau khi mình đã chết dở.
            if (fs.readFileSync(p, 'utf8').trim() === String(process.pid)) fs.unlinkSync(p);
          } catch {
            /* nuốt: lúc tắt máy thì không còn gì để cứu */
          }
        },
      };
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      const cu = Number(String(fs.readFileSync(p, 'utf8')).trim());
      if (Number.isInteger(cu) && cu > 0 && _conSong(cu)) {
        const loi = new Error(
          `Đã có tiến trình trợ lý đang chạy (pid ${cu}), khoá tại ${p}.\n  ` +
            'Hai bản cùng ghi một DB và cùng nghe một websocket là hỏng dữ liệu — TỪ CHỐI chạy.',
        );
        // @ts-ignore
        loi.maThoat = EXIT_CODE.DANG_CHAY_ROI;
        throw loi;
      }
      log(`dọn khoá mồ côi của pid ${cu} (tiến trình đó đã chết)`);
      try {
        fs.unlinkSync(p);
      } catch {
        /* ai đó vừa dọn hộ */
      }
    }
  }
  throw new Error(`Không giành được khoá ${p} sau 2 lần thử`);
}

function _conSong(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = tiến trình CÓ TỒN TẠI nhưng khác user. Coi là còn sống —
    // suy thành "chết" là mở đường cho hai bản chạy song song.
    return e?.code === 'EPERM';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LUỒNG TIN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Gắn xử lý cho 5 sự kiện nội bộ.
 *
 * 🔴 Mỗi handler tự bọc try/catch: `boPhat.emit()` chạy đồng bộ, lỗi ở đây
 * nổ ngược lên callback của websocket và giết cả tiến trình vì MỘT tin.
 *
 * @param {{boPhat: EventEmitter, db: any, cauHinh: CauHinh,
 *          guiThongBao: ((p: any) => Promise<boolean>)|null,
 *          tenHoiThoai: (chatId: string) => string|null,
 *          tuCauHinhNhomMoi?: (sk: any) => void}} p
 */
export function attachMessageHandlers(p) {
  const { boPhat, db, cauHinh } = p;

  boPhat.on(SU_KIEN.TIN_NHAN, (tin) => {
    try {
      handleMessage(p, tin);
    } catch (e) {
      log(`xử lý tin thất bại (đã nuốt): ${safeLogText(e)}`);
    }
  });

  boPhat.on(SU_KIEN.THU_HOI, (sk) => {
    try {
      const kq = markRecalled(db, sk);
      if (!kq.khopDuoc) {
        // Ghi log to: đây là thước đo nghiệm thu M2 (`matched = 0` = mồ côi).
        log(`⚠️ thu hồi ${sk?.eventId} KHÔNG ghép được vào tin nào (mồ côi)`);
      } else if (kq.ghepBang === 'cli_msg_id') {
        log(`⚠️ thu hồi ${sk?.eventId} phải ghép bù bằng cli_msg_id — đường ghép CHÍNH đang hỏng`);
      }
    } catch (e) {
      log(`ghi thu hồi thất bại (đã nuốt): ${safeLogText(e)}`);
    }
  });

  boPhat.on(SU_KIEN.REACTION, (r) => {
    try {
      writeReaction(db, r);
    } catch (e) {
      log(`ghi reaction thất bại (đã nuốt): ${safeLogText(e)}`);
    }
  });

  boPhat.on(SU_KIEN.SU_KIEN_NHOM, (sk) => {
    try {
      writeGroupEvent(db, sk);
    } catch (e) {
      log(`ghi sự kiện nhóm thất bại (đã nuốt): ${safeLogText(e)}`);
    }
    // ═══ 🔴 TRỢ LÝ VỪA BỊ THÊM VÀO NHÓM MỚI -> TỰ CẤU HÌNH ═══
    // ⚠️ Chạy SAU khi đã ghi sự kiện: dù nhánh tự-cấu-hình có ném thì sự kiện
    // vẫn nằm trong kho, ⛔ không mất dấu vết.
    // ⚠️ `p.tuCauHinhNhomMoi` chỉ được nối ở DAEMON — client ⛔ không sửa config
    // (hai tiến trình cùng ghi một file là hỏng file).
    try {
      p.tuCauHinhNhomMoi?.(sk);
    } catch (e) {
      log(`tự cấu hình nhóm mới thất bại (đã nuốt): ${safeLogText(e)}`);
    }
  });

  // `SU_KIEN.LOI` = 'loi' chứ không phải 'error' — EventEmitter NÉM khi
  // emit('error') mà không ai nghe. Vẫn phải có người nghe cho tử tế.
  boPhat.on(SU_KIEN.LOI, (e) => log(`listener báo lỗi: ${safeLogText(e)}`));

  // Không có handler nào cho `cauHinh` ở đây — nó đi theo `p` vào handleMessage.
  void cauHinh;
}

/**
 * ★ ĐƯỜNG NÓNG. Thứ tự trong hàm này là hợp đồng của cả hệ.
 * @param {any} p
 * @param {TinChuanHoa} tin
 */
export function handleMessage(p, tin) {
  const { db, cauHinh } = p;
  const chatId = toId(tin?.chatId, 'index.chatId');
  if (chatId === null) {
    log('tin không có chatId -> bỏ qua');
    return;
  }

  const nhom = findGroup(cauHinh, chatId);
  const hostDm = findHostByDm(cauHinh, chatId);

  // ── ① GHI DB TRƯỚC — luôn luôn, mọi tin ───────────────────────────
  // `listened` = có trong allowlist (khớp đúng chú thích cột trong
  // schema.sql). Nhóm lạ VẪN được lưu lịch sử (spec: "âm thầm lưu toàn bộ
  // lịch sử chat của các nhóm nó được add vào") nhưng `listened = 0` nên
  // tầng đọc không trả ra — fail-closed, đúng hướng.
  try {
    upsertConversation(db, {
      chatId,
      loai: hostDm ? LOAI_HOI_THOAI.DM : nhom ? LOAI_HOI_THOAI.GROUP : LOAI_HOI_THOAI.UNKNOWN,
      ten: nhom?.ten ?? hostDm?.ten ?? null,
      duocNghe: Boolean(nhom || hostDm),
    });
    if (tin.userId) {
      upsertPerson(db, {
        userId: tin.userId,
        tenHienThi: tin.tenLucGui ?? null,
        isHost: (cauHinh.hosts ?? []).some((h) => h.userId === tin.userId),
      });
    }
    // Nhóm khai `ghiLichSu: false` là chỗ DUY NHẤT được phép không ghi —
    // đó là lựa chọn có chủ đích của người dùng, không phải lỗi.
    if (nhom?.ghiLichSu === false) {
      log(`nhóm ${chatId} có ghiLichSu=false -> nghe nhưng KHÔNG ghi DB`);
    } else {
      writeMessage(db, tin);
    }
  } catch (e) {
    // Ghi hỏng thì vẫn phải chạy tiếp xuống gate: mất một dòng lịch sử còn
    // hơn mất luôn khả năng trả lời anh.
    log(`GHI DB THẤT BẠI cho tin ${tin?.msgId} (vẫn đi tiếp): ${safeLogText(e)}`);
  }

  // ── ② GATE ────────────────────────────────────────────────────────
  // ═══ 🔴 v10 — CỬA 2: tra DB TRƯỚC khi hỏi gate ═══
  // ⚠️ Chỉ tra khi tin đến từ NGƯỜI KHÁC HOST và ở trong một nhóm đã duyệt —
  // host thì đã có quyền đầy đủ, nhóm lạ thì gate drop ngay. Nhóm bận 449
  // tin/ngày mà tra vô điều kiện là 449 truy vấn thừa mỗi ngày cho mỗi nhóm.
  // ⚠️ Tra hỏng ⇒ coi như cửa 2 ĐÓNG (fail-closed), ⛔ không được ném: mất một
  // lượt đáp lịch sự còn hơn mở cửa vì một lỗi đọc DB.
  let boiCanhCua2;
  if (nhom && tin.userId && !(cauHinh.hosts ?? []).some((h) => h.userId === tin.userId)) {
    try {
      const viec = findGate2Task(db, chatId, tin.userId);
      if (viec) boiCanhCua2 = { idViecMoCua: viec.id, noiDungViec: viec.noiDung };
    } catch (e) {
      log(`cửa 2: không tra được lời nhắc (COI NHƯ ĐÓNG): ${safeLogText(e)}`);
    }
  }
  const kq = decideGate(tin, cauHinh, boiCanhCua2);
  // ═══ 🔴 v9 — BA KẾT QUẢ, KHÔNG CÒN HAI ═══
  //   'drop'  -> không tỉnh (bốn nhánh đã liệt kê trong gate.js)
  //   'nghe'  -> tỉnh, ⛔ KHÔNG được nói ra Zalo, ⛔ không được chạy tool ghi
  //   'allow' -> tỉnh và được nói (y hệt hôm nay)
  // ⚠️ Viết `!== 'allow'` ở đây là xoá sạch việc vừa làm — lượt nghe sẽ bị vứt
  // đúng như trước v9, mà không một lỗi nào nổ ra.
  if (kq.action === HANH_DONG_GATE.DROP) return;
  const chiNghe = kq.action === HANH_DONG_GATE.NGHE;

  // ── ③ Mở phiên + NOTIFY (best-effort, KHÔNG BAO GIỜ raise) ────────
  const requestId = randomUUID();
  try {
    enqueueQuestion(db, {
      requestId,
      chatIdHoi: chatId,
      msgId: tin.msgId,
      userId: tin.userId ?? '',
      noiDung: tin.noiDung ?? '',
      tsTao: new Date().toISOString(),
      // 🔴 Cờ này là thứ DUY NHẤT phân biệt lượt nghe với lượt được nói ở phía
      // model. Nó nằm trên ĐĨA chứ không trong RAM vì lượt được nhặt bởi một
      // TIẾN TRÌNH KHÁC (client) — RAM của daemon nó không thấy.
      chiNghe,
      // v10 — CỬA 2. ⚠️ `chiNghe` VẪN = 1 khi cửa 2 mở: người gửi vẫn không
      // phải host, nên mọi chốt chặn tool GHI tiếp tục áp. Cột này chỉ nới ra
      // hai tool NÓI. Lấy từ payload của GATE, ⛔ không lấy lại từ biến trên —
      // gate là chỗ DUY NHẤT quyết định, đọc chỗ khác là có hai nguồn sự thật.
      idViecMoCua: kq.payload?.idViecMoCua ?? null,
    });
  } catch (e) {
    log(`không mở được hàng đợi cho ${requestId} (bỏ lượt này): ${safeLogText(e)}`);
    return;
  }

  // ═══ 🔴 v10.2 — PANEL-MỖI-NHÓM: bảo đảm nhóm này có phiên riêng ═══
  // ⚠️ FIRE-AND-FORGET CÓ CHỦ Ý, ⛔ KHÔNG `await`. Lệnh mở pane do NGƯỜI VẬN
  // HÀNH viết, pack ⛔ không biết nó làm gì và nó có thể treo. `await` ở đây là
  // giữ luôn callback của websocket ⇒ **mọi nhóm câm**, không riêng nhóm đang
  // mở pane. Trần thời gian nằm trong `runNotifyCommand` (đã có sẵn).
  // ⚠️ Đặt SAU khi `enqueueQuestion` thành công: mở pane cho một dòng chưa tồn tại
  // là mở cho một câu hỏi đã mất.
  // ⚠️ `soMoPhien` vắng ⇒ ⛔ không làm gì — đúng đường một-tiến-trình hôm nay.
  // ═══ 🔴 v11 — CHỈ MỞ PANE CHO **NHÓM**, ⛔ KHÔNG cho DM của host ═══
  //
  // ⛔ ĐÃ XẢY RA THẬT 21/08/2026 22:16: anh nhắn một câu trong DM, daemon gọi
  // lệnh mở pane cho chính DM đó, và một pane `zalo-nhom` mọc lên ôm hộp thư
  // riêng của anh. DM đã có chủ (pane router, khoá bằng `ZTL_TUYEN`) ⇒ thành
  // HAI pane tranh nhau một hộp thư, và bên thắng lại là agent NHÓM — sai cả
  // vai lẫn bộ luật.
  //
  // ⚠️ Tên tính năng là "panel-mỗi-NHÓM". `nhom` ở đây do `findGroup(cauHinh,…)`
  // trả về, tức ⛔ không phải nhóm thì ⛔ không mở. ⛔ Đừng đổi thành "mở cho
  // mọi chatId" cho tiện — DM của host là ca ⛔ không được chạm tới.
  if (p.soMoPhien && nhom) {
    p.soMoPhien.baoDam(chatId, { tenNhom: nhom.ten ?? null, lyDo: 'tin-moi' })
      .catch((e) => log(`mở phiên cho ${chatId} lỗi (đã nuốt): ${safeLogText(e)}`));
  }

  if (!p.guiThongBao) {
    log(`chế độ --khong-mcp: đã ghi hàng đợi ${requestId}, không đánh thức Claude`);
    return;
  }

  // Fire-and-forget CÓ CHỦ Ý: đường ghi DB ở trên đã xong rồi, không có gì
  // để mất nữa. Chờ notify ở đây là chặn callback của websocket.
  Promise.resolve()
    .then(() =>
      p.guiThongBao({
        requestId,
        chatId,
        tenHoiThoai: p.tenHoiThoai(chatId),
        nguoiHoi: tin.userId ?? null,
        noiDung: tin.noiDung ?? '',
        tsZalo: tin.tsZalo ?? Date.now(),
        // 🔴 Đường notify TRỰC TIẾP này chạy ở chế độ MỘT TIẾN TRÌNH (đường
        // đang chạy hôm nay). Thiếu cờ ở đây là lượt người lạ tới model mà
        // KHÔNG mang dấu "chỉ nghe" ⇒ model tưởng mình được trả lời.
        // ⚠️ Server vẫn chặn (cờ nằm trên ĐĨA, `_kiemPhien` đọc từ đó), nên đây
        // là chuyện phí lượt chứ không phải rò — nhưng vẫn phải đúng.
        chiNghe,
        idViecMoCua: kq.payload?.idViecMoCua ?? null,
        noiDungViec: boiCanhCua2?.noiDungViec ?? null,
      }),
    )
    .then((ok) => {
      // 🔴 `ok === true` chỉ có nghĩa ĐÃ ĐẨY ĐI, KHÔNG có nghĩa ĐÃ TỚI.
      // Bằng chứng đã tới duy nhất là Claude gọi ngược lại tool. Vì vậy chỉ
      // được chuyển sang 'da_day', TUYỆT ĐỐI không 'da_tra_loi'.
      if (ok) updateQueueState(db, requestId, TRANG_THAI_HANG_DOI.DA_DAY);
      else log(`notify ${requestId} chưa đẩy được -> giữ 'cho', đẩy bù sau`);
    })
    .catch((e) => log(`notify ${requestId} ném lỗi (đã nuốt): ${safeLogText(e)}`));
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ B2 — BỘ ĐẾM LỖI GỬI, CÓ ĐƯỜNG RA TỚI HOST.
 *
 * 🔴 VÌ SAO TÁCH RA THÀNH HÀM RIÊNG THAY VÌ VIẾT THẲNG TRONG `main()`:
 * bản đầu em viết nó thành closure bên trong `main()`, và phép thử đột biến
 * 21/08/2026 vạch ra ngay — vô hiệu hoá cả nhánh báo host thì **toàn bộ 752 bài
 * vẫn XANH**. Logic nằm trong `main()` thì không bài test nào với tới được
 * (muốn chạm phải spawn cả tiến trình + đăng nhập Zalo).
 * ⇒ Thứ gì cần canh thì phải LÔI RA KHỎI `main()`. Đây là hàm thuần: nhận một
 *   callback báo host, không đọc config, không chạm mạng.
 *
 * 🔴 NGƯỠNG 2 NHỊP LIÊN TIẾP, không phải 1: một lần hỏng thường là mạng chớp;
 * báo ngay thì thành phiền, mà cảnh báo phiền là cảnh báo bị bỏ qua.
 * 🔴 BÁO ĐÚNG MỘT LẦN mỗi đợt hỏng rồi IM: nhịp 30 giây mà báo mỗi nhịp là 120
 * tin/giờ vào DM của anh — tự tay biến cảnh báo thật thành rác.
 *
 * @param {(loiNhan: string) => Promise<any>} baoRa
 * @returns {(ten: string, ra: {loi?: number}|null|undefined) => void}
 */
export function createSendFailureCounter(baoRa) {
  const lienTiep = new Map();
  const daBao = new Set();
  return function dem(ten, ra) {
    if (!ra) return;
    const hong = Number(ra.loi ?? 0);
    if (hong > 0) {
      const n = (lienTiep.get(ten) ?? 0) + 1;
      lienTiep.set(ten, n);
      if (n >= 2 && !daBao.has(ten)) {
        daBao.add(ten);
        Promise.resolve(baoRa(
          `⚠️ Bộ chạy "${ten}" gửi HỎNG ${n} nhịp liên tiếp (nhịp này ${hong} lượt hỏng).\n`
          + 'Em có thể đã bị kick khỏi nhóm, mất mạng, hoặc Zalo đổi giao thức. '
          + 'Lời nhắc đang KHÔNG tới được ai — anh kiểm giúp.',
        )).catch(() => {});
      }
      return;
    }
    if (lienTiep.get(ten)) {
      lienTiep.set(ten, 0);
      // Hồi phục cũng phải báo — im lặng khoẻ lại thì anh vẫn tưởng đang hỏng.
      if (daBao.delete(ten)) {
        Promise.resolve(baoRa(`✅ Bộ chạy "${ten}" đã gửi lại được bình thường.`)).catch(() => {});
      }
    }
  };
}

/**
 * Đường khai nguồn cho `runFollowUpTick` — B5.
 *
 * 🔴 VÌ SAO LÀ HÀM EXPORT CHỨ KHÔNG PHẢI ARROW VIẾT THẲNG TRONG `main()`:
 * `runner.js` gọi `p.recordSources(requestId, nguonChatIds)` — HAI đối số — còn
 * `leak_guard.recordSources()` cần BA (`boTichLuy` đứng trước). Quên `boTichLuy`
 * là `recordSources(rid, nguon)` chạy vào `boTichLuy.ghiNhan` của một chuỗi ⇒
 * ném lỗi, `bo_chay` nuốt vào nhánh catch, lời nhắc lặng lẽ rơi xuống câu dự
 * phòng. Không `node --check` nào bắt được, và khối `main()` thì test không với
 * tới (phải đăng nhập Zalo thật).
 * ⇒ Lôi ra khỏi `main()` để bài test nạp THẬT closure sản xuất này mà chạy,
 *   thay vì chép lại một bản giống-giống rồi tự tin là đã canh.
 *
 * @param {import('./types.d.ts').BoTichLuyNguon} boTichLuy
 * @returns {(requestId: string, nguonChatIds: string[]) => void}
 */
export function bindRecordSources(boTichLuy) {
  return (requestId, nguonChatIds) => recordSources(boTichLuy, requestId, nguonChatIds);
}

function docCo(argv) {
  const a = argv.slice(2);
  const lay = (ten) => {
    const i = a.indexOf(ten);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    khongMcp: a.includes('--khong-mcp'),
    cheDo: lay('--che-do'),
    vai: lay('--vai'),
    // Chỉ dùng cho nghiệm thu: dựng đủ ①②③ rồi thoát, KHÔNG đăng nhập Zalo.
    kiemKhoiDong: a.includes('--kiem-khoi-dong'),
    config: (() => {
      const i = a.indexOf('--config');
      return i >= 0 ? a[i + 1] : undefined;
    })(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 v9 — VÒNG LẤY VIỆC CỦA CLIENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ NHỊP POLL — 2 000 ms. Con số này CÓ LÝ DO, không phải chọn cho tròn.
 *
 * Tổng độ trễ anh cảm nhận được của một lượt ở chế độ tách:
 *     poll (≤ 2 s) + model (ĐO THẬT: 10–76 s) + outbox (≤ 2 s)
 * ⇒ phần poll chiếm khoảng **2–5 %**. Hạ xuống 500 ms tiết kiệm được ~1,5 s
 *   trên một lượt 10–76 s (không ai nhận ra) nhưng nhân **4 lần** số truy vấn
 *   SQLite mỗi ngày, suốt ngày, cho tất cả pane.
 *
 * ⚠️ Thiết kế nói ngưỡng phải làm chuông socket là **trung vị > 1 giây**. Trung
 * vị của poll 2 s là ~1 s — nằm ngay mép. Vì vậy `ghiDoTre` bên dưới ĐO THẬT
 * và ghi ra đĩa: khi có số, quyết định "có cần chuông không" dựa trên số chứ
 * ⛔ không dựa trên phán đoán này.
 *
 * ⚠️ Cùng nhịp `drainOutbox` (2 s) là CỐ Ý — một con số để nhớ, một chỗ để chỉnh.
 */
export const CLIENT_POLL_TICK_MS = 2000;

/**
 * ★ Vòng lấy việc. Trả về `{ dung() }`.
 *
 * 🔴 TÁCH RA KHỎI `chayClient` VÌ MỘT LÝ DO ĐÃ TRẢ GIÁ: thứ gì nằm trong
 * `main()`/`chayClient()` thì KHÔNG bài test nào với tới (muốn chạm phải spawn
 * cả tiến trình + đăng nhập Zalo). Phép thử đột biến 21/08/2026 đã vạch đúng
 * chuyện đó với bộ đếm lỗi gửi: vô hiệu hoá cả nhánh mà 752 bài vẫn xanh.
 *
 * 🔴 MỘT NHỊP NÉM ⛔ KHÔNG ĐƯỢC GIẾT CẢ VÒNG. Vòng này là đường sống duy nhất
 * của client: nó chết là pane câm vĩnh viễn, mà câm kiểu đó không có lỗi nào
 * để lần ra — `setInterval` chỉ lặng lẽ ngừng gọi.
 *
 * ⚠️ CHỐNG CHỒNG NHỊP: một nhịp chưa xong mà nhịp sau đã tới thì hai bên cùng
 * quét một bảng. CAS ở `pushPendingQueue` chặn được việc trùng, nhưng bỏ hẳn nhịp
 * chồng thì rẻ hơn và không phụ thuộc CAS.
 *
 * @param {{chay: () => Promise<any>, nhipMs?: number, log: (s: string) => void,
 *          datHen?: Function, xoaHen?: Function}} p
 */
export function createWorkPollLoop(p) {
  const nhip = Number(p.nhipMs) > 0 ? Number(p.nhipMs) : CLIENT_POLL_TICK_MS;
  const datHen = p.datHen ?? setInterval;
  const xoaHen = p.xoaHen ?? clearInterval;
  let dangChay = false;
  let soNhip = 0;
  let soLoi = 0;

  const id = datHen(() => {
    if (dangChay) return;          // nhịp trước chưa xong -> bỏ nhịp này
    dangChay = true;
    soNhip += 1;
    Promise.resolve()
      .then(() => p.chay())
      .catch((e) => {
        soLoi += 1;
        // ⚠️ Nuốt CÓ GHI SỔ. Nuốt im là vòng vẫn chạy mà không làm được gì, và
        // nhìn từ ngoài giống hệt "không có việc nào" — hỏng câm.
        p.log(`[client] nhịp lấy việc lỗi (vòng VẪN chạy): ${safeLogText(e)}`);
      })
      .finally(() => { dangChay = false; });
  }, nhip);
  if (typeof id?.unref === 'function') id.unref();

  return {
    nhipMs: nhip,
    dung() { xoaHen(id); },
    _so: () => ({ soNhip, soLoi }),
  };
}

/**
 * ★ SỔ ĐO ĐỘ TRỄ — JSONL trên đĩa, cạnh file DB.
 *
 * 🔴 Ghi ra ĐĨA chứ ⛔ không đếm trong RAM: client restart là mất sạch, mà câu
 * hỏi cần trả lời ("trung vị và P95 là bao nhiêu") chỉ có nghĩa khi gom được
 * nhiều ngày.
 *
 * ⚠️ Giữ tối đa `tran` dòng cuối, cắt bớt khi vượt. 450 lượt/ngày ⇒ 5 000 dòng
 * là khoảng 11 ngày. ⛔ Không xây bộ xoay log riêng cho một file bé thế này.
 *
 * ⚠️ Ghi hỏng thì IM và trả `false` — đây là sổ đo, ⛔ không được làm chết một
 * lượt trả lời thật vì không ghi được số liệu.
 */
export function createLatencyLog(duongDan, tran = 5000) {
  let dem = 0;
  return {
    duongDan,
    ghi(banGhi) {
      try {
        ensureParentDir(duongDan);
        fs.appendFileSync(duongDan, `${JSON.stringify({ ...banGhi, ts: new Date().toISOString() })}\n`, { mode: 0o600 });
        dem += 1;
        if (dem % 500 === 0) {
          const dong = fs.readFileSync(duongDan, 'utf8').split('\n').filter(Boolean);
          if (dong.length > tran) fs.writeFileSync(duongDan, `${dong.slice(-tran).join('\n')}\n`, { mode: 0o600 });
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * ★ Đọc sổ đo -> trung vị + P95. Dùng cho `bin/` và cho nghiệm thu.
 *
 * ⚠️ Sổ RỖNG trả `null`, ⛔ không trả 0. `0 ms` là một khẳng định ("nhanh
 * tuyệt đối"); `null` là sự thật ("chưa đo được gì").
 */
export function readLatencyLog(duongDan) {
  let tho = '';
  try { tho = fs.readFileSync(duongDan, 'utf8'); } catch { return null; }
  const so = tho.split('\n').filter(Boolean)
    .map((d) => { try { return Number(JSON.parse(d).treMs); } catch { return NaN; } })
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!so.length) return null;
  const moc = (q) => so[Math.min(so.length - 1, Math.floor(q * so.length))];
  return { soMau: so.length, min: so[0], trungVi: moc(0.5), p95: moc(0.95), max: so.at(-1) };
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * VAI CLIENT — máy chủ MCP cho MỘT phiên Claude. ⛔ KHÔNG chạm Zalo.
 *
 * 🔴 BỐN THỨ CLIENT TUYỆT ĐỐI KHÔNG LÀM, và mỗi cái là một ca hỏng thật:
 *
 *  1. ⛔ KHÔNG `acquirePidLock`. Đây là ca DỄ MẮC NHẤT: pid-lock vốn nằm ngay đầu
 *     `main()`, ai bê nguyên khối khởi động sang là N pane chết ngay lúc khởi
 *     động — pane thứ hai thấy khoá của pane thứ nhất rồi thoát.
 *  2. ⛔ KHÔNG đăng nhập Zalo. Tài khoản chỉ có MỘT suất "máy tính"; client
 *     đăng nhập là ĐÁ VĂNG phiên của daemon.
 *  3. ⛔ KHÔNG gửi tin thẳng. Throttle ~1,2 giây/tin là biến trong MỘT tiến
 *     trình ⇒ N client tự gửi = N bộ đếm độc lập ⇒ bot bắn N tin trong 1,2
 *     giây ⇒ nguy cơ gắn cờ spam, mất tài khoản. Client XẾP HÀNG, daemon gửi.
 *  4. ⛔ KHÔNG `migrate`. Nhiều tiến trình cùng migrate là cuộc đua ALTER TABLE
 *     trùng cột (xem `openDb(..., {migrate:false})`).
 *
 * ✅ Client CÓ: sổ nguồn trên ĐĨA (`createSourceLedger({ db })`) — bắt buộc, vì
 *    `bo_chay` chạy ở daemon và ghi nguồn vào cùng bảng đó. Dùng sổ RAM ở đây
 *    là hai tiến trình tra hai quyển khác nhau, và lá chắn chống rò chéo mù
 *    đúng ca cần nó.
 */
async function chayClient(co, log, cauHinh) {

  // ⛔ KHÔNG pid-lock. ⛔ KHÔNG migrate — lệch phiên bản thì NÉM (mã thoát ≠ 0).
  const db = openDb(cauHinh.duongDan.db, { migrate: false });
  log(`[client] mở DB ${cauHinh.duongDan.db} (KHÔNG migrate, KHÔNG pid-lock)`);

  const { setReadScope, setClientId, enforceChatId, getReadScope } = await import('./store/query.js');
  // ═══ 🔴 KHOÁ PHẠM VI ĐỌC — LUẬT ANH CHỐT 21/08/2026 ═══
  //   "Quyền đi theo CHỖ HỎI, không theo NGƯỜI HỎI."
  // Pane của nhóm X chỉ thấy nhóm X, **kể cả khi người hỏi chính là host**.
  //
  // 🔴 THIẾU BIẾN PHẢI HỎNG VỀ CHIỀU AN TOÀN. Nếu "không khai gì" = toàn quyền
  // thì một lần quên `ZTL_CHAT_ID` lúc mở pane là pane đó lặng lẽ đọc cả kho —
  // hỏng câm, không ai thấy. ⇒ Toàn quyền phải KHAI TƯỜNG MINH
  // `ZTL_PHAM_VI=toan_bo`, và thiếu cả hai biến thì client **KHÔNG KHỞI ĐỘNG**.
  // ⛔ Đừng đổi thành cảnh báo rồi chạy tiếp: cảnh báo trong log của tiến trình
  // nền thì không ai đọc.
  const phamViTho = (process.env.ZTL_CHAT_ID ?? '').trim();
  const toanBo = (process.env.ZTL_PHAM_VI ?? '').trim() === 'toan_bo';

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 v10.3 — TÁCH **KHOÁ ĐỊNH TUYẾN** KHỎI **PHẠM VI ĐỌC** (21/08/2026)
  //
  // Hai câu hỏi KHÁC NHAU, trước đây bị nhét chung vào một biến:
  //   · `ZTL_TUYEN`  = *"đẩy dòng của hội thoại này cho tôi"*  (NHẬN GÌ)
  //   · `ZTL_CHAT_ID` / `ZTL_PHAM_VI` = *"tôi được đọc tới đâu"*  (ĐỌC GÌ)
  //
  // Chúng trùng nhau ở agent-mỗi-nhóm (nhận nhóm X, đọc nhóm X) nên gộp một
  // biến vẫn chạy — cho tới khi cần một vai mà chúng KHÁC NHAU:
  //   `zalo-router` NHẬN **chỉ DM host** nhưng ĐỌC **cả kho**.
  // Trước v10.3 vai đó KHÔNG KHAI ĐƯỢC: khai cả hai biến cũ thì bị NÉM.
  //
  // 🔴 `ZTL_TUYEN` ⛔ TUYỆT ĐỐI KHÔNG nới phạm vi đọc. Nó ⛔ không đi vào
  // `setReadScope()`, ⛔ không đi vào hậu kiểm. Có bài test canh đúng chuyện đó
  // (`R3`) — vì "biến định tuyến lặng lẽ mở luôn quyền đọc" là kiểu hỏng
  // KHÔNG có triệu chứng nào ngoài dữ liệu rò ra.
  // ═══════════════════════════════════════════════════════════════════
  const tuyenTho = (process.env.ZTL_TUYEN ?? '').trim();

  if (!phamViTho && !toanBo) {
    closeDb(db);
    throw new Error(
      'Client KHÔNG biết phạm vi đọc của mình. Phải khai MỘT trong hai:\n'
      + '  ZTL_CHAT_ID=<chat_id>   -> pane của một nhóm/DM, chỉ đọc đúng chỗ đó\n'
      + '  ZTL_PHAM_VI=toan_bo     -> pane DM host, đọc cả kho (NGOẠI LỆ DUY NHẤT)\n'
      + 'Thiếu cả hai thì KHÔNG khởi động — vì mặc định "đọc hết" là mặc định '
      + 'rò dữ liệu, và nó hỏng trong im lặng.'
      + (tuyenTho
        ? `\n\n⚠️ Có khai ZTL_TUYEN=${tuyenTho}, nhưng đó là khoá ĐỊNH TUYẾN `
          + '("nhận dòng của ai"), KHÔNG phải phạm vi ĐỌC. ⛔ Không suy ra "chắc ý '
          + 'là chỉ đọc chỗ đó" — đoán sai theo chiều mở là rò dữ liệu. Khai thêm '
          + 'ZTL_PHAM_VI=toan_bo (vai zalo-router) hoặc dùng ZTL_CHAT_ID.'
        : ''),
    );
  }
  if (toanBo && phamViTho) {
    closeDb(db);
    throw new Error(
      `Khai CẢ HAI: ZTL_CHAT_ID=${phamViTho} và ZTL_PHAM_VI=toan_bo. Không đoán ý — `
      + 'bỏ bớt một cái rồi chạy lại.',
    );
  }
  // ⚠️ `ZTL_CHAT_ID` đã tự làm CẢ HAI việc (nhận nhóm đó + chỉ đọc nhóm đó).
  // Khai kèm `ZTL_TUYEN` là mơ hồ: người khai đang muốn nhận chỗ khác, hay chỉ
  // viết thừa? ⛔ Không đoán — ca "nhận dòng của chỗ mình KHÔNG đọc được" tạo ra
  // một pane nhận việc rồi trả lời bằng dữ liệu rỗng, và ⛔ không lỗi nào nổ ra.
  if (tuyenTho && phamViTho) {
    closeDb(db);
    throw new Error(
      `Khai CẢ ZTL_TUYEN=${tuyenTho} LẪN ZTL_CHAT_ID=${phamViTho}. ZTL_CHAT_ID đã bao `
      + 'gồm định tuyến rồi. Muốn NHẬN một chỗ mà ĐỌC cả kho thì dùng '
      + 'ZTL_TUYEN=<chat_id> + ZTL_PHAM_VI=toan_bo (vai zalo-router).',
    );
  }
  setReadScope(toanBo ? null : phamViTho);
  // Danh tính pane cho `query_log.client_id`. Mặc định = chính phạm vi
  // (đó CHÍNH LÀ thứ phân biệt các pane với nhau); `ZTL_CLIENT_ID` đè được khi
  // người vận hành muốn tên dễ đọc hơn.
  // ⚠️ `tuyenTho` đi TRƯỚC `'toan_bo'`: cả `zalo-router` lẫn client DỰ PHÒNG đều
  // khai `toan_bo`, nên lấy nguyên chữ đó làm danh tính là HAI PANE TRÙNG TÊN
  // trong `query_log.client_id` — và cột đó sinh ra để trả lời "PANE NÀO
  // đã đọc nhóm nào".
  setClientId(
    (process.env.ZTL_CLIENT_ID ?? '').trim()
    || (tuyenTho ? `tuyen:${tuyenTho}` : '')
    || (toanBo ? 'toan_bo' : phamViTho),
  );

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 HẬU KIỂM — ⛔ KHÔNG in lại biến env vừa đọc.
  //
  // In `phamViTho` là in lại LỜI KHAI: xoá mất dòng `setReadScope` ở trên thì log
  // vẫn ra y hệt, mọi bài kiểm khởi động vẫn xanh, và pane lặng lẽ đọc CẢ KHO.
  // Đúng khuôn hỏng CÂM. Nên hỏi lại chính TẦNG TRUY VẤN.
  //
  // Hỏi bằng `enforceChatId(null)` chứ không phải `getReadScope()`: `null` dựng lại
  // đúng ca nguy hiểm nhất — model bỏ trống tham số. Khoá ăn thì nó trả về
  // phạm vi; khoá hỏng thì nó trả `null` = "quét mọi nhóm".
  // ═══════════════════════════════════════════════════════════════════
  const epThu = enforceChatId(null);
  const dungY = toanBo ? epThu === null && getReadScope() === null : epThu === phamViTho;
  if (!dungY) {
    closeDb(db);
    throw new Error(
      `Khoá phạm vi KHÔNG ăn: khai ${toanBo ? 'toan_bo' : phamViTho} nhưng tầng truy vấn `
      + `ép về ${epThu === null ? 'MỌI NHÓM' : epThu}. ⛔ Không chạy tiếp — chạy tiếp là rò dữ liệu.`,
    );
  }
  // 🔴 HAI DÒNG RIÊNG, ⛔ ĐỪNG GỘP. Đây là hai quyền KHÁC NHAU, và gộp một dòng
  // là đúng cái nhầm lẫn mà v10.3 sinh ra để gỡ. Người đọc log lúc 2 giờ sáng
  // phải trả lời được ngay: pane này NHẬN gì, và nó ĐỌC được tới đâu.
  log(tuyenTho
    ? `[client] NHẬN: chỉ dòng của ${tuyenTho} (ZTL_TUYEN)`
    : toanBo
      ? '[client] NHẬN: dòng KHÔNG AI nhặt (vai dự phòng — không khai ZTL_TUYEN)'
      : `[client] NHẬN: chỉ dòng của ${phamViTho} (ZTL_CHAT_ID)`);
  log(toanBo
    ? '[client] ĐỌC : TOÀN BỘ kho (ZTL_PHAM_VI=toan_bo — khai tường minh)'
    : `[client] ĐỌC : KHOÁ vào ${epThu} — mọi truy vấn bị ép về đúng chỗ này`);

  // ═══ 🔴 v10.3 — NGƯỠNG DỰ PHÒNG PHỤ THUỘC `moPhienLenh` ═══
  // `GIAN_CHO_MO_PANE_MS` (37 s) là *"chờ pane riêng của nhóm dựng xong"* —
  // nó chỉ có nghĩa khi CÓ ai đó dựng pane. `moPhienLenh = null` ⇒ ⛔ KHÔNG
  // BAO GIỜ có pane nào tới ⇒ chờ 37 giây là **bắt người dùng chờ một thứ
  // không tồn tại**, và MỌI tin đều chậm 37 giây.
  //
  // ⚠️ Đọc từ CẤU HÌNH ĐÃ VALIDATE (`validateConfig` đã ép chuỗi rỗng/kiểu lạ về
  // `null`), ⛔ không đọc lại file và ⛔ không đoán.
  const laDuPhong = !tuyenTho && !phamViTho;
  const nguongDuPhongMs = cauHinh.tichHop?.moPhienLenh ? GIAN_CHO_MO_PANE_MS : 0;
  if (laDuPhong) {
    log(nguongDuPhongMs
      ? `[client] vai DỰ PHÒNG: chờ ${nguongDuPhongMs}ms cho pane riêng trước khi nhặt`
      : '[client] vai DỰ PHÒNG: nhặt NGAY (moPhienLenh chưa cắm ⇒ không có pane riêng nào để chờ)');
  }

  if (co.kiemKhoiDong) {
    log('[client] --kiem-khoi-dong: đã qua config + DB + phạm vi, thoát mà KHÔNG nối MCP');
    closeDb(db);
    return EXIT_CODE.OK;
  }

  const { createChannel, pushPendingQueue } = await import('./mcp/channel.js');
  const { replyContext } = await import('./store/query.js');
  const { registerTools } = await import('./mcp/tools.js');
  const { readHealth } = await import('./ops/health.js');
  const { enqueueOutbound } = await import('./store/write.js');

  // 🔴 Sổ nguồn trên ĐĨA — xem khối chú thích trên.
  const boTichLuy = createSourceLedger({ db });
  const tenHoiThoai = (chatId) =>
    findGroup(cauHinh, chatId)?.ten ?? findHostByDm(cauHinh, chatId)?.ten ?? null;

  // Sổ đo độ trễ nằm cạnh file DB — cùng thư mục, cùng mức siết quyền.
  const soDoTre = createLatencyLog(
    path.join(path.dirname(expandPath(cauHinh.duongDan.db)), 'do_tre_lay_viec.jsonl'),
  );

  let channel = null;
  let vong = null;
  /** @type {any} */
  let henVot = null;

  // ═══ 🔴 ĐƯỜNG BÁO HOST CỦA CLIENT — qua OUTBOX, ⛔ không qua Zalo ═══
  // Client ⛔ không có `api` (cố ý). Trước v11 nghĩa là mọi cảnh báo của nó
  // chết trong log — xem tầng 1b ở `ops/notify_host.js`. Nay nó xếp hàng, và
  // daemon rút ra gửi: đúng con đường `reply` đang đi.
  const baoHostClient = (s) => notifyHost(cauHinh, s, {
    api: null,
    xepHangDm: (dmChatId, text) => { enqueueOutbound(db, { chatIdDich: dmChatId, text }); },
  });

  // Sổ đếm số lần đã vớt cho từng câu.
  const soVot = createRescueLedger({
    log: (s) => log(`[client][vớt] ${s}`),
    notifyHost: (s) => { baoHostClient(s).catch(() => {}); },
  });

  /** Một nhịp lấy việc. Tách ra để `khiSanSang` và vòng poll dùng CHUNG. */
  const motNhipLayViec = (tuyChon) => pushPendingQueue({
    db,
    queueTtlMs: cauHinh.thoiGian.queueTtlMs,
    guiThongBao: channel.guiThongBao,
    takePendingQueue,
    updateQueueState,
    // 🔴 CAS nhận việc — thiếu nó là hai client cùng nhặt một dòng, tức hai tin
    // vào nhóm người thật. Xem khối 🔴 trong `pushPendingQueue`.
    claimQuestion,
    tenHoiThoai,
    ghiDoTre: (b) => soDoTre.ghi(b),
    gomDaDay: tuyChon?.gomDaDay === true,
    // Lưới vớt truyền `tuoiMoCoiMs`; vòng poll thường ⛔ không truyền gì.
    tuoiMoCoiMs: tuyChon?.tuoiMoCoiMs ?? 0,
    choPhepDay: tuyChon?.choPhepDay ?? null,
    // ═══ 🔴 v10.2 — ĐỊNH TUYẾN PANE ═══
    // Client khoá nhóm ⇒ CHỈ nhặt dòng của nhóm mình. Thiếu bộ lọc này thì
    // pane nhóm A nhặt câu hỏi của nhóm B rồi **trả lời vào nhóm B** — khoá
    // phạm vi ĐỌC (bước 6) nằm ở tầng khác và ⛔ KHÔNG canh đường này.
    // 🔴 v10.3 — LẤY TỪ KHOÁ ĐỊNH TUYẾN, ⛔ không phải từ phạm vi đọc.
    // `ZTL_TUYEN` thắng; vắng nó thì `ZTL_CHAT_ID` (agent nhóm vẫn y hệt hôm
    // nay); vắng cả hai ⇒ `null` = vai DỰ PHÒNG, nhặt mọi chỗ.
    // ⚠️ Lưới vớt được phép ĐÈ khoá này (xem chỗ dựng lưới ở dưới) — và chỉ
    // pane khai `toan_bo` mới được đè. Pane khoá vào một nhóm thì ⛔ KHÔNG.
    chatIdHoi: tuyChon?.chatIdHoi !== undefined
      ? tuyChon.chatIdHoi
      : (tuyenTho || phamViTho || null),
    // Client DỰ PHÒNG chỉ nhặt dòng KHÔNG AI nhặt sau `GIAN_CHO`.
    // ⛔ Không có ngưỡng này thì dự phòng cướp việc ngay giây đầu ⇒ mọi câu
    // rơi vào pane đọc-nhiều-nhóm, tức panel-mỗi-nhóm mất tác dụng cô lập
    // TRONG IM LẶNG (tin vẫn được trả lời, ⛔ không lỗi nào nổ ra).
    //
    // ⚠️ `zalo-router` khai `toan_bo` NHƯNG có `ZTL_TUYEN` ⇒ nó ⛔ KHÔNG phải
    // dự phòng: nó là chủ sở hữu của DM host và phải nhặt NGAY. Điều kiện phải
    // là `laDuPhong`, ⛔ không phải `toanBo`.
    treToiThieuMs: laDuPhong ? nguongDuPhongMs : 0,
    // 🔴 v11 — báo "câu hỏi quá hạn" ĐI QUA OUTBOX.
    // ⛔ Trước đây dòng này là `notifyHost(..., { api: null })`, và vì client
    // ⛔ không có `api` còn `notifyCommand` mặc định `null`, nó rơi thẳng xuống
    // "chỉ còn log". Ba câu quá hạn chiều 21/08/2026 ⛔ KHÔNG tới được anh —
    // cảnh báo không tới nơi thì đúng bằng ⛔ không có cảnh báo.
    baoHetHan: (loiNhan) => baoHostClient(loiNhan),
  });

  channel = createChannel({
    tenServer: TEN_SERVER,
    phienBan: PHIEN_BAN,
    replyContext: (requestId) => replyContext(db, requestId),
    registerTools: (server) =>
      registerTools(server, {
        db,
        cauHinh,
        boTichLuy,
        // ⚠️ `api: null` là CÓ CHỦ ĐÍCH và là chốt chặn cuối: kể cả khi có ai
        // đó lỡ gọi đường gửi thẳng, `send.js` sẽ ném ngay ở bước kiểm
        // `api.sendMessage` chứ không âm thầm gửi bằng một kết nối thứ hai.
        api: null,
        docSucKhoe: () => readHealth(cauHinh.duongDan.health),
        // ★ Cửa gửi của client: XẾP HÀNG, ⛔ không chạm mạng.
        kho: { xepHangGuiRa: enqueueOutbound },
      }),
    khiSanSang: () => {
      // Lượt ĐẦU: `gomDaDay` mặc định BẬT — đúng lúc mọi dòng `da_day` /
      // `dang_xu_ly` đều mồ côi (phiên nhận chúng đã không còn).
      motNhipLayViec({ gomDaDay: true })
        .catch((e) => log(`[client] đẩy bù hàng đợi thất bại: ${safeLogText(e)}`));
      // ═══ 🔴 v9 — RỒI MỚI BẬT VÒNG POLL ═══
      // ⛔ Trước v9 KHÔNG có dòng này, và đó là lỗi CHẶN CỨNG: client rút hàng
      // đợi ĐÚNG MỘT LẦN rồi `await new Promise(() => {})` ngồi im mãi ⇒ ở chế
      // độ tách, MỌI tin nhắn mới của người dùng chỉ được nhặt lúc pane khởi
      // động. Sau đó daemon ghi vào `ask_queue` bao nhiêu cũng nằm đó.
      vong = createWorkPollLoop({
        // ⚠️ `gomDaDay: false` trong vòng poll. Bật nó ở đây là mỗi 2 giây đẩy
        // lại chính câu Claude ĐANG xử lý dở — xem khối A7 ở `store/write.js`.
        chay: () => motNhipLayViec({ gomDaDay: false }),
        log,
      });
      log(`[client] vòng lấy việc BẬT, nhịp ${vong.nhipMs}ms`);

      // ═══ 🔴 v11 — LƯỚI VỚT CÂU HỎI MỒ CÔI ═══
      // Xem `ops/rescue_orphans.js` để biết ba câu hỏi thật đã chết ở `da_day`
      // ngày 21/08/2026 và vì sao ⛔ KHÔNG lớp nào cứu chúng.
      //
      // 🔴 `chatIdHoi: null` CHỈ dành cho pane khai `toan_bo`: sau 3 phút mà
      // ⛔ không pane nào nhận thì coi như dòng VÔ CHỦ (pane của nhóm đó chết,
      // hoặc nhóm đó chưa từng có pane) ⇒ pane toàn quyền nhặt hộ. Pane khoá
      // vào một nhóm thì ⛔ KHÔNG được đè khoá — nó vớt đúng nhóm mình thôi,
      // vì nó đọc được đúng nhóm mình.
      henVot = setInterval(() => {
        // ① VỚT ĐÚNG TUYẾN CỦA MÌNH — dòng của chính chỗ mình phụ trách.
        motNhipLayViec({
          gomDaDay: true,
          tuoiMoCoiMs: ORPHAN_AGE_MS,
          choPhepDay: (r) => soVot.choPhep(r),
        }).catch((e) => log(`[client] lưới vớt lỗi (đã nuốt): ${safeLogText(e)}`));

        // ② VỚT DÒNG VÔ CHỦ — CHỈ pane toàn quyền, và CHỈ khi đã rất cũ.
        // 🔴 HAI NGƯỠNG KHÁC NHAU LÀ CÓ CHỦ Ý. Dùng chung một ngưỡng thì pane
        // toàn quyền nhảy vào ĐÚNG LÚC pane chủ được phép thử lại ⇒ hai pane
        // cùng làm một câu. Ngưỡng ② cao hơn = nhường pane chủ trước, người
        // ngoài chỉ nhặt khi rõ ràng ⛔ không còn ai.
        if (toanBo) {
          motNhipLayViec({
            gomDaDay: true,
            tuoiMoCoiMs: UNCLAIMED_AGE_MS,
            chatIdHoi: null,
            choPhepDay: (r) => soVot.choPhep(r),
          }).catch((e) => log(`[client] vớt dòng vô chủ lỗi (đã nuốt): ${safeLogText(e)}`));
        }
      }, RESCUE_TICK_MS);
      henVot.unref?.();
      log(`[client] lưới vớt BẬT: mỗi ${RESCUE_TICK_MS / 1000}s, vớt dòng quá `
        + `${ORPHAN_AGE_MS / 1000}s, tối đa ${MAX_RESCUE_ATTEMPTS} lần rồi báo host`);
    },
  });

  // ═══ NẠP NÓNG cũng phải chạy Ở CLIENT ═══
  // 🔴 Ở chế độ TÁCH, chính client mới là bên phục vụ tool: `registerTools` giữ
  // `cauHinh` của TIẾN TRÌNH NÀY. Chỉ nạp nóng ở daemon thì daemon nghe được
  // nhóm mới, còn tool `reply` ở client vẫn coi nhóm đó là "không có trong
  // config" ⇒ nghe được mà ⛔ không nói được. Hai tiến trình, hai bản config,
  // phải nạp cả hai.
  // ⚠️ Client ⛔ KHÔNG có `api` ⇒ ⛔ không tự nhắn Zalo (xem `baoHetHan` ở trên);
  // báo động của nó đi log, để daemon là bên DM host.
  const napNongClient = createHotReloader({
    duongDan: configPath(co.config),
    dich: cauHinh,
    readConfig,
    log: (s) => log(`[client][nạp nóng] ${s}`),
  });

  for (const tin of ['SIGINT', 'SIGTERM']) {
    process.on(tin, () => {
      log(`[client] nhận ${tin} -> tắt sạch`);
      try { napNongClient?.dung(); } catch { /* nuốt */ }
      try { if (henVot) clearInterval(henVot); } catch { /* nuốt */ }
      try { vong?.dung(); } catch { /* nuốt */ }
      try { closeDb(db); } catch { /* nuốt */ }
      process.exit(EXIT_CODE.OK);
    });
  }

  await channel.khoiDong();
  log('[client] đã nối stdio MCP — KHÔNG giữ pid-lock, KHÔNG chạm Zalo');
  await new Promise(() => {});
  return EXIT_CODE.OK;
}

/**
 * ★ Vòng rút OUTBOX của daemon — thứ duy nhất chạm Zalo ở chế độ tách.
 *
 * 🔴 Nhận việc bằng CAS (`claimOutbound`) TRƯỚC khi chạm mạng. Hai bộ chạy chồng
 * nhau (nhịp trước chưa xong, nhịp sau đã tới) mà không CAS là **gửi hai tin
 * vào nhóm người thật** — mà tin Zalo thì không thu hồi được.
 *
 * ⚠️ Gửi hỏng ⇒ ghi `'loi'` + lý do, ⛔ KHÔNG tự đưa về `'cho'` để thử lại vô
 * hạn: Zalo có thể ĐÃ NHẬN mà mình không biết (đúng ca "không rõ đã gửi hay
 * chưa"), thử lại mù là rủi ro hai tin. Lưới canh outbox (bước 5, pane khác)
 * mới là chỗ quyết định có thử lại hay báo host.
 */
export async function drainOutbox(p) {
  const ra = { daGui: 0, loi: 0, thuLai: 0, choBackoff: 0 };
  const { takePendingOutbound, claimOutbound, writeSendResult } = p.kho;
  const bayGio = p.bayGioMs ?? Date.now();
  let ds;
  try {
    ds = takePendingOutbound(p.db, p.soLuong ?? 20);
  } catch (e) {
    p.log(`[daemon] không đọc được hàng đợi gửi: ${safeLogText(e)}`);
    return ra;
  }

  for (const d of ds) {
    // 🔴 CÒN TRONG GIỜ CHỜ THÌ BỎ QUA — chốt này PHẢI đứng TRƯỚC `claimOutbound`.
    // Nhịp rút là 2 giây; thiếu nó thì "thử lại" thành bắn 30 lần/phút vào đúng
    // cái tin Zalo vừa từ chối, tức tự nộp mình cho bộ lọc spam. Mà claim rồi
    // mới bỏ qua thì `attempt_count` vẫn cộng ⇒ đốt sạch trần thử lại trong
    // vài giây, ⛔ không tin nào kịp chờ hết backoff.
    if (!readyToRetry(
      { soLanDaThu: Number(d.attempt_count ?? 0), tsCapNhatMs: Date.parse(d.ts_updated ?? '') },
      bayGio,
    )) {
      ra.choBackoff += 1;
      continue;
    }

    // CAS: chỉ MỘT bên nhận được việc này.
    let nhanDuoc = false;
    try {
      nhanDuoc = claimOutbound(p.db, d.id, TRANG_THAI_GUI.CHO, TRANG_THAI_GUI.DANG_GUI);
    } catch (e) {
      p.log(`[daemon] nhận việc gửi ${d.id} lỗi: ${safeLogText(e)}`);
    }
    if (!nhanDuoc) continue;

    let uids = [];
    try { uids = d.tag_user_ids ? JSON.parse(d.tag_user_ids) : []; } catch { uids = []; }

    try {
      // eslint-disable-next-line no-await-in-loop
      const kq = await p.gui(String(d.target_chat_id), String(d.text), uids, byteCapFor({
        soLanDaThu: Number(d.attempt_count ?? 1) - 1,
      }));
      writeSendResult(p.db, d.id, { msgId: kq?.msgId ?? null, lyDo: kq?.msgId ? null : 'Zalo không trả msgId' });
      if (kq?.msgId) ra.daGui += 1; else ra.loi += 1;
    } catch (e) {
      // ═══ HỎNG THÌ THỬ LẠI, ⛔ ĐỪNG CHÔN ═══
      // 🔴 Nhánh này trước đây gọi thẳng `writeSendResult` ⇒ `status='loi'`,
      // trạng thái CUỐI. Tin bốc hơi, ⛔ không ai báo. Mất 3 tin thật kiểu đó
      // (22–26/08/2026) trước khi chính anh hỏi "sao không trả lời".
      const lyDo = safeLogText(e);
      const qd = decideRetry({ soLanDaThu: Number(d.attempt_count ?? 1), lyDo });
      try {
        if (qd.thuLai && !p.kho.requeueOutbound) {
          // ⛔ ĐỪNG âm thầm rơi xuống nhánh chôn tin: thiếu dây nối là LỖI LẬP
          // TRÌNH, và nó phải lộ ra ở đây chứ không phải sáu ngày sau khi anh
          // hỏi "sao không trả lời". Đúng cái bẫy đã dính hôm nay: hàm có sẵn
          // mà không ai nối, cú pháp vẫn xanh.
          p.log('[daemon] 🔴 THIẾU DÂY NỐI `requeueOutbound` -> tin hỏng sẽ bị chôn thay vì thử lại');
        }
        if (qd.thuLai && p.kho.requeueOutbound) {
          p.kho.requeueOutbound(p.db, d.id, lyDo);
          ra.thuLai += 1;
          p.log(`[daemon] gửi ${d.id} hỏng lượt ${d.attempt_count} -> chờ ${Math.round(qd.choMs / 1000)}s thử lại (trần ${qd.tranByte}B): ${lyDo}`);
        } else {
          ra.loi += 1;
          writeSendResult(p.db, d.id, { lyDo });
          // 🔴 KÊU TO. Đây là chỗ DUY NHẤT anh biết mình vừa mất một tin —
          // ⛔ đừng nuốt lỗi của lời báo động, nhưng cũng ⛔ đừng để nó làm
          // chết vòng rút outbox.
          try {
            p.baoHost?.(deadLetterMessage({
              chatIdDich: String(d.target_chat_id),
              soLanDaThu: Number(d.attempt_count ?? 0),
              text: String(d.text ?? ''),
              lyDo,
              kieu: qd.kieu,
            }));
          } catch (e3) {
            p.log(`[daemon] ⛔ KHÔNG báo được host về tin chết ${d.id}: ${safeLogText(e3)}`);
          }
        }
      } catch (e2) {
        p.log(`[daemon] không ghi được kết quả gửi ${d.id}: ${safeLogText(e2)}`);
      }
    }
  }
  return ra;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} mã thoát
 */
export async function main(argv = process.argv) {
  const co = docCo(argv);

  /** @type {ReturnType<typeof resolveRunMode>} */
  let che = resolveRunMode({}, co, process.env);
  /** @type {{nha: () => void}|null} */
  let khoa = null;
  let db = null;
  let api = null;
  let channel = null;
  let wd = null;
  /** @type {{dung: () => void}|null} */
  let napNong = null;
  const hen = [];

  const dongSach = () => {
    for (const h of hen) clearInterval(h);
    try {
      napNong?.dung();
    } catch { /* nuốt */ }
    try {
      wd?.dung();
    } catch { /* nuốt */ }
    try {
      if (api) stopListening(api);
    } catch { /* nuốt */ }
    try {
      if (db) closeDb(db);
    } catch { /* nuốt */ }
    khoa?.nha();
  };

  try {
    // ② config TRƯỚC ①? KHÔNG — pid-lock phải đứng đầu, vì hai bản cùng chạy
    // sẽ cùng đọc được config hợp lệ rồi cùng ghi một DB.
    const cauHinh = readConfig(co.config); // ② (ném => mã 2, bắt ở dưới)

    // ═══ CHỐT CHẾ ĐỘ — sau khi có config, vì `cheDo` khai được trong đó ═══
    // ⚠️ Chốt TRƯỚC pid-lock: vai client đi một đường khởi động HOÀN TOÀN KHÁC
    // (không pid-lock, không Zalo, không bộ hẹn giờ). Đọc config trước là an
    // toàn — `readConfig` chỉ đọc file và validate, không có tác dụng phụ nào.
    che = resolveRunMode(cauHinh, co, process.env);
    if (che.laClient) {
      log(`chế độ "${che.cheDo}" · vai "${che.vai}"`);
      return await chayClient(co, log, cauHinh);
    }
    if (che.cheDo !== CHE_DO.MOT_TIEN_TRINH) log(`chế độ "${che.cheDo}" · vai "${che.vai}"`);

    // ① pid-lock — đường dẫn suy từ chính duongDan.db để khoá đi cùng kho dữ liệu
    khoa = acquirePidLock(path.join(path.dirname(cauHinh.duongDan.db), 'zalo-tro-ly.pid'));
    log(`giữ khoá pid ${process.pid}`);

    // ③ DB
    db = openDb(cauHinh.duongDan.db);
    log(`mở DB ${cauHinh.duongDan.db}`);

    // ═══ 🔴 v11 — CẢNH BÁO GỬI CHO HOST CŨNG PHẢI VÀO SỔ ═══
    // Thiếu `ghiLai` thì tin trợ lý vừa gửi ⛔ KHÔNG vào kho, và đọc lại lịch
    // sử chỉ thấy câu anh hỏi. Trớ trêu là cảnh báo — thứ đáng tra cứu nhất
    // khi có sự cố — lại đi đúng đường ⛔ không ghi này.
    // ⚠️ `api` là biến `let` (watchdog gán lại sau khi nối lại) ⇒ đọc TẠI LÚC
    // GỌI, ⛔ không chụp giá trị lúc dựng hàm.
    const ghiLaiTinTroLy = (t) => {
      try { writeMessage(db, t, { doTroLyTao: true }); } catch (e) {
        log(`ghi lại tin trợ lý thất bại (đã nuốt): ${safeLogText(e)}`);
      }
    };
    const baoHostDaemon = (thongDiep, them = {}) => notifyHost(cauHinh, thongDiep, {
      api,
      ghiLai: ghiLaiTinTroLy,
      uidTroLy: toId(api?.getOwnId?.(), 'index.uidTroLy'),
      ...them,
    });

    if (co.kiemKhoiDong) {
      log('--kiem-khoi-dong: đã qua config + pid-lock + DB, thoát mà KHÔNG đăng nhập Zalo');
      dongSach();
      return EXIT_CODE.OK;
    }

    // ④ login bằng COOKIE — KHÔNG BAO GIỜ mở QR ở đây
    try {
      api = await loginWithCookie(cauHinh);
    } catch (e) {
      // 🔴 TÔN TRỌNG MÃ `session.js` VỪA PHÂN LOẠI.
      // Bản cũ ở đây là một ternary vô nghĩa — hai nhánh đều trả CAN_QR — nên
      // mất mạng một giây cũng thành "cookie chết, quét QR đi". Mà tài khoản
      // Zalo chỉ có MỘT suất máy tính: anh tin lời khuyên sai rồi quét QR thật
      // là ĐÁ VĂNG phiên đang khoẻ. Báo động giả tự gây ra sự cố thật.
      // Không phân loại được thì KHONG_BIET, tuyệt đối không mặc định CAN_QR.
      const ma = e?.maSucKhoe === TRANG_THAI_SUC_KHOE.CAN_QR
        ? TRANG_THAI_SUC_KHOE.CAN_QR
        : TRANG_THAI_SUC_KHOE.KHONG_BIET;
      const canQr = ma === TRANG_THAI_SUC_KHOE.CAN_QR;
      try {
        writeHealth(cauHinh.duongDan.health, { trangThai: ma, lyDo: String(e?.message ?? e) });
      } catch (e2) {
        log(`không ghi được health: ${safeLogText(e2)}`);
      }
      // boTang1: không có api thì không DM Zalo được — đừng thử rồi báo hỏng.
      await notifyHost(
        cauHinh,
        canQr
          ? `Không đăng nhập được bằng cookie: ${e?.message ?? e}`
          : `Chưa vào được Zalo: ${e?.message ?? e}. CHƯA kết luận được là cookie chết `
            + '— rất có thể chỉ là mạng. ĐỪNG quét QR vội: tài khoản chỉ có một suất '
            + 'máy tính, quét lúc phiên còn sống là tự đá văng phiên đang chạy.',
        {
          boTang1: true,
          tieuDe: canQr ? 'Trợ lý Zalo cần quét QR' : 'Trợ lý Zalo chưa vào được (chưa rõ nguyên nhân)',
        },
      ).catch(() => {});
      log(canQr
        ? 'CAN_QR — chạy TAY: node bin/zalo-login.js'
        : 'KHONG_BIET — chưa kết luận cookie chết, KHÔNG giục quét QR');
      dongSach();
      return EXIT_CODE.CAN_QR;
    }

    // ⑤ ẩn trạng thái
    await applyHiddenStatus(api, cauHinh.anTrangThai).catch((e) =>
      log(`ẩn trạng thái thất bại (đi tiếp): ${safeLogText(e)}`),
    );

    // ⑨-chuẩn bị: kênh MCP dựng TRƯỚC listener để tin đầu tiên đã có chỗ đẩy.
    const boTichLuy = createSourceLedger();
    const tenHoiThoai = (chatId) =>
      findGroup(cauHinh, chatId)?.ten ?? findHostByDm(cauHinh, chatId)?.ten ?? null;

    // ⚠️ Ở chế độ TÁCH, daemon KHÔNG làm máy chủ MCP — phiên Claude nối vào
    // client. Daemon vẫn giữ Zalo + bộ hẹn giờ + rút outbox.
    // 🔴 HỆ QUẢ CẦN BIẾT: daemon không có `channel` ⇒ lời nhắc theo đuổi rơi
    // xuống câu dự phòng do CODE dựng (mất giọng model).
    const boMcp = co.khongMcp || che.cheDo === CHE_DO.TACH;
    if (!boMcp) {
      const { createChannel, pushPendingQueue } = await import('./mcp/channel.js');
      const { replyContext } = await import('./store/query.js');
      const { registerTools } = await import('./mcp/tools.js');
      const { readHealth } = await import('./ops/health.js');
      channel = createChannel({
        tenServer: TEN_SERVER,
        phienBan: PHIEN_BAN,
        // Tin báo cho Claude kèm sẵn trích đoạn tin gốc khi anh reply một tin
        // cũ. Trước đây `channel.js` phải bắc cầu qua biến cấp module trong
        // `mcp/tools.js` vì file này bị pane khác giữ — cầu đó nay ĐÃ XOÁ.
        replyContext: (requestId) => replyContext(db, requestId),
        registerTools: (server) =>
          registerTools(server, {
            db,
            cauHinh,
            boTichLuy,
            api,
            docSucKhoe: () => readHealth(cauHinh.duongDan.health),
          }),
        khiSanSang: () => {
          // Claude vừa bắt tay xong -> đẩy bù câu hỏi còn 'cho'.
          pushPendingQueue({
            db,
            queueTtlMs: cauHinh.thoiGian.queueTtlMs,
            guiThongBao: channel.guiThongBao,
            takePendingQueue,
            updateQueueState,
            tenHoiThoai,
            // 🔴 A7 — câu hỏi quá hạn phải ĐƯỢC BÁO, không chỉ ghi sổ rồi thôi.
            baoHetHan: (loiNhan) => baoHostDaemon(loiNhan),
          }).catch((e) => log(`đẩy bù hàng đợi thất bại: ${safeLogText(e)}`));
        },
      });

      // ═══ 🔴 v11 — LƯỚI VỚT cũng phải có ở chế độ MỘT TIẾN TRÌNH ═══
      // Ở đây tin đi thẳng qua `guiThongBao` (fire-and-forget), và `ok === true`
      // chỉ nghĩa là ĐÃ ĐẨY — ⛔ không nghĩa là ĐÃ TỚI. Phiên Claude chưa bắt
      // tay xong thì tin rơi vào khoảng trống y hệt chế độ tách, và dòng nằm
      // lại `da_day` cho tới lần bắt tay sau. Xem `ops/rescue_orphans.js`.
      const soVotDaemon = createRescueLedger({
        log: (s) => log(`[vớt] ${s}`),
        notifyHost: (s) => { baoHostDaemon(s).catch(() => {}); },
      });
      hen.push(setInterval(() => {
        pushPendingQueue({
          db,
          queueTtlMs: cauHinh.thoiGian.queueTtlMs,
          guiThongBao: channel.guiThongBao,
          takePendingQueue,
          updateQueueState,
          tenHoiThoai,
          gomDaDay: true,
          tuoiMoCoiMs: ORPHAN_AGE_MS,
          choPhepDay: (r) => soVotDaemon.choPhep(r),
          baoHetHan: (loiNhan) => baoHostDaemon(loiNhan),
        }).catch((e) => log(`lưới vớt lỗi (đã nuốt): ${safeLogText(e)}`));
      }, RESCUE_TICK_MS));
      log(`lưới vớt BẬT: mỗi ${RESCUE_TICK_MS / 1000}s, vớt dòng quá ${ORPHAN_AGE_MS / 1000}s`);
    }

    // ═══ 🔴 v10.2 — SỔ MỞ PHIÊN (panel-mỗi-nhóm) ═══
    // ⚠️ Chỉ DAEMON giữ sổ này — nó là bên duy nhất thấy mọi tin đến. Client
    // ⛔ không mở pane cho ai (nó còn không biết có nhóm nào khác).
    // ⚠️ `moPhienLenh: null` ⇒ `baoDam()` không gọi gì cả, chỉ ghi sổ chạm.
    // ⛔ Pack KHÔNG biết lệnh bên kia là gì — nó chỉ chạy chuỗi người ta khai,
    // qua `runNotifyCommand` (đã có sẵn trần thời gian + giết khi treo).
    const { runNotifyCommand: _chayLenh } = await import('./ops/notify_host.js');
    const soMoPhien = createPaneLedger({
      lenh: cauHinh.tichHop?.moPhienLenh ?? null,
      tranSoClient: cauHinh.tranSoClient,
      nghiSauGio: cauHinh.nghiSauGio,
      log,
      chay: (duLieu) => _chayLenh(cauHinh.tichHop.moPhienLenh, duLieu, HAN_MO_PHIEN_MS),
    });
    if (cauHinh.tichHop?.moPhienLenh) {
      log(`panel-mỗi-nhóm BẬT: trần ${cauHinh.tranSoClient} phiên, `
        + `dự phòng nhảy vào sau ${GIAN_CHO_MO_PANE_MS}ms`);
    }

    // ═══ 🔴 TỰ CẤU HÌNH KHI BỊ THÊM VÀO NHÓM MỚI ═══
    // Luật anh chốt 21/08/2026. Cửa chặn "ai thêm" nằm trong `ops/new_group.js`
    // — đọc khối đầu file đó trước khi sửa gì ở đây.
    // ⚠️ CHỈ daemon làm việc này: nó là bên duy nhất thấy `group_event`, và
    // hai tiến trình cùng ghi một file config là hỏng file.
    const duongDanConfig = configPath(co.config);
    const tuCauHinhNhomMoi = (sk) => {
      const n = decideNewGroup({
        sk,
        cauHinh,
        uidTroLy: toId(api?.getOwnId?.(), 'index.uidTroLy'),
      });
      if (!n) return;

      const kq = addGroupToConfig(duongDanConfig, n);
      if (!kq.daThem) { log(`nhóm mới ${n.chatId}: ${kq.lyDo}`); return; }

      // ⚠️ ⛔ KHÔNG tự sửa `cauHinh` trong RAM ở đây: bộ NẠP NÓNG đang soi file
      // và sẽ áp trong vài giây — sửa cả hai nơi là hai nguồn sự thật, và cái
      // sai sẽ là cái ⛔ không ai kiểm.
      log(`nhóm mới ${n.chatId} (${n.ten ?? '?'}) -> đã ghi config `
        + `(${n.doHostThem ? 'HOST thêm: bật đủ' : 'người khác thêm: CHỈ NGHE'})`);

      // ═══ 🔴 MỞ PANE NGAY, ⛔ ĐỪNG ĐỢI TIN ĐẦU TIÊN ═══
      // ⛔ Bản đầu ⛔ không có khối này: pane chỉ mọc khi nhóm có tin, nên câu
      // đầu tiên anh nhắn vào nhóm mới phải nằm chờ tới 37 giây (ngưỡng dự
      // phòng) mới có ai trả lời. Mà câu đầu tiên trong một nhóm vừa lập chính
      // là câu người ta để ý nhất.
      // ⚠️ Chỉ mở khi được phép NÓI. Nhóm "chỉ nghe" (người lạ thêm) mà dựng
      // sẵn pane là tốn một phiên Claude cho việc ⛔ không ai cho phép làm.
      if (n.traLoiKhiTag && soMoPhien) {
        soMoPhien.baoDam(n.chatId, { tenNhom: n.ten, lyDo: 'nhom-moi' })
          .catch((e) => log(`mở pane cho nhóm mới ${n.chatId} lỗi (đã nuốt): ${safeLogText(e)}`));
      }

      baoHostDaemon(newGroupHostMessage(n), { tieuDe: 'Trợ lý Zalo vào nhóm mới' }).catch(() => {});
    };

    // ⑥ gắn 4 listener
    const boPhat = new EventEmitter();
    attachMessageHandlers({
      boPhat,
      db,
      cauHinh,
      guiThongBao: channel ? channel.guiThongBao : null,
      tenHoiThoai,
      soMoPhien,
      tuCauHinhNhomMoi,
    });
    startListening(api, cauHinh, boPhat, { tuBatDau: true });
    log('đã gắn 4 listener và bật websocket');

    // ⑦ keepAlive
    hen.push(
      setInterval(() => {
        keepAlive(api).catch(() => {});
      }, cauHinh.thoiGian.keepAliveMs),
    );

    // ⑧ watchdog — `() => api` chứ không phải `api`: nối lại xong thì api là
    // đối tượng MỚI, giữ cứng tham chiếu cũ là soi một socket chết vĩnh viễn.
    wd = createWatchdog({
      api: () => api,
      cauHinh,
      kiemKeepAlive: () => keepAlive(api),
      khiCanNoiLai: async () => {
        try {
          stopListening(api);
        } catch { /* nuốt */ }
        api = await loginWithCookie(cauHinh);
        startListening(api, cauHinh, boPhat, { tuBatDau: true });
      },
      ghiSucKhoe: (tt) => {
        try {
          writeHealth(cauHinh.duongDan.health, tt);
        } catch (e) {
          log(`ghi health thất bại: ${safeLogText(e)}`);
        }
      },
      // ⚠️ Watchdog TRUYỀN `(maCuoi, toanLoiMang)` — bản cũ ở đây bỏ qua cả hai
      // và DM một chuỗi CỨNG, nên dù watchdog vừa kết luận KHONG_BIET (toàn
      // lỗi mạng) thì anh vẫn nhận đúng câu giục quét QR. Xem chú thích ở
      // `zalo/watchdog.js` quanh chỗ gọi.
      khiHetCach: (maCuoi, toanLoiMang) =>
        baoHostDaemon(
          toanLoiMang
            ? 'Nối lại 5 lần đều hỏng, nhưng TOÀN là lỗi mạng — CHƯA kết luận được cookie '
              + 'đã chết. ĐỪNG quét QR vội: tài khoản chỉ có một suất máy tính, quét lúc '
              + 'phiên còn sống là tự đá văng phiên đang chạy. Kiểm mạng trước.'
            : 'Nối lại 5 lần đều hỏng — cookie có thể đã chết, cần quét QR lại.',
          {
            tieuDe: toanLoiMang
              ? 'Trợ lý Zalo mất kết nối (chưa rõ nguyên nhân)'
              : 'Trợ lý Zalo cần quét QR',
          },
        ).catch(() => { void maCuoi; }),
    });
    wd.batDau();

    // ═══ ⑧b NẠP NÓNG CẤU HÌNH ═══
    // 🔴 Thêm một nhóm vào config mà phải restart thì restart giết luôn phiên
    // Zalo đang khoẻ + sổ mở-phiên trong RAM + mọi câu hỏi đang bay. Xem khối
    // đầu `ops/hot_reload.js` để biết trường nào nạp nóng được và VÌ SAO trường
    // còn lại thì ⛔ không.
    napNong = createHotReloader({
      duongDan: configPath(co.config),
      dich: cauHinh,
      readConfig,
      log: (s) => log(`[nạp nóng] ${s}`),
      notifyHost: (s) => { baoHostDaemon(s).catch(() => {}); },
    });
    log(`nạp nóng cấu hình BẬT — soi ${configPath(co.config)}`);

    // Dọn bộ tích luỹ nguồn theo TUỔI. Ngưỡng phải ≥ queueTtlMs để lúc xoá
    // thì hàng đợi trong DB cũng đã 'het_han' — hai đồng hồ khớp nhau, không
    // để phiên còn sống bị mất dấu nguồn (mất dấu ở đây là fail-OPEN).
    hen.push(
      setInterval(() => {
        sweepStale(boTichLuy, Math.max(cauHinh.thoiGian.queueTtlMs * 2, 3_600_000));
      }, 300_000),
    );

    // ⑩ v3 — MỐC A0: phép thử API tự viết, CHẠY ĐÚNG MỘT LẦN, mặc định TẮT.
    // Router bật bằng ZTL_PROBE_A0=1 rồi đọc ~/.zalo-tro-ly/probe_a0.json.
    // Đặt SAU listener để phiên chắc chắn đã sẵn sàng, và bọc catch để A0 hỏng
    // KHÔNG BAO GIỜ làm chết trợ lý — nó là phép đo, không phải điều kiện sống.
    {
      const { isProbeA0Enabled, runProbeA0, pickTestGroup, probeResultPath } = await import('./scan/probe_a0.js');
      if (isProbeA0Enabled()) {
        const nhomThu = pickTestGroup(db);
        if (!nhomThu) {
          log('A0: không có nhóm nào đang nghe có tin -> BỎ QUA, không gọi mạng');
        } else {
          log(`A0: chạy phép thử trên nhóm ${nhomThu} (đúng MỘT lần)`);
          runProbeA0({
            api, db, chatId: nhomThu,
            duongDanRa: probeResultPath(cauHinh.duongDan.db),
          }).catch((e) => log(`A0 ném lỗi (đã nuốt): ${safeLogText(e)}`));
        }
      }
    }

    // ⑪ v3 — QUÉT ĐỐI CHIẾU THU HỒI. Mặc định TẮT: A0 chưa xanh thì tuyệt đối
    // không được tự chạy. Bật bằng ZTL_QUET_DOI_CHIEU=1.
    {
      const { isScanEnabled, runScanPass } = await import('./scan/drift_check.js');
      const { GIOI_HAN_QUET } = await import('./lib/hang_so.js');
      if (isScanEnabled()) {
        log(`quét đối chiếu: BẬT, chu kỳ ${Math.round(GIOI_HAN_QUET.CHU_KY_QUET_MS / 60000)} phút`);
        hen.push(
          setInterval(() => {
            runScanPass({
              db, api,
              notifyHost: (s) => { baoHostDaemon(s).catch(() => {}); },
            }).catch((e) => log(`quét đối chiếu lỗi (đã nuốt): ${safeLogText(e)}`));
          }, GIOI_HAN_QUET.CHU_KY_QUET_MS),
        );
      } else {
        log('quét đối chiếu: TẮT (đặt ZTL_QUET_DOI_CHIEU=1 để bật, sau khi A0 xanh)');
      }
    }

    // ⑫ v3 — BỘ CHẠY LỊCH HẸN. KHÔNG phụ thuộc phần quét: A0 hỏng hẳn thì
    // tính năng này vẫn phải chạy bình thường.
    {
      const { isSchedulerEnabled, runOneTick, runFollowUpTick, TICK_MS } = await import('./lich/runner.js');
      const { groupMembers, queryHistory } = await import('./store/query.js');
      const { sendToGroup, sendHostDm } = await import('./zalo/send.js');
      const { primaryHostDm } = await import('./ops/notify_host.js');
      const { writeReminderBook } = await import('./lich/follow_up.js');
      if (isSchedulerEnabled()) {
        const uidTroLy = toId(api?.getOwnId?.(), 'index.uidTroLy');
        const ghiLaiTin = (t) => {
          try { writeMessage(db, t, { doTroLyTao: true }); } catch (e) {
            log(`ghi lại tin nhắc thất bại: ${safeLogText(e)}`);
          }
        };
        // ═══ 🔴 B2 — BỘ ĐẾM PHẢI CÓ ĐƯỜNG RA ═══
        // Cả hai bộ chạy đều trả về `{..., loi}` đếm cẩn thận số lần gửi hỏng,
        // nhưng bản cũ gọi chúng bằng `.catch(...)` và VỨT LUÔN GIÁ TRỊ TRẢ VỀ.
        // Có bộ đếm mà không ai đọc thì bot bị kick khỏi nhóm / mất mạng / Zalo
        // đổi giao thức đều diễn ra trong im lặng: mỗi nhịp `loi += 1` rồi thôi.
        // Với nhịp NGÀY thì một lời nhắc "đuổi tới khi xong" có thể hỏng 10 ngày
        // liền rồi tự đóng bằng HET_LUOT — và host được báo là "đã nhắc đủ 10 lần".
        //
        // Ngưỡng 2 LẦN LIÊN TIẾP, không phải 1: một lần hỏng thường là mạng chớp,
        // báo ngay thì thành phiền và người ta học cách bỏ qua cảnh báo.
        // Báo ĐÚNG MỘT LẦN cho mỗi đợt hỏng (im cho tới khi gửi lại được) —
        // nếu không thì nhịp 30 giây sẽ nhắn host 120 tin một giờ.
        const demLoiGui = createSendFailureCounter((loiNhan) => baoHostDaemon(loiNhan));

        hen.push(
          setInterval(() => {
            runOneTick({
              db, api, sendToGroup, sendHostDm, groupMembers,
              uidTroLy,
              dmHostChatId: primaryHostDm(cauHinh),
              ghiLai: ghiLaiTin,
            })
              .then((ra) => demLoiGui('lịch một lần', ra))
              .catch((e) => log(`bộ chạy lịch lỗi (đã nuốt): ${safeLogText(e)}`));

            // v4 — lời nhắc THEO ĐUỔI. Cùng nhịp, nhưng đường riêng: lịch một
            // lần hỏng thì lời nhắc theo đuổi vẫn chạy và ngược lại.
            runFollowUpTick({
              db, api, sendToGroup, sendHostDm, groupMembers, queryHistory,
              uidTroLy,
              ghiLai: ghiLaiTin,
              // Có phiên Claude thì giao model viết câu (câu hôm nay phải khác
              // hôm qua); không có thì code tự gửi câu dự phòng.
              guiThongBao: channel ? channel.guiThongBao : null,
              enqueueQuestion,
              // 🔴 B5 — NẠP ĐẠN CHO LÁ CHẮN CHỐNG RÒ CHÉO.
              // `reminderContext` bơm dữ liệu THẲNG vào context model, không đi
              // qua tool nào ⇒ đi vòng qua chỗ `mcp/tools.js` khai nguồn. Thiếu
              // dòng này thì `bo_chay` fail-closed: bối cảnh chạm nhóm khác là
              // KHÔNG giao model — không rò, nhưng lời nhắc mất giọng model.
              // ⚠️ `boTichLuy` phải là ĐÚNG bộ đang dùng ở `registerTools` (dựng ở
              // ⑨-chuẩn bị) — hai bộ khác nhau thì `leak_guard` tra một sổ,
              // `bo_chay` ghi vào sổ kia, và lá chắn lại mù đúng ca cần nó.
              recordSources: bindRecordSources(boTichLuy),
              // 🔴 DÂY TREO THỨ HAI (tìm thấy 21/08/2026 khi rà `p.*`).
              // `_baoHetLuot()` — câu DM báo "lời nhắc dừng vì HẾT LƯỢT, KHÔNG
              // phải vì việc đã xong" — chỉ được gọi từ CHÍNH `runFollowUpTick`,
              // và nó cần `p.dmHostChatId`. Nhưng chỗ gọi này chưa truyền, nên
              // nó rơi thẳng vào nhánh `_log('... host sẽ không biết')`.
              // ⇒ Lời nhắc tiêu đủ 10 lượt rồi TỰ ĐÓNG trong im lặng, host tưởng
              //   việc đã xong. Đúng thứ chú thích ở `runner.js` gọi là "nguy
              //   hiểm nhất của tính năng này".
              // (`runOneTick` ngay phía trên đã truyền tham số này từ đầu —
              //  lệch giữa hai chỗ gọi là dấu hiệu bỏ sót, không phải cố ý.)
              dmHostChatId: primaryHostDm(cauHinh),
            })
              .then((ra) => demLoiGui('nhắc theo đuổi', ra))
              .catch((e) => log(`bộ chạy lời nhắc theo đuổi lỗi (đã nuốt): ${safeLogText(e)}`));
          }, TICK_MS),
        );
        log(`bộ chạy lịch hẹn: BẬT, nhịp ${Math.round(TICK_MS / 1000)} giây`);

        // Sổ nhắc dễ đọc — SQL vẫn là GỐC, file chỉ để anh liếc. Sinh lại mỗi
        // 5 phút và ngay lúc khởi động, KHÔNG có đường đọc ngược từ file vào DB.
        const soNhac = path.join(path.dirname(expandPath(cauHinh.duongDan.db)), 'so_nhac.md');
        const veSo = () => {
          try { writeReminderBook(db, soNhac); } catch (e) {
            log(`sinh sổ nhắc thất bại (bỏ qua): ${safeLogText(e)}`);
          }
        };
        veSo();
        hen.push(setInterval(veSo, 300_000));
      } else {
        log('bộ chạy lịch hẹn: TẮT (ZTL_LICH_HEN=0)');
      }
    }

    // ⑨ nối stdio MCP — TỪ ĐÂY TRỞ ĐI một dòng console.log là hỏng cả phiên
    // ⑬ v7 — RÚT OUTBOX. Chỉ ở chế độ TÁCH: đây là chỗ DUY NHẤT chạm Zalo,
    // và là chỗ throttle được thi hành TOÀN CỤC (xem chú thích ở `drainOutbox`).
    if (che.cheDo === CHE_DO.TACH) {
      const { sendInParts } = await import('./zalo/send.js');
      const { TRAN_BYTE_TIN_ZALO } = await import('./lib/hang_so.js');
      const { groupMembers } = await import('./store/query.js');
      const {
        takePendingOutbound, claimOutbound, writeSendResult, requeueOutbound,
      } = await import('./store/write.js');
      const { conversationKind } = await import('./store/query.js');
      const uidTL = toId(api?.getOwnId?.(), 'index.uidTroLy');

      hen.push(setInterval(() => {
        drainOutbox({
          db,
          log,
          kho: { takePendingOutbound, claimOutbound, writeSendResult, requeueOutbound },
          // ⚠️ Báo host đi thẳng qua `xepHangDm` chứ ⛔ KHÔNG gọi lại
          // `enqueueOutbound`: lời báo "một tin ⛔ không gửi được" mà cũng đi
          // vào đúng hàng đợi vừa hỏng thì nó cũng hỏng theo, và anh ⛔ không
          // bao giờ biết. Câu báo cố ý NGẮN, ít định dạng, để nó nhẹ nhất có thể.
          baoHost: (loi) => baoHostDaemon(loi),
          gui: async (chatId, text, uids, tranByte) => {
            // Chọn ĐÚNG kiểu luồng — bài học 21/08: `HUONG_TRA_LOI.NHOM` nghĩa
            // là "trả lời nơi đã hỏi", KHÔNG có nghĩa "nơi đó là một nhóm".
            const laDm = conversationKind(db, chatId) === LOAI_HOI_THOAI.DM;
            const tuyChon = {
              ghiLai: (t) => { try { writeMessage(db, t, { doTroLyTao: true }); } catch { /* nuốt */ } },
              uidTroLy: uidTL,
              ...(laDm ? {} : { dsNguoi: groupMembers(db, chatId) }),
            };
            void uids;
            // 🔴 PHẢI đi qua `sendInParts`, ⛔ ĐỪNG gọi thẳng `sendToGroup`/
            // `sendHostDm` như trước 26/08/2026. Hai hàm kia gửi NGUYÊN CỤC:
            // tin vượt trần byte của Zalo bị TỪ CHỐI, outbox ghi `loi` rồi
            // thôi — ⛔ không chia, ⛔ không thử lại, ⛔ không báo ai. Đo được
            // 2 tin thật đã mất y như vậy (2.051 và 1.965 ký tự) trước khi
            // chính anh hỏi "sao không trả lời".
            // `tranByte` là thứ khiến nó chia ĐÚNG: Zalo đếm byte, ⛔ không
            // đếm ký tự.
            // `tranByte` do tầng thử lại quyết: lượt sau lại nhỏ hơn lượt trước.
            // Bỏ trống ⇒ dùng trần mặc định (lượt đầu).
            return sendInParts(api, chatId, text, {
              ...tuyChon, laDm, tranByte: tranByte || TRAN_BYTE_TIN_ZALO,
            });
          },
        }).catch((e) => log(`[daemon] rút outbox lỗi (đã nuốt): ${safeLogText(e)}`));
      }, 2000));
      log('[daemon] bật vòng rút outbox (2 giây/nhịp)');
    }

    if (channel) {
      await channel.khoiDong();
      log('đã nối stdio MCP');
    } else if (che.cheDo === CHE_DO.TACH) {
      log('[daemon] chế độ tách: KHÔNG nối MCP ở daemon — phiên Claude nối vào client');
    } else {
      log('--khong-mcp: chạy daemon ghi lịch sử thuần, không nối MCP');
    }

    writeHealth(cauHinh.duongDan.health, {
      trangThai: TRANG_THAI_SUC_KHOE.OK,
      lyDo: 'khởi động xong',
    });

    for (const tin of ['SIGINT', 'SIGTERM']) {
      process.on(tin, () => {
        log(`nhận ${tin} -> tắt sạch`);
        dongSach();
        process.exit(EXIT_CODE.OK);
      });
    }

    // Giữ tiến trình sống. `setInterval` ở trên đã đủ giữ event loop, đây chỉ
    // là promise không bao giờ giải để `main()` không trả về sớm.
    await new Promise(() => {});
    return EXIT_CODE.OK;
  } catch (e) {
    log(`KHỞI ĐỘNG THẤT BẠI: ${e?.message ?? e}`);
    dongSach();
    // @ts-ignore — maThoat do acquirePidLock gắn
    if (e?.maThoat) return e.maThoat;
    // Lỗi từ readConfig (validate) là lỗi CẤU HÌNH, không phải lỗi chung.
    if (/[Cc]ấu hình|hosts|cauTrungTinh|MỞ TOANG|config/.test(String(e?.message ?? ''))) {
      return EXIT_CODE.CAU_HINH_SAI;
    }
    return EXIT_CODE.LOI_CHUNG;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv)
    .then((ma) => {
      process.exitCode = ma;
    })
    .catch((e) => {
      process.stderr.write(`${e?.message ?? e}\n`);
      process.exitCode = EXIT_CODE.LOI_CHUNG;
    });
}
