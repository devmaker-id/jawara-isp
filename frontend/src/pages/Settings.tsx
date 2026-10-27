import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type TabKey = 'branding' | 'payment' | 'telegram' | 'whatsapp' | 'integrasi' | 'sistem';
type Toast = { type: 'success' | 'error'; text: string } | null;

interface SettingsView {
  groups: Record<string, string[]>;
  values: Record<string, string>;
  secrets_set: Record<string, boolean>;
}

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'branding', label: 'Branding', hint: 'Nama, logo, dan warna panel' },
  { key: 'payment', label: 'Pembayaran', hint: 'Manual (tunai/transfer/QRIS) atau payment gateway' },
  { key: 'telegram', label: 'Telegram', hint: 'Bot notifikasi tagihan' },
  { key: 'whatsapp', label: 'WhatsApp Bot', hint: 'Gateway pesan WhatsApp' },
  { key: 'integrasi', label: 'Integrasi', hint: 'MikroTik (RouterOS API) & FreeRADIUS' },
  { key: 'sistem', label: 'Sistem', hint: 'Informasi koneksi & keamanan' },
];

const GATEWAY_PROVIDERS = [
  { value: '', label: 'Belum dipilih' },
  { value: 'midtrans', label: 'Midtrans' },
  { value: 'xendit', label: 'Xendit' },
  { value: 'tripay', label: 'Tripay' },
  { value: 'doku', label: 'DOKU' },
];

const WHATSAPP_PROVIDERS = [
  { value: '', label: 'Belum dipilih' },
  { value: 'wablas', label: 'Wablas' },
  { value: 'fonnte', label: 'Fonnte' },
  { value: 'baileys', label: 'Baileys (WhatsApp Web)' },
];

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Tunai' },
  { key: 'transfer', label: 'Transfer bank' },
  { key: 'qris', label: 'QRIS' },
];

const inputClass =
  'w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100 disabled:opacity-60';

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const TextField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  mono?: boolean;
}> = ({ id, label, value, onChange, hint, placeholder, type = 'text', disabled, mono }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} ${mono ? 'font-mono text-sm' : ''}`}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
    />
    {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
  </div>
);

const Toggle: React.FC<{
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}> = ({ id, label, checked, onChange, hint, disabled }) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <p className="text-sm font-medium text-slate-300">{label}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${
        checked ? 'bg-cyan-500' : 'bg-slate-600'
      }`}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  </div>
);

const Card: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
    </div>
    {children}
  </section>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 text-sm">
    <span className="text-slate-300">{label}</span>
    <span className="text-slate-400 font-mono">{value}</span>
  </div>
);

