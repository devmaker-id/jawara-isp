import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { TablePager } from '../../components/TablePager';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  SearchInput,
  Table,
  Tabs,
  Toolbar,
  errorMessage,
  formatBytes,
  formatUptime,
  useNet,
} from '../../components/net/NetUI';

type Kind = 'hotspot' | 'ppp';

interface OnlineSession {
  acctuniqueid: string;
  username: string | null;
  jenis: Kind;
  nasipaddress: string;
  nas_name: string | null;
  nasporttype: string | null;
  nasportid: string | null;
  callingstationid: string;
  framedipaddress: string;
  acctstarttime: string | null;
  acctupdatetime: string | null;
  acctsessiontime: number;
  acctinputoctets: number;
  acctoutputoctets: number;
  profile_name: string | null;
  user_type: string | null;
  owner_id: number | null;
  owner_name: string | null;
  stale: boolean;
}

interface SessionDetail extends OnlineSession {
  acctsessionid: string;
  realm: string | null;
  connectinfo_start: string | null;
  acctterminatecause: string;
}

interface SessionList {
  rows: OnlineSession[];
  total: number;
}

const KIND_LABEL: Record<Kind, string> = { hotspot: 'Hotspot', ppp: 'PPPoE' };

const waktu = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-0.5 break-all text-sm text-slate-200">{children}</p>
  </div>
);

const DetailDialog: React.FC<{
  id: string;
  canDisconnect: boolean;
  onClose: () => void;
  onDisconnected: () => void;
}> = ({ id, canDisconnect, onClose, onDisconnected }) => {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`)
      .then((response) => alive && setDetail(response.data))
      .catch((requestError) => alive && setError(errorMessage(requestError)));
    return () => {
      alive = false;
    };
  }, [id]);

  const disconnect = async () => {
    if (!detail) return;
    const label = detail.username ?? detail.acctuniqueid;
    if (!window.confirm(`Putus sesi ${label} sekarang? Pelanggan akan terputus dan harus menyambung ulang.`)) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await api.post<{ ok: boolean; message: string }>(
        `/api/sessions/${encodeURIComponent(id)}/disconnect`,
      );
      setResult(response.data);
      if (response.data.ok) onDisconnected();
    } catch (requestError) {
      setResult({ ok: false, message: errorMessage(requestError) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sesi-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-800 shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700/60 px-5 py-4">
          <div>
            <h2 id="sesi-title" className="text-base font-semibold text-white">
              {detail?.username ?? 'Detail sesi'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {detail ? `${KIND_LABEL[detail.jenis]} · ${detail.nas_name ?? detail.nasipaddress}` : 'Memuat…'}
            </p>
          </div>
          <Button onClick={onClose}>Tutup</Button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {error && <ErrorNote message={error} />}
          {!detail && !error && <Loading label="Membaca detail sesi…" />}

          {detail && (
            <>
              {detail.stale && (
                <InfoNote tone="warn">
                  Sesi ini tidak mengirim accounting lebih dari 10 menit. Kemungkinan sudah terputus di
                  perangkat, tetapi NAS belum menutup sesi.
                </InfoNote>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Alamat IP">{detail.framedipaddress || '—'}</Field>
                <Field label="MAC / station">{detail.callingstationid || '—'}</Field>
                <Field label="NAS">{`${detail.nas_name ?? '—'} (${detail.nasipaddress})`}</Field>
                <Field label="Port NAS">{detail.nasportid || detail.nasporttype || '—'}</Field>
                <Field label="Profil">{detail.profile_name ?? '—'}</Field>
                <Field label="Jenis akun">{detail.user_type ?? '—'}</Field>
                <Field label="Pemilik data">{detail.owner_name ?? 'Tanpa pemilik'}</Field>
                <Field label="Durasi">{formatUptime(detail.acctsessiontime)}</Field>
                <Field label="Mulai">{waktu(detail.acctstarttime)}</Field>
                <Field label="Update terakhir">{waktu(detail.acctupdatetime)}</Field>
                <Field label="Trafik masuk">{formatBytes(detail.acctinputoctets)}</Field>
                <Field label="Trafik keluar">{formatBytes(detail.acctoutputoctets)}</Field>
                <Field label="Session ID">{detail.acctsessionid || '—'}</Field>
                <Field label="Acct-Unique-Id">{detail.acctuniqueid}</Field>
              </div>

              {result && (
                <InfoNote tone={result.ok ? 'info' : 'warn'}>{result.message}</InfoNote>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-3">
                <p className="text-xs text-slate-500">
                  Putus sesi mengirim Disconnect-Request (RADIUS) ke NAS. Sesi baru hilang dari daftar
                  setelah NAS mengirim Accounting-Stop.
                </p>
                {canDisconnect ? (
                  <Button variant="danger" onClick={() => void disconnect()} disabled={busy}>
                    {busy ? 'Mengirim…' : 'Putuskan sesi'}
                  </Button>
                ) : (
                  <Badge tone="mute">Hanya admin/operator</Badge>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const OnlineSessions: React.FC = () => {
  const { user } = useAuth();
  // Pilihan awal dibaca dari URL supaya tautan dari dashboard langsung mendarat
  // di daftar yang benar: /sesi?jenis=ppp atau /sesi?jenis=hotspot&user_type=...
  const [searchParams, setSearchParams] = useSearchParams();
  const [kind, setKind] = useState<Kind>(searchParams.get('jenis') === 'ppp' ? 'ppp' : 'hotspot');
  // Sesi hotspot dipisah: akun voucher (cetak) vs member (pelanggan). Voucher
  // jadi pilihan awal karena itu yang paling sering dipantau operator.
  const [userType, setUserType] = useState<'voucher' | 'member'>(
    searchParams.get('user_type') === 'member' ? 'member' : 'voucher',
  );
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);

  const syncUrl = (nextKind: Kind, nextUserType: 'voucher' | 'member') => {
    const next = new URLSearchParams(searchParams);
    next.set('jenis', nextKind);
    if (nextKind === 'hotspot') next.set('user_type', nextUserType);
    else next.delete('user_type');
    setSearchParams(next, { replace: true });
  };

  // Pencarian ditunda supaya tiap ketikan tidak menjadi request baru.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const path = useMemo(() => {
    const params = new URLSearchParams({ jenis: kind, page: String(page), limit: String(size) });
    // Filter jenis akun hanya bermakna untuk hotspot (voucher vs member).
    if (kind === 'hotspot') params.set('user_type', userType);
    if (query) params.set('search', query);
    return `/api/sessions?${params.toString()}`;
  }, [kind, userType, page, size, query]);

  const { data, loading, refreshing, error, reload } = useNet<SessionList>(path, true, {
    refreshMs: 30000,
  });

  const rows = data?.rows ?? [];
  const canDisconnect = user?.role === 'admin' || user?.role === 'operator';

  return (
    <div>
      <PageHeader
        title="Sesi Online"
        subtitle="Sesi aktif dari accounting RADIUS di semua NAS. Klik baris untuk melihat detail dan memutus sesi."
        actions={
          <Button onClick={reload} disabled={loading || refreshing}>
            {refreshing ? 'Menyegarkan…' : 'Segarkan'}
          </Button>
        }
      />

      <Tabs
        tabs={[
          { key: 'hotspot', label: 'Hotspot' },
          { key: 'ppp', label: 'PPPoE' },
        ]}
        active={kind}
        onChange={(key) => {
          const nextKind = key as Kind;
          setKind(nextKind);
          setPage(1);
          syncUrl(nextKind, userType);
        }}
      />

      {kind === 'hotspot' && (
        <div className="-mt-2">
          <Tabs
            tabs={[
              { key: 'voucher', label: 'Voucher' },
              { key: 'member', label: 'Member' },
            ]}
            active={userType}
            onChange={(key) => {
              const nextType = key as 'voucher' | 'member';
              setUserType(nextType);
              setPage(1);
              syncUrl(kind, nextType);
            }}
          />
        </div>
      )}

      <Toolbar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Cari username, IP, MAC, atau NAS…"
        />
        <span className="text-xs text-slate-500">
          {loading
            ? 'Memuat…'
            : `${data?.total ?? 0} sesi ${KIND_LABEL[kind]}${
                kind === 'hotspot' ? ` · ${userType === 'voucher' ? 'voucher' : 'member'}` : ''
              }`}
        </span>
      </Toolbar>

      {error ? (
        <ErrorNote message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : (
        <Card className="p-0">
          <Table
            columns={['Pengguna', 'Profil', 'IP', 'NAS', 'MAC', 'Mulai', 'Durasi', 'Trafik ↓ / ↑']}
            isEmpty={rows.length === 0}
            empty={`Tidak ada sesi ${KIND_LABEL[kind]} yang aktif.`}
          >
            {rows.map((row) => (
              <tr
                key={row.acctuniqueid}
                onClick={() => setSelected(row.acctuniqueid)}
                className="cursor-pointer hover:bg-slate-700/40"
              >
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-slate-100">{row.username ?? '—'}</span>
                  <p className="text-[11px] text-slate-500">
                    {row.user_type ?? 'tanpa data akun'}
                    {row.stale && <span className="ml-1 text-amber-400">· basi</span>}
                  </p>
                </td>
                <td className="px-3 py-2 text-slate-300">{row.profile_name ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.framedipaddress || '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{row.nas_name ?? row.nasipaddress}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.callingstationid || '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{waktu(row.acctstarttime)}</td>
                <td className="px-3 py-2 text-xs text-slate-300">{formatUptime(row.acctsessiontime)}</td>
                <td className="px-3 py-2 text-xs text-slate-400">
                  {formatBytes(row.acctinputoctets)} / {formatBytes(row.acctoutputoctets)}
                </td>
              </tr>
            ))}
          </Table>
          <TablePager
            page={page}
            size={size}
            total={data?.total ?? 0}
            unit="sesi"
            loading={loading || refreshing}
            onPage={setPage}
            onSize={(next) => {
              setSize(next);
              setPage(1);
            }}
          />
        </Card>
      )}

      {selected && (
        <DetailDialog
          id={selected}
          canDisconnect={canDisconnect}
          onClose={() => setSelected(null)}
          onDisconnected={reload}
        />
      )}
    </div>
  );
};

export default OnlineSessions;
