from pinecone import Pinecone

# Initialize Pinecone
pc = Pinecone(
    api_key="pcsk_5hQNUZ_PMxjAvRboRStaBBnXFamNs268HNpc44Jhh3q7DfFoktojHyrgCasbJwjBydRmiv"
)

# Connect to index
index = pc.Index("vsoft-rag")

print(index.describe_index_stats())