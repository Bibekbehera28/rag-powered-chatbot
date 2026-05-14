from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
from embedding_model import create_query_embedding
from pinecone_search import search_pinecone
from transformers import (AutoTokenizer,AutoModelForSequenceClassification)
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationBufferMemory
import torch
import os

# -------------------------------
# LOAD ENV
# -------------------------------

load_dotenv()

# -------------------------------
# FLASK APP
# -------------------------------

app = Flask(__name__)
CORS(app)

# -------------------------------
# GROQ CLIENT
# -------------------------------

api_key = os.getenv("GROQ_API_KEY")
client = Groq(api_key=api_key)

# -------------------------------
# LANGCHAIN MEMORY
# -------------------------------

memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True
)

# -------------------------------
# RAG CONFIG
# -------------------------------

INITIAL_RETRIEVAL_COUNT = 5
FINAL_TOP_K = 5

# -------------------------------
# LOAD RERANKER
# -------------------------------

print("\nLoading BGE Reranker...\n")
reranker_tokenizer = AutoTokenizer.from_pretrained(
    "BAAI/bge-reranker-base"
)
reranker_model = AutoModelForSequenceClassification.from_pretrained(
    "BAAI/bge-reranker-base"
)
reranker_model.eval()
print("\nBGE Reranker Loaded!\n")

# -------------------------------
# PROMPT TEMPLATE
# -------------------------------

prompt_template = PromptTemplate(
    input_variables=[
        "context",
        "question",
        "chat_history"
    ],

    template="""
You are Bot for VSoft Consulting.

Use the provided context to answer the user's question.

Guidelines:
- Answer naturally and professionally.
- Use the context as the primary source.
- If partial information exists, provide the closest helpful answer.
- Keep answers concise and clear.
- Do not make up fake company information.
- If the question is unrelated to VSoft Consulting,
  politely say you only answer VSoft-related questions.

Chat History:
{chat_history}

Context:
{context}

Question:
{question}

Answer:
"""
)

# -------------------------------
# RERANK FUNCTION
# -------------------------------

def rerank_chunks(query, matches):
    pairs = []
    for match in matches:
        chunk = match["metadata"]["text"]
        pairs.append([query, chunk])
    with torch.no_grad():
        inputs = reranker_tokenizer(
            pairs,
            padding=True,
            truncation=True,
            return_tensors="pt",
            max_length=512
        )
        scores = reranker_model(
            **inputs
        ).logits.view(-1).float()
    reranked_results = []
    for score, match in zip(scores, matches):
        reranked_results.append({
            "rerank_score": score.item(),
            "pinecone_score": match["score"],
            "text": match["metadata"]["text"]
        })
    reranked_results = sorted(
        reranked_results,
        key=lambda x: x["rerank_score"],
        reverse=True
    )
    return reranked_results[:FINAL_TOP_K]

# -------------------------------
# SHARED RAG CHAT PIPELINE
# -------------------------------
# Used by both /chat (typed text) and /voice (Groq Whisper transcript)
# so LangChain memory, Pinecone, reranker, and Groq completion stay identical.

def process_user_message(user_input):

    """
    Run embedding → Pinecone → rerank → prompt → Groq → memory.

    Returns:
        tuple: (response_dict, http_status) where response_dict is
        {"reply": str} on success or {"error": str} on failure.
    """

    try:
        print("\n========== USER QUERY ==========\n")
        print(user_input)

        # -------------------------------
        # CREATE EMBEDDING
        # -------------------------------

        query_embedding = create_query_embedding(
            user_input
        )

        # -------------------------------
        # SEARCH PINECONE
        # -------------------------------

        results = search_pinecone(
            query_embedding,
            top_k=INITIAL_RETRIEVAL_COUNT
        )

        matches = results.get(
            "matches",
            []
        )

        if len(matches) == 0:
            reply = (
                "I could not find relevant information in the "
                "VSoft Consulting knowledge base."
            )
            return (
                {"reply": reply},
                200
            )

        # -------------------------------
        # RERANK CHUNKS
        # -------------------------------

        reranked_chunks = rerank_chunks(
            user_input,
            matches
        )

        # -------------------------------
        # BUILD CONTEXT
        # -------------------------------

        context = ""
        print("\n========== RERANKED CHUNKS ==========\n")
        for idx, chunk_data in enumerate(
            reranked_chunks,
            start=1
        ):
            print(f"\nChunk Rank: {idx}")
            print(
                f"Pinecone Score: {chunk_data['pinecone_score']}"
            )
            print(
                f"Rerank Score: {chunk_data['rerank_score']}"
            )
            print(
                f"Chunk: {chunk_data['text']}"
            )
            context += chunk_data["text"] + "\n\n"

        # -------------------------------
        # LOAD MEMORY
        # -------------------------------

        memory_variables = memory.load_memory_variables({})
        chat_history = memory_variables.get(
            "chat_history",
            []
        )

        # -------------------------------
        # FORMAT PROMPT
        # -------------------------------

        final_prompt = prompt_template.format(
            context=context,
            question=user_input,
            chat_history=chat_history
        )

        # -------------------------------
        # GENERATE RESPONSE
        # -------------------------------

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": final_prompt
                }
            ],
            temperature=0.5,
            top_p=0.9
        )
        reply = response.choices[0].message.content

        # -------------------------------
        # SAVE MEMORY
        # -------------------------------

        memory.save_context(
            {"input": user_input},
            {"output": reply}
        )
        return (
            {"reply": reply},
            200
        )

    except Exception as e:
        print("\n========== ERROR ==========\n")
        print(str(e))
        return (
            {"error": str(e)},
            500
        )

