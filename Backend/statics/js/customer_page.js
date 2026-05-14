const INTRO_STATUS_OPTIONS = ["예비", "소개", "답사", "계약진행", "계약완료", "보류"];

let introRows = [];
let ownedRows = [];
let pickingContext = null;
let customerMatchCurrentPage = 1;
const CUSTOMER_MATCH_PAGE_SIZE = 20;
const INTRO_BUILDING_SEARCH_PAGE_SIZE = 30;
const INTRO_BUILDING_SEARCH_PAGE_GROUP_SIZE = 5;
const selectedMatchBuildingIds = new Set();
let customSearchSelectedBuildings = [];
let introSearchKeyword = "";
let currentIntroManagerName = "";
let lastCustomerMatchQueryString = "";
let lastCustomerMatchTotalCount = 0;
const CUSTOMER_MATCH_HISTORY_MAX_ITEMS = 50;
let customerMatchHistoryItems = [];
let currentMatchHistoryConditions = null;
let selectedHistoryCompareId = "";
let editingMatchHistoryId = "";
let customerSidebarTab = "intro";
let activeMatchSectors = new Set();
let matchSectorToggleInitialized = false;
const MATCH_SECTOR_KEY_FALLBACK = [
    "types",
    "building_status",
    "grade",
    "zoning",
    "usage",
    "violation",
    "address",
    "business_area",
    "station",
    "station_walk",
    "cash_hold",
    "sale_price",
    "yield",
    "land_pp",
    "gross_pp",
    "land_area",
    "gross_area",
    "usable_area",
    "building_area",
    "approval_year",
    "road_width",
    "elevator",
    "parking",
];
const CUSTOMER_MATCH_DRAG_MIME = "application/x-customer-match-building";
const CUSTOMER_MATCH_DRAG_TEXT_PREFIX = "customer-match-building:";
let introDropZoneDragDepth = 0;
let isDraggingMatchCard = false;

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
    return slot === "profile" ? "프로필 사진" : "명함 사진";
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
            ${entries.length}??        </div>
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
    if (titleEl) titleEl.innerText = slot === "profile" ? "프로필 이미지 등록" : "명함 이미지 등록";
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
                ??
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

    const placeholder = slot === "profile" ? "프로필 사진" : "명함 사진";
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

    const minWidth = 420;
    const maxSidebarRatio = 0.62;
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

function resolveCurrentIntroManager(user) {
    const displayName = String(user?.display_name || "").trim();
    if (displayName) return displayName;
    return String(user?.username || "").trim();
}

function getDefaultIntroManagerName() {
    return currentIntroManagerName || "";
}

async function loadCurrentIntroManagerName() {
    try {
        const res = await fetch("/api/auth/me", {
            headers: { "Accept": "application/json" }
        });
        if (!res.ok) return;
        const payload = await res.json();
        currentIntroManagerName = resolveCurrentIntroManager(payload?.user);
    } catch (e) {
        console.warn("failed to load current intro manager", e);
    }
}

function getDefaultCustomerHistoryWriter() {
    return getDefaultIntroManagerName();
}

