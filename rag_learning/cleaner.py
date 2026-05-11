import re


def clean_text(text):

    # Split text into lines
    lines = text.splitlines()

    cleaned_lines = []

    for line in lines:

        # Remove spaces
        line = line.strip()

        # Skip empty lines
        if not line:
            continue

        # Skip tiny noisy lines
        if len(line) < 3:
            continue

        cleaned_lines.append(line)

    # Join into single text
    text = " ".join(cleaned_lines)

    # Remove extra spaces
    text = re.sub(r'\s+', ' ', text)

    return text