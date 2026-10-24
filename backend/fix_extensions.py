#!/usr/bin/env python3
import re
from pathlib import Path

# Remove .ts extensions from relative imports
for file in Path('src').rglob('*.ts'):
    content = file.read_text()
    def remove_ext(match):
        path = match.group(1)
        if path.endswith('.ts') and (path.startswith('./') or path.startswith('../')):
            return f"from '{path[:-3]}'"
        return match.group(0)
    new_content = re.sub(r"from '(\.\.?/[^']+?\.ts)'", remove_ext, content)
    if new_content != content:
        file.write_text(new_content)
        print(f'Removed .ts from: {file.relative_to("src")}')
print('Done')
