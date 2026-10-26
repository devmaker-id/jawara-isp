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
  // WhatsApp bot
  'whatsapp_enabled',
  'whatsapp_provider',
  'whatsapp_api_url',
  'whatsapp_api_token',
  'whatsapp_sender',
  // Integrasi perangkat jaringan
  'mikrotik_host',
  'mikrotik_port',
  'mikrotik_user',
  'mikrotik_password',
  'mikrotik_gui_url',
  'mikrotik_write_enabled',
  'freeradius_host',
  'freeradius_port',
  'freeradius_secret',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  brand_name: 'BibitNet',
  brand_tagline: 'Internet Cepat & Stabil',
  brand_primary_color: '#06b6d4',
  brand_logo_url: '',
  brand_footer_text: '',
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
  whatsapp_enabled: '0',
  whatsapp_provider: '',
  whatsapp_api_url: '',
  whatsapp_api_token: '',
  whatsapp_sender: '',
  mikrotik_host: '',
  mikrotik_port: '1998',
  mikrotik_user: '',
  mikrotik_password: '',
  mikrotik_gui_url: '',
  mikrotik_write_enabled: '0',
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
  'whatsapp_api_token',
  // Password API router dan secret RADIUS tidak pernah dikirim balik ke browser.
  'mikrotik_password',
  'freeradius_secret',
]);

export const SECRET_MASK = '********';

export const MAX_VALUE_LENGTH = 1000;

export const SETTING_GROUPS: Record<string, SettingKey[]> = {
  branding: ['brand_name', 'brand_tagline', 'brand_primary_color', 'brand_logo_url', 'brand_footer_text'],
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
  whatsapp: [
    'whatsapp_enabled',
    'whatsapp_provider',
    'whatsapp_api_url',
    'whatsapp_api_token',
    'whatsapp_sender',
  ],
  integrasi: [
    'mikrotik_host',
    'mikrotik_port',
    'mikrotik_user',
    'mikrotik_password',
    'mikrotik_gui_url',
    'mikrotik_write_enabled',
    'freeradius_host',
    'freeradius_port',
    'freeradius_secret',
  ],
};
