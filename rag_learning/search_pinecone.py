from pinecone_db import index
from embeddings import model

# -----------------------------------
# USER QUERY
# -----------------------------------

query = "What AI services does V-Soft provide?"

# -----------------------------------
# CONVERT QUERY TO EMBEDDING
# -----------------------------------

query_embedding = model.encode(query).tolist()

# -----------------------------------
# SEARCH PINECONE
# -----------------------------------

results = index.query(
    vector=query_embedding,
    top_k=3,
    include_metadata=True
)

# -----------------------------------
# PRINT RESULTS
# -----------------------------------

print("\n========== PINECONE RESULTS ==========\n")

for i, match in enumerate(results["matches"]):

    print(f"\n--- Result {i+1} ---\n")

    print("Score:")
    print(match["score"])

    print("\nChunk:")
    print(match["metadata"]["text"])