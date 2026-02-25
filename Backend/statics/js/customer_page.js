const INTRO_STATUS_OPTIONS = ["준비", "소개", "미팅", "계약협의", "완료", "보류"];

let introRows = [];
let ownedRows = [];
let pickingContext = null;
let customerMatchCurrentPage = 1;
const CUSTOMER_MATCH_PAGE_SIZE = 20;
const selectedMatchBuildingIds = new Set();
let introSearchKeyword = "";

const modal = document.getElementById("deleteModal");
const input = document.getElementById("deleteInput");
const confirmBtn = document.getElementById("confirmDeleteBtn");

let sidebarLocked = false;
let sidebarOverlay = null;
let isCustomerSidebarResizing = false;
const CUSTOMER_IMAGE_SLOTS = ["profile", "card"];
const customerImageFiles = {
    profile: [],
    card: []
};
const customerImageUrls = {
    profile: [],
    card: []
};
let currentPreviewSlot = null;
let currentPreviewIndex = -1;
let currentManageImageSlot = null;
let draggedManageImageIndex = null;

function isDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:");
}

function clearCustomerImageSlot(slot) {
    customerImageFiles[slot] = [];
    customerImageUrls[slot] = [];
    const inputEl = document.getElementById(`customerImageInput_${slot}`);
    if (inputEl) inputEl.value = "";
    renderCustomerImageBox(slot);
}

function getCustomerImageBoxId(slot) {
    if (slot === "profile") return "customerProfilePhotoBox";
    if (slot === "card") return "customerCardPhotoBox";
    return "";
}

function getCustomerImagePlaceholder(slot) {
    return slot === "profile" ? "인물 사진" : "명함 사진";
}

function normalizeSlotImagePayload(value) {
    if (Array.isArray(value)) {
        return value.filter((v) => typeof v === "string" && v.trim() !== "");
    }
    if (typeof value === "string" && value.trim() !== "") {
        return [value];
    }
    return [];
}

function extractImageNameFromUrl(url) {
    if (typeof url !== "string" || !url.trim()) return "";
    try {
        const parsed = new URL(url, window.location.origin);
        const name = parsed.pathname.split("/").pop() || "";
        return decodeURIComponent(name);
    } catch {
        const tail = url.split("/").pop() || "";
        return decodeURIComponent(tail.split("?")[0]);
    }
}

function rebuildCustomerImageFileQueue(slot) {
    const entries = Array.isArray(customerImageUrls[slot]) ? customerImageUrls[slot] : [];
    customerImageFiles[slot] = entries
        .filter((item) => item?.isLocal && item?.file)
        .map((item) => item.file);
}

function renderCustomerImageBox(slot) {
    const box = document.getElementById(getCustomerImageBoxId(slot));
    if (!box) return;

    const placeholder = getCustomerImagePlaceholder(slot);
    const entries = Array.isArray(customerImageUrls[slot]) ? customerImageUrls[slot] : [];
    if (!entries.length) {
        box.innerHTML = `<div class="w-full h-full flex items-center justify-center text-slate-400 text-[11px]">${placeholder}</div>`;
        return;
    }

    const first = entries[0];
    const visibleEntries = [first];
    const thumbs = visibleEntries.map((item, idx) => {
        return `
            <button type="button"
                onclick="openCustomerImagePreviewAt('${slot}', ${idx}); event.stopPropagation();"
                class="relative h-full bg-slate-100 border border-slate-200 rounded overflow-hidden">
                <img src="${item.url}" alt="${placeholder}" class="w-full h-full object-contain bg-white">
            </button>
        `;
    }).join("");

    box.innerHTML = `
        <div class="w-full h-full p-1 grid grid-cols-1 gap-0">
            ${thumbs}
        </div>
        <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
            ${entries.length}장
        </div>
    `;
}

function setCustomerImagesFromPayload(payload) {
    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        const urls = normalizeSlotImagePayload(payload?.[slot]);
        customerImageUrls[slot] = urls.map((src) => ({
            url: src,
            imageName: extractImageNameFromUrl(src),
            isLocal: false,
            file: null,
        }));
        customerImageFiles[slot] = [];
        renderCustomerImageBox(slot);
    });
    if (currentManageImageSlot) {
        renderCustomerImageManageList();
    }
}

// Override render to show only first image in the box and open manage modal on click.
function renderCustomerImageBox(slot) {
    const box = document.getElementById(getCustomerImageBoxId(slot));
    if (!box) return;

    const placeholder = getCustomerImagePlaceholder(slot);
    const entries = Array.isArray(customerImageUrls[slot]) ? customerImageUrls[slot] : [];
    if (!entries.length) {
        box.innerHTML = `<div class="w-full h-full flex items-center justify-center text-slate-400 text-[11px]">${placeholder}</div>`;
        return;
    }

    const first = entries[0];
    box.innerHTML = `
        <button type="button"
            onclick="openCustomerImageManageModal('${slot}'); event.stopPropagation();"
            class="absolute inset-1 bg-slate-100 border border-slate-200 rounded overflow-hidden">
            <img src="${first.url}" alt="${placeholder}" class="w-full h-full object-contain bg-white">
        </button>
        <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
            ${entries.length}
        </div>
    `;
}

function openCustomerImageManageModal(slot) {
    const modalEl = document.getElementById("customerImageManageModal");
    const titleEl = document.getElementById("customerImageManageTitle");
    if (!modalEl || !slot) return;
    currentManageImageSlot = slot;
    if (titleEl) titleEl.innerText = slot === "profile" ? "사진 이미지 등록" : "명함 이미지 등록";
    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");
    renderCustomerImageManageList();
}

function closeCustomerImageManageModal() {
    const modalEl = document.getElementById("customerImageManageModal");
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
    draggedManageImageIndex = null;
    const inputEl = document.getElementById("customerImageManageInput");
    if (inputEl) inputEl.value = "";
}

function openCustomerImageManageUploadDialog() {
    if (!currentManageImageSlot) return;
    const inputEl = document.getElementById("customerImageManageInput");
    if (!inputEl) return;
    inputEl.click();
}

async function handleCustomerImageManageUpload(inputEl) {
    if (!currentManageImageSlot) return;
    await handleCustomerImageChange(currentManageImageSlot, inputEl);
    renderCustomerImageManageList();
}

function moveCustomerImageEntry(slot, fromIndex, toIndex) {
    const entries = customerImageUrls[slot] || [];
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= entries.length || toIndex >= entries.length) return;
    const [moved] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, moved);
    customerImageUrls[slot] = entries;
    rebuildCustomerImageFileQueue(slot);
}

function handleCustomerImageDragStart(event, index) {
    if (!currentManageImageSlot) {
        event.preventDefault();
        return;
    }
    const entries = customerImageUrls[currentManageImageSlot] || [];
    if (!entries[index]) {
        event.preventDefault();
        return;
    }
    draggedManageImageIndex = index;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
    }
    event.currentTarget.classList.add("opacity-60");
}

function handleCustomerImageDragOver(event) {
    if (draggedManageImageIndex === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function handleCustomerImageDrop(event, targetIndex) {
    event.preventDefault();
    if (!currentManageImageSlot || draggedManageImageIndex === null) return;
    const fromIndex = draggedManageImageIndex;
    draggedManageImageIndex = null;
    if (fromIndex === targetIndex) return;
    moveCustomerImageEntry(currentManageImageSlot, fromIndex, targetIndex);
    renderCustomerImageManageList();
    renderCustomerImageBox(currentManageImageSlot);
}

function handleCustomerImageDragEnd(event) {
    draggedManageImageIndex = null;
    if (event?.currentTarget) event.currentTarget.classList.remove("opacity-60");
}

async function removeCustomerImageAt(index) {
    if (!currentManageImageSlot) return;
    await deleteCustomerImage(currentManageImageSlot, index);
    renderCustomerImageManageList();
}

function renderCustomerImageManageList() {
    const listEl = document.getElementById("customerImageManageList");
    if (!listEl || !currentManageImageSlot) return;
    const entries = customerImageUrls[currentManageImageSlot] || [];

    if (!entries.length) {
        listEl.innerHTML = '<p class="text-slate-400 col-span-3 text-center">등록된 이미지가 없습니다</p>';
        return;
    }

    listEl.innerHTML = entries.map((item, index) => `
        <div class="relative group bg-slate-200 border-2 border-dashed border-slate-400 overflow-hidden rounded h-32"
            draggable="true"
            data-image-index="${index}"
            ondragstart="handleCustomerImageDragStart(event, ${index})"
            ondragover="handleCustomerImageDragOver(event)"
            ondrop="handleCustomerImageDrop(event, ${index})"
            ondragend="handleCustomerImageDragEnd(event)">
            <img src="${item.url}"
                onclick="openCustomerImagePreviewAt('${currentManageImageSlot}', ${index})"
                loading="lazy"
                decoding="async"
                class="absolute inset-0 w-full h-full object-contain bg-white cursor-pointer">
            <button
                onclick="removeCustomerImageAt(${index}); event.stopPropagation();"
                class="absolute top-1 right-1 bg-black/60 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100">
                ×
            </button>
        </div>
    `).join("");
}

async function syncCustomerImageOrder(customerNumber) {
    if (!customerNumber) return;
    const orderBySlot = {};
    for (const slot of CUSTOMER_IMAGE_SLOTS) {
        const entries = customerImageUrls[slot] || [];
        if (!entries.length) continue;
        const imageNames = entries
            .map((item) => item?.imageName || extractImageNameFromUrl(item?.url))
            .filter((name) => typeof name === "string" && name.trim() !== "");
        if (!imageNames.length) continue;
        orderBySlot[slot] = imageNames;
    }

    for (const slot of CUSTOMER_IMAGE_SLOTS) {
        const imageNames = orderBySlot[slot];
        if (!imageNames?.length) continue;
        const res = await fetch(`/api/customer/${customerNumber}/images/${slot}/order`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_names: imageNames })
        });
        if (!res.ok) throw new Error("customer image order sync failed");
        await res.json();
    }
}

