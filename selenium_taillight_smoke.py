"""Local Selenium smoke tests for TaillightSim.

This file is ignored by git while the test flow is still being iterated on.
"""

from __future__ import annotations

import argparse
import atexit
import re
import subprocess
import sys
import time
import unittest
from urllib.error import URLError
from urllib.request import urlopen

from selenium.common.exceptions import WebDriverException
from selenium.webdriver import ActionChains, Chrome, Firefox
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


DEFAULT_BASE_URL = "http://127.0.0.1:8088"
DEFAULT_TIMEOUT_SECONDS = 20
DEFAULT_HEADLESS = False
DEFAULT_BROWSER = "auto"
DEFAULT_BROWSERS = ("chrome", "firefox")
SERVER_STARTUP_TIMEOUT_SECONDS = 20
SERVER_COMMAND = [sys.executable, "taillight_server.py", "serve", "--host", "0.0.0.0", "--port", "8088"]

BASE_URL = DEFAULT_BASE_URL
HEADLESS = DEFAULT_HEADLESS
BROWSER = DEFAULT_BROWSER
BROWSERS: tuple[str, ...] = DEFAULT_BROWSERS
SERVER_PROCESS: subprocess.Popen[str] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Selenium smoke tests against TaillightSim.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Base URL of the running server.")
    parser.add_argument(
        "--browser",
        default=DEFAULT_BROWSER,
        choices=("auto", "chrome", "firefox"),
        help="Legacy single-browser mode for the session.",
    )
    parser.add_argument(
        "--browsers",
        default=",".join(DEFAULT_BROWSERS),
        help="Comma-separated browser matrix to run, for example chrome,firefox,edge.",
    )
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser window.")
    return parser.parse_args()


