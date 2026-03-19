(function () {
    if (window.__bugReportWidgetMounted) return;
    window.__bugReportWidgetMounted = true;

    const MAX_IMAGES = 5;
    const FILE_PICK_ACCEPT = "image/*";

    const state = {
        attachments: [],
        uploadInFlight: false,
        submitInFlight: false,
    };

    function onReady(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback, { once: true });
            return;
        }
        callback();
    }

    function buildWidget() {
        if (!document.body) return;

        const wrapper = document.createElement("div");
        wrapper.innerHTML = `
            <style>
                .bug-report-action-group {
                    display: inline-flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 0.5rem;
                    flex-wrap: wrap;
                }
                .bug-report-trigger {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.45rem;
                    border: 1px solid #fdba74;
                    border-radius: 0.875rem;
                    background: #fff7ed;
                    color: #c2410c;
                    padding: 0.7rem 0.95rem;
                    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
                    font-size: 0.88rem;
                    font-weight: 800;
                    line-height: 1;
                    letter-spacing: -0.01em;
                    white-space: nowrap;
                    cursor: pointer;
                    transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                }
                .bug-report-trigger:hover {
                    transform: translateY(-1px);
                    border-color: #fb923c;
                    background: #ffedd5;
                    box-shadow: 0 6px 18px rgba(249, 115, 22, 0.14);
                }
                .bug-report-trigger:focus-visible {
                    outline: none;
                    box-shadow: 0 0 0 4px rgba(251, 146, 60, 0.18);
                }
                .bug-report-trigger.is-floating {
                    position: fixed;
                    top: 1rem;
                    right: 1rem;
                    z-index: 80;
                }
                .bug-report-trigger-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 1rem;
                    height: 1rem;
                }
                .bug-report-modal {
                    position: fixed;
                    inset: 0;
                    z-index: 90;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 1rem;
                    background: rgba(15, 23, 42, 0.62);
                    backdrop-filter: blur(6px);
                }
                .bug-report-modal.is-open {
                    display: flex;
                }
                .bug-report-panel {
                    width: min(100%, 44rem);
                    max-height: calc(100vh - 2rem);
                    overflow: auto;
                    border: 1px solid rgba(148, 163, 184, 0.22);
                    border-radius: 1.5rem;
                    background: #ffffff;
                    box-shadow: 0 28px 80px rgba(15, 23, 42, 0.24);
                }
                .bug-report-context {
                    border: 1px solid #e2e8f0;
                    border-radius: 1rem;
                    background: #f8fafc;
                    padding: 0.9rem 1rem;
                }
                .bug-report-preview-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                    gap: 0.75rem;
                }
                .bug-report-preview-card {
                    position: relative;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                    border-radius: 1rem;
                    background: #f8fafc;
                }
                .bug-report-preview-card img {
                    display: block;
                    width: 100%;
                    height: 110px;
                    object-fit: cover;
                }
                .bug-report-preview-remove {
                    position: absolute;
                    top: 0.4rem;
                    right: 0.4rem;
                    border: 0;
                    border-radius: 999px;
                    background: rgba(15, 23, 42, 0.74);
                    color: #ffffff;
                    width: 1.9rem;
                    height: 1.9rem;
                    font-size: 0.9rem;
                    font-weight: 700;
                    cursor: pointer;
                }
                body.bug-report-modal-open {
                    overflow: hidden;
                }
                @media (max-width: 640px) {
                    .bug-report-trigger {
                        padding: 0.7rem 0.8rem;
                        font-size: 0.88rem;
                        border-radius: 0.8rem;
                    }
                    .bug-report-trigger.is-floating {
                        top: 0.75rem;
                        right: 0.75rem;
                    }
                    .bug-report-trigger-label {
                        display: none;
                    }
                }
            </style>
            <button type="button" class="bug-report-trigger" id="bugReportTriggerBtn" aria-label="버그 신고 열기">
                <span class="bug-report-trigger-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9.75 3.75h4.5l.75 1.5H18a2.25 2.25 0 0 1 2.25 2.25v8.25A2.25 2.25 0 0 1 18 18H6a2.25 2.25 0 0 1-2.25-2.25V7.5A2.25 2.25 0 0 1 6 5.25h3l.75-1.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                        <path d="M12 9v3.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                        <circle cx="12" cy="15.75" r=".75" fill="currentColor"/>
                    </svg>
                </span>
                <span class="bug-report-trigger-label">버그 신고</span>
            </button>

            <div class="bug-report-modal" id="bugReportModal" aria-hidden="true">
                <div class="bug-report-panel">
                    <div class="border-b border-slate-200 px-5 py-4 sm:px-6">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-red-500">Feedback</p>
                                <h2 class="mt-2 text-2xl font-bold text-slate-900">버그 신고</h2>
                                <p class="mt-1 text-sm text-slate-500">현재 화면 정보가 함께 저장됩니다. 문제 상황을 그대로 적어 주세요.</p>
                            </div>
                            <button type="button" id="bugReportCloseBtn"
                                    class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                                ×
                            </button>
                        </div>
                    </div>

                    <div class="space-y-4 px-5 py-5 sm:px-6">
                        <div class="bug-report-context">
                            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">현재 화면</p>
                            <p id="bugReportContextPath" class="mt-2 break-all text-sm font-semibold text-slate-800"></p>
                            <p id="bugReportContextTitle" class="mt-1 break-all text-xs text-slate-500"></p>
                        </div>

                        <div>
                            <label for="bugReportContentInput" class="mb-2 block text-sm font-bold text-slate-800">문제 설명</label>
                            <textarea id="bugReportContentInput" rows="7" maxlength="5000"
                                      class="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-red-400 focus:ring-4 focus:ring-red-100"
                                      placeholder="어떤 화면에서, 무엇을 눌렀을 때, 어떤 문제가 생겼는지 적어 주세요."></textarea>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p class="text-sm font-bold text-slate-800">스크린샷 첨부</p>
                                    <p class="text-xs text-slate-500">최대 5장. 붙여넣기(Ctrl+V)와 파일 선택을 모두 지원합니다.</p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button type="button" id="bugReportPickImagesBtn"
                                            class="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                                        스크린샷 선택
                                    </button>
                                    <input id="bugReportFileInput" type="file" accept="${FILE_PICK_ACCEPT}" multiple class="hidden">
                                </div>
                            </div>
                            <div id="bugReportPreviewGrid" class="bug-report-preview-grid mt-4"></div>
                        </div>

                        <p id="bugReportMessage" class="hidden text-sm"></p>

                        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button type="button" id="bugReportCancelBtn"
                                    class="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                                닫기
                            </button>
                            <button type="button" id="bugReportSubmitBtn"
                                    class="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800">
                                접수하기
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(wrapper);

        const triggerBtn = document.getElementById("bugReportTriggerBtn");
        const modal = document.getElementById("bugReportModal");
        const closeBtn = document.getElementById("bugReportCloseBtn");
        const cancelBtn = document.getElementById("bugReportCancelBtn");
        const submitBtn = document.getElementById("bugReportSubmitBtn");
        const pickImagesBtn = document.getElementById("bugReportPickImagesBtn");
        const fileInput = document.getElementById("bugReportFileInput");
        const contentInput = document.getElementById("bugReportContentInput");
        const messageEl = document.getElementById("bugReportMessage");
        const previewGrid = document.getElementById("bugReportPreviewGrid");
        const contextPathEl = document.getElementById("bugReportContextPath");
        const contextTitleEl = document.getElementById("bugReportContextTitle");

        function ensureActionGroup(target) {
            const parent = target?.parentElement;
            if (!parent) return null;
            if (parent.classList.contains("bug-report-action-group")) {
                return parent;
            }

            const group = document.createElement("div");
            group.className = "bug-report-action-group";
            target.before(group);
            group.appendChild(target);
            return group;
        }

        function resolveTriggerPlacement() {
            const path = String(window.location.pathname || "");

            if (path === "/") {
                return {
                    mode: "prepend",
                    element: document.getElementById("accountMenuWrapper")?.parentElement || null,
                };
            }

            if (path === "/insight") {
                return {
                    mode: "wrap-target",
                    element: document.querySelector('header button[onclick="handleCancel()"]'),
                };
            }

            if (path === "/account") {
                return {
                    mode: "wrap-target",
                    element: document.querySelector('body > div a[href="/"]'),
                };
            }

            if (path === "/admin/bug-reports") {
                return {
                    mode: "prepend",
                    element: document.querySelector('a[href="/account"]')?.parentElement || null,
                };
            }

            if (path.startsWith("/detail/")) {
                return {
                    mode: "prepend",
                    element: document.querySelector("header > div:last-child"),
                };
            }

            if (path === "/customer/new" || /^\/customer\/\d+$/.test(path)) {
                return {
                    mode: "prepend",
                    element: document.querySelector("header > div:last-child"),
                };
            }

            return { mode: "floating", element: null };
        }

        function mountTriggerButton() {
            const placement = resolveTriggerPlacement();
            if (placement?.mode === "prepend" && placement.element) {
                placement.element.prepend(triggerBtn);
                return;
            }

            if (placement?.mode === "wrap-target" && placement.element) {
                const group = ensureActionGroup(placement.element);
                if (group) {
                    group.prepend(triggerBtn);
                    return;
                }
            }

            triggerBtn?.classList.add("is-floating");
            document.body.appendChild(triggerBtn);
        }

        function setMessage(text, type) {
            if (!messageEl) return;
            if (!text) {
                messageEl.classList.add("hidden");
                messageEl.textContent = "";
                return;
            }

            messageEl.classList.remove("hidden", "text-red-600", "text-emerald-600", "text-slate-500");
            messageEl.classList.add(type === "success" ? "text-emerald-600" : type === "info" ? "text-slate-500" : "text-red-600");
            messageEl.textContent = text;
        }

        function updateContext() {
            if (contextPathEl) {
                contextPathEl.textContent = `${window.location.pathname}${window.location.search}`;
            }
            if (contextTitleEl) {
                contextTitleEl.textContent = document.title || window.location.href;
            }
        }

        function syncBusyState() {
            const disabled = state.uploadInFlight || state.submitInFlight;
            if (submitBtn) submitBtn.disabled = disabled;
            if (pickImagesBtn) pickImagesBtn.disabled = disabled;
        }

        function renderPreviews() {
            if (!previewGrid) return;
            previewGrid.innerHTML = "";

            if (!state.attachments.length) {
                const empty = document.createElement("div");
                empty.className = "col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500";
                empty.textContent = "아직 첨부된 이미지가 없습니다.";
                previewGrid.appendChild(empty);
                return;
            }

            state.attachments.forEach((attachment, index) => {
                const card = document.createElement("div");
                card.className = "bug-report-preview-card";

                const image = document.createElement("img");
                image.src = attachment.url;
                image.alt = `버그 첨부 이미지 ${index + 1}`;
                card.appendChild(image);

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "bug-report-preview-remove";
                removeBtn.textContent = "×";
                removeBtn.setAttribute("aria-label", `첨부 이미지 ${index + 1} 제거`);
                removeBtn.addEventListener("click", () => {
                    state.attachments = state.attachments.filter((_, targetIndex) => targetIndex !== index);
                    renderPreviews();
                    setMessage("", "info");
                });
                card.appendChild(removeBtn);

                previewGrid.appendChild(card);
            });
        }

        function openModal() {
            updateContext();
            modal.classList.add("is-open");
            modal.setAttribute("aria-hidden", "false");
            document.body.classList.add("bug-report-modal-open");
            window.setTimeout(() => {
                contentInput?.focus();
            }, 30);
        }

        function closeModal() {
            modal.classList.remove("is-open");
            modal.setAttribute("aria-hidden", "true");
            document.body.classList.remove("bug-report-modal-open");
        }

        async function uploadImage(file) {
            if (!file) {
                throw new Error("이미지 파일이 없습니다.");
            }
            if (!String(file.type || "").toLowerCase().startsWith("image/")) {
                throw new Error("이미지 파일만 첨부할 수 있습니다.");
            }

            const formData = new FormData();
            formData.append("file", file, file.name || "bug-report-image.png");

            const res = await fetch("/api/bug-reports/image", {
                method: "POST",
                body: formData,
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(payload.detail || "스크린샷 업로드에 실패했습니다.");
            }

            const imageUrl = String(payload?.url || "").trim();
            if (!imageUrl.startsWith("/photo/bug-report/")) {
                throw new Error("업로드된 이미지 주소가 올바르지 않습니다.");
            }

            return imageUrl;
        }

        async function appendFiles(fileList) {
            const files = Array.from(fileList || []).filter(Boolean);
            if (!files.length) return;

            if (state.attachments.length >= MAX_IMAGES) {
                setMessage(`스크린샷은 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`, "error");
                return;
            }

            const availableSlots = Math.max(MAX_IMAGES - state.attachments.length, 0);
            const filesToUpload = files.slice(0, availableSlots);
            if (!filesToUpload.length) return;

            state.uploadInFlight = true;
            syncBusyState();
            setMessage("스크린샷을 업로드하는 중입니다.", "info");

            try {
                for (const file of filesToUpload) {
                    const url = await uploadImage(file);
                    state.attachments.push({ url: url });
                    renderPreviews();
                }

                if (files.length > filesToUpload.length) {
                    setMessage(`최대 ${MAX_IMAGES}장까지만 첨부할 수 있습니다.`, "error");
                } else {
                    setMessage(`스크린샷 ${filesToUpload.length}장을 첨부했습니다.`, "success");
                }
            } catch (error) {
                setMessage(error.message || "스크린샷 업로드 중 오류가 발생했습니다.", "error");
            } finally {
                state.uploadInFlight = false;
                syncBusyState();
            }
        }

        async function submitReport() {
            const content = String(contentInput?.value || "").trim();
            if (!content) {
                setMessage("문제 설명을 입력해 주세요.", "error");
                contentInput?.focus();
                return;
            }
            if (state.uploadInFlight) {
                setMessage("스크린샷 업로드가 끝난 뒤 접수해 주세요.", "error");
                return;
            }

            state.submitInFlight = true;
            syncBusyState();
            setMessage("버그 신고를 저장하는 중입니다.", "info");

            try {
                const res = await fetch("/api/bug-reports", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: content,
                        page_path: `${window.location.pathname}${window.location.search}`,
                        page_url: window.location.href,
                        page_title: document.title || "",
                        image_urls: state.attachments.map((item) => item.url),
                    }),
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(payload.detail || "버그 신고 접수에 실패했습니다.");
                }

                contentInput.value = "";
                state.attachments = [];
                renderPreviews();
                setMessage("버그 신고가 접수되었습니다.", "success");
                window.setTimeout(() => {
                    closeModal();
                    setMessage("", "info");
                }, 700);
            } catch (error) {
                setMessage(error.message || "버그 신고 접수에 실패했습니다.", "error");
            } finally {
                state.submitInFlight = false;
                syncBusyState();
            }
        }

        mountTriggerButton();

        triggerBtn?.addEventListener("click", openModal);
        closeBtn?.addEventListener("click", closeModal);
        cancelBtn?.addEventListener("click", closeModal);
        pickImagesBtn?.addEventListener("click", () => fileInput?.click());
        submitBtn?.addEventListener("click", submitReport);

        fileInput?.addEventListener("change", async (event) => {
            await appendFiles(event.target?.files || []);
            event.target.value = "";
        });

        contentInput?.addEventListener("paste", (event) => {
            const clipboardItems = Array.from(event.clipboardData?.items || []);
            const imageFiles = clipboardItems
                .filter((item) => String(item?.type || "").toLowerCase().startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter(Boolean);

            if (!imageFiles.length) return;
            event.preventDefault();
            appendFiles(imageFiles);
        });

        modal?.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && modal?.classList.contains("is-open")) {
                closeModal();
            }
        });

        renderPreviews();
        updateContext();
        syncBusyState();
    }

    onReady(buildWidget);
})();
