import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import api from '../../services/api';
import { useBackgroundRefresh } from '../../hooks/useBackgroundRefresh';
import { useAuth } from '../../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  errorMessage,
} from '../../components/net/NetUI';
import { TablePager, useTablePager } from '../../components/TablePager';
import {
  buildPrintDocument,
  cardFromRow,
  printHtmlDocument,
  type VoucherPrintBrand,
  type VoucherPrintLayout,
} from '../../utils/voucher-print';

interface PrintTemplate {
  id: string;
  name: string;
  html?: string;
  enabled?: boolean;
  layout?: VoucherPrintLayout;
}

/**
 * Voucher Management — satu halaman per tipe layanan.
 *
 * Semua aksi massal memakai CENTANG di daftar: yang dipilih hanya itu yang
 * diubah/dihapus/dicetak/dikirim. Bila tidak ada yang dicentang, aksi berlaku
 * pada baris yang sedang tampil (hasil filter), bukan seluruh tabel.
 *
 * Cakupan data dipaksa di server: reseller hanya menerima voucher miliknya,
 * termasuk untuk ekspor dan pengiriman WhatsApp.
 */

type VoucherType = 'hotspot' | 'ppp';
type Status = 'new-created' | 'ready-to-use' | 'active' | 'expired';

interface VoucherRow {
  id: number;
  profile_type: VoucherType;
  profile_id: number;
  profile_name: string;
  user_type: 'voucher' | 'member';
  username: string;
  password: string;
  customer_id: number | null;
  customer_name?: string | null;
  status: Status;
  price: number;
  tax_amount: number;
  first_login_at: string | null;
  expires_at: string | null;
  online_seconds: number;
  quota_used_bytes: number;
  owner_id?: number | null;
  owner_name?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
}

interface ProfileOption {
  id: number;
  name: string;
  owner_id?: number | null;
  owner_name?: string | null;
}

interface OwnerOption {
  id: number;
  name: string;
  email: string;
  role: string;
}

const STATUS_TONE: Record<Status, 'good' | 'warn' | 'bad' | 'mute'> = {
  'new-created': 'mute',
  'ready-to-use': 'warn',
  active: 'good',
  expired: 'bad',
};

const STATUS_LABEL: Record<Status, string> = {
  'new-created': 'baru dibuat',
  'ready-to-use': 'siap pakai',
  active: 'aktif',
  expired: 'kedaluwarsa',
};

const readError = (error: unknown): string => {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return 'Terjadi kesalahan saat menghubungi server.';
};

const inputClass =
  'rounded-lg border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none';

const TITLE: Record<VoucherType, string> = {
  hotspot: 'Voucher Hotspot',
  ppp: 'Voucher PPPoE',
};

type Charset = 'upper' | 'lower' | 'mixed' | 'alnum' | 'digit';

/**
 * Pilihan karakter kode voucher. Karakter ambigu (0/O, 1/I/L) dibuang di
 * server, jadi yang tercetak selalu terbaca jelas. `min` = panjang minimal.
 */
const CHARSET_OPTIONS: Array<{ value: Charset; label: string; min: number }> = [
  { value: 'upper', label: 'Hanya huruf besar (A-Z)', min: 4 },
  { value: 'lower', label: 'Hanya huruf kecil (a-z)', min: 4 },
  { value: 'mixed', label: 'Huruf besar & kecil', min: 4 },
  { value: 'alnum', label: 'Huruf besar, kecil & angka', min: 4 },
  { value: 'digit', label: 'Hanya angka (minimal 8 digit)', min: 8 },
];

/** Satu baris pada dropdown "Konfigurasi & Manajemen". */
const MenuItem: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, danger, children }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className={`flex w-full items-center px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
      danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-slate-700/60'
    }`}
  >
    {children}
  </button>
);

const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">{children}</div>
);