# -------------------------------
# VOICE HANDLER (shared by /voice and multipart /chat)
# -------------------------------
# Groq Whisper transcription, then process_user_message (same RAG as typed text).


def _groq_transcription_filename(raw_bytes, file_storage):
    """
    Groq decodes using the multipart filename extension. Browsers sometimes
    label blobs incorrectly (e.g. .webm for Matroska-ish MP4). Sniff magic
    bytes so we always send a name that matches the payload.
    """
    if len(raw_bytes) >= 4 and raw_bytes[:4] == b"\x1a\x45\xdf\xa3":
        return "recording.webm"

    if len(raw_bytes) >= 12 and raw_bytes[4:8] == b"ftyp":
        return "recording.m4a"

    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        return "recording.wav"

    if len(raw_bytes) >= 4 and raw_bytes[:4] == b"OggS":
        return "recording.ogg"

    name = (getattr(file_storage, "filename", None) or "").strip()
    if name and "." in name and ".." not in name.replace("\\", "/"):
        base = name.replace("\\", "/").split("/")[-1]
        if base and ".." not in base:
            return base[-200:]

    ct = (getattr(file_storage, "mimetype", None) or "").lower()

    if "webm" in ct:
        return "recording.webm"

    if "mp4" in ct or "m4a" in ct or "aac" in ct:
        return "recording.m4a"

    if "wav" in ct:
        return "recording.wav"

    if "ogg" in ct:
        return "recording.ogg"
    return "recording.webm"


def handle_voice_request():
    try:

        if "audio" not in request.files:
            return jsonify({
                "error": "No audio file provided (expected form field 'audio')."
            }), 400

        audio_part = request.files["audio"]
        if not audio_part or audio_part.filename == "":

            return jsonify({
                "error": "Empty audio upload."
            }), 400

        raw_bytes = audio_part.read()
        if not raw_bytes:

            return jsonify({
                "error": "Empty audio data."
            }), 400
        upload_name = _groq_transcription_filename(raw_bytes, audio_part)

        # Tuple (filename, bytes) ensures Content-Disposition includes a name;
        # BytesIO alone often omits it and Groq returns "invalid media file".
        transcription = client.audio.transcriptions.create(
            file=(upload_name, raw_bytes),
            model="whisper-large-v3-turbo",
        )

        transcript = (getattr(transcription, "text", None) or "").strip()
        if not transcript:
            return jsonify({
                "error": "Transcription was empty; try speaking closer to the mic."
            }), 400
        body, status = process_user_message(transcript)
        if status != 200 or "error" in body:
            return jsonify(body), status

        # Echo transcript so the UI can render the user turn without a second request.
        body["transcript"] = transcript
        return jsonify(body), status

    except Exception as e:
        print("\n========== VOICE ERROR ==========\n")
        print(str(e))
        return jsonify({
            "error": str(e)
        }), 500

# -------------------------------
# CHAT ROUTE (JSON text OR multipart voice on same URL)
# -------------------------------
# Typed messages: Content-Type application/json, body {"message": "..."}.
# Voice from browser: multipart/form-data with field "audio" — avoids 404 if /voice is
# missing on an older server instance; same handler as POST /voice.

@app.route("/chat", methods=["POST"])
def chat():
    content_type = (request.content_type or "").lower()
    if (
        "multipart/form-data" in content_type
        and "audio" in request.files
    ):
        return handle_voice_request()
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "error": "Invalid JSON"
            }), 400
        user_input = data.get(
            "message",
            ""
        ).strip()
        if not user_input:
            return jsonify({
                "error": "No message provided"
            }), 400
        body, status = process_user_message(user_input)
        return jsonify(body), status

    except Exception as e:
        print("\n========== ERROR ==========\n")
        print(str(e))
        return jsonify({
            "error": str(e)
        }), 500

# -------------------------------
# VOICE ROUTE (alias → same handler as multipart /chat)
# -------------------------------

@app.route("/voice", methods=["POST"])
def voice():
    return handle_voice_request()

# -------------------------------
# CLEAR MEMORY
# -------------------------------

@app.route("/clear", methods=["POST"])
def clear_chat():
    global memory
    memory = ConversationBufferMemory(
        memory_key="chat_history",
        return_messages=True
    )
    return jsonify({
        "message": "Chat memory cleared"
    })

# -------------------------------
# HOME ROUTE
# -------------------------------

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Intern Bot API Running"
    })

# -------------------------------
# RUN SERVER
# -------------------------------

if __name__ == "__main__":
    port = int(
        os.environ.get("PORT", 5000)
    )
    app.run(
        host="0.0.0.0",
        port=port,
        debug=True
    )