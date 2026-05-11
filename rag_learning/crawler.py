import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin


def get_internal_links(base_url):
    response = requests.get(base_url)
    soup = BeautifulSoup(response.text, "html.parser")
    links = set()
    for tag in soup.find_all("a", href=True):

        href = tag["href"]

        full_url = urljoin(base_url, href)

        # Keep only V-Soft URLs
        if "vsoftconsulting.com" not in full_url:
            continue

        # Remove unwanted URLs
        unwanted_keywords = [
            ".pdf",
            "privacy-policy",
            "cookie-policy",
            "terms-of-use",
            "career",
            "contact",
            "chat.openai",
            "claude.ai",
            "perplexity.ai",
            "google.com"
        ]

        if any(keyword in full_url for keyword in unwanted_keywords):
            continue

        # Remove fragments
        full_url = full_url.split("#")[0]

        # Remove trailing slash duplicates
        full_url = full_url.rstrip("/")

        links.add(full_url)

    return list(links)