function formatCustomerHistoryWriteTime(date = new Date()) {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hours24 = date.getHours();
    const period = hours24 >= 12 ? "오후" : "오전";
    const hour12 = hours24 % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${yy}-${mm}-${dd} ${period} ${hour12}:${minutes}`;
}

function getCustomerHistoryListElement() {
    return document.getElementById("customerHistoryList");
}

function syncCustomerHistoryEmptyState() {
    const list = getCustomerHistoryListElement();
    if (!list) return;

    const hasEntry = Boolean(list.querySelector('[data-history-entry="1"]'));
    const emptyEl = list.querySelector('[data-history-empty="1"]');

    if (hasEntry) {
        if (emptyEl) emptyEl.remove();
        return;
    }
    if (emptyEl) return;

    const placeholder = document.createElement("div");
    placeholder.dataset.historyEmpty = "1";
    placeholder.className = "py-8 text-slate-400 text-center";
    placeholder.textContent = "진행 내역이 없습니다.";
    list.appendChild(placeholder);
}

function setCustomerSidebarTab(tab) {
    customerSidebarTab = tab === "history" ? "history" : "intro";

    const introBtn = document.getElementById("customerSidebarIntroTabBtn");
    const historyBtn = document.getElementById("customerSidebarHistoryTabBtn");
    const introPanel = document.getElementById("customerIntroPanel");
    const historyPanel = document.getElementById("customerHistoryPanel");
    const introToolbar = document.getElementById("customerIntroToolbar");

    if (introPanel) introPanel.classList.toggle("hidden", customerSidebarTab !== "intro");
    if (historyPanel) {
        historyPanel.classList.toggle("hidden", customerSidebarTab !== "history");
        historyPanel.classList.toggle("flex", customerSidebarTab === "history");
    }
    if (introToolbar) introToolbar.classList.toggle("hidden", customerSidebarTab !== "intro");

    if (introBtn) {
        introBtn.classList.toggle("bg-white", customerSidebarTab === "intro");
        introBtn.classList.toggle("text-slate-900", customerSidebarTab === "intro");
        introBtn.classList.toggle("bg-slate-600", customerSidebarTab !== "intro");
        introBtn.classList.toggle("text-slate-200", customerSidebarTab !== "intro");
        introBtn.classList.toggle("hover:bg-slate-500", customerSidebarTab !== "intro");
    }
    if (historyBtn) {
        historyBtn.classList.toggle("bg-white", customerSidebarTab === "history");
        historyBtn.classList.toggle("text-slate-900", customerSidebarTab === "history");
        historyBtn.classList.toggle("bg-slate-600", customerSidebarTab !== "history");
        historyBtn.classList.toggle("text-slate-200", customerSidebarTab !== "history");
        historyBtn.classList.toggle("hover:bg-slate-500", customerSidebarTab !== "history");
    }
}

function getCustomerHistoryEditHTML({ time, writer = "", content = "" }) {
    const resolvedWriter = String(writer || "").trim() || getDefaultCustomerHistoryWriter();
    return `
        <div class="flex justify-between items-center font-bold text-emerald-700 mb-2">
            <span data-role="history-time">${escapeMatchHistoryHtml(time)}</span>
            <div class="flex gap-1.5 items-center">
                <input type="text"
                    value="${escapeMatchHistoryHtml(resolvedWriter)}"
                    placeholder="작성자"
                    class="w-16 h-6 bg-white border border-slate-300 px-1.5 text-[11px] font-bold outline-none rounded">

                <button type="button" onclick="confirmCustomerHistory(this)"
                    class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded shadow-sm text-[10px]">
                    저장
                </button>

                <button type="button" onclick="cancelCustomerHistoryEdit(this)"
                    class="bg-slate-400 hover:bg-slate-500 text-white px-2.5 py-1 rounded shadow-sm text-[10px]">
                    취소
                </button>
            </div>
        </div>

        <textarea
            placeholder="진행 내용을 입력하세요..."
            class="h_memo w-full max-w-full p-2 bg-white border border-slate-300 outline-none text-[12px] resize-y overflow-auto rounded-md h-16 min-h-[4rem] shadow-inner"
        >${escapeMatchHistoryHtml(content)}</textarea>
    `;
}

function getCustomerHistoryViewHTML({ time = "", writer = "", memo = "" }) {
    return `
        <div class="flex justify-between font-bold text-blue-600">
            <div class="flex items-center gap-2">
                <span class="h_time">${escapeMatchHistoryHtml(time)}</span>
                <button type="button" onclick="editCustomerHistory(this)"
                    class="text-blue-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">[수정]</button>
                <button type="button" onclick="deleteCustomerHistory(this)"
                    class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">[삭제]</button>
            </div>
            <span class="h_writer">${escapeMatchHistoryHtml(writer)}</span>
        </div>
        <p class="whitespace-pre-line h_memo mt-1 text-slate-700 leading-relaxed text-[12px]">${escapeMatchHistoryHtml(memo)}</p>
    `;
}

function getCurrentCustomerHistoryData() {
    const list = getCustomerHistoryListElement();
    if (!list) return [];

    return Array.from(list.querySelectorAll('[data-history-entry="1"]'))
        .map((row) => {
            const time = String(
                row.querySelector(".h_time")?.textContent
                || row.querySelector('[data-role="history-time"]')?.textContent
                || row.dataset.historyTime
                || ""
            ).trim();
            const writer = String(
                row.querySelector('input[placeholder="작성자"]')?.value
                || row.querySelector(".h_writer")?.textContent
                || getDefaultCustomerHistoryWriter()
                || "작성자"
            ).trim();
            const memoEl = row.querySelector("textarea") || row.querySelector(".h_memo");
            const memo = memoEl
                ? String("value" in memoEl ? memoEl.value : memoEl.textContent || "")
                : "";

            if (!String(memo).trim()) return null;
            return {
                writer,
                write_time: time,
                memo,
            };
        })
        .filter(Boolean);
}

async function saveCustomerHistoryOnly() {
    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) return false;

    const res = await fetch(`/api/customer/${customerNumber}/history`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            history_data: getCurrentCustomerHistoryData()
        })
    });
    if (!res.ok) throw new Error("customer history save failed");
    return true;
}

function addCustomerHistoryRow() {
    const list = getCustomerHistoryListElement();
    if (!list) return;

    const time = formatCustomerHistoryWriteTime(new Date());
    const newRow = document.createElement("div");
    newRow.dataset.historyEntry = "1";
    newRow.dataset.historyTime = time;
    newRow.className = "customer-history-edit-row py-3 border-b border-emerald-100 bg-emerald-50/30 px-2 animate-in fade-in duration-300";
    newRow.innerHTML = getCustomerHistoryEditHTML({ time });

    const emptyEl = list.querySelector('[data-history-empty="1"]');
    if (emptyEl) emptyEl.remove();
    list.insertBefore(newRow, list.firstChild);
}

async function confirmCustomerHistory(btn) {
    const row = btn.closest('[data-history-entry="1"]');
    if (!row) return;

    const time = String(
        row.querySelector('[data-role="history-time"]')?.textContent
        || row.dataset.historyTime
        || ""
    ).trim();
    const writer = String(
        row.querySelector('input[placeholder="작성자"]')?.value
        || getDefaultCustomerHistoryWriter()
        || "작성자"
    ).trim();
    const memo = String(row.querySelector("textarea")?.value || "");

    if (!memo.trim()) {
        alert("내용을 입력하세요.");
        return;
    }

    row.dataset.historyTime = time;
    row.className = "customer-history-row history-row py-2 border-b border-slate-200 group";
    row.innerHTML = getCustomerHistoryViewHTML({ time, writer, memo });
    syncCustomerHistoryEmptyState();

    try {
        await saveCustomerHistoryOnly();
    } catch (err) {
        console.error(err);
        alert("진행내역 저장에 실패했습니다. 정보 저장하기로 다시 저장해 주세요.");
    }
}

function editCustomerHistory(btn) {
    const row = btn.closest('[data-history-entry="1"]');
    if (!row) return;

    const time = String(row.querySelector(".h_time")?.textContent || "").trim();
    const writer = String(row.querySelector(".h_writer")?.textContent || "").trim();
    const memo = String(row.querySelector(".h_memo")?.textContent || "");

    row._backupHTML = row.innerHTML;
    row.dataset.historyTime = time;
    row.className = "customer-history-edit-row py-3 border-b border-emerald-100 bg-emerald-50/30 px-2";
    row.innerHTML = getCustomerHistoryEditHTML({
        time,
        writer,
        content: memo,
    });
}

async function deleteCustomerHistory(btn) {
    if (!confirm("이 히스토리 기록을 정말로 삭제하시겠습니까?")) return;

    const row = btn.closest('[data-history-entry="1"]');
    if (!row) return;

    row.remove();
    syncCustomerHistoryEmptyState();

    try {
        await saveCustomerHistoryOnly();
    } catch (err) {
        console.error(err);
        alert("진행내역 삭제에 실패했습니다. 정보 저장하기로 다시 저장해 주세요.");
    }
}

function cancelCustomerHistoryEdit(btn) {
    const row = btn.closest('[data-history-entry="1"]');
    if (!row) return;

    if (row._backupHTML) {
        row.className = "customer-history-row history-row py-2 border-b border-slate-200 group";
        row.innerHTML = row._backupHTML;
        delete row._backupHTML;
    } else {
        row.remove();
        syncCustomerHistoryEmptyState();
    }
}

function renderCustomerHistoryItem(data) {
    const list = getCustomerHistoryListElement();
    if (!list) return;

    const row = document.createElement("div");
    row.dataset.historyEntry = "1";
    row.dataset.historyTime = String(data?.write_time || "").trim();
    row.className = "customer-history-row history-row py-2 border-b border-slate-200 group";
    row.innerHTML = getCustomerHistoryViewHTML({
        time: data?.write_time || "",
        writer: data?.writer || "작성자",
        memo: data?.memo || "",
    });
    list.appendChild(row);
}

function bindCustomerHistoryRows(historyList) {
    const list = getCustomerHistoryListElement();
    if (!list) return;

    list.innerHTML = "";
    if (Array.isArray(historyList)) {
        historyList.forEach((item) => renderCustomerHistoryItem(item));
    }
    syncCustomerHistoryEmptyState();
}

function normalizeDateTimeLocal(value) {
    if (!value) return nowLocalDateTimeMinute();
    const str = clampDateTimeLocalYearText(String(value).trim());
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

function clampDateTimeLocalYearText(value) {
    const str = String(value ?? "").trim();
    if (!str) return "";
    return str.replace(/^(\d{4})\d+/, "$1");
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
        progress_status: "예비",
        intro_cost: "",
        manager_name: getDefaultIntroManagerName(),
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

        // 동률이면 상단(작은 idx)을 최신 우선으로 간주
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

function parseMoneyToNumber(value) {
    const digits = String(value ?? "").replace(/[^0-9]/g, "");
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseBdNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveIntroComparisonForMatchItem(item) {
    const rows = Array.isArray(introRows) ? introRows : [];
    if (!rows.length) {
        const backendMatchPrice = parseMoneyToNumber(item?.match_sale_price_numeric ?? item?.sale_price);
        const backendIntroPrice = parseMoneyToNumber(item?.intro_price_reference);
        const backendDuplicate = Boolean(item?.is_intro_duplicate);
        return {
            isIntroDuplicate: backendDuplicate,
            isPriceDrop: backendDuplicate
                && backendMatchPrice !== null
                && backendIntroPrice !== null
                && backendMatchPrice < backendIntroPrice,
        };
    }

    const matchAddress = String(item?.address || "").trim();
    const matchBdName = String(item?.bd_name || "").trim();
    const matchBdNumber = parseBdNumber(item?.bd_number);
    const matchSalePrice = parseMoneyToNumber(item?.sale_price);

    let hasBdMatch = false;
    let hasAddressMatch = false;
    let introPriceRef = null;

    for (const row of rows) {
        const rowBdNumber = parseBdNumber(row?.bd_number);
        const rowAddress = String(row?.address || "").trim();
        if (matchBdNumber !== null && rowBdNumber !== null && matchBdNumber === rowBdNumber) {
            hasBdMatch = true;
        }
        if (matchAddress && rowAddress && matchAddress === rowAddress) {
            hasAddressMatch = true;
        }
    }

    if (matchAddress && matchBdName) {
        for (const row of rows) {
            const rowAddress = String(row?.address || "").trim();
            const rowBdName = String(row?.bd_name || "").trim();
            if (rowAddress && rowBdName && rowAddress === matchAddress && rowBdName === matchBdName) {
                introPriceRef = parseMoneyToNumber(getDisplaySalePriceForIntroRow(row) || row?.sale_price);
                break;
            }
        }
    }

    if (introPriceRef === null && matchAddress) {
        for (const row of rows) {
            const rowAddress = String(row?.address || "").trim();
            if (rowAddress && rowAddress === matchAddress) {
                introPriceRef = parseMoneyToNumber(getDisplaySalePriceForIntroRow(row) || row?.sale_price);
                break;
            }
        }
    }

    if (introPriceRef === null && matchBdNumber !== null) {
        for (const row of rows) {
            const rowBdNumber = parseBdNumber(row?.bd_number);
            if (rowBdNumber !== null && rowBdNumber === matchBdNumber) {
                introPriceRef = parseMoneyToNumber(getDisplaySalePriceForIntroRow(row) || row?.sale_price);
                break;
            }
        }
    }

    const isIntroDuplicate = hasBdMatch || hasAddressMatch;
    const isPriceDrop = Boolean(
        isIntroDuplicate
        && matchSalePrice !== null
        && introPriceRef !== null
        && matchSalePrice < introPriceRef
    );

    return {
        isIntroDuplicate,
        isPriceDrop,
    };
}

function getCustomerIntroMapItems() {
    return (introRows || [])
        .map((row) => {
            const address = String(row?.address || "").trim();
            if (!address) return null;

            const bdNumber = String(row?.bd_number || "").trim();
            const salePrice = String(getDisplaySalePriceForIntroRow(row) || row?.sale_price || "").trim();
            const bdName = String(row?.bd_name || "").trim();

            return {
                bd_number: bdNumber || null,
                address: address,
                bd_name: bdName,
                sale_price: salePrice,
                detail_url: bdNumber ? `/detail/${encodeURIComponent(bdNumber)}` : ""
            };
        })
        .filter(Boolean);
}

function notifyCustomerIntroRowsChanged() {
    const items = getCustomerIntroMapItems();
    window.dispatchEvent(
        new CustomEvent("customer:introRowsUpdated", {
            detail: { items }
        })
    );
}

window.getCustomerIntroMapItems = getCustomerIntroMapItems;

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
        notifyCustomerIntroRowsChanged();
        return;
    }

    if (thead) thead.classList.remove("hidden");
    if (!filteredRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-3 text-slate-400">검색한 소개 매물이 없습니다.</td>
            </tr>
        `;
        notifyCustomerIntroRowsChanged();
        return;
    }

    tbody.innerHTML = filteredRows.map(row => `
        <tr class="border-b border-slate-200">
            <td class="p-1">
                <button type="button" onclick="openIntroBuildingSearchFromRow('${row.row_id}')"
                    class="px-2 py-1 text-[10px] whitespace-nowrap rounded bg-blue-600 text-white hover:bg-blue-700">검색</button>
            </td>
            <td class="p-1">
                <button type="button" onclick="removeIntroRow('${row.row_id}')"
                    class="px-2 py-1 text-[10px] whitespace-nowrap rounded bg-red-500 text-white hover:bg-red-600">제거</button>
            </td>
            <td class="p-1 text-left">
                <input type="text" value="${row.address || ""}" ${row.bd_number ? "readonly" : ""}
                    ${row.bd_number
                        ? `onclick="openIntroBuildingFromRow('${row.row_id}')"`
                        : `oninput="updateIntroField('${row.row_id}','address', this.value)" onkeydown="handleIntroAddressKeydown(event, '${row.row_id}')"`}
                    class="w-full min-w-0 ${row.bd_number ? "bg-slate-50 cursor-pointer" : "bg-white"} px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                    style="min-width: 180px;"
                    placeholder="${row.bd_number ? "주소" : "주소 입력 후 Enter"}">
            </td>
            <td class="p-1 text-left">
                <input type="text" value="${row.bd_name || ""}" readonly
                    class="w-full min-w-0 bg-slate-50 px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                    style="max-width: 104px;"
                    placeholder="건물명">
            </td>
            <td class="p-1">
                <input type="text" value="${getDisplaySalePriceForIntroRow(row)}" readonly
                    data-intro-sale-row="${row.row_id}"
                    class="w-full min-w-0 bg-slate-50 px-1.5 py-1 border border-slate-200 rounded text-[11px] text-right ml-auto"
                    style="max-width: 80px;"
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
                                    <input type="datetime-local" value="${normalizeDateTimeLocal(detail.intro_date)}" max="9999-12-31T23:59"
                                        oninput="updateIntroDetailDateField('${row.row_id}','${detail.detail_id}', this)"
                                        class="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px] bg-white text-slate-700">
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] font-bold text-slate-600 shrink-0">진행</span>
                                    <select onchange="updateIntroDetailField('${row.row_id}','${detail.detail_id}','progress_status', this.value)"
                                        class="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px]">
                                        ${renderStatusOptions(detail.progress_status || "예비")}
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
                                    oninput="updateIntroDetailField('${row.row_id}','${detail.detail_id}','intro_note', this.value); autoResizeIntroNoteTextarea(this)"
                                    data-intro-note="1"
                                    class="w-full min-w-0 px-2 py-1 border border-slate-200 rounded text-[11px] bg-white resize-none min-h-[84px] leading-4 whitespace-pre-wrap overflow-hidden"
                                    placeholder="소개매물 관련 메모를 입력하세요">${detail.intro_note || ""}</textarea>
                            </div>
                        </div>
                    `).join("")
                    : `<div class="text-[11px] text-slate-400 px-1 py-2">상세 내역이 없습니다. 우측 + 버튼으로 추가하세요.</div>`}
            </td>
        </tr>
        ` : ""}
    `).join("");
    autoResizeIntroNoteTextareas();
    notifyCustomerIntroRowsChanged();
}

function autoResizeIntroNoteTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function autoResizeIntroNoteTextareas() {
    document
        .querySelectorAll('#introPropertyBody textarea[data-intro-note="1"]')
        .forEach(autoResizeIntroNoteTextarea);
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
                    onkeydown="handleOwnedAddressKeydown(event, '${row.row_id}')"
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
    const newRow = createEmptyIntroRow();
    newRow.is_expanded = true;
    introRows.unshift(newRow);
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

function updateIntroDetailDateField(rowId, detailId, inputEl) {
    if (!inputEl) return;
    const sanitized = clampDateTimeLocalYearText(inputEl.value);
    if (sanitized !== inputEl.value) {
        inputEl.value = sanitized;
    }
    updateIntroDetailField(rowId, detailId, "intro_date", sanitized);
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

function removeIntroRow(rowId) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    introRows = introRows.filter(r => r.row_id !== rowId);
    renderIntroRows();
}

function removeOwnedRow(rowId) {
    ownedRows = ownedRows.filter(r => r.row_id !== rowId);
    renderOwnedRows();
}

function updateIntroField(rowId, key, value) {
    const row = introRows.find(r => r.row_id === rowId);
    if (!row) return;
    row[key] = value;
}

function updateOwnedField(rowId, key, value) {
    const row = ownedRows.find(r => r.row_id === rowId);
    if (!row) return;
    row[key] = value;
}

function openBuildingSearchModal(kind, rowId, initialKeyword = "", autoSearch = false) {
    const isCustomSearch = kind === "custom";
    pickingContext = { kind, rowId };
    const modalEl = document.getElementById("buildingSearchModal");
    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");

    const customPanel = document.getElementById("customSearchSelectedPanel");
    if (customPanel) customPanel.classList.toggle("hidden", !isCustomSearch);

    const searchBtn = document.getElementById("buildingSearchBtn");
    if (searchBtn) searchBtn.textContent = isCustomSearch ? "주소 검색" : "검색";

    const keywordEl = document.getElementById("buildingSearchInput");
    keywordEl.placeholder = isCustomSearch ? "주소 또는 건물명 검색 후 추가" : "주소 또는 건물명 검색";
    keywordEl.value = String(initialKeyword || "");
    keywordEl.focus();
    keywordEl.select();

    const resultBody = document.getElementById("buildingSearchResultBody");
    resultBody.innerHTML = "";
    renderBuildingSearchPagination(0, 1, 0);
    if (isCustomSearch) renderCustomSearchSelectedBuildings();

    if (autoSearch && keywordEl.value.trim()) {
        searchBuildingsForIntro(1);
    }
}

function closeBuildingSearchModal() {
    const modalEl = document.getElementById("buildingSearchModal");
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
    const customPanel = document.getElementById("customSearchSelectedPanel");
    if (customPanel) customPanel.classList.add("hidden");
    pickingContext = null;
    renderBuildingSearchPagination(0, 1, 0);
}

function openCustomMatchSearchModal() {
    openBuildingSearchModal("custom", "", "", false);
}

function normalizeCustomSearchBuilding(raw) {
    if (!raw || typeof raw !== "object") return null;
    const parsedBdNumber = parseBdNumber(raw.bd_number);
    if (parsedBdNumber === null) return null;
    return {
        bd_number: parsedBdNumber,
        address: String(raw.address || "").trim(),
        bd_name: String(raw.bd_name || "").trim(),
        sale_price: formatThousandsInputValue(raw.sale_price ?? ""),
        price_per_pyeong: formatThousandsInputValue(raw.price_per_pyeong ?? ""),
    };
}

function isCustomSearchBuildingSelected(bdNumber) {
    const target = parseBdNumber(bdNumber);
    if (target === null) return false;
    return customSearchSelectedBuildings.some(item => parseBdNumber(item.bd_number) === target);
}

function addCustomSearchSelectedBuilding(raw) {
    const building = normalizeCustomSearchBuilding(raw);
    if (!building || isCustomSearchBuildingSelected(building.bd_number)) {
        renderCustomSearchSelectedBuildings();
        return;
    }
    customSearchSelectedBuildings.push(building);
    renderCustomSearchSelectedBuildings();
}

function removeCustomSearchSelectedBuilding(bdNumber) {
    const target = parseBdNumber(bdNumber);
    if (target === null) return;
    customSearchSelectedBuildings = customSearchSelectedBuildings.filter(item => parseBdNumber(item.bd_number) !== target);
    renderCustomSearchSelectedBuildings();
}

function clearCustomSearchSelectedBuildings() {
    customSearchSelectedBuildings = [];
    renderCustomSearchSelectedBuildings();
}

function renderCustomSearchSelectedBuildings() {
    const countEl = document.getElementById("customSearchSelectedCount");
    const listEl = document.getElementById("customSearchSelectedList");
    const downloadBtn = document.getElementById("customSearchDownloadBtn");
    const clearBtn = document.getElementById("customSearchClearBtn");
    const count = customSearchSelectedBuildings.length;

    if (countEl) countEl.textContent = `${count.toLocaleString()}건`;
    if (downloadBtn) downloadBtn.disabled = count === 0;
    if (clearBtn) clearBtn.disabled = count === 0;
    if (!listEl) return;

    if (!count) {
        listEl.innerHTML = '<div class="py-4 text-center text-[12px] text-slate-400">주소 검색 후 선택한 매물이 여기에 쌓입니다.</div>';
        return;
    }

    listEl.innerHTML = customSearchSelectedBuildings.map((item, index) => `
        <div class="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[12px] text-slate-700">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5 mb-1">
                        <span class="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">${index + 1}. ID: ${escapeMatchHistoryHtml(item.bd_number)}</span>
                        <span class="font-bold text-slate-700">${escapeMatchHistoryHtml(item.bd_name || "건물명 없음")}</span>
                    </div>
                    <div class="text-slate-600 truncate">주소: ${escapeMatchHistoryHtml(item.address || "-")}</div>
                    <div class="text-slate-500">매매가: ${escapeMatchHistoryHtml(item.sale_price || "-")} · 평단가: ${escapeMatchHistoryHtml(item.price_per_pyeong || "-")}</div>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                    <button type="button" onclick="openBuildingDetailFromSearch(${Number(item.bd_number)})"
                        class="text-blue-600 hover:underline font-semibold">상세</button>
                    <button type="button" onclick="removeCustomSearchSelectedBuilding(${Number(item.bd_number)})"
                        class="text-red-500 hover:underline font-semibold">제거</button>
                </div>
            </div>
        </div>
    `).join("");
}

function toInlineJsonArg(value) {
    return escapeMatchHistoryHtml(JSON.stringify(String(value ?? "")));
}

function renderBuildingSearchPagination(totalCount = 0, currentPage = 1, totalPages = 0) {
    const infoEl = document.getElementById("buildingSearchPageInfo");
    const buttonsEl = document.getElementById("buildingSearchPageButtons");
    if (!infoEl || !buttonsEl) return;

    const safeCount = Math.max(0, Number(totalCount) || 0);
    const safeTotalPages = Math.max(0, Number(totalPages) || 0);
    const safeCurrentPage = safeTotalPages > 0
        ? Math.min(Math.max(1, Number(currentPage) || 1), safeTotalPages)
        : 1;
    infoEl.textContent = safeCount > 0
        ? `총 ${safeCount.toLocaleString()}건 · ${safeCurrentPage}/${safeTotalPages} 페이지`
        : "총 0건";

    if (safeTotalPages <= 1) {
        buttonsEl.innerHTML = "";
        return;
    }

    const groupStart = Math.floor((safeCurrentPage - 1) / INTRO_BUILDING_SEARCH_PAGE_GROUP_SIZE) * INTRO_BUILDING_SEARCH_PAGE_GROUP_SIZE + 1;
    const groupEnd = Math.min(groupStart + INTRO_BUILDING_SEARCH_PAGE_GROUP_SIZE - 1, safeTotalPages);

    const prevPage = groupStart - 1;
    const nextPage = groupStart + INTRO_BUILDING_SEARCH_PAGE_GROUP_SIZE;
    const prevDisabled = prevPage < 1;
    const nextDisabled = nextPage > safeTotalPages;

    let html = `
        <button type="button"
            ${prevDisabled ? "disabled" : `onclick=\"searchBuildingsForIntro(${prevPage})\"`}
            class="px-2 py-1 rounded border text-[11px] ${prevDisabled ? "border-slate-200 text-slate-300 cursor-not-allowed" : "border-slate-300 text-slate-700 hover:bg-slate-50"}">
            이전
        </button>
    `;

    for (let page = groupStart; page <= groupEnd; page += 1) {
        const active = page === safeCurrentPage;
        html += `
            <button type="button"
                ${active ? "disabled" : `onclick=\"searchBuildingsForIntro(${page})\"`}
                class="min-w-[28px] px-2 py-1 rounded border text-[11px] ${active ? "border-blue-600 bg-blue-600 text-white cursor-default" : "border-slate-300 text-slate-700 hover:bg-slate-50"}">
                ${page}
            </button>
        `;
    }

    html += `
        <button type="button"
            ${nextDisabled ? "disabled" : `onclick=\"searchBuildingsForIntro(${nextPage})\"`}
            class="px-2 py-1 rounded border text-[11px] ${nextDisabled ? "border-slate-200 text-slate-300 cursor-not-allowed" : "border-slate-300 text-slate-700 hover:bg-slate-50"}">
            다음
        </button>
    `;

    buttonsEl.innerHTML = html;
}

async function searchBuildingsForIntro(page = 1) {
    const q = document.getElementById("buildingSearchInput").value.trim();
    const resultBody = document.getElementById("buildingSearchResultBody");
    const safePage = Math.max(1, Number(page) || 1);

    resultBody.innerHTML = `<tr><td colspan="6" class="p-3 text-slate-400">검색 중...</td></tr>`;

    try {
        const params = new URLSearchParams();
        params.set("q", q);
        params.set("page", String(safePage));
        params.set("page_size", String(INTRO_BUILDING_SEARCH_PAGE_SIZE));
        const res = await fetch(`/api/building/quick-search?${params.toString()}`);
        if (!res.ok) throw new Error("building search failed");
        const payload = await res.json();
        const items = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.items) ? payload.items : []);
        const totalCount = Array.isArray(payload)
            ? items.length
            : Number(payload?.total_count || 0);
        const totalPages = Array.isArray(payload)
            ? (items.length > 0 ? 1 : 0)
            : Number(payload?.total_pages || 0);
        const currentPage = Array.isArray(payload)
            ? 1
            : Number(payload?.page || safePage);

        if (!Array.isArray(items) || items.length === 0) {
            resultBody.innerHTML = `<tr><td colspan="6" class="p-3 text-slate-400">검색 결과가 없습니다.</td></tr>`;
            renderBuildingSearchPagination(totalCount, currentPage, totalPages);
            return;
        }

        const isCustomSearch = pickingContext?.kind === "custom";
        resultBody.innerHTML = items.map(item => {
            const bdNumber = Number(item.bd_number);
            const safeBdNumber = Number.isFinite(bdNumber) ? bdNumber : 0;
            const selectLabel = isCustomSearch ? "추가" : "선택";
            return `
            <tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="p-2 text-center">
                    <button type="button"
                        onclick="openBuildingDetailFromSearch(${safeBdNumber})"
                        class="text-blue-600 hover:text-blue-800 hover:underline font-semibold">
                        ${escapeMatchHistoryHtml(item.bd_number || "-")}
                    </button>
                </td>
                <td class="p-2">${escapeMatchHistoryHtml(item.address || "-")}</td>
                <td class="p-2">${escapeMatchHistoryHtml(item.bd_name || "-")}</td>
                <td class="p-2 text-right">${escapeMatchHistoryHtml(item.sale_price || "-")}</td>
                <td class="p-2 text-right">${escapeMatchHistoryHtml(item.price_per_pyeong || "-")}</td>
                <td class="p-2 text-center">
                    <button type="button" onclick="selectBuildingForCurrentRow(${safeBdNumber}, ${toInlineJsonArg(item.address)}, ${toInlineJsonArg(item.bd_name)}, ${toInlineJsonArg(item.sale_price)}, ${toInlineJsonArg(item.price_per_pyeong)})"
                        class="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700">${selectLabel}</button>
                </td>
            </tr>
        `;
        }).join("");
        renderBuildingSearchPagination(totalCount, currentPage, totalPages);
    } catch (err) {
        console.error(err);
        resultBody.innerHTML = `<tr><td colspan="6" class="p-3 text-red-400">검색 실패</td></tr>`;
        renderBuildingSearchPagination(0, 1, 0);
    }
}

function openBuildingDetailFromSearch(bdNumber) {
    window.open(`/detail/${bdNumber}`, "_blank");
}

function openIntroBuildingSearchFromRow(rowId) {
    const row = introRows.find(r => r.row_id === rowId);
    openBuildingSearchModal("intro", rowId, row?.address || "", false);
}

function handleIntroAddressKeydown(event, rowId) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const keyword = String(event.currentTarget?.value || "").trim();
    openBuildingSearchModal("intro", rowId, keyword, Boolean(keyword));
}

function handleOwnedAddressKeydown(event, rowId) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const keyword = String(event.currentTarget?.value || "").trim();
    openBuildingSearchModal("owned", rowId, keyword, Boolean(keyword));
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
    } else if (pickingContext.kind === "custom") {
        addCustomSearchSelectedBuilding({
            bd_number: bdNumber,
            address,
            bd_name: bdName,
            sale_price: salePrice,
            price_per_pyeong: pricePerPyeong,
        });
        return;
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

function getMatchSectorKeysFromDom() {
    return Array.from(document.querySelectorAll("[data-match-sector]"))
        .map((el) => String(el.dataset.matchSector || "").trim())
        .filter(Boolean);
}

function getAllMatchSectorKeys() {
    const keysFromDom = getMatchSectorKeysFromDom();
    if (keysFromDom.length) return keysFromDom;
    return [...MATCH_SECTOR_KEY_FALLBACK];
}

function isMatchSectorActive(sectorKey) {
    return true;
}

function renderMatchSectorLabels() {
    document.querySelectorAll("[data-match-sector]").forEach((labelEl) => {
        labelEl.classList.remove(
            "inline-flex",
            "items-center",
            "justify-center",
            "cursor-pointer",
            "select-none",
            "rounded",
            "px-2",
            "py-0.5",
            "border",
            "transition-colors",
            "duration-150",
            "bg-emerald-100",
            "text-emerald-800",
            "border-emerald-300",
            "bg-slate-100",
            "text-slate-500",
            "border-slate-300"
        );

        labelEl.style.backgroundColor = "";
        labelEl.style.color = "";
        labelEl.style.borderColor = "";
        labelEl.removeAttribute("role");
        labelEl.removeAttribute("tabindex");
        labelEl.removeAttribute("aria-pressed");
        labelEl.removeAttribute("data-active");
        labelEl.removeAttribute("title");
    });
}

function setActiveMatchSectors(sectors, { fallbackToAll = false } = {}) {
    activeMatchSectors = new Set(getAllMatchSectorKeys());
    matchSectorToggleInitialized = false;
    renderMatchSectorLabels();
}

function toggleMatchSector(sectorKey) {
    return;
}

function initializeMatchSectorToggles() {
    const labelElements = Array.from(document.querySelectorAll("[data-match-sector]"));
    if (!labelElements.length) return;

    activeMatchSectors = new Set(getAllMatchSectorKeys());
    matchSectorToggleInitialized = false;
    renderMatchSectorLabels();
}

function getActiveMatchSectorKeys() {
    return getAllMatchSectorKeys();
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
        violation_option: document.getElementById("matchViolationOption")?.value || "전체",
        location_decide: document.getElementById("matchLocationDecide")?.value || "",
        price_decide: document.getElementById("matchPriceDecide")?.value || "",
        yield_decide: document.getElementById("matchYieldDecide")?.value || "",
        vacancy_decide: document.getElementById("matchVacancyDecide")?.value || "",
        limit_decide: document.getElementById("matchLimitDecide")?.value || "",
        loan_decide: document.getElementById("matchLoanDecide")?.value || "",
        types: Array.from(document.querySelectorAll('input[name="matchType"]:checked')).map((el) => el.value),
        zoning_categories: Array.from(document.querySelectorAll('input[name="matchZoningCategory"]:checked')).map((el) => el.value),
        usage_categories: Array.from(document.querySelectorAll('input[name="matchUsageCategory"]:checked')).map((el) => el.value),
        active_sectors: getActiveMatchSectorKeys(),
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
    setInputValue("matchViolationOption", saved.violation_option || "전체");
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

    if (Array.isArray(saved.active_sectors)) {
        setActiveMatchSectors(saved.active_sectors);
    } else {
        setActiveMatchSectors(getAllMatchSectorKeys(), { fallbackToAll: true });
    }
}

function escapeMatchHistoryHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getMatchHistoryCustomerNumber() {
    const fromInput = String(document.getElementById("customer_number")?.value || "").trim();
    const fromPath = String(getCustomerNumberFromPath() || "").trim();
    const raw = fromInput || fromPath;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
}

async function loadMatchHistoryItems() {
    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) {
        customerMatchHistoryItems = [];
        return false;
    }

    const res = await fetch(`/api/customer/${customerNumber}/match-histories`);
    if (!res.ok) throw new Error("failed to load match history");

    const payload = await res.json();
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    customerMatchHistoryItems = rows
        .filter((item) => item && typeof item === "object" && item.id && item.conditions)
        .slice(0, CUSTOMER_MATCH_HISTORY_MAX_ITEMS);
    return true;
}

async function createMatchHistoryItem(name, conditions) {
    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) throw new Error("customer not saved");

    const res = await fetch(`/api/customer/${customerNumber}/match-histories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, conditions }),
    });
    if (!res.ok) throw new Error("failed to save match history");
}