const Settings: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'branding') as TabKey;

  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [secretsSet, setSecretsSet] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const apply = useCallback((data: SettingsView) => {
    setGroups(data.groups ?? {});
    setValues(data.values ?? {});
    setSecretsSet(data.secrets_set ?? {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/api/settings');
      apply(res.data);
    } catch (error) {
      setLoadError(readError(error, 'Gagal memuat pengaturan.'));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const methods = useMemo(
    () =>
      (values.payment_methods ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    [values.payment_methods],
  );

  const toggleMethod = (key: string, checked: boolean) => {
    const next = checked ? [...new Set([...methods, key])] : methods.filter((m) => m !== key);
    set('payment_methods', next.join(','));
  };

  const save = async () => {
    if (saving || !isAdmin) return;
    const keys = groups[tab] ?? [];
    if (keys.length === 0) return;

    const payload: Record<string, string> = {};
    for (const key of keys) payload[key] = values[key] ?? '';

    setSaving(true);
    try {
      const res = await api.put('/api/settings', { values: payload });
      apply(res.data);
      setToast({ type: 'success', text: 'Pengaturan tersimpan.' });
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menyimpan pengaturan.') });
    } finally {
      setSaving(false);
    }
  };

  const secretHint = (key: string): string =>
    secretsSet[key] ? 'Sudah tersimpan. Kosongkan bila tidak diubah.' : 'Belum diisi.';

  const renderBranding = () => (
    <Card title="Branding" description="Identitas yang tampil di panel dan pesan ke pelanggan.">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="brand_name"
          label="Nama brand"
          value={values.brand_name ?? ''}
          onChange={(v) => set('brand_name', v)}
          disabled={!isAdmin}
          placeholder="JAWARA-ISP"
        />
        <TextField
          id="brand_tagline"
          label="Tagline"
          value={values.brand_tagline ?? ''}
          onChange={(v) => set('brand_tagline', v)}
          disabled={!isAdmin}
          placeholder="BibitNet ISP"
        />
        <TextField
          id="brand_logo_url"
          label="URL logo"
          value={values.brand_logo_url ?? ''}
          onChange={(v) => set('brand_logo_url', v)}
          disabled={!isAdmin}
          placeholder="/branding/logo-default.png"
          mono
        />
        <div>
          <label
            className="block text-sm font-medium text-slate-300 mb-1"
            htmlFor="brand_primary_color"
          >
            Warna utama
          </label>
          <div className="flex items-center gap-3">
            <input
              id="brand_primary_color"
              type="color"
              value={values.brand_primary_color || '#06b6d4'}
              onChange={(e) => set('brand_primary_color', e.target.value)}
              disabled={!isAdmin}
              className="h-10 w-14 rounded-lg bg-slate-700/50 border border-slate-600 disabled:opacity-60"
            />
            <input
              aria-label="Kode warna utama"
              value={values.brand_primary_color ?? ''}
              onChange={(e) => set('brand_primary_color', e.target.value)}
              disabled={!isAdmin}
              className={`${inputClass} font-mono text-sm`}
              placeholder="#06b6d4"
            />
          </div>
        </div>
      </div>
      <TextField
        id="brand_footer_text"
        label="Teks footer"
        value={values.brand_footer_text ?? ''}
        onChange={(v) => set('brand_footer_text', v)}
        disabled={!isAdmin}
        hint="Tampil di bagian bawah halaman atau cetakan tagihan."
        placeholder="© 2026 BibitNet"
      />

      <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
        <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Pratinjau</p>
        <div className="flex items-center gap-3">
          {values.brand_logo_url ? (
            <img
              src={values.brand_logo_url}
              alt=""
              className="w-10 h-10 rounded-lg object-contain bg-slate-800"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: values.brand_primary_color || '#06b6d4' }}
            >
              {(values.brand_name || 'B').charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-white">{values.brand_name || 'Nama brand'}</p>
            <p className="text-xs text-slate-400">{values.brand_tagline || 'Tagline'}</p>
          </div>
        </div>
        {values.brand_footer_text && (
          <p className="text-xs text-slate-500 mt-3">{values.brand_footer_text}</p>
        )}
      </div>
    </Card>
  );

  const renderPayment = () => {
    const gateway = values.payment_mode === 'gateway';
    return (
      <Card
        title="Pembayaran"
        description="Pembayaran manual dicatat operator; payment gateway menagih otomatis lewat penyedia."
      >
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="payment_mode">
            Mode pembayaran
          </label>
          <select
            id="payment_mode"
            value={values.payment_mode ?? 'manual'}
            onChange={(e) => set('payment_mode', e.target.value)}
            disabled={!isAdmin}
            className={inputClass}
          >
            <option value="manual">Manual (tunai / transfer / QRIS)</option>
            <option value="gateway">Payment gateway</option>
          </select>
        </div>

        {!gateway && (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300">Metode manual yang diterima</p>
              {PAYMENT_METHODS.map((method) => (
                <label key={method.key} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={methods.includes(method.key)}
                    onChange={(e) => toggleMethod(method.key, e.target.checked)}
                    disabled={!isAdmin}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-700/50"
                  />
                  {method.label}
                </label>
              ))}
            </div>
            <div>
              <label
                className="block text-sm font-medium text-slate-300 mb-1"
                htmlFor="payment_instructions"
              >
                Instruksi pembayaran
              </label>
              <textarea
                id="payment_instructions"
                value={values.payment_instructions ?? ''}
                onChange={(e) => set('payment_instructions', e.target.value)}
                disabled={!isAdmin}
                rows={3}
                className={inputClass}
                placeholder="Transfer ke BCA 1234567890 a.n. BibitNet"
              />
            </div>
          </>
        )}

        {gateway && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-slate-300 mb-1"
                htmlFor="payment_gateway_provider"
              >
                Penyedia
              </label>
              <select
                id="payment_gateway_provider"
                value={values.payment_gateway_provider ?? ''}
                onChange={(e) => set('payment_gateway_provider', e.target.value)}
                disabled={!isAdmin}
                className={inputClass}
              >
                {GATEWAY_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-sm font-medium text-slate-300 mb-1"
                htmlFor="payment_gateway_mode"
              >
                Lingkungan
              </label>
              <select
                id="payment_gateway_mode"
                value={values.payment_gateway_mode ?? 'sandbox'}
                onChange={(e) => set('payment_gateway_mode', e.target.value)}
                disabled={!isAdmin}
                className={inputClass}
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>
            <TextField
              id="payment_gateway_merchant_id"
              label="Merchant ID"
              value={values.payment_gateway_merchant_id ?? ''}
              onChange={(v) => set('payment_gateway_merchant_id', v)}
              disabled={!isAdmin}
              mono
            />
            <TextField
              id="payment_gateway_client_key"
              label="Client key"
              value={values.payment_gateway_client_key ?? ''}
              onChange={(v) => set('payment_gateway_client_key', v)}
              disabled={!isAdmin}
              mono
            />
            <TextField
              id="payment_gateway_server_key"
              label="Server key / secret"
              type="password"
              value={values.payment_gateway_server_key ?? ''}
              onChange={(v) => set('payment_gateway_server_key', v)}
              disabled={!isAdmin}
              hint={secretHint('payment_gateway_server_key')}
              placeholder="Tidak ditampilkan"
              mono
            />
          </div>
        )}

        <p className="text-xs text-slate-500">
          Konfigurasi tersimpan sebagai pengaturan panel. Penagihan otomatis lewat gateway belum
          termasuk di halaman ini.
        </p>
      </Card>
    );
  };

  const renderTelegram = () => (
    <Card
      title="Telegram"
      description="Bot dipakai untuk notifikasi tagihan dan perintah admin."
    >
      <Toggle
        id="telegram_enabled"
        label="Aktifkan bot Telegram"
        checked={values.telegram_enabled === '1'}
        onChange={(checked) => set('telegram_enabled', checked ? '1' : '0')}
        disabled={!isAdmin}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="telegram_bot_token"
          label="Bot token"
          type="password"
          value={values.telegram_bot_token ?? ''}
          onChange={(v) => set('telegram_bot_token', v)}
          disabled={!isAdmin}
          hint={secretHint('telegram_bot_token')}
          placeholder="123456:ABC-DEF…"
          mono
        />
        <TextField
          id="telegram_chat_id"
          label="Chat / grup ID"
          value={values.telegram_chat_id ?? ''}
          onChange={(v) => set('telegram_chat_id', v)}
          disabled={!isAdmin}
          hint="ID grup admin penerima notifikasi."
          placeholder="-1001234567890"
          mono
        />
      </div>
      <p className="text-xs text-slate-500">
        Token dibuat lewat @BotFather. Tombol uji kirim belum tersedia di halaman ini.
      </p>
    </Card>
  );

  const renderWhatsapp = () => (
    <Card
      title="WhatsApp Bot"
      description="Gateway pengiriman pesan tagihan dan pengingat ke pelanggan."
    >
      <Toggle
        id="whatsapp_enabled"
        label="Aktifkan WhatsApp bot"
        checked={values.whatsapp_enabled === '1'}
        onChange={(checked) => set('whatsapp_enabled', checked ? '1' : '0')}
        disabled={!isAdmin}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            className="block text-sm font-medium text-slate-300 mb-1"
            htmlFor="whatsapp_provider"
          >
            Penyedia
          </label>
          <select
            id="whatsapp_provider"
            value={values.whatsapp_provider ?? ''}
            onChange={(e) => set('whatsapp_provider', e.target.value)}
            disabled={!isAdmin}
            className={inputClass}
          >
            {WHATSAPP_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <TextField
          id="whatsapp_sender"
          label="Nomor pengirim"
          value={values.whatsapp_sender ?? ''}
          onChange={(v) => set('whatsapp_sender', v)}
          disabled={!isAdmin}
          placeholder="6281234567890"
          mono
        />
        <TextField
          id="whatsapp_api_url"
          label="Base URL API"
          value={values.whatsapp_api_url ?? ''}
          onChange={(v) => set('whatsapp_api_url', v)}
          disabled={!isAdmin}
          placeholder="https://api.fonnte.com"
          mono
        />
        <TextField
          id="whatsapp_api_token"
          label="API token"
          type="password"
          value={values.whatsapp_api_token ?? ''}
          onChange={(v) => set('whatsapp_api_token', v)}
          disabled={!isAdmin}
          hint={secretHint('whatsapp_api_token')}
          placeholder="Tidak ditampilkan"
          mono
        />
      </div>
      <p className="text-xs text-slate-500">
        Koneksi ke penyedia belum diuji dari halaman ini; pengiriman pesan menyusul.
      </p>
    </Card>
  );

  const renderSistem = () => (
    <div className="space-y-4">
      <Card title="Integrasi Database" description="Nilai dari konfigurasi server (baca saja).">
        <InfoRow label="Host Database" value="127.0.0.1:3306" />
        <InfoRow label="Nama Database" value="isp_billing" />
        <InfoRow label="User Database" value="isp_billing" />
      </Card>
      <Card title="Integrasi Jaringan" description="Endpoint layanan pendukung (baca saja).">
        <InfoRow label="FreeRADIUS" value="127.0.0.1:1812" />
        <InfoRow label="MikroTik API" value="192.168.100.254:1998" />
        <InfoRow label="Web Panel" value=":793" />
      </Card>
      <Card title="Keamanan">
        <InfoRow label="Login Ganda (2FA)" value="Belum tersedia" />
        <InfoRow label="Audit Log" value="Aktif" />
        <InfoRow label="Enkripsi Kode" value="Enabled" />
      </Card>
    </div>
  );

  const renderIntegrasi = () => (
    <div className="space-y-4">
      <Card
        title="MikroTik — RouterOS API"
        description="Panel terhubung langsung ke API RouterOS (TCP, bukan WebSocket) untuk membaca interface, hotspot, PPP, dan routing."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="mikrotik_host"
            label="Host / IP"
            value={values.mikrotik_host ?? ''}
            onChange={(v) => set('mikrotik_host', v)}
            disabled={!isAdmin}
            placeholder="192.168.100.254"
            mono
          />
          <TextField
            id="mikrotik_port"
            label="Port API"
            value={values.mikrotik_port ?? ''}
            onChange={(v) => set('mikrotik_port', v)}
            disabled={!isAdmin}
            hint="Standar 8728, perangkat BibitNet memakai 1998."
            placeholder="1998"
            mono
          />
          <TextField
            id="mikrotik_user"
            label="User API"
            value={values.mikrotik_user ?? ''}
            onChange={(v) => set('mikrotik_user', v)}
            disabled={!isAdmin}
            placeholder="hermes"
            mono
          />
          <TextField
            id="mikrotik_password"
            label="Password API"
            type="password"
            value={values.mikrotik_password ?? ''}
            onChange={(v) => set('mikrotik_password', v)}
            disabled={!isAdmin}
            hint={secretHint('mikrotik_password')}
            mono
          />
          <TextField
            id="mikrotik_gui_url"
            label="URL WebFig"
            value={values.mikrotik_gui_url ?? ''}
            onChange={(v) => set('mikrotik_gui_url', v)}
            disabled={!isAdmin}
            hint="Tombol 'Buka WebFig' di halaman MikroTik mengarah ke sini."
            placeholder="http://192.168.100.254"
          />
        </div>
        <Toggle
          id="mikrotik_write_enabled"
          label="Izinkan mode tulis ke perangkat"
          checked={values.mikrotik_write_enabled === '1'}
          onChange={(checked) => set('mikrotik_write_enabled', checked ? '1' : '0')}
          disabled={!isAdmin}
          hint="Bila mati, semua perubahan hotspot/PPP/interface ditolak backend (403). Biarkan mati sampai Anda yakin."
        />
        <p className="text-xs text-slate-500">
          User API sebaiknya dibuat khusus dengan policy read, write, api, dan reboot. Jangan memakai user admin
          WebFig dengan password yang sama.
        </p>
      </Card>

      <Card
        title="FreeRADIUS"
        description="Alamat server RADIUS dan secret NAS. Skema tabel rad* tetap harus dibuat lewat migrasi dan paket FreeRADIUS dipasang di server."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="freeradius_host"
            label="Host server RADIUS"
            value={values.freeradius_host ?? ''}
            onChange={(v) => set('freeradius_host', v)}
            disabled={!isAdmin}
            hint="IP yang dipakai MikroTik pada menu /radius."
            placeholder="127.0.0.1"
            mono
          />
          <TextField
            id="freeradius_port"
            label="Port autentikasi"
            value={values.freeradius_port ?? ''}
            onChange={(v) => set('freeradius_port', v)}
            disabled={!isAdmin}
            hint="Default 1812 (auth), akuntansi 1813."
            placeholder="1812"
            mono
          />
          <TextField
            id="freeradius_secret"
            label="Secret NAS bersama"
            type="password"
            value={values.freeradius_secret ?? ''}
            onChange={(v) => set('freeradius_secret', v)}
            disabled={!isAdmin}
            hint={secretHint('freeradius_secret')}
            mono
          />
        </div>
        <p className="text-xs text-slate-500">
          Status kesiapan (tabel radcheck/radacct/nas) bisa dilihat di menu FreeRADIUS → Ringkasan.
        </p>
      </Card>
    </div>
  );

  const content = () => {
    switch (tab) {
      case 'payment':
        return renderPayment();
      case 'telegram':
        return renderTelegram();
      case 'whatsapp':
        return renderWhatsapp();
      case 'integrasi':
        return renderIntegrasi();
      case 'sistem':
        return renderSistem();
      default:
        return renderBranding();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Pengaturan</h1>
        <p className="text-slate-400 text-sm mt-1">
          Branding, pembayaran, dan integrasi notifikasi
        </p>
      </div>

      {toast && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Hanya admin yang dapat mengubah pengaturan. Nilai di halaman ini hanya dapat dilihat.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <nav
          aria-label="Submenu pengaturan"
          className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
        >
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setParams({ tab: item.key })}
              aria-current={tab === item.key ? 'page' : undefined}
              className={`shrink-0 text-left px-3 py-2 rounded-lg text-sm transition ${
                tab === item.key
                  ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 border border-transparent hover:bg-slate-700/40 hover:text-slate-200'
              }`}
            >
              <span className="block font-medium">{item.label}</span>
              <span className="hidden lg:block text-xs text-slate-500">{item.hint}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl bg-slate-800/50 border border-slate-700/50 animate-pulse"
                />
              ))}
            </div>
          ) : loadError ? (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center space-y-3">
              <p className="text-sm text-red-400">{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
              >
                Coba lagi
              </button>
            </div>
          ) : (
            <>
              {content()}
              {tab !== 'sistem' && isAdmin && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
                  >
                    {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
