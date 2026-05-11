from sklearn.metrics.pairwise import cosine_similarity
from embeddings import model


def retrieve_relevant_chunks(query, chunks, embeddings):

    # Convert query into embedding
    query_embedding = model.encode([query])

    # Calculate similarity scores
    similarity_scores = cosine_similarity(
        query_embedding,
        embeddings
    )[0]

    # Get top 3 matching chunks
    top_indices = similarity_scores.argsort()[-3:][::-1]

    results = []

    for index in top_indices:

        results.append({
            "chunk": chunks[index],
            "score": similarity_scores[index]
        })

    return results