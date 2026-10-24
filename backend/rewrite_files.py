#!/usr/bin/env python3
"""Rewrite all backend source files with correct imports."""
from pathlib import Path

base = Path('/home/devmaker/jawara-isp/backend/src')

files = {}

files[str(base / 'app.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ ConfigModule }} from '@nestjs/config';
import {{ AppController }} from './app.controller';
import {{ AppService }} from './app.service';
import {{ ConfigService }} from './config/config.service';
import {{ AuthModule }} from './modules/auth/auth.module';
import {{ CustomersModule }} from './modules/customers/customers.module';
import {{ PackagesModule }} from './modules/packages/packages.module';
import {{ InvoicesModule }} from './modules/invoices/invoices.module';
import {{ AdminModule }} from './modules/admin/admin.module';
import {{ ServicesModule }} from './services/services.module';

@Module({{
  imports: [
    ConfigModule.forRoot({{
      isGlobal: true,
      envFilePath: '.env',
    }}),
    AuthModule,
    CustomersModule,
    PackagesModule,
    InvoicesModule,
    AdminModule,
    ServicesModule,
  ],
  controllers: [AppController],
  providers: [AppService, ConfigService],
}})
export class AppModule {{}}
'''

files[str(base / 'app.controller.ts')] = '''import {{ Controller, Get, Req, Res }} from '@nestjs/common';
import {{ Request, Response }} from 'express';

@Controller()
export class AppController {{
  @Get()
  root(@Req() req: Request, @Res() res: Response) {{
    res.json({{
      service: 'jawara-billing',
      version: '0.1.0',
      path: req.path,
      method: req.method,
    }});
  }}

  @Get('health')
  health() {{
    return {{
      service: 'jawara-billing',
      status: 'ok',
      version: '0.1.0',
    }};
  }}
}}
'''

files[str(base / 'app.service.ts')] = '''import {{ Injectable }} from '@nestjs/common';

@Injectable()
export class AppService {{
  getHello(): string {{
    return 'jawara-billing - ISP Billing System (Sendi)';
  }}
}}
'''

files[str(base / 'main.ts')] = '''import {{ NestFactory }} from '@nestjs/core';
import {{ AppModule }} from './app.module';
import {{ ConfigService }} from './config/config.service';

async function bootstrap() {{
  const configService = new ConfigService();
  const app = await NestFactory.create(AppModule);
  await app.listen(configService.app.port);
}}

bootstrap();
'''

files[str(base / 'app.controller.spec.ts')] = '''import {{ Test, TestingModule }} from '@nestjs/testing';
import {{ AppController }} from './app.controller';
import {{ AppService }} from './app.service';

describe('AppController', () => {{
  let appController: AppController;

  beforeEach(async () => {{
    const app: TestingModule = await Test.createTestingModule({{
      controllers: [AppController],
      providers: [AppService],
    }}).compile();

    appController = app.get<AppController>(AppController);
  }});

  describe('root', () => {{
    it('should return "jawara-billing"', () => {{
      expect(appController.getHello()).toBe('jawara-billing - ISP Billing System (Sendi)');
    }});
  }});
}});
'''

# config service
files[str(base / 'config/config.service.ts')] = '''import {{ Injectable }} from '@nestjs/common';

export type Role = 'admin' | 'operator' | 'resseler';

export interface DatabaseConfig {{
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}}

export interface FreeRadiusConfig {{
  host: string;
  secret: string;
  port: number;
}}

export interface MikrotikConfig {{
  host: string;
  port: number;
  user: string;
  password: string;
}}

export interface AppConfig {{
  port: number;
  database: DatabaseConfig;
  freeradius: FreeRadiusConfig;
  mikrotik: MikrotikConfig;
  secretKey: string;
  jwtSecret: string;
}}

const REQUIRED_ENV = [
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'FREERADIUS_HOST', 'FREERADIUS_SECRET',
  'MIKROTIK_HOST', 'MIKROTIK_PORT', 'MIKROTIK_USER', 'MIKROTIK_PASSWORD',
  'SECRET_KEY', 'JWT_SECRET',
];

@Injectable()
export class ConfigService {{
  private readonly env: {{ [key: string]: string | undefined }} = {{
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    FREERADIUS_HOST: process.env.FREERADIUS_HOST,
    FREERADIUS_SECRET: process.env.FREERADIUS_SECRET,
    MIKROTIK_HOST: process.env.MIKROTIK_HOST,
    MIKROTIK_PORT: process.env.MIKROTIK_PORT,
    MIKROTIK_USER: process.env.MIKROTIK_USER,
    MIKROTIK_PASSWORD: process.env.MIKROTIK_PASSWORD,
    SECRET_KEY: process.env.SECRET_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
  }};

  constructor() {{
    for (const key of REQUIRED_ENV) {{
      if (!this.env[key]) {{
        console.warn(`Config warning: ${key} is not set`);
      }}
    }}
  }}

  private get(key: string, fallback: string = ''): string {{
    return this.env[key] ?? fallback;
  }}

  private getInt(key: string, fallback: number): number {{
    const val = this.env[key];
    if (val && /^\\d+$/.test(val)) {{
      return parseInt(val, 10);
    }}
    return fallback;
  }}

  public readonly app = {{
    port: this.getInt('PORT', 793),
  }};

  public readonly database = {{
    host: this.get('DB_HOST', '127.0.0.1'),
    port: this.getInt('DB_PORT', 3306),
    user: this.get('DB_USER', 'isp_billing'),
    password: this.get('DB_PASSWORD', ''),
    name: this.get('DB_NAME', 'isp_billing'),
  }};

  public readonly freeradius = {{
    host: this.get('FREERADIUS_HOST', '127.0.0.1'),
    secret: this.get('FREERADIUS_SECRET', ''),
    port: this.getInt('FREERADIUS_PORT', 1812),
  }};

  public readonly mikrotik = {{
    host: this.get('MIKROTIK_HOST', '192.168.100.254'),
    port: this.getInt('MIKROTIK_PORT', 1998),
    user: this.get('MIKROTIK_USER', 'hermes'),
    password: this.get('MIKROTIK_PASSWORD', ''),
  }};

  public readonly secretKey = this.get('SECRET_KEY', 'dev-only-secret-key-change-me');
  public readonly jwtSecret = this.get('JWT_SECRET', 'dev-jwt-secret-change-me');
}}
'''

# Auth module files
files[str(base / 'modules/auth/auth.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ JwtModule }} from '@nestjs/jwt';
import {{ AuthController }} from './auth.controller';
import {{ AuthService }} from './auth.service';
import {{ ConfigService }} from '../../config/config.service';

@Module({{
  imports: [
    JwtModule.register({{
      secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
      signOptions: {{ expiresIn: '7d' }},
    }}),
  ],
  controllers: [AuthController],
  providers: [AuthService, ConfigService],
  exports: [AuthService],
}})
export class AuthModule {{}}
'''

files[str(base / 'modules/auth/auth.service.ts')] = '''import {{ Injectable, UnauthorizedException }} from '@nestjs/common';
import {{ JwtService }} from '@nestjs/jwt';
import {{ ConfigService }} from '../../config/config.service';

export interface User {{
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'operator' | 'resseler';
  phone?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}}

@Injectable()
export class AuthService {{
  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {{}}

  validateUser(email: string, password: string): Promise<User | null> {{
    return Promise.resolve(null);
  }}

  async login(user: User) {{
    const payload = {{
      sub: user.id,
      email: user.email,
      role: user.role,
    }};
    return {{
      access_token: this.jwtService.sign(payload, {{
        secret: this.configService.jwtSecret,
        expiresIn: '7d',
      }}),
      user,
    }};
  }}

  decodeToken(token: string): Promise<any> {{
    return this.jwtService.verify(token, {{ secret: this.configService.jwtSecret }});
  }}
}}
'''

files[str(base / 'modules/auth/auth.controller.ts')] = '''import {{ Controller, Post, Body, Req, HttpCode, HttpStatus }} from '@nestjs/common';
import {{ Request }} from 'express';
import {{ LoginDto }} from './dto/login.dto';
import {{ AuthService }} from './auth.service';

@Controller('auth')
export class AuthController {{
  constructor(private authService: AuthService) {{}}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {{
    const {{ email, password }} = loginDto;
    const user = await this.authService.validateUser(email, password);
    if (!user) {{
      throw new UnauthorizedException('Email atau password salah');
    }}
    return this.authService.login(user);
  }}

  @Post('logout')
  async logout(@Req() req: Request) {{
    return {{ ok: true }};
  }}
}}
'''

files[str(base / 'modules/auth/dto/login.dto.ts')] = '''import {{ IsEmail, IsString, MinLength }} from 'class-validator';

export class LoginDto {{
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}}
'''

# Customers module files
files[str(base / 'modules/customers/customers.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ CustomersController }} from './customers.controller';
import {{ CustomersService }} from './customers.service';

@Module({{
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
}})
export class CustomersModule {{}}
'''

files[str(base / 'modules/customers/customers.service.ts')] = '''import {{ Injectable, NotFoundException }} from '@nestjs/common';
import {{ CreateCustomerDto, UpdateCustomerDto }} from './dto/customer.dto';

export interface Customer {{
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  created_at: Date;
}}

@Injectable()
export class CustomersService {{
  private customers: Customer[] = [];

  findAll() {{
    return this.customers;
  }}

  findOne(id: number) {{
    const customer = this.customers.find((c) => c.id === id);
    if (!customer) {{
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }}
    return customer;
  }}

  create(createDto: CreateCustomerDto) {{
    const now = new Date();
    const customer: Customer = {{
      id: this.customers.length + 1,
      name: createDto.name,
      email: createDto.email,
      phone: createDto.phone,
      address: createDto.address || '',
      is_active: createDto.is_active !== false,
      created_at: now,
    }};
    this.customers.push(customer);
    return customer;
  }}

  update(id: number, updateDto: UpdateCustomerDto) {{
    const customer = this.findOne(id);
    Object.assign(customer, updateDto);
    return customer;
  }}

  remove(id: number) {{
    const index = this.customers.findIndex((c) => c.id === id);
    if (index === -1) {{
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }}
    this.customers.splice(index, 1);
    return {{ ok: true }};
  }}
}}
'''

files[str(base / 'modules/customers/customers.controller.ts')] = '''import {{ Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus }} from '@nestjs/common';
import {{ CreateCustomerDto, UpdateCustomerDto }} from './dto/customer.dto';
import {{ CustomersService }} from './customers.service';

@Controller('customers')
export class CustomersController {{
  constructor(private customersService: CustomersService) {{}}

  @Get()
  findAll() {{
    return this.customersService.findAll();
  }}

  @Get(':id')
  findOne(@Param('id') id: string) {{
    return this.customersService.findOne(parseInt(id, 10));
  }}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateCustomerDto) {{
    return this.customersService.create(createDto);
  }}

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateCustomerDto) {{
    return this.customersService.update(parseInt(id, 10), updateDto);
  }}

  @Delete(':id')
  remove(@Param('id') id: string) {{
    return this.customersService.remove(parseInt(id, 10));
  }}
}}
'''

files[str(base / 'modules/customers/dto/customer.dto.ts')] = '''import {{ IsString, IsEmail, IsBoolean, IsOptional }} from 'class-validator';

export class CreateCustomerDto {{
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}}

export class UpdateCustomerDto {{
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}}
'''

# Packages module files
files[str(base / 'modules/packages/packages.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ PackagesController }} from './packages.controller';
import {{ PackagesService }} from './packages.service';

@Module({{
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
}})
export class PackagesModule {{}}
'''

files[str(base / 'modules/packages/packages.service.ts')] = '''import {{ Injectable, NotFoundException }} from '@nestjs/common';
import {{ CreatePackageDto, UpdatePackageDto }} from './dto/package.dto';

export interface Package {{
  id: number;
  name: string;
  description: string;
  price: number;
  data_limit: string;
  speed: number;
  valid_days: number;
  is_active: boolean;
  created_at: Date;
}}

@Injectable()
export class PackagesService {{
  private packages: Package[] = [];

  findAll() {{
    return this.packages;
  }}

  findOne(id: number) {{
    const pkg = this.packages.find((p) => p.id === id);
    if (!pkg) {{
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }}
    return pkg;
  }}

  create(createDto: CreatePackageDto) {{
    const now = new Date();
    const pkg: Package = {{
      id: this.packages.length + 1,
      name: createDto.name,
      description: createDto.description,
      price: createDto.price,
      data_limit: createDto.data_limit,
      speed: createDto.speed,
      valid_days: createDto.valid_days,
      is_active: createDto.is_active !== false,
      created_at: now,
    }};
    this.packages.push(pkg);
    return pkg;
  }}

  update(id: number, updateDto: UpdatePackageDto) {{
    const pkg = this.findOne(id);
    Object.assign(pkg, updateDto);
    return pkg;
  }}

  remove(id: number) {{
    const index = this.packages.findIndex((p) => p.id === id);
    if (index === -1) {{
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }}
    this.packages.splice(index, 1);
    return {{ ok: true }};
  }}
}}
'''

files[str(base / 'modules/packages/packages.controller.ts')] = '''import {{ Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus }} from '@nestjs/common';
import {{ CreatePackageDto, UpdatePackageDto }} from './dto/package.dto';
import {{ PackagesService }} from './packages.service';

@Controller('packages')
export class PackagesController {{
  constructor(private packagesService: PackagesService) {{}}

  @Get()
  findAll() {{
    return this.packagesService.findAll();
  }}

  @Get(':id')
  findOne(@Param('id') id: string) {{
    return this.packagesService.findOne(parseInt(id, 10));
  }}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreatePackageDto) {{
    return this.packagesService.create(createDto);
  }}

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdatePackageDto) {{
    return this.packagesService.update(parseInt(id, 10), updateDto);
  }}

  @Delete(':id')
  remove(@Param('id') id: string) {{
    return this.packagesService.remove(parseInt(id, 10));
  }}
}}
'''

files[str(base / 'modules/packages/dto/package.dto.ts')] = '''import {{ IsString, IsNumber, IsBoolean, IsOptional }} from 'class-validator';

export class CreatePackageDto {{
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsNumber()
  price: number;

  @IsString()
  data_limit: string;

  @IsNumber()
  speed: number;

  @IsNumber()
  valid_days: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}}

export class UpdatePackageDto {{
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  data_limit?: string;

  @IsNumber()
  @IsOptional()
  speed?: number;

  @IsNumber()
  @IsOptional()
  valid_days?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}}
'''

# Invoices module files
files[str(base / 'modules/invoices/invoices.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ InvoicesController }} from './invoices.controller';
import {{ InvoicesService }} from './invoices.service';

@Module({{
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
}})
export class InvoicesModule {{}}
'''

files[str(base / 'modules/invoices/invoices.service.ts')] = '''import {{ Injectable, NotFoundException }} from '@nestjs/common';
import {{ CreateInvoiceDto, UpdateInvoiceDto, PayInvoiceDto, InvoiceStatus }} from './dto/invoice.dto';

export interface Invoice {{
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  amount: number;
  status: InvoiceStatus;
  due_date: Date;
  paid_date?: Date;
  description: string;
  created_at: Date;
}}

@Injectable()
export class InvoicesService {{
  private invoices: Invoice[] = [];
  private counter = 1;

  findAll() {{
    return this.invoices;
  }}

  findOne(id: number) {{
    const inv = this.invoices.find((i) => i.id === id);
    if (!inv) {{
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }}
    return inv;
  }}

  findByCustomer(customerId: number) {{
    return this.invoices.filter((i) => i.customer_id === customerId);
  }}

  create(createDto: CreateInvoiceDto) {{
    const now = new Date();
    const inv: Invoice = {{
      id: this.counter++,
      invoice_number: `INV-2026-${(this.counter + 1000).toString().padStart(4, '0')}`,
      customer_id: createDto.customer_id,
      customer_name: `Pelanggan #${createDto.customer_id}`,
      amount: createDto.amount,
      status: createDto.status || InvoiceStatus.UNPAID,
      due_date: new Date(createDto.due_date),
      description: createDto.description || '',
      created_at: now,
    }};
    this.invoices.push(inv);
    return inv;
  }}

  pay(invoiceId: number, payDto: PayInvoiceDto) {{
    const inv = this.findOne(invoiceId);
    inv.amount = payDto.amount;
    inv.status = InvoiceStatus.PAID;
    inv.paid_date = new Date();
    return inv;
  }}

  update(id: number, updateDto: UpdateInvoiceDto) {{
    const inv = this.findOne(id);
    Object.assign(inv, updateDto);
    return inv;
  }}

  remove(id: number) {{
    const index = this.invoices.findIndex((i) => i.id === id);
    if (index === -1) {{
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }}
    this.invoices.splice(index, 1);
    return {{ ok: true }};
  }}

  getSummary() {{
    const total = this.invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const paid = this.invoices.filter((i) => i.status === InvoiceStatus.PAID).length;
    const overdue = this.invoices.filter((i) => i.status === InvoiceStatus.OVERDUE).length;
    return {{ total, paid, overdue }};
  }}
}}
'''

files[str(base / 'modules/invoices/invoices.controller.ts')] = '''import {{ Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus }} from '@nestjs/common';
import {{ CreateInvoiceDto, UpdateInvoiceDto, PayInvoiceDto }} from './dto/invoice.dto';
import {{ InvoicesService }} from './invoices.service';

@Controller('invoices')
export class InvoicesController {{
  constructor(private invoicesService: InvoicesService) {{}}

  @Get()
  findAll() {{
    return this.invoicesService.findAll();
  }}

  @Get(':id')
  findOne(@Param('id') id: string) {{
    return this.invoicesService.findOne(parseInt(id, 10));
  }}

  @Get('summary')
  getSummary() {{
    return this.invoicesService.getSummary();
  }}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateInvoiceDto) {{
    return this.invoicesService.create(createDto);
  }}

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@Param('id') id: string, @Body() payDto: PayInvoiceDto) {{
    return this.invoicesService.pay(parseInt(id, 10), payDto);
  }}

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateInvoiceDto) {{
    return this.invoicesService.update(parseInt(id, 10), updateDto);
  }}

  @Delete(':id')
  remove(@Param('id') id: string) {{
    return this.invoicesService.remove(parseInt(id, 10));
  }}
}}
'''

files[str(base / 'modules/invoices/dto/invoice.dto.ts')] = '''import {{ IsString, IsNumber, IsEnum, IsDateString, IsOptional }} from 'class-validator';

export enum InvoiceStatus {{
  UNPAID = 'unpaid',
  PAID = 'paid',
  OVERDUE = 'overdue',
}}

export class CreateInvoiceDto {{
  @IsNumber()
  customer_id: number;

  @IsNumber()
  amount: number;

  @IsDateString()
  due_date: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;
}}

export class UpdateInvoiceDto {{
  @IsNumber()
  @IsOptional()
  customer_id?: number;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;
}}

export class PayInvoiceDto {{
  @IsNumber()
  amount: number;
}}
'''

# Admin module files
files[str(base / 'modules/admin/admin.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ AdminController }} from './admin.controller';
import {{ AdminService }} from './admin.service';

@Module({{
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
}})
export class AdminModule {{}}
'''

files[str(base / 'modules/admin/admin.service.ts')] = '''import {{ Injectable, NotFoundException }} from '@nestjs/common';
import {{ Role }} from '../../config/config.service';
import {{ CreateUserDto, UpdateUserDto }} from './dto/user.dto';

export interface User {{
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  phone?: string;
  address?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}}

@Injectable()
export class AdminService {{
  private users: User[] = [];

  findAll() {{
    return this.users;
  }}

  findOne(id: number) {{
    const user = this.users.find((u) => u.id === id);
    if (!user) {{
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }}
    return user;
  }}

  findByEmail(email: string) {{
    return this.users.find((u) => u.email === email);
  }}

  create(createDto: CreateUserDto) {{
    const now = new Date();
    const exists = this.findByEmail(createDto.email);
    if (exists) {{
      throw new Error('Email sudah terdaftar');
    }}
    const user: User = {{
      id: this.users.length + 1,
      name: createDto.name,
      email: createDto.email,
      password_hash: process.env.ADMIN_DEFAULT_PASSWORD || 'change-me',
      role: createDto.role,
      phone: createDto.phone,
      address: createDto.address || '',
      is_active: createDto.is_active !== false,
      created_at: now,
      updated_at: now,
    }};
    this.users.push(user);
    return user;
  }}

  update(id: number, updateDto: UpdateUserDto) {{
    const user = this.findOne(id);
    if (updateDto.email && updateDto.email !== user.email) {{
      const exists = this.findByEmail(updateDto.email);
      if (exists) {{
        throw new Error('Email sudah terdaftar');
      }}
    }}
    Object.assign(user, updateDto);
    user.updated_at = new Date();
    return user;
  }}

  remove(id: number) {{
    const index = this.users.findIndex((u) => u.id === id);
    if (index === -1) {{
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }}
    this.users.splice(index, 1);
    return {{ ok: true }};
  }}
}}
'''

files[str(base / 'modules/admin/admin.controller.ts')] = '''import {{ Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus }} from '@nestjs/common';
import {{ Role }} from '../../config/config.service';
import {{ CreateUserDto, UpdateUserDto }} from './dto/user.dto';
import {{ AdminService }} from './admin.service';

@Controller('admin/users')
export class AdminController {{
  constructor(private adminService: AdminService) {{}}

  @Get()
  findAll() {{
    return this.adminService.findAll();
  }}

  @Get(':id')
  findOne(@Param('id') id: string) {{
    return this.adminService.findOne(parseInt(id, 10));
  }}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateUserDto) {{
    return this.adminService.create(createDto);
  }}

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateUserDto) {{
    return this.adminService.update(parseInt(id, 10), updateDto);
  }}

  @Delete(':id')
  remove(@Param('id') id: string) {{
    return this.adminService.remove(parseInt(id, 10));
  }}
}}
'''

files[str(base / 'modules/admin/dto/user.dto.ts')] = '''import {{ IsString, IsEmail, IsEnum, IsBoolean, IsOptional }} from 'class-validator';
import {{ Role }} from '../../config/config.service';

export class CreateUserDto {{
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsEnum(Role)
  role: Role;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}}

export class UpdateUserDto {{
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}}
'''

# Services module files
files[str(base / 'services/services.module.ts')] = '''import {{ Module }} from '@nestjs/common';
import {{ ConfigService }} from '../config/config.service';

@Module({{
  imports: [],
  controllers: [],
  providers: [ConfigService],
  exports: [ConfigService],
}})
export class ServicesModule {{}}
'''

files[str(base / 'services/free-radius.service.ts')] = '''import {{ Injectable, Logger }} from '@nestjs/common';
import {{ ConfigService }} from '../config/config.service';

interface FreeRadiusUser {{
  id: string;
  name: string;
  password: string;
  reply: string;
  pool: string;
  max_session_time: number;
  calling_station_id: string;
}}

@Injectable()
export class FreeRadiusService {{
  private readonly logger = new Logger(FreeRadiusService.name);
  private users: FreeRadiusUser[] = [];

  constructor(private configService: ConfigService) {{
    this.logger.log(`FreeRADIUS configured: host=${this.configService.freeradius.host}`);
  }}

  getUsers() {{
    return this.users;
  }}

  addUser(user: FreeRadiusUser) {{
    this.users.push(user);
    this.logger.log(`FreeRADIUS user added: ${user.name}`);
  }}

  removeUser(id: string) {{
    const index = this.users.findIndex((u) => u.id === id);
    if (index !== -1) {{
      this.users.splice(index, 1);
      this.logger.log(`FreeRADIUS user removed: ${id}`);
    }}
  }}
}}
'''

files[str(base / 'services/mikrotik.service.ts')] = '''import {{ Injectable, Logger, OnModuleInit }} from '@nestjs/common';
import {{ ConfigService }} from '../config/config.service';

export interface MikrotikIdentity {{
  name: string;
  version: string;
  capabilities: string[];
}}

@Injectable()
export class MikrotikService implements OnModuleInit {{
  private readonly logger = new Logger(MikrotikService.name);
  private identity: MikrotikIdentity | null = null;

  constructor(private configService: ConfigService) {{
    this.logger.log(`MikroTik configured: host=${this.configService.mikrotik.host}:${this.configService.mikrotik.port}`);
  }}

  async onModuleInit() {{
    try {{
      this.identity = await this.connect();
      this.logger.log(`MikroTik connected: ${this.identity?.name} v${this.identity?.version}`);
    }} catch (error) {{
      this.logger.warn(`MikroTik connection failed: ${error instanceof Error ? error.message : String(error)}. Retrying...`);
    }}
  }}

  private async connect(): Promise<MikrotikIdentity> {{
    return new Promise((resolve) => {{
      resolve({{
        name: 'demo-router',
        version: '6.49',
        capabilities: ['api', 'upnp'],
      }});
    }});
  }}

  async getNeighbors() {{
    return [];
  }}

  async getInterfaces() {{
    return [];
  }}

  async getRouteTable() {{
    return [];
  }}

  async getVlans() {{
    return [];
  }}

  async getPools() {{
    return [];
  }}
}}
'''

# Write all files
for path, content in files.items():
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    print(f'Written: {path}')

print(f'\\nTotal files written: {len(files)}')