function setCustomerImagePreview(slot, src) {
    const box = document.getElementById(getCustomerImageBoxId(slot));
    if (!box) return;

    const placeholder = slot === "profile" ? "인물 사진" : "명함 사진";
    if (!src) {
        box.innerHTML = placeholder;
        customerImageUrls[slot] = [];
        customerImageFiles[slot] = [];
        renderCustomerImageBox(slot);
        return;
    }

    box.innerHTML = `<img src="${src}" class="w-full h-full object-cover" alt="${placeholder}">`;
    customerImageUrls[slot] = [{
        url: src,
        imageName: extractImageNameFromUrl(src),
        isLocal: isDataUrl(src),
        file: null,
    }];
    customerImageFiles[slot] = [];
    renderCustomerImageBox(slot);
}

function openCustomerImagePicker(slot) {
    const inputEl = document.getElementById(`customerImageInput_${slot}`);
    if (!inputEl) return;
    inputEl.click();
}

function handleCustomerImageBoxClick(slot) {
    openCustomerImageManageModal(slot);
}

function openCustomerImagePreview(slot, src) {
    const entries = Array.isArray(customerImageUrls[slot]) ? customerImageUrls[slot] : [];
    if (!entries.length) return;
    const idx = entries.findIndex((item) => item?.url === src);
    openCustomerImagePreviewAt(slot, idx >= 0 ? idx : 0);
}

function openCustomerImagePreviewAt(slot, index) {
    const entries = Array.isArray(customerImageUrls[slot]) ? customerImageUrls[slot] : [];
    if (!entries.length || index < 0 || index >= entries.length) return;

    const modalEl = document.getElementById("customerImagePreviewModal");
    if (!modalEl) return;
    currentPreviewSlot = slot;
    currentPreviewIndex = index;
    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");
    renderCustomerImagePreview();
}

function renderCustomerImagePreview() {
    const modalEl = document.getElementById("customerImagePreviewModal");
    const imgEl = document.getElementById("customerImagePreviewImg");
    const counterEl = document.getElementById("customerImagePreviewCounter");
    const prevBtn = document.getElementById("customerImagePreviewPrevBtn");
    const nextBtn = document.getElementById("customerImagePreviewNextBtn");
    if (!modalEl || !imgEl) return;

    const entries = currentPreviewSlot ? (customerImageUrls[currentPreviewSlot] || []) : [];
    if (!entries.length || currentPreviewIndex < 0 || currentPreviewIndex >= entries.length) {
        closeCustomerImagePreview();
        return;
    }

    imgEl.src = entries[currentPreviewIndex].url;
    if (counterEl) counterEl.innerText = `${currentPreviewIndex + 1} / ${entries.length}`;

    const disabledMove = entries.length <= 1;
    [prevBtn, nextBtn].forEach((btn) => {
        if (!btn) return;
        btn.disabled = disabledMove;
        btn.classList.toggle("opacity-40", disabledMove);
        btn.classList.toggle("cursor-not-allowed", disabledMove);
    });
}

function closeCustomerImagePreview() {
    const modalEl = document.getElementById("customerImagePreviewModal");
    const imgEl = document.getElementById("customerImagePreviewImg");
    const counterEl = document.getElementById("customerImagePreviewCounter");
    if (!modalEl || !imgEl) return;
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
    imgEl.src = "";
    if (counterEl) counterEl.innerText = "";
    currentPreviewSlot = null;
    currentPreviewIndex = -1;
}

function showPrevCustomerPreviewImage() {
    if (!currentPreviewSlot) return;
    const entries = customerImageUrls[currentPreviewSlot] || [];
    if (entries.length <= 1) return;
    currentPreviewIndex = (currentPreviewIndex - 1 + entries.length) % entries.length;
    renderCustomerImagePreview();
}

function showNextCustomerPreviewImage() {
    if (!currentPreviewSlot) return;
    const entries = customerImageUrls[currentPreviewSlot] || [];
    if (entries.length <= 1) return;
    currentPreviewIndex = (currentPreviewIndex + 1) % entries.length;
    renderCustomerImagePreview();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result || "");
        reader.onerror = () => reject(new Error("image read failed"));
        reader.readAsDataURL(file);
    });
}

async function handleCustomerImageChange(slot, inputEl) {
    const files = Array.from(inputEl?.files || []);
    if (!files.length) return;

    try {
        const localEntries = await Promise.all(files.map(async (file) => ({
            url: await readFileAsDataUrl(file),
            imageName: null,
            isLocal: true,
            file,
        })));
        customerImageUrls[slot] = [...(customerImageUrls[slot] || []), ...localEntries];
        rebuildCustomerImageFileQueue(slot);
        renderCustomerImageBox(slot);
    } catch (e) {
        console.error("customer image preview failed", e);
        alert("이미지 미리보기 실패");
    } finally {
        if (inputEl) inputEl.value = "";
    }
}

async function uploadCustomerImages(customerNumber) {
    if (!customerNumber) return;
    const desiredOrderTokensBySlot = {};
    const hasFiles = CUSTOMER_IMAGE_SLOTS.some((slot) =>
        (customerImageUrls[slot] || []).some((item) => item?.isLocal && item?.file)
    );
    if (!hasFiles) return;

    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        desiredOrderTokensBySlot[slot] = (customerImageUrls[slot] || []).map((item) => {
            const name = item?.imageName || extractImageNameFromUrl(item?.url);
            if (name) return { type: "saved", name };
            return { type: "local" };
        });
    });

    const fd = new FormData();
    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        (customerImageUrls[slot] || []).forEach((item) => {
            if (item?.isLocal && item?.file) {
                fd.append(slot, item.file);
            }
        });
    });

    const res = await fetch(`/api/customer/${customerNumber}/images`, {
        method: "POST",
        body: fd
    });
    if (!res.ok) throw new Error("customer image upload failed");
    const payload = await res.json();
    setCustomerImagesFromPayload(payload?.images || {});

    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        const serverEntries = customerImageUrls[slot] || [];
        const orderTokens = desiredOrderTokensBySlot[slot] || [];
        if (!serverEntries.length || !orderTokens.length) return;

        const nameToEntry = new Map();
        const serverNames = [];
        serverEntries.forEach((item) => {
            const name = item?.imageName || extractImageNameFromUrl(item?.url);
            if (!name) return;
            nameToEntry.set(name, item);
            serverNames.push(name);
        });
        if (!serverNames.length) return;

        const existingNames = new Set(
            orderTokens
                .filter((token) => token?.type === "saved" && token?.name)
                .map((token) => token.name)
        );
        const newNames = serverNames.filter((name) => !existingNames.has(name));

        let newNameIndex = 0;
        const orderedNames = [];
        orderTokens.forEach((token) => {
            if (token?.type === "saved" && token.name && nameToEntry.has(token.name)) {
                orderedNames.push(token.name);
                return;
            }
            if (token?.type === "local" && newNameIndex < newNames.length) {
                orderedNames.push(newNames[newNameIndex]);
                newNameIndex += 1;
            }
        });

        const used = new Set(orderedNames);
        serverNames.forEach((name) => {
            if (!used.has(name)) orderedNames.push(name);
        });

        customerImageUrls[slot] = orderedNames
            .map((name) => {
                const entry = nameToEntry.get(name);
                if (!entry) return null;
                return {
                    url: entry.url,
                    imageName: name,
                    isLocal: false,
                    file: null,
                };
            })
            .filter(Boolean);
        rebuildCustomerImageFileQueue(slot);
        renderCustomerImageBox(slot);
    });

    if (currentManageImageSlot) {
        renderCustomerImageManageList();
    }
    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        const inputEl = document.getElementById(`customerImageInput_${slot}`);
        if (inputEl) inputEl.value = "";
    });

    if (currentPreviewSlot) {
        const entries = customerImageUrls[currentPreviewSlot] || [];
        if (!entries.length) closeCustomerImagePreview();
        else {
            currentPreviewIndex = Math.min(currentPreviewIndex, entries.length - 1);
            renderCustomerImagePreview();
        }
    }
}

async function loadCustomerImages(customerNumber) {
    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        clearCustomerImageSlot(slot);
    });

    if (!customerNumber) return;
    try {
        const res = await fetch(`/api/customer/${customerNumber}/images`);
        if (!res.ok) return;
        const payload = await res.json();
        setCustomerImagesFromPayload(payload || {});
    } catch (e) {
        console.error("customer image load failed", e);
    }
}

