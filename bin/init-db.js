#!/usr/bin/env node
/**
 * G0 — tạo/nâng cấp DB từ schema.sql rồi ĐỌC LẠI cấu trúc THẬT từ DB.
 *
 * Đây là script nghiệm thu của hợp đồng lưu trữ: nó KHÔNG in lại nội dung
 * schema.sql (chép lại thì chứng minh được gì), mà truy vấn `sqlite_master`
 * để in đúng những gì SQLite đã thực sự tạo ra.
 *
 * Dùng:
 *   node bin/init-db.js                      # lấy đường dẫn từ config
 *   node bin/init-db.js --db /duong/dan.db   # chỉ định thẳng
 *   node bin/init-db.js --json               # in JSON cho script khác đọc
 *
 * ⚠️ Đây là script chạy tay ở terminal, KHÔNG nói giao thức MCP
 *    ⇒ được phép in ra stdout (ngoại lệ duy nhất của luật stdout).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { expandPath, ensureParentDir, isInsidePack } from '../src/lib/paths.js';
import { PHIEN_BAN_SCHEMA } from '../src/lib/hang_so.js';

const PACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function docThamSo(argv) {
  const ra = { db: null, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--db') { ra.db = argv[i + 1]; i += 1; }
    else if (argv[i] === '--json') ra.json = true;
  }
  return ra;
}

function timDuongDanDb(chiDinh) {
  if (chiDinh) return expandPath(chiDinh);

  if (process.env.ZTL_DATA_DIR) {
    return path.join(expandPath(process.env.ZTL_DATA_DIR), 'lichsu.db');
  }

  const fileCauHinh = process.env.ZTL_CONFIG
    ? expandPath(process.env.ZTL_CONFIG)
    : path.join(PACK_ROOT, 'config', 'assistant.config.json');

  if (fs.existsSync(fileCauHinh)) {
    const ch = JSON.parse(fs.readFileSync(fileCauHinh, 'utf8'));
    if (ch?.duongDan?.db) return expandPath(ch.duongDan.db);
  }

  return expandPath('~/.zalo-tro-ly/lichsu.db');
}

function main() {
  const ts = docThamSo(process.argv);
  const duongDanDb = timDuongDanDb(ts.db);
  const duongDanSchema = path.join(PACK_ROOT, 'schema.sql');

  if (isInsidePack(duongDanDb, PACK_ROOT)) {
    process.stderr.write(
      '⚠️  CẢNH BÁO: DB đang nằm TRONG thư mục pack.\n' +
      '    Mức siết CAO yêu cầu đặt dữ liệu NGOÀI project (vd ~/.zalo-tro-ly/),\n' +
      '    để phiên Claude không đọc thẳng được DB, vòng qua luật chống rò chéo.\n',
    );
  }

  ensureParentDir(duongDanDb);

  const sql = fs.readFileSync(duongDanSchema, 'utf8');
  const db = new DatabaseSync(duongDanDb);
  try {
    db.exec(sql);

    const bang = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    const chiMuc = db
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name")
      .all();
    const journal = db.prepare('PRAGMA journal_mode').get();
    const phienBan = db.prepare("SELECT gia_tri FROM meta WHERE khoa='schema_version'").get();

    // Đếm cột thật của từng bảng — bằng chứng bảng không rỗng ruột.
    const soCot = {};
    for (const b of bang) {
      soCot[b.name] = db.prepare(`PRAGMA table_info(${b.name})`).all().length;
    }

    const ketQua = {
      duongDanDb,
      journalMode: journal?.journal_mode ?? null,
      schemaVersionTrongDb: phienBan?.gia_tri ?? null,
      schemaVersionMongDoi: PHIEN_BAN_SCHEMA,
      soBang: bang.length,
      bang: bang.map((b) => ({ ten: b.name, soCot: soCot[b.name] })),
      soChiMuc: chiMuc.length,
      chiMuc: chiMuc.map((c) => ({ ten: c.name, bang: c.tbl_name })),
    };

    if (ts.json) {
      process.stdout.write(`${JSON.stringify(ketQua, null, 2)}\n`);
    } else {
      const d = process.stdout;
      d.write(`\n═══ ĐỌC LẠI TỪ DB THẬT (không phải chép schema.sql) ═══\n`);
      d.write(`DB           : ${ketQua.duongDanDb}\n`);
      d.write(`journal_mode : ${ketQua.journalMode}\n`);
      d.write(`schema_version: ${ketQua.schemaVersionTrongDb} (mong đợi ${ketQua.schemaVersionMongDoi})\n`);
      d.write(`\n--- ${ketQua.soBang} BẢNG ---\n`);
      for (const b of ketQua.bang) d.write(`  ${b.ten.padEnd(20)} ${b.soCot} cột\n`);
      d.write(`\n--- ${ketQua.soChiMuc} CHỈ MỤC ---\n`);
      for (const c of ketQua.chiMuc) d.write(`  ${c.ten.padEnd(26)} → ${c.bang}\n`);
      d.write('\n');
    }

    if (ketQua.schemaVersionTrongDb !== PHIEN_BAN_SCHEMA) {
      process.stderr.write(
        `🔴 LỆCH PHIÊN BẢN SCHEMA: DB='${ketQua.schemaVersionTrongDb}' ` +
        `vs code='${PHIEN_BAN_SCHEMA}'. Phải migrate trước khi dùng.\n`,
      );
      process.exitCode = 4;
    }
  } finally {
    db.close();
  }
}

main();
