"""Download the Vosk and sherpa-onnx (Parakeet) models into ./models.

faster-whisper models are pulled from Hugging Face automatically on first use.
Usage:  uv run download_models.py [--skip-large]
"""
import sys
import tarfile
import zipfile
from pathlib import Path

import requests
from tqdm import tqdm

MODELS = Path(__file__).parent / "models"

VOSK = {
    "vosk-model-small-de-0.15": "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip",
    "vosk-model-de-0.21": "https://alphacephei.com/vosk/models/vosk-model-de-0.21.zip",
}
SHERPA = {
    "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8":
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
}
LARGE = {"vosk-model-de-0.21"}


def fetch(url: str, dst: Path) -> None:
    if dst.exists():
        return
    tmp = dst.with_suffix(dst.suffix + ".part")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        with open(tmp, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc=dst.name) as bar:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                bar.update(len(chunk))
    tmp.rename(dst)


def main() -> None:
    skip_large = "--skip-large" in sys.argv
    MODELS.mkdir(exist_ok=True)
    for name, url in VOSK.items():
        if skip_large and name in LARGE:
            continue
        if (MODELS / name).is_dir():
            print(f"vorhanden: {name}")
            continue
        archive = MODELS / f"{name}.zip"
        fetch(url, archive)
        with zipfile.ZipFile(archive) as z:
            z.extractall(MODELS)
        archive.unlink()
        print(f"entpackt: {name}")
    for name, url in SHERPA.items():
        if (MODELS / name).is_dir():
            print(f"vorhanden: {name}")
            continue
        archive = MODELS / f"{name}.tar.bz2"
        fetch(url, archive)
        with tarfile.open(archive, "r:bz2") as t:
            t.extractall(MODELS, filter="data")
        archive.unlink()
        print(f"entpackt: {name}")


if __name__ == "__main__":
    main()
