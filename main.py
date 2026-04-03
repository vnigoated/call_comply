import os
import base64
import json
import logging
from importlib import metadata
from pathlib import Path
import time
from typing import Literal
from collections import Counter
import re
import requests
from fastapi import FastAPI, HTTPException, Header, Depends, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, ConfigDict
from groq import Groq
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from vector_store import TranscriptVectorStore

load_dotenv()

app = FastAPI(title="Call Center Compliance API")
logger = logging.getLogger("call_center_compliance")
logging.basicConfig(level=logging.INFO)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    started_at = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
    logger.info("%s %s completed in %.2f ms", request.method, request.url.path, elapsed_ms)
    return response

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY   = os.getenv("GROQ_API_KEY")
API_SECRET_KEY = os.getenv("API_SECRET_KEY", "sk_track3_987654321")
STT_PROVIDER = os.getenv("STT_PROVIDER", "assemblyai").lower()
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
VECTOR_DB_PATH = os.getenv("VECTOR_DB_PATH", str(Path("data") / "transcripts.db"))
_groq_client = None
_http_session = None
vector_store = TranscriptVectorStore(VECTOR_DB_PATH)


def get_http_session():
    global _http_session
    if _http_session is not None:
        return _http_session

    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    _http_session = session
    return _http_session


def get_groq_client():
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not set")
    try:
        _groq_client = Groq(api_key=GROQ_API_KEY)
    except TypeError as e:
        # Provide a clearer error message when the Groq SDK is incompatible
        try:
            groq_version = metadata.version("groq")
        except Exception:
            groq_version = "unknown"

        msg = (
            "Failed to initialize Groq client: %s.\n"
            "This often indicates an incompatible or outdated 'groq' Python package.\n"
            "Try upgrading or reinstalling the SDK, e.g. 'pip install --upgrade groq',\n"
            "or pin to a known working version in requirements.txt.\n"
            "If the problem persists, inspect installed packages and their versions."
        ) % str(e)
        msg = msg + f" Installed groq version: {groq_version}."
        raise RuntimeError(msg) from e
    return _groq_client


# ── Request / Response models ─────────────────────────────────────────────────
class AnalyticsRequest(BaseModel):
    language: Literal["Tamil", "Hindi"]
    audioFormat: Literal["mp3"]
    audioBase64: str = Field(min_length=16)

    @field_validator("audioBase64")
    @classmethod
    def validate_audio_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except Exception as exc:
            raise ValueError("audioBase64 must be valid base64-encoded audio data") from exc
        return value


class SopValidation(BaseModel):
    greeting: bool
    identification: bool
    problemStatement: bool
    solutionOffering: bool
    closing: bool
    complianceScore: float = Field(ge=0.0, le=1.0)
    adherenceStatus: Literal["FOLLOWED", "NOT_FOLLOWED"]
    explanation: str = Field(min_length=1, max_length=500)


class AnalyticsData(BaseModel):
    paymentPreference: Literal["EMI", "FULL_PAYMENT", "PARTIAL_PAYMENT", "DOWN_PAYMENT", "NONE"]
    rejectionReason: Literal["HIGH_INTEREST", "BUDGET_CONSTRAINTS", "ALREADY_PAID", "NOT_INTERESTED", "NONE"]
    sentiment: Literal["Positive", "Negative", "Neutral"]


class CallAnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["success"]
    language: Literal["Tamil", "Hindi"]
    transcript: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    sop_validation: SopValidation
    analytics: AnalyticsData
    keywords: list[str] = Field(min_length=1, max_length=12)


class VerboseCallAnalyticsResponse(CallAnalyticsResponse):
    original_transcript: str = Field(min_length=1)
    speaker_stats: dict[str, str | int | float] = Field(default_factory=dict)


class TranscriptSearchResult(BaseModel):
    transcript_id: int
    score: float
    language: Literal["Tamil", "Hindi"]
    transcript: str
    summary: str
    keywords: list[str]
    created_at: str