async function updateMatchHistoryItemName(historyId, name) {
    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) throw new Error("customer not saved");

    const encodedId = encodeURIComponent(String(historyId || "").trim());
    const res = await fetch(`/api/customer/${customerNumber}/match-histories/${encodedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("failed to update match history name");
}

async function deleteMatchHistoryItem(historyId) {
    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) throw new Error("customer not saved");

    const encodedId = encodeURIComponent(String(historyId || "").trim());
    const res = await fetch(`/api/customer/${customerNumber}/match-histories/${encodedId}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("failed to delete match history");
}

function focusMatchHistoryRenameInput(historyId) {
    const id = String(historyId || "").trim();
    if (!id) return;
    requestAnimationFrame(() => {
        const input = document.querySelector(`#customerMatchHistoryList input[data-role="rename-input"][data-id="${id}"]`);
        if (!input) return;
        input.focus();
        input.select();
    });
}

function startMatchHistoryRename(historyId) {
    editingMatchHistoryId = String(historyId || "").trim();
    renderMatchHistoryList();
    focusMatchHistoryRenameInput(editingMatchHistoryId);
}

function cancelMatchHistoryRename() {
    if (!editingMatchHistoryId) return;
    editingMatchHistoryId = "";
    renderMatchHistoryList();
}

async function submitMatchHistoryRename(historyId) {
    const id = String(historyId || "").trim();
    if (!id) return;

    const input = document.querySelector(`#customerMatchHistoryList input[data-role="rename-input"][data-id="${id}"]`);
    const nextName = String(input?.value || "").trim();
    if (!nextName) {
        alert("기록 이름을 입력해 주세요.");
        input?.focus();
        return;
    }
    if (nextName.length > 120) {
        alert("기록 이름은 120자 이하로 입력해 주세요.");
        input?.focus();
        return;
    }

    const found = customerMatchHistoryItems.find((item) => item.id === id);
    if (found && nextName === String(found.name || "").trim()) {
        editingMatchHistoryId = "";
        renderMatchHistoryList();
        return;
    }

    try {
        await updateMatchHistoryItemName(id, nextName);
        await loadMatchHistoryItems();
        editingMatchHistoryId = "";
        renderMatchHistoryList();

        if (selectedHistoryCompareId === id) {
            const updated = customerMatchHistoryItems.find((item) => item.id === id);
            renderMatchHistoryComparePanel(updated || null);
        }
    } catch (err) {
        console.error(err);
        alert("기록 이름 수정 중 오류가 발생했습니다.");
        input?.focus();
    }
}

