/**
 * G2 — test cho src/zalo/listener.js. KHÔNG mạng, KHÔNG đăng nhập Zalo.
 *
 * `api` giả chỉ cần đúng phần hợp đồng mà file này chạm tới: `api.listener`
 * có `on` / `off` / `start`. Cố ý KHÔNG dùng EventEmitter thật cho `api` để
 * bài test kiểm được CHÍNH XÁC handler nào được gắn/gỡ.
 *
 *     node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  batDauNghe,
  dungNghe,
  lanCuoiNhanSuKien,
  dangNghe,
  SU_KIEN_ZCA,
  _datLaiChoTest,
} from '../src/zalo/listener.js';
import { SU_KIEN, HANH_DONG_GATE } from '../src/lib/hang_so.js';
import { quyetDinh, LY_DO as LY_DO_GATE } from '../src/policy/gate.js';

const HOST = '9876543210';
const CHAT_ID = '9990000000001';
// uid THẬT của tài khoản bot "Hải Ai" (đo trên hệ thật 20/08/2026). BOT và
// HOST là HAI TÀI KHOẢN KHÁC NHAU — tiền đề "bot = host" đã rò vào mã 4 lần.
const BOT = '999200000000000002';

function apiGia(uidBot) {
  const gan = new Map();   // tên -> Set<fn>
  return {
    daStart: 0,
    // api THẬT của zca-js luôn có getOwnId() (đồng bộ, trả ctx.uid). api giả
    // mà thiếu nó thì test chạy trên một nhánh KHÔNG có thật — đúng kiểu đã
    // để lọt bug `webchat`. `null` = cố ý dựng ca "không đọc được uid".
    ...(uidBot === null ? {} : { getOwnId: () => uidBot }),
    listener: {
      on(ten, fn) {
        if (!gan.has(ten)) gan.set(ten, new Set());
        gan.get(ten).add(fn);
      },
      off(ten, fn) {
        gan.get(ten)?.delete(fn);
      },
      start() {
        // eslint-disable-next-line no-invalid-this
        this._chu.daStart += 1;
      },
      _gan: gan,
      /** phát như zca-js phát: gọi thẳng handler */
      _ban(ten, tho) {
        for (const fn of gan.get(ten) ?? []) fn(tho);
      },
      _dem(ten) {
        return gan.get(ten)?.size ?? 0;
      },
    },
  };
}

function moiApi(uidBot = BOT) {
  const a = apiGia(uidBot);
  a.listener._chu = a;
  return a;
}

const CAU_HINH = {
  hosts: [{ userId: HOST, ten: 'Anh', dmChatId: 'dm1' }],
  groups: [{ chatId: CHAT_ID, ten: 'Nhóm A', ghiLichSu: true, traLoiKhiTag: true }],
};

function tinNhom(ghiDeData = {}) {
  return {
    type: 1,
    threadId: CHAT_ID,
    isSelf: false,
    data: {
      msgId: '9990000000001666',
      cliMsgId: '111',
      msgType: 'chat.text',
      uidFrom: '555',
      dName: 'Người A',
      ts: '1755678901234',
      content: 'chào cả nhà',
      ...ghiDeData,
    },
  };
}

/** Nuốt stderr trong lúc chạy fn — file này cố ý kêu nhiều ra stderr. */
function imLang(fn) {
  const goc = process.stderr.write.bind(process.stderr);
  const keu = [];
  process.stderr.write = (s) => { keu.push(String(s)); return true; };
  try {
    return { kq: fn(), keu };
  } finally {
    process.stderr.write = goc;
  }
}

function dungBo(uidBot = BOT) {
  _datLaiChoTest();
  const api = moiApi(uidBot);
  const boPhat = new EventEmitter();
  const nhan = { tin: [], thuHoi: [], reaction: [], nhom: [], loi: [] };
  boPhat.on(SU_KIEN.TIN_NHAN, (x) => nhan.tin.push(x));
  boPhat.on(SU_KIEN.THU_HOI, (x) => nhan.thuHoi.push(x));
  boPhat.on(SU_KIEN.REACTION, (x) => nhan.reaction.push(x));
  boPhat.on(SU_KIEN.SU_KIEN_NHOM, (x) => nhan.nhom.push(x));
  boPhat.on(SU_KIEN.LOI, (x) => nhan.loi.push(x));
  return { api, boPhat, nhan };
}

