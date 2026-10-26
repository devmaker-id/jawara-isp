import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

// Ringkasan dashboard punya controller sendiri (modules/dashboard) karena
// membaca metrik host, perangkat MikroTik, dan tabel billing sekaligus.
@Controller()
export class AppController {
  @Get()
  root(@Req() req: Request, @Res() res: Response) {
    res.json({
      service: 'jawara-billing',
      version: '0.1.0',
      path: req.path,
      method: req.method,
    });
  }

  @Get('health')
  health() {
    return {
      service: 'jawara-billing',
      status: 'ok',
      version: '0.1.0',
    };
  }
}
