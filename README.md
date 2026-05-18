# RAG Powered Chatbot — Complete Project Documentation

A production-style Retrieval-Augmented Generation (RAG) AI chatbot built using:

- Python
- Flask
- Groq LLM API
- Pinecone Vector Database
- Sentence Transformers
- Custom Web Scraping Pipeline
- HTML/CSS/JavaScript Frontend

This project demonstrates how modern AI assistants work by combining:

- Large Language Models (LLMs)
- Semantic Search
- Vector Databases
- Retrieval Pipelines
- Memory-Based Conversations

The chatbot retrieves relevant company information from a custom knowledge base and generates intelligent responses using Groq LLMs.

---

## Project Overview

This chatbot is designed to answer company-related queries using:

- Website Data
- Semantic Search
- AI Response Generation

Instead of relying only on the LLM’s training data, the chatbot first searches a custom knowledge base stored in Pinecone.

This approach is called **Retrieval-Augmented Generation (RAG)**.

---

## What is RAG?

**RAG = Retrieval + Generation**

**Traditional chatbots:**

- depend only on model training data
- may hallucinate
- cannot answer company-specific questions accurately

**RAG chatbots:**

- retrieve relevant information first
- then generate responses using retrieved context
- produce more accurate and grounded answers

---

## High-Level Workflow

```text
User Question
      ↓
Query Embedding
      ↓
Pinecone Semantic Search
      ↓
Relevant Context Retrieval
      ↓
Groq LLM Prompting
      ↓
Final AI Response
```

---

## Core Technologies Used

| Technology | Purpose |
|------------|---------|
| Flask | Backend API |
| Groq API | LLM inference |
| Pinecone | Vector database |
| Sentence Transformers | Embedding generation |
| BeautifulSoup | Website scraping |
| LangChain Text Splitter | Chunking |
| HTML/CSS/JS | Frontend UI |
| Fetch API | Frontend-backend communication |

---

## Complete Project Structure

```text
rag-powered-chatbot/
│
├── README.md
├── requirements.txt
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── assets/
│       └── logo files (e.g. VSoft-Logo.webp)
│
├── backend/
│   │
│   ├── .env
│   ├── .gitignore
│   ├── requirements.txt   # includes root requirements.txt
│   │
│   ├── app.py
│   ├── embedding_model.py
│   ├── pinecone_search.py
│   │
│   └── __pycache__/
│
├── rag_learning/
│   │
│   ├── .env
│   │
│   ├── crawler.py
│   ├── scraper.py
│   ├── cleaner.py
│   ├── chunker.py
│   ├── embeddings.py
│   ├── retrieval.py
│   ├── pinecone_db.py
│   ├── search_pinecone.py
│   ├── store_vectors.py
│   ├── urls.py
│   ├── main.py
│   │
│   └── testing_files/
│       ├── test_crawler.py
│       └── test_pinecone.py
```

---

## Detailed System Architecture

### 1. Data Collection Layer

**Purpose:** collect company website data

**Files:** `crawler.py`, `scraper.py`, `urls.py` (in `rag_learning/`)

**Workflow:**

```text
URLs → Crawl Pages → Extract HTML → Parse Content
```

**Responsibilities**

**`urls.py`**

Stores target URLs.

Example:

```python
urls = [
    "https://www.vsoftconsulting.com/",
]
```

**`crawler.py`**

Responsible for:

- visiting URLs
- traversing links
- collecting raw HTML

**`scraper.py`**

Responsible for:

- extracting visible content
- removing unnecessary HTML elements

Uses: **BeautifulSoup**

---

### 2. Data Cleaning Layer

**File:** `cleaner.py`

**Purpose:** remove noise from scraped text

**Cleaning includes:**

- removing extra spaces
- removing scripts/styles
- removing repeated content
- formatting text properly

---

### 3. Chunking Layer

**File:** `chunker.py`

**Purpose:** split large text into smaller chunks

**Why chunking is important:**

- LLM context windows are limited
- embeddings work better on smaller semantic units

Example:

```text
10000-word document
        ↓
300-word chunks
```

Uses: **LangChain `RecursiveCharacterTextSplitter`**

---

### 4. Embedding Generation Layer

