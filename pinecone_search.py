import os
from dotenv import load_dotenv
from pinecone import Pinecone

load_dotenv()

API_KEY = os.getenv("PINECONE_API_KEY")
INDEX_NAME = "vsoft-rag"

pc = Pinecone(api_key=API_KEY)
index = pc.Index(INDEX_NAME)

def search_pinecone(query_embedding, top_k=3):
    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        include_metadata=True
    )
    return results
