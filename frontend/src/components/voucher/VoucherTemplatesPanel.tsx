import React, { useMemo, useRef, useState } from 'react';
import api from '../../services/api';

/**
 * Template voucher: tabel + editor gaya terminal.
 *
 * Bentuk data mengikuti backend (profiles/voucher-template.ts). Semua aturan di
 * sini adalah cermin aturan server: teks tanpa tag HTML, variabel hanya dari
 * daftar putih, maksimal 3 baris isi, layout 1-3 kolom. Server tetap validator
 * terakhir — validasi di sini hanya supaya kesalahan terlihat sebelum disimpan.
 */

export interface VoucherTemplateLayout {
  columns: 1 | 2 | 3;
  marginMm: number;
  gapMm: number;
}

export interface VoucherTemplate {
  id?: string;
  name: string;
  header: string;
  title: string;
  lines: string[];
  footer: string;
  enabled: boolean;
  layout: VoucherTemplateLayout;
}

export interface VoucherVariable {
  token: string;
  label: string;
}

const DEFAULT_LAYOUT: VoucherTemplateLayout = { columns: 3, marginMm: 8.5, gapMm: 3.5 };
const MAX_TEMPLATES = 20;
const MAX_LINES = 3;

const normalize = (row: Partial<VoucherTemplate>): VoucherTemplate => ({
  id: row.id,
  name: row.name ?? '',
  header: row.header ?? '',
  title: row.title ?? '',
  lines: Array.isArray(row.lines) ? row.lines.slice(0, MAX_LINES) : [],
  footer: row.footer ?? '',
  enabled: row.enabled !== false,
  layout: { ...DEFAULT_LAYOUT, ...(row.layout ?? {}) },
});

const KNOWN = (variables: VoucherVariable[]) =>
  new Set(variables.map((item) => item.token.slice(2, -2).toLowerCase()));

/** Cermin validasi server; kembalikan daftar pesan kesalahan. */
function problems(draft: VoucherTemplate, variables: VoucherVariable[]): string[] {
  const out: string[] = [];
  const known = KNOWN(variables);
  const texts: Array<[string, string]> = [
    ['Nama', draft.name],
    ['Baris atas', draft.header],
    ['Judul', draft.title],
    ...draft.lines.map((line, i): [string, string] => [`Baris ${i + 1}`, line]),
    ['Baris bawah', draft.footer],
  ];
  if (!draft.name.trim()) out.push('Nama template wajib diisi.');
  if (draft.name.length > 40) out.push('Nama template maksimal 40 karakter.');
  for (const [field, text] of texts) {
    if (/[<>]/.test(text)) out.push(`${field}: karakter < atau > tidak diizinkan.`);
    for (const match of text.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? []) {
      if (!known.has(match.slice(2, -2).trim().toLowerCase())) {
        out.push(`${field}: variabel ${match} tidak dikenal.`);
      }
    }
    if (text.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '').match(/\{\{|\}\}/)) {
      out.push(`${field}: penulisan {{...}} tidak lengkap.`);
    }
  }
  if (draft.lines.length > MAX_LINES) out.push(`Baris isi maksimal ${MAX_LINES}.`);
  if (draft.lines.some((line) => !line.trim())) out.push('Baris isi tidak boleh kosong.');
  if (!draft.header && !draft.title && !draft.footer && draft.lines.length === 0) {
    out.push('Template tidak boleh kosong semua.');
  }
  if (![1, 2, 3].includes(draft.layout.columns)) out.push('Kolom harus 1, 2, atau 3.');
  if (draft.layout.marginMm < 5 || draft.layout.marginMm > 24) {
    out.push('Margin halaman harus 5-24 mm.');
  }
  if (draft.layout.gapMm < 2 || draft.layout.gapMm > 15) {
    out.push('Jarak antar kartu harus 2-15 mm.');
  }
  return [...new Set(out)];
}

const SAMPLE: Record<string, string> = {
  brand: 'BibitNet',
  tagline: 'Internet cepat, harga bersahabat',
  profile: 'Harian 1GB',
  profile_type: 'hotspot',
  user_type: 'voucher',
  username: 'BBT-8F2K',
  password: '4821',
  price: 'Rp 5.000',
  owner: 'Reseller Nanggela',
  created_by: 'Admin',
  customer: 'Soleh',
  status: 'active',
  expires: '2026-11-10',
  created_at: '2026-11-03',
  printed_at: '03/11/2026 02:10',
};

const fill = (text: string) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => SAMPLE[key.toLowerCase()] ?? match);

const cellClass = 'px-4 py-3 text-sm text-slate-300';

