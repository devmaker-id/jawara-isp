#!/usr/bin/env python3
import re
from pathlib import Path

# Fix files in src/ directory only (not node_modules)
src_dir = Path('/home/devmaker/jawara-isp/backend/src')

# Files to fix: remove .ts from node_modules imports and fix test files
files_to_fix = [
    src_dir / 'main.ts',
    src_dir / 'app.module.ts',
    src_dir / 'app.controller.ts',
]

for file in files_to_fix:
    if not file.exists():
        continue
    content = file.read_text()
    # Remove .ts from @nestjs packages and express
    content = content.replace("from '@nestjs/core.ts'", "from '@nestjs/core'")
    content = content.replace("from '@nestjs/common.ts'", "from '@nestjs/common'")
    content = content.replace("from '@nestjs/config.ts'", "from '@nestjs/config'")
    content = content.replace("from 'express.ts'", "from 'express'")
    content = content.replace("from './app.module.js'", "from './app.module.js'")
    content = content.replace("from './config/config.service.js'", "from './config/config.service.ts'")
    if content != file.read_text():
        file.write_text(content)
        print('Fixed: ' + str(file))

# Fix imports in other files - ensure node_modules imports don't have .ts
for file in src_dir.rglob('*.ts'):
    if file in files_to_fix:
        continue
    content = file.read_text()
    # For node_modules imports, remove .ts (e.g., from '@nestjs/jwt.ts' -> from '@nestjs/jwt')
    # For local imports, keep .ts (e.g., from './dto/package.dto.ts' -> keep as is)
    # But only for relative imports starting with ./ or ..
    def fix_import(match):
        full = match.group(0)
        if "'" in full:
            q = "'"
        else:
            q = '"'
        start = full.find(q) + 1
        end = full.find(q, start)
        path = full[start:end]
        # Only fix node_modules imports (start with @ or do not start with ./ or ..)
        # Keep local imports with .ts extension
        if path.startswith('@') or (not path.startswith('./') and not path.startswith('../')):
            # This is a node_modules import, remove .ts
            if path.endswith('.ts'):
                new_path = path[:-3]
                full = full[:start-1] + new_path + full[end:]
        return full

    new_content = re.sub(r"from ['\"][^'\"]+['\"]", fix_import, content)
    if new_content != content:
        file.write_text(new_content)
        print('Fixed node_modules imports: ' + str(file.relative_to(src_dir)))

# Fix main.ts specifically - change ./app.module.js to ./app.module.js (keep as is, NestJS expects .js in main.ts for ESM)
# But actually, main.ts uses require or import with .js extension for ESM
# Let me check the current main.ts
print('Done')
