"""Check the local demo UI. Never run against a production service.

Requires the optional 'ui' extra and `playwright install chromium`.
"""

import argparse
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

from order_bridge.config import default_data_dir


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8787")
    parser.add_argument("--output", default=str(default_data_dir() / "ui-check"))
    args = parser.parse_args()
    with httpx.Client(base_url=args.url, trust_env=False, timeout=5) as client:
        status = client.get("/healthz")
        status.raise_for_status()
        if status.json().get("demo") is not True:
            raise RuntimeError("UI check only modifies the explicit local demo environment")
    output = Path(args.output).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1500, "height": 1080})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            page.goto(args.url, wait_until="networkidle")
            button = page.locator("#add-demo")
            expect(button).to_be_visible()
            initial = int(page.locator("#metric-simulated").inner_text())
            for _ in range(3):
                button.click()
                expect(button).to_be_enabled()
            page.wait_for_function(
                "n => Number(document.querySelector('#metric-simulated').textContent) >= n",
                arg=initial + 3,
                timeout=20000,
            )
            page.locator('input[name="store_id"]').fill("ui-test-store")
            page.locator('input[name="group_name"]').fill("页面测试备餐群")
            page.get_by_role("button", name="保存路由").click()
            expect(page.locator("#route-list")).to_contain_text("ui-test-store")
            page.evaluate("window.scrollTo(0, 0)")
            page.screenshot(path=str(output / "order-bridge-dashboard.png"), full_page=True)
            page.get_by_role("button", name="查看 →").first.click()
            expect(page.locator("#job-dialog")).to_be_visible()
            expect(page.locator("#job-message")).to_contain_text("鸡腿饭")
            expect(page.locator("#job-history")).to_contain_text("模拟")
            page.screenshot(path=str(output / "order-bridge-detail.png"))
            page.get_by_role("button", name="模拟订单取消").click()
            expect(page.locator("#job-dialog")).not_to_be_visible()
            page.wait_for_function(
                "n => Number(document.querySelector('#metric-simulated').textContent) >= n",
                arg=initial + 4,
                timeout=15000,
            )
            page.set_viewport_size({"width": 390, "height": 844})
            page.evaluate("window.scrollTo(0, 0)")
            page.screenshot(path=str(output / "order-bridge-mobile.png"), full_page=True)
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            assert not errors, errors
            print(f"UI passed: repeated order creation, routing, preview, cancel, mobile; {output}")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
