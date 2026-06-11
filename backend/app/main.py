from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
from app.database import init_db, get_connection
from app.schemas import ChatRequest, AssistantResponse
from pypdf import PdfReader
import hashlib
from groq import Groq
from dotenv import load_dotenv
import uuid
import os
load_dotenv()

app = FastAPI(title="Resume Assistant API")
client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)


@app.on_event("startup")
async def startup_event():
    init_db()


# --- CORS Configuration ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- In-Memory Store ---
session_memory: Dict[str, dict] = {}


# --- Helpers ---
def extract_pdf_text(file_path: str) -> str:
    reader = PdfReader(file_path)

    text = ""

    for i, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""

        print(f"Page {i + 1}: {len(page_text)} chars")

        text += page_text + "\n"

    return text


# --- Endpoints ---
@app.get("/health")
async def health_check():
    return {
        "ok": True,
        "message": "Backend is alive!"
    }


@app.post("/upload")
async def upload_resume(file: UploadFile = File(...)):

    if not file.filename.endswith((".pdf", ".txt")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type"
        )

    contents = await file.read()

    file_hash = hashlib.sha256(contents).hexdigest()

    conn = get_connection()
    cur = conn.cursor()

    # Check for duplicate resume
    cur.execute(
        """
        SELECT id, filename
        FROM resumes
        WHERE file_hash = ?
        """,
        (file_hash,)
    )

    existing = cur.fetchone()

    if existing:

        cur.execute(
            """
            SELECT filename, filepath, extracted_text
            FROM resumes
            WHERE id = ?
            """,
            (existing["id"],)
        )

        resume_row = cur.fetchone()

        if resume_row:
            session_memory[existing["id"]] = {
                "filename": resume_row["filename"],
                "filepath": resume_row["filepath"],
                "resume_text": resume_row["extracted_text"],
            }

        conn.close()

        print(f"♻ Duplicate resume detected: {existing['filename']}")

        return {
            "session_id": existing["id"]
        }

    # ---------- New Resume ----------

    session_id = str(uuid.uuid4())

    os.makedirs("uploads", exist_ok=True)

    file_ext = file.filename.split(".")[-1].lower()
    file_path = f"uploads/{session_id}.{file_ext}"

    with open(file_path, "wb") as f:
        f.write(contents)

    # Extract text
    if file_ext == "pdf":
        resume_text = extract_pdf_text(file_path)
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            resume_text = f.read()

    # Insert into DB
    cur.execute(
        """
        INSERT INTO resumes(
            id,
            filename,
            filepath,
            file_hash,
            extracted_text
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            session_id,
            file.filename,
            file_path,
            file_hash,
            resume_text
        )
    )

    conn.commit()
    conn.close()

    session_memory[session_id] = {
        "filename": file.filename,
        "filepath": file_path,
        "resume_text": resume_text,
    }

    print(f"\n✅ Uploaded {file.filename}")
    print(f"Session ID: {session_id}")
    print(f"TOTAL CHARS: {len(resume_text)}")
    print("=====================================\n")

    return {
        "session_id": session_id
    }


@app.post("/chat", response_model=AssistantResponse)
async def chat_with_resume(request: ChatRequest):

    # Reload from DB if missing from memory
    if request.session_id not in session_memory:

        conn = get_connection()
        cur = conn.cursor()

        cur.execute(
            """
            SELECT filename, filepath, extracted_text
            FROM resumes
            WHERE id = ?
            """,
            (request.session_id,)
        )

        row = cur.fetchone()

        conn.close()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="Session not found."
            )

        session_memory[request.session_id] = {
            "filename": row["filename"],
            "filepath": row["filepath"],
            "resume_text": row["extracted_text"],
        }

    resume_text = session_memory[
        request.session_id
    ]["resume_text"]

    conn = get_connection()
    cur = conn.cursor()

    # Save user message
    cur.execute(
        """
        INSERT INTO messages(session_id, role, content)
        VALUES (?, ?, ?)
        """,
        (
            request.session_id,
            "user",
            request.query
        )
    )

    conn.commit()

    # Get recent history
    cur.execute(
        """
        SELECT role, content
        FROM messages
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT 10
        """,
        (request.session_id,)
    )

    history = cur.fetchall()

    messages = [
        {
            "role": "system",
            "content": f"""
You are a professional resume assistant.

Resume:

{resume_text}

Rules:
- Answer ONLY using information present in the resume.
- Do not hallucinate.
- If information is missing, say:
  'This information is not present in the resume.'
- Keep answers concise and factual.
"""
        }
    ]

    for msg in reversed(history):
        messages.append(
            {
                "role": msg["role"],
                "content": msg["content"]
            }
        )

    try:

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            messages=messages
        )

        answer = response.choices[0].message.content

        # Save assistant reply
        cur.execute(
            """
            INSERT INTO messages(session_id, role, content)
            VALUES (?, ?, ?)
            """,
            (
                request.session_id,
                "assistant",
                answer
            )
        )

        conn.commit()
        conn.close()

        return AssistantResponse(
            answer=answer,
            confidence=0.95,
            source="resume",
            missing_data=[]
        )

    except Exception as e:

        conn.close()

        print("Groq Error:", e)

        return AssistantResponse(
            answer="The AI service is temporarily unavailable.",
            confidence=0.0,
            source="system",
            missing_data=[]
        )

@app.get("/history/{session_id}")
async def get_history(session_id: str):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT role, content, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY id ASC
        """,
        (session_id,)
    )

    messages = [dict(row) for row in cur.fetchall()]

    conn.close()

    return {
        "session_id": session_id,
        "messages": messages
    }


@app.get("/history/{session_id}")
async def get_history(session_id: str):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT role, content, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY id ASC
        """,
        (session_id,)
    )

    messages = [dict(row) for row in cur.fetchall()]

    conn.close()

    return {
        "session_id": session_id,
        "messages": messages
    }