def wait_for_server(base_url: str, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> None:
    deadline = time.monotonic() + timeout_seconds
    health_url = f"{base_url.rstrip('/')}/healthz"
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urlopen(health_url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, URLError) as exc:
            last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {health_url}") from last_error


def is_server_running(base_url: str) -> bool:
    try:
        wait_for_server(base_url, timeout_seconds=3)
        return True
    except RuntimeError:
        return False


def parse_startup_url(line: str) -> str | None:
    match = re.search(r"https?://\S+", line)
    if not match:
        return None
    return match.group(0).rstrip(".,)]")


def start_server_if_needed() -> str:
    global SERVER_PROCESS

    if is_server_running(DEFAULT_BASE_URL):
        return DEFAULT_BASE_URL

    SERVER_PROCESS = subprocess.Popen(
        SERVER_COMMAND,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    assert SERVER_PROCESS.stdout is not None
    startup_deadline = time.monotonic() + SERVER_STARTUP_TIMEOUT_SECONDS
    captured_lines: list[str] = []
    while time.monotonic() < startup_deadline:
        line = SERVER_PROCESS.stdout.readline()
        if line:
            captured_lines.append(line.rstrip())
            resolved_url = parse_startup_url(line)
            if resolved_url:
                wait_for_server(resolved_url)
                atexit.register(stop_started_server)
                return resolved_url
        elif SERVER_PROCESS.poll() is not None:
            break

    stop_started_server()
    joined_output = "\n".join(captured_lines)
    raise RuntimeError(f"Unable to start taillight_server.py. Output:\n{joined_output}")


def stop_started_server() -> None:
    global SERVER_PROCESS

    if SERVER_PROCESS is None:
        return
    process = SERVER_PROCESS
    SERVER_PROCESS = None
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def normalize_browser_list(raw: str) -> tuple[str, ...]:
    browsers = [item.strip().lower() for item in raw.split(",") if item.strip()]
    if not browsers:
        return DEFAULT_BROWSERS
    valid = {"chrome", "firefox"}
    normalized: list[str] = []
    for browser in browsers:
        if browser == "auto":
            return DEFAULT_BROWSERS
        if browser not in valid:
            raise ValueError(f"Unsupported browser: {browser}")
        if browser not in normalized:
            normalized.append(browser)
    return tuple(normalized)


def build_options(*, browser: str, mobile: bool, headless: bool):
    mobile_user_agent = (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    )
    if browser == "firefox":
        from selenium.webdriver import FirefoxOptions

        options = FirefoxOptions()
    else:
        from selenium.webdriver import ChromeOptions

        options = ChromeOptions()

    if headless:
        options.add_argument("--headless=new" if browser != "firefox" else "-headless")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1440,1100")

    if mobile:
        if browser == "firefox":
            options.add_argument("--width=390")
            options.add_argument("--height=844")
            options.set_preference("general.useragent.override", mobile_user_agent)
            options.set_preference("layout.css.devPixelsPerPx", "3.0")
        else:
            options.add_experimental_option(
                "mobileEmulation",
                {
                    "deviceMetrics": {"width": 390, "height": 844, "pixelRatio": 3},
                    "userAgent": mobile_user_agent,
                },
            )

    return options


def create_driver(*, browser: str, mobile: bool) -> Chrome | Firefox:
    options = build_options(browser=browser, mobile=mobile, headless=HEADLESS)
    if browser == "firefox":
        driver = Firefox(options=options)
    else:
        driver = Chrome(options=options)
    driver.set_page_load_timeout(30)
    return driver


def app_url(*, mobile: bool) -> str:
    suffix = "?profile=mobile" if mobile else ""
    return f"{BASE_URL.rstrip('/')}/{suffix}"


def wait_for(driver, condition, timeout: int = 12):
    return WebDriverWait(driver, timeout).until(condition)


def count_elements(driver, selector: str) -> int:
    return len(driver.find_elements(By.CSS_SELECTOR, selector))


def element_has_class(driver, selector: str, class_name: str) -> bool:
    return class_name in driver.find_element(By.CSS_SELECTOR, selector).get_attribute("class").split()


def text_of(driver, selector: str) -> str:
    return driver.find_element(By.CSS_SELECTOR, selector).text.strip()


def is_displayed(driver, selector: str) -> bool:
    return driver.find_element(By.CSS_SELECTOR, selector).is_displayed()


def click_button(driver, selector: str) -> None:
    driver.find_element(By.CSS_SELECTOR, selector).click()


def snapshot(driver) -> dict[str, object]:
    data = driver.execute_script("return window.__taillightSim && window.__taillightSim.snapshot ? window.__taillightSim.snapshot() : null")
    if not isinstance(data, dict):
        raise RuntimeError("TaillightSim snapshot is unavailable")
    return data


def hold_key(driver, key: str, hold_seconds: float) -> None:
    ActionChains(driver).key_down(key).perform()
    time.sleep(hold_seconds)
    ActionChains(driver).key_up(key).perform()


def hold_pointer(driver, selector: str, hold_seconds: float) -> None:
    element = driver.find_element(By.CSS_SELECTOR, selector)
    ActionChains(driver).click_and_hold(element).perform()
    time.sleep(hold_seconds)
    ActionChains(driver).release(element).perform()


def wait_for_pass_summary(driver, timeout: int = 20) -> None:
    def summary_contains_pass(drv) -> bool:
        summary = text_of(drv, "#testSummary")
        return "passed" in summary.lower() and count_elements(drv, "#testList li.ok") > 0

    wait_for(driver, summary_contains_pass, timeout=timeout)


def wait_for_self_tests_panel(driver, timeout: int = 12) -> None:
    wait_for(driver, lambda d: is_displayed(d, "#tests"), timeout=timeout)


def exercise_desktop_flow(driver) -> None:
    driver.find_element(By.TAG_NAME, "body").click()

    assert count_elements(driver, "#bar .seg") == 60
    assert text_of(driver, "#modeName") == "AUDI"

    hold_key(driver, "f", 0.05)
    wait_for(driver, lambda d: bool(snapshot(d)["on"]))
    wait_for(driver, lambda d: not bool(snapshot(d)["busy"]), timeout=12)
    hold_key(driver, "f", 0.05)
    wait_for(driver, lambda d: not bool(snapshot(d)["on"]))
    wait_for(driver, lambda d: not bool(snapshot(d)["busy"]), timeout=12)

    initial_mode = text_of(driver, "#modeName")
    hold_key(driver, "m", 0.05)
    wait_for(driver, lambda d: text_of(d, "#modeName") != initial_mode)

    hold_key(driver, "h", 0.05)
    wait_for(driver, lambda d: not is_displayed(d, "#panel"))
    hold_key(driver, "h", 0.05)
    wait_for(driver, lambda d: is_displayed(d, "#panel"))

    hold_key(driver, "z", 0.05)
    wait_for(driver, lambda d: snapshot(d)["signal"] == "left")

    hold_key(driver, "c", 0.05)
    wait_for(driver, lambda d: snapshot(d)["signal"] == "right")

    hold_key(driver, "x", 0.05)
    wait_for(driver, lambda d: snapshot(d)["signal"] == "hazard")

    brake_actions = ActionChains(driver)
    brake_actions.key_down("s").perform()
    wait_for(driver, lambda d: bool(snapshot(d)["brakeActive"]))
    ActionChains(driver).key_up("s").perform()
    wait_for(driver, lambda d: not bool(snapshot(d)["brakeActive"]), timeout=6)

    hold_key(driver, "q", 0.35)
    wait_for(driver, lambda d: bool(snapshot(d)["reverseActive"]))


def exercise_desktop_self_tests(driver) -> None:
    hold_key(driver, "t", 0.75)
    wait_for_self_tests_panel(driver)
    wait_for_pass_summary(driver)


def exercise_mobile_flow(driver) -> None:
    assert text_of(driver, "#segCountDisplay") == "20"
    assert "profile-mobile" in driver.find_element(By.TAG_NAME, "body").get_attribute("class")
    assert count_elements(driver, "#bar .seg") == 20

    initial_mode = text_of(driver, "#modeName")
    click_button(driver, "#btnMode")
    wait_for(driver, lambda d: text_of(d, "#modeName") != initial_mode)

    click_button(driver, "#btnLeft")
    wait_for(driver, lambda d: snapshot(d)["signal"] == "left")

    click_button(driver, "#btnRight")
    wait_for(driver, lambda d: snapshot(d)["signal"] == "right")

    click_button(driver, "#btnHazard")
    wait_for(driver, lambda d: snapshot(d)["signal"] == "hazard")

    click_button(driver, "#btnLock")
    wait_for(driver, lambda d: bool(snapshot(d)["on"]))
    wait_for(driver, lambda d: not bool(snapshot(d)["busy"]), timeout=12)
    click_button(driver, "#btnLock")
    wait_for(driver, lambda d: not bool(snapshot(d)["on"]))
    wait_for(driver, lambda d: not bool(snapshot(d)["busy"]), timeout=12)

    brake_button = driver.find_element(By.CSS_SELECTOR, "#btnBrake")
    ActionChains(driver).click_and_hold(brake_button).perform()
    wait_for(driver, lambda d: bool(snapshot(d)["brakeActive"]))
    ActionChains(driver).release(brake_button).perform()
    wait_for(driver, lambda d: not bool(snapshot(d)["brakeActive"]), timeout=6)

    hold_pointer(driver, "#btnReverse", 0.35)
    wait_for(driver, lambda d: bool(snapshot(d)["reverseActive"]))


def exercise_mobile_self_tests(driver) -> None:
    for _ in range(5):
        click_button(driver, "#btnReverse")
        time.sleep(0.12)

    wait_for_self_tests_panel(driver)
    wait_for_pass_summary(driver)


def make_browser_test_case(browser: str) -> tuple[type[unittest.TestCase], type[unittest.TestCase]]:
    class DesktopKeyboardReactionsTest(unittest.TestCase):
        @classmethod
        def setUpClass(cls) -> None:
            wait_for_server(BASE_URL)
            cls.browser = browser
            try:
                cls.driver = create_driver(browser=browser, mobile=False)
            except (RuntimeError, WebDriverException) as exc:
                raise unittest.SkipTest(f"{browser} desktop session unavailable: {exc}") from exc
            cls.driver.get(app_url(mobile=False))
            wait_for(cls.driver, EC.presence_of_element_located((By.ID, "modeName")))

        @classmethod
        def tearDownClass(cls) -> None:
            cls.driver.quit()

        def test_keyboard_bindings_and_reactions(self) -> None:
            exercise_desktop_flow(self.driver)
            exercise_desktop_self_tests(self.driver)

    DesktopKeyboardReactionsTest.__name__ = f"DesktopKeyboardReactionsTest_{browser}"
    DesktopKeyboardReactionsTest.__qualname__ = DesktopKeyboardReactionsTest.__name__

    class MobileTouchInteractionsTest(unittest.TestCase):
        @classmethod
        def setUpClass(cls) -> None:
            wait_for_server(BASE_URL)
            cls.browser = browser
            try:
                cls.driver = create_driver(browser=browser, mobile=True)
            except (RuntimeError, WebDriverException) as exc:
                raise unittest.SkipTest(f"{browser} mobile session unavailable: {exc}") from exc
            cls.driver.get(app_url(mobile=True))
            wait_for(cls.driver, EC.presence_of_element_located((By.ID, "modeName")))

        @classmethod
        def tearDownClass(cls) -> None:
            cls.driver.quit()

        def test_mobile_controls_and_long_presses(self) -> None:
            exercise_mobile_flow(self.driver)
            exercise_mobile_self_tests(self.driver)

    MobileTouchInteractionsTest.__name__ = f"MobileTouchInteractionsTest_{browser}"
    MobileTouchInteractionsTest.__qualname__ = MobileTouchInteractionsTest.__name__

    return DesktopKeyboardReactionsTest, MobileTouchInteractionsTest


def build_browser_suite(browsers: tuple[str, ...]) -> unittest.TestSuite:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for browser in browsers:
        desktop_case, mobile_case = make_browser_test_case(browser)
        suite.addTests(loader.loadTestsFromTestCase(desktop_case))
        suite.addTests(loader.loadTestsFromTestCase(mobile_case))
    return suite


def load_tests(loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None) -> unittest.TestSuite:
    del loader, tests, pattern
    return build_browser_suite(DEFAULT_BROWSERS)


def main() -> int:
    global BASE_URL, HEADLESS, BROWSER, BROWSERS

    args = parse_args()
    BASE_URL = args.base_url.rstrip("/")
    BROWSER = args.browser
    HEADLESS = not args.headed
    BROWSERS = (args.browser,) if args.browser != "auto" else normalize_browser_list(args.browsers)

    BASE_URL = start_server_if_needed() if BASE_URL == DEFAULT_BASE_URL else BASE_URL
    wait_for_server(BASE_URL)

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(build_browser_suite(BROWSERS))
    stop_started_server()
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())