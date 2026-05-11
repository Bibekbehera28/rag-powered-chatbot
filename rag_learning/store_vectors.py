from pinecone_db import index
from main import collect_website_data

# -------------------------------
# GET CHUNKS + EMBEDDINGS
# -------------------------------

chunks, embeddings = collect_website_data()

# -------------------------------
# PREPARE VECTORS
# -------------------------------

vectors = []

for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):

    vector = {
        "id": f"chunk-{i}",
        "values": embedding.tolist(),
        "metadata": {
            "text": chunk
        }
    }

    vectors.append(vector)

# -------------------------------
# UPLOAD IN BATCHES IN PINECONE
# -------------------------------

batch_size = 100

for i in range(0, len(vectors), batch_size):

    batch = vectors[i:i + batch_size]

    index.upsert(vectors=batch)

    print(f"Uploaded batch {i // batch_size + 1}")

# -------------------------------
# SUCCESS MESSAGE
# -------------------------------

print("\n========== UPLOAD COMPLETE ==========\n")

print(f"Uploaded {len(vectors)} vectors to Pinecone.")