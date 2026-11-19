from urllib.parse import urlsplit

import httpx


class BridgeError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status


class BridgeClient:
    def __init__(self, url: str, token: str = "", *, transport=None):
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("BRIDGE_URL must be an HTTP(S) service URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("service URL must not contain credentials, query, or fragment")
        if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("remote services require HTTPS to protect the management token")
        self.http = httpx.Client(
            base_url=url.rstrip("/") + "/",
            timeout=15,
            trust_env=False,
            transport=transport,
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def request(self, method: str, path: str, body=None):
        response = self.http.request(method, path, json=body)
        if response.is_error:
            try:
                detail = response.json().get("detail", "request failed")
            except ValueError:
                detail = "service returned a non-JSON error"
            raise BridgeError(response.status_code, str(detail))
        return response.json()

    def close(self):
        self.http.close()
