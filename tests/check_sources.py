# Python Script — syntax checks for the deployable replacement files.
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1]
for path in sorted((root / 'replacements').glob('*.gs')):
    result = subprocess.run(['node', '--check'], input=path.read_text(), text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(f'{path.name}: {result.stderr}')
    print(f'PASS syntax {path.name}')
