#!/usr/bin/env python3
"""Install pinned CI scanners without third-party GitHub Action wrappers."""
from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / ".ci-tools" / "bin"
BIN.mkdir(parents=True, exist_ok=True)

TOOLS = {
    "trivy": {
        "version": "0.74.0",
        "url": "https://github.com/aquasecurity/trivy/releases/download/v0.74.0/trivy_0.74.0_Linux-64bit.tar.gz",
        "checksums": "https://github.com/aquasecurity/trivy/releases/download/v0.74.0/trivy_0.74.0_checksums.txt",
        "asset": "trivy_0.74.0_Linux-64bit.tar.gz",
        "binary": "trivy",
    },
    "gitleaks": {
        "version": "8.30.1",
        "url": "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
        "sha256": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
        "binary": "gitleaks",
    },
    "actionlint": {
        "version": "1.7.12",
        "url": "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz",
        "sha256": "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
        "binary": "actionlint",
    },
    "lychee": {
        "version": "0.24.2",
        "url": "https://github.com/lycheeverse/lychee/releases/download/lychee-v0.24.2/lychee-x86_64-unknown-linux-musl.tar.gz",
        "sha256": "73657a111819a30c47c08352896796f23d64e4eb2b3ed39b6d32149241566fc5",
        "binary": "lychee",
    },
}


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "IRS-CI/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expected_from_checksum_file(url: str, asset: str, directory: Path) -> str:
    checksum_file = directory / "checksums.txt"
    download(url, checksum_file)
    for line in checksum_file.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[-1].lstrip("*") == asset:
            return parts[0].lower()
    raise RuntimeError(f"No checksum found for {asset}")


def install(name: str) -> None:
    if name not in TOOLS:
        raise SystemExit(f"Unsupported tool: {name}")
    spec = TOOLS[name]
    target = BIN / spec["binary"]
    with tempfile.TemporaryDirectory(prefix=f"irs-{name}-") as tmp:
        directory = Path(tmp)
        archive = directory / "tool.tar.gz"
        download(spec["url"], archive)
        expected = spec.get("sha256")
        if expected is None:
            expected = expected_from_checksum_file(spec["checksums"], spec["asset"], directory)
        actual = sha256(archive)
        if actual.lower() != expected.lower():
            raise RuntimeError(f"SHA-256 mismatch for {name} {spec['version']}: {actual}")
        with tarfile.open(archive, "r:gz") as tar:
            members = [m for m in tar.getmembers() if Path(m.name).name == spec["binary"] and m.isfile()]
            if len(members) != 1:
                raise RuntimeError(f"Expected one {spec['binary']} binary in {name} archive, found {len(members)}")
            extracted = tar.extractfile(members[0])
            if extracted is None:
                raise RuntimeError(f"Could not extract {spec['binary']}")
            with target.open("wb") as output:
                shutil.copyfileobj(extracted, output)
        target.chmod(0o755)
    os.system(f'"{target}" --version')


def main() -> None:
    requested = sys.argv[1:]
    if not requested:
        raise SystemExit("Usage: install_ci_tools.py <tool> [tool ...]")
    for tool in requested:
        install(tool)


if __name__ == "__main__":
    main()