export const VoucherTemplatesPanel: React.FC<{
  templates: VoucherTemplate[];
  variables: VoucherVariable[];
  canEdit: boolean;
  onSaved: (raw: string) => void;
}> = ({ templates, variables, canEdit, onSaved }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<VoucherTemplate | null>(null);
  const [draftIndex, setDraftIndex] = useState<number>(-1);
  const [focusField, setFocusField] = useState<string>('title');
  const linesRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const list = useMemo(() => templates.map((row) => normalize(row)), [templates]);
  const draftErrors = draft ? problems(draft, variables) : [];

  const persist = async (next: VoucherTemplate[]) => {
    if (!canEdit) return;
    setBusy(true);
    setMessage(null);
    try {
      const raw = JSON.stringify(next.map((row) => ({ ...row, id: undefined })));
      const res = await api.put('/api/settings', { values: { voucher_templates: raw } });
      onSaved(res.data?.values?.voucher_templates ?? raw);
      setMessage({ type: 'ok', text: 'Template voucher disimpan.' });
    } catch (error) {
      const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      const text = Array.isArray(data) ? data.join(', ') : typeof data === 'string' ? data : 'Gagal menyimpan template.';
      setMessage({ type: 'err', text });
    } finally {
      setBusy(false);
    }
  };

  const openNew = () => {
    setDraftIndex(-1);
    setDraft(
      normalize({
        name: `Template ${list.length + 1}`,
        header: '{{brand}}',
        title: 'Voucher {{profile}}',
        lines: [],
        footer: '{{printed_at}}',
      }),
    );
  };

  const openEdit = (index: number) => {
    setDraftIndex(index);
    setDraft({ ...list[index], lines: [...list[index].lines] });
  };

  const toggleEnabled = (index: number) => {
    const next = list.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row));
    void persist(next);
  };

  const remove = (index: number) => {
    setConfirmIndex(null);
    if (list.length === 1) {
      setMessage({ type: 'err', text: 'Minimal satu template harus ada. Nonaktifkan saja bila tidak dipakai.' });
      return;
    }
    void persist(list.filter((_, i) => i !== index));
  };

  const saveDraft = () => {
    if (!draft || draftErrors.length > 0) return;
    const next =
      draftIndex >= 0
        ? list.map((row, i) => (i === draftIndex ? draft : row))
        : [...list, draft];
    if (next.length > MAX_TEMPLATES) {
      setMessage({ type: 'err', text: `Maksimal ${MAX_TEMPLATES} template.` });
      return;
    }
    setDraft(null);
    void persist(next);
  };

  const insertVariable = (token: string) => {
    if (!draft) return;
    if (focusField === 'lines') {
      const area = linesRef.current;
      const text = draft.lines.join('\n');
      const at = area?.selectionStart ?? text.length;
      const merged = `${text.slice(0, at)}${token}${text.slice(area?.selectionEnd ?? at)}`;
      setDraft({ ...draft, lines: merged.split('\n').slice(0, MAX_LINES) });
      requestAnimationFrame(() => {
        area?.focus();
        area?.setSelectionRange(at + token.length, at + token.length);
      });
      return;
    }
    const field = focusField as 'header' | 'title' | 'footer';
    setDraft({ ...draft, [field]: `${draft[field]}${token}` });
  };

  const onLinesChange = (value: string) => {
    if (!draft) return;
    const rows = value.split('\n');
    setDraft({ ...draft, lines: rows.length > MAX_LINES ? rows.slice(0, MAX_LINES) : rows });
  };

  const lineCount = draft ? Math.max(1, draft.lines.length) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Template aktif muncul di dialog cetak voucher. Nonaktifkan yang tidak dipakai — tidak perlu dihapus.
        </p>
        <button
          type="button"
          onClick={openNew}
          disabled={!canEdit || list.length >= MAX_TEMPLATES}
          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium text-white disabled:opacity-50"
        >
          + Buat template baru
        </button>
      </div>

      {message && (
        <p className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700/60">
        <table className="min-w-full divide-y divide-slate-700/60">
          <thead className="bg-slate-800/60">
            <tr>
              {['Nama template', 'Layout', 'Status', 'Baris isi', 'Aksi'].map((head) => (
                <th key={head} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-slate-400">
                  Belum ada template. Server memakai template bawaan sampai Anda membuat satu.
                </td>
              </tr>
            )}
            {list.map((row, index) => (
              <tr key={`${row.name}-${index}`} className="hover:bg-slate-800/40">
                <td className={cellClass}>
                  <p className="font-medium text-slate-200">{row.name || '(tanpa nama)'}</p>
                  <p className="text-xs text-slate-500 font-mono truncate max-w-[320px]">{row.title}</p>
                </td>
                <td className={`${cellClass} font-mono text-xs`}>
                  {row.layout.columns} kolom · {row.layout.marginMm} mm · jarak {row.layout.gapMm} mm
                </td>
                <td className={cellClass}>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      row.enabled
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-600/30 text-slate-400'
                    }`}
                  >
                    {row.enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className={`${cellClass} font-mono text-xs`}>{row.lines.length} / {MAX_LINES}</td>
                <td className={cellClass}>
                  {confirmIndex === index ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Hapus template ini?</span>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="px-2 py-1 rounded text-xs bg-rose-600 text-white hover:bg-rose-500"
                      >
                        Ya
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmIndex(null)}
                        className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-200"
                      >
                        Batal
                      </button>
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(index)}
                        disabled={!canEdit}
                        className="px-2 py-1 rounded text-xs bg-slate-700/60 text-slate-100 hover:bg-slate-700 disabled:opacity-40"
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleEnabled(index)}
                        disabled={!canEdit || busy}
                        className="px-2 py-1 rounded text-xs bg-cyan-600/15 text-cyan-300 hover:bg-cyan-600/25 disabled:opacity-40"
                      >
                        {row.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmIndex(index)}
                        disabled={!canEdit}
                        className="px-2 py-1 rounded text-xs bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                      >
                        Hapus
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 bg-black/70 p-0 sm:p-6 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl rounded-none sm:rounded-xl border border-slate-700 bg-[#0d1117] shadow-2xl">
            {/* Title bar ala editor */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-[#161b22]">
              <span className="h-3 w-3 rounded-full bg-rose-500/80" />
              <span className="h-3 w-3 rounded-full bg-amber-400/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
              <p className="ml-3 font-mono text-xs text-slate-300 truncate">
                voucher-template — {draft.name || 'tanpa-nama'}.tpl
              </p>
              <span className="ml-auto text-[11px] font-mono text-slate-500">
                {draftErrors.length === 0 ? 'valid' : `${draftErrors.length} masalah`}
              </span>
            </div>

            <div className="grid lg:grid-cols-[300px_1fr]">
              {/* Panel kiri: layout + variabel */}
              <aside className="border-b lg:border-b-0 lg:border-r border-slate-700 p-4 space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Layout CSS Grid</p>
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    {[1, 2, 3].map((cols) => (
                      <button
                        key={cols}
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, layout: { ...draft.layout, columns: cols as 1 | 2 | 3 } })
                        }
                        className={`py-2 rounded font-mono text-xs border ${
                          draft.layout.columns === cols
                            ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                            : 'border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        {cols} kolom
                      </button>
                    ))}
                  </div>
                  <label className="block text-[11px] text-slate-500 mb-1" htmlFor="tpl-margin">
                    Margin halaman (mm)
                  </label>
                  <input
                    id="tpl-margin"
                    type="number"
                    min={5}
                    max={24}
                    step={0.5}
                    value={draft.layout.marginMm}
                    onChange={(e) =>
                      setDraft({ ...draft, layout: { ...draft.layout, marginMm: Number(e.target.value) } })
                    }
                    className="w-full mb-2 px-2 py-1.5 rounded bg-[#161b22] border border-slate-700 font-mono text-xs text-slate-200"
                  />
                  <label className="block text-[11px] text-slate-500 mb-1" htmlFor="tpl-gap">
                    Jarak antar kartu (mm)
                  </label>
                  <input
                    id="tpl-gap"
                    type="number"
                    min={2}
                    max={15}
                    step={0.5}
                    value={draft.layout.gapMm}
                    onChange={(e) =>
                      setDraft({ ...draft, layout: { ...draft.layout, gapMm: Number(e.target.value) } })
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#161b22] border border-slate-700 font-mono text-xs text-slate-200"
                  />
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                    Variabel ({variables.length})
                  </p>
                  <p className="text-[11px] text-slate-500 mb-2">Klik untuk menyisipkan ke kolom aktif.</p>
                  <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                    {variables.map((item) => (
                      <button
                        key={item.token}
                        type="button"
                        onClick={() => insertVariable(item.token)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-slate-800/70 group"
                        title={item.label}
                      >
                        <code className="font-mono text-xs text-cyan-300">{item.token}</code>
                        <span className="block text-[10px] text-slate-500 truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              {/* Editor + pratinjau */}
              <div className="p-4 space-y-4">
                <div className="grid xl:grid-cols-2 gap-4">
                  <div className="space-y-2 font-mono text-xs">
                    {(
                      [
                        ['name', 'Nama template', 40],
                        ['header', 'Baris atas', 60],
                        ['title', 'Judul', 60],
                      ] as Array<[ 'name' | 'header' | 'title', string, number]>
                    ).map(([field, label, max], i) => (
                      <label key={field} className="flex items-start gap-2">
                        <span className="w-6 text-right text-slate-600 select-none pt-1.5">{i + 1}</span>
                        <span className="flex-1">
                          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                            {label}
                          </span>
                          <input
                            ref={(el) => {
                              inputRefs.current[field] = el;
                            }}
                            value={draft[field]}
                            maxLength={max}
                            onFocus={() => setFocusField(field)}
                            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                            className="w-full px-2 py-1.5 rounded bg-[#161b22] border border-slate-700 text-slate-200 focus:border-cyan-500 outline-none"
                            placeholder={field === 'name' ? 'Klasik' : '{{brand}}'}
                          />
                        </span>
                      </label>
                    ))}

                    <div className="flex items-start gap-2">
                      <span className="w-6 text-right text-slate-600 select-none pt-1.5">4</span>
                      <div className="flex-1">
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Baris isi — satu baris satu isi kartu (maks {MAX_LINES})
                        </span>
                        <div className="flex rounded bg-[#161b22] border border-slate-700 overflow-hidden">
                          <div className="py-1.5 px-2 text-right text-slate-600 select-none border-r border-slate-800 bg-[#0d1117]">
                            {Array.from({ length: lineCount }, (_, i) => (
                              <div key={i}>{i + 1}</div>
                            ))}
                          </div>
                          <textarea
                            ref={linesRef}
                            value={draft.lines.join('\n')}
                            onFocus={() => setFocusField('lines')}
                            onChange={(e) => onLinesChange(e.target.value)}
                            rows={Math.max(2, lineCount)}
                            spellCheck={false}
                            className="flex-1 px-2 py-1.5 bg-transparent text-slate-200 outline-none resize-none whitespace-pre"
                            placeholder={'Harga {{price}}\nPemilik {{owner}}'}
                          />
                        </div>
                      </div>
                    </div>

                    <label className="flex items-start gap-2">
                      <span className="w-6 text-right text-slate-600 select-none pt-1.5">5</span>
                      <span className="flex-1">
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Baris bawah
                        </span>
                        <input
                          value={draft.footer}
                          maxLength={60}
                          onFocus={() => setFocusField('footer')}
                          onChange={(e) => setDraft({ ...draft, footer: e.target.value })}
                          className="w-full px-2 py-1.5 rounded bg-[#161b22] border border-slate-700 text-slate-200 focus:border-cyan-500 outline-none"
                          placeholder="{{printed_at}}"
                        />
                      </span>
                    </label>
                  </div>

                  {/* Pratinjau memakai CSS grid dengan jumlah kolom yang dipilih */}
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                      Pratinjau kartu (contoh data)
                    </p>
                    <div
                      className="grid gap-2 p-2 rounded bg-white/95 text-slate-900"
                      style={{ gridTemplateColumns: `repeat(${draft.layout.columns}, minmax(0, 1fr))` }}
                    >
                      {[1, 2].map((n) => (
                        <div key={n} className="border border-dashed border-slate-400 rounded p-2 font-mono text-[10px] leading-tight">
                          {draft.header && <p className="text-slate-500">{fill(draft.header)}</p>}
                          {draft.title && <p className="font-bold text-slate-900 mt-0.5">{fill(draft.title)}</p>}
                          {draft.lines.map((line, i) => (
                            <p key={i} className="text-slate-700">{fill(line)}</p>
                          ))}
                          {draft.footer && <p className="text-slate-500 mt-0.5">{fill(draft.footer)}</p>}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                      Pratinjau memakai CSS grid di peramban. PDF memakai geometri yang sama
                      ({draft.layout.columns} kolom, margin {draft.layout.marginMm} mm).
                    </p>
                  </div>
                </div>

                {draftErrors.length > 0 && (
                  <ul className="text-xs text-rose-400 space-y-1 border border-rose-500/30 bg-rose-500/5 rounded p-3">
                    {draftErrors.map((error) => (
                      <li key={error}>• {error}</li>
                    ))}
                  </ul>
                )}

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                  />
                  Aktif — tampil sebagai pilihan saat mencetak voucher
                </label>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                  <p className="font-mono text-[11px] text-slate-500">
                    {draft.layout.columns} cols · {draft.layout.marginMm}mm · UTF-8 · plain text
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200 hover:bg-slate-700"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={saveDraft}
                      disabled={busy || draftErrors.length > 0}
                      className="px-3 py-2 rounded-lg bg-cyan-600 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {busy ? 'Menyimpan…' : 'Simpan template'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoucherTemplatesPanel;