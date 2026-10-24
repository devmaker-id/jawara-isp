#!/usr/bin/env python3
import re
from pathlib import Path

# Remove .ts extension from relative imports in src
for file in Path('src').rglob('*.ts'):
    content = file.read_text()
    def fix(match):
        path = match.group(1)
        if path.endswith('.ts') and (path.startswith('./') or path.startswith('../')):
            return f"from '{path[:-3]}'"
        return match.group(0)
    new_content = re.sub(r"from '(\.\.?/[^']+?\.ts)'", fix, content)
    if new_content != content:
        file.write_text(new_content)
        print(f'Fixed import extension: {file.relative_to("src")}')
print('Done')
