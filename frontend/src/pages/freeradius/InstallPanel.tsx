import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, Button, Card, InfoNote, errorMessage } from '../../components/net/NetUI';

// Panel pemasangan FreeRADIUS.
//
// Alur: cek status -> tombol "Pasang" -> konfirmasi -> POST -> polling log.
// Log ditampilkan apa adanya dari server (stdout+stderr skrip pemasang),
// sehingga pengguna bisa melihat setiap langkah yang dijalankan sebagai root.

interface Probe {
  binary: boolean;
  version: string | null;
  unit_present: boolean;
  service_active: boolean;
  config_dirs: string[];
  sql_module: boolean;
  installed: boolean;
}

interface InstallState {
  running: boolean;
  finished: boolean;
  ok: boolean | null;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  helper_installed: boolean;
  log_file: string;
  probe: Probe;
}

interface LogLine {
  index: number;
  text: string;
}

interface LogPage {
  lines: LogLine[];
  offset: number;
  running: boolean;
  finished: boolean;
  ok: boolean | null;
  exit_code: number | null;
}

const POLL_MS = 1200;
// Log asli bisa ribuan baris (apt verbose). Server menyimpan semuanya di file,
// UI hanya merender ekor terakhir agar tetap ringan.
const RENDER_TAIL = 400;

