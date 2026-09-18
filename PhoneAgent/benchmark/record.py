"""Record a take from the microphone, save it as 16 kHz mono WAV and create a phone-quality copy.

Usage:  uv run record.py take1
Press Enter to stop recording.
"""
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

RATE = 16000
REC = Path(__file__).parent / "recordings"


def make_phone_version(src: Path, dst: Path) -> None:
    """Simulate a telephone line: 8 kHz, 300-3400 Hz band, then back to 16 kHz for the models."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-af", "aresample=8000,highpass=f=300,lowpass=f=3400,aresample=16000",
         "-ac", "1", str(dst)],
        check=True,
    )


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "take1"
    REC.mkdir(exist_ok=True)
    out = REC / f"{name}.wav"
    chunks: list[np.ndarray] = []
    stop = threading.Event()

    def callback(indata, frames, time, status):
        if status:
            print(status, file=sys.stderr)
        chunks.append(indata.copy())

    print(f"Aufnahme läuft ({RATE} Hz, mono). Enter drücken zum Beenden.")
    with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", callback=callback):
        input()
        stop.set()

    audio = np.concatenate(chunks, axis=0)
    sf.write(out, audio, RATE, subtype="PCM_16")
    seconds = len(audio) / RATE
    print(f"Gespeichert: {out} ({seconds:.1f} s)")

    phone = REC / f"{name}.phone.wav"
    make_phone_version(out, phone)
    print(f"Telefon-Variante: {phone}")
    print(f"\nNächster Schritt:\n  uv run benchmark.py {name}")


if __name__ == "__main__":
    main()