// ═══ A. Gắn dây ═══
test('A1 gắn ĐÚNG 4 listener, đúng tên của zca-js', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  for (const ten of Object.values(SU_KIEN_ZCA)) {
    assert.equal(api.listener._dem(ten), 1, `thiếu/thừa handler cho '${ten}'`);
  }
  assert.equal(api.listener._gan.size, 4, 'gắn thừa listener ngoài 4 cái được giao');
});

test('A2 KHÔNG tự gọi start() — gọi 2 lần là mở 2 websocket, ghi tin ĐÔI', () => {
  const { api, boPhat } = dungBo();
  const { keu } = imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  assert.equal(api.daStart, 0);
  assert.ok(keu.join('').includes('api.listener.start()'), 'phải NHẮC G8, không im lặng');
});

test('A3 tuBatDau: true thì mới gọi start()', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat, { tuBatDau: true }));
  assert.equal(api.daStart, 1);
});

test('A4 gắn hai lần trên CÙNG api -> NÉM (chống ghi tin đôi)', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  assert.throws(() => batDauNghe(api, CAU_HINH, boPhat), /hai lần|đã chạy rồi/);
});

test('A5 api MỚI (nối lại phiên) -> tự gỡ dây cũ rồi gắn dây mới', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  const api2 = moiApi();
  imLang(() => batDauNghe(api2, CAU_HINH, boPhat));
  assert.equal(api.listener._dem('message'), 0, 'dây cũ còn -> mỗi tin vào DB hai lần');
  assert.equal(api2.listener._dem('message'), 1);
});

test('A6 api không có listener -> lỗi SẠCH, không nổ TypeError khó hiểu', () => {
  _datLaiChoTest();
  assert.throws(() => batDauNghe({}, CAU_HINH, new EventEmitter()), /api\.listener/);
});

test('A7 config KHÔNG có host -> vẫn chạy nhưng phải KÊU (trợ lý sẽ câm)', () => {
  const { api, boPhat } = dungBo();
  const { keu } = imLang(() => batDauNghe(api, { hosts: [], groups: [] }, boPhat));
  assert.ok(keu.join('').includes('KHÔNG có host'));
});

// ═══ B. Định tuyến 4 sự kiện ═══
test('B1 message -> SU_KIEN.TIN_NHAN, payload là TinChuanHoa (KHÔNG rò payload thô)', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', tinNhom()));
  assert.equal(nhan.tin.length, 1);
  const t = nhan.tin[0];
  assert.equal(t.noiDung, 'chào cả nhà');
  assert.equal(t.data, undefined, 'payload thô zca-js KHÔNG được rò ra khỏi normalize');
  assert.equal(t.threadId, undefined);
});

test('B2 undo -> SU_KIEN.THU_HOI, ghép đúng vào msgId của tin trước đó', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => {
    api.listener._ban('message', tinNhom());
    api.listener._ban('undo', {
      threadId: CHAT_ID, isSelf: false, isGroup: true,
      data: { msgId: 'EVT-1', uidFrom: '555', ts: '1755678999999',
        content: { globalMsgId: 9990000000001666, cliMsgId: 111 } },
    });
  });
  assert.equal(nhan.thuHoi[0].msgIdDich, nhan.tin[0].msgId);
  assert.notEqual(nhan.thuHoi[0].eventId, nhan.thuHoi[0].msgIdDich);
});

test('B3 reaction + group_event đi đúng kênh của nó', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => {
    api.listener._ban('reaction', {
      threadId: CHAT_ID,
      data: { uidFrom: '5', ts: '1', content: { rMsg: [{ gMsgID: '77' }], rIcon: '/-heart' } },
    });
    api.listener._ban('group_event', {
      type: 'join', threadId: CHAT_ID, data: { groupId: CHAT_ID, time: '1' },
    });
  });
  assert.equal(nhan.reaction[0].msgIdDich, '77');
  assert.equal(nhan.nhom[0].loai, 'JOIN');
  assert.equal(nhan.loi.length, 0);
});