class TranscriptSearchResponse(BaseModel):
    query: str
    count: int
    results: list[TranscriptSearchResult]


# ── Auth ──────────────────────────────────────────────────────────────────────
def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != API_SECRET_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API key")
    return x_api_key


 


 


def transcribe_audio(audio_bytes: bytes, language: str) -> str:
    provider = STT_PROVIDER
    if provider == "assemblyai":
        return transcribe_with_assemblyai(audio_bytes, language)
    raise Exception(f"Unsupported STT_PROVIDER: {provider}. Supported: assemblyai")


 



def transcribe_with_assemblyai(audio_bytes: bytes, language: str) -> str:
    """Transcribe audio using AssemblyAI REST API.

    Workflow:
    1. Upload audio bytes to /v2/upload (returns `upload_url`).
    2. Create a transcription via /v2/transcript with requested models and language detection.
    3. Poll the transcript endpoint until `status` is `completed` or `error`.
    """
    if not ASSEMBLYAI_API_KEY:
        raise Exception("ASSEMBLYAI_API_KEY must be set to use AssemblyAI provider")

    upload_url = "https://api.assemblyai.com/v2/upload"
    transcripts_url = "https://api.assemblyai.com/v2/transcript"
    headers = {"authorization": ASSEMBLYAI_API_KEY}
    session = get_http_session()

    # 1) Upload
    resp = session.post(upload_url, headers=headers, data=audio_bytes, timeout=120)
    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        raise Exception(f"AssemblyAI upload error {resp.status_code}: {resp.text}") from e

    j = resp.json()
    audio_url = j.get("upload_url") or j.get("url")
    if not audio_url:
        raise Exception(f"AssemblyAI upload did not return upload_url: {j}")

    # 2) Create transcript request
    # Use preferred models: try universal-3-pro first, fallback to universal-2 automatically
    payload = {
        "audio_url": audio_url,
        "speech_models": ["universal-3-pro", "universal-2"],
        "language_detection": True,
    }
    r2 = session.post(
        transcripts_url,
        headers={**headers, "content-type": "application/json"},
        json=payload,
        timeout=30,
    )
    try:
        r2.raise_for_status()
    except requests.HTTPError as e:
        raise Exception(f"AssemblyAI transcript create error {r2.status_code}: {r2.text}") from e

    tr = r2.json()
    transcript_id = tr.get("id")
    if not transcript_id:
        raise Exception(f"AssemblyAI did not return transcript id: {tr}")

    # 3) Poll for completion
    status_url = f"{transcripts_url}/{transcript_id}"
    import time
    for _ in range(0, 120):  # poll up to ~120 * 1s = 2 minutes
        r = session.get(status_url, headers=headers, timeout=30)
        try:
            r.raise_for_status()
        except requests.HTTPError as e:
            raise Exception(f"AssemblyAI transcript status error {r.status_code}: {r.text}") from e
        body = r.json()
        status = body.get("status")
        if status == "completed":
            return body.get("text", "")
        if status == "error":
            raise Exception(f"AssemblyAI transcription failed: {body.get('error')} | {body}")
        time.sleep(1)

    raise Exception("AssemblyAI transcription timed out")


