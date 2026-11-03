import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { menuPosition } from "./menuPosition";

/**
 * Satu tombol aksi per baris (⋮) untuk seluruh tabel panel.
 *
 * Menu dirender lewat portal ke <body> dengan posisi `fixed`, jadi tidak
 * mungkin terpotong oleh `overflow-x-auto`/`overflow-hidden` milik tabel.
 * Di layar < 640px menu berubah menjadi bottom sheet supaya nyaman disentuh.
 *
 * `actions` tetap milik modul: urutan, izin (role/permission) dan efeknya
 * ditentukan pemanggil. Aksi bertone `danger` dipisah garis secara visual.
 */

export interface RowAction {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  /** Sembunyikan tanpa mengubah urutan aksi lain. */
  hidden?: boolean;
  disabled?: boolean;
}

const SHEET_QUERY = "(max-width: 639px)";

export const RowActions: React.FC<{ actions: RowAction[]; label?: string }> = ({
  actions,
  label = "Aksi baris",
}) => {
  const visible = actions.filter((action) => !action.hidden);
  const [open, setOpen] = useState(false);
  const [isSheet, setIsSheet] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) btnRef.current?.focus();
  }, []);

  // Tutup saat Escape / klik di luar / halaman digulir (posisi fixed jadi
  // tidak lagi sejajar dengan tombolnya).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target))
        return;
      close(false);
    };
    const onScroll = () => close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  // Fokus pindah ke item pertama supaya menu bisa dipakai dengan keyboard.
  useEffect(() => {
    if (!open) return;
    const first =
      menuRef.current?.querySelector<HTMLButtonElement>("[data-action-item]");
    first?.focus();
  }, [open, pos]);

  // Ukur menu setelah dirender, lalu tempatkan: bawah tombol, dibalik ke atas
  // bila tidak cukup ruang, selalu di dalam viewport.
  useLayoutEffect(() => {
    if (!open || isSheet) return;
    const place = () => {
      const btn = btnRef.current;
      const menu = menuRef.current;
      if (!btn || !menu) return;
      const rect = btn.getBoundingClientRect();
      setPos(
        menuPosition(
          {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          },
          { width: menu.offsetWidth, height: menu.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    place();
  }, [open, isSheet, visible.length]);

  if (visible.length === 0) return null;

  const toggle = () => {
    if (open) {
      close(false);
      return;
    }
    setIsSheet(window.matchMedia(SHEET_QUERY).matches);
    setOpen(true);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-action-item]",
      ) ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
      items.length;
    items[next]?.focus();
  };

  const menu = (
    <>
      {isSheet && (
        <div
          className="row-actions-backdrop"
          aria-hidden="true"
          onClick={() => close(false)}
        />
      )}
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        onKeyDown={onMenuKeyDown}
        className={isSheet ? "row-actions-sheet" : "row-actions-menu"}
        style={
          isSheet
            ? undefined
            : {
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                maxHeight: pos?.maxHeight,
              }
        }
      >
        {isSheet && <div className="row-actions-grip" aria-hidden="true" />}
        {visible.map((action, index) => {
          const separator =
            action.tone === "danger" &&
            index > 0 &&
            visible[index - 1].tone !== "danger";
          return (
            <React.Fragment key={action.key}>
              {separator && (
                <div className="row-actions-sep" role="separator" />
              )}
              <button
                type="button"
                role="menuitem"
                data-action-item
                data-tone={action.tone ?? "default"}
                disabled={action.disabled}
                onClick={() => {
                  close(false);
                  action.onSelect();
                }}
                className="row-actions-item"
              >
                {action.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="row-actions-btn"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>
      {open && createPortal(menu, document.body)}
    </>
  );
};

/** Empty state standar di dalam <tbody>. */
export const TableEmpty: React.FC<{
  colSpan: number;
  title?: string;
  hint?: string;
  children?: React.ReactNode;
}> = ({ colSpan, title = "Tidak ada data.", hint, children }) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-10 text-center">
      <p className="font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {children}
    </td>
  </tr>
);
