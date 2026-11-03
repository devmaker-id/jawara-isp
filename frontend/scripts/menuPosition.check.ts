/**
 * Self-check posisi menu aksi. Jalankan:
 *   node --experimental-strip-types src/components/table/menuPosition.check.ts
 */
import assert from "node:assert/strict";
import {
  menuPosition,
  MENU_GAP,
  MENU_MARGIN,
} from "../src/components/table/menuPosition.ts";

const viewport = { width: 1280, height: 800 };
const menu = { width: 200, height: 180 };

// 1. Cukup ruang di bawah: menu dibuka ke bawah, rata kanan tombol.
const normal = menuPosition(
  { top: 100, bottom: 132, left: 600, right: 632 },
  menu,
  viewport,
);
assert.equal(normal.top, 132 + MENU_GAP);
assert.equal(normal.left, 632 - 200);

// 2. Baris terakhir (ruang bawah sempit): menu dibalik ke atas tombol.
const bottomRow = menuPosition(
  { top: 720, bottom: 752, left: 600, right: 632 },
  menu,
  viewport,
);
assert.equal(bottomRow.top, 720 - 180 - MENU_GAP);

// 3. Tombol di kolom paling kanan: menu tetap di dalam viewport.
const rightEdge = menuPosition(
  { top: 100, bottom: 132, left: 1270, right: 1278 },
  menu,
  viewport,
);
assert.equal(rightEdge.left, viewport.width - 200 - MENU_MARGIN);

// 4. Tombol paling kiri: tidak keluar tepi kiri.
const leftEdge = menuPosition(
  { top: 100, bottom: 132, left: 0, right: 32 },
  menu,
  viewport,
);
assert.equal(leftEdge.left, MENU_MARGIN);

// 5. Menu lebih tinggi dari layar: tinggi dibatasi, posisi tetap di dalam.
const tall = menuPosition(
  { top: 40, bottom: 72, left: 600, right: 632 },
  { width: 200, height: 2000 },
  { width: 1280, height: 400 },
);
assert.ok(tall.top >= MENU_MARGIN);
assert.ok(tall.top + tall.maxHeight <= 400);

console.log("menuPosition: 5 pemeriksaan lulus");
