import os
from pinecone import Pinecone, ServerlessSpec
from dotenv import load_dotenv

# LOAD ENV VARIABLES

load_dotenv()

# LOAD API KEY

api_key = os.getenv("PINECONE_API_KEY")

# INITIALIZE PINECONE

pc = Pinecone(api_key=api_key)
INDEX_NAME = "vsoft-rag"

# CREATE INDEX IF NOT EXISTS

if INDEX_NAME not in pc.list_indexes().names():

    pc.create_index(
        name=INDEX_NAME,
        dimension=384,
        metric="cosine",
        spec=ServerlessSpec(
            cloud="aws",
            region="us-east-1"
        )
    )

# CONNECT TO INDEX
index = pc.Index(INDEX_NAME)