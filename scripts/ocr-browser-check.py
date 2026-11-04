#!/usr/bin/env python3
"""
Focused E2E local Chromium extension OCR smoke test.
Task ID: OCR-BROWSER
Ownership: scripts/ocr-browser-check.py
"""

import asyncio
import base64
import ctypes
from ctypes import wintypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# PyMuPDF (fitz)
try:
    import fitz
except ImportError:
    fitz = None

# Pillow for image generation
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = None

from playwright.async_api import async_playwright

WORKSPACE_DIR = Path(__file__).resolve().parent.parent
CHROME_EXE = os.environ.get(
    "DOCUNCHAIN_CHROMIUM",
    r"C:\Users\Slim5\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe",
)
TEMP_BASE = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Temp" / "opencode"
if not TEMP_BASE.exists():
    TEMP_BASE = Path(tempfile.gettempdir())

TEST_TEXT = "Tiếng Việt English"
TEST_IMG_WIDTH = 600
TEST_IMG_HEIGHT = 160


def generate_test_image_base64() -> str:
    """Generate JPEG containing exact Vietnamese and English text starting at (40, 55)."""
    if Image is not None:
        img = Image.new("RGB", (TEST_IMG_WIDTH, TEST_IMG_HEIGHT), color=(255, 255, 255))
        draw = ImageDraw.Draw(img)

        candidate_fonts = [
            Path(r"C:\Windows\Fonts\arial.ttf"),
            Path(r"C:\Windows\Fonts\times.ttf"),
            WORKSPACE_DIR / "lib" / "ocr" / "font.ttf",
            Path(r"C:\Windows\Fonts\segoeui.ttf"),
        ]
        font = None
        for fp in candidate_fonts:
            if fp.exists():
                try:
                    font = ImageFont.truetype(str(fp), 36)
                    break
                except Exception:
                    continue
        if font is None:
            font = ImageFont.load_default()

        # Render clear high-contrast text on white canvas starting at x=40, y=55
        draw.text((40, 55), TEST_TEXT, fill=(0, 0, 0), font=font)
        from io import BytesIO

        buf = BytesIO()
        img.save(buf, format="JPEG", quality=95)
        raw_bytes = buf.getvalue()
        return "data:image/jpeg;base64," + base64.b64encode(raw_bytes).decode("ascii")

    raise RuntimeError("Pillow (PIL) is required to generate test JPEG image.")


def generate_blank_image_base64() -> str:
    """Generate a pure blank white JPEG."""
    if Image is not None:
        img = Image.new("RGB", (400, 200), color=(255, 255, 255))
        from io import BytesIO

        buf = BytesIO()
        img.save(buf, format="JPEG", quality=95)
        raw_bytes = buf.getvalue()
        return "data:image/jpeg;base64," + base64.b64encode(raw_bytes).decode("ascii")
    raise RuntimeError("Pillow (PIL) is required to generate blank test image.")


# ---------------------------------------------------------------------------
# 64-bit Safe Windows Standard-Library Process Measurement (ctypes Win32 API)
# ---------------------------------------------------------------------------
class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]


class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_char * 260),
    ]


kernel32 = ctypes.windll.kernel32
psapi = getattr(ctypes.windll, "psapi", kernel32)

kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]

kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

kernel32.Process32First.restype = wintypes.BOOL
kernel32.Process32First.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32)]

kernel32.Process32Next.restype = wintypes.BOOL
kernel32.Process32Next.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32)]

kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]

kernel32.GetProcessTimes.restype = wintypes.BOOL
kernel32.GetProcessTimes.argtypes = [
    wintypes.HANDLE,
    ctypes.POINTER(FILETIME),
    ctypes.POINTER(FILETIME),
    ctypes.POINTER(FILETIME),
    ctypes.POINTER(FILETIME),
]

get_mem = getattr(kernel32, "K32GetProcessMemoryInfo", None) or getattr(psapi, "GetProcessMemoryInfo", None)
if get_mem:
    get_mem.restype = wintypes.BOOL
    get_mem.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD]