# ── Step 2: Full NLP analysis via Groq ───────────────────────────────────────
ANALYSIS_PROMPT = """You are a strict call center compliance analyst for an Indian EdTech/collections company.

Analyze the transcript below and return ONLY a valid JSON object — no markdown, no explanation.

SOP steps the agent MUST follow IN ORDER:
1. Greeting      — Agent greets the customer
2. Identification — Agent identifies the customer by name, loan number, DOB, or account
3. Problem Statement — Agent clearly states the purpose (outstanding payment, course inquiry, etc.)
4. Solution Offering — Agent offers payment options, EMI, course details, next steps
5. Closing       — Agent thanks customer, confirms next steps, ends call politely

Return this exact JSON structure:
{
  "summary": "<3-5 sentence English summary of the full conversation>",
  "sop_validation": {
    "greeting": <true/false>,
    "identification": <true/false>,
    "problemStatement": <true/false>,
    "solutionOffering": <true/false>,
    "closing": <true/false>,
    "complianceScore": <float 0.0-1.0, ratio of steps followed>,
    "adherenceStatus": "<FOLLOWED if all 5 true, else NOT_FOLLOWED>",
    "explanation": "<one sentence explaining what was missing or why status was set>"
  },
  "analytics": {
    "paymentPreference": "<EMI | FULL_PAYMENT | PARTIAL_PAYMENT | DOWN_PAYMENT | NONE>",
    "rejectionReason": "<HIGH_INTEREST | BUDGET_CONSTRAINTS | ALREADY_PAID | NOT_INTERESTED | NONE>",
    "sentiment": "<Positive | Negative | Neutral>"
  },
  "keywords": ["<keyword1>", "<keyword2>", "...", "<up to 12 keywords from the transcript>"]
}

Rules:
- complianceScore = (number of true steps) / 5.0
- adherenceStatus = "FOLLOWED" only if ALL 5 steps are true, else "NOT_FOLLOWED"
- paymentPreference: choose NONE only if no payment is discussed at all
- rejectionReason: choose NONE if customer agreed or payment was completed
- keywords must appear in or be directly traceable to the transcript
- Do NOT hardcode or invent values — derive everything from the transcript

Transcript:
{transcript}
"""

def analyze_with_groq(transcript: str, language: str) -> dict:
    prompt = ANALYSIS_PROMPT.replace("{transcript}", transcript)
    client = get_groq_client()
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=1500,
    )

    raw = response.choices[0].message.content
    return json.loads(raw)


COMMON_ENGLISH_WORDS = {
    "the", "is", "are", "hello", "yes", "no", "payment", "course", "fee",
    "resume", "okay", "thank", "you", "customer", "agent", "from", "for",
    "can", "today", "month", "speak", "speaking", "call", "called", "talk",
}

SPEAKER_LABEL_ALIASES = {
    "agent": "Agent",
    "representative": "Agent",
    "rep": "Agent",
    "executive": "Agent",
    "advisor": "Agent",
    "counselor": "Agent",
    "customer": "Customer",
    "caller": "Customer",
    "client": "Customer",
    "prospect": "Customer",
    "student": "Customer",
    "lead": "Customer",
    "speaker 1": "Agent",
    "speaker 2": "Customer",
}


def clean_turn_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"\s+([?.!,])", r"\1", text)
    return text