// ⚠️ Bản cũ của B4 tên là "tin có tag HOST ..." và assert `true` khi mentions
// trỏ vào uid HOST. Bài đó MÃ HOÁ CHÍNH CON BUG: trong `mentions`, `uid` là
// người BỊ tag (= tài khoản BOT), host là người ĐI tag. Bài xanh suốt trong
// khi trợ lý câm tuyệt đối trên hệ thật.
test('B4 host tag TRỢ LÝ -> coTagHost = true (điều kiện kích hoạt spec B)', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  // Payload THẬT, nhóm Haceco KT: "Test tag @Hảis Assistant"
  imLang(() => api.listener._ban('message', tinNhom({
    uidFrom: HOST,
    content: 'Test tag @Hảis Assistant',
    mentions: [{ uid: BOT, pos: 9, len: 15, type: 0 }],
  })));
  assert.equal(nhan.tin[0].coTagHost, true, 'anh tag trợ lý mà cờ ra 0 = trợ lý câm vĩnh viễn');
});

test('B4b tag NGƯỜI KHÁC (kể cả tag chính host) KHÔNG kích hoạt trợ lý', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', tinNhom({
    mentions: [{ uid: HOST, pos: 0, len: 3, type: 0 }],
  })));
  assert.equal(nhan.tin[0].coTagHost, false, 'tag host KHÔNG phải là tag trợ lý');
});

test('B4c KHÔNG đọc được uid bot -> FAIL-CLOSED: luôn false + KÊU, cấm lùi về so với host', () => {
  const { api, boPhat, nhan } = dungBo(null);   // api giả KHÔNG có getOwnId
  const { keu } = imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  assert.ok(
    keu.join('').includes('getOwnId'),
    'câm mà không kêu thì không ai biết trợ lý đang hỏng',
  );

  // Tin tag ĐÚNG uid host: nhánh lùi cũ sẽ cho ra true. Phải là false.
  imLang(() => api.listener._ban('message', tinNhom({
    mentions: [{ uid: HOST, pos: 0, len: 3, type: 0 }],
  })));
  assert.equal(nhan.tin[0].coTagHost, false, 'lùi về so với host là tái tạo lại đúng con bug');

  // Vẫn NGHE và vẫn GHI bình thường — fail-closed chỉ chặn việc TRẢ LỜI.
  assert.equal(nhan.tin[0].noiDung, 'chào cả nhà');
});

test('B4e getOwnId trả "0" (sentinel "self" của zca-js) KHÔNG phải uid hợp lệ', () => {
  // zca-js dùng "0" làm chỗ trống nghĩa là "chính mình" (Message.js thay nó
  // bằng uid thật). Nhận "0" làm uid trợ lý là so mentions với một chuỗi
  // không thuộc về ai -> câm, mà lại tưởng đã lấy được uid.
  const { api, boPhat, nhan } = dungBo('0');
  const { keu } = imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  assert.ok(keu.join('').includes('getOwnId'), 'phải rơi vào nhánh FAIL-CLOSED và kêu');
  imLang(() => api.listener._ban('message', tinNhom({
    mentions: [{ uid: HOST, pos: 0, len: 3, type: 0 }],
  })));
  assert.equal(nhan.tin[0].coTagHost, false);
});

test('B4d hai tầng phối hợp: người KHÔNG phải host tag trợ lý -> cờ true nhưng GATE CHẶN', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', tinNhom({
    uidFrom: '555',                                   // người lạ trong nhóm
    mentions: [{ uid: BOT, pos: 0, len: 3, type: 0 }],
  })));
  const tin = nhan.tin[0];
  assert.equal(tin.coTagHost, true, 'normalize chỉ trả lời "có tag trợ lý không"');

  const kq = quyetDinh(tin, CAU_HINH);
  // 🔴 ĐỔI v9: người lạ tag trợ lý nay được NGHE (tạo lượt) chứ không bị vứt.
  // Phần "gate lọc người gửi, normalize không lọc" vẫn nguyên — chỉ khác là
  // gate nay trả `nghe` thay vì `drop`, và `nghe` KHÔNG có đường ra Zalo.
  assert.equal(kq.action, HANH_DONG_GATE.NGHE, 'lọc người gửi là việc của gate, không phải normalize');
  assert.equal(kq.payload.lyDo, LY_DO_GATE.NGHE_NGUOI_KHAC);
  assert.notEqual(kq.action, HANH_DONG_GATE.ALLOW, '⛔ người lạ TUYỆT ĐỐI không được `allow`');

  // Đối chứng: cùng tin đó nhưng host gửi thì mới qua.
  const kqHost = quyetDinh({ ...tin, userId: HOST }, CAU_HINH);
  assert.equal(kqHost.action, HANH_DONG_GATE.ALLOW);
});

