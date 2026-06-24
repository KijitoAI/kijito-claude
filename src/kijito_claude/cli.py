"""Console entry point: run the bundled bash installer (install.sh).

The bash scripts and skills are shipped as package data under ``_assets/``. We locate
them through ``importlib.resources`` (works whether the package is installed normally or
run via ``pipx run``) and shell out to ``bash``. ``install.sh`` resolves its siblings
relative to its own directory, so we run it with ``cwd`` set to the assets directory.
"""

from __future__ import annotations

import importlib.resources as resources
import shutil
import subprocess
import sys


def main() -> int:
    bash = shutil.which("bash")
    if bash is None:
        sys.stderr.write(
            "kijito-claude needs bash to run its installer.\n"
            "On Windows, run it inside WSL (recommended) or Git Bash.\n"
            "See https://github.com/KijitoAI/kijito-claude#platform-support\n"
        )
        return 1

    # For a normally installed wheel (pip/pipx unpack to disk) this is a real path and its
    # siblings (scripts/, skills/) are present next to install.sh.
    assets = resources.files("kijito_claude").joinpath("_assets")
    install_sh = assets.joinpath("install.sh")
    return subprocess.call(
        [bash, str(install_sh), *sys.argv[1:]],
        cwd=str(assets),
    )


if __name__ == "__main__":
    raise SystemExit(main())
