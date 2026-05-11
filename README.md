# RAG Powered Chatbot

A Retrieval-Augmented Generation (RAG) chatbot built using:

- Flask
- Groq LLM API
- Pinecone Vector Database
- Sentence Transformers
- Custom Web Scraping Pipeline

This project scrapes website data, converts it into embeddings, stores vectors in Pinecone, and retrieves relevant context for AI-powered question answering.

---

# 🚀 Features

## ✅ RAG Pipeline
- Website scraping
- Data cleaning
- Text chunking
- Embedding generation
- Semantic retrieval
- Pinecone vector storage

## ✅ AI Chatbot
- Flask backend API
- Groq LLM integration
- Pinecone semantic search
- Memory-based conversations
- Context-aware responses

## ✅ Frontend
- Responsive chat UI
- Typing animation
- Markdown formatting
- Code block rendering
- Chat clearing support

---

# 📂 Project Structure

```text
rag-powered-chatbot/
├── README.md
├── requirements.txt
│
├── index.html
├── script.js
├── style.css
│
├── backend/
│   ├── .env
│   ├── .gitignore
│   ├── app.py
│   ├── embedding_model.py
│   └── pinecone_search.py
│
└── rag_learning/
    ├── .env
    ├── chunker.py
    ├── cleaner.py
    ├── crawler.py
    ├── embeddings.py
    ├── main.py
    ├── pinecone_db.py
    ├── retrieval.py
    ├── scraper.py
    ├── search_pinecone.py
    ├── store_vectors.py
    ├── urls.py
    │
    └── testing_files/
        ├── test_crawler.py
        └── test_pinecone.py
```

---

# ⚙️ Installation

## 1️⃣ Clone Repository

```bash
git clone https://github.com/your-username/rag-powered-chatbot.git

cd rag-powered-chatbot
```

---

## 2️⃣ Create Virtual Environment

### Windows

```bash
python -m venv venv

venv\Scripts\activate
```

### Mac/Linux

```bash
python3 -m venv venv

source venv/bin/activate
```

---

## 3️⃣ Install Dependencies

```bash
pip install -r requirements.txt
```

---

# 🔑 Environment Variables

Create `.env` files inside:

```text
backend/.env
rag_learning/.env
```

Add:

```env
GROQ_API_KEY=your_groq_api_key
PINECONE_API_KEY=your_pinecone_api_key
```

---

# 🧠 Pinecone Setup

## Create Index

Create a Pinecone index with:

| Setting | Value |
|---|---|
| Dimension | 384 |
| Metric | cosine |
| Cloud | AWS |
| Region | us-east-1 |

Index name:

```text
vsoft-rag
```

---

# 🔥 RAG Pipeline Workflow

```text
Website → Clean → Chunk → Embed → Pinecone → Retrieve → LLM Response
```

---

# 📥 Store Vectors in Pinecone

Navigate to:

```bash
cd rag_learning
```

Run:

```bash
python store_vectors.py
```

This will:

- scrape URLs
- create embeddings
- upload vectors to Pinecone

---

# 🔍 Test Pinecone Retrieval

```bash
python search_pinecone.py
```

---

# 🤖 Run Chatbot Backend

Navigate to:

```bash
cd backend
```

Run:

```bash
python app.py
```

Backend runs at:

```text
http://localhost:5000
```

---

# 🌐 Run Frontend

Simply open:

```text
index.html
```

in your browser.

---

# 🧠 How the Chatbot Works

## Step 1 — User Sends Question

Example:

```text
What AI services does V-Soft provide?
```

---

## Step 2 — Query Embedding

The query is converted into a vector embedding using Sentence Transformers.

---

## Step 3 — Pinecone Search

Pinecone retrieves semantically similar chunks.

---

## Step 4 — Relevance Check

If similarity score is high:

- chatbot uses Pinecone knowledge base

If similarity score is low:

- chatbot uses general LLM knowledge

---

## Step 5 — Groq LLM Response

Relevant chunks + user question are sent to Groq for final response generation.

---

# 📌 Technologies Used

- Python
- Flask
- Groq API
- Pinecone
- Sentence Transformers
- BeautifulSoup
- LangChain Text Splitter
- JavaScript
- HTML/CSS

---

# 🔐 Security Notes

Never expose:

- Groq API keys
- Pinecone API keys

Frontend should NEVER directly access APIs.

---

# 🚀 Future Improvements

- Multi-user chat memory
- Streaming responses
- Metadata filtering
- Hybrid search
- Reranking
- LangChain integration
- PDF ingestion
- Authentication
- Deployment pipeline

---

# 📜 License

This project is for learning and educational purposes.

---

# 👨‍💻 Author

Built as a hands-on RAG engineering and AI chatbot project.