function hasAnyMatchConditionValue(conditions) {
    if (!conditions || typeof conditions !== "object") return false;
    return Object.entries(conditions).some(([key, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        if (key === "building_status" || key === "violation_option") return value && value !== "전체";
        return String(value ?? "").trim() !== "";
    });
}

function formatMatchHistorySummary(item) {
    const c = item.conditions || {};
    const parts = [];
    if (c.address) parts.push(`주소:${c.address}`);
    if (c.business_area) parts.push(`상권:${c.business_area}`);
    if (Array.isArray(c.types) && c.types.length) parts.push(`유형:${c.types.join(",")}`);
    if (c.min_price || c.max_price) parts.push(`매매가:${c.min_price || "-"}~${c.max_price || "-"}`);
    if (c.min_yield) parts.push(`수익률>=${c.min_yield}%`);
    if (parts.length === 0) parts.push("조건 값 없음");
    return parts.slice(0, 3).join(" | ");
}

function formatMatchHistoryDetailRows(conditions) {
    const rows = getMatchHistoryDetailRows(conditions);
    return rows.map(([label, value]) => `
        <div class="flex items-start gap-2 text-[12px]">
            <span class="w-28 shrink-0 font-bold text-slate-700">${escapeMatchHistoryHtml(label)}</span>
            <span class="text-slate-600">${escapeMatchHistoryHtml(value)}</span>
        </div>
    `).join("");
}

function getMatchHistoryDetailRows(conditions) {
    const c = conditions || {};
    return [
        ["유형", Array.isArray(c.types) && c.types.length ? c.types.join(", ") : "-"],
        ["건물상태", c.building_status || "전체"],
        ["등급조건", [
            c.location_decide || "입지",
            c.price_decide || "가격",
            c.yield_decide || "수익률",
            c.vacancy_decide || "명도",
            c.limit_decide || "제한",
            c.loan_decide || "상태",
        ].join(" / ")],
        ["용도지역", Array.isArray(c.zoning_categories) && c.zoning_categories.length ? c.zoning_categories.join(", ") : "-"],
        ["건축용도", Array.isArray(c.usage_categories) && c.usage_categories.length ? c.usage_categories.join(", ") : "-"],
        ["위반여부", c.violation_option || "전체"],
        ["주소/상권", `${c.address || "-"} / ${c.business_area || "-"}`],
        ["주변역", `${c.station_keyword || "-"} / ${c.station_walk_min || "-"}~${c.station_walk_max || "-"}분`],
        ["현금보유액", `${c.cash_hold_manwon || "-"}만원 / ${c.cash_hold_percent || "-"}%`],
        ["매매가", `${c.min_price || "-"}~${c.max_price || "-"}만원`],
        ["수익률", `${c.min_yield || "-"}% 이상`],
        ["토지 평단가", `${c.land_pp_min || "-"}~${c.land_pp_max || "-"}만원`],
        ["연면적 평단가", `${c.gross_pp_min || "-"}~${c.gross_pp_max || "-"}만원`],
        ["토지면적", `${c.land_area_min || "-"}~${c.land_area_max || "-"}평`],
        ["연면적", `${c.gross_area_min || "-"}~${c.gross_area_max || "-"}평`],
        ["사용가능면적", `${c.usable_area_min || "-"}~${c.usable_area_max || "-"}평`],
        ["건축면적", `${c.building_area_min || "-"}~${c.building_area_max || "-"}평`],
        ["사용승인/도로폭", `${c.approval_year_min || "-"}년 이후 / ${c.road_width_min || "-"}m 이상`],
        ["승강기/주차대수", `${c.elevator_option || "전체"} / ${c.parking_min || "-"}대 이상`],
    ];
}

function getMatchHistoryCompareRows(conditions) {
    const c = conditions || {};
    const toText = (value) => String(value ?? "").trim();
    const nonDefault = (value, defaults = []) => {
        const text = toText(value);
        if (!text) return "";
        return defaults.includes(text) ? "" : text;
    };
    const formatRange = (minValue, maxValue, unit = "") => {
        const minText = toText(minValue);
        const maxText = toText(maxValue);
        if (!minText && !maxText) return "";
        const rangeText = `${minText}\u00A0-\u00A0${maxText}`.trim();
        return unit ? `${rangeText} ${unit}` : rangeText;
    };
    const joinParts = (...values) => values.map((v) => toText(v)).filter(Boolean).join(" / ");

    const decideValues = [
        nonDefault(c.location_decide, ["입지"]),
        nonDefault(c.price_decide, ["가격"]),
        nonDefault(c.yield_decide, ["수익률"]),
        nonDefault(c.vacancy_decide, ["명도"]),
        nonDefault(c.limit_decide, ["제한"]),
        nonDefault(c.loan_decide, ["상태"]),
    ].filter(Boolean);

    return [
        ["유형", Array.isArray(c.types) && c.types.length ? c.types.join(", ") : ""],
        ["건물상태", nonDefault(c.building_status, ["전체"])],
        ["등급조건", decideValues.join(" / ")],
        ["용도지역", Array.isArray(c.zoning_categories) && c.zoning_categories.length ? c.zoning_categories.join(", ") : ""],
        ["건축용도", Array.isArray(c.usage_categories) && c.usage_categories.length ? c.usage_categories.join(", ") : ""],
        ["위반여부", nonDefault(c.violation_option, ["전체"])],
        ["주소/상권", joinParts(c.address, c.business_area)],
        ["주변역", joinParts(c.station_keyword, formatRange(c.station_walk_min, c.station_walk_max, "분"))],
        ["현금보유액", joinParts(
            toText(c.cash_hold_manwon) ? `${toText(c.cash_hold_manwon)}만원` : "",
            toText(c.cash_hold_percent) ? `${toText(c.cash_hold_percent)}%` : ""
        )],
        ["매매가", formatRange(c.min_price, c.max_price, "만원")],
        ["수익률", toText(c.min_yield) ? `${toText(c.min_yield)}% 이상` : ""],
        ["토지 평단가", formatRange(c.land_pp_min, c.land_pp_max, "만원")],
        ["연면적 평단가", formatRange(c.gross_pp_min, c.gross_pp_max, "만원")],
        ["토지면적", formatRange(c.land_area_min, c.land_area_max, "평")],
        ["연면적", formatRange(c.gross_area_min, c.gross_area_max, "평")],
        ["사용가능면적", formatRange(c.usable_area_min, c.usable_area_max, "평")],
        ["건축면적", formatRange(c.building_area_min, c.building_area_max, "평")],
        ["사용승인/도로폭", joinParts(
            toText(c.approval_year_min) ? `${toText(c.approval_year_min)}년 이후` : "",
            toText(c.road_width_min) ? `${toText(c.road_width_min)}m 이상` : ""
        )],
        ["승강기/주차대수", joinParts(
            nonDefault(c.elevator_option, ["전체"]),
            toText(c.parking_min) ? `${toText(c.parking_min)}대 이상` : ""
        )],
    ];
}

function toCompareTokens(value) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "-") return [];
    const split = raw.split(",").map((token) => token.trim()).filter(Boolean);
    return split.length ? split : [raw];
}

function buildCompareDiff(leftValue, rightValue) {
    const leftTokens = toCompareTokens(leftValue);
    const rightTokens = toCompareTokens(rightValue);
    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const added = rightTokens.filter((token) => !leftSet.has(token));
    const removed = leftTokens.filter((token) => !rightSet.has(token));
    return { added, removed };
}

function renderCompareDiffText(diff) {
    const rows = [];
    if (diff.added.length) {
        rows.push(`<div class="mt-1 text-[13px] font-semibold text-blue-600">+ ${escapeMatchHistoryHtml(diff.added.join(", "))}</div>`);
    }
    if (diff.removed.length) {
        rows.push(`<div class="mt-1 text-[13px] font-semibold text-rose-600">- ${escapeMatchHistoryHtml(diff.removed.join(", "))}</div>`);
    }
    return rows.join("");
}

function openMatchHistoryCompareModal() {
    const modalEl = document.getElementById("customerMatchHistoryCompareModal");
    if (!modalEl) return;
    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");
}

function closeMatchHistoryCompareModal() {
    const modalEl = document.getElementById("customerMatchHistoryCompareModal");
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
}

function renderMatchHistoryComparePanel(baseItem) {
    const modalEl = document.getElementById("customerMatchHistoryCompareModal");
    const body = document.getElementById("customerMatchHistoryCompareBody");
    const rightTitle = document.getElementById("customerMatchHistoryCompareRightTitle");
    if (!modalEl || !body || !rightTitle) return;

    if (!baseItem || !currentMatchHistoryConditions) {
        body.innerHTML = "";
        closeMatchHistoryCompareModal();
        return;
    }

    const leftRows = getMatchHistoryCompareRows(baseItem.conditions || {});
    const rightRows = getMatchHistoryCompareRows(currentMatchHistoryConditions || {});
    rightTitle.textContent = `현재 조건 (기준 기록: ${baseItem.name || "저장한 조건"})`;

    body.innerHTML = rightRows.map(([label, rightValue], idx) => {
        const leftValue = leftRows[idx]?.[1] ?? "-";
        const changed = String(leftValue ?? "") !== String(rightValue ?? "");
        const diff = changed ? buildCompareDiff(leftValue, rightValue) : { added: [], removed: [] };
        const diffText = changed ? renderCompareDiffText(diff) : "";
        return `
            <div class="rounded-lg border p-3 bg-slate-100 ${changed ? "border-emerald-300 ring-1 ring-emerald-200" : "border-slate-300"}">
                <div class="text-[13px] font-bold text-slate-700">${escapeMatchHistoryHtml(label)}</div>
                <div class="mt-1 text-[14px] text-slate-800 font-semibold break-words">
                    <div>${escapeMatchHistoryHtml(rightValue)}</div>
                </div>
                ${diffText}
            </div>
        `;
    }).join("");
    openMatchHistoryCompareModal();
}

function renderMatchHistoryList() {
    const container = document.getElementById("customerMatchHistoryList");
    if (!container) return;
    if (!customerMatchHistoryItems.length) {
        container.innerHTML = '<div class="py-8 text-slate-400 text-center">저장된 기록이 없습니다.</div>';
        return;
    }

    container.innerHTML = customerMatchHistoryItems.map((item) => {
        const isEditingName = editingMatchHistoryId === item.id;
        return `
            <div class="border rounded-lg bg-white ${selectedHistoryCompareId === item.id ? "border-emerald-400 shadow-sm" : "border-slate-200"}">
                <div class="px-3 py-2 flex items-center justify-between gap-2">
                    <button type="button" data-role="toggle" data-id="${escapeMatchHistoryHtml(item.id)}"
                        class="flex-1 text-left text-[13px] text-slate-700 hover:text-blue-700">
                        <span class="font-bold">${escapeMatchHistoryHtml(item.name || "저장한 조건")}</span>
                        <span class="text-slate-400 ml-2">${escapeMatchHistoryHtml(formatMatchHistorySummary(item))}</span>
                    </button>
                    <div class="flex items-center gap-1 shrink-0">
                        ${isEditingName ? `
                            <button type="button" data-role="rename-save" data-id="${escapeMatchHistoryHtml(item.id)}"
                                class="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700">저장</button>
                            <button type="button" data-role="rename-cancel" data-id="${escapeMatchHistoryHtml(item.id)}"
                                class="px-2 py-1 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200">취소</button>
                        ` : `
                            <button type="button" data-role="rename" data-id="${escapeMatchHistoryHtml(item.id)}"
                                class="px-2 py-1 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200">수정</button>
                            <button type="button" data-role="apply" data-id="${escapeMatchHistoryHtml(item.id)}"
                                class="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700">적용</button>
                            <button type="button" data-role="compare" data-id="${escapeMatchHistoryHtml(item.id)}"
                                class="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700">비교</button>
                            <button type="button" data-role="delete" data-id="${escapeMatchHistoryHtml(item.id)}"
                                class="px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700">삭제</button>
                        `}
                    </div>
                </div>
                ${isEditingName ? `
                    <div class="px-3 pb-3">
                        <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                            <input type="text" data-role="rename-input" data-id="${escapeMatchHistoryHtml(item.id)}"
                                value="${escapeMatchHistoryHtml(item.name || "")}" maxlength="120"
                                class="flex-1 min-w-0 bg-transparent text-[13px] text-slate-700 outline-none">
                            <span class="text-[11px] text-slate-400 whitespace-nowrap">기록 이름만 수정</span>
                        </div>
                    </div>
                ` : ""}
                <div data-role="detail" data-id="${escapeMatchHistoryHtml(item.id)}" class="hidden border-t border-slate-100 px-3 py-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                    ${formatMatchHistoryDetailRows(item.conditions)}
                </div>
            </div>
        `;
    }).join("");
}

async function openMatchHistoryModal() {
    const modalEl = document.getElementById("customerMatchHistoryModal");
    if (!modalEl) return;
    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");
    currentMatchHistoryConditions = null;
    selectedHistoryCompareId = "";
    editingMatchHistoryId = "";
    closeMatchHistoryCompareModal();
    const compareBody = document.getElementById("customerMatchHistoryCompareBody");
    if (compareBody) compareBody.innerHTML = "";

    const container = document.getElementById("customerMatchHistoryList");
    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) {
        if (container) {
            container.innerHTML = '<div class="py-8 text-slate-400 text-center">고객 저장 후 사용 가능합니다.</div>';
        }
        return;
    }

    if (container) {
        container.innerHTML = '<div class="py-8 text-slate-400 text-center">불러오는 중...</div>';
    }

    try {
        await loadMatchHistoryItems();
        renderMatchHistoryList();
    } catch (err) {
        console.error(err);
        if (container) {
            container.innerHTML = '<div class="py-8 text-red-400 text-center">기록을 불러오지 못했습니다.</div>';
        }
    }
}

