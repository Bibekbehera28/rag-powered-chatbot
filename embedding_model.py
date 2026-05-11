from sentence_transformers import SentenceTransformer

# Load the model once at startup
model = SentenceTransformer("all-MiniLM-L6-v2")

def create_query_embedding(query):
    embedding = model.encode(query)
    return embedding.tolist()