class WindowsChromiumSampler:
    """
    Measures CPU and working set (RAM) of Chromium process tree using Windows stdlib APIs:
    - Discovery via PowerShell Get-CimInstance matching --user-data-dir
    - Descendant tree expansion via Toolhelp32Snapshot
    - Peak working set via GetProcessMemoryInfo
    - CPU usage via GetProcessTimes with per-PID churn accounting
    """

    def __init__(self, user_data_dir_str: str):
        self.user_data_dir_str = user_data_dir_str
        self.running = False
        self.peak_working_set_bytes = 0
        self.samples_count = 0
        self.start_time = 0.0
        self.end_time = 0.0
        self.measured_pids = set()
        self.pid_first_cpu_ticks = {}
        self.pid_last_cpu_ticks = {}
        self.pid_max_working_set = {}
        self._task = None

    def _discover_pids(self) -> set:
        ps_cmd = (
            f"Get-CimInstance Win32_Process -Filter \"Name LIKE 'chrome%'\" | "
            f"Where-Object {{ $_.CommandLine -like '*{self.user_data_dir_str}*' }} | "
            f"Select-Object -ExpandProperty ProcessId"
        )
        try:
            res = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0 and res.stdout:
                return {int(line.strip()) for line in res.stdout.splitlines() if line.strip().isdigit()}
        except Exception:
            pass
        return set()

    def _expand_descendants(self, root_pids: set) -> set:
        if not root_pids:
            return set()
        h_snap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
        invalid_val = wintypes.HANDLE(-1).value
        if not h_snap or h_snap == invalid_val:
            return root_pids

        pe = PROCESSENTRY32()
        pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
        parent_map = {}
        try:
            if kernel32.Process32First(h_snap, ctypes.byref(pe)):
                while True:
                    parent_map[pe.th32ProcessID] = pe.th32ParentProcessID
                    if not kernel32.Process32Next(h_snap, ctypes.byref(pe)):
                        break
        finally:
            kernel32.CloseHandle(h_snap)

        all_pids = set(root_pids)
        changed = True
        while changed:
            changed = False
            for pid, ppid in parent_map.items():
                if ppid in all_pids and pid not in all_pids:
                    all_pids.add(pid)
                    changed = True
        return all_pids

    def _sample_step(self):
        tree_pids = self._expand_descendants(self.measured_pids)
        if tree_pids:
            self.measured_pids.update(tree_pids)

        current_sample_rss = 0
        active_in_sample = 0
        PROCESS_QUERY = 0x1000 | 0x0400

        for pid in list(self.measured_pids):
            h = kernel32.OpenProcess(PROCESS_QUERY, False, pid)
            if not h:
                continue
            try:
                # Working set (RAM)
                mem = PROCESS_MEMORY_COUNTERS_EX()
                mem.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
                if get_mem and get_mem(h, ctypes.byref(mem), mem.cb):
                    ws = mem.WorkingSetSize
                    current_sample_rss += ws
                    self.pid_max_working_set[pid] = max(self.pid_max_working_set.get(pid, 0), ws)

                # CPU times (accounting for churn)
                ct, et, kt, ut = FILETIME(), FILETIME(), FILETIME(), FILETIME()
                if kernel32.GetProcessTimes(h, ctypes.byref(ct), ctypes.byref(et), ctypes.byref(kt), ctypes.byref(ut)):
                    k = (kt.dwHighDateTime << 32) + kt.dwLowDateTime
                    u = (ut.dwHighDateTime << 32) + ut.dwLowDateTime
                    ticks = k + u
                    if pid not in self.pid_first_cpu_ticks:
                        self.pid_first_cpu_ticks[pid] = ticks
                    self.pid_last_cpu_ticks[pid] = max(self.pid_last_cpu_ticks.get(pid, 0), ticks)

                active_in_sample += 1
            finally:
                kernel32.CloseHandle(h)

        if current_sample_rss > self.peak_working_set_bytes:
            self.peak_working_set_bytes = current_sample_rss

        if active_in_sample > 0:
            self.samples_count += 1

    async def _sample_loop(self):
        while self.running:
            self._sample_step()
            await asyncio.sleep(0.08)

    async def start(self):
        self.running = True
        self.start_time = time.perf_counter()
        # Initial discovery
        for _ in range(15):
            found = self._discover_pids()
            if found:
                self.measured_pids = found
                self._sample_step()
                break
            await asyncio.sleep(0.15)

        self._task = asyncio.create_task(self._sample_loop())

    async def stop(self):
        self.running = False
        self.end_time = time.perf_counter()
        if self._task:
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Final pass while processes are still alive before context closes
        self._sample_step()

    def get_metrics(self) -> dict:
        if self.samples_count == 0 or self.peak_working_set_bytes <= 0:
            return {
                "cpu_percent": "UNAVAILABLE",
                "ram_peak_mb": "UNAVAILABLE",
                "reason": "Process measurement unavailable or no realistic >0 RAM measured for Chromium tree",
            }

        elapsed = max(0.001, self.end_time - self.start_time)
        # Sum CPU delta across all tracked PIDs, including churned/terminated children
        total_delta_ticks = sum(
            max(0, self.pid_last_cpu_ticks[pid] - self.pid_first_cpu_ticks.get(pid, 0))
            for pid in self.pid_last_cpu_ticks
        )
        total_cpu_sec = total_delta_ticks * 1e-7  # 100ns units to seconds
        num_cores = os.cpu_count() or 1
        avg_cpu_percent = (total_cpu_sec / (elapsed * num_cores)) * 100.0

        return {
            "chromium_peak_ram_mb": round(self.peak_working_set_bytes / (1024 * 1024), 2),
            "chromium_cpu_percent": round(avg_cpu_percent, 2),
            "chromium_cpu_total_sec": round(total_cpu_sec, 3),
            "chromium_processes_tracked": len(self.measured_pids),
            "chromium_processes_churned": len(self.pid_last_cpu_ticks),
            "samples_count": self.samples_count,
            "elapsed_sec": round(elapsed, 2),
        }


