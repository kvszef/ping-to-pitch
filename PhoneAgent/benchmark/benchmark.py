"""Run one recording through every local STT model and compare against the reference script.

Usage:
  uv run benchmark.py take1                 # recordings/take1.wav and take1.phone.wav
  uv run benchmark.py take1 --models small,turbo,vosk-de
  uv run benchmark.py take1 --clean-only    # skip the phone-quality variant
  uv run benchmark.py --list                # available model keys

Cloud baselines are added automatically when OPENAI_API_KEY or DEEPGRAM_API_KEY is set.
"""
from __future__ import annotations

import argparse
import json
import os

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import jiwer
import soundfile as sf
from tabulate import tabulate

from normalize import normalize

HERE = Path(__file__).parent
MODELS = HERE / "models"
REC = HERE / "recordings"
RESULTS = HERE / "results"
THREADS = max(1, (os.cpu_count() or 4) - 2)

Transcriber = Callable[[Path], str]

# ---------------------------------------------------------------- model runners


def run_faster_whisper(size: str) -> Transcriber:
    from faster_whisper import WhisperModel
    model = WhisperModel(size, device="cpu", compute_type="int8",
                         cpu_threads=THREADS, download_root=str(MODELS / "hf"))

    def transcribe(path: Path) -> str:
        segments, _ = model.transcribe(str(path), language="de", beam_size=5, vad_filter=True)
        return " ".join(s.text.strip() for s in segments)
    return transcribe


def run_vosk(name: str) -> Transcriber:
    import vosk
    vosk.SetLogLevel(-1)
    model = vosk.Model(str(MODELS / name))

    def transcribe(path: Path) -> str:
        audio, rate = sf.read(path, dtype="int16")
        assert rate == 16000, f"{path} muss 16 kHz sein"
        rec = vosk.KaldiRecognizer(model, rate)
        words = []
        step = 4000
        for i in range(0, len(audio), step):
            if rec.AcceptWaveform(audio[i:i + step].tobytes()):
                words.append(json.loads(rec.Result())["text"])
        words.append(json.loads(rec.FinalResult())["text"])
        return " ".join(w for w in words if w)
    return transcribe


def run_parakeet(name: str) -> Transcriber:
    import sherpa_onnx
    d = MODELS / name
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"),
        joiner=str(d / "joiner.int8.onnx"), tokens=str(d / "tokens.txt"),
        num_threads=THREADS, model_type="nemo_transducer")

    def transcribe(path: Path) -> str:
        audio, rate = sf.read(path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        s = rec.create_stream()
        s.accept_waveform(rate, audio)
        rec.decode_stream(s)
        return s.result.text
    return transcribe


def run_openai(model: str) -> Transcriber:
    import requests

    def transcribe(path: Path) -> str:
        with open(path, "rb") as f:
            r = requests.post("https://api.openai.com/v1/audio/transcriptions",
                              headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                              files={"file": f}, data={"model": model, "language": "de"}, timeout=120)
        r.raise_for_status()
        return r.json()["text"]
    return transcribe


def run_deepgram(model: str) -> Transcriber:
    import requests

    def transcribe(path: Path) -> str:
        r = requests.post(f"https://api.deepgram.com/v1/listen?model={model}&language=de&smart_format=true",
                          headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}",
                                   "Content-Type": "audio/wav"},
                          data=path.read_bytes(), timeout=120)
        r.raise_for_status()
        return r.json()["results"]["channels"][0]["alternatives"][0]["transcript"]
    return transcribe


REGISTRY: dict[str, tuple[str, Callable[[], Transcriber]]] = {
    "tiny":       ("faster-whisper tiny (int8)",           lambda: run_faster_whisper("tiny")),
    "base":       ("faster-whisper base (int8)",           lambda: run_faster_whisper("base")),
    "small":      ("faster-whisper small (int8)",          lambda: run_faster_whisper("small")),
    "medium":     ("faster-whisper medium (int8)",         lambda: run_faster_whisper("medium")),
    "turbo":      ("faster-whisper large-v3-turbo (int8)", lambda: run_faster_whisper("large-v3-turbo")),
    "large-v3":   ("faster-whisper large-v3 (int8)",       lambda: run_faster_whisper("large-v3")),
    "vosk-small": ("Vosk small-de-0.15",                   lambda: run_vosk("vosk-model-small-de-0.15")),
    "vosk-de":    ("Vosk de-0.21",                         lambda: run_vosk("vosk-model-de-0.21")),
    "parakeet":   ("Parakeet TDT 0.6B v3 (sherpa-onnx int8)",
                   lambda: run_parakeet("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")),
}
if os.environ.get("OPENAI_API_KEY"):
    REGISTRY["openai"] = ("OpenAI gpt-4o-transcribe (cloud)", lambda: run_openai("gpt-4o-transcribe"))
if os.environ.get("DEEPGRAM_API_KEY"):
    REGISTRY["deepgram"] = ("Deepgram nova-3 (cloud)", lambda: run_deepgram("nova-3"))

# ---------------------------------------------------------------- evaluation


@dataclass
class Result:
    model: str
    label: str
    variant: str
    load_s: float
    transcribe_s: float
    rtf: float
    wer: float
    cer: float
    transcript: str
    error: str = ""


