from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
from embedding_model import create_query_embedding
from pinecone_search import search_pinecone

from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification
)

import torch
import os

# -------------------------------
# LOAD ENV VARIABLES
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
# CHAT MEMORY
# -------------------------------

chat_history = []

# -------------------------------
# RAG CONFIG
# -------------------------------

# Initial Pinecone retrieval
INITIAL_RETRIEVAL_COUNT = 20

# Final chunks after reranking
FINAL_TOP_K = 5

# -------------------------------
# LOAD RERANKER MODEL
# -------------------------------

print("\nLoading BGE Reranker Model...\n")

reranker_tokenizer = AutoTokenizer.from_pretrained(
    "BAAI/bge-reranker-base"
)

reranker_model = AutoModelForSequenceClassification.from_pretrained(
    "BAAI/bge-reranker-base"
)

reranker_model.eval()

print("\nBGE Reranker Loaded Successfully!\n")

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
# CHAT ROUTE
# -------------------------------

@app.route("/chat", methods=["POST"])
def chat():

    global chat_history

    try:

        # -------------------------------
        # GET USER INPUT
        # -------------------------------

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

        # -------------------------------
        # PRINT USER QUERY
        # -------------------------------

        print("\n========== USER QUERY ==========\n")
        print(user_input)

        # -------------------------------
        # CREATE QUERY EMBEDDING
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

        matches = results.get("matches", [])

        # -------------------------------
        # CHECK MATCHES
        # -------------------------------

        if len(matches) == 0:

            return jsonify({
                "reply": "I could not find relevant information in the VSoft Consulting knowledge base."
            })

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

            pinecone_score = chunk_data["pinecone_score"]
            rerank_score = chunk_data["rerank_score"]
            chunk_text = chunk_data["text"]

            print(f"\nChunk Rank: {idx}")
            print(f"Pinecone Score: {pinecone_score}")
            print(f"Rerank Score: {rerank_score}")
            print(f"Chunk: {chunk_text}")

            context += chunk_text + "\n\n"

        # -------------------------------
        # SAVE USER MESSAGE
        # -------------------------------

        chat_history.append({
            "role": "user",
            "content": user_input
        })

        # -------------------------------
        # LIMIT MEMORY
        # -------------------------------

        chat_history = chat_history[-10:]

        # -------------------------------
        # SYSTEM PROMPT
        # -------------------------------

        system_prompt = f"""
You are Intern Bot for VSoft Consulting.

Use the provided context to answer the user's question.

Guidelines:
- Answer naturally and professionally.
- Use the context as the primary source.
- If partial information exists, provide the closest helpful answer.
- Keep answers concise and clear.
- Do not make up fake company information.
- If the question is completely unrelated to VSoft Consulting, politely say you can only answer VSoft-related questions.

Context:
{context}
"""

        # -------------------------------
        # BUILD MESSAGES
        # -------------------------------

        messages = [
            {
                "role": "system",
                "content": system_prompt
            }
        ] + chat_history

        # -------------------------------
        # GENERATE RESPONSE
        # -------------------------------

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.5,
            top_p=0.9
        )

        reply = response.choices[0].message.content

        # -------------------------------
        # SAVE ASSISTANT RESPONSE
        # -------------------------------

        chat_history.append({
            "role": "assistant",
            "content": reply
        })

        # -------------------------------
        # LIMIT MEMORY AGAIN
        # -------------------------------

        chat_history = chat_history[-10:]

        # -------------------------------
        # RETURN RESPONSE
        # -------------------------------

        return jsonify({
            "reply": reply
        })

    except Exception as e:

        print("\n========== ERROR ==========\n")
        print(str(e))

        return jsonify({
            "error": str(e)
        }), 500

# -------------------------------
# CLEAR CHAT MEMORY
# -------------------------------

@app.route("/clear", methods=["POST"])
def clear_chat():

    global chat_history

    chat_history = []

    return jsonify({
        "message": "Chat cleared successfully"
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