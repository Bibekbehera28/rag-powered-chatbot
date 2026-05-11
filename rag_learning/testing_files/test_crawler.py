from crawler import get_internal_links


links = get_internal_links(
    "https://www.vsoftconsulting.com"
)

print("\n========== FOUND URLS ==========\n")

for link in links:

    print(link)