// ═══ C. Lỗi KHÔNG được giết tiến trình ═══
test('C1 payload dị dạng -> phát SU_KIEN.LOI, KHÔNG ném ra websocket', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', { threadId: null, data: {} }));
  assert.equal(nhan.tin.length, 0);
  assert.equal(nhan.loi.length, 1);
  assert.match(nhan.loi[0].message, /message/);
});

test('C2 mốc "còn sống" cập nhật NGAY CẢ KHI chuẩn hoá hỏng', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  assert.equal(lanCuoiNhanSuKien(), null, 'chưa nhận gì thì phải là null');
  imLang(() => api.listener._ban('message', { threadId: null, data: {} }));
  assert.ok(lanCuoiNhanSuKien() > 0,
    'tin dị dạng vẫn là bằng chứng websocket còn sống — coi là im lặng thì watchdog nối lại vô cớ');
});

test('C3 BÊN NHẬN ném lỗi (G3 ghi DB hỏng) cũng không nổ ngược lên listener', () => {
  _datLaiChoTest();
  const api = moiApi();
  const boPhat = new EventEmitter();
  const loi = [];
  boPhat.on(SU_KIEN.TIN_NHAN, () => { throw new Error('DB đầy'); });
  boPhat.on(SU_KIEN.LOI, (e) => loi.push(e));
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', tinNhom()));  // KHÔNG được ném ra đây
  assert.equal(loi.length, 1);
  assert.match(loi[0].message, /DB đầy/);
});

test('C4 không ai nghe SU_KIEN.LOI thì cũng không được nổ', () => {
  _datLaiChoTest();
  const api = moiApi();
  const boPhat = new EventEmitter();   // KHÔNG gắn handler 'loi'
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', { threadId: null, data: {} }));
  assert.ok(true, 'tới được đây là đạt');
});

test('C5 một tin hỏng KHÔNG chặn tin kế tiếp', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => {
    api.listener._ban('message', { threadId: null, data: {} });
    api.listener._ban('message', tinNhom());
  });
  assert.equal(nhan.tin.length, 1);
  assert.equal(nhan.loi.length, 1);
});

// ═══ D. Gỡ dây ═══
test('D1 dungNghe gỡ đúng 4 handler đã gắn', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => dungNghe(api));
  for (const ten of Object.values(SU_KIEN_ZCA)) assert.equal(api.listener._dem(ten), 0);
  assert.equal(dangNghe(), false);
});

test('D2 sau khi gỡ, sự kiện tới KHÔNG còn được phát', () => {
  const { api, boPhat, nhan } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => dungNghe(api));
  imLang(() => api.listener._ban('message', tinNhom()));
  assert.equal(nhan.tin.length, 0);
});

test('D3 dungNghe với api KHÁC -> không gỡ nhầm dây của phiên đang chạy', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => dungNghe(moiApi()));
  assert.equal(api.listener._dem('message'), 1);
  assert.equal(dangNghe(), true);
});

test('D4 dungNghe khi chưa gắn gì -> im lặng bỏ qua, không nổ', () => {
  _datLaiChoTest();
  dungNghe(moiApi());
  assert.equal(dangNghe(), false);
});

test('D5 gắn lại sau khi gỡ thì mốc "còn sống" đặt lại về null', () => {
  const { api, boPhat } = dungBo();
  imLang(() => batDauNghe(api, CAU_HINH, boPhat));
  imLang(() => api.listener._ban('message', tinNhom()));
  assert.ok(lanCuoiNhanSuKien() > 0);
  imLang(() => dungNghe(api));
  imLang(() => batDauNghe(moiApi(), CAU_HINH, boPhat));
  assert.equal(lanCuoiNhanSuKien(), null);
});

// ═══ E. Luật stdout ═══
test('E1 hai file của G2 KHÔNG có console.log (stdout là kênh MCP)', async () => {
  const fs = await import('node:fs');
  for (const f of ['src/zalo/listener.js', 'src/zalo/normalize.js']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/console\.log\s*\(/.test(src), `${f} có console.log`);
    assert.ok(!/process\.stdout\.write\s*\(/.test(src), `${f} ghi thẳng stdout`);
  }
});
