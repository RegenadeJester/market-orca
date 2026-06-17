import json
import sys
from scrapling import Fetcher


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing url"}))
        return
    url = sys.argv[1]
    try:
        fetcher = Fetcher(auto_match=False)
        page = fetcher.get(url)
        data = {
            "title": page.meta.get("og:title") or page.meta.get("title") or "",
            "description": page.meta.get("og:description") or page.meta.get("description") or "",
            "image": page.meta.get("og:image") or page.meta.get("twitter:image") or "",
            "site_name": page.meta.get("og:site_name") or "",
            "url": url,
        }
        print(json.dumps(data))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "url": url}))


if __name__ == "__main__":
    main()