**Files:** `embeddings.py`, `embedding_model.py`

**Purpose:** convert text into vectors

**Model used:** Sentence Transformers

Example model: **all-MiniLM-L6-v2**

**What are embeddings?**

Embeddings are numerical vector representations of text.

Example:

```text
"What is AI?"
↓
[0.234, -0.551, 0.991, ...]
```

Similar meanings produce similar vectors. This enables semantic search and meaning-based retrieval.

---

### 5. Vector Database Layer

**Files:** `pinecone_db.py`, `store_vectors.py`

**Purpose:** store embeddings in Pinecone

Each vector contains:

```json
{
    "id": "chunk-1",
    "values": "embedding",
    "metadata": {
        "text": "chunk"
    }
}
```

**Why Pinecone?**

Pinecone is optimized for:

- vector similarity search
- fast retrieval
- scalable AI applications

Traditional SQL databases are not suitable for semantic vector search.

---

### 6. Retrieval Layer

**Files:** `retrieval.py`, `pinecone_search.py`, `search_pinecone.py`

**Purpose:** search semantically similar chunks

**Workflow:**

```text
User Query
    ↓
Generate Query Embedding
    ↓
Search Pinecone
    ↓
Retrieve Top K Similar Chunks
```

The **backend** also loads a **BGE reranker** (`transformers` + `torch`) to rescore retrieved chunks before building the prompt, so the best context reaches the LLM.

---

### 7. LLM Generation Layer

**File:** `app.py`

**Purpose:**

- send retrieved context to Groq LLM
- generate final AI response

**Prompt flow**

```text
User Question
+
Retrieved Context
+
Conversation Memory
↓
Groq LLM
↓
Final Response
```

---

## Backend Architecture

### Flask Backend

**File:** `backend/app.py`

**Responsibilities:**

- receive frontend requests
- handle API routes
- query Pinecone
- call Groq API
- manage chat memory
- return AI responses

### API Endpoints

**Chat — `POST /chat`**

Typed message (JSON):

Request:

```json
{
  "message": "What services does VSoft provide?"
}
```

Response:

```json
{
  "reply": "VSoft provides..."
}
```

**Voice — `POST /chat` or `POST /voice`**

Multipart form with field `audio` (browser recording). The backend transcribes with Groq Whisper, then runs the same RAG pipeline as typed chat. Successful responses may include `transcript` for the UI.

**Clear chat — `POST /clear`**

**Purpose:** clear conversation memory

---

## Conversation Memory

The chatbot stores:

- previous user questions
- previous AI responses

This enables:

- context-aware conversations
- follow-up questions

Example:

```text
User: What services does VSoft provide?
AI: ...
User: What about AI solutions?
```

Without memory, the second question loses context.

---

## Frontend Architecture

**Files:** `frontend/index.html`, `frontend/style.css`, `frontend/script.js`

### Frontend responsibilities

| File | Responsibility |
|------|------------------|
| `index.html` | UI structure |
| `style.css` | Styling |
| `script.js` | Logic and API calls |

### Frontend features

- **Modern chat UI:** dark theme, responsive layout, smooth scrolling
- **Code block rendering:** syntax highlighting and copy button (Highlight.js)
- **Voice input:** microphone support, recording, waveform animation, speech-to-text via backend
- **Chat history / recents:** sidebar, local storage persistence, chat switching
- **Typing indicator:** animated loading while the AI responds

---

## Environment Variables

Create `.env` inside:

- `backend/.env`
- `rag_learning/.env`

Add:

```env
GROQ_API_KEY=your_groq_api_key
PINECONE_API_KEY=your_pinecone_api_key
```

**Why use environment variables?**

Never hardcode API keys, secrets, or credentials. Benefits: security, easier deployment, environment separation.

---

## Installation Guide

### 1. Clone repository

```bash
git clone https://github.com/your-username/rag-powered-chatbot.git
cd rag-powered-chatbot
```

### 2. Create virtual environment

**Windows**

```bash
python -m venv venv
venv\Scripts\activate
```

**Linux / Mac**

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

---

## Pinecone setup

Create an index with:

