from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
from embedding_model import create_query_embedding
from pinecone_search import search_pinecone
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
# GROQ SETUP
# -------------------------------

api_key = os.getenv("GROQ_API_KEY")
client = Groq(api_key=api_key)

# -------------------------------
# CHAT MEMORY
# -------------------------------

chat_history = []

# -------------------------------
# CHAT ROUTE
# -------------------------------

@app.route("/chat", methods=["POST"])
def chat():
    global chat_history

    try:
        data = request.json
        user_input = data.get("message")

        if not user_input:
            return jsonify({"error": "No message provided"}), 400

        print("\n========== USER QUESTION ==========\n")
        print(user_input)

        # -------------------------------
        # CREATE QUERY EMBEDDING
        # -------------------------------

        query_embedding = create_query_embedding(user_input)

        # -------------------------------
        # SEARCH PINECONE
        # -------------------------------

        results = search_pinecone(query_embedding)

        # -------------------------------
        # GET TOP SCORE
        # -------------------------------

        top_score = results["matches"][0]["score"]

        print("\n========== TOP SCORE ==========\n")
        print(top_score)

        # -------------------------------
        # BUILD CONTEXT
        # -------------------------------

        context = ""
        THRESHOLD = 0.65

        if top_score >= THRESHOLD:
            print("\nUsing Pinecone Knowledge Base\n")
            for match in results["matches"]:
                chunk = match["metadata"]["text"]
                score = match["score"]

                print("\n--- MATCH ---")
                print("Score:", score)
                print("Chunk:", chunk)

                context += chunk + "\n"
        else:
            print("\nUsing General LLM Knowledge\n")

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
        # BUILD PROMPT
        # -------------------------------

        messages = [
            {
                "role": "system",
                "content": f"""
You are Intern Bot.

Use the provided context ONLY if it is relevant.

Context:
{context}

If the context is not useful, answer normally.
"""
            }
        ] + chat_history

        # -------------------------------
        # GENERATE RESPONSE
        # -------------------------------

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.7,
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
        "message": "Chat cleared"
    })

# -------------------------------
# RUN SERVER
# -------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
