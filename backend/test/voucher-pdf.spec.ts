import { describe, expect, it } from 'vitest';
import { buildVoucherPdf } from '../src/app/modules/profiles/voucher-pdf';
import { WhatsAppService } from '../src/app/modules/whatsapp/whatsapp.service';

// PDF dibuat tanpa pustaka, jadi yang diuji adalah strukturnya: header, trailer,
// jumlah halaman, dan bahwa teks voucher benar-benar tertulis di stream.
describe('buildVoucherPdf', () => {
  const cards = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      profile: 'HS-2HARI',
      username: `UJI${String(i).padStart(3, '0')}`,
      password: `PW${1000 + i}`,
      meta: 'voucher · ready-to-use',
    }));

  it('menghasilkan PDF 1.4 yang bisa dibaca', () => {
    const pdf = buildVoucherPdf(cards(3)).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('startxref');
  });

  it('menulis username dan password ke dalam stream', () => {
    const pdf = buildVoucherPdf(cards(1)).toString('latin1');
    expect(pdf).toContain('(UJI000)');
    expect(pdf).toContain('(PW1000)');
  });

  it('memecah ke halaman berikutnya saat kartu melebihi satu halaman', () => {
    // 24 kartu per halaman A4 (3 kolom x 8 baris).
    const onePage = buildVoucherPdf(cards(24)).toString('latin1');
    const twoPages = buildVoucherPdf(cards(25)).toString('latin1');
    expect(onePage).toContain('/Count 1');
    expect(twoPages).toContain('/Count 2');
  });

  it('tidak menghasilkan halaman kosong tanpa kartu', () => {
    const pdf = buildVoucherPdf([]).toString('latin1');
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('Tidak ada voucher');
  });

  it('meloloskan karakter yang merusak sintaks PDF', () => {
    const pdf = buildVoucherPdf([
      { profile: 'A (B) \\ C', username: 'X', password: 'Y', meta: 'z' },
    ]).toString('latin1');
    expect(pdf).toContain('A \\(B\\) \\\\ C');
  });
});

describe('WhatsAppService.normalisePhone', () => {
  it('menormalkan nomor Indonesia ke format 62', () => {
    expect(WhatsAppService.normalisePhone('08123456789')).toBe('628123456789');
    expect(WhatsAppService.normalisePhone('8123456789')).toBe('628123456789');
    expect(WhatsAppService.normalisePhone('+628123456789')).toBe('628123456789');
    expect(WhatsAppService.normalisePhone('62 812-3456-789')).toBe('628123456789');
  });

  it('menolak nomor yang tidak masuk akal', () => {
    expect(WhatsAppService.normalisePhone('')).toBeNull();
    expect(WhatsAppService.normalisePhone('12')).toBeNull();
    expect(WhatsAppService.normalisePhone('1234567890123456')).toBeNull();
  });
});
