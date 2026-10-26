import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { Badge, Button, errorMessage } from '../../components/net/NetUI';

// Panel traffic realtime satu interface.
//
// Data berasal dari /api/mikrotik/interfaces/:name/traffic yang memanggil
// `/interface/monitor-traffic =once=` di RouterOS. Polling dipilih (bukan
// streaming) supaya tidak ada koneksi API yang menggantung bila tab ditutup.

export interface TrafficSample {
  name: string;
  rx_bps: number;
  tx_bps: number;
  rx_pps: number;
  tx_pps: number;
  running: boolean | null;
  disabled: boolean;
  rx_bytes: number;
  tx_bytes: number;
  sampled_at: string;
}

const POLL_MS = 1000;
const HISTORY = 60; // 60 detik terakhir

// Bit per detik → teks yang mudah dibaca (memakai basis 1000 seperti RouterOS).
export const formatBitrate = (bps: number | null | undefined): string => {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '-';
  const value = Math.max(0, Number(bps));
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbps`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Kbps`;
  return `${Math.round(value)} bps`;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  return `${(bytes / 1000 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const Sparkline: React.FC<{ values: number[]; color: string; label: string }> = ({
  values,
  color,
  label,
}) => {
  const width = 260;
  const height = 48;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full" role="img" aria-label={label}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

interface Props {
  name: string;
  deviceQuery: string;
  onClose: () => void;
}

const TrafficPanel: React.FC<Props> = ({ name, deviceQuery, onClose }) => {
  const [sample, setSample] = useState<TrafficSample | null>(null);
  const [rxHistory, setRxHistory] = useState<number[]>([]);
  const [txHistory, setTxHistory] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [peak, setPeak] = useState({ rx: 0, tx: 0 });
  const [transferred, setTransferred] = useState({ rx: 0, tx: 0 });
  const [lastOk, setLastOk] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const fetchOnce = useCallback(async () => {
    const { data } = await api.get<TrafficSample>(
      `/api/mikrotik/interfaces/${encodeURIComponent(name)}/traffic${deviceQuery}`,
    );
    return data;
  }, [name, deviceQuery]);

  // Polling berhenti otomatis saat panel ditutup atau di-pause.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      if (!alive || pausedRef.current) {
        timer = window.setTimeout(tick, POLL_MS);
        return;
      }
      try {
        const data = await fetchOnce();
        if (!alive) return;
        setSample(data);
        setError(null);
        setLastOk(new Date().toLocaleTimeString('id-ID'));
        setRxHistory((prev) => [...prev, data.rx_bps].slice(-HISTORY));
        setTxHistory((prev) => [...prev, data.tx_bps].slice(-HISTORY));
        setPeak((prev) => ({
          rx: Math.max(prev.rx, data.rx_bps),
          tx: Math.max(prev.tx, data.tx_bps),
        }));
        // Akumulasi data selama pemantauan: bit/detik × 1 detik ÷ 8 = byte.
        setTransferred((prev) => ({
          rx: prev.rx + data.rx_bps / 8,
          tx: prev.tx + data.tx_bps / 8,
        }));
      } catch (err) {
        if (!alive) return;
        setError(errorMessage(err));
      }
      timer = window.setTimeout(tick, POLL_MS);
    };

    void tick();

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [fetchOnce]);

  // Esc menutup panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const average = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Traffic ${name}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
    >
      <div className="w-full max-w-2xl rounded-t-2xl border border-slate-700 bg-slate-900 p-5 sm:rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Traffic realtime</p>
            <h3 className="font-mono text-lg text-slate-100">{name}</h3>
          </div>
          <div className="flex items-center gap-2">
            {sample && (
              <Badge tone={sample.disabled ? 'bad' : sample.running ? 'good' : 'warn'}>
                {sample.disabled ? 'nonaktif' : sample.running ? 'link up' : 'no link'}
              </Badge>
            )}
            <Button onClick={() => setPaused((value) => !value)}>
              {paused ? 'Lanjutkan' : 'Pause'}
            </Button>
            <Button variant="danger" onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}

        {!sample && !error && (
          <p className="mt-4 text-sm text-slate-400">Mengambil sampel pertama…</p>
        )}

        {sample && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3">
                <p className="text-xs text-cyan-300">↓ Download (rx)</p>
                <p className="mt-1 font-mono text-xl text-slate-100">{formatBitrate(sample.rx_bps)}</p>
                <p className="text-[11px] text-slate-400">{sample.rx_pps} paket/detik</p>
                <Sparkline values={rxHistory} color="#22d3ee" label="Grafik download" />
                <p className="text-[11px] text-slate-500">
                  puncak {formatBitrate(peak.rx)} · rata² {formatBitrate(average(rxHistory))}
                </p>
                <p className="text-[11px] text-slate-500">
                  terkirim selama pantau {formatBytes(transferred.rx)}
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-300">↑ Upload (tx)</p>
                <p className="mt-1 font-mono text-xl text-slate-100">{formatBitrate(sample.tx_bps)}</p>
                <p className="text-[11px] text-slate-400">{sample.tx_pps} paket/detik</p>
                <Sparkline values={txHistory} color="#fbbf24" label="Grafik upload" />
                <p className="text-[11px] text-slate-500">
                  puncak {formatBitrate(peak.tx)} · rata² {formatBitrate(average(txHistory))}
                </p>
                <p className="text-[11px] text-slate-500">
                  terkirim selama pantau {formatBytes(transferred.tx)}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
              <p>
                Counter kumulatif interface: ↓ {formatBytes(sample.rx_bytes)} · ↑{' '}
                {formatBytes(sample.tx_bytes)}
              </p>
              <p className="sm:text-right">
                {paused ? 'dijeda' : 'memantau tiap 1 detik'}
                {lastOk ? ` · sampel terakhir ${lastOk}` : ''}
              </p>
            </div>
          </>
        )}

        <p className="mt-3 text-[11px] text-slate-500">
          Angka dari /interface/monitor-traffic (bit per detik). Kunjungan ini hanya membaca; tidak ada
          konfigurasi router yang diubah.
        </p>
      </div>
    </div>
  );
};

export default TrafficPanel;
