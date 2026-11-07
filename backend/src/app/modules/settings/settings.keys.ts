// Daftar kunci konfigurasi yang boleh dibaca/ditulis lewat API. Kunci di luar
// daftar ini ditolak: tabel `config` juga menyimpan kredensial MikroTik, jadi
// endpoint tidak boleh menjadi jalan pintas untuk menulis apa saja.
export const SETTING_KEYS = [
  // Branding
  'brand_name',
  'brand_tagline',
  'brand_primary_color',
  'brand_logo_url',
  'brand_footer_text',
  // Template cetak voucher (JSON array; lihat voucher-template.ts)
  'voucher_templates',
  // Pembayaran: manual (tunai/transfer/QRIS) atau payment gateway
  'payment_mode',
  'payment_methods',
  'payment_instructions',
  'payment_gateway_provider',
  'payment_gateway_mode',
  'payment_gateway_merchant_id',
  'payment_gateway_client_key',
  'payment_gateway_server_key',
  // Telegram
  'telegram_enabled',
  'telegram_bot_token',
  'telegram_chat_id',
  // Piutang perpanjangan: batas bawaan per pelanggan (0 = piutang tidak
  // diizinkan) dan umur jatuh tempo maksimum dalam hari.
  'receivable_limit_default',
  'receivable_max_days',
  // Penomoran: angka awal Nomor Internet. Kosong = nomor tidak diterbitkan
  // otomatis (pelanggan baru tetap bisa dibuat tanpa nomor).
  'internet_no_start',
  // Integrasi jaringan (RADIUS)
  'freeradius_host',
  'freeradius_port',
  'freeradius_secret',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  brand_name: 'JAWARA-ISP',
  brand_tagline: 'BibitNet ISP',
  brand_primary_color: '#06b6d4',
  // Logo bawaan ikut repo: frontend/public/branding/jawara-isp.png.
  // Boleh diganti URL lain dari Pengaturan -> Branding.
  brand_logo_url: '/branding/jawara-isp.png',
  brand_footer_text: '',
  // Dikosongkan = pakai template bawaan di voucher-template.ts. Halaman
  // Pengaturan → Template Voucher menulis JSON ini.
  voucher_templates: '',
  payment_mode: 'manual',
  payment_methods: 'cash,transfer,qris',
  payment_instructions: '',
  payment_gateway_provider: '',
  payment_gateway_mode: 'sandbox',
  payment_gateway_merchant_id: '',
  payment_gateway_client_key: '',
  payment_gateway_server_key: '',
  telegram_enabled: '0',
  telegram_bot_token: '',
  telegram_chat_id: '',
  receivable_limit_default: '0',
  receivable_max_days: '30',
  // Kosong = Nomor Internet tidak diterbitkan otomatis. Isi angka awal
  // (mis. 1312013) hanya setelah pemilik menetapkan seri penomoran.
  internet_no_start: '',
  freeradius_host: '127.0.0.1',
  freeradius_port: '1812',
  freeradius_secret: '',
};

// Nilai rahasia tidak pernah dikirim balik ke browser. Placeholder ini
// diabaikan saat menyimpan, sehingga form yang tidak diubah tidak menimpa
// token yang sudah tersimpan dengan tanda bintang.
export const SECRET_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'payment_gateway_server_key',
  'telegram_bot_token',
  // Secret RADIUS tidak pernah dikirim balik ke browser.
  'freeradius_secret',
]);

export const SECRET_MASK = '********';

export const MAX_VALUE_LENGTH = 20000;

export const SETTING_GROUPS: Record<string, SettingKey[]> = {
  branding: ['brand_name', 'brand_tagline', 'brand_primary_color', 'brand_logo_url', 'brand_footer_text'],
  voucher: ['voucher_templates'],
  pelanggan: ['internet_no_start'],
  piutang: ['receivable_limit_default', 'receivable_max_days'],
  payment: [
    'payment_mode',
    'payment_methods',
    'payment_instructions',
    'payment_gateway_provider',
    'payment_gateway_mode',
    'payment_gateway_merchant_id',
    'payment_gateway_client_key',
    'payment_gateway_server_key',
  ],
  telegram: ['telegram_enabled', 'telegram_bot_token', 'telegram_chat_id'],
  integrasi: [
    'freeradius_host',
    'freeradius_port',
    'freeradius_secret',
  ],
};
