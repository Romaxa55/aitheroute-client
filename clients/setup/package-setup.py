"""Build the setup archives from the repository root: aitheroute.tar.gz and aitheroute.zip.

Both hold one folder, aitheroute/, laid out as ~/.aitheroute will be:
README.md and the start scripts on top, setup/ (the core and its words) and
helper/ (the reviewed login helper, the same files as its own ZIP).
"""
import importlib.util
import io
import sys
import tarfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

SETUP = Path('clients/setup')
CORE = (
    'core.mjs', 'defaults.mjs', 'claude-config.mjs', 'env.mjs', 'steps.mjs', 'token.mjs', 'tools.mjs',
    'elevate.mjs', 'guard.mjs', 'hosts.mjs', 'hosts-write.mjs', 'protect.mjs', 'ru.json', 'en.json',
)
# The helper's .ts is ESM; without this beside it Node would read it as CommonJS.
MODULE = b'{"type": "module"}\n'
FIXED = (2026, 1, 1, 0, 0, 0)


def helper_files():
    spec = importlib.util.spec_from_file_location('package_client', 'clients/login/package-client.py')
    client = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(client)
    files = [client.ROOT / (name + '.mjs') for name in client.RUNTIME]
    files.extend(client.ROOT / 'strict' / (name + '.mjs') for name in client.STRICT)
    files.extend(client.ROOT / 'screen' / name for name in client.SCREEN)
    files.extend([Path('apps/proxy/src/login/client-hello.ts'), Path('docs/login-client.md')])
    return files


def entries():
    """(path in the archive, bytes, executable) for every file."""
    found = [('README.md', SETUP / 'bundle/README.md', False), ('start.sh', SETUP / 'bundle/start.sh', True)]
    found += [('start.ps1', SETUP / 'bundle/start.ps1', False), ('start.cmd', SETUP / 'bundle/start.cmd', False)]
    found += [('setup/' + name, SETUP / name, False) for name in CORE]
    found += [('helper/' + path.as_posix(), path, False) for path in helper_files()]
    out = []
    for name, path, executable in found:
        if not path.is_file() or path.resolve() != path.absolute():
            raise SystemExit(f'Missing or non-regular setup source: {path}')
        data = path.read_bytes()
        if name.endswith('.cmd'):
            # cmd.exe misreads some lines of a batch file with bare LF endings.
            data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        out.append(('aitheroute/' + name, data, executable))
    out.append(('aitheroute/helper/apps/proxy/src/login/package.json', MODULE, False))
    return out


def write_tar(target, files):
    with tarfile.open(target, 'w:gz') as archive:
        for name, data, executable in files:
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o755 if executable else 0o644, 1767225600
            archive.addfile(info, io.BytesIO(data))


def write_zip(target, files):
    with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
        for name, data, executable in files:
            info = ZipInfo(name, FIXED)
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)


if __name__ == '__main__':
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    files = entries()
    write_tar(folder / 'aitheroute.tar.gz', files)
    write_zip(folder / 'aitheroute.zip', files)
    for target in folder.iterdir():
        # The proxy serves these as a different UID from the image builder.
        target.chmod(0o644)