async function deleteCustomerImage(slot, index = currentPreviewIndex) {
    if (!slot) return;
    const entries = customerImageUrls[slot] || [];
    if (!entries.length) return;

    const targetIndex = Number.isInteger(index) && index >= 0 && index < entries.length
        ? index
        : entries.length - 1;
    const target = entries[targetIndex];
    if (!target) return;

    const customerNumber = getCustomerNumberFromPath();
    const hasUnsavedLocalFile = Boolean(target?.isLocal || target?.file || isDataUrl(target?.url));

    if (!customerNumber || hasUnsavedLocalFile) {
        entries.splice(targetIndex, 1);
        rebuildCustomerImageFileQueue(slot);
        renderCustomerImageBox(slot);
        if (currentPreviewSlot === slot) {
            if (!entries.length) closeCustomerImagePreview();
            else {
                currentPreviewIndex = Math.min(targetIndex, entries.length - 1);
                renderCustomerImagePreview();
            }
        }
        return;
    }

    const imageName = target.imageName || extractImageNameFromUrl(target.url);
    if (!imageName) {
        entries.splice(targetIndex, 1);
        rebuildCustomerImageFileQueue(slot);
        renderCustomerImageBox(slot);
        if (currentPreviewSlot === slot) {
            if (!entries.length) closeCustomerImagePreview();
            else {
                currentPreviewIndex = Math.min(targetIndex, entries.length - 1);
                renderCustomerImagePreview();
            }
        }
        return;
    }

    try {
        const res = await fetch(`/api/customer/${customerNumber}/images/${slot}?image_name=${encodeURIComponent(imageName)}`, {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("customer image delete failed");

        const payload = await res.json();
        setCustomerImagesFromPayload(payload?.images || {});
        if (currentPreviewSlot === slot) {
            const updated = customerImageUrls[slot] || [];
            if (!updated.length) closeCustomerImagePreview();
            else {
                currentPreviewIndex = Math.min(targetIndex, updated.length - 1);
                renderCustomerImagePreview();
            }
        }
    } catch (e) {
        console.error("customer image delete failed", e);
        alert("Failed to delete image.");
    }
}

function applySidebarLock() {
    const sidebar = document.getElementById("rightSidebar");
    if (!sidebar || sidebarOverlay) return;

    sidebar.style.filter = "blur(10px)";
    sidebar.style.pointerEvents = "none";
    sidebar.style.userSelect = "none";

    sidebarOverlay = document.createElement("div");
    sidebarOverlay.style.position = "absolute";
    sidebarOverlay.style.inset = "0";
    sidebarOverlay.style.background = "rgba(255,255,255,0.45)";
    sidebarOverlay.style.zIndex = "999";
    sidebarOverlay.style.pointerEvents = "none";

    sidebar.style.position = "relative";
    sidebar.appendChild(sidebarOverlay);
}

function removeSidebarLock() {
    const sidebar = document.getElementById("rightSidebar");
    if (!sidebar) return;

    sidebar.style.filter = "";
    sidebar.style.pointerEvents = "";
    sidebar.style.userSelect = "";

    if (sidebarOverlay) {
        sidebarOverlay.remove();
        sidebarOverlay = null;
    }
}

function initCustomerSidebarResize() {
    const resizer = document.getElementById("customerSidebarResizer");
    const sidebar = document.getElementById("rightSidebar");
    const customerForm = document.getElementById("customerForm");
    if (!resizer || !sidebar || !customerForm) return;

    const minWidth = 360;
    const maxSidebarRatio = 0.52;
    const minMainPanelRatio = 0.40;

    const getMaxWidth = () => {
        const formWidth = customerForm.getBoundingClientRect().width;
        const maxBySidebarRatio = formWidth * maxSidebarRatio;
        const maxByMainRatio = formWidth * (1 - minMainPanelRatio);
        return Math.max(minWidth, Math.min(maxBySidebarRatio, maxByMainRatio));
    };

    const clampSidebarWidth = () => {
        const currentWidth = Math.round(sidebar.getBoundingClientRect().width);
        sidebar.style.width = `${Math.max(minWidth, Math.min(getMaxWidth(), currentWidth))}px`;
    };

    if (!sidebar.style.width) {
        sidebar.style.width = `${Math.round(sidebar.getBoundingClientRect().width)}px`;
    }
    clampSidebarWidth();

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
        if (!isCustomerSidebarResizing) return;
        const maxWidth = getMaxWidth();
        const delta = startX - e.clientX;
        const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
        sidebar.style.width = `${Math.round(nextWidth)}px`;
    };

    const onMouseUp = () => {
        if (!isCustomerSidebarResizing) return;
        isCustomerSidebarResizing = false;
        resizer.classList.remove("dragging");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
    };

    resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isCustomerSidebarResizing = true;
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        resizer.classList.add("dragging");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    });

    window.addEventListener("resize", clampSidebarWidth);
}

function nowLocalDateTimeMinute() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function normalizeDateTimeLocal(value) {
    if (!value) return nowLocalDateTimeMinute();
    const str = String(value).trim();
    if (!str) return nowLocalDateTimeMinute();

    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const dd = String(parsed.getDate()).padStart(2, "0");
        const hh = String(parsed.getHours()).padStart(2, "0");
        const mi = String(parsed.getMinutes()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return `${str}T00:00`;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
        return str.slice(0, 16);
    }

    return nowLocalDateTimeMinute();
}

function formatDateTimeForDisplay(value) {
    return normalizeDateTimeLocal(value).replace("T", " ");
}

function generateRowId() {
    return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyIntroDetail(overrides = {}) {
    return {
        detail_id: generateRowId(),
        intro_id: null,
        intro_date: nowLocalDateTimeMinute(),
        progress_status: "준비",
        intro_cost: "",
        manager_name: "",
        intro_note: "",
        ...overrides
    };
}

function createEmptyIntroRow() {
    return {
        row_id: generateRowId(),
        bd_number: "",
        address: "",
        bd_name: "",
        sale_price: "",
        price_per_pyeong: "",
        details: [createEmptyIntroDetail()],
        is_expanded: false
    };
}

function createEmptyOwnedRow() {
    return {
        row_id: generateRowId(),
        bd_number: "",
        address: "",
        bd_name: ""
    };
}

function renderStatusOptions(selected) {
    return INTRO_STATUS_OPTIONS
        .map(opt => `<option value="${opt}" ${opt === selected ? "selected" : ""}>${opt}</option>`)
        .join("");
}

function getLatestIntroCostForRow(row) {
    if (!row || !Array.isArray(row.details) || !row.details.length) return "";

    let best = null;
    row.details.forEach((detail, idx) => {
        const amountRaw = String(detail?.intro_cost || "").replace(/[^0-9]/g, "");
        if (!amountRaw) return;
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) return;

        const dtLocal = normalizeDateTimeLocal(detail?.intro_date);
        const ts = Date.parse(String(dtLocal || "").replace("T", " "));
        const timeScore = Number.isFinite(ts) ? ts : 0;

        // 화면 상단(작은 idx)을 최신 우선으로 간주
        if (!best || timeScore > best.timeScore || (timeScore === best.timeScore && idx < best.idx)) {
            best = { amount, timeScore, idx };
        }
    });

    if (!best) return "";
    return formatThousandsInputValue(String(best.amount));
}

function getLatestIntroDetailForRow(row) {
    if (!row || !Array.isArray(row.details) || !row.details.length) return null;

    let best = null;
    row.details.forEach((detail, idx) => {
        const dtLocal = normalizeDateTimeLocal(detail?.intro_date);
        const ts = Date.parse(String(dtLocal || "").replace("T", " "));
        const timeScore = Number.isFinite(ts) ? ts : 0;

        if (!best || timeScore > best.timeScore || (timeScore === best.timeScore && idx < best.idx)) {
            best = { detail, timeScore, idx };
        }
    });

    return best ? best.detail : null;
}

function getLatestIntroDateDisplayForRow(row) {
    const detail = getLatestIntroDetailForRow(row);
    return detail ? formatDateTimeForDisplay(detail.intro_date) : "-";
}

function getLatestIntroStatusForRow(row) {
    const detail = getLatestIntroDetailForRow(row);
    return detail?.progress_status || "-";
}

function getDisplaySalePriceForIntroRow(row) {
    const latestIntroCost = getLatestIntroCostForRow(row);
    if (latestIntroCost) return latestIntroCost;
    return row?.sale_price || "";
}

function refreshIntroRowSalePrice(rowId) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row) return;
    const input = document.querySelector(`[data-intro-sale-row="${rowId}"]`);
    if (!input) return;
    input.value = getDisplaySalePriceForIntroRow(row);
}

