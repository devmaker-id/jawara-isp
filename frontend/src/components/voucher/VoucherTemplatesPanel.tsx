import React, { useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import {
  buildPrintDocument,
  templateProblems,
  type VoucherPrintBrand,
  type VoucherPrintCard,
  type VoucherPrintLayout,
} from '../../utils/voucher-print';

/**
 * Template voucher: tabel + editor kode (CodeMirror) + pratinjau.
 *
 * Satu template = satu berkas HTML/CSS bebas dengan variabel {{...}}. Render
 * terjadi di browser (iframe sandbox); server hanya menyimpan dan memvalidasi.
 * Validasi di sini cermin aturan server supaya kesalahan terlihat lebih awal.
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
const MAX_HTML = 200_000;

const HEIGHTS = [
  { key: 'kecil', label: 'Kecil', value: '300px' },
  { key: 'sedang', label: 'Sedang', value: '460px' },
  { key: 'besar', label: 'Besar', value: '640px' },
  { key: 'penuh', label: 'Penuh', value: '75vh' },
] as const;

const STARTER = `<style>
.card{
  display:grid;gap:4px;
  border:1px dashed #94a3b8;border-radius:8px;padding:10px;
  font-family:ui-monospace,monospace;color:#0f172a;background:#fff;
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

const SAMPLE_VOUCHER: VoucherPrintCard = {
  profile: 'Harian 1GB',
  profile_type: 'hotspot',
  user_type: 'voucher',
  username: 'BBT-8F2K',
  password: '4821',
  price: 'Rp 5.000',
  owner: 'Reseller Nanggela',
  created_by: 'Admin',
  customer: '-',
  status: 'baru dibuat',
  expires: '10/11/2026',
  created_at: '03/11/2026',
};

const SAMPLE_MEMBER: VoucherPrintCard = {
  profile: 'Hunian 10 Mbps',
  profile_type: 'ppp',
  user_type: 'member',
  username: 'soleh@bibitnet',
  password: '••••••',
  price: 'Rp 150.000',
  owner: 'BibitNet',
  created_by: 'Admin',
  customer: 'Soleh',
  status: 'aktif',
  expires: '30/11/2026',
  created_at: '01/11/2026',
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
  const [height, setHeight] = useState<string>('460px');
  const [previewKind, setPreviewKind] = useState<'voucher' | 'member'>('voucher');
  const [previewCount, setPreviewCount] = useState<1 | 4 | 8>(4);
  const editorRef = useRef<CodeEditorHandle | null>(null);

  const list = useMemo(() => templates.map((row) => normalize(row)), [templates]);
  const defaultIndex = useMemo(() => list.findIndex((row) => row.enabled), [list]);
  const draftErrors = draft ? templateProblems(draft, variables) : [];

  const preview = useMemo(() => {
    if (!draft) return '';
    const printedAt = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    const sample = previewKind === 'member' ? SAMPLE_MEMBER : SAMPLE_VOUCHER;
    // Jalur render sama dengan cetak: sanitasi + grid + variabel.
    return buildPrintDocument(
      draft.html,
      Array.from({ length: previewCount }, () => sample),
      draft.layout,
      brand,
      printedAt,
    );
  }, [draft, brand, previewKind, previewCount]);

  const persist = async (next: VoucherTemplate[], note = 'Template voucher disimpan.') => {
    if (!canEdit) return;
    setBusy(true);
    setMessage(null);
    try {
      const raw = JSON.stringify(next.map((row) => ({ ...row, id: undefined })));
      const res = await api.put('/api/settings', { values: { voucher_templates: raw } });
      onSaved(res.data?.values?.voucher_templates ?? raw);
      setMessage({ type: 'ok', text: note });
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

  const duplicate = (index: number) => {
    const source = list[index];
    if (!source) return;
    const copy: VoucherTemplate = {
      ...source,
      id: undefined,
      name: `${source.name} (salinan)`.slice(0, 40),
      enabled: true,
    };
    void persist(
      [...list.slice(0, index + 1), copy, ...list.slice(index + 1)],
      `Template "${copy.name}" dibuat.`,
    );
  };

  /** Default cetak = template aktif pertama; pindahkan baris ke depan. */
  const makeDefault = (index: number) => {
    if (index <= 0) return;
    const next = [...list];
    const [row] = next.splice(index, 1);
    void persist([{ ...row, enabled: true }, ...next], `"${row.name}" dijadikan template default.`);
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
    void persist(list.filter((_, i) => i !== index), 'Template dihapus.');
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

  const insertVariable = (token: string) => editorRef.current?.insert(token);

  const lines = draft ? draft.html.split('\n').length : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Tulis atau tempel HTML/CSS bebas per kartu (ratusan baris). Template aktif pertama menjadi default saat
          mencetak; render terjadi di browser, server menyimpan sebagai teks tersanitasi.
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
                  <p className="font-medium text-slate-200 flex items-center gap-2">
                    {row.name || '(tanpa nama)'}
                    {index === defaultIndex && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/15 text-cyan-300">default</span>
                    )}
                  </p>
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
                <td className={`${cellClass} font-mono text-xs`}>
                  {row.html.length.toLocaleString('id-ID')} / {MAX_HTML.toLocaleString('id-ID')}
                </td>
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
                        onClick={() => duplicate(index)}
                        disabled={!canEdit || busy || list.length >= MAX_TEMPLATES}
                        className="px-2 py-1 rounded text-xs bg-slate-700/40 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                      >
                        Gandakan
                      </button>
                      {index !== defaultIndex && (
                        <button
                          type="button"
                          onClick={() => makeDefault(index)}
                          disabled={!canEdit || busy}
                          className="px-2 py-1 rounded text-xs bg-cyan-600/15 text-cyan-300 hover:bg-cyan-600/25 disabled:opacity-40"
                        >
                          Jadikan default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleEnabled(index)}
                        disabled={!canEdit || busy}
                        className="px-2 py-1 rounded text-xs bg-slate-700/40 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
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
          <div className="mx-auto w-full max-w-[1500px] rounded-none sm:rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-800/80">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              <p className="ml-2 font-mono text-xs text-slate-300 truncate">{draft.name || 'tanpa-nama'}.html</p>
              <span className="text-[11px] text-slate-500">
                {lines.toLocaleString('id-ID')} baris · {draft.html.length.toLocaleString('id-ID')} karakter
              </span>
              <span
                className={`ml-auto text-[11px] font-medium ${
                  draftErrors.length === 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {draftErrors.length === 0 ? 'valid' : `${draftErrors.length} masalah`}
              </span>
            </div>

            <div className="grid xl:grid-cols-[1fr_360px]">
              {/* Kolom editor */}
              <div className="p-4 space-y-3 min-w-0">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex-1 min-w-[180px]">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Nama template
                    </span>
                    <input
                      value={draft.name}
                      maxLength={40}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                      placeholder="Klasik"
                    />
                  </label>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Tinggi editor
                    </span>
                    <div className="flex gap-1">
                      {HEIGHTS.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setHeight(item.value)}
                          className={`px-2 py-1.5 rounded text-xs border ${
                            height === item.value
                              ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                              : 'border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <CodeEditor
                  ref={editorRef}
                  value={draft.html}
                  onChange={(html) => setDraft((current) => (current ? { ...current, html } : current))}
                  height={height}
                  ariaLabel="Editor HTML template voucher"
                />
                <p className="text-[11px] text-slate-500">
                  Scroll vertikal & horizontal ada di dalam editor. Seret sudut kanan bawah untuk mengatur tinggi.
                  Tab = 2 spasi, Ctrl/Cmd+F mencari, Ctrl/Cmd+Z undo.
                </p>

                {draftErrors.length > 0 && (
                  <ul className="text-xs text-rose-400 space-y-1 border border-rose-500/30 bg-rose-500/5 rounded p-3">
                    {draftErrors.map((error) => (
                      <li key={error}>• {error}</li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                    />
                    Aktif — tampil sebagai pilihan saat mencetak
                  </label>
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

              {/* Kolom pratinjau + variabel */}
              <aside className="border-t xl:border-t-0 xl:border-l border-slate-700 p-4 space-y-4">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Pratinjau</p>
                    <div className="flex gap-1">
                      {(['voucher', 'member'] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setPreviewKind(kind)}
                          className={`px-2 py-0.5 rounded text-[11px] border ${
                            previewKind === kind
                              ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10'
                              : 'border-slate-700 text-slate-400'
                          }`}
                        >
                          {kind === 'voucher' ? 'Voucher' : 'Member'}
                        </button>
                      ))}
                      <select
                        value={previewCount}
                        onChange={(e) => setPreviewCount(Number(e.target.value) as 1 | 4 | 8)}
                        className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[11px] text-slate-300"
                        aria-label="Jumlah contoh kartu"
                      >
                        <option value={1}>1 kartu</option>
                        <option value={4}>4 kartu</option>
                        <option value={8}>8 kartu</option>
                      </select>
                    </div>
                  </div>
                  <iframe
                    title="Pratinjau template voucher"
                    sandbox=""
                    srcDoc={preview}
                    className="w-full rounded border border-slate-700 bg-white"
                    style={{ height: 300 }}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Renderer yang sama dengan cetak. Data contoh, tidak menyimpan apa pun.
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Grid halaman</p>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {[1, 2, 3].map((cols) => (
                      <button
                        key={cols}
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, layout: { ...draft.layout, columns: cols as 1 | 2 | 3 } })
                        }
                        className={`py-1.5 rounded font-mono text-xs border ${
                          draft.layout.columns === cols
                            ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                            : 'border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        {cols} kolom
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-[10px] text-slate-500 mb-0.5">Margin (mm)</span>
                      <input
                        type="number"
                        min={5}
                        max={24}
                        step={0.5}
                        value={draft.layout.marginMm}
                        onChange={(e) =>
                          setDraft({ ...draft, layout: { ...draft.layout, marginMm: Number(e.target.value) } })
                        }
                        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-xs text-slate-200"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] text-slate-500 mb-0.5">Jarak (mm)</span>
                      <input
                        type="number"
                        min={2}
                        max={15}
                        step={0.5}
                        value={draft.layout.gapMm}
                        onChange={(e) =>
                          setDraft({ ...draft, layout: { ...draft.layout, gapMm: Number(e.target.value) } })
                        }
                        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-xs text-slate-200"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    Variabel ({variables.length}) — klik untuk sisip di kursor
                  </p>
                  <div className="max-h-[240px] overflow-y-auto space-y-0.5 pr-1">
                    {variables.map((item) => (
                      <button
                        key={item.token}
                        type="button"
                        onClick={() => insertVariable(item.token)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-slate-800"
                        title={item.label}
                      >
                        <code className="font-mono text-[11px] text-cyan-300">{item.token}</code>
                        <span className="block text-[10px] text-slate-500 truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-slate-800 bg-slate-800/40 p-2 text-[10px] leading-relaxed text-slate-400">
                  <p className="text-slate-300 mb-1">Batas renderer (bukan bug)</p>
                  HTML biasa, CSS, dan tag <code>&lt;style&gt;</code> didukung. Script tidak dieksekusi, dan tag
                  aktif (script/iframe/form/svg/img), URL luar, <code>url()</code> CSS, serta atribut{' '}
                  <code>on*</code> ditolak server agar aman.
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoucherTemplatesPanel;