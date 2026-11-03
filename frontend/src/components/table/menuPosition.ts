/**
 * Perhitungan posisi menu aksi (⋮) supaya tidak pernah terpotong container
 * tabel maupun tepi viewport. Dipisah dari komponen agar bisa diuji tanpa
 * browser: lihat menuPosition.check.ts.
 */

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  maxHeight: number;
}

export const MENU_MARGIN = 8;
export const MENU_GAP = 4;

export function menuPosition(
  button: Rect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPlacement {
  const maxHeight = Math.max(80, viewport.height - MENU_MARGIN * 2);
  const spaceBelow = viewport.height - button.bottom - MENU_MARGIN;
  const spaceAbove = button.top - MENU_MARGIN;
  const openUp = spaceBelow < menu.height + MENU_GAP && spaceAbove > spaceBelow;

  const left = Math.min(
    Math.max(MENU_MARGIN, button.right - menu.width),
    Math.max(MENU_MARGIN, viewport.width - menu.width - MENU_MARGIN),
  );

  const preferred = openUp
    ? button.top - menu.height - MENU_GAP
    : button.bottom + MENU_GAP;
  const top = Math.min(
    Math.max(MENU_MARGIN, preferred),
    Math.max(
      MENU_MARGIN,
      viewport.height - Math.min(menu.height, maxHeight) - MENU_MARGIN,
    ),
  );

  return { top, left, maxHeight };
}
