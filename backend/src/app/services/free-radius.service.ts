import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

interface FreeRadiusUser {
  id: string;
  name: string;
  password: string;
  reply: string;
  pool: string;
  max_session_time: number;
  calling_station_id: string;
}

@Injectable()
export class FreeRadiusService {
  private readonly logger = new Logger(FreeRadiusService.name);
  private users: FreeRadiusUser[] = [];

  constructor(private configService: ConfigService) {
    this.logger.log(`FreeRADIUS configured: host=${this.configService.freeradius.host}`);
  }

  getUsers() {
    return this.users;
  }

  addUser(user: FreeRadiusUser) {
    this.users.push(user);
    this.logger.log(`FreeRADIUS user added: ${user.name}`);
  }

  removeUser(id: string) {
    const index = this.users.findIndex((u) => u.id === id);
    if (index !== -1) {
      this.users.splice(index, 1);
      this.logger.log(`FreeRADIUS user removed: ${id}`);
    }
  }
}