def normalize_speaker_transcript(text: str) -> tuple[str, dict[str, str | int | float]]:
    if not text or not text.strip():
        return "", {}

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(
        r"(?<!\n)\s+(Agent|Customer|Caller|Client|Representative|Rep|Executive|Advisor|Counselor|Student|Lead)\s*:\s*",
        lambda match: f"\n{match.group(1)}: ",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()

    turns: list[tuple[str | None, str]] = []
    current_speaker: str | None = None
    has_explicit_speaker_labels = False

    for raw_line in normalized.split("\n"):
        line = raw_line.strip(" -\t")
        if not line:
            continue

        match = re.match(
            r"^(Agent|Customer|Caller|Client|Representative|Rep|Executive|Advisor|Counselor|Student|Lead|Speaker\s*\d+)\s*[:\-]\s*(.*)$",
            line,
            flags=re.IGNORECASE,
        )
        if match:
            speaker_key = re.sub(r"\s+", " ", match.group(1).lower()).strip()
            speaker = SPEAKER_LABEL_ALIASES.get(speaker_key, match.group(1).title())
            text_part = clean_turn_text(match.group(2))
            if text_part:
                turns.append((speaker, text_part))
                current_speaker = speaker
                has_explicit_speaker_labels = True
            continue

        cleaned_line = clean_turn_text(line)
        if not cleaned_line:
            continue

        if has_explicit_speaker_labels:
            # When explicit speaker turns are present later in the transcript,
            # unlabeled narrative paragraphs are usually translation drift or summary-like text.
            # Skip them so the final transcript stays dialogue-focused.
            continue

        if turns and current_speaker:
            previous_speaker, previous_text = turns[-1]
            turns[-1] = (previous_speaker, clean_turn_text(f"{previous_text} {cleaned_line}"))
        else:
            turns.append((None, cleaned_line))

    labeled_turns = [(speaker, value) for speaker, value in turns if speaker]
    cleaned_transcript = "\n".join(
        f"{speaker}: {value}" if speaker else value
        for speaker, value in turns
    ).strip()

    if not labeled_turns:
        return cleaned_transcript, {
            "turnCount": len(turns),
            "speakerMode": "unlabeled",
            "dominantSpeaker": "Unknown",
        }

    counts = Counter(speaker for speaker, _ in labeled_turns)
    total_turns = sum(counts.values()) or 1
    agent_turns = counts.get("Agent", 0)
    customer_turns = counts.get("Customer", 0)
    dominant_speaker = "Agent" if agent_turns >= customer_turns else "Customer"

    return cleaned_transcript, {
        "turnCount": total_turns,
        "speakerMode": "labeled",
        "agentTurns": agent_turns,
        "customerTurns": customer_turns,
        "agentShare": round(agent_turns / total_turns, 2),
        "customerShare": round(customer_turns / total_turns, 2),
        "dominantSpeaker": dominant_speaker,
    }


def should_translate_transcript(text: str, source_language: str) -> bool:
    """Translate only when the STT output does not already look English-ish.

    AssemblyAI can sometimes return English or romanized text for Tanglish/Hinglish.
    Running an extra translation pass over that text can degrade it noticeably,
    so we use a lightweight heuristic before sending it to the LLM again.
    """
    if not text or not text.strip():
        return False

    if source_language.lower() in ("en", "english"):
        return False

    non_ascii_count = sum(1 for char in text if ord(char) > 127)
    if non_ascii_count >= max(8, len(text) // 20):
        return True

    tokens = re.findall(r"[a-zA-Z]+", text.lower())
    if not tokens:
        return True

    english_hits = sum(1 for token in tokens if token in COMMON_ENGLISH_WORDS)
    english_ratio = english_hits / max(1, len(tokens))
    repeated_ratio = Counter(tokens).most_common(1)[0][1] / max(1, len(tokens))

    # If it already reads like English and is not dominated by repetition,
    # keep the STT output as-is.
    if english_ratio >= 0.08 and repeated_ratio < 0.2:
        return False

    return True


def normalize_analysis(raw_analysis: dict, *, language: str, transcript: str) -> CallAnalyticsResponse:
    sop_data = raw_analysis.get("sop_validation") or {}
    sop_values = {
        key: bool(sop_data.get(key, False))
        for key in ["greeting", "identification", "problemStatement", "solutionOffering", "closing"]
    }
    true_steps = sum(1 for value in sop_values.values() if value)
    compliance_score = round(true_steps / 5.0, 2)
    adherence_status = "FOLLOWED" if true_steps == 5 else "NOT_FOLLOWED"
    explanation = str(sop_data.get("explanation") or "").strip()
    if not explanation:
        explanation = (
            "All required stages were present."
            if adherence_status == "FOLLOWED"
            else "One or more SOP stages were missing in the call."
        )

    analytics_data = raw_analysis.get("analytics") or {}
    keywords = []
    for keyword in raw_analysis.get("keywords") or []:
        keyword_text = str(keyword).strip()
        if keyword_text and keyword_text not in keywords:
            keywords.append(keyword_text)
    if not keywords:
        keywords = ["call"]

    return CallAnalyticsResponse(
        status="success",
        language=language,
        transcript=transcript.strip(),
        summary=str(raw_analysis.get("summary") or "").strip() or "Summary unavailable.",
        sop_validation=SopValidation(
            **sop_values,
            complianceScore=compliance_score,
            adherenceStatus=adherence_status,
            explanation=explanation,
        ),
        analytics=AnalyticsData(
            paymentPreference=analytics_data.get("paymentPreference", "NONE"),
            rejectionReason=analytics_data.get("rejectionReason", "NONE"),
            sentiment=analytics_data.get("sentiment", "Neutral"),
        ),
        keywords=keywords[:12],
    )


def translate_with_groq(text: str, source_language: str) -> str:
    """Translate `text` to English using the Groq chat model.

    This uses the existing Groq client to prompt for a plain English translation.
    Returns the translated English string.
    """
    if not text or not text.strip():
        return text
    if not should_translate_transcript(text, source_language):
        return text

    client = get_groq_client()
    prompt = (
        "Translate the following call transcript to natural English.\n"
        "Preserve speaker turns, names, numbers, money amounts, and business details exactly when present.\n"
        "Do not summarize, paraphrase away details, or invent missing content.\n"
        "Return ONLY the translated transcript text.\n\n"
        + text
    )
    try:
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=1500,
        )
        translated = resp.choices[0].message.content
        return translated.strip()
    except Exception as e:
        raise RuntimeError(f"Groq translation failed: {e}") from e


# ── Main endpoint ─────────────────────────────────────────────────────────────
def process_call_analytics(
    body: AnalyticsRequest,
    *,
    include_original: bool = False,
) -> CallAnalyticsResponse | VerboseCallAnalyticsResponse:
    try:
        audio_bytes = base64.b64decode(body.audioBase64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Base64 audio data")

    try:
        transcript = transcribe_audio(audio_bytes, body.language)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"STT failed: {str(e)}")

    if not transcript or not transcript.strip():
        raise HTTPException(status_code=422, detail="Transcription returned empty result")

    transcript, original_speaker_stats = normalize_speaker_transcript(transcript)

    try:
        translated = translate_with_groq(transcript, body.language)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Translation failed: {str(e)}")

    if not translated or not translated.strip():
        translated = transcript

    translated, translated_speaker_stats = normalize_speaker_transcript(translated)

    try:
        analysis = analyze_with_groq(translated, body.language)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"NLP analysis failed: {str(e)}")

    try:
        response_payload = normalize_analysis(
            analysis,
            language=body.language,
            transcript=translated,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Response normalization failed: {str(e)}")

    try:
        vector_store.add_transcript(
            language=response_payload.language,
            transcript=response_payload.transcript,
            summary=response_payload.summary,
            keywords=response_payload.keywords,
        )
    except Exception as exc:
        logger.warning("Vector indexing failed: %s", exc)

    if not include_original:
        return response_payload

    return VerboseCallAnalyticsResponse(
        **response_payload.model_dump(),
        original_transcript=transcript.strip(),
        speaker_stats=translated_speaker_stats or original_speaker_stats,
    )


@app.post("/api/call-analytics", response_model=CallAnalyticsResponse)
def call_analytics(
    body: AnalyticsRequest,
    api_key: str = Depends(verify_api_key),
):
    return process_call_analytics(body, include_original=False)


@app.post("/api/call-analytics/verbose", response_model=VerboseCallAnalyticsResponse)
def call_analytics_verbose(
    body: AnalyticsRequest,
    api_key: str = Depends(verify_api_key),
):
    return process_call_analytics(body, include_original=True)


@app.get("/api/transcripts/search", response_model=TranscriptSearchResponse)
def search_transcripts(
    query: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(5, ge=1, le=10),
    api_key: str = Depends(verify_api_key),
):
    results = vector_store.search(query, limit=limit)
    return TranscriptSearchResponse(
        query=query,
        count=len(results),
        results=[
            TranscriptSearchResult(
                transcript_id=item.transcript_id,
                score=round(item.score, 4),
                language=item.language,
                transcript=item.transcript,
                summary=item.summary,
                keywords=item.keywords,
                created_at=item.created_at,
            )
            for item in results
        ],
    )


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "stt_provider": STT_PROVIDER,
        "vector_store": vector_store.stats(),
    }
