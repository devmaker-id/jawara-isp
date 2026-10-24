#!/usr/bin/env python3
"""Fix corrupted import statements in all backend source files."""
from pathlib import Path

src_dir = Path('/home/devmaker/jawara-isp/backend/src')

# Patterns to fix (old -> new)
fixes = [
    ("from @nestjs", "from '@nestjs"),
    ("from @nestjs/jwt'", "from '@nestjs/jwt'"),
    ("from class-validator'", "from 'class-validator'"),
    ("from express'", "from 'express'"),
    ("from 'nestjs/common'", "from '@nestjs/common'"),
    ("from 'nestjs/jwt'", "from '@nestjs/jwt'"),
    ("from 'class-validator'", "from 'class-validator'"),
    ("from 'express'", "from 'express'"),
]

all_files = list(src_dir.rglob('*.ts'))

fixed_count = 0
for file in all_files:
    content = file.read_text()
    new_content = content
    for old, new in fixes:
        if old in new_content:
            new_content = new_content.replace(old, new)
    if new_content != content:
        file.write_text(new_content)
        fixed_count += 1
        print(f'Fixed: {file.relative_to(src_dir)}')

print(f'\\nTotal files fixed: {fixed_count}')
