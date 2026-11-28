"""Package the reviewed login client and its offline preview from the repository root."""
import os
import stat
import subprocess
import sys
import time
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path('clients/login')
RUNTIME = (
    'cli', 'desktop', 'gate', 'control-page', 'origin-route', 'pair-store', 'launch', 'session', 'strict', 'tunnel',
    'browser-open', 'desktop-cli', 'desktop-relay', 'desktop-session', 'interrupts',
)
STRICT = ('browser', 'display', 'ipc', 'local', 'probe', 'sandbox', 'system', 'worker')
SCREEN = ('render.mjs', 'view.mjs', 'styles.css', 'live.js', 'demo.js', 'ru.json', 'preview.mjs')
# Node takes a .ts file's module type from the nearest package.json above it. Without one in the
# archive, a folder above it with {"type": "commonjs"} stops the client from loading.
# Next to the one .ts file, not at the root: unpacked into a project, it must not replace theirs.
MODULE = ('apps/proxy/src/login/package.json', b'{"type": "module"}\n')


def package(target):
    files = [ROOT / (name + '.mjs') for name in RUNTIME]
    files.extend(ROOT / 'strict' / (name + '.mjs') for name in STRICT)
    files.extend(ROOT / 'screen' / name for name in SCREEN)
    files.extend([Path('apps/proxy/src/login/client-hello.ts'), Path('docs/login-client.md')])
    if not any(path.exists() for path in files):
        target.unlink(missing_ok=True)
        return
    for path in files:
        if not path.is_file() or path.resolve() != path.absolute():
            raise SystemExit(f'Missing or non-regular login client source: {path}')
    with TemporaryDirectory() as folder:
        preview = Path(folder) / 'registration-preview.html'
        subprocess.run(['node', ROOT / 'screen/preview.mjs', preview], check=True)
        with NamedTemporaryFile(dir=target.parent, delete=False) as output:
            temp = Path(output.name)
        try:
            with ZipFile(temp, 'w', compression=ZIP_DEFLATED) as archive:
                for path in files:
                    archive.write(path, path.as_posix())
                archive.write(preview, preview.name)
                module = ZipInfo(MODULE[0], time.localtime(files[0].stat().st_mtime)[:6])
                module.external_attr = (stat.S_IFREG | 0o644) << 16
                module.compress_type = ZIP_DEFLATED
                archive.writestr(module, MODULE[1])
            # The bot reads this public bundle as a different UID from the image builder.
            temp.chmod(0o644)
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)


if __name__ == '__main__':
    package(Path(sys.argv[1]))
