import os
from dotenv import load_dotenv
from pinecone import Pinecone

# Load .env variables
load_dotenv()

# Get API key from .env
api_key = os.getenv("PINECONE_API_KEY")

# Initialize Pinecone
pc = Pinecone(api_key=api_key)

# Connect to index
index = pc.Index("vsoft-rag")

# Print index stats
print(index.describe_index_stats())