const InstallPanel: React.FC<{ onFinished?: () => void }> = ({ onFinished }) => {
  const { user } = useAuth();
  const [state, setState] = useState<InstallState | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [offset, setOffset] = useState(0);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  const isAdmin = user?.role === 'admin';

  const loadState = useCallback(async () => {
    try {
      const { data } = await api.get<InstallState>('/api/freeradius/install');
      setState(data);
      setRunning(data.running);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  // Log diambil ulang dari server saat panel dipasang, supaya riwayat tidak
  // hilang ketika halaman dimuat ulang atau panel sempat unmount.
  const loadLog = useCallback(async () => {
    try {
      const { data } = await api.get<LogPage>('/api/freeradius/install/log', {
        params: { offset: 0 },
      });
      if (data.lines.length === 0) return;
      setLines(data.lines.slice(-RENDER_TAIL));
      setOffset(data.offset);
    } catch {
      // Riwayat log bersifat tambahan; kegagalan di sini tidak memblokir panel.
    }
  }, []);

  useEffect(() => {
    void loadState();
    void loadLog();
  }, [loadState, loadLog]);

  // Polling log berbasis offset: hanya baris baru yang diambil.
  useEffect(() => {
    if (!running) return;
    let alive = true;
    let cursor = offset;

    const tick = async () => {
      try {
        const { data } = await api.get<LogPage>('/api/freeradius/install/log', {
          params: { offset: cursor },
        });
        if (!alive) return;
        if (data.lines.length > 0) {
          cursor = data.offset;
          setOffset(data.offset);
          setLines((prev) => [...prev, ...data.lines].slice(-RENDER_TAIL));
        }
        if (!data.running) {
          setRunning(false);
          await loadState();
          onFinished?.();
        }
      } catch (err) {
        if (!alive) return;
        setError(errorMessage(err));
        setRunning(false);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // offset sengaja tidak masuk dependency: nilai awalnya cukup sekali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, loadState, onFinished]);

  // Auto-scroll ke bawah kecuali pengguna sedang membaca ke atas.
  useEffect(() => {
    const el = consoleRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const startInstall = async () => {
    setConfirmOpen(false);
    setError(null);
    setLines([]);
    setOffset(0);
    try {
      await api.post('/api/freeradius/install');
      setRunning(true);
    } catch (err) {
      setError(errorMessage(err));
      await loadState();
    }
  };

  if (loadError) {
    return (
      <InfoNote tone="warn">
        Status pemasangan tidak bisa dibaca: {loadError}
        {'\n'}Pengguna yang bisa memasang hanya admin.
      </InfoNote>
    );
  }

  if (!state) return null;

  const probe = state.probe;
  const notInstalled = !probe.installed;
  const finishedOk = state.finished && state.ok === true;
  const finishedFail = state.finished && state.ok === false;

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Server RADIUS</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {probe.installed ? (
              <Badge tone="good">terpasang</Badge>
            ) : (
              <Badge tone="bad">belum terpasang</Badge>
            )}
            {probe.installed && (
              <Badge tone={probe.service_active ? 'good' : 'warn'}>
                service {probe.service_active ? 'berjalan' : 'berhenti'}
              </Badge>
            )}
            {probe.version && <span className="text-xs text-slate-400">v{probe.version}</span>}
            {probe.installed && (
              <Badge tone={probe.sql_module ? 'good' : 'bad'}>
                modul SQL {probe.sql_module ? 'ada' : 'tidak ada'}
              </Badge>
            )}
          </div>
        </div>

        {isAdmin && notInstalled && (
          <Button onClick={() => setConfirmOpen(true)} disabled={running || !state.helper_installed}>
            {running ? 'Memasang…' : 'Pasang FreeRADIUS'}
          </Button>
        )}
        {isAdmin && running && <Badge tone="warn">sedang memasang</Badge>}
      </div>

      {notInstalled && !state.helper_installed && (
        <div className="mt-3">
          <InfoNote tone="warn">
            Helper pemasang belum dipasang di server, jadi tombol ini tidak bisa dipakai.
            {'\n'}Jalankan sekali dari terminal server (bukan dari panel):
            {'\n'}sudo bash deploy/setup-helper.sh
            {'\n\n'}Helper itu hanya berisi satu file tetap, tidak menerima argumen, dan
            sudo hanya diizinkan untuk file tersebut.
          </InfoNote>
        </div>
      )}

      {notInstalled && state.helper_installed && !running && (
        <p className="mt-3 text-xs text-slate-400">
          Paket <span className="font-mono">freeradius</span>,{' '}
          <span className="font-mono">freeradius-mysql</span>, dan{' '}
          <span className="font-mono">freeradius-utils</span> belum ada. Pemasangan berjalan
          sebagai root dengan perintah tetap; log lengkapnya tampil di bawah.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {(lines.length > 0 || running) && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-400">Log pemasangan</p>
            <span className="text-[11px] text-slate-500 font-mono">{state.log_file}</span>
          </div>
          <div
            ref={consoleRef}
            data-testid="install-log"
            className="h-72 overflow-auto rounded-lg border border-slate-700 bg-black/80 p-3 font-mono text-[11px] leading-relaxed text-slate-200"
          >
            {lines.map((line) => (
              <div
                key={line.index}
                className={
                  line.text.startsWith('[panel]')
                    ? 'text-cyan-300'
                    : /GAGAL|error|E:/i.test(line.text)
                      ? 'text-rose-300'
                      : line.text.includes('=== ')
                        ? 'text-amber-300'
                        : undefined
                }
              >
                {line.text}
              </div>
            ))}
            {running && <div className="text-slate-500">▌</div>}
          </div>
          {finishedOk && (
            <p className="mt-2 text-xs text-emerald-300">
              Selesai. FreeRADIUS terpasang, tetapi belum berjalan dan belum dikonfigurasi.
            </p>
          )}
          {finishedFail && (
            <p className="mt-2 text-xs text-rose-300">
              Pemasangan gagal (kode {state.exit_code}). Tidak ada data panel, MariaDB, atau
              MikroTik yang diubah.
            </p>
          )}
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
        >
          <div className="w-full max-w-lg rounded-t-2xl border border-slate-700 bg-slate-900 p-5 sm:rounded-2xl">
            <h3 className="text-base font-semibold text-slate-100">Pasang FreeRADIUS?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Panel akan menjalankan sebagai root, tanpa input tambahan:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/70 p-3 font-mono text-[11px] text-slate-300">
              {`apt-get update
apt-get install -y --no-install-recommends \\
  freeradius freeradius-mysql freeradius-utils
systemctl stop freeradius`}
            </pre>
            <p className="mt-2 text-xs text-slate-400">
              Tidak menyentuh MariaDB, data panel, MikroTik, tunnel, maupun n8n. Log lengkap
              ditampilkan setelah Anda menekan Pasang.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirmOpen(false)}>Batal</Button>
              <Button onClick={() => void startInstall()} data-testid="confirm-install">
                Pasang
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

export default InstallPanel;