async def run_smoke_test():
    results = {
        "status": "UNKNOWN",
        "offline_page_routed": False,
        "offline_worker_scope_note": "Extension worker/offscreen network runs outside Playwright page.route; extension bundles local models in lib/ocr",
        "ocr_recognition_pass": False,
        "exact_unicode_words_verified": False,
        "word_positions_verified": False,
        "selected_words": [],
        "blank_page_pass": False,
        "abort_initialization_pass": False,
        "abort_inflight_pass": False,
        "contention_pass": False,
        "pymupdf_extracted_text": "",
        "external_page_requests_intercepted": 0,
        "external_page_blocked_urls": [],
        "metrics": {},
        "errors": [],
    }

    user_data_dir = TEMP_BASE / f"chrome_ocr_smoke_{int(time.time() * 1000)}"
    user_data_dir.mkdir(parents=True, exist_ok=True)
    user_data_dir_str = str(user_data_dir)

    sampler = WindowsChromiumSampler(user_data_dir_str)

    async with async_playwright() as pw:
        launch_args = [
            f"--disable-extensions-except={WORKSPACE_DIR}",
            f"--load-extension={WORKSPACE_DIR}",
            "--no-first-run",
            "--disable-default-apps",
            "--disable-background-networking",
        ]

        context = await pw.chromium.launch_persistent_context(
            user_data_dir=user_data_dir_str,
            executable_path=CHROME_EXE if os.path.exists(CHROME_EXE) else None,
            headless=False,
            args=launch_args,
        )

        try:
            page = await context.new_page()

            # Offline route monitor: page-level requests
            async def handle_route(route):
                req = route.request
                url = req.url
                if url.startswith("https://drive.google.com/file/d/local-test"):
                    html = """<!doctype html>
                    <html><head><title>Mock Drive Test</title></head>
                    <body><div id="drive-mock-container">Local Drive Mock Content</div></body></html>"""
                    await route.fulfill(status=200, content_type="text/html", body=html)
                elif url.startswith("chrome-extension://") or url.startswith("blob:") or url.startswith("data:"):
                    await route.continue_()
                else:
                    results["external_page_requests_intercepted"] += 1
                    results["external_page_blocked_urls"].append(url)
                    await route.abort("blockedbyclient")

            await context.route("**/*", handle_route)

            cdp = await context.new_cdp_session(page)
            known_contexts = []

            def on_context_created(event):
                ctx = event.get("context", {})
                known_contexts.append(ctx)

            cdp.on("Runtime.executionContextCreated", on_context_created)
            await cdp.send("Runtime.enable")
            await cdp.send("Page.enable")

            # Navigate mock Drive document
            await page.goto("https://drive.google.com/file/d/local-test", wait_until="load")
            await asyncio.sleep(1.0)

            # Wait for browser and content script execution context readiness
            target_context_id = None
            for _ in range(40):
                for ctx in list(known_contexts):
                    ctx_id = ctx.get("id")
                    try:
                        eval_res = await cdp.send("Runtime.evaluate", {
                            "expression": "typeof globalThis.DocUnchainSearchable !== 'undefined' && typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined' && Boolean(chrome.runtime.id)",
                            "contextId": ctx_id,
                            "returnByValue": True,
                        })
                        if eval_res.get("result", {}).get("value") is True:
                            target_context_id = ctx_id
                            break
                    except Exception:
                        pass
                if target_context_id is not None:
                    break
                await asyncio.sleep(0.5)

            if target_context_id is None:
                results["status"] = "BLOCKED"
                results["errors"].append("Real extension content script context with chrome.runtime not found on https://drive.google.com/file/d/local-test")
                return results

            test_world_id = target_context_id

            # Start sampling now that browser environment is confirmed ready
            await sampler.start()

            # Step 1: Abort during initialization
            abort_init_script = """
            (async () => {
                const controller = new AbortController();
                const createPromise = globalThis.DocUnchainSearchable.create({ signal: controller.signal });
                controller.abort();
                try {
                    await createPromise;
                    return { ok: false, reason: 'Promise resolved unexpectedly' };
                } catch (e) {
                    const isAbort = e.name === 'AbortError' || String(e).includes('hủy') || String(e).includes('đóng');
                    return { ok: isAbort, error: String(e) };
                }
            })()
            """
            abort_init_res = await cdp.send("Runtime.evaluate", {
                "expression": abort_init_script,
                "contextId": test_world_id,
                "awaitPromise": True,
                "returnByValue": True,
            })
            results["abort_initialization_pass"] = abort_init_res.get("result", {}).get("value", {}).get("ok", False)

            # Step 2: Contention test (two simultaneous instances)
            contention_script = """
            (async () => {
                let ocr1 = null;
                let stage = 'create-first';
                try {
                    ocr1 = await globalThis.DocUnchainSearchable.create();
                    stage = 'create-contender';
                    let rejected = false;
                    let rejectionError = '';
                    try {
                        const ocr2 = await globalThis.DocUnchainSearchable.create();
                        await ocr2.close();
                    } catch (e) {
                        rejected = true;
                        rejectionError = String(e);
                    }
                    stage = 'close-first';
                    await ocr1.close();
                    // Confirm recovery
                    stage = 'create-after-close';
                    const ocr3 = await globalThis.DocUnchainSearchable.create();
                    stage = 'close-after-close';
                    await ocr3.close();
                    return {
                        ok: rejected && rejectionError.includes('Một tác vụ OCR khác đang chạy.'),
                        error: rejectionError,
                        stage
                    };
                } catch (e) {
                    if (ocr1) try { await ocr1.close(); } catch (_) {}
                    return { ok: false, error: String(e), stage };
                }
            })()
            """
            contention_eval = await cdp.send("Runtime.evaluate", {
                "expression": contention_script,
                "contextId": test_world_id,
                "awaitPromise": True,
                "returnByValue": True,
            })
            contention_val = contention_eval.get("result", {}).get("value", {})
            results["contention_pass"] = contention_val.get("ok", False)
            if not results["contention_pass"]:
                results["errors"].append(f"Contention test failed: rejected={contention_val.get('rejected')}, error={contention_val.get('error')}")

            # Step 3: Blank page test & In-flight abort test
            blank_b64 = generate_blank_image_base64()
            blank_script = f"""
            (async () => {{
                let ocr = null;
                try {{
                    ocr = await globalThis.DocUnchainSearchable.create();
                    const pdf = new window.jspdf.jsPDF({{
                        orientation: 'l',
                        unit: 'px',
                        format: [400, 200],
                        hotfixes: ['px_scaling'],
                    }});
                    await ocr.addPage(pdf, {{
                        data: "{blank_b64}",
                        width: 400,
                        height: 200
                    }});
                    await ocr.close();
                    return {{ ok: true }};
                }} catch (e) {{
                    if (ocr) try {{ await ocr.close(); }} catch (_) {{}}
                    return {{ ok: false, error: String(e) }};
                }}
            }})()
            """
            blank_eval = await cdp.send("Runtime.evaluate", {
                "expression": blank_script,
                "contextId": test_world_id,
                "awaitPromise": True,
                "returnByValue": True,
            })
            results["blank_page_pass"] = blank_eval.get("result", {}).get("value", {}).get("ok", False)

            # In-flight abort during addPage
            inflight_script = f"""
            (async () => {{
                let ocr = null;
                try {{
                    ocr = await globalThis.DocUnchainSearchable.create();
                    const pdf = new window.jspdf.jsPDF({{
                        orientation: 'l',
                        unit: 'px',
                        format: [400, 200],
                        hotfixes: ['px_scaling'],
                    }});
                    const addPromise = ocr.addPage(pdf, {{
                        data: "{blank_b64}",
                        width: 400,
                        height: 200
                    }});
                    ocr.cancel();
                    try {{
                        await addPromise;
                        return {{ ok: false, reason: 'Expected in-flight abort exception' }};
                    }} catch (e) {{
                        const isAbort = e.name === 'AbortError' || String(e).includes('hủy') || String(e).includes('đóng');
                        return {{ ok: isAbort, error: String(e) }};
                    }}
                }} catch (e) {{
                    return {{ ok: false, error: String(e) }};
                }}
            }})()
            """
            inflight_eval = await cdp.send("Runtime.evaluate", {
                "expression": inflight_script,
                "contextId": test_world_id,
                "awaitPromise": True,
                "returnByValue": True,
            })
            results["abort_inflight_pass"] = inflight_eval.get("result", {}).get("value", {}).get("ok", False)

            # Step 4: Real Vietnamese + English OCR Recognition Test
            img_b64 = generate_test_image_base64()
            ocr_run_script = f"""
            (async () => {{
                let ocr = null;
                try {{
                    ocr = await globalThis.DocUnchainSearchable.create();
                    const orientation = {TEST_IMG_WIDTH} > {TEST_IMG_HEIGHT} ? 'l' : 'p';
                    const pdf = new window.jspdf.jsPDF({{
                        orientation,
                        unit: 'px',
                        format: [{TEST_IMG_WIDTH}, {TEST_IMG_HEIGHT}],
                        hotfixes: ['px_scaling'],
                    }});
                    pdf.addImage("{img_b64}", 'JPEG', 0, 0, {TEST_IMG_WIDTH}, {TEST_IMG_HEIGHT}, undefined, 'FAST');
                    await ocr.addPage(pdf, {{
                        data: "{img_b64}",
                        width: {TEST_IMG_WIDTH},
                        height: {TEST_IMG_HEIGHT}
                    }});
                    const pdfBase64 = pdf.output('datauristring');
                    await ocr.close();
                    return {{ ok: true, pdfBase64 }};
                }} catch (e) {{
                    if (ocr) try {{ await ocr.close(); }} catch (_) {{}}
                    return {{ ok: false, error: String(e) }};
                }}
            }})()
            """
            ocr_eval = await cdp.send("Runtime.evaluate", {
                "expression": ocr_run_script,
                "contextId": test_world_id,
                "awaitPromise": True,
                "returnByValue": True,
            })
            ocr_val = ocr_eval.get("result", {}).get("value", {})

            if not ocr_val.get("ok"):
                results["errors"].append(f"OCR recognition error: {ocr_val.get('error')}")
            else:
                pdf_data_uri = ocr_val.get("pdfBase64", "")
                if "," in pdf_data_uri:
                    pdf_bytes = base64.b64decode(pdf_data_uri.split(",", 1)[1])
                else:
                    pdf_bytes = base64.b64decode(pdf_data_uri)

                if fitz is not None:
                    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                    page0 = doc[0]
                    extracted_text = page0.get_text()
                    results["pymupdf_extracted_text"] = extracted_text.strip()

                    # Extract words with coordinates: (x0, y0, x1, y1, word, block_no, line_no, word_no)
                    word_tuples = page0.get_text("words")
                    results["selected_words"] = [
                        {"word": w[4], "x0": round(w[0], 1), "y0": round(w[1], 1), "x1": round(w[2], 1), "y1": round(w[3], 1)}
                        for w in word_tuples
                    ]

                    # 1. Exact Unicode words check: "Tiếng", "Việt", "English"
                    word_texts = [w["word"] for w in results["selected_words"]]
                    has_tieng = "Tiếng" in word_texts
                    has_viet = "Việt" in word_texts
                    has_english = "English" in word_texts

                    results["exact_unicode_words_verified"] = bool(has_tieng and has_viet and has_english)

                    # 2. Strict coordinate verification without permissive fallback:
                    # Canvas text was drawn starting at x=40, y=55 with font size 36 on a 600x160 page.
                    pos_valid = True
                    if not (has_tieng and has_viet and has_english):
                        pos_valid = False
                    else:
                        w_tieng = next(w for w in results["selected_words"] if w["word"] == "Tiếng")
                        w_viet = next(w for w in results["selected_words"] if w["word"] == "Việt")
                        w_english = next(w for w in results["selected_words"] if w["word"] == "English")

                        # "Tiếng" starts near x=40 (tight bounds: 25.0 <= x0 <= 45.0)
                        if not (25.0 <= w_tieng["x0"] <= 45.0):
                            results["errors"].append(f"Tiếng x0 out of expected range [25, 45]: {w_tieng['x0']}")
                            pos_valid = False

                        # Vertical position: accents begin at ~y=42 (tight bounds: 35.0 <= y0 <= 55.0, 65.0 <= y1 <= 80.0)
                        if not (35.0 <= w_tieng["y0"] <= 55.0 and 65.0 <= w_tieng["y1"] <= 80.0):
                            results["errors"].append(f"Tiếng y range unexpected: y0={w_tieng['y0']}, y1={w_tieng['y1']}")
                            pos_valid = False

                        # Strict horizontal progression: x0(Tiếng) < x0(Việt) < x0(English)
                        if not (w_tieng["x0"] < w_viet["x0"] < w_english["x0"]):
                            results["errors"].append("Horizontal sequence violation among Tiếng, Việt, English")
                            pos_valid = False

                        # Sequential bounding box separation (no overlaps)
                        if not (w_tieng["x1"] <= w_viet["x0"] and w_viet["x1"] <= w_english["x0"]):
                            results["errors"].append("Overlapping word bounding boxes in sequence")
                            pos_valid = False

                        # Positivity and font-metric height sanity [20, 40] for each word
                        for w in (w_tieng, w_viet, w_english):
                            if not (w["x1"] > w["x0"] and w["y1"] > w["y0"]):
                                results["errors"].append(f"Inverted box dimensions on {w['word']}")
                                pos_valid = False
                            h = w["y1"] - w["y0"]
                            if not (20.0 <= h <= 40.0):
                                results["errors"].append(f"Word {w['word']} height {h} outside expected range [20, 40]")
                                pos_valid = False

                    results["word_positions_verified"] = pos_valid
                    results["ocr_recognition_pass"] = bool(results["exact_unicode_words_verified"] and results["word_positions_verified"])
                else:
                    results["errors"].append("PyMuPDF (fitz) not available for PDF text verification.")

            results["offline_page_routed"] = (results["external_page_requests_intercepted"] == 0)

        finally:
            # Stop measurement while Chromium processes are still running
            await sampler.stop()
            results["metrics"] = sampler.get_metrics()

            await context.close()
            try:
                shutil.rmtree(user_data_dir, ignore_errors=True)
            except Exception:
                pass

    all_passed = (
        results["ocr_recognition_pass"]
        and results["blank_page_pass"]
        and results["abort_initialization_pass"]
        and results["abort_inflight_pass"]
        and results["contention_pass"]
    )
    results["status"] = "DONE" if all_passed else "FAIL"
    return results


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        res = asyncio.run(run_smoke_test())
        print("=== OCR BROWSER SMOKE TEST RESULT ===")
        print(json.dumps(res, indent=2, ensure_ascii=False))
        if res["status"] == "DONE":
            sys.exit(0)
        else:
            sys.exit(1)
    except Exception as e:
        print(f"FATAL_ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    main()
