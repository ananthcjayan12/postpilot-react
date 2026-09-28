"""Give release assets stable, architecture-specific names and SHA-256 checksums."""
import hashlib
import pathlib
import shutil
import sys

root = pathlib.Path(__file__).resolve().parents[1]
target, version = sys.argv[1:]
bundle = root / 'src-tauri' / 'target' / target / 'release' / 'bundle'
output = root / 'release-assets'
output.mkdir(exist_ok=True)
ext = 'exe' if 'windows' in target else 'dmg'
files = list((bundle / ('nsis' if ext == 'exe' else 'dmg')).glob(f'*.{ext}'))
if len(files) != 1:
    raise SystemExit(f'Expected one {ext} installer, found {len(files)}')
name = f'PostPilot-Companion-{version}-{target}.{ext}'
destination = output / name
shutil.copy2(files[0], destination)
(output / f'{name}.sha256').write_text(f'{hashlib.sha256(destination.read_bytes()).hexdigest()}  {name}\n')