function closeMatchHistoryModal() {
    const modalEl = document.getElementById("customerMatchHistoryModal");
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
    currentMatchHistoryConditions = null;
    selectedHistoryCompareId = "";
    editingMatchHistoryId = "";
    closeMatchHistoryCompareModal();
    const compareBody = document.getElementById("customerMatchHistoryCompareBody");
    if (compareBody) compareBody.innerHTML = "";
}

async function saveCurrentMatchHistory() {
    const conditions = collectMatchConditions();
    if (!hasAnyMatchConditionValue(conditions)) {
        alert("저장할 매수 조건이 없습니다.");
        return;
    }

    const customerNumber = getMatchHistoryCustomerNumber();
    if (!customerNumber) {
        alert("고객 저장 후 사용 가능합니다.");
        return;
    }

    const nameInput = document.getElementById("customerMatchHistoryNameInput");
    const customName = String(nameInput?.value || "").trim();
    const now = new Date();
    const fallbackName = `${conditions.address || conditions.business_area || "조건"} ${now.toLocaleString("ko-KR", { hour12: false })}`;

    try {
        await createMatchHistoryItem(customName || fallbackName, conditions);
        await loadMatchHistoryItems();
        if (nameInput) nameInput.value = "";
        renderMatchHistoryList();
    } catch (err) {
        console.error(err);
        alert("기록 저장 중 오류가 발생했습니다.");
    }
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
                progress_status: detail.progress_status || "예비",
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

    return {
        data_detail,
        intro_properties,
        history_data: getCurrentCustomerHistoryData(),
    };
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
            progress_status: item?.progress_status || "예비",
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
        bindCustomerHistoryRows([]);
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
        bindCustomerHistoryRows(payload.history_data || []);
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

function parseCustomerMatchPayload(payload, fallbackPage = 1) {
    const items = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.items) ? payload.items : []);
    const totalCountRaw = Array.isArray(payload)
        ? items.length
        : Number(payload?.total_count ?? items.length);
    const totalPagesRaw = Array.isArray(payload)
        ? 1
        : Number(payload?.total_pages || 1);
    const currentPageRaw = Array.isArray(payload)
        ? fallbackPage
        : Number(payload?.page || fallbackPage);

    const totalCount = Number.isFinite(totalCountRaw) ? totalCountRaw : items.length;
    const totalPages = Number.isFinite(totalPagesRaw) && totalPagesRaw > 0 ? Math.floor(totalPagesRaw) : 1;
    const currentPage = Number.isFinite(currentPageRaw) && currentPageRaw > 0 ? Math.floor(currentPageRaw) : 1;

    return { items, totalCount, totalPages, currentPage };
}

function normalizeCustomerMatchMapItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const address = String(item?.address || "").trim();
            if (!address) return null;

            const bdNumber = String(item?.bd_number || "").trim();
            const bdName = String(item?.bd_name || "").trim();
            const salePrice = String(item?.sale_price || "").trim();
            const lat = Number(item?.lat ?? item?.kakao_lat);
            const lng = Number(item?.lng ?? item?.kakao_lng);

            const normalized = {
                bd_number: bdNumber || null,
                address: address,
                bd_name: bdName,
                sale_price: salePrice,
                detail_url: bdNumber ? `/detail/${encodeURIComponent(bdNumber)}` : ""
            };
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                normalized.lat = lat;
                normalized.lng = lng;
            }
            return normalized;
        })
        .filter(Boolean);
}