const VoucherManagement: React.FC<{ type: VoucherType }> = ({ type }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Endpoint bulk status & hapus dibatasi admin/operator. Tombol yang pasti
  // ditolak server tidak ditampilkan, supaya tidak jadi jebakan.
  const canBulkWrite = isAdmin || user?.role === 'operator';

  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filter
  const [userFilter, setUserFilter] = useState<'all' | 'voucher' | 'member'>('voucher');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [profileFilter, setProfileFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // Pilihan (centang)
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Dialog
  // Pencatatan penjualan voucher: uang masuk, bukan aktivitas login.
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleBusy, setSaleBusy] = useState(false);
  const [unsold, setUnsold] = useState<
    Array<{ id: number; username: string; profile_name: string; profile_type: string; sell_price: number }>
  >([]);
  const [sale, setSale] = useState({
    voucher_id: '',
    profile_name: '',
    profile_type: 'hotspot' as 'hotspot' | 'ppp',
    quantity: '1',
    cost_price: '',
    sell_price: '',
    buyer_name: '',
    method: 'cash',
    note: '',
  });
  const [genOpen, setGenOpen] = useState(false);
  const [genProfile, setGenProfile] = useState('');
  const [genCount, setGenCount] = useState('10');
  const [genLength, setGenLength] = useState('8');
  const [genMode, setGenMode] = useState<'same' | 'separate'>('same');
  const [genCharset, setGenCharset] = useState<Charset>('alnum');
  const [genOwner, setGenOwner] = useState('');
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Menu "Konfigurasi & Manajemen": aksi yang tidak dipakai tiap menit
  // dikumpulkan di satu dropdown supaya toolbar tidak penuh tombol.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Dialog cetak: dasar pencetakan dipilih di sini (yang dicentang, kriteria
  // status/profil/pemilik, atau rentang tanggal pembuatan).
  const [printOpen, setPrintOpen] = useState(false);
  const [printUseSelection, setPrintUseSelection] = useState(true);
  const [printTemplate, setPrintTemplate] = useState('');
  // Preset halaman cetak: 'template' = ikuti layout template, selain itu override.
  const [printPreset, setPrintPreset] = useState<'template' | 'p30' | 'l60'>('template');
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [printBrand, setPrintBrand] = useState<VoucherPrintBrand>({ brand: '', tagline: '' });
  const [printStatus, setPrintStatus] = useState<'' | Status>('new-created');
  const [printProfile, setPrintProfile] = useState('');
  const [printOwner, setPrintOwner] = useState('');
  const [printFrom, setPrintFrom] = useState('');
  const [printTo, setPrintTo] = useState('');

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const [list, countData, profileList] = await Promise.all([
        api.get<VoucherRow[]>('/api/vouchers', {
          params: {
            limit: 500,
            profile_type: type,
            user_type: userFilter === 'all' ? undefined : userFilter,
            status: statusFilter || undefined,
            profile_id: profileFilter || undefined,
            owner_id: ownerFilter || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            search: search.trim() || undefined,
          },
        }),
        api.get<Record<string, number>>('/api/vouchers/counts'),
        api.get<ProfileOption[]>(`/api/profiles/${type}`),
      ]);
      setRows(Array.isArray(list.data) ? list.data : []);
      setCounts(countData.data ?? {});
      setProfiles(Array.isArray(profileList.data) ? profileList.data : []);
    } catch (err) {
      setError(readError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [type, userFilter, statusFilter, profileFilter, ownerFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  // Daftar pemilik hanya untuk admin; reseller/operator dipaksa server.
  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<OwnerOption[]>('/api/admin/owners')
      .then((res) => setOwners(Array.isArray(res.data) ? res.data : []))
      .catch(() => setOwners([]));
  }, [isAdmin]);

  // Template cetak dari Pengaturan → Template Voucher.
  useEffect(() => {
    api
      .get<{ templates: PrintTemplate[]; brand?: VoucherPrintBrand }>('/api/vouchers/templates')
      .then((res) => {
        setTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []);
        if (res.data?.brand) setPrintBrand(res.data.brand);
      })
      .catch(() => setTemplates([]));
  }, []);

  // Ganti tipe layanan = ganti halaman; filter profil ikut direset.
  useEffect(() => {
    setProfileFilter('');
    setSelected(new Set());
  }, [type]);

  // Dropdown ditutup oleh klik di luar, Escape, atau pindah halaman.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const visible = rows;

  // Voucher bisa ratusan: tampilkan sebagian per halaman. Centang tetap
  // berlaku lintas halaman (disimpan di `selected`), jadi aksi massal tidak
  // terpengaruh pagination.
  const pager = useTablePager(visible, 25);

  const allChecked = visible.length > 0 && visible.every((row) => selected.has(row.id));

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(visible.map((row) => row.id)));
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Sasaran aksi massal: HANYA voucher yang ditandai. Tidak ada lagi jatuh ke
   * "semua baris yang tampil" — aksi tanpa centang harus ditolak, bukan
   * diam-diam mengenai seluruh hasil filter.
   */
  const targetIds = useMemo(() => [...selected], [selected]);
  const hasSelection = selected.size > 0;

  // Panjang minimal kode mengikuti karakter yang dipilih (mode angka = 8).
  const genMinLength = CHARSET_OPTIONS.find((option) => option.value === genCharset)?.min ?? 4;

  const flash = (message: string) => {
    setToast(message);
    setError(null);
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      flash(await action());
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const { data } = await api.post<{
        created: number;
        profile: string;
        owner_name: string | null;
      }>('/api/vouchers/generate', {
        profile_type: type,
        user_type: 'voucher',
        profile_id: Number(genProfile),
        count: Number(genCount),
        length: Number(genLength),
        username_mode: genMode,
        charset: genCharset,
        // Pemilik hanya dikirim admin; server memaksa peran lain.
        owner_id: isAdmin && genOwner ? Number(genOwner) : undefined,
      });
      setGenOpen(false);
      setSelected(new Set());
      await load();
      const owner = data.owner_name ? ` Pemilik: ${data.owner_name}.` : '';
      return `${data.created} voucher dibuat untuk profil ${data.profile}.${owner}`;
    });

  const activateOne = (row: VoucherRow) =>
    run(async () => {
      await api.post(`/api/vouchers/${row.id}/activate`);
      await load();
      return `Voucher ${row.username} diaktifkan; masa aktif mulai berjalan.`;
    });

  const bulkStatus = (status: Status, label: string) =>
    run(async () => {
      const { data } = await api.patch<{ changed: number }>('/api/vouchers/bulk/status', {
        ids: targetIds,
        status,
      });
      setSelected(new Set());
      await load();
      return `${data.changed} voucher ditandai ${label}.`;
    });

  const bulkDelete = () =>
    run(async () => {
      const { data } = await api.post<{ removed: number }>('/api/vouchers/remove', {
        ids: targetIds,
      });
      setConfirmDelete(false);
      setSelected(new Set());
      await load();
      return `${data.removed} voucher dihapus beserta akun RADIUS-nya.`;
    });

  const expireOverdue = () =>
    run(async () => {
      const { data } = await api.post<{ expired: number }>('/api/vouchers/expire-overdue');
      await load();
      return `${data.expired} voucher lewat masa aktif ditandai kedaluwarsa.`;
    });

  /** Ambil berkas dari server (butuh Bearer token), lalu unduh atau buka. */
  const fetchFile = async (path: string, filename: string, open: boolean) => {
    const res = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    if (open) {
      const win = window.open(url, '_blank');
      if (!win) {
        setError('Jendela cetak diblokir browser. Izinkan pop-up untuk panel ini.');
        URL.revokeObjectURL(url);
        return;
      }
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
    }
    // Beri waktu viewer memuat blob sebelum dilepas.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /** Query ekspor: tipe layanan halaman ini + id yang jadi sasaran. */
  const exportQuery = () => {
    const params = new URLSearchParams({ profile_type: type });
    if (targetIds.length > 0) params.set('ids', targetIds.join(','));
    return `?${params.toString()}`;
  };

  const exportCsv = () =>
    run(async () => {
      await fetchFile(`/api/vouchers/export.csv${exportQuery()}`, `voucher-${type}.csv`, false);
      return `${targetIds.length} voucher diekspor ke CSV.`;
    });

  /** Buka dialog cetak; sasaran default = voucher yang ditandai. */
  const openPrint = () => {
    if (!hasSelection) return;
    setPrintUseSelection(true);
    setPrintTemplate(templates.find((row) => row.enabled !== false)?.id ?? '');
    setPrintStatus('new-created');
    setPrintProfile(profileFilter);
    setPrintOwner(ownerFilter);
    setPrintFrom('');
    setPrintTo('');
    setPrintOpen(true);
  };

  /**
   * Cetak sesuai kriteria. Daftar yang cocok diambil dulu supaya jumlah yang
   * dilaporkan nyata dan yang dicetak persis baris itu — bukan tebakan dari
   * baris yang kebetulan tampil di layar.
   */
  const printVoucher = async () => {
    const useSelection = printUseSelection && selected.size > 0;

    setBusy(true);
    setError(null);
    try {
      let chosen: VoucherRow[] = useSelection ? rows.filter((row) => selected.has(row.id)) : [];
      if (!useSelection) {
        const { data } = await api.get<VoucherRow[]>('/api/vouchers', {
          params: {
            limit: 500,
            profile_type: type,
            status: printStatus || undefined,
            profile_id: printProfile || undefined,
            owner_id: printOwner || undefined,
            date_from: printFrom || undefined,
            date_to: printTo || undefined,
          },
        });
        chosen = Array.isArray(data) ? data : [];
      }
      if (chosen.length === 0) {
        setError('Tidak ada voucher yang cocok dengan kriteria cetak.');
        return;
      }

      const template = templates.find((item) => item.id === printTemplate) ?? templates[0];
      if (!template?.html) {
        // Template lama tanpa HTML: pakai PDF bawaan server.
        await fetchFile(
          `/api/vouchers/export.pdf?profile_type=${type}&ids=${chosen.map((row) => row.id).join(',')}`,
          `voucher-${type}-${new Date().toISOString().slice(0, 10)}.pdf`,
          true,
        );
        setPrintOpen(false);
        setToast(`${chosen.length} voucher disiapkan untuk dicetak (PDF bawaan).`);
        return;
      }

      // Cetak di browser dengan template HTML/CSS milik admin. Dokumen dibuat
      // dari iframe sandbox; tidak ada HTML yang dirender di server.
      const printedAt = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
      printHtmlDocument(
        buildPrintDocument(
          template.html,
          chosen.map((row) => cardFromRow(row)),
          printPreset === 'p30'
            ? { ...(template.layout ?? { columns: 6, marginMm: 8, gapMm: 2 }), columns: 6, rows: 5, orientation: 'portrait' as const }
            : printPreset === 'l60'
              ? { ...(template.layout ?? { columns: 10, marginMm: 8, gapMm: 2 }), columns: 10, rows: 6, orientation: 'landscape' as const }
              : template.layout ?? { columns: 3, marginMm: 8.5, gapMm: 3.5 },
          printBrand,
          printedAt,
        ),
      );
      setPrintOpen(false);
      setToast(
        `${chosen.length} voucher dikirim ke dialog cetak browser — pilih "Save as PDF" bila ingin berkas` +
          (chosen.length >= 500 ? ' (batas 500 per cetak).' : '.'),
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const sendWhatsApp = () =>
    run(async () => {
      const { data } = await api.post<{
        sent: number;
        skipped: number;
        pdf_attached: boolean;
        note?: string;
        message: string;
      }>('/api/vouchers/send-whatsapp', {
        ids: targetIds,
        phone: waPhone.trim() || undefined,
      });
      setWaOpen(false);
      const extra = data.note ? ` ${data.note}` : '';
      const pdf = data.pdf_attached ? ' PDF dilampirkan.' : ' PDF tidak dilampirkan (lihat catatan).';
      return `${data.message}${pdf}${extra}`;
    });

  const openSale = async () => {
    setSale({
      voucher_id: '',
      profile_name: '',
      profile_type: type,
      quantity: '1',
      cost_price: '',
      sell_price: '',
      buyer_name: '',
      method: 'cash',
      note: '',
    });
    setSaleOpen(true);
    try {
      const { data } = await api.get<typeof unsold>('/api/sales/unsold-vouchers?limit=200');
      setUnsold(Array.isArray(data) ? data : []);
    } catch {
      setUnsold([]);
    }
  };

  /**
   * Simpan penjualan. Modal dan harga jual WAJIB: tanpa keduanya laporan hanya
   * jadi omzet yang menyesatkan. Bila voucher dipilih, profil & modal terisi
   * otomatis dari data voucher dan tetap bisa disesuaikan.
   */
  const submitSale = async () => {
    setSaleBusy(true);
    try {
      const body: Record<string, unknown> = {
        profile_name: sale.profile_name.trim(),
        profile_type: sale.profile_type,
        quantity: Number(sale.quantity || '1'),
        cost_price: Number(sale.cost_price || '0'),
        sell_price: Number(sale.sell_price || '0'),
        method: sale.method,
      };
      if (sale.voucher_id) body.voucher_id = Number(sale.voucher_id);
      if (sale.buyer_name.trim()) body.buyer_name = sale.buyer_name.trim();
      if (sale.note.trim()) body.note = sale.note.trim();
      if (!body.profile_name && !sale.voucher_id) {
        setToast('');
        setError('Isi nama profil atau pilih voucher yang dijual.');
        setSaleBusy(false);
        return;
      }
      await api.post('/api/sales/vouchers', body);
      setSaleOpen(false);
      setToast(
        `Penjualan dicatat: ${sale.quantity} voucher, jual ${rupiah(Number(sale.sell_price || 0) * Number(sale.quantity || 1))}.`,
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaleBusy(false);
    }
  };

  const rupiah = (value: number) =>
    new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(value);

  const time = (value: string | null) =>
    value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-';

  return (
    <div className="page-container">
      <PageHeader
        title={TITLE[type]}
        subtitle={
          type === 'hotspot'
            ? 'Voucher hotspot: username = password, masa aktif mulai login pertama.'
            : 'Akun PPPoE: username dan password terpisah, ditulis ke FreeRADIUS.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={menuRef}>
              <Button
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                Konfigurasi &amp; Manajemen <span className="ml-1 text-[10px] text-slate-400">▼</span>
              </Button>
              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Konfigurasi dan manajemen voucher"
                  className="absolute left-0 z-50 mt-2 max-h-[calc(100vh-14rem)] w-72 max-w-[calc(100vw-4rem)] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl sm:left-auto sm:right-0"
                >
                  <div
                    className={`px-3 py-1.5 text-[11px] ${
                      hasSelection ? 'text-slate-400' : 'text-amber-300'
                    }`}
                  >
                    {hasSelection
                      ? `${selected.size} voucher ditandai — aksi berlaku pada ini saja`
                      : 'Pilih salah satu voucher dahulu'}
                  </div>

                  <MenuLabel>Voucher</MenuLabel>
                  <MenuItem
                    onClick={() => { setMenuOpen(false); setGenOpen(true); }}
                    disabled={busy}
                  >
                    Buat voucher…
                  </MenuItem>

                  <MenuLabel>Cetak &amp; berkas</MenuLabel>
                  <MenuItem
                    onClick={() => { setMenuOpen(false); openPrint(); }}
                    disabled={busy || !hasSelection}
                  >
                    Cetak voucher…
                  </MenuItem>
                  <MenuItem
                    onClick={() => { setMenuOpen(false); void exportCsv(); }}
                    disabled={busy || !hasSelection}
                  >
                    Ekspor CSV
                  </MenuItem>
                  <MenuItem
                    onClick={() => { setMenuOpen(false); setWaOpen(true); }}
                    disabled={busy || !hasSelection}
                  >
                    Kirim WhatsApp…
                  </MenuItem>

                  <MenuLabel>Penjualan</MenuLabel>
                  <MenuItem
                    onClick={() => { setMenuOpen(false); void openSale(); }}
                    disabled={busy || saleBusy}
                  >
                    Catat penjualan…
                  </MenuItem>

                  {canBulkWrite && (
                    <>
                      <MenuLabel>Ubah status sasaran</MenuLabel>
                      <MenuItem
                        onClick={() => { setMenuOpen(false); void bulkStatus('ready-to-use', 'siap pakai'); }}
                        disabled={busy || !hasSelection}
                      >
                        Tandai siap pakai
                      </MenuItem>
                      <MenuItem
                        onClick={() => { setMenuOpen(false); void bulkStatus('expired', 'kedaluwarsa'); }}
                        disabled={busy || !hasSelection}
                      >
                        Tandai kedaluwarsa
                      </MenuItem>
                    </>
                  )}

                  {isAdmin && (
                    <>
                      <MenuLabel>Perawatan</MenuLabel>
                      <MenuItem
                        onClick={() => { setMenuOpen(false); void expireOverdue(); }}
                        disabled={busy}
                      >
                        Perbarui voucher lewat masa aktif
                      </MenuItem>
                      <MenuItem
                        danger
                        onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                        disabled={busy || !hasSelection}
                      >
                        Hapus voucher…
                      </MenuItem>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        }
      />

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {toast}
        </div>
      )}
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {(['new-created', 'ready-to-use', 'active', 'expired'] as const).map((status) => (
          <Badge key={status} tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}: {counts[status] ?? 0}
          </Badge>
        ))}
      </div>

      <Card>
        {/* Toolbar manajemen: filter + aksi berkas */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-700/60 p-1">
            {(['all', 'voucher', 'member'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setUserFilter(key)}
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  userFilter === key
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {key === 'all' ? 'Semua' : key === 'voucher' ? 'Voucher' : 'Akun pelanggan'}
              </button>
            ))}
          </div>

          <select
            value={profileFilter}
            onChange={(event) => setProfileFilter(event.target.value)}
            className={inputClass}
            title="Filter profil"
          >
            <option value="">Semua profil</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | Status)}
            className={inputClass}
            title="Filter status"
          >
            <option value="">Semua status</option>
            {(['new-created', 'ready-to-use', 'active', 'expired'] as const).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>

          {isAdmin && (
            <select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              className={inputClass}
              title="Filter pemilik"
            >
              <option value="">Semua pemilik</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} ({owner.role})
                </option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={inputClass}
            title="Dibuat sejak tanggal"
          />
          <span className="text-xs text-slate-500">s/d</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className={inputClass}
            title="Dibuat sampai tanggal"
          />

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari username / pelanggan…"
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        {/* Sasaran aksi massal. Tombol aksinya ada di dropdown header supaya
            baris ini tidak lagi menumpuk enam tombol. */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2">
          <span className={`text-xs ${hasSelection ? 'text-slate-400' : 'text-amber-300'}`}>
            {hasSelection
              ? `${selected.size} voucher ditandai — aksi massal hanya berlaku pada ini`
              : 'Pilih salah satu voucher dahulu'}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="ml-auto text-xs font-medium text-cyan-300 hover:text-cyan-200"
          >
            Buka Konfigurasi &amp; Manajemen
          </button>
        </div>

        {loading ? (
          <Loading label="Memuat voucher…" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-700/60">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800/80 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Pilih semua"
                      className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-cyan-500"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Password</th>
                  <th className="px-3 py-2 font-medium">Profil</th>
                  <th className="px-3 py-2 font-medium">Pelanggan</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Harga</th>
                  <th className="px-3 py-2 font-medium">Kedaluwarsa</th>
                  <th className="px-3 py-2 font-medium">Pemilik</th>
                  <th className="px-3 py-2 font-medium">Dibuat oleh</th>
                  <th className="px-3 py-2 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60 text-slate-200">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-400">
                      Belum ada voucher yang cocok dengan filter ini.
                    </td>
                  </tr>
                ) : (
                  pager.pageRows.map((row) => (
                    <tr key={row.id} className={selected.has(row.id) ? 'bg-cyan-500/5' : undefined}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleOne(row.id)}
                          aria-label={`Pilih ${row.username}`}
                          className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-cyan-500"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-cyan-200">{row.username}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.password}</td>
                      <td className="px-3 py-2 text-xs">{row.profile_name}</td>
                      <td className="px-3 py-2 text-xs">
                        {row.customer_name ?? <span className="text-slate-500">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {rupiah(Number(row.price) + Number(row.tax_amount))}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">{time(row.expires_at)}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.owner_name ?? <span className="text-slate-500">Tanpa pemilik</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{row.created_by_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {canBulkWrite && row.status !== 'active' && row.status !== 'expired' && (
                            <Button onClick={() => void activateOne(row)} disabled={busy}>
                              Aktifkan
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {visible.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <TablePager unit="voucher" {...pager.pagerProps} />
          </div>
        )}
      </Card>

      {/* Dialog cetak: dasar pencetakan dipilih di sini */}
      {printOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cetak voucher"
            className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-5"
          >
            <h2 className="text-lg font-semibold text-white">Cetak voucher {type}</h2>
            <p className="text-xs text-slate-400">
              Pilih dasar pencetakan. Tanggal cetak dan jumlah voucher ikut tercetak di kaki setiap
              halaman PDF.
            </p>

            {selected.size > 0 && (
              <label className="flex items-start gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={printUseSelection}
                  onChange={(event) => setPrintUseSelection(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-700 text-cyan-500"
                />
                <span>
                  Hanya {selected.size} voucher yang dicentang
                  <span className="block text-[11px] text-slate-500">
                    Bila dicentang, kriteria di bawah diabaikan.
                  </span>
                </span>
              </label>
            )}

            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="print-template">
                Template cetak
              </label>
              <select
                id="print-template"
                value={printTemplate}
                onChange={(event) => setPrintTemplate(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {templates.length === 0 && <option value="">Template bawaan</option>}
                {templates
                  .filter((template) => template.enabled !== false)
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
              </select>
              <label className="mt-3 block text-xs font-medium text-slate-300">
                Susunan halaman
                <select
                  value={printPreset}
                  onChange={(event) => setPrintPreset(event.target.value as 'template' | 'p30' | 'l60')}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="template">Ikuti template</option>
                  <option value="p30">A4 potret 6×5 — 30 kartu/halaman</option>
                  <option value="l60">A4 lanskap 10×6 — 60 kartu/halaman</option>
                </select>
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Template diatur di Pengaturan → Template Voucher (HTML/CSS). Cetak memakai dialog browser —
                pilih &quot;Save as PDF&quot; bila ingin menyimpan berkas.
              </p>
            </div>

            <div
              className={`grid gap-3 sm:grid-cols-2 ${
                printUseSelection && selected.size > 0 ? 'opacity-50' : ''
              }`}
            >
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="print-status">
                  Status voucher
                </label>
                <select
                  id="print-status"
                  value={printStatus}
                  onChange={(event) => setPrintStatus(event.target.value as '' | Status)}
                  disabled={printUseSelection && selected.size > 0}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="">Semua status</option>
                  <option value="new-created">Baru dibuat (baru di-generate)</option>
                  <option value="ready-to-use">Siap pakai</option>
                  <option value="active">Aktif</option>
                  <option value="expired">Kedaluwarsa</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="print-profile">
                  Profil
                </label>
                <select
                  id="print-profile"
                  value={printProfile}
                  onChange={(event) => setPrintProfile(event.target.value)}
                  disabled={printUseSelection && selected.size > 0}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="">Semua profil</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              {isAdmin && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400" htmlFor="print-owner">
                    Pemilik
                  </label>
                  <select
                    id="print-owner"
                    value={printOwner}
                    onChange={(event) => setPrintOwner(event.target.value)}
                    disabled={printUseSelection && selected.size > 0}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="">Semua pemilik</option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name} ({owner.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="print-from">
                  Dibuat sejak
                </label>
                <input
                  id="print-from"
                  type="date"
                  value={printFrom}
                  onChange={(event) => setPrintFrom(event.target.value)}
                  disabled={printUseSelection && selected.size > 0}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="print-to">
                  Dibuat sampai
                </label>
                <input
                  id="print-to"
                  type="date"
                  value={printTo}
                  onChange={(event) => setPrintTo(event.target.value)}
                  disabled={printUseSelection && selected.size > 0}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              Maksimal 500 voucher sekali cetak. Kosongkan tanggal bila tidak dibatasi.
            </p>

            <div className="flex justify-end gap-2">
              <Button onClick={() => setPrintOpen(false)} disabled={busy}>
                Batal
              </Button>
              <Button variant="primary" onClick={() => void printVoucher()} disabled={busy}>
                {busy ? 'Menyiapkan…' : 'Cetak'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog buat voucher */}
      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Buat voucher {type}</h2>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="v-profile">
                Profil *
              </label>
              <select
                id="v-profile"
                value={genProfile}
                onChange={(event) => setGenProfile(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">Pilih profil…</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="v-count">
                  Jumlah voucher (1-1000)
                </label>
                <input
                  id="v-count"
                  type="number"
                  min={1}
                  max={1000}
                  value={genCount}
                  onChange={(event) => setGenCount(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="v-length">
                  Panjang kode ({genMinLength}-9)
                </label>
                <input
                  id="v-length"
                  type="number"
                  min={genMinLength}
                  max={9}
                  value={genLength}
                  onChange={(event) => setGenLength(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="v-charset">
                Karakter voucher
              </label>
              <select
                id="v-charset"
                value={genCharset}
                onChange={(event) => {
                  const next = event.target.value as Charset;
                  setGenCharset(next);
                  // Mode angka minimal 8 digit: naikkan panjang otomatis.
                  const min = CHARSET_OPTIONS.find((option) => option.value === next)?.min ?? 4;
                  if (Number(genLength) < min) setGenLength(String(min));
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {CHARSET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="v-mode">
                Format akun
              </label>
              <select
                id="v-mode"
                value={genMode}
                onChange={(event) => setGenMode(event.target.value as 'same' | 'separate')}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="same">username = password</option>
                <option value="separate">username &amp; password terpisah (password 4-6 digit angka)</option>
              </select>
            </div>

            {isAdmin && (
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="v-owner">
                  Pemilik voucher
                </label>
                <select
                  id="v-owner"
                  value={genOwner}
                  onChange={(event) => setGenOwner(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">Ikut pemilik profil (bawaan)</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name} ({owner.role})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Hanya admin yang bisa memilih pemilik. Operator/reseller selalu memakai pemilik
                  profil atau akunnya sendiri.
                </p>
              </div>
            )}

            <p className="text-[11px] text-slate-500">
              Username dibuat otomatis dan unik. Karakter 0/O dan 1/I/L tidak dipakai agar tidak
              salah baca saat dicetak.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setGenOpen(false)}>Batal</Button>
              <Button
                variant="primary"
                onClick={() => void generate()}
                disabled={busy || !genProfile || Number(genLength) < genMinLength}
              >
                {busy ? 'Membuat…' : 'Buat'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog kirim WhatsApp */}
      {saleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Catat penjualan voucher"
            className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-5"
          >
            <h2 className="text-lg font-semibold text-white">Catat penjualan voucher</h2>
            <p className="text-xs text-slate-400">
              Mencatat uang masuk. Masa aktif voucher tetap dihitung dari login pertama — login
              bukan penjualan, jadi keduanya dipisah.
            </p>

            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-voucher">
                Voucher terjual (opsional)
              </label>
              <select
                id="sale-voucher"
                value={sale.voucher_id}
                onChange={(event) => {
                  const id = event.target.value;
                  const picked = unsold.find((item) => String(item.id) === id);
                  setSale({
                    ...sale,
                    voucher_id: id,
                    profile_name: picked ? picked.profile_name : sale.profile_name,
                    profile_type: picked ? (picked.profile_type as 'hotspot' | 'ppp') : sale.profile_type,
                    sell_price: picked && picked.sell_price ? String(picked.sell_price) : sale.sell_price,
                  });
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">— penjualan borongan / tidak per voucher —</option>
                {unsold.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.username} · {item.profile_name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Daftar ini hanya voucher yang belum pernah dicatat terjual.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-profile">
                  Profil
                </label>
                <input
                  id="sale-profile"
                  value={sale.profile_name}
                  onChange={(event) => setSale({ ...sale, profile_name: event.target.value })}
                  placeholder="HS-1HARI"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-type">
                  Tipe
                </label>
                <select
                  id="sale-type"
                  value={sale.profile_type}
                  onChange={(event) =>
                    setSale({ ...sale, profile_type: event.target.value as 'hotspot' | 'ppp' })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="hotspot">hotspot</option>
                  <option value="ppp">ppp</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-qty">
                  Jumlah
                </label>
                <input
                  id="sale-qty"
                  value={sale.quantity}
                  onChange={(event) => setSale({ ...sale, quantity: event.target.value })}
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-method">
                  Metode
                </label>
                <select
                  id="sale-method"
                  value={sale.method}
                  onChange={(event) => setSale({ ...sale, method: event.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="cash">Tunai</option>
                  <option value="transfer">Transfer</option>
                  <option value="qris">QRIS / E-Wallet</option>
                  <option value="other">Lainnya</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-cost">
                  Harga modal / voucher
                </label>
                <input
                  id="sale-cost"
                  value={sale.cost_price}
                  onChange={(event) => setSale({ ...sale, cost_price: event.target.value })}
                  inputMode="decimal"
                  placeholder="1500"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-sell">
                  Harga jual / voucher
                </label>
                <input
                  id="sale-sell"
                  value={sale.sell_price}
                  onChange={(event) => setSale({ ...sale, sell_price: event.target.value })}
                  inputMode="decimal"
                  placeholder="3000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-buyer">
                  Pembeli (opsional)
                </label>
                <input
                  id="sale-buyer"
                  value={sale.buyer_name}
                  onChange={(event) => setSale({ ...sale, buyer_name: event.target.value })}
                  placeholder="Warung Bu Sri"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="sale-note">
                  Catatan (opsional)
                </label>
                <input
                  id="sale-note"
                  value={sale.note}
                  onChange={(event) => setSale({ ...sale, note: event.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              Total jual{' '}
              <span className="font-semibold text-emerald-300">
                {rupiah(Number(sale.sell_price || 0) * Number(sale.quantity || 0))}
              </span>
              {' · '}laba{' '}
              <span className="font-semibold text-amber-300">
                {rupiah(
                  (Number(sale.sell_price || 0) - Number(sale.cost_price || 0)) *
                    Number(sale.quantity || 0),
                )}
              </span>
            </div>

            <div className="flex justify-end gap-2">
              <Button onClick={() => setSaleOpen(false)} disabled={saleBusy}>
                Batal
              </Button>
              <Button variant="primary" onClick={() => void submitSale()} disabled={saleBusy}>
                {saleBusy ? 'Menyimpan…' : 'Simpan penjualan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {waOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Kirim voucher via WhatsApp</h2>
            <p className="text-xs text-slate-400">
              {targetIds.length} voucher akan dikirim sebagai PDF. Isi nomor tujuan, atau kosongkan
              untuk memakai nomor pelanggan (khusus akun member).
            </p>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="wa-phone">
                Nomor WhatsApp tujuan
              </label>
              <input
                id="wa-phone"
                value={waPhone}
                onChange={(event) => setWaPhone(event.target.value)}
                placeholder="08123456789"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Pengiriman memakai WhatsApp Gateway panel (menu WhatsApp Gateway). PDF tidak
                dilampirkan; username dan password ada di isi pesan.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setWaOpen(false)}>Batal</Button>
              <Button variant="primary" onClick={() => void sendWhatsApp()} disabled={busy}>
                {busy ? 'Mengirim…' : 'Kirim'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Hapus {targetIds.length} voucher?</h2>
            <p className="text-sm text-slate-400">
              Akun RADIUS-nya ikut dicabut sehingga tidak bisa login lagi. Riwayat sesi di radacct
              tetap tersimpan. Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmDelete(false)}>Batal</Button>
              <Button variant="danger" onClick={() => void bulkDelete()} disabled={busy}>
                {busy ? 'Menghapus…' : 'Ya, hapus'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoucherManagement;
