import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'jawara-billing - ISP Billing System (Sendi)';
  }
}