| Setting | Value |
|---------|--------|
| Dimension | 384 |
| Metric | cosine |
| Cloud | AWS |
| Region | us-east-1 |

**Index name:** `vsoft-rag`

---

## Store vectors

```bash
cd rag_learning
python store_vectors.py
```

This performs:

**Scraping → Cleaning → Chunking → Embedding → Pinecone Upload**

---

## Test retrieval

```bash
python search_pinecone.py
```

Used for:

- testing semantic search
- validating embeddings

---

## Run backend

```bash
cd backend
python app.py
```

Runs at: `http://localhost:5000`

---

## Run frontend

Open `frontend/index.html` in your browser (double-click or serve via a local static server if you prefer).

Default API base in `frontend/script.js` is `http://localhost:5000`; start the backend first.

---

## Detailed chatbot flow

1. **User sends query** — e.g. “What AI services does VSoft provide?”
2. **Query embedding** — Sentence Transformer converts the query to a vector.
3. **Semantic retrieval** — Pinecone finds similar chunks (top K).
4. **Relevance / reranking** — Retrieved chunks are reranked; if nothing is returned from Pinecone, the API responds with a “no relevant information” style message.
5. **Prompt construction** — Conversation history + retrieved context + current question.
6. **Groq response generation** — Groq LLM produces the final answer.

---

## Why this project is strong

This is not a basic chatbot. It includes:

- semantic AI retrieval
- vector databases
- reranking
- memory handling
- custom data ingestion
- frontend engineering
- backend APIs
- AI orchestration

This resembles enterprise AI assistants, internal company copilots, and knowledge-base chat systems.

---

## Important concepts learned

- **Semantic search** — Search by meaning instead of keywords.
- **Embeddings** — Numerical representation of text meaning.
- **Vector database** — Optimized for vector similarity search.
- **Chunking** — Splitting large text into smaller semantic units.
- **RAG** — Combining retrieval with LLM generation.
- **LLM prompt engineering** — Controlling model output using structured prompts.
- **Context windows** — LLMs have token limits; chunking and retrieval address this.

---

## Performance optimizations

**Current optimizations:**

- semantic retrieval
- chunked storage
- vector indexing
- cross-encoder reranking (BGE)
- frontend rendering optimizations

**Possible future optimizations:**

- hybrid search
- metadata filtering
- caching
- streaming responses

---

## Future improvements

**AI features**

- agent workflows
- function calling
- multimodal AI
- PDF ingestion
- image understanding

**Frontend features**

- streaming responses
- extra animations
- richer markdown renderer
- drag & drop upload
- mobile optimization

**Backend features**

- authentication
- user sessions
- database storage
- analytics
- rate limiting

---

## Deployment plan

**Frontend:** Vercel, Netlify, GitHub Pages (configure API base URL for production).

**Backend:** Render, Railway, AWS, Azure, GCP.

**Database:** Pinecone remains cloud-hosted.

---

## Security best practices

**Never expose:** API keys, backend secrets.

**Always:** use environment variables, configure CORS appropriately, validate and sanitize user input.

---

## Testing

**Location:** `rag_learning/testing_files/`

Used for:

- crawler testing
- Pinecone testing
- retrieval validation

---

## Learning outcomes

By building this project, you learn:

- RAG architecture
- AI system design
- semantic search
- embeddings
- vector databases
- Flask APIs
- frontend/backend integration
- prompt engineering
- Pinecone workflows
- production-oriented AI concepts

---

## Real-world use cases

This architecture can power:

- company AI assistants
- customer support bots
- internal knowledge systems
- HR assistants
- document search systems
- enterprise copilots

---

## License

This project is for educational, learning, portfolio, and research purposes.

---

## Author

Built as a hands-on AI engineering project focused on Retrieval-Augmented Generation (RAG), LLM application development, vector databases, AI chatbot systems, and modern frontend/backend architecture.

---

## Final summary

This project demonstrates a complete modern AI application pipeline:

```text
Data Collection
→ Cleaning
→ Chunking
→ Embeddings
→ Vector Database
→ Semantic Retrieval
→ LLM Generation
→ AI Chat Interface
```

It combines AI engineering, backend systems, frontend UI, semantic search, and vector databases into a functional intelligent assistant system.
