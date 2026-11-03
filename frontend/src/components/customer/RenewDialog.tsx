import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';

/**
 * Dialog perpanjangan layanan (Hotspot & PPPoE).
 *
 * Semua angka berasal dari server (`/customers/:id/renewal-preview`), bukan
 * dihitung di browser: masa aktif dan nominal harus sama dengan yang dipakai
 * backend saat menyimpan. Kunci idempoten dibuat sekali per dialog agar klik
 * ganda tidak menagih dua kali.
 */

type Method = 'cash' | 'transfer' | 'qris' | 'other';

interface Preview {
  customer: { id: number; name: string; internet_no: string | null; status: string };
  account: {
    username: string;
    profile_type: 'hotspot' | 'ppp';
    status: string;
    expires_at: string | null;
    current_profile: string;
  };
  profile: { id: number; name: string; validity_value: number; validity_unit: string };
  period: { start_date: string; end_date: string; days: number };
  amount: { base: number; tax: number; total: number };
}

interface ProfileOption {
  id: number;
  name: string;
  sell_price: number;
  is_active: number;
  validity_value?: number;
}

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

const tanggal = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const readError = (error: unknown, fallback: string): string => {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
};

const inputClass =
  'w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400';

export const RenewDialog: React.FC<{
  customerId: number;
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ customerId, onClose, onDone }) => {
  const idempotencyKey = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `renew-${customerId}-${Date.now()}`,
  );

  const [preview, setPreview] = useState<Preview | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (profile?: string) => {
      try {
        const { data } = await api.get<Preview>(`/api/customers/${customerId}/renewal-preview`, {
          params: profile ? { profile_id: profile } : undefined,
        });
        setPreview(data);
        setProfileId(String(data.profile.id));
        if (profiles.length === 0) {
          const list = await api.get<ProfileOption[]>(`/api/profiles/${data.account.profile_type}`);
          // Paket tanpa masa aktif tidak bisa diperpanjang (ditolak backend),
          // jadi jangan ditawarkan di pilihan.
          setProfiles(
            Array.isArray(list.data)
              ? list.data.filter((p) => p.is_active && Number(p.validity_value ?? 0) > 0)
              : [],
          );
        }
        setError(null);
      } catch (e) {
        setError(readError(e, 'Gagal memuat data perpanjangan.'));
      }
    },
    [customerId, profiles.length],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const ubahPaket = async (value: string) => {
    setProfileId(value);
    if (value) await load(value);
  };

  const kirim = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/api/customers/${customerId}/renew`, {
        profile_id: profileId ? Number(profileId) : undefined,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        idempotency_key: idempotencyKey.current,
      });
      const sisa = data?.account?.expires_at ? tanggal(data.account.expires_at) : '—';
      onDone(`Layanan diperpanjang sampai ${sisa}.`);
    } catch (e) {
      setError(readError(e, 'Perpanjangan gagal diproses.'));
      setBusy(false);
    }
  };

  const info = useMemo(() => {
    if (!preview) return [];
    return [
      ['Pelanggan', preview.customer.name],
      ['No. Internet', preview.customer.internet_no ?? '—'],
      ['Username', preview.account.username],
      ['Jenis layanan', preview.account.profile_type === 'ppp' ? 'PPPoE' : 'Hotspot'],
      ['Paket saat ini', preview.account.current_profile],
      ['Status', preview.account.status],
      ['Expired', tanggal(preview.account.expires_at)],
    ] as Array<[string, string]>;
  }, [preview]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Perpanjang Layanan</h2>
            <p className="mt-1 text-xs text-slate-400">
              Tagihan dibuat, dibayar, lalu masa aktif diperbarui dalam satu proses.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-white">
            Tutup
          </button>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {!preview && !error && <p className="mt-4 text-sm text-slate-400">Memuat data…</p>}

        {preview && (
          <>
            <dl className="mt-4 space-y-1 text-sm">
              {info.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-slate-700/40 py-1">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="text-right text-slate-100">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-400">Paket perpanjangan</span>
                <select value={profileId} onChange={(e) => void ubahPaket(e.target.value)} className={inputClass}>
                  {profiles.length === 0 && <option value={String(preview.profile.id)}>{preview.profile.name}</option>}
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {rupiah(p.sell_price)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Masa aktif baru</p>
                  <p className="mt-1 font-medium text-slate-100">{tanggal(preview.period.end_date)}</p>
                  <p className="text-xs text-slate-500">
                    {preview.period.start_date} · {preview.period.days} hari
                  </p>
                </div>
                <div className="rounded-lg bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Nominal tagihan</p>
                  <p className="mt-1 font-medium text-cyan-300">{rupiah(preview.amount.total)}</p>
                  <p className="text-xs text-slate-500">
                    paket {rupiah(preview.amount.base)}
                    {preview.amount.tax > 0 ? ` + pajak ${rupiah(preview.amount.tax)}` : ''}
                  </p>
                </div>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-400">Metode pembayaran</span>
                <select value={method} onChange={(e) => setMethod(e.target.value as Method)} className={inputClass}>
                  <option value="cash">Tunai</option>
                  <option value="transfer">Transfer</option>
                  <option value="qris">QRIS</option>
                  <option value="other">Lainnya</option>
                </select>
              </label>

              {method === 'transfer' || method === 'qris' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-400">Referensi pembayaran</span>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={64}
                    placeholder="Nomor transaksi / berita transfer"
                    className={inputClass}
                  />
                </label>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block text-slate-400">Catatan (opsional)</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={255}
                  className={inputClass}
                  placeholder="mis. perpanjangan di konter"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:text-white"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void kirim()}
                disabled={busy}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-400 disabled:opacity-60"
              >
                {busy ? 'Memproses…' : `Bayar & Perpanjang ${rupiah(preview.amount.total)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};