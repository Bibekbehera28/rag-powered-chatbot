from urls import URLS
from scraper import scrape_page
from cleaner import clean_text
from chunker import chunk_text
from embeddings import create_embeddings
from retrieval import retrieve_relevant_chunks

# -----------------------------------
# MAIN DATA COLLECTION FUNCTION
# -----------------------------------

def collect_website_data():

    all_text = ""   
    # Scrape all pages
    for url in URLS:
        print(f"Scraping: {url}")
        raw_text = scrape_page(url)
        cleaned_text = clean_text(raw_text)
        all_text += cleaned_text + "\n"
    print("\n========== DATA COLLECTION COMPLETE ==========\n")

    # Chunk combined text
    chunks = chunk_text(all_text)

    print("\n========== TOTAL CHUNKS ==========\n")
    print(len(chunks))

    # Create embeddings
    embeddings = create_embeddings(chunks)
    return chunks, embeddings


# -----------------------------------
# RUN ONLY WHEN DIRECTLY EXECUTED
# -----------------------------------

if __name__ == "__main__":

    chunks, embeddings = collect_website_data()

    # User query
    query = "What enterprise services v-soft providing?"

    # Retrieve relevant chunks
    results = retrieve_relevant_chunks(
        query,
        chunks,
        embeddings
    )

    print("\n========== TOP MATCHING CHUNKS ==========\n")

    for i, result in enumerate(results):

        print(f"\n--- Result {i+1} ---\n")

        print("Similarity Score:")
        print(result["score"])

        print("\nChunk:")
        print(result["chunk"])