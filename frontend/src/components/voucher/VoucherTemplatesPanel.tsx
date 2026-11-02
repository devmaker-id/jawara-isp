import React, { useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import {
  buildPrintDocument,
  templateProblems,
  type VoucherPrintBrand,
  type VoucherPrintCard,
  type VoucherPrintLayout,
} from '../../utils/voucher-print';

/**
 * Template voucher: tabel + editor kode gaya terminal.
 *
 * Satu template = satu berkas HTML/CSS bebas (boleh <style>, class, grid, dsb)
 * dengan variabel {{...}}. HTML dirender di IFRAME SANDBOX di browser; server
 * hanya menyimpan dan memvalidasi. Validasi di sini cermin aturan server supaya
 * kesalahan terlihat sebelum disimpan — server tetap penentu akhir.
 */

export type VoucherTemplateLayout = VoucherPrintLayout;

export interface VoucherTemplate {
  id?: string;
  name: string;
  html: string;
  enabled: boolean;
  layout: VoucherTemplateLayout;
}

export interface VoucherVariable {
  token: string;
  label: string;
}

const DEFAULT_LAYOUT: VoucherTemplateLayout = { columns: 3, marginMm: 8.5, gapMm: 3.5 };
const MAX_TEMPLATES = 20;
const MAX_HTML = 6000;

const STARTER = `<style>
.card{
  display:grid;gap:4px;
  border:1px dashed #94a3b8;border-radius:8px;padding:10px;
  font-family:ui-monospace,monospace;color:#0f172a;
}
.brand{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.name{font-size:13px;font-weight:700;margin:0}
.row{font-size:10px;color:#334155}
.price{font-size:11px;font-weight:700}
</style>
<div class="card">
  <div class="brand">{{brand}}</div>
  <p class="name">{{profile}}</p>
  <div class="row">{{username}} / {{password}}</div>
  <div class="price">{{price}}</div>
  <div class="brand">{{printed_at}}</div>
</div>`;

const SAMPLE_CARD: VoucherPrintCard = {
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
  expires: '10/11/2026',
  created_at: '03/11/2026',
};

const normalize = (row: Partial<VoucherTemplate>): VoucherTemplate => ({
  id: row.id,
  name: row.name ?? '',
  html: row.html ?? '',
  enabled: row.enabled !== false,
  layout: { ...DEFAULT_LAYOUT, ...(row.layout ?? {}) },
});

const cellClass = 'px-4 py-3 text-sm text-slate-300';

export const VoucherTemplatesPanel: React.FC<{
  templates: VoucherTemplate[];
  variables: VoucherVariable[];
  brand: VoucherPrintBrand;
  canEdit: boolean;
  onSaved: (raw: string) => void;
}> = ({ templates, variables, brand, canEdit, onSaved }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<VoucherTemplate | null>(null);
  const [draftIndex, setDraftIndex] = useState(-1);
  const codeRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const list = useMemo(() => templates.map((row) => normalize(row)), [templates]);
  const draftErrors = draft ? templateProblems(draft, variables) : [];

  const preview = useMemo(() => {
    if (!draft) return '';
    const printedAt = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    // Pratinjau memakai jalur render yang sama dengan cetak (sanitasi + grid).
    return buildPrintDocument(
      draft.html,
      [SAMPLE_CARD, SAMPLE_CARD, SAMPLE_CARD, SAMPLE_CARD],
      draft.layout,
      brand,
      printedAt,
    );
  }, [draft, brand]);

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
    setDraft(normalize({ name: `Template ${list.length + 1}`, html: STARTER }));
  };

  const openEdit = (index: number) => {
    setDraftIndex(index);
    setDraft({ ...list[index] });
  };

  const toggleEnabled = (index: number) => {
    void persist(list.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row)));
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
    const next = draftIndex >= 0 ? list.map((row, i) => (i === draftIndex ? draft : row)) : [...list, draft];
    if (next.length > MAX_TEMPLATES) {
      setMessage({ type: 'err', text: `Maksimal ${MAX_TEMPLATES} template.` });
      return;
    }
    setDraft(null);
    void persist(next);
  };

  /** Sisipkan variabel di posisi kursor (atau akhir kode). */
  const insertVariable = (token: string) => {
    if (!draft) return;
    const area = codeRef.current;
    const at = area?.selectionStart ?? draft.html.length;
    const end = area?.selectionEnd ?? at;
    const html = `${draft.html.slice(0, at)}${token}${draft.html.slice(end)}`;
    setDraft({ ...draft, html });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const lineCount = draft ? Math.max(1, draft.html.split('\n').length) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Kode HTML/CSS bebas per kartu. Hanya template aktif yang muncul saat mencetak; render terjadi di
          browser, server menyimpan sebagai teks tersanitasi.
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
        <p className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{message.text}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700/60">
        <table className="min-w-full divide-y divide-slate-700/60">
          <thead className="bg-slate-800/60">
            <tr>
              {['Nama template', 'Layout', 'Status', 'Kode', 'Aksi'].map((head) => (
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
                  <p className="text-xs text-slate-500 font-mono truncate max-w-[340px]">
                    {row.html.split('\n').find((line) => line.includes('{{'))?.trim() ?? '—'}
                  </p>
                </td>
                <td className={`${cellClass} font-mono text-xs`}>
                  {row.layout.columns} kolom · {row.layout.marginMm} mm · jarak {row.layout.gapMm} mm
                </td>
                <td className={cellClass}>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      row.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-600/30 text-slate-400'
                    }`}
                  >
                    {row.enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className={`${cellClass} font-mono text-xs`}>{row.html.length} / {MAX_HTML}</td>
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
          <div className="mx-auto w-full max-w-[1400px] rounded-none sm:rounded-xl border border-slate-700 bg-[#0d1117] shadow-2xl">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-[#161b22]">
              <span className="h-3 w-3 rounded-full bg-rose-500/80" />
              <span className="h-3 w-3 rounded-full bg-amber-400/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
              <p className="ml-3 font-mono text-xs text-slate-300 truncate">
                voucher-template — {draft.name || 'tanpa-nama'}.html
              </p>
              <span className="ml-auto text-[11px] font-mono text-slate-500">
                {draftErrors.length === 0 ? 'valid' : `${draftErrors.length} masalah`}
              </span>
            </div>

            <div className="grid lg:grid-cols-[280px_1fr]">
              <aside className="border-b lg:border-b-0 lg:border-r border-slate-700 p-4 space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Grid halaman</p>
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    {[1, 2, 3].map((cols) => (
                      <button
                        key={cols}
                        type="button"
                        onClick={() => setDraft({ ...draft, layout: { ...draft.layout, columns: cols as 1 | 2 | 3 } })}
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
                    onChange={(e) => setDraft({ ...draft, layout: { ...draft.layout, marginMm: Number(e.target.value) } })}
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
                    onChange={(e) => setDraft({ ...draft, layout: { ...draft.layout, gapMm: Number(e.target.value) } })}
                    className="w-full px-2 py-1.5 rounded bg-[#161b22] border border-slate-700 font-mono text-xs text-slate-200"
                  />
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                    Variabel ({variables.length})
                  </p>
                  <p className="text-[11px] text-slate-500 mb-2">Klik untuk menyisipkan di posisi kursor.</p>
                  <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1">
                    {variables.map((item) => (
                      <button
                        key={item.token}
                        type="button"
                        onClick={() => insertVariable(item.token)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-slate-800/70"
                        title={item.label}
                      >
                        <code className="font-mono text-xs text-cyan-300">{item.token}</code>
                        <span className="block text-[10px] text-slate-500 truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-slate-800 bg-[#161b22] p-2 text-[10px] leading-relaxed text-slate-500">
                  <p className="text-slate-400 mb-1">Yang diizinkan</p>
                  HTML biasa, <code className="text-slate-300">&lt;style&gt;</code>, class, grid/flex, border.
                  Tanpa script, iframe, gambar/URL luar, <code className="text-slate-300">url()</code>, atau
                  atribut <code className="text-slate-300">on*</code>.
                </div>
              </aside>

              <div className="p-4 space-y-3">
                <div className="grid xl:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                        Nama template
                      </span>
                      <input
                        value={draft.name}
                        maxLength={40}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="w-full px-2 py-1.5 rounded bg-[#161b22] border border-slate-700 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                        placeholder="Klasik"
                      />
                    </label>

                    <div className="flex rounded bg-[#161b22] border border-slate-700 overflow-hidden font-mono text-xs">
                      <div
                        ref={gutterRef}
                        className="py-2 px-2 text-right text-slate-600 select-none bg-[#0d1117] border-r border-slate-800 overflow-hidden"
                        style={{ minWidth: 40 }}
                      >
                        {Array.from({ length: lineCount }, (_, i) => (
                          <div key={i}>{i + 1}</div>
                        ))}
                      </div>
                      <textarea
                        ref={codeRef}
                        value={draft.html}
                        onChange={(e) => setDraft({ ...draft, html: e.target.value })}
                        onScroll={(e) => {
                          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                        }}
                        spellCheck={false}
                        wrap="off"
                        rows={18}
                        className="flex-1 px-2 py-2 bg-transparent text-slate-200 outline-none resize-y whitespace-pre font-mono"
                        placeholder="<div class=&quot;card&quot;>{{profile}}</div>"
                      />
                    </div>
                    <p className="font-mono text-[10px] text-slate-500">
                      HTML+CSS · {draft.html.length}/{MAX_HTML} karakter · {lineCount} baris
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Pratinjau (contoh data)</p>
                    <iframe
                      title="Pratinjau template voucher"
                      sandbox=""
                      srcDoc={preview}
                      className="w-full rounded border border-slate-700 bg-white"
                      style={{ height: 380 }}
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Dirender di iframe sandbox tanpa script. Cetak memakai dokumen yang sama.
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
                    {draft.layout.columns} cols · {draft.layout.marginMm}mm · UTF-8 · HTML/CSS
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