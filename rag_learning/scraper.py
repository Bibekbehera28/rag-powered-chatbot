import requests
from bs4 import BeautifulSoup


def scrape_page(url):

    try:

        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(
            response.text,
            "html.parser"
        )

        # Remove unwanted tags
        for tag in soup([
            "script",
            "style",
            "nav",
            "footer",
            "header"
        ]):
            tag.decompose()

        text = soup.get_text(separator="\n")

        return text

    except Exception as e:

        print(f"Error scraping {url}")

        print(e)

        return ""