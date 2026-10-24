#!/usr/bin/env python3
import re
from pathlib import Path

# Add .ts extension back to config service imports
for file in Path('src').rglob('*.ts'):
    content = file.read_text()
    # Add .ts to config service imports
    new_content = content.replace("from '../../../config/config.service'", "from '../../../config/config.service.ts'")
    # Also add .ts to config.service in other relative paths
    new_content = new_content.replace("from '../../config/config.service'", "from '../../config/config.service.ts'")
    if new_content != content:
        file.write_text(new_content)
        print(f'Fixed config import: {file.relative_to("src")}')
print('Done')