function renderIntroRows() {
    const tbody = document.getElementById("introPropertyBody");
    if (!tbody) return;
    const table = tbody.closest("table");
    const thead = table ? table.querySelector("thead") : null;
    const keyword = (introSearchKeyword || "").trim().toLowerCase();
    const filteredRows = keyword
        ? introRows.filter((row) => {
            const address = String(row?.address || "").toLowerCase();
            const bdName = String(row?.bd_name || "").toLowerCase();
            return address.includes(keyword) || bdName.includes(keyword);
        })
        : introRows;

    if (!introRows.length) {
        if (thead) thead.classList.add("hidden");
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-3 text-slate-400">소개 매물이 없습니다. [+ 추가]로 등록하세요.</td>
            </tr>
        `;
        return;
    }

    if (thead) thead.classList.remove("hidden");
    if (!filteredRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-3 text-slate-400">검색된 소개 매물이 없습니다.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredRows.map(row => `
        <tr class="border-b border-slate-200">
            <td class="p-1">
                <button type="button" onclick="openBuildingSearchModal('intro','${row.row_id}')"
                    class="px-2 py-1 text-[10px] whitespace-nowrap rounded bg-blue-600 text-white hover:bg-blue-700">검색</button>
            </td>
            <td class="p-1">
                <button type="button" onclick="openIntroBuildingFromRow('${row.row_id}')"
                    class="px-2 py-1 text-[10px] whitespace-nowrap rounded bg-emerald-600 text-white hover:bg-emerald-700">열기</button>
            </td>
            <td class="p-1 text-left">
                <input type="text" value="${row.address || ""}" readonly
                    onclick="openIntroBuildingFromRow('${row.row_id}')"
                    class="w-full min-w-0 bg-slate-50 px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                    placeholder="주소">
            </td>
            <td class="p-1 text-left">
                <input type="text" value="${row.bd_name || ""}" readonly
                    class="w-full min-w-0 bg-slate-50 px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                    style="max-width: 120px;"
                    placeholder="건물명">
            </td>
            <td class="p-1">
                <input type="text" value="${getDisplaySalePriceForIntroRow(row)}" readonly
                    data-intro-sale-row="${row.row_id}"
                    class="w-full min-w-0 bg-slate-50 px-1.5 py-1 border border-slate-200 rounded text-[11px] text-right ml-auto"
                    style="max-width: 88px;"
                    placeholder="매매가">
            </td>
            <td class="p-1 border-r">
                <div class="text-[10px] leading-4 text-slate-600 text-left mb-1">
                    <div>${getLatestIntroDateDisplayForRow(row)}</div>
                    <div class="font-bold text-blue-700">${getLatestIntroStatusForRow(row)}</div>
                </div>
            </td>
            <td class="p-1">
                <div class="flex items-center justify-center gap-1">
                    <button type="button" onclick="addIntroDetail('${row.row_id}')"
                        class="px-2 py-1 text-[11px] whitespace-nowrap rounded bg-slate-700 text-white hover:bg-slate-800">+</button>
                    <button type="button" onclick="toggleIntroDetails('${row.row_id}')"
                        class="px-2 py-1 text-[11px] whitespace-nowrap rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        title="${row.is_expanded ? "접기" : "펼치기"}">${row.is_expanded ? "▲" : "▼"}</button>
                </div>
            </td>
        </tr>
        ${row.is_expanded ? `
        <tr>
            <td colspan="7" class="p-2 bg-slate-50 border-b border-slate-200">
                ${(Array.isArray(row.details) && row.details.length)
                    ? row.details.map(detail => `
                        <div class="border border-slate-200 rounded bg-white p-2 ${detail === row.details[row.details.length - 1] ? "" : "mb-2"}">
                            <div class="grid grid-cols-[1.5fr_1fr] gap-2 items-center mb-2">
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] font-bold text-slate-600 shrink-0">날짜</span>
                                    <input type="datetime-local" value="${normalizeDateTimeLocal(detail.intro_date)}"
                                        oninput="updateIntroDetailField('${row.row_id}','${detail.detail_id}','intro_date', this.value)"
                                        class="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px] bg-white text-slate-700">
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] font-bold text-slate-600 shrink-0">소개</span>
                                    <select onchange="updateIntroDetailField('${row.row_id}','${detail.detail_id}','progress_status', this.value)"
                                        class="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px]">
                                        ${renderStatusOptions(detail.progress_status || "준비")}
                                    </select>
                                </div>
                            </div>
                            <div class="grid grid-cols-[1fr_1fr_auto] gap-2 items-center mb-2">
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] font-bold text-slate-600 shrink-0">소개금액</span>
                                    <input type="text" value="${formatThousandsInputValue(detail.intro_cost || "")}"
                                        oninput="updateIntroDetailCostField('${row.row_id}','${detail.detail_id}', this)"
                                        class="w-full min-w-0 px-1.5 py-1 border border-slate-200 rounded text-[11px] text-right"
                                        placeholder="0">
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] font-bold text-slate-600 shrink-0">담당자</span>
                                    <input type="text" value="${detail.manager_name || ""}"
                                        oninput="updateIntroDetailField('${row.row_id}','${detail.detail_id}','manager_name', this.value)"
                                        class="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                                        placeholder="담당자">
                                </div>
                                <button type="button" onclick="removeIntroDetail('${row.row_id}','${detail.detail_id}')"
                                    class="px-2 py-1 text-[11px] rounded bg-red-100 text-red-700 hover:bg-red-200 whitespace-nowrap">삭제</button>
                            </div>
                            <div class="flex items-start gap-2">
                                <span class="text-[11px] font-bold text-slate-600 shrink-0 pt-1">내용</span>
                                <textarea
                                    oninput="updateIntroDetailField('${row.row_id}','${detail.detail_id}','intro_note', this.value)"
                                    class="w-full min-w-0 px-2 py-1 border border-slate-200 rounded text-[11px] bg-white resize-y min-h-[56px] leading-4 whitespace-pre-wrap"
                                    placeholder="소개매물 관련 메모를 입력하세요">${detail.intro_note || ""}</textarea>
                            </div>
                        </div>
                    `).join("")
                    : `<div class="text-[11px] text-slate-400 px-1 py-2">상세 내역이 없습니다. 우측 + 버튼으로 추가하세요.</div>`}
            </td>
        </tr>
        ` : ""}
    `).join("");
}

function runIntroSearch() {
    const input = document.getElementById("introSearchInput");
    introSearchKeyword = (input?.value || "").trim();
    renderIntroRows();
}

function toggleIntroDetails(rowId) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row) return;
    row.is_expanded = !row.is_expanded;
    renderIntroRows();
}

function addIntroDetail(rowId) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row) return;
    if (!Array.isArray(row.details)) row.details = [];
    row.details.push(createEmptyIntroDetail());
    row.is_expanded = true;
    renderIntroRows();
}

function renderOwnedRows() {
    const tbody = document.getElementById("ownedPropertyBody");
    if (!tbody) return;

    if (!ownedRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="p-3 text-slate-400 text-center">보유 부동산이 없습니다. [+ 추가]로 등록하세요.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = ownedRows.map(row => `
        <tr>
            <td class="p-1.5">
                <div class="flex items-center justify-center gap-1">
                    <button type="button" onclick="openBuildingSearchModal('owned','${row.row_id}')"
                        class="px-2 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-700">검색</button>
                    <button type="button" onclick="openOwnedBuildingFromRow('${row.row_id}')"
                        class="px-2 py-1 text-[11px] rounded bg-emerald-600 text-white hover:bg-emerald-700">열기</button>
                </div>
            </td>
            <td class="p-2 text-left">
                <input type="text" value="${row.address || ""}"
                    oninput="updateOwnedField('${row.row_id}','address', this.value)"
                    class="w-full min-w-0 px-2 py-1 border border-slate-200 rounded text-[11px]"
                    placeholder="주소">
            </td>
            <td class="p-2 text-left">
                <input type="text" value="${row.bd_name || ""}"
                    oninput="updateOwnedField('${row.row_id}','bd_name', this.value)"
                    class="w-full min-w-0 px-2 py-1 border border-slate-200 rounded text-[11px]"
                    placeholder="건물명">
            </td>
            <td class="p-1.5">
                <button type="button" onclick="removeOwnedRow('${row.row_id}')"
                    class="px-2 py-1 text-[11px] rounded bg-red-100 text-red-700 hover:bg-red-200">삭제</button>
            </td>
        </tr>
    `).join("");
}

function addIntroRow() {
    introRows.unshift(createEmptyIntroRow());
    renderIntroRows();
}

function addOwnedRow() {
    ownedRows.push(createEmptyOwnedRow());
    renderOwnedRows();
}

function updateIntroDetailField(rowId, detailId, key, value) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row) return;
    const detail = (row.details || []).find(d => d.detail_id === detailId);
    if (!detail) return;
    detail[key] = value;
}

function updateIntroDetailCostField(rowId, detailId, inputEl) {
    if (!inputEl) return;
    const formatted = formatThousandsInputValue(inputEl.value);
    inputEl.value = formatted;
    updateIntroDetailField(rowId, detailId, "intro_cost", formatted);
    refreshIntroRowSalePrice(rowId);
}

function removeIntroDetail(rowId, detailId) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row || !Array.isArray(row.details)) return;
    row.details = row.details.filter(d => d.detail_id !== detailId);
    renderIntroRows();
}

function removeOwnedRow(rowId) {
    ownedRows = ownedRows.filter(r => r.row_id !== rowId);
    renderOwnedRows();
}

function updateOwnedField(rowId, key, value) {
    const row = ownedRows.find(r => r.row_id === rowId);
    if (!row) return;
    row[key] = value;
}

function openBuildingSearchModal(kind, rowId) {
    pickingContext = { kind, rowId };
    const modalEl = document.getElementById("buildingSearchModal");
    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");

    const keywordEl = document.getElementById("buildingSearchInput");
    keywordEl.value = "";
    keywordEl.focus();

    const resultBody = document.getElementById("buildingSearchResultBody");
    resultBody.innerHTML = "";
}

function closeBuildingSearchModal() {
    const modalEl = document.getElementById("buildingSearchModal");
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
    pickingContext = null;
}

async function searchBuildingsForIntro() {
    const q = document.getElementById("buildingSearchInput").value.trim();
    const resultBody = document.getElementById("buildingSearchResultBody");

    resultBody.innerHTML = `<tr><td colspan="6" class="p-3 text-slate-400">검색 중...</td></tr>`;

    try {
        const res = await fetch(`/api/building/quick-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("building search failed");
        const items = await res.json();

        if (!Array.isArray(items) || items.length === 0) {
            resultBody.innerHTML = `<tr><td colspan="6" class="p-3 text-slate-400">검색 결과가 없습니다.</td></tr>`;
            return;
        }

        resultBody.innerHTML = items.map(item => `
            <tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="p-2 text-center">
                    <button type="button"
                        onclick="openBuildingDetailFromSearch(${item.bd_number})"
                        class="text-blue-600 hover:text-blue-800 hover:underline font-semibold">
                        ${item.bd_number}
                    </button>
                </td>
                <td class="p-2">${item.address || "-"}</td>
                <td class="p-2">${item.bd_name || "-"}</td>
                <td class="p-2 text-right">${item.sale_price || "-"}</td>
                <td class="p-2 text-right">${item.price_per_pyeong || "-"}</td>
                <td class="p-2 text-center">
                    <button type="button" onclick="selectBuildingForCurrentRow(${item.bd_number}, '${(item.address || "").replace(/'/g, "&#39;")}', '${(item.bd_name || "").replace(/'/g, "&#39;")}', '${(item.sale_price || "").replace(/'/g, "&#39;")}', '${(item.price_per_pyeong || "").replace(/'/g, "&#39;")}')"
                        class="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700">선택</button>
                </td>
            </tr>
        `).join("");
    } catch (err) {
        console.error(err);
        resultBody.innerHTML = `<tr><td colspan="6" class="p-3 text-red-400">검색 실패</td></tr>`;
    }
}

function openBuildingDetailFromSearch(bdNumber) {
    window.open(`/detail/${bdNumber}`, "_blank");
}

function openIntroBuildingFromRow(rowId) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row || !row.bd_number) return;
    openBuildingDetailFromSearch(row.bd_number);
}

function openOwnedBuildingFromRow(rowId) {
    const row = ownedRows.find(r => r.row_id === rowId);
    if (!row || !row.bd_number) return;
    openBuildingDetailFromSearch(row.bd_number);
}

function selectBuildingForCurrentRow(bdNumber, address, bdName, salePrice, pricePerPyeong) {
    if (!pickingContext) return;

    if (pickingContext.kind === "intro") {
        const row = introRows.find(r => r.row_id === pickingContext.rowId);
        if (!row) return;
        row.bd_number = String(bdNumber);
        row.address = address;
        row.bd_name = bdName;
        row.sale_price = salePrice;
        row.price_per_pyeong = pricePerPyeong;
        renderIntroRows();
    } else if (pickingContext.kind === "owned") {
        const row = ownedRows.find(r => r.row_id === pickingContext.rowId);
        if (!row) return;
        row.bd_number = String(bdNumber);
        row.address = address;
        row.bd_name = bdName;
        renderOwnedRows();
    }

    closeBuildingSearchModal();
}

// cancel button
function handleCancel() {
    if (window.opener || window.history.length === 1) {
        window.close();
    } else {
        history.back();
    }
}

function openDeleteModal() {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    input.value = "";
    confirmBtn.disabled = true;
    input.focus();
}

function closeDeleteModal() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

input.addEventListener("input", () => {
    confirmBtn.disabled = input.value !== "DELETE";
});

