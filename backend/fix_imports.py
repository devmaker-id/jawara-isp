#!/usr/bin/env python3
import re
from pathlib import Path

src_dir = Path('/home/devmaker/jawara-isp/backend/src')

for file in src_dir.rglob('*.ts'):
    content = file.read_text()
    # Match relative imports: from './xxx' or from "../xxx" where xxx does NOT start with @ or https
    def add_ts(match):
        full = match.group(0)
        # Find the quote character
        if "'" in full:
            q = "'"
        else:
            q = '"'
        # Find the path between quotes
        start = full.find(q) + 1
        end = full.find(q, start)
        path = full[start:end]
        # Only add .ts if it's a relative path (starts with ./ or ../) and doesn't have extension
        if (path.startswith('./') or path.startswith('../')) and not any(path.endswith(ext) for ext in ['.ts', '.js', '.json']):
            new_path = path + '.ts'
            full = full[:start-1] + new_path + full[end:]
        return full

    new_content = re.sub(r"from ['\"][^'\"]+['\"]", add_ts, content)
    if new_content != content:
        file.write_text(new_content)
        print('Fixed imports: ' + str(file.relative_to(src_dir)))
print('Done')
