"""Sign one Xiaohongshu web request. Reads JSON from stdin and writes JSON to stdout."""

import json
import sys

from xhshow import Xhshow


def main() -> None:
    request = json.load(sys.stdin)
    action = request.get("action")
    if action == "device":
        a1 = Xhshow.generate_a1()
        json.dump({"a1": a1, "webId": Xhshow.generate_web_id(a1)}, sys.stdout)
        return
    uri = request.get("uri")
    if not isinstance(uri, str) or not uri.startswith("https://edith.xiaohongshu.com/"):
        raise SystemExit(2)
    cookies = request.get("cookies") if isinstance(request.get("cookies"), dict) else {}
    client = Xhshow()
    if action == "POST":
        payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
        headers = client.sign_headers_post(uri=uri, cookies=cookies, payload=payload)
    elif action == "GET":
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        headers = client.sign_headers_get(uri=uri, cookies=cookies, params=params)
    else:
        raise SystemExit(2)
    json.dump({str(key): str(value) for key, value in headers.items()}, sys.stdout)


if __name__ == "__main__":
    main()