def evaluate(key: str, label: str, factory: Callable[[], Transcriber],
             audios: dict[str, Path], reference: str) -> list[Result]:
    out: list[Result] = []
    print(f"\n== {label}")
    try:
        t0 = time.perf_counter()
        transcribe = factory()
        load_s = time.perf_counter() - t0
    except Exception as e:  # noqa: BLE001
        print(f"   FEHLER beim Laden: {e}")
        for variant in audios:
            out.append(Result(key, label, variant, 0, 0, 0, 1.0, 1.0, "", str(e)))
        return out
    ref_n = normalize(reference)
    for variant, path in audios.items():
        duration = sf.info(path).duration
        try:
            t0 = time.perf_counter()
            hyp = transcribe(path)
            dt = time.perf_counter() - t0
        except Exception as e:  # noqa: BLE001
            print(f"   [{variant}] FEHLER: {e}")
            out.append(Result(key, label, variant, load_s, 0, 0, 1.0, 1.0, "", str(e)))
            continue
        hyp_n = normalize(hyp)
        wer = jiwer.wer(ref_n, hyp_n) if hyp_n else 1.0
        cer = jiwer.cer(ref_n, hyp_n) if hyp_n else 1.0
        print(f"   [{variant}] {dt:5.1f}s  RTF {dt / duration:.2f}  WER {wer * 100:5.1f}%  CER {cer * 100:5.1f}%")
        out.append(Result(key, label, variant, load_s, dt, dt / duration, wer, cer, hyp))
    return out


def write_report(name: str, results: list[Result], reference: str, duration: float) -> Path:
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}.json").write_text(
        json.dumps([asdict(r) for r in results], ensure_ascii=False, indent=2), "utf-8")
    variants = sorted({r.variant for r in results}, key=lambda v: v != "clean")
    rows = []
    for key in dict.fromkeys(r.model for r in results):
        rs = {r.variant: r for r in results if r.model == key}
        first = rs[variants[0]]
        row = [first.label, f"{first.load_s:.1f}"]
        for v in variants:
            r = rs.get(v)
            if r is None or r.error:
                row += ["-", "-", "-"]
            else:
                row += [f"{r.transcribe_s:.1f}", f"{r.rtf:.2f}", f"{r.wer * 100:.1f}"]
        rows.append(row)
    header = ["Modell", "Laden s"] + [h for v in variants for h in (f"{v} s", f"{v} RTF", f"{v} WER %")]
    best = min((r for r in results if not r.error), key=lambda r: (r.wer, r.rtf), default=None)
    lines = [
        f"# STT-Benchmark: {name}", "",
        f"Aufnahme: {duration:.1f} s, {len(normalize(reference).split())} Referenzwoerter. "
        f"RTF = Rechenzeit / Audiodauer (unter 1.0 heisst schneller als Echtzeit). "
        f"WER = Wortfehlerrate nach Normalisierung (Zahlen als Woerter, Kleinschreibung, ohne Satzzeichen).", "",
        tabulate(rows, header, tablefmt="github"), "",
    ]
    if best:
        lines += [f"**Genauestes Modell:** {best.label} ({best.variant}) mit WER {best.wer * 100:.1f} %.", ""]
    lines += ["## Referenz", "", reference.strip(), "", "## Transkripte", ""]
    for r in results:
        lines += [f"### {r.label} / {r.variant}", ""]
        lines += [f"Fehler: {r.error}", ""] if r.error else [r.transcript.strip() or "(leer)", ""]
    path = RESULTS / f"{name}.md"
    path.write_text("\n".join(lines), "utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("take", nargs="?", help="Name der Aufnahme unter recordings/ (ohne .wav)")
    ap.add_argument("--models", help="Kommagetrennte Modellschluessel, Standard: alle")
    ap.add_argument("--clean-only", action="store_true")
    ap.add_argument("--reference", default=str(HERE / "script.txt"))
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list or not args.take:
        for k, (label, _) in REGISTRY.items():
            print(f"{k:12} {label}")
        return

    keys = args.models.split(",") if args.models else list(REGISTRY)
    unknown = [k for k in keys if k not in REGISTRY]
    if unknown:
        sys.exit(f"Unbekannte Modelle: {unknown}. Verfuegbar: {list(REGISTRY)}")

    clean = REC / f"{args.take}.wav"
    if not clean.exists():
        sys.exit(f"{clean} fehlt. Erst aufnehmen:  uv run record.py {args.take}")
    audios = {"clean": clean}
    phone = REC / f"{args.take}.phone.wav"
    if phone.exists() and not args.clean_only:
        audios["phone"] = phone
    reference = Path(args.reference).read_text("utf-8")
    duration = sf.info(clean).duration
    print(f"Aufnahme {clean.name}: {duration:.1f} s, Varianten: {list(audios)}, Threads: {THREADS}")

    results: list[Result] = []
    for k in keys:
        label, factory = REGISTRY[k]
        results += evaluate(k, label, factory, audios, reference)

    report = write_report(args.take, results, reference, duration)
    ok = [r for r in results if not r.error]
    print("\n" + tabulate(
        [[r.label, r.variant, f"{r.transcribe_s:.1f}", f"{r.rtf:.2f}", f"{r.wer * 100:.1f}", f"{r.cer * 100:.1f}"]
         for r in sorted(ok, key=lambda r: (r.variant != "clean", r.wer))],
        ["Modell", "Audio", "Sek.", "RTF", "WER %", "CER %"], tablefmt="github"))
    print(f"\nBericht: {report}")


if __name__ == "__main__":
    main()