async function getCustomerMatchMapItems(options = {}) {
    if (!lastCustomerMatchQueryString) return [];

    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const signal = options.signal;
    const baseParams = new URLSearchParams(lastCustomerMatchQueryString);
    baseParams.delete("page");
    baseParams.delete("page_size");
    baseParams.set("map_only", "true");

    const res = await fetch(`/api/customer/match-search?${baseParams.toString()}`, { signal });
    if (!res.ok) throw new Error("match map search failed");
    const payload = await res.json();
    const allItems = Array.isArray(payload?.items) ? payload.items : [];
    const totalCount = Number(payload?.total_count || allItems.length || 0);
    if (onProgress) {
        onProgress({ loaded: allItems.length, total: totalCount, page: 1, totalPages: 1 });
    }

    const normalized = normalizeCustomerMatchMapItems(allItems);
    const seen = new Set();
    return normalized.filter((item) => {
        const key = `${item.bd_number || ""}|${item.address}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

window.getCustomerMatchMapItems = getCustomerMatchMapItems;
window.getCustomerMatchMapItemCount = function getCustomerMatchMapItemCount() {
    const count = Number(lastCustomerMatchTotalCount);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
};
window.getCustomerIntroMapItemCount = function getCustomerIntroMapItemCount() {
    return getCustomerIntroMapItems().length;
};

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

async function downloadMatchPptByBuildingIds(ids, emptyMessage) {
    const normalizedIds = Array.from(new Set((ids || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id))));

    if (!normalizedIds.length) {
        alert(emptyMessage || "먼저 매칭 결과에서 건물을 선택해 주세요.");
        return;
    }

    try {
        const res = await fetch("/api/building/compare-ppt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bd_numbers: normalizedIds })
        });
        if (!res.ok) throw new Error("download failed");

        const blob = await res.blob();
        const cd = res.headers.get("content-disposition") || "";
        const filenameStarMatch = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        const filenameMatch = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
        const filename = filenameStarMatch
            ? decodeURIComponent(filenameStarMatch[1])
            : (filenameMatch ? decodeURIComponent(filenameMatch[1]) : `[ERA]매물비교_${Date.now()}.pptx`);
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

async function downloadSelectedMatchPpt() {
    await downloadMatchPptByBuildingIds(
        Array.from(selectedMatchBuildingIds),
        "먼저 매칭 결과에서 건물을 선택해 주세요."
    );
}

async function downloadCustomSearchMatchPpt() {
    await downloadMatchPptByBuildingIds(
        customSearchSelectedBuildings.map(item => item.bd_number),
        "먼저 커스텀 검색에서 건물을 선택해 주세요."
    );
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

function normalizeMatchBuildingForIntro(item) {
    if (!item || typeof item !== "object") return null;

    const parsedBdNumber = parseBdNumber(item.bd_number);
    const rawBdNumber = String(item.bd_number ?? "").trim();
    const bdNumber = parsedBdNumber !== null ? String(parsedBdNumber) : rawBdNumber;
    const address = String(item.address || "").trim();
    const bdName = String(item.bd_name || "").trim();
    const salePrice = formatThousandsInputValue(item.sale_price ?? "");
    const pricePerPyeong = formatThousandsInputValue(item.price_per_pyeong ?? "");

    if (!bdNumber && !address && !bdName) return null;

    return {
        bd_number: bdNumber,
        address: address,
        bd_name: bdName,
        sale_price: salePrice,
        price_per_pyeong: pricePerPyeong,
    };
}

function findExistingIntroRowForMatchBuilding(building) {
    const targetBdNumber = parseBdNumber(building?.bd_number);
    const targetAddress = String(building?.address || "").trim();
    const targetBdName = String(building?.bd_name || "").trim();

    return (introRows || []).find((row) => {
        const rowBdNumber = parseBdNumber(row?.bd_number);
        if (targetBdNumber !== null && rowBdNumber !== null && targetBdNumber === rowBdNumber) {
            return true;
        }

        const rowAddress = String(row?.address || "").trim();
        const rowBdName = String(row?.bd_name || "").trim();
        return Boolean(
            targetAddress
            && rowAddress
            && targetBdName
            && rowBdName
            && targetAddress === rowAddress
            && targetBdName === rowBdName
        );
    }) || null;
}

function addMatchBuildingToIntroRows(rawItem) {
    const building = normalizeMatchBuildingForIntro(rawItem);
    if (!building) return;

    const existingRow = findExistingIntroRowForMatchBuilding(building);
    if (existingRow) {
        if (!existingRow.bd_number && building.bd_number) existingRow.bd_number = building.bd_number;
        if (!existingRow.address && building.address) existingRow.address = building.address;
        if (!existingRow.bd_name && building.bd_name) existingRow.bd_name = building.bd_name;
        if (!existingRow.sale_price && building.sale_price) existingRow.sale_price = building.sale_price;
        if (!existingRow.price_per_pyeong && building.price_per_pyeong) existingRow.price_per_pyeong = building.price_per_pyeong;
        if (!Array.isArray(existingRow.details) || !existingRow.details.length) {
            existingRow.details = [createEmptyIntroDetail()];
        }
        existingRow.is_expanded = true;
        renderIntroRows();
        return;
    }

    const newRow = createEmptyIntroRow();
    newRow.bd_number = building.bd_number;
    newRow.address = building.address;
    newRow.bd_name = building.bd_name;
    newRow.sale_price = building.sale_price;
    newRow.price_per_pyeong = building.price_per_pyeong;
    newRow.is_expanded = true;
    introRows.unshift(newRow);
    renderIntroRows();
}

function getIntroDropZoneElement() {
    const sidebar = document.getElementById("rightSidebar");
    if (sidebar) return sidebar;

    const introBody = document.getElementById("introPropertyBody");
    if (!introBody) return null;
    return introBody.closest(".section-card") || introBody;
}

function setIntroDropZoneActive(active) {
    const zone = getIntroDropZoneElement();
    if (!zone) return;
    zone.classList.toggle("drag-over", Boolean(active));
}

function extractDraggedMatchBuilding(dataTransfer) {
    if (!dataTransfer) return null;

    let raw = dataTransfer.getData(CUSTOMER_MATCH_DRAG_MIME);
    if (!raw) {
        const plainText = dataTransfer.getData("text/plain");
        if (plainText && plainText.startsWith(CUSTOMER_MATCH_DRAG_TEXT_PREFIX)) {
            raw = plainText.slice(CUSTOMER_MATCH_DRAG_TEXT_PREFIX.length);
        }
    }
    if (!raw) return null;

    try {
        return normalizeMatchBuildingForIntro(JSON.parse(raw));
    } catch (error) {
        console.warn("invalid dragged match payload", error);
        return null;
    }
}

function hasMatchBuildingDragType(dataTransfer) {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types || []);
    return types.includes(CUSTOMER_MATCH_DRAG_MIME);
}

function isCustomerMatchDragEvent(event) {
    return isDraggingMatchCard || hasMatchBuildingDragType(event?.dataTransfer);
}

function handleCustomerMatchCardDragStart(event) {
    const card = event?.currentTarget;
    if (!card) return;

    const payloadRaw = String(card.dataset?.matchPayload || "").trim();
    if (!payloadRaw) {
        event.preventDefault();
        return;
    }

    let payload = null;
    try {
        payload = normalizeMatchBuildingForIntro(JSON.parse(payloadRaw));
    } catch (error) {
        console.warn("failed to parse match payload for drag", error);
    }
    if (!payload) {
        event.preventDefault();
        return;
    }

    const serialized = JSON.stringify(payload);
    isDraggingMatchCard = true;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(CUSTOMER_MATCH_DRAG_MIME, serialized);
        event.dataTransfer.setData("text/plain", `${CUSTOMER_MATCH_DRAG_TEXT_PREFIX}${serialized}`);
    }

    card.classList.add("opacity-70");
}

function handleCustomerMatchCardDragEnd(event) {
    const card = event?.currentTarget;
    if (card) card.classList.remove("opacity-70");
    isDraggingMatchCard = false;
    introDropZoneDragDepth = 0;
    setIntroDropZoneActive(false);
}

function handleIntroDropZoneDragEnter(event) {
    if (!isCustomerMatchDragEvent(event)) return;
    event.preventDefault();
    introDropZoneDragDepth += 1;
    setIntroDropZoneActive(true);
}

function handleIntroDropZoneDragOver(event) {
    if (!isCustomerMatchDragEvent(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setIntroDropZoneActive(true);
}

function handleIntroDropZoneDragLeave(event) {
    if (!isCustomerMatchDragEvent(event)) return;
    const zone = getIntroDropZoneElement();
    if (zone && event.relatedTarget && zone.contains(event.relatedTarget)) return;

    introDropZoneDragDepth = Math.max(0, introDropZoneDragDepth - 1);
    if (introDropZoneDragDepth === 0) {
        setIntroDropZoneActive(false);
    }
}

function handleIntroDropZoneDrop(event) {
    if (!isCustomerMatchDragEvent(event)) return;
    event.preventDefault();
    isDraggingMatchCard = false;
    introDropZoneDragDepth = 0;
    setIntroDropZoneActive(false);

    const payload = extractDraggedMatchBuilding(event.dataTransfer);
    if (!payload) return;
    addMatchBuildingToIntroRows(payload);
}

function initializeIntroMatchDropZone() {
    const zone = getIntroDropZoneElement();
    if (!zone) return;
    zone.classList.add("intro-dropzone-target");
    zone.title = "매칭 카드를 드래그해서 소개매물에 놓으면 추가됩니다.";
    zone.addEventListener("dragenter", handleIntroDropZoneDragEnter);
    zone.addEventListener("dragover", handleIntroDropZoneDragOver);
    zone.addEventListener("dragleave", handleIntroDropZoneDragLeave);
    zone.addEventListener("drop", handleIntroDropZoneDrop);
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
    const violationOptionInput = document.getElementById("matchViolationOption");
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
    const violationOption = (violationOptionInput?.value || "전체").trim().toUpperCase();
    const locationDecide = (locationDecideInput?.value || "").trim();
    const priceDecide = (priceDecideInput?.value || "").trim();
    const yieldDecide = (yieldDecideInput?.value || "").trim();
    const vacancyDecide = (vacancyDecideInput?.value || "").trim();
    const limitDecide = (limitDecideInput?.value || "").trim();
    const loanDecide = (loanDecideInput?.value || "").trim();
    const hasAddress = isMatchSectorActive("address") && Boolean(address);
    const hasBusinessArea = isMatchSectorActive("business_area") && Boolean(businessArea);
    const hasStationKeyword = isMatchSectorActive("station") && Boolean(stationKeyword);
    const hasStationWalkMin = isMatchSectorActive("station_walk") && stationWalkMin !== null && !Number.isNaN(stationWalkMin);
    const hasStationWalkMax = isMatchSectorActive("station_walk") && stationWalkMax !== null && !Number.isNaN(stationWalkMax);
    const hasCashHoldManwon = isMatchSectorActive("cash_hold") && cashHoldManwon !== null && !Number.isNaN(cashHoldManwon);
    const hasCashHoldPercent = isMatchSectorActive("cash_hold") && cashHoldPercent !== null && !Number.isNaN(cashHoldPercent);

    const hasMinPrice = isMatchSectorActive("sale_price") && minPrice !== null && !Number.isNaN(minPrice);
    const hasMaxPrice = isMatchSectorActive("sale_price") && maxPrice !== null && !Number.isNaN(maxPrice);
    const useMinYield = isMatchSectorActive("yield") && minYield !== null && !Number.isNaN(minYield);

    const hasLandPpMin = isMatchSectorActive("land_pp") && landMin !== null && !Number.isNaN(landMin);
    const hasLandPpMax = isMatchSectorActive("land_pp") && landMax !== null && !Number.isNaN(landMax);
    const hasGrossPpMin = isMatchSectorActive("gross_pp") && grossMin !== null && !Number.isNaN(grossMin);
    const hasGrossPpMax = isMatchSectorActive("gross_pp") && grossMax !== null && !Number.isNaN(grossMax);

    const hasLandAreaMin = isMatchSectorActive("land_area") && landAreaMin !== null && !Number.isNaN(landAreaMin);
    const hasLandAreaMax = isMatchSectorActive("land_area") && landAreaMax !== null && !Number.isNaN(landAreaMax);
    const hasGrossAreaMin = isMatchSectorActive("gross_area") && grossAreaMin !== null && !Number.isNaN(grossAreaMin);
    const hasGrossAreaMax = isMatchSectorActive("gross_area") && grossAreaMax !== null && !Number.isNaN(grossAreaMax);
    const hasUsableAreaMin = isMatchSectorActive("usable_area") && usableAreaMin !== null && !Number.isNaN(usableAreaMin);
    const hasUsableAreaMax = isMatchSectorActive("usable_area") && usableAreaMax !== null && !Number.isNaN(usableAreaMax);
    const hasBuildingAreaMin = isMatchSectorActive("building_area") && buildingAreaMin !== null && !Number.isNaN(buildingAreaMin);
    const hasBuildingAreaMax = isMatchSectorActive("building_area") && buildingAreaMax !== null && !Number.isNaN(buildingAreaMax);

    const hasApprovalYearMin = isMatchSectorActive("approval_year") && approvalYearMin !== null && !Number.isNaN(approvalYearMin);
    const hasRoadWidthMin = isMatchSectorActive("road_width") && roadWidthMin !== null && !Number.isNaN(roadWidthMin);
    const hasElevatorOption = isMatchSectorActive("elevator") && Boolean(elevatorOption);
    const hasParkingMin = isMatchSectorActive("parking") && parkingMin !== null && !Number.isNaN(parkingMin);

    const hasBuildingStatus = isMatchSectorActive("building_status") && buildingStatus && buildingStatus !== "전체";
    const hasViolationOption = isMatchSectorActive("violation") && violationOption && violationOption !== "전체";
    const hasLocationDecide = isMatchSectorActive("grade") && Boolean(locationDecide);
    const hasPriceDecide = isMatchSectorActive("grade") && Boolean(priceDecide);
    const hasYieldDecide = isMatchSectorActive("grade") && Boolean(yieldDecide);
    const hasVacancyDecide = isMatchSectorActive("grade") && Boolean(vacancyDecide);
    const hasLimitDecide = isMatchSectorActive("grade") && Boolean(limitDecide);
    const hasLoanDecide = isMatchSectorActive("grade") && Boolean(loanDecide);

    const hasTypes = isMatchSectorActive("types") && checkedTypes.length > 0;
    const hasZoningCategories = isMatchSectorActive("zoning") && checkedZoningCategories.length > 0;
    const hasUsageCategories = isMatchSectorActive("usage") && checkedUsageCategories.length > 0;

    const hasAnyCondition = hasAddress
        || hasBusinessArea
        || hasStationKeyword
        || hasStationWalkMin
        || hasStationWalkMax
        || hasCashHoldManwon
        || hasCashHoldPercent
        || hasMinPrice
        || hasMaxPrice
        || useMinYield
        || hasLandPpMin
        || hasLandPpMax
        || hasGrossPpMin
        || hasGrossPpMax
        || hasLandAreaMin
        || hasLandAreaMax
        || hasGrossAreaMin
        || hasGrossAreaMax
        || hasUsableAreaMin
        || hasUsableAreaMax
        || hasBuildingAreaMin
        || hasBuildingAreaMax
        || hasApprovalYearMin
        || hasRoadWidthMin
        || hasElevatorOption
        || hasParkingMin
        || hasBuildingStatus
        || hasViolationOption
        || hasLocationDecide
        || hasPriceDecide
        || hasYieldDecide
        || hasVacancyDecide
        || hasLimitDecide
        || hasLoanDecide
        || hasTypes
        || hasZoningCategories
        || hasUsageCategories;

    if (!hasAnyCondition) {
        lastCustomerMatchQueryString = "";
        lastCustomerMatchTotalCount = 0;
        tbody.innerHTML = '<div class="py-6 text-slate-400 text-center">최소 1개 이상 조건을 선택/입력해 주세요.</div>';
        setCustomerMatchCount(0);
        renderCustomerMatchPagination(0, 1);
        return;
    }

    const params = new URLSearchParams();
    lastCustomerMatchTotalCount = 0;
    if (hasAddress) params.set("address", address);
    if (hasBusinessArea) params.set("business_area", businessArea);
    if (hasStationKeyword) params.set("station_keyword", stationKeyword);
    if (hasMinPrice) params.set("min_price", String(minPrice));
    if (hasMaxPrice) params.set("max_price", String(maxPrice));
    if (hasStationWalkMin) params.set("station_walk_min", String(stationWalkMin));
    if (hasStationWalkMax) params.set("station_walk_max", String(stationWalkMax));
    if (hasCashHoldManwon) params.set("cash_hold_manwon", String(cashHoldManwon));
    if (hasCashHoldPercent) params.set("cash_hold_percent", String(cashHoldPercent));
    if (useMinYield) params.set("min_yield", String(minYield));
    if (hasLandPpMin) params.set("land_pp_min", String(landMin));
    if (hasLandPpMax) params.set("land_pp_max", String(landMax));
    if (hasGrossPpMin) params.set("gross_pp_min", String(grossMin));
    if (hasGrossPpMax) params.set("gross_pp_max", String(grossMax));
    if (hasLandAreaMin) params.set("land_area_min", String(landAreaMin));
    if (hasLandAreaMax) params.set("land_area_max", String(landAreaMax));
    if (hasGrossAreaMin) params.set("gross_area_min", String(grossAreaMin));
    if (hasGrossAreaMax) params.set("gross_area_max", String(grossAreaMax));
    if (hasUsableAreaMin) params.set("usable_area_min", String(usableAreaMin));
    if (hasUsableAreaMax) params.set("usable_area_max", String(usableAreaMax));
    if (hasBuildingAreaMin) params.set("building_area_min", String(buildingAreaMin));
    if (hasBuildingAreaMax) params.set("building_area_max", String(buildingAreaMax));
    if (hasApprovalYearMin) params.set("approval_year_min", String(approvalYearMin));
    if (hasRoadWidthMin) params.set("road_width_min", String(roadWidthMin));
    if (hasElevatorOption) params.set("elevator_option", elevatorOption);
    if (hasParkingMin) params.set("parking_min", String(parkingMin));
    if (hasBuildingStatus) params.set("building_status", buildingStatus);
    if (hasViolationOption) params.set("violation_flag", violationOption);
    if (hasLocationDecide) params.set("location_decide", locationDecide);
    if (hasPriceDecide) params.set("price_decide", priceDecide);
    if (hasYieldDecide) params.set("yield_decide", yieldDecide);
    if (hasVacancyDecide) params.set("vacancy_decide", vacancyDecide);
    if (hasLimitDecide) params.set("limit_decide", limitDecide);
    if (hasLoanDecide) params.set("loan_decide", loanDecide);
    if (hasZoningCategories) params.set("zoning_categories", checkedZoningCategories.join(","));
    if (hasUsageCategories) params.set("usage_categories", checkedUsageCategories.join(","));
    if (hasTypes) params.set("types", checkedTypes.join(","));
    const customerNumber = getCustomerNumberFromPath();
    if (customerNumber) {
        params.set("customer_number", String(customerNumber));
    }
    params.set("page", String(customerMatchCurrentPage));
    params.set("page_size", String(CUSTOMER_MATCH_PAGE_SIZE));
    lastCustomerMatchQueryString = params.toString();

    tbody.innerHTML = '<div class="py-6 text-slate-400 text-center">검색 중...</div>';

    try {
        const res = await fetch(`/api/customer/match-search?${params.toString()}`);
        if (!res.ok) throw new Error("match search failed");
        const payload = await res.json();
        const parsed = parseCustomerMatchPayload(payload, customerMatchCurrentPage);

        const totalCount = Number(parsed.totalCount) || 0;
        lastCustomerMatchTotalCount = totalCount;
        const totalPages = Math.max(0, Number(parsed.totalPages) || 0);
        const safePage = Math.max(1, Number(parsed.currentPage) || customerMatchCurrentPage);
        customerMatchCurrentPage = safePage;

        if (!totalCount) {
            tbody.innerHTML = '<div class="py-6 text-slate-400 text-center">조건에 맞는 매물이 없습니다.</div>';
            setCustomerMatchCount(0);
            renderCustomerMatchPagination(0, 1);
            return;
        }

        const pageItems = Array.isArray(parsed.items) ? parsed.items : [];

        tbody.innerHTML = pageItems.map(item => `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer hover:border-blue-300"
                onclick="openBuildingDetail(${item.bd_number})"
                draggable="true"
                data-match-payload="${escapeMatchHistoryHtml(JSON.stringify({
                    bd_number: item.bd_number ?? "",
                    address: item.address || "",
                    bd_name: item.bd_name || "",
                    sale_price: item.sale_price || "",
                    price_per_pyeong: item.price_per_pyeong || "",
                }))}"
                ondragstart="handleCustomerMatchCardDragStart(event)"
                ondragend="handleCustomerMatchCardDragEnd(event)">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <div class="flex flex-wrap items-center gap-2">
                        ${(() => {
                            const isPriceDrop = Boolean(item.is_intro_price_drop);
                            return `
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
                                ${item.is_intro_duplicate ? '<span class="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-1 rounded">소개</span>' : ""}
                                ${isPriceDrop ? '<span class="text-xs font-bold text-red-800 bg-red-100 px-2 py-1 rounded">가격하락</span>' : ""}
                            `;
                        })()}
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
        setCustomerMatchCount(totalCount);
        renderCustomerMatchPagination(totalPages, safePage);
    } catch (err) {
        console.error(err);
        lastCustomerMatchTotalCount = 0;
        tbody.innerHTML = '<div class="py-6 text-red-400 text-center">검색 중 오류가 발생했습니다.</div>';
        setCustomerMatchCount(0);
        renderCustomerMatchPagination(0, 1);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    if (window.opener && typeof window.opener.isLocked !== "undefined") {
        sidebarLocked = Boolean(window.opener.isLocked);
    }
    if (sidebarLocked) {
        applySidebarLock();
    } else {
        removeSidebarLock();
    }
    initCustomerSidebarResize();

    await loadCurrentIntroManagerName();
    await loadCustomerDetail();
    initializeIntroMatchDropZone();
    setCustomerSidebarTab("intro");

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
    const customerSidebarIntroTabBtn = document.getElementById("customerSidebarIntroTabBtn");
    if (customerSidebarIntroTabBtn) {
        customerSidebarIntroTabBtn.addEventListener("click", () => setCustomerSidebarTab("intro"));
    }
    const customerSidebarHistoryTabBtn = document.getElementById("customerSidebarHistoryTabBtn");
    if (customerSidebarHistoryTabBtn) {
        customerSidebarHistoryTabBtn.addEventListener("click", () => setCustomerSidebarTab("history"));
    }
    const addCustomerHistoryBtn = document.getElementById("addCustomerHistoryBtn");
    if (addCustomerHistoryBtn) {
        addCustomerHistoryBtn.addEventListener("click", addCustomerHistoryRow);
    }
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

    const customSearchDownloadBtn = document.getElementById("customSearchDownloadBtn");
    if (customSearchDownloadBtn) {
        customSearchDownloadBtn.addEventListener("click", downloadCustomSearchMatchPpt);
    }
    const customSearchClearBtn = document.getElementById("customSearchClearBtn");
    if (customSearchClearBtn) {
        customSearchClearBtn.addEventListener("click", clearCustomSearchSelectedBuildings);
    }
    renderCustomSearchSelectedBuildings();

    initializeMatchSectorToggles();

    const customerMatchSearchBtn = document.getElementById("customerMatchSearchBtn");
    if (customerMatchSearchBtn) {
        customerMatchSearchBtn.addEventListener("click", () => searchCustomerMatchBuildings(1));
    }
    const openCustomerCustomSearchBtn = document.getElementById("openCustomerCustomSearchBtn");
    if (openCustomerCustomSearchBtn) {
        openCustomerCustomSearchBtn.addEventListener("click", openCustomMatchSearchModal);
    }
    const customerMatchHistoryBtn = document.getElementById("customerMatchHistoryBtn");
    if (customerMatchHistoryBtn) {
        customerMatchHistoryBtn.addEventListener("click", openMatchHistoryModal);
    }
    const customerMatchHistoryCloseBtn = document.getElementById("customerMatchHistoryCloseBtn");
    if (customerMatchHistoryCloseBtn) {
        customerMatchHistoryCloseBtn.addEventListener("click", closeMatchHistoryModal);
    }
    const customerMatchHistoryCompareCloseBtn = document.getElementById("customerMatchHistoryCompareCloseBtn");
    if (customerMatchHistoryCompareCloseBtn) {
        customerMatchHistoryCompareCloseBtn.addEventListener("click", closeMatchHistoryCompareModal);
    }
    const customerMatchHistoryCompareModal = document.getElementById("customerMatchHistoryCompareModal");
    if (customerMatchHistoryCompareModal) {
        customerMatchHistoryCompareModal.addEventListener("click", (e) => {
            if (e.target === customerMatchHistoryCompareModal) {
                closeMatchHistoryCompareModal();
            }
        });
    }
    const customerMatchHistorySaveBtn = document.getElementById("customerMatchHistorySaveBtn");
    if (customerMatchHistorySaveBtn) {
        customerMatchHistorySaveBtn.addEventListener("click", saveCurrentMatchHistory);
    }
    const customerMatchHistoryNameInput = document.getElementById("customerMatchHistoryNameInput");
    if (customerMatchHistoryNameInput) {
        customerMatchHistoryNameInput.addEventListener("keydown", async (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            await saveCurrentMatchHistory();
        });
    }
    const customerMatchHistoryList = document.getElementById("customerMatchHistoryList");
    if (customerMatchHistoryList) {
        customerMatchHistoryList.addEventListener("keydown", async (e) => {
            const renameInput = e.target?.closest('input[data-role="rename-input"]');
            if (!renameInput) return;
            const id = renameInput.dataset.id;
            if (!id) return;

            if (e.key === "Enter") {
                e.preventDefault();
                await submitMatchHistoryRename(id);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                cancelMatchHistoryRename();
            }
        });
        customerMatchHistoryList.addEventListener("click", async (e) => {
            const target = e.target?.closest("button[data-role]");
            if (!target) return;
            const role = target.dataset.role;
            const id = target.dataset.id;
            if (!id) return;
            const found = customerMatchHistoryItems.find((item) => item.id === id);
            if (role !== "rename-cancel" && !found) return;

            if (role === "rename") {
                startMatchHistoryRename(id);
                return;
            }
            if (role === "rename-save") {
                await submitMatchHistoryRename(id);
                return;
            }
            if (role === "rename-cancel") {
                cancelMatchHistoryRename();
                return;
            }
            if (role === "toggle") {
                const detailEl = customerMatchHistoryList.querySelector(`[data-role="detail"][data-id="${id}"]`);
                if (detailEl) detailEl.classList.toggle("hidden");
                return;
            }
            if (role === "apply") {
                applyMatchConditions(found.conditions);
                closeMatchHistoryModal();
                return;
            }
            if (role === "compare") {
                currentMatchHistoryConditions = collectMatchConditions();
                selectedHistoryCompareId = id;
                renderMatchHistoryList();
                renderMatchHistoryComparePanel(found);
                return;
            }
            if (role === "delete") {
                try {
                    await deleteMatchHistoryItem(id);
                    await loadMatchHistoryItems();
                    if (selectedHistoryCompareId === id) {
                        selectedHistoryCompareId = "";
                        renderMatchHistoryComparePanel(null);
                    }
                    if (editingMatchHistoryId === id) {
                        editingMatchHistoryId = "";
                    }
                    renderMatchHistoryList();
                } catch (err) {
                    console.error(err);
                    alert("기록 삭제 중 오류가 발생했습니다.");
                }
            }
        });
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
        const historyModalEl = document.getElementById("customerMatchHistoryModal");
        if (historyModalEl && !historyModalEl.classList.contains("hidden") && e.key === "Escape") {
            closeMatchHistoryModal();
            return;
        }
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
    const customerMatchHistoryModal = document.getElementById("customerMatchHistoryModal");
    if (customerMatchHistoryModal) {
        customerMatchHistoryModal.addEventListener("click", (e) => {
            if (e.target === customerMatchHistoryModal) closeMatchHistoryModal();
        });
    }

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
// Redirect to login page when API calls return 401 (expired session).
(function installAuthRedirectFetchGuard() {
    if (typeof window === "undefined" || typeof window.fetch !== "function") return;
    if (window.__authRedirectFetchGuardInstalled) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.status !== 401) return response;

        let redirectUrl = "";
        try {
            const payload = await response.clone().json();
            if (payload && typeof payload.redirect === "string") {
                redirectUrl = payload.redirect.trim();
            }
        } catch (e) {
            // Ignore JSON parse errors and use fallback redirect.
        }

        if (!redirectUrl) {
            const next = `${window.location.pathname}${window.location.search}`;
            redirectUrl = `/login?next=${encodeURIComponent(next)}`;
        }

        window.location.href = redirectUrl;
        throw new Error("authentication required");
    };

    window.__authRedirectFetchGuardInstalled = true;
})();