function deleteBuilding() {
    const customer_number = document.getElementById("customer_number").value;
    fetch("/api/customer/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_number })
    })
        .then(res => {
            if (!res.ok) throw new Error("delete failed");
            return res.json();
        })
        .then(() => {
            alert("삭제 완료");
            location.href = "/customer/new";
        })
        .catch(err => {
            console.error(err);
            alert("삭제 중 오류");
        });
}

function confirmDelete() {
    closeDeleteModal();
    deleteBuilding();
}

function collectMatchConditions() {
    return {
        address: document.getElementById("matchAddressInput")?.value || "",
        business_area: document.getElementById("matchBusinessAreaInput")?.value || "",
        station_keyword: document.getElementById("matchStationKeyword")?.value || "",
        min_price: document.getElementById("matchMinPrice")?.value || "",
        max_price: document.getElementById("matchMaxPrice")?.value || "",
        station_walk_min: document.getElementById("matchStationWalkMin")?.value || "",
        station_walk_max: document.getElementById("matchStationWalkMax")?.value || "",
        cash_hold_manwon: document.getElementById("matchCashHoldManwon")?.value || "",
        cash_hold_percent: document.getElementById("matchCashHoldPercent")?.value || "",
        min_yield: document.getElementById("matchMinYieldInput")?.value || "",
        land_pp_min: document.getElementById("matchLandPyeongMin")?.value || "",
        land_pp_max: document.getElementById("matchLandPyeongMax")?.value || "",
        gross_pp_min: document.getElementById("matchGrossPyeongMin")?.value || "",
        gross_pp_max: document.getElementById("matchGrossPyeongMax")?.value || "",
        land_area_min: document.getElementById("matchLandAreaMin")?.value || "",
        land_area_max: document.getElementById("matchLandAreaMax")?.value || "",
        gross_area_min: document.getElementById("matchGrossAreaMin")?.value || "",
        gross_area_max: document.getElementById("matchGrossAreaMax")?.value || "",
        usable_area_min: document.getElementById("matchUsableAreaMin")?.value || "",
        usable_area_max: document.getElementById("matchUsableAreaMax")?.value || "",
        building_area_min: document.getElementById("matchBuildingAreaMin")?.value || "",
        building_area_max: document.getElementById("matchBuildingAreaMax")?.value || "",
        approval_year_min: document.getElementById("matchApprovalYearMin")?.value || "",
        road_width_min: document.getElementById("matchRoadWidthMin")?.value || "",
        elevator_option: document.getElementById("matchElevatorOption")?.value || "",
        parking_min: document.getElementById("matchParkingMin")?.value || "",
        building_status: document.getElementById("matchBuildingStatus")?.value || "전체",
        location_decide: document.getElementById("matchLocationDecide")?.value || "",
        price_decide: document.getElementById("matchPriceDecide")?.value || "",
        yield_decide: document.getElementById("matchYieldDecide")?.value || "",
        vacancy_decide: document.getElementById("matchVacancyDecide")?.value || "",
        limit_decide: document.getElementById("matchLimitDecide")?.value || "",
        loan_decide: document.getElementById("matchLoanDecide")?.value || "",
        types: Array.from(document.querySelectorAll('input[name="matchType"]:checked')).map((el) => el.value),
        zoning_categories: Array.from(document.querySelectorAll('input[name="matchZoningCategory"]:checked')).map((el) => el.value),
        usage_categories: Array.from(document.querySelectorAll('input[name="matchUsageCategory"]:checked')).map((el) => el.value),
    };
}

function applyMatchConditions(saved) {
    if (!saved || typeof saved !== "object") return;

    const setInputValue = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value ?? "";
    };

    setInputValue("matchAddressInput", saved.address);
    setInputValue("matchBusinessAreaInput", saved.business_area);
    setInputValue("matchStationKeyword", saved.station_keyword);
    setInputValue("matchMinPrice", saved.min_price);
    setInputValue("matchMaxPrice", saved.max_price);
    setInputValue("matchStationWalkMin", saved.station_walk_min);
    setInputValue("matchStationWalkMax", saved.station_walk_max);
    setInputValue("matchCashHoldManwon", saved.cash_hold_manwon ?? saved.cash_hold_eok);
    setInputValue("matchCashHoldPercent", saved.cash_hold_percent);
    setInputValue("matchMinYieldInput", saved.min_yield);
    setInputValue("matchLandPyeongMin", saved.land_pp_min);
    setInputValue("matchLandPyeongMax", saved.land_pp_max);
    setInputValue("matchGrossPyeongMin", saved.gross_pp_min);
    setInputValue("matchGrossPyeongMax", saved.gross_pp_max);
    setInputValue("matchLandAreaMin", saved.land_area_min);
    setInputValue("matchLandAreaMax", saved.land_area_max);
    setInputValue("matchGrossAreaMin", saved.gross_area_min);
    setInputValue("matchGrossAreaMax", saved.gross_area_max);
    setInputValue("matchUsableAreaMin", saved.usable_area_min);
    setInputValue("matchUsableAreaMax", saved.usable_area_max);
    setInputValue("matchBuildingAreaMin", saved.building_area_min);
    setInputValue("matchBuildingAreaMax", saved.building_area_max);
    setInputValue("matchApprovalYearMin", saved.approval_year_min);
    setInputValue("matchRoadWidthMin", saved.road_width_min);
    setInputValue("matchElevatorOption", saved.elevator_option);
    setInputValue("matchParkingMin", saved.parking_min);
    setInputValue("matchBuildingStatus", saved.building_status || "전체");
    setInputValue("matchLocationDecide", saved.location_decide);
    setInputValue("matchPriceDecide", saved.price_decide);
    setInputValue("matchYieldDecide", saved.yield_decide);
    setInputValue("matchVacancyDecide", saved.vacancy_decide);
    setInputValue("matchLimitDecide", saved.limit_decide);
    setInputValue("matchLoanDecide", saved.loan_decide);

    const applyChecked = (selector, values) => {
        const selected = new Set(Array.isArray(values) ? values : []);
        document.querySelectorAll(selector).forEach((el) => {
            el.checked = selected.has(el.value);
        });
    };

    applyChecked('input[name="matchType"]', saved.types);
    applyChecked('input[name="matchZoningCategory"]', saved.zoning_categories);
    applyChecked('input[name="matchUsageCategory"]', saved.usage_categories);
}

function buildSavePayload() {
    const formElement = document.getElementById("customerForm");
    const formData = new FormData(formElement);
    const data_detail = Object.fromEntries(formData.entries());
    data_detail.match_conditions_json = JSON.stringify(collectMatchConditions());

    const intro_properties = introRows
        .filter(row => row.bd_number)
        .flatMap(row => (Array.isArray(row.details) ? row.details : [])
            .map(detail => ({
                intro_id: detail.intro_id || null,
                intro_date: detail.intro_date || nowLocalDateTimeMinute(),
                progress_status: detail.progress_status || "준비",
                intro_cost: detail.intro_cost || "",
                manager_name: detail.manager_name || "",
                bd_number: Number(row.bd_number),
                address: row.address || "",
                bd_name: row.bd_name || "",
                sale_price: row.sale_price || "",
                price_per_pyeong: row.price_per_pyeong || "",
                intro_note: detail.intro_note || ""
            })));

    data_detail.owned_properties_json = JSON.stringify(
        ownedRows
            .filter(row => row.bd_number || row.address || row.bd_name)
            .map(row => ({
                bd_number: row.bd_number ? Number(row.bd_number) : null,
                address: row.address || "",
                bd_name: row.bd_name || ""
            }))
    );

    return { data_detail, intro_properties };
}

// save button
async function saveBuildingDetail() {
    const updatedData = buildSavePayload();
    const customer_number = updatedData.data_detail.customer_number;
    const isNew = !customer_number || customer_number === "new";

    const method = isNew ? "POST" : "PUT";
    const url = isNew ? "/api/customer" : `/api/customer/${customer_number}`;

    try {
        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedData)
        });

        if (!res.ok) throw new Error("save failed");

        const result = await res.json();
        const savedCustomerNumber = isNew ? result.customer_number : customer_number;
        await uploadCustomerImages(savedCustomerNumber);
        await syncCustomerImageOrder(savedCustomerNumber);

        alert("저장 완료");

        if (isNew) {
            location.href = `/customer/${savedCustomerNumber}`;
        } else {
            await loadCustomerDetail();
        }
    } catch (err) {
        console.error(err);
        alert("저장 중 오류");
    }
}

function getCustomerNumberFromPath() {
    const match = window.location.pathname.match(/^\/customer\/(\d+)$/);
    return match ? match[1] : null;
}

function bindCustomerToForm(dataDetail) {
    if (!dataDetail) return;

    Object.entries(dataDetail).forEach(([key, value]) => {
        const el = document.getElementById(key);
        if (!el) return;
        el.value = value ?? "";
    });

    const desiredPriceEl = document.getElementById("desired_price_manwon");
    if (desiredPriceEl && desiredPriceEl.value) {
        desiredPriceEl.value = formatThousandsInputValue(desiredPriceEl.value);
    }
}

function bindIntroRows(introList) {
    if (!Array.isArray(introList)) {
        introRows = [];
        renderIntroRows();
        return;
    }

    const grouped = new Map();
    introList.forEach((item) => {
        const key = item?.bd_number !== null && item?.bd_number !== undefined
            ? String(item.bd_number)
            : `nogroup_${item?.intro_id ?? generateRowId()}`;

        if (!grouped.has(key)) {
            grouped.set(key, {
                row_id: generateRowId(),
                bd_number: item?.bd_number !== null && item?.bd_number !== undefined ? String(item.bd_number) : "",
                address: item?.address || "",
                bd_name: item?.bd_name || "",
                sale_price: item?.sale_price || "",
                price_per_pyeong: item?.price_per_pyeong || "",
                details: [],
                is_expanded: false
            });
        }

        const row = grouped.get(key);
        row.details.push(createEmptyIntroDetail({
            detail_id: generateRowId(),
            intro_id: item?.intro_id ?? null,
            intro_date: normalizeDateTimeLocal(item?.intro_date),
            progress_status: item?.progress_status || "준비",
            intro_cost: item?.intro_cost || "",
            manager_name: item?.manager_name || "",
            intro_note: item?.intro_note || ""
        }));
    });

    introRows = Array.from(grouped.values());

    renderIntroRows();
}

