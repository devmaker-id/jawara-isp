import { readdirSync, statfsSync } from 'node:fs';
import os from 'node:os';

// Metrik host tempat backend berjalan (bit78), dibaca langsung dari modul `os`
// dan /proc — cukup untuk tile dashboard, tanpa agent tambahan.

export interface ServerMetrics {
  uptime_seconds: number;
  cpu_count: number;
  cpu_percent: number | null;
  processes: number;
  mem_total: number;
  mem_used: number;
  disk_total: number;
  disk_used: number;
}

const cpuSnapshot = () => {
  let idle = 0;
  let total = 0;
  for (const core of os.cpus()) {
    const times = core.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Persentase CPU hanya bermakna sebagai selisih dua sampel, bukan angka sesaat.
async function cpuPercent(windowMs = 200): Promise<number | null> {
  const before = cpuSnapshot();
  await sleep(windowMs);
  const after = cpuSnapshot();
  const total = after.total - before.total;
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((1 - (after.idle - before.idle) / total) * 100)));
}

function processCount(): number {
  try {
    return readdirSync('/proc').filter((name) => /^\d+$/.test(name)).length;
  } catch {
    return 0;
  }
}

function diskUsage(): { total: number; used: number } {
  try {
    const stat = statfsSync('/');
    const total = stat.blocks * stat.bsize;
    // bfree, bukan bavail: angka ini yang ditampilkan `df` sebagai Used
    // (bavail mengeluarkan blok cadangan root sehingga terlihat lebih kecil).
    return { total, used: (stat.blocks - stat.bfree) * stat.bsize };
  } catch {
    return { total: 0, used: 0 };
  }
}

export async function readServerMetrics(): Promise<ServerMetrics> {
  const memTotal = os.totalmem();
  const disk = diskUsage();
  return {
    uptime_seconds: Math.round(os.uptime()),
    cpu_count: os.cpus().length,
    cpu_percent: await cpuPercent(),
    processes: processCount(),
    mem_total: memTotal,
    mem_used: memTotal - os.freemem(),
    disk_total: disk.total,
    disk_used: disk.used,
  };
}
