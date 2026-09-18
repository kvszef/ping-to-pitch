"""Text normalisation so that '45'000 Franken' and 'fünfundvierzigtausend Franken' count as equal."""
import re
from num2words import num2words

_THOUSANDS = re.compile(r"(?<=\d)['’.   ](?=\d{3}\b)")
_TIME = re.compile(r"\b(\d{1,2})[:.](\d{2})(?:\s*uhr)?\b")
_ORDINAL = re.compile(r"\b(\d{1,2})\.\s+(?=[a-zäöü])")
_NUMBER = re.compile(r"\d+")


def _cardinal(m: re.Match) -> str:
    return " " + num2words(int(m.group(0)), lang="de") + " "


def _ordinal(m: re.Match) -> str:
    return " " + num2words(int(m.group(1)), lang="de", to="ordinal") + " "


def normalize(text: str) -> str:
    t = text.lower()
    t = _THOUSANDS.sub("", t)
    t = _TIME.sub(lambda m: f" {int(m.group(1))} uhr {int(m.group(2))} ", t)
    t = _ORDINAL.sub(_ordinal, t)
    t = t.replace("%", " prozent ")
    t = t.replace("chf", " franken ")
    t = _NUMBER.sub(_cardinal, t)
    t = t.replace("ß", "ss")
    t = t.replace("-", " ")
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


if __name__ == "__main__":
    import sys
    print(normalize(sys.stdin.read()))