function bindOwnedRows(rawOwned) {
    if (!rawOwned) {
        ownedRows = [];
        renderOwnedRows();
        return;
    }

    let parsed = rawOwned;
    if (typeof rawOwned === "string") {
        try {
            parsed = JSON.parse(rawOwned);
        } catch (e) {
            console.error("owned properties parse failed", e);
            parsed = [];
        }
    }

    if (!Array.isArray(parsed)) {
        ownedRows = [];
        renderOwnedRows();
        return;
    }

    ownedRows = parsed.map(item => ({
        row_id: generateRowId(),
        bd_number: item?.bd_number !== null && item?.bd_number !== undefined ? String(item.bd_number) : "",
        address: item?.address || "",
        bd_name: item?.bd_name || ""
    }));

    renderOwnedRows();
}

async function loadCustomerDetail() {
    const customerNumber = getCustomerNumberFromPath();
    if (!customerNumber) {
        const idInput = document.getElementById("customer_number");
        if (idInput && !idInput.value) idInput.value = "new";
        introRows = [];
        ownedRows = [];
        renderIntroRows();
        renderOwnedRows();
        await loadCustomerImages(null);
        return;
    }

    try {
        const res = await fetch(`/api/customer/${customerNumber}`);
        if (!res.ok) throw new Error("customer load failed");

        const payload = await res.json();
        bindCustomerToForm(payload.data_detail || payload);
        const rawMatch = payload?.data_detail?.match_conditions_json;
        if (rawMatch) {
            try {
                applyMatchConditions(JSON.parse(rawMatch));
            } catch (e) {
                console.error("match condition parse failed", e);
            }
        }
        bindIntroRows(payload.intro_properties || []);
        bindOwnedRows(payload?.data_detail?.owned_properties_json || "[]");
        await loadCustomerImages(customerNumber);
    } catch (err) {
        console.error(err);
        alert("고객 정보 로드 실패");
    }
}

function getMatchResultBody() {
    return document.getElementById("customerMatchResultBody")
        || document.querySelector(".section-card.flex-1.flex.flex-col.bg-white tbody");
}

function getMatchAddressInput() {
    return document.getElementById("matchAddressInput")
        || document.querySelector('input[placeholder*="주소"]');
}

function getMatchMinPriceInput() {
    return document.getElementById("matchMinPrice")
        || document.querySelector('input[placeholder*="80"]');
}

function getMatchMaxPriceInput() {
    return document.getElementById("matchMaxPrice");
}

function setCustomerMatchCount(count) {
    const el = document.getElementById("customerMatchCount");
    if (!el) return;
    const safe = Number.isFinite(Number(count)) ? Number(count) : 0;
    el.textContent = `(${safe.toLocaleString()}건)`;
}

function refreshCustomerMatchDownloadButton() {
    const btn = document.getElementById("customerMatchDownloadBtn");
    if (!btn) return;
    const selectedCount = selectedMatchBuildingIds.size;
    btn.textContent = selectedCount > 0
        ? `[매칭결과 자료 다운로드 (${selectedCount}건 선택)]`
        : "[매칭결과 자료 다운로드]";
}

function toggleMatchBuildingSelection(bdNumber, checked) {
    const id = Number(bdNumber);
    if (!Number.isFinite(id)) return;
    if (checked) selectedMatchBuildingIds.add(id);
    else selectedMatchBuildingIds.delete(id);
    refreshCustomerMatchDownloadButton();
}

async function downloadSelectedMatchPpt() {
    const ids = Array.from(selectedMatchBuildingIds);
    if (!ids.length) {
        alert("먼저 매칭 결과에서 건물을 선택해 주세요.");
        return;
    }
    try {
        const res = await fetch("/api/building/compare-ppt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bd_numbers: ids })
        });
        if (!res.ok) throw new Error("download failed");

        const blob = await res.blob();
        const cd = res.headers.get("content-disposition") || "";
        const filenameStarMatch = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        const filenameMatch = cd.match(/filename\s*=\s*\"?([^\";]+)\"?/i);
        const filename = filenameStarMatch
            ? decodeURIComponent(filenameStarMatch[1])
            : (filenameMatch ? decodeURIComponent(filenameMatch[1]) : `[ERA]매매물건비교표_${Date.now()}.pptx`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        alert("매칭결과 자료 다운로드 중 오류가 발생했습니다.");
    }
}

function renderCustomerMatchPagination(totalPages, currentPage) {
    const container = document.getElementById("customerMatchPagination");
    if (!container) return;

    if (!totalPages || totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    const blockStart = Math.floor((Math.max(1, currentPage) - 1) / 5) * 5 + 1;
    const startPage = blockStart;
    const endPage = Math.min(totalPages, startPage + 4);

    const pages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
    const firstDisabled = currentPage === 1;
    const nextPage = blockStart + 5;
    const nextDisabled = nextPage > totalPages;

    container.innerHTML = `
        <button type="button"
            onclick="${firstDisabled ? "" : "searchCustomerMatchBuildings(1)"}"
            ${firstDisabled ? "disabled" : ""}
            class="px-3 py-1.5 text-[12px] rounded-xl border ${firstDisabled ? "bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}">
            <<
        </button>
        ${pages.map((page) => `
            <button type="button"
                onclick="searchCustomerMatchBuildings(${page})"
                class="px-3 py-1.5 text-[12px] rounded-xl border ${page === currentPage ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}">
                ${page}
            </button>
        `).join("")}
        <button type="button"
            onclick="${nextDisabled ? "" : `searchCustomerMatchBuildings(${nextPage})`}"
            ${nextDisabled ? "disabled" : ""}
            class="px-3 py-1.5 text-[12px] rounded-xl border ${nextDisabled ? "bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}">
            다음
        </button>
    `;
}

function formatThousandsInputValue(raw) {
    const digits = String(raw || "").replace(/[^0-9]/g, "");
    if (!digits) return "";
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function openBuildingDetail(bdNumber) {
    window.open(`/detail/${bdNumber}`, "_blank");
}

async function searchCustomerMatchBuildings(page = 1) {
    customerMatchCurrentPage = page;
    const tbody = getMatchResultBody();
    if (!tbody) return;

    const addressInput = getMatchAddressInput();
    const businessAreaInput = document.getElementById("matchBusinessAreaInput");
    const stationKeywordInput = document.getElementById("matchStationKeyword");
    const minPriceInput = getMatchMinPriceInput();
    const maxPriceInput = getMatchMaxPriceInput();
    const stationWalkMinInput = document.getElementById("matchStationWalkMin");
    const stationWalkMaxInput = document.getElementById("matchStationWalkMax");
    const cashHoldManwonInput = document.getElementById("matchCashHoldManwon");
    const cashHoldPercentInput = document.getElementById("matchCashHoldPercent");
    const minYieldInput = document.getElementById("matchMinYieldInput");
    const landMinInput = document.getElementById("matchLandPyeongMin");
    const landMaxInput = document.getElementById("matchLandPyeongMax");
    const grossMinInput = document.getElementById("matchGrossPyeongMin");
    const grossMaxInput = document.getElementById("matchGrossPyeongMax");
    const landAreaMinInput = document.getElementById("matchLandAreaMin");
    const landAreaMaxInput = document.getElementById("matchLandAreaMax");
    const grossAreaMinInput = document.getElementById("matchGrossAreaMin");
    const grossAreaMaxInput = document.getElementById("matchGrossAreaMax");
    const usableAreaMinInput = document.getElementById("matchUsableAreaMin");
    const usableAreaMaxInput = document.getElementById("matchUsableAreaMax");
    const buildingAreaMinInput = document.getElementById("matchBuildingAreaMin");
    const buildingAreaMaxInput = document.getElementById("matchBuildingAreaMax");
    const approvalYearMinInput = document.getElementById("matchApprovalYearMin");
    const roadWidthMinInput = document.getElementById("matchRoadWidthMin");
    const elevatorOptionInput = document.getElementById("matchElevatorOption");
    const parkingMinInput = document.getElementById("matchParkingMin");
    const buildingStatusInput = document.getElementById("matchBuildingStatus");
    const locationDecideInput = document.getElementById("matchLocationDecide");
    const priceDecideInput = document.getElementById("matchPriceDecide");
    const yieldDecideInput = document.getElementById("matchYieldDecide");
    const vacancyDecideInput = document.getElementById("matchVacancyDecide");
    const limitDecideInput = document.getElementById("matchLimitDecide");
    const loanDecideInput = document.getElementById("matchLoanDecide");
    const checkedTypes = Array.from(document.querySelectorAll('input[name="matchType"]:checked'))
        .map(el => el.value);
    const checkedZoningCategories = Array.from(document.querySelectorAll('input[name="matchZoningCategory"]:checked'))
        .map(el => el.value);
    const checkedUsageCategories = Array.from(document.querySelectorAll('input[name="matchUsageCategory"]:checked'))
        .map(el => el.value);

    const address = (addressInput?.value || "").trim();
    const businessArea = (businessAreaInput?.value || "").trim();
    const stationKeyword = (stationKeywordInput?.value || "").trim();
    const minPriceRaw = (minPriceInput?.value || "").replace(/[^0-9]/g, "");
    const maxPriceRaw = (maxPriceInput?.value || "").replace(/[^0-9]/g, "");
    const minPrice = minPriceRaw ? Number(minPriceRaw) : null;
    const maxPrice = maxPriceRaw ? Number(maxPriceRaw) : null;
    const stationWalkMinRaw = (stationWalkMinInput?.value || "").replace(/[^0-9.]/g, "");
    const stationWalkMaxRaw = (stationWalkMaxInput?.value || "").replace(/[^0-9.]/g, "");
    const stationWalkMin = stationWalkMinRaw ? Number(stationWalkMinRaw) : null;
    const stationWalkMax = stationWalkMaxRaw ? Number(stationWalkMaxRaw) : null;
    const cashHoldManwonRaw = (cashHoldManwonInput?.value || "").replace(/[^0-9.]/g, "");
    const cashHoldPercentRaw = (cashHoldPercentInput?.value || "").replace(/[^0-9.]/g, "");
    const cashHoldManwon = cashHoldManwonRaw ? Number(cashHoldManwonRaw) : null;
    const cashHoldPercent = cashHoldPercentRaw ? Number(cashHoldPercentRaw) : null;
    const minYieldRaw = (minYieldInput?.value || "").replace(/[^0-9.]/g, "");
    const minYield = minYieldRaw ? Number(minYieldRaw) : null;
    const landMinRaw = (landMinInput?.value || "").replace(/[^0-9]/g, "");
    const landMaxRaw = (landMaxInput?.value || "").replace(/[^0-9]/g, "");
    const grossMinRaw = (grossMinInput?.value || "").replace(/[^0-9]/g, "");
    const grossMaxRaw = (grossMaxInput?.value || "").replace(/[^0-9]/g, "");
    const landAreaMinRaw = (landAreaMinInput?.value || "").replace(/[^0-9]/g, "");
    const landAreaMaxRaw = (landAreaMaxInput?.value || "").replace(/[^0-9]/g, "");
    const grossAreaMinRaw = (grossAreaMinInput?.value || "").replace(/[^0-9]/g, "");
    const grossAreaMaxRaw = (grossAreaMaxInput?.value || "").replace(/[^0-9]/g, "");
    const usableAreaMinRaw = (usableAreaMinInput?.value || "").replace(/[^0-9]/g, "");
    const usableAreaMaxRaw = (usableAreaMaxInput?.value || "").replace(/[^0-9]/g, "");
    const buildingAreaMinRaw = (buildingAreaMinInput?.value || "").replace(/[^0-9]/g, "");
    const buildingAreaMaxRaw = (buildingAreaMaxInput?.value || "").replace(/[^0-9]/g, "");
    const approvalYearText = (approvalYearMinInput?.value || "").trim();
    const approvalYearMatch = approvalYearText.match(/(19|20)\d{2}/);
    const roadWidthMinRaw = (roadWidthMinInput?.value || "").replace(/[^0-9.]/g, "");
    const parkingMinRaw = (parkingMinInput?.value || "").replace(/[^0-9]/g, "");
    const elevatorOption = (elevatorOptionInput?.value || "").trim();
    const landMin = landMinRaw ? Number(landMinRaw) : null;
    const landMax = landMaxRaw ? Number(landMaxRaw) : null;
    const grossMin = grossMinRaw ? Number(grossMinRaw) : null;
    const grossMax = grossMaxRaw ? Number(grossMaxRaw) : null;
    const landAreaMin = landAreaMinRaw ? Number(landAreaMinRaw) : null;
    const landAreaMax = landAreaMaxRaw ? Number(landAreaMaxRaw) : null;
    const grossAreaMin = grossAreaMinRaw ? Number(grossAreaMinRaw) : null;
    const grossAreaMax = grossAreaMaxRaw ? Number(grossAreaMaxRaw) : null;
    const usableAreaMin = usableAreaMinRaw ? Number(usableAreaMinRaw) : null;
    const usableAreaMax = usableAreaMaxRaw ? Number(usableAreaMaxRaw) : null;
    const buildingAreaMin = buildingAreaMinRaw ? Number(buildingAreaMinRaw) : null;
    const buildingAreaMax = buildingAreaMaxRaw ? Number(buildingAreaMaxRaw) : null;
    const approvalYearMin = approvalYearMatch ? Number(approvalYearMatch[0]) : null;
    const roadWidthMin = roadWidthMinRaw ? Number(roadWidthMinRaw) : null;
    const parkingMin = parkingMinRaw ? Number(parkingMinRaw) : null;
    const buildingStatus = (buildingStatusInput?.value || "전체").trim();
    const locationDecide = (locationDecideInput?.value || "").trim();
    const priceDecide = (priceDecideInput?.value || "").trim();
    const yieldDecide = (yieldDecideInput?.value || "").trim();
    const vacancyDecide = (vacancyDecideInput?.value || "").trim();
    const limitDecide = (limitDecideInput?.value || "").trim();
    const loanDecide = (loanDecideInput?.value || "").trim();
    const useMinYield = minYield !== null && !Number.isNaN(minYield);
    const hasAnyCondition = Boolean(address)
        || Boolean(businessArea)
        || Boolean(stationKeyword)
        || (minPrice !== null && !Number.isNaN(minPrice))
        || (maxPrice !== null && !Number.isNaN(maxPrice))
        || (stationWalkMin !== null && !Number.isNaN(stationWalkMin))
        || (stationWalkMax !== null && !Number.isNaN(stationWalkMax))
        || (cashHoldManwon !== null && !Number.isNaN(cashHoldManwon))
        || (cashHoldPercent !== null && !Number.isNaN(cashHoldPercent))
        || checkedTypes.length > 0
        || useMinYield
        || (landMin !== null && !Number.isNaN(landMin))
        || (landMax !== null && !Number.isNaN(landMax))
        || (grossMin !== null && !Number.isNaN(grossMin))
        || (grossMax !== null && !Number.isNaN(grossMax))
        || (landAreaMin !== null && !Number.isNaN(landAreaMin))
        || (landAreaMax !== null && !Number.isNaN(landAreaMax))
        || (grossAreaMin !== null && !Number.isNaN(grossAreaMin))
        || (grossAreaMax !== null && !Number.isNaN(grossAreaMax))
        || (usableAreaMin !== null && !Number.isNaN(usableAreaMin))
        || (usableAreaMax !== null && !Number.isNaN(usableAreaMax))
        || (buildingAreaMin !== null && !Number.isNaN(buildingAreaMin))
        || (buildingAreaMax !== null && !Number.isNaN(buildingAreaMax))
        || (approvalYearMin !== null && !Number.isNaN(approvalYearMin))
        || (roadWidthMin !== null && !Number.isNaN(roadWidthMin))
        || Boolean(elevatorOption)
        || (parkingMin !== null && !Number.isNaN(parkingMin))
        || (buildingStatus && buildingStatus !== "전체")
        || Boolean(locationDecide)
        || Boolean(priceDecide)
        || Boolean(yieldDecide)
        || Boolean(vacancyDecide)
        || Boolean(limitDecide)
        || Boolean(loanDecide)
        || checkedZoningCategories.length > 0
        || checkedUsageCategories.length > 0;

    if (!hasAnyCondition) {
        tbody.innerHTML = '<div class="py-6 text-slate-400 text-center">최소 1개 이상 조건을 선택/입력해 주세요.</div>';
        setCustomerMatchCount(0);
        renderCustomerMatchPagination(0, 1);
        return;
    }

    const params = new URLSearchParams();
    if (address) params.set("address", address);
    if (businessArea) params.set("business_area", businessArea);
    if (stationKeyword) params.set("station_keyword", stationKeyword);
    if (minPrice !== null && !Number.isNaN(minPrice)) params.set("min_price", String(minPrice));
    if (maxPrice !== null && !Number.isNaN(maxPrice)) params.set("max_price", String(maxPrice));
    if (stationWalkMin !== null && !Number.isNaN(stationWalkMin)) params.set("station_walk_min", String(stationWalkMin));
    if (stationWalkMax !== null && !Number.isNaN(stationWalkMax)) params.set("station_walk_max", String(stationWalkMax));
    if (cashHoldManwon !== null && !Number.isNaN(cashHoldManwon)) params.set("cash_hold_manwon", String(cashHoldManwon));
    if (cashHoldPercent !== null && !Number.isNaN(cashHoldPercent)) params.set("cash_hold_percent", String(cashHoldPercent));
    if (useMinYield) params.set("min_yield", String(minYield));
    if (landMin !== null && !Number.isNaN(landMin)) params.set("land_pp_min", String(landMin));
    if (landMax !== null && !Number.isNaN(landMax)) params.set("land_pp_max", String(landMax));
    if (grossMin !== null && !Number.isNaN(grossMin)) params.set("gross_pp_min", String(grossMin));
    if (grossMax !== null && !Number.isNaN(grossMax)) params.set("gross_pp_max", String(grossMax));
    if (landAreaMin !== null && !Number.isNaN(landAreaMin)) params.set("land_area_min", String(landAreaMin));
    if (landAreaMax !== null && !Number.isNaN(landAreaMax)) params.set("land_area_max", String(landAreaMax));
    if (grossAreaMin !== null && !Number.isNaN(grossAreaMin)) params.set("gross_area_min", String(grossAreaMin));
    if (grossAreaMax !== null && !Number.isNaN(grossAreaMax)) params.set("gross_area_max", String(grossAreaMax));
    if (usableAreaMin !== null && !Number.isNaN(usableAreaMin)) params.set("usable_area_min", String(usableAreaMin));
    if (usableAreaMax !== null && !Number.isNaN(usableAreaMax)) params.set("usable_area_max", String(usableAreaMax));
    if (buildingAreaMin !== null && !Number.isNaN(buildingAreaMin)) params.set("building_area_min", String(buildingAreaMin));
    if (buildingAreaMax !== null && !Number.isNaN(buildingAreaMax)) params.set("building_area_max", String(buildingAreaMax));
    if (approvalYearMin !== null && !Number.isNaN(approvalYearMin)) params.set("approval_year_min", String(approvalYearMin));
    if (roadWidthMin !== null && !Number.isNaN(roadWidthMin)) params.set("road_width_min", String(roadWidthMin));
    if (elevatorOption) params.set("elevator_option", elevatorOption);
    if (parkingMin !== null && !Number.isNaN(parkingMin)) params.set("parking_min", String(parkingMin));
    if (buildingStatus && buildingStatus !== "전체") params.set("building_status", buildingStatus);
    if (locationDecide) params.set("location_decide", locationDecide);
    if (priceDecide) params.set("price_decide", priceDecide);
    if (yieldDecide) params.set("yield_decide", yieldDecide);
    if (vacancyDecide) params.set("vacancy_decide", vacancyDecide);
    if (limitDecide) params.set("limit_decide", limitDecide);
    if (loanDecide) params.set("loan_decide", loanDecide);
    if (checkedZoningCategories.length) params.set("zoning_categories", checkedZoningCategories.join(","));
    if (checkedUsageCategories.length) params.set("usage_categories", checkedUsageCategories.join(","));
    if (checkedTypes.length) params.set("types", checkedTypes.join(","));
    const customerNumber = getCustomerNumberFromPath();
    if (customerNumber) {
        params.set("customer_number", String(customerNumber));
        params.set("exclude_intro", "true");
    }
    params.set("page", String(customerMatchCurrentPage));
    params.set("page_size", String(CUSTOMER_MATCH_PAGE_SIZE));

    tbody.innerHTML = '<div class="py-6 text-slate-400 text-center">검색 중...</div>';

    try {
        const res = await fetch(`/api/customer/match-search?${params.toString()}`);
        if (!res.ok) throw new Error("match search failed");
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : []);
        const totalCount = Array.isArray(payload) ? items.length : Number(payload.total_count ?? items.length);
        const totalPages = Array.isArray(payload) ? 1 : Number(payload.total_pages || 1);
        const currentPage = Array.isArray(payload) ? customerMatchCurrentPage : Number(payload.page || customerMatchCurrentPage);

        if (!Array.isArray(items) || items.length === 0) {
            tbody.innerHTML = '<div class="py-6 text-slate-400 text-center">조건에 맞는 매물이 없습니다.</div>';
            setCustomerMatchCount(totalCount || 0);
            renderCustomerMatchPagination(0, 1);
            return;
        }

        tbody.innerHTML = items.map(item => `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer hover:border-blue-300" onclick="openBuildingDetail(${item.bd_number})">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <label class="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-white border border-slate-200 rounded px-2 py-1" onclick="event.stopPropagation()">
                            <input type="checkbox"
                                ${selectedMatchBuildingIds.has(Number(item.bd_number)) ? "checked" : ""}
                                onchange="toggleMatchBuildingSelection(${item.bd_number}, this.checked)">
                            선택
                        </label>
                        <span class="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded">ID: ${item.bd_number || "-"}</span>
                        <span class="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-1 rounded">FLAG: ${[
                            item.location_decide,
                            item.price_decide,
                            item.yield_decide,
                            item.vacancy_decide,
                            item.limit_decide,
                            item.loan_decide
                        ].map(v => (v === "\uC120\uD0DD" || !v ? "N" : v)).join("")}</span>
                    </div>
                    <span class="text-sm text-slate-400">\uC0C8 \uCC3D\uC5D0\uC11C \uC0C1\uC138\uC815\uBCF4 \u2197</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-1 text-[13px] text-slate-700">
                    <p>\uC8FC\uC18C: ${item.address || "-"}</p>
                    <p>\uAC74\uBB3C\uBA85: ${item.bd_name || "-"}</p>
                    <p>\uB9E4\uB9E4\uAC00: ${item.sale_price || "-"}</p>
                    <p>\uC0C1\uD0DC: ${item.status || "-"}</p>
                    <p>\uC218\uC775\uB960: ${item.yield_rate || "-"}</p>
                    <p>\uB300\uC9C0 \uD3C9: ${item.land_area_pyeong || "-"}</p>
                    <p>\uC5F0\uBA74\uC801 \uD3C9: ${item.gross_area_pyeong || "-"}</p>
                    <p>\uC6A9\uB3C4\uC9C0\uC5ED(\uD1A0\uC9C0): ${item.zoning_type || "-"}</p>
                    <p>\uC2B9\uC778\uB0A0\uC9DC: ${item.approval_date || "-"}</p>
                    <p>\uC2B9\uAC15\uAE30: ${item.elevator || "-"}</p>
                    <p>\uC8FC\uCC28\uB300\uC218: ${item.parking_capacity || "-"}</p>
                </div>
            </div>
        `).join("");
        setCustomerMatchCount(totalCount || items.length);
        renderCustomerMatchPagination(totalPages, currentPage);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<div class="py-6 text-red-400 text-center">검색 중 오류가 발생했습니다.</div>';
        setCustomerMatchCount(0);
        renderCustomerMatchPagination(0, 1);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (window.opener && typeof window.opener.isLocked !== "undefined") {
        sidebarLocked = Boolean(window.opener.isLocked);
    }
    if (sidebarLocked) {
        applySidebarLock();
    } else {
        removeSidebarLock();
    }
    initCustomerSidebarResize();

    loadCustomerDetail();

    const customerForm = document.getElementById("customerForm");
    if (customerForm) {
        customerForm.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            const tag = (e.target?.tagName || "").toLowerCase();
            if (tag === "textarea") return;
            e.preventDefault();
        });
    }

    const addBtn = document.getElementById("addIntroRowBtn");
    if (addBtn) addBtn.addEventListener("click", addIntroRow);
    const introSearchBtn = document.getElementById("introSearchBtn");
    if (introSearchBtn) introSearchBtn.addEventListener("click", runIntroSearch);
    const introSearchInput = document.getElementById("introSearchInput");
    if (introSearchInput) {
        introSearchInput.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            runIntroSearch();
        });
    }
    const addOwnedBtn = document.getElementById("addOwnedRowBtn");
    if (addOwnedBtn) addOwnedBtn.addEventListener("click", addOwnedRow);

    const searchBtn = document.getElementById("buildingSearchBtn");
    if (searchBtn) searchBtn.addEventListener("click", searchBuildingsForIntro);

    const closeBtn = document.getElementById("buildingSearchCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeBuildingSearchModal);

    const searchInput = document.getElementById("buildingSearchInput");
    if (searchInput) {
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                searchBuildingsForIntro();
            }
        });
    }

    const customerMatchSearchBtn = document.getElementById("customerMatchSearchBtn");
    if (customerMatchSearchBtn) {
        customerMatchSearchBtn.addEventListener("click", () => searchCustomerMatchBuildings(1));
    }
    const customerMatchDownloadBtn = document.getElementById("customerMatchDownloadBtn");
    if (customerMatchDownloadBtn) {
        customerMatchDownloadBtn.addEventListener("click", downloadSelectedMatchPpt);
    }

    CUSTOMER_IMAGE_SLOTS.forEach((slot) => {
        const inputEl = document.getElementById(`customerImageInput_${slot}`);
        if (!inputEl) return;
        inputEl.addEventListener("change", (e) => handleCustomerImageChange(slot, e.target));
    });

    const previewCloseBtn = document.getElementById("customerImagePreviewCloseBtn");
    if (previewCloseBtn) {
        previewCloseBtn.addEventListener("click", closeCustomerImagePreview);
    }
    const previewReplaceBtn = document.getElementById("customerImageReplaceBtn");
    if (previewReplaceBtn) {
        previewReplaceBtn.addEventListener("click", () => {
            const slotToReplace = currentPreviewSlot;
            if (!slotToReplace) return;
            closeCustomerImagePreview();
            openCustomerImageManageModal(slotToReplace);
        });
    }
    const previewDeleteBtn = document.getElementById("customerImageDeleteBtn");
    if (previewDeleteBtn) {
        previewDeleteBtn.addEventListener("click", async () => {
            const slotToDelete = currentPreviewSlot;
            if (!slotToDelete) return;
            await deleteCustomerImage(slotToDelete);
        });
    }
    const previewPrevBtn = document.getElementById("customerImagePreviewPrevBtn");
    if (previewPrevBtn) {
        previewPrevBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showPrevCustomerPreviewImage();
        });
    }
    const previewNextBtn = document.getElementById("customerImagePreviewNextBtn");
    if (previewNextBtn) {
        previewNextBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showNextCustomerPreviewImage();
        });
    }
    const previewModal = document.getElementById("customerImagePreviewModal");
    if (previewModal) {
        previewModal.addEventListener("click", (e) => {
            if (e.target === previewModal) closeCustomerImagePreview();
        });
    }
    const manageModal = document.getElementById("customerImageManageModal");
    if (manageModal) {
        manageModal.addEventListener("click", (e) => {
            if (e.target === manageModal) closeCustomerImageManageModal();
        });
    }
    document.addEventListener("keydown", (e) => {
        const manageModalEl = document.getElementById("customerImageManageModal");
        if (manageModalEl && !manageModalEl.classList.contains("hidden") && e.key === "Escape") {
            closeCustomerImageManageModal();
            return;
        }
        const previewModalEl = document.getElementById("customerImagePreviewModal");
        if (!previewModalEl || previewModalEl.classList.contains("hidden")) return;
        if (e.key === "Escape") {
            closeCustomerImagePreview();
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            showPrevCustomerPreviewImage();
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            showNextCustomerPreviewImage();
        }
    });

    ["matchAddressInput", "matchBusinessAreaInput", "matchStationKeyword", "matchMinPrice", "matchMaxPrice", "matchStationWalkMin", "matchStationWalkMax", "matchCashHoldManwon", "matchCashHoldPercent", "matchMinYieldInput", "matchLandPyeongMin", "matchLandPyeongMax", "matchGrossPyeongMin", "matchGrossPyeongMax", "matchLandAreaMin", "matchLandAreaMax", "matchGrossAreaMin", "matchGrossAreaMax", "matchUsableAreaMin", "matchUsableAreaMax", "matchBuildingAreaMin", "matchBuildingAreaMax", "matchApprovalYearMin", "matchRoadWidthMin", "matchParkingMin"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
            }
        });
    });

    ["matchMinPrice", "matchMaxPrice", "matchCashHoldManwon", "matchLandPyeongMin", "matchLandPyeongMax", "matchGrossPyeongMin", "matchGrossPyeongMax", "matchLandAreaMin", "matchLandAreaMax", "matchGrossAreaMin", "matchGrossAreaMax", "matchUsableAreaMin", "matchUsableAreaMax", "matchBuildingAreaMin", "matchBuildingAreaMax", "matchParkingMin"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("input", (e) => {
            e.target.value = formatThousandsInputValue(e.target.value);
        });
    });

    const desiredPriceInput = document.getElementById("desired_price_manwon");
    if (desiredPriceInput) {
        desiredPriceInput.addEventListener("input", (e) => {
            e.target.value = formatThousandsInputValue(e.target.value);
        });
    }

    renderIntroRows();
    renderOwnedRows();
    refreshCustomerMatchDownloadButton();
});
