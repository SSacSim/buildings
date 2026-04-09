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

let currentPage = 1;
let currentAddress = '';
let currentcategory = '';
let currentSearchMode = 'building';
let currentBuildingTotalPages = null;
let currentCustomerTotalPages = null;
const SEARCH_TYPE_SELECT_THEME = {
    building: {
        selectBg: '#ecfdf5',
        selectBorder: '#86efac',
        selectText: '#166534',
        optionBg: '#dcfce7',
        optionText: '#166534',
    },
    customer: {
        selectBg: '#fff7ed',
        selectBorder: '#fb923c',
        selectText: '#9a3412',
        optionBg: '#ffedd5',
        optionText: '#9a3412',
    },
};
const BUILDING_PAGE_SIZE = 15;
const CUSTOMER_PAGE_SIZE = 20;
const pageGroupSize = 5;
const NOTICE_HIDE_DAYS = 7;
let currentMainNotice = null;
let latestBuildingMapItems = [];
let latestBuildingMapQueryKey = "";
let latestBuildingMapCacheReady = false;
let latestBuildingMapFetchPromise = null;
let hasExecutedBuildingSearch = false;
let isMainTitleRefreshing = false;

const CUSTOMER_PROGRESS_BADGE_THEME = {
    "-": { color: "#64748b", background: "#f8fafc", border: "#cbd5e1" },
    "검토": { color: "#1d4ed8", background: "#dbeafe", border: "#93c5fd" },
    "집중": { color: "#b45309", background: "#ffedd5", border: "#fdba74" },
    "완료": { color: "#047857", background: "#d1fae5", border: "#86efac" },
    "보류": { color: "#b42318", background: "#fee2e2", border: "#f4a3a3" },
};

const CUSTOMER_STATE_BADGE_THEME = {
    A: { color: "#1d4ed8", background: "#dbeafe", border: "#93c5fd" },
    B: { color: "#047857", background: "#d1fae5", border: "#86efac" },
    C: { color: "#a16207", background: "#fef3c7", border: "#fde68a" },
    X: { color: "#b42318", background: "#fee2e2", border: "#f4a3a3" },
};

function buildCustomerBadgeStyle(theme) {
    const safeTheme = theme || CUSTOMER_PROGRESS_BADGE_THEME["-"];
    return `color: ${safeTheme.color}; background-color: ${safeTheme.background}; border: 1px solid ${safeTheme.border};`;
}

function resolveDisplayName(user) {
    const displayName = String(user?.display_name || "").trim();
    if (displayName) return displayName;

    const username = String(user?.username || "").trim();
    if (username) return username;

    return "내 계정";
}

async function initializeAccountMenu() {
    const wrapper = document.getElementById("accountMenuWrapper");
    const button = document.getElementById("accountMenuButton");
    const dropdown = document.getElementById("accountMenuDropdown");
    if (!wrapper || !button || !dropdown) return;

    const nameEl = document.getElementById("accountMenuName");
    const usernameEl = document.getElementById("accountMenuUsername");

    const closeMenu = () => {
        dropdown.classList.add("hidden");
        button.setAttribute("aria-expanded", "false");
    };

    const toggleMenu = () => {
        const willOpen = dropdown.classList.contains("hidden");
        dropdown.classList.toggle("hidden", !willOpen);
        button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    };

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleMenu();
    });

    document.addEventListener("click", (event) => {
        if (!wrapper.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMenu();
        }
    });

    try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;

        const payload = await res.json();
        const user = payload?.user || {};
        if (nameEl) {
            nameEl.textContent = resolveDisplayName(user);
        }
        if (usernameEl) {
            const username = String(user?.username || "").trim();
            usernameEl.textContent = username ? `@${username}` : "";
        }
    } catch (err) {
        // Ignore profile load failures and keep default menu labels.
    }
}

function resolveNoticeVersion(notice) {
    return String(notice?.update_time || notice?.notice_id || "default");
}

function getNoticeHideStorageKey(notice) {
    return `main_notice_hide_until_${notice?.notice_id || 1}_${resolveNoticeVersion(notice)}`;
}

function shouldSuppressMainNotice(notice) {
    const key = getNoticeHideStorageKey(notice);
    const hiddenUntil = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(hiddenUntil) && Date.now() < hiddenUntil;
}

function hideMainNoticeModal() {
    const modal = document.getElementById("mainNoticeModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function closeMainNoticeModal() {
    const hideWeek = document.getElementById("mainNoticeHideWeek");
    if (hideWeek?.checked && currentMainNotice) {
        const key = getNoticeHideStorageKey(currentMainNotice);
        const nextWeek = Date.now() + (NOTICE_HIDE_DAYS * 24 * 60 * 60 * 1000);
        localStorage.setItem(key, String(nextWeek));
    }
    hideMainNoticeModal();
}

function normalizeMainNoticeImageUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    if (value.startsWith("/photo/notice/")) return value;

    try {
        const parsed = new URL(value, window.location.origin);
        if (parsed.origin !== window.location.origin) return "";
        if (!parsed.pathname.startsWith("/photo/notice/")) return "";
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch (err) {
        return "";
    }
}

function appendMainNoticeText(container, text) {
    const value = String(text || "");
    if (!value) return;

    const textBlock = document.createElement("div");
    textBlock.className = "whitespace-pre-wrap break-words text-sm text-slate-700 leading-relaxed";
    textBlock.textContent = value;
    container.appendChild(textBlock);
}

function appendMainNoticeImage(container, rawUrl) {
    const imageUrl = normalizeMainNoticeImageUrl(rawUrl);
    if (!imageUrl) return false;

    const imageWrap = document.createElement("div");
    imageWrap.className = "rounded-lg border border-slate-200 bg-slate-50 p-2";

    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "공지 이미지";
    image.loading = "lazy";
    image.className = "max-h-[50vh] w-full rounded object-contain";

    imageWrap.appendChild(image);
    container.appendChild(imageWrap);
    return true;
}

function renderMainNoticeContent(contentEl, rawContent) {
    if (!contentEl) return;

    const content = String(rawContent || "");
    contentEl.replaceChildren();

    const tokenRegex = /!\[[^\]]*]\(([^)]+)\)/g;
    let cursor = 0;
    let match;

    while ((match = tokenRegex.exec(content)) !== null) {
        appendMainNoticeText(contentEl, content.slice(cursor, match.index));
        const inserted = appendMainNoticeImage(contentEl, match[1]);
        if (!inserted) {
            appendMainNoticeText(contentEl, match[0]);
        }
        cursor = tokenRegex.lastIndex;
    }

    appendMainNoticeText(contentEl, content.slice(cursor));
}

function showMainNoticeModal(notice) {
    const modal = document.getElementById("mainNoticeModal");
    const titleEl = document.getElementById("mainNoticeTitle");
    const contentEl = document.getElementById("mainNoticeContent");
    const hideWeek = document.getElementById("mainNoticeHideWeek");
    if (!modal || !titleEl || !contentEl || !hideWeek) return;

    currentMainNotice = notice;
    titleEl.textContent = String(notice?.title || "공지사항").trim() || "공지사항";
    renderMainNoticeContent(contentEl, notice?.content || "");
    hideWeek.checked = false;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function initializeMainNoticeModal() {
    const modal = document.getElementById("mainNoticeModal");
    const closeBtn = document.getElementById("mainNoticeCloseBtn");
    const confirmBtn = document.getElementById("mainNoticeConfirmBtn");
    if (!modal || !closeBtn || !confirmBtn) return;
    if (modal.dataset.noticeInit === "true") return;
    modal.dataset.noticeInit = "true";

    closeBtn.addEventListener("click", closeMainNoticeModal);
    confirmBtn.addEventListener("click", closeMainNoticeModal);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeMainNoticeModal();
        }
    });
}

async function loadMainNoticePopup() {
    initializeMainNoticeModal();

    try {
        const res = await fetch("/api/notice/current");
        if (!res.ok) return;

        const payload = await res.json();
        const notice = payload?.notice || null;
        const content = String(notice?.content || "").trim();
        if (!notice || !notice.enabled || !content) return;
        if (shouldSuppressMainNotice(notice)) return;

        showMainNoticeModal(notice);
    } catch (err) {
        // Ignore notice loading errors to avoid blocking main screen usage.
    }
}

function setStatusOptions(mode) {
    const statusSelect = document.getElementById('statusSelect');
    if (!statusSelect) return;

    if (mode === 'customer') {
        statusSelect.innerHTML = `
            <option value="">전체</option>
            <option value="검토">검토</option>
            <option value="집중">집중</option>
            <option value="완료">완료</option>
            <option value="보류">보류</option>
        `;
        return;
    }

    statusSelect.innerHTML = `
        <option value="">전체</option>
        <option value="준비">준비</option>
        <option value="완료">완료</option>
        <option value="매각">매각</option>
        <option value="보류">보류</option>
    `;
}

function applySearchTypeSelectTheme(selectEl) {
    if (!selectEl) return;

    const mode = selectEl.value === 'customer' ? 'customer' : 'building';
    const theme = SEARCH_TYPE_SELECT_THEME[mode];
    selectEl.style.backgroundColor = theme.selectBg;
    selectEl.style.borderColor = theme.selectBorder;
    selectEl.style.color = theme.selectText;

    Array.from(selectEl.options).forEach((option) => {
        const optionTheme = SEARCH_TYPE_SELECT_THEME[option.value === 'customer' ? 'customer' : 'building'];
        option.style.backgroundColor = optionTheme.optionBg;
        option.style.color = optionTheme.optionText;
    });
}

function filterByStatus() {
    if (currentSearchMode === 'customer') {
        currentPage = 1;
        searchCustomer(currentPage);
        return;
    }
    search();
}

function toggleAdvancedFilterPanel() {
    const panel = document.getElementById('advancedFilterPanel');
    const toggle = document.getElementById('advancedFilterToggle');
    if (!panel || !toggle) return;
    const isClosed = panel.classList.contains('-translate-x-full');
    panel.classList.toggle('-translate-x-full', !isClosed);
    toggle.textContent = isClosed ? '>' : '<';
}

function closeAdvancedFilterPanel() {
    const panel = document.getElementById('advancedFilterPanel');
    const toggle = document.getElementById('advancedFilterToggle');
    if (!panel || !toggle) return;
    panel.classList.add('-translate-x-full');
    toggle.textContent = '<';
}

function resetAdvancedFilters() {
    const panel = document.getElementById('advancedFilterPanel');
    if (!panel) return;
    panel.querySelectorAll('input').forEach((el) => {
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
    });
    panel.querySelectorAll('select').forEach((el) => {
        if (el.id === 'matchBuildingStatus' || el.id === 'matchViolationOption') el.value = '전체';
        else el.value = '';
    });
}

function collectAdvancedFilters() {
    const get = (id) => document.getElementById(id)?.value?.trim() || '';
    const numeric = (id) => (get(id) || '').replace(/[^0-9.]/g, '');
    return {
        address: get('matchAddressInput'),
        site_location: get('matchBusinessAreaInput'),
        station_keyword: get('matchStationKeyword'),
        station_walk_min: numeric('matchStationWalkMin'),
        station_walk_max: numeric('matchStationWalkMax'),
        cash_hold_manwon: numeric('matchCashHoldManwon'),
        cash_hold_percent: numeric('matchCashHoldPercent'),
        min_price: numeric('matchMinPrice'),
        max_price: numeric('matchMaxPrice'),
        min_yield: numeric('matchMinYieldInput'),
        land_pp_min: numeric('matchLandPyeongMin'),
        land_pp_max: numeric('matchLandPyeongMax'),
        gross_pp_min: numeric('matchGrossPyeongMin'),
        gross_pp_max: numeric('matchGrossPyeongMax'),
        land_area_min: numeric('matchLandAreaMin'),
        land_area_max: numeric('matchLandAreaMax'),
        gross_area_min: numeric('matchGrossAreaMin'),
        gross_area_max: numeric('matchGrossAreaMax'),
        usable_area_min: numeric('matchUsableAreaMin'),
        usable_area_max: numeric('matchUsableAreaMax'),
        building_area_min: numeric('matchBuildingAreaMin'),
        building_area_max: numeric('matchBuildingAreaMax'),
        approval_year_min: numeric('matchApprovalYearMin'),
        road_width_min: numeric('matchRoadWidthMin'),
        parking_min: numeric('matchParkingMin'),
        elevator_option: get('matchElevatorOption'),
        building_status: get('matchBuildingStatus'),
        violation_option: get('matchViolationOption'),
        location_decide: get('matchLocationDecide'),
        price_decide: get('matchPriceDecide'),
        yield_decide: get('matchYieldDecide'),
        vacancy_decide: get('matchVacancyDecide'),
        limit_decide: get('matchLimitDecide'),
        loan_decide: get('matchLoanDecide'),
        types: Array.from(document.querySelectorAll('input[name="matchType"]:checked')).map((el) => el.value).join(','),
        zoning_categories: Array.from(document.querySelectorAll('input[name="matchZoningCategory"]:checked')).map((el) => el.value).join(','),
        usage_categories: Array.from(document.querySelectorAll('input[name="matchUsageCategory"]:checked')).map((el) => el.value).join(','),
    };
}

function hasAdvancedFilters() {
    const f = collectAdvancedFilters();
    if (f.building_status && f.building_status !== '전체') return true;
    if (f.violation_option && f.violation_option !== '전체') return true;
    return Object.entries(f).some(([k, v]) => (
        k !== 'building_status'
        && k !== 'violation_option'
        && String(v || '').trim() !== ''
    ));
}

function applyAdvancedFilters() {
    currentPage = 1;
    currentAddress = document.getElementById('addressInput').value;
    currentcategory = document.getElementById('statusSelect').value;
    closeAdvancedFilterPanel();
    requestAnimationFrame(() => {
        fetchBuildings(currentPage, currentcategory);
    });
}

function search() {
    currentPage = 1;
    currentAddress = document.getElementById('addressInput').value;
    currentcategory = document.getElementById('statusSelect').value;
    fetchBuildings(currentPage , currentcategory);
}

function unifiedSearch() {
    const select = document.getElementById('searchTypeSelect');
    const mode = select ? select.value : 'building';
    currentSearchMode = mode;
    setStatusOptions(mode);
    if (mode === 'customer') {
        currentPage = 1;
        searchCustomer(currentPage);
        return;
    }
    search();
}

async function refreshMainDashboardByTitle() {
    if (isMainTitleRefreshing) return;
    isMainTitleRefreshing = true;

    const titleEl = document.getElementById('mainDashboardTitle');
    if (titleEl) titleEl.classList.add('animate-pulse', 'opacity-70');
    window.setTimeout(() => {
        window.location.reload();
    }, 120);
}

function buildMainSearchMapItems(items) {
    if (!Array.isArray(items)) return [];

    const seen = new Set();
    return items
        .map((item) => {
            const address = String(item?.address || "").trim();
            if (!address) return null;

            const bdNumber = String(item?.bd_number || "").trim();
            const bdName = String(item?.bd_name || "").trim();
            const salePrice = String(item?.sale_price || "").trim();
            const detailUrl = bdNumber ? `/detail/${encodeURIComponent(bdNumber)}` : "";
            const key = `${bdNumber}|${address}`;
            if (seen.has(key)) return null;
            seen.add(key);

            return {
                bd_number: bdNumber || null,
                address: address,
                bd_name: bdName,
                sale_price: salePrice,
                status: String(item?.status || "").trim(),
                detail_url: detailUrl
            };
        })
        .filter(Boolean);
}

function updateMainSearchMapItems(items, options = {}) {
    const { isFullSet = false, queryKey = "" } = options;
    latestBuildingMapItems = buildMainSearchMapItems(items);
    if (queryKey) {
        latestBuildingMapQueryKey = queryKey;
    }
    latestBuildingMapCacheReady = Boolean(isFullSet);
    window.dispatchEvent(
        new CustomEvent("main:searchResultsUpdated", {
            detail: { items: latestBuildingMapItems }
        })
    );
}

function getMainBuildingMapQueryKey() {
    if (currentSearchMode !== "building") {
        return "mode:customer";
    }
    if (hasAdvancedFilters()) {
        const advanced = collectAdvancedFilters();
        const keyword = String(currentAddress || "").trim();
        return `advanced:${JSON.stringify(advanced)}|keyword:${keyword}|status:${String(currentcategory || "")}`;
    }
    return `simple:${String(currentAddress || "")}|status:${String(currentcategory || "")}`;
}

function buildAdvancedOverviewParams(advanced, category, page = 1, pageSize = 100, keyword = "") {
    const params = new URLSearchParams();
    params.set("building_page", String(page));
    params.set("page_size", String(pageSize));
    if (advanced.address) params.set("address", advanced.address);
    const normalizedKeyword = String(keyword || "").trim();
    if (normalizedKeyword) params.set("keyword", normalizedKeyword);
    if (advanced.site_location) params.set("site_location", advanced.site_location);
    if (advanced.station_keyword) params.set("station_keyword", advanced.station_keyword);
    if (advanced.station_walk_min) params.set("station_walk_min", advanced.station_walk_min);
    if (advanced.station_walk_max) params.set("station_walk_max", advanced.station_walk_max);
    if (advanced.cash_hold_manwon) params.set("cash_hold_manwon", advanced.cash_hold_manwon);
    if (advanced.cash_hold_percent) params.set("cash_hold_percent", advanced.cash_hold_percent);
    if (advanced.min_price) params.set("min_price", advanced.min_price);
    if (advanced.max_price) params.set("max_price", advanced.max_price);
    if (advanced.min_yield) params.set("min_yield", advanced.min_yield);
    if (advanced.land_pp_min) params.set("land_pp_min", advanced.land_pp_min);
    if (advanced.land_pp_max) params.set("land_pp_max", advanced.land_pp_max);
    if (advanced.gross_pp_min) params.set("gross_pp_min", advanced.gross_pp_min);
    if (advanced.gross_pp_max) params.set("gross_pp_max", advanced.gross_pp_max);
    if (advanced.land_area_min) params.set("land_area_min", advanced.land_area_min);
    if (advanced.land_area_max) params.set("land_area_max", advanced.land_area_max);
    if (advanced.gross_area_min) params.set("gross_area_min", advanced.gross_area_min);
    if (advanced.gross_area_max) params.set("gross_area_max", advanced.gross_area_max);
    if (advanced.usable_area_min) params.set("usable_area_min", advanced.usable_area_min);
    if (advanced.usable_area_max) params.set("usable_area_max", advanced.usable_area_max);
    if (advanced.building_area_min) params.set("building_area_min", advanced.building_area_min);
    if (advanced.building_area_max) params.set("building_area_max", advanced.building_area_max);
    if (advanced.approval_year_min) params.set("approval_year_min", advanced.approval_year_min);
    if (advanced.road_width_min) params.set("road_width_min", advanced.road_width_min);
    if (advanced.parking_min) params.set("parking_min", advanced.parking_min);
    if (advanced.elevator_option) params.set("elevator_option", advanced.elevator_option);

    const mergedBuildingStatus = (advanced.building_status && advanced.building_status !== "?勳泊")
        ? advanced.building_status
        : (category || "");
    params.set("building_status", mergedBuildingStatus);

    if (advanced.violation_option && advanced.violation_option !== "?勳泊") {
        params.set("violation_flag", String(advanced.violation_option).toUpperCase());
    }
    if (advanced.location_decide) params.set("location_decide", advanced.location_decide);
    if (advanced.price_decide) params.set("price_decide", advanced.price_decide);
    if (advanced.yield_decide) params.set("yield_decide", advanced.yield_decide);
    if (advanced.vacancy_decide) params.set("vacancy_decide", advanced.vacancy_decide);
    if (advanced.limit_decide) params.set("limit_decide", advanced.limit_decide);
    if (advanced.loan_decide) params.set("loan_decide", advanced.loan_decide);
    if (advanced.types) params.set("types", advanced.types);
    if (advanced.zoning_categories) params.set("zoning_categories", advanced.zoning_categories);
    if (advanced.usage_categories) params.set("usage_categories", advanced.usage_categories);

    return params;
}

async function fetchAllSimpleSearchRows(address, category) {
    const res = await fetch("/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            address: String(address || ""),
            page: 1,
            category: String(category || "")
        })
    });
    const firstPayload = await res.json();
    if (!Array.isArray(firstPayload) || firstPayload.length === 0) {
        return [];
    }

    const rows = Array.isArray(firstPayload.slice(1)) ? firstPayload.slice(1) : [];
    const totalCount = Number(firstPayload?.[0]?.total_count || 0);
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / BUILDING_PAGE_SIZE) : 0;
    if (totalPages <= 1) {
        return rows;
    }

    for (let page = 2; page <= totalPages; page += 1) {
        const pageRes = await fetch("/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                address: String(address || ""),
                page: page,
                category: String(category || "")
            })
        });
        const pagePayload = await pageRes.json();
        if (!Array.isArray(pagePayload) || pagePayload.length <= 1) {
            continue;
        }
        rows.push(...pagePayload.slice(1));
    }

    return rows;
}

async function fetchAllAdvancedSearchRows(advanced, category, keyword = "") {
    const firstParams = buildAdvancedOverviewParams(advanced, category, 1, 100, keyword);
    const firstRes = await fetch(`/api/insight/overview?${firstParams.toString()}`);
    const firstPayload = await firstRes.json();
    const rows = Array.isArray(firstPayload?.buildings) ? [...firstPayload.buildings] : [];
    const totalPages = Number(firstPayload?.buildings_total_pages || 0);
    if (totalPages <= 1) {
        return rows;
    }

    for (let page = 2; page <= totalPages; page += 1) {
        const params = buildAdvancedOverviewParams(advanced, category, page, 100, keyword);
        const res = await fetch(`/api/insight/overview?${params.toString()}`);
        const payload = await res.json();
        const pageRows = Array.isArray(payload?.buildings) ? payload.buildings : [];
        rows.push(...pageRows);
    }

    return rows;
}

async function loadMainSearchMapItems(force = false) {
    if (currentSearchMode !== "building") {
        latestBuildingMapItems = [];
        latestBuildingMapQueryKey = getMainBuildingMapQueryKey();
        latestBuildingMapCacheReady = true;
        return [];
    }
    if (!hasExecutedBuildingSearch) {
        latestBuildingMapItems = [];
        latestBuildingMapQueryKey = getMainBuildingMapQueryKey();
        latestBuildingMapCacheReady = true;
        return [];
    }

    const queryKey = getMainBuildingMapQueryKey();
    if (!force && latestBuildingMapCacheReady && latestBuildingMapQueryKey === queryKey) {
        return [...latestBuildingMapItems];
    }
    if (!force && latestBuildingMapFetchPromise && latestBuildingMapQueryKey === queryKey) {
        return latestBuildingMapFetchPromise;
    }

    latestBuildingMapQueryKey = queryKey;
    latestBuildingMapCacheReady = false;

    const fetchPromise = (async () => {
        const rows = hasAdvancedFilters()
            ? await fetchAllAdvancedSearchRows(collectAdvancedFilters(), currentcategory, currentAddress)
            : await fetchAllSimpleSearchRows(currentAddress, currentcategory);

        updateMainSearchMapItems(rows, { isFullSet: true, queryKey });
        return [...latestBuildingMapItems];
    })()
        .catch((error) => {
            console.error("failed to fetch all map items", error);
            updateMainSearchMapItems([], { isFullSet: true, queryKey });
            return [];
        })
        .finally(() => {
            if (latestBuildingMapFetchPromise === fetchPromise) {
                latestBuildingMapFetchPromise = null;
            }
        });

    latestBuildingMapFetchPromise = fetchPromise;
    return fetchPromise;
}

window.getMainSearchMapItems = function getMainSearchMapItems() {
    return loadMainSearchMapItems(false);
};

function renderCustomerCards(data) {
    const list = document.getElementById('addressList');
    const items = Array.isArray(data) ? data : [];
    updateMainSearchMapItems([]);

    if (!items.length) {
        document.getElementById("totalCount").innerText = "전체: 0건";
        list.innerHTML = '<div class="text-center text-slate-400 py-20">고객 검색 결과가 없습니다.</div>';
        return;
    }

    document.getElementById("totalCount").innerText = `전체: ${formatNumberWithComma(items.length)}건`;

    const customerCards = items.map((item) => {
        const desiredPrice = item.desired_price_manwon
            ? `${formatNumberWithComma(String(item.desired_price_manwon))}만원`
            : '-';
        const customerProgress = String(item.status || '-').trim() || '-';
        const customerStateCode = String(item.customer_state || '').trim().toUpperCase();
        const customerStateMap = {
            A: 'A(원활) : 최근 7일 이내 소통, 실행력 높은 매수자',
            B: 'B(보통) : 반응은 있으나 느림, 조건 제한 많음',
            C: 'C(어려움) : 응답 지연, 반복 제안에도 무반응',
            X: 'X(비활성) : 3개월 초과 미접촉, 제외 대상'
        };
        const customerProgressBadgeStyle = buildCustomerBadgeStyle(
            CUSTOMER_PROGRESS_BADGE_THEME[customerProgress] || CUSTOMER_PROGRESS_BADGE_THEME["-"]
        );
        const customerStateText = customerStateMap[customerStateCode] || '-';
        const customerStateBadgeStyle = buildCustomerBadgeStyle(
            CUSTOMER_STATE_BADGE_THEME[customerStateCode] || CUSTOMER_PROGRESS_BADGE_THEME["-"]
        );

        return `
            <div onclick="goToCustomer(${item.customer_number})"
                 class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group">
                <div class="flex justify-between items-start gap-3 mb-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                            CUSTOMER: ${item.customer_number}
                        </span>
                        <span class="text-xs font-bold px-2 py-1 rounded" style="${customerProgressBadgeStyle}">
                            진행상황: ${customerProgress}
                        </span>
                        <span class="text-xs font-bold px-2 py-1 rounded" style="${customerStateBadgeStyle}">
                            상태: ${customerStateText}
                        </span>
                    </div>
                    <span class="text-slate-300 group-hover:text-emerald-600 text-sm shrink-0">
                        고객 상세로 이동
                    </span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-sm text-slate-600">
                    <p>회사명: ${item.buyer_name || '-'}</p>
                    <p>대표자: ${item.ceo_name || '-'}</p>
                    <p>연락처: ${item.phone || '-'}</p>
                    <p>이메일: ${item.email || '-'}</p>
                    <p>유입경로: ${item.first_contact || '-'}</p>
                    <p>매매가: ${desiredPrice}</p>
                    <p>상권: ${item.business_area || '-'}</p>
                    <p>건물: ${item.building_preference || '-'}</p>
                    <p>주 관심지역: ${item.main_interest_region || '-'}</p>
                </div>
            </div>
        `;
    });

    list.innerHTML = customerCards.join('');
}

function renderBuildingCards(items) {
    const list = document.getElementById('addressList');
    updateMainSearchMapItems(items);
    list.innerHTML = '';

    items.forEach(item => {
        const card = `
            <div onclick="goToDetail('${item.bd_number}')"
                 class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group">
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded">
                        ID: ${item.bd_number}
                    </span>
                    <span class="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded">
                    FLAG: ${
                        [item.location_decide,
                        item.price_decide,
                        item.yield_decide,
                        item.vacancy_decide,
                        item.limit_decide,
                        item.loan_decide]
                        .map(v => v === "선택" ? "N" : v)
                        .join("")
                    }
                    </span>
                    <span class="text-slate-300 group-hover:text-blue-500 text-sm">
                        새 창에서 상세정보 ↗
                    </span>
                </div>
                <p class="text-lg font-semibold text-slate-700">
                    주소: ${item.address || '정보 없음'}
                </p>
                <div class="grid grid-cols-4 gap-2">
                    <p class="text-sm text-slate-500">건물명: ${item.bd_name || '-'}</p>
                    <p class="text-sm text-slate-500">매매가: ${item.sale_price || '0'}</p>
                    <p class="text-sm text-slate-500">상태: ${item.status || '준비'}</p>
                    <p class="text-sm text-slate-500">수익률: ${item.yield_rate || '0'}</p>
                    <p class="text-sm text-slate-500">대지 평: ${item.land_area_pyeong || '0'}평</p>
                    <p class="text-sm text-slate-500">연면적 평: ${item.gross_area_pyeong || '0'}평</p>
                    <p class="text-sm text-slate-500">용도지역(토지): ${item.zoning_type || '-'}</p>
                    <p class="text-sm text-slate-500">승인날짜: ${item.approval_date || '-'}</p>
                    <p class="text-sm text-slate-500">승강기: ${item.elevator || '-'}</p>
                    <p class="text-sm text-slate-500">주차대수: ${item.parking_capacity || '-'}</p>
                </div>
            </div>
        `;
        list.innerHTML += card;
    });
}

async function fetchBuildingsAdvanced(page, category) {
    const list = document.getElementById('addressList');
    const loading = document.getElementById('loading');
    const pagination = document.getElementById('pagination');
    const advanced = collectAdvancedFilters();

    list.innerHTML = '';
    pagination.innerHTML = '';
    loading.classList.remove('hidden');
    hasExecutedBuildingSearch = true;

    const params = new URLSearchParams();
    params.set('building_page', String(page));
    params.set('page_size', '20');
    if (advanced.address) params.set('address', advanced.address);
    const keyword = String(currentAddress || '').trim();
    if (keyword) params.set('keyword', keyword);
    if (advanced.site_location) params.set('site_location', advanced.site_location);
    if (advanced.station_keyword) params.set('station_keyword', advanced.station_keyword);
    if (advanced.station_walk_min) params.set('station_walk_min', advanced.station_walk_min);
    if (advanced.station_walk_max) params.set('station_walk_max', advanced.station_walk_max);
    if (advanced.cash_hold_manwon) params.set('cash_hold_manwon', advanced.cash_hold_manwon);
    if (advanced.cash_hold_percent) params.set('cash_hold_percent', advanced.cash_hold_percent);
    if (advanced.min_price) params.set('min_price', advanced.min_price);
    if (advanced.max_price) params.set('max_price', advanced.max_price);
    if (advanced.min_yield) params.set('min_yield', advanced.min_yield);
    if (advanced.land_pp_min) params.set('land_pp_min', advanced.land_pp_min);
    if (advanced.land_pp_max) params.set('land_pp_max', advanced.land_pp_max);
    if (advanced.gross_pp_min) params.set('gross_pp_min', advanced.gross_pp_min);
    if (advanced.gross_pp_max) params.set('gross_pp_max', advanced.gross_pp_max);
    if (advanced.land_area_min) params.set('land_area_min', advanced.land_area_min);
    if (advanced.land_area_max) params.set('land_area_max', advanced.land_area_max);
    if (advanced.gross_area_min) params.set('gross_area_min', advanced.gross_area_min);
    if (advanced.gross_area_max) params.set('gross_area_max', advanced.gross_area_max);
    if (advanced.usable_area_min) params.set('usable_area_min', advanced.usable_area_min);
    if (advanced.usable_area_max) params.set('usable_area_max', advanced.usable_area_max);
    if (advanced.building_area_min) params.set('building_area_min', advanced.building_area_min);
    if (advanced.building_area_max) params.set('building_area_max', advanced.building_area_max);
    if (advanced.approval_year_min) params.set('approval_year_min', advanced.approval_year_min);
    if (advanced.road_width_min) params.set('road_width_min', advanced.road_width_min);
    if (advanced.parking_min) params.set('parking_min', advanced.parking_min);
    if (advanced.elevator_option) params.set('elevator_option', advanced.elevator_option);
    const mergedBuildingStatus = (advanced.building_status && advanced.building_status !== '전체')
        ? advanced.building_status
        : (category || '');
    params.set('building_status', mergedBuildingStatus);
    if (advanced.violation_option && advanced.violation_option !== '전체') {
        params.set('violation_flag', String(advanced.violation_option).toUpperCase());
    }
    if (advanced.location_decide) params.set('location_decide', advanced.location_decide);
    if (advanced.price_decide) params.set('price_decide', advanced.price_decide);
    if (advanced.yield_decide) params.set('yield_decide', advanced.yield_decide);
    if (advanced.vacancy_decide) params.set('vacancy_decide', advanced.vacancy_decide);
    if (advanced.limit_decide) params.set('limit_decide', advanced.limit_decide);
    if (advanced.loan_decide) params.set('loan_decide', advanced.loan_decide);
    if (advanced.types) params.set('types', advanced.types);
    if (advanced.zoning_categories) params.set('zoning_categories', advanced.zoning_categories);
    if (advanced.usage_categories) params.set('usage_categories', advanced.usage_categories);

    try {
        const res = await fetch(`/api/insight/overview?${params.toString()}`);
        const data = await res.json();
        loading.classList.add('hidden');

        const items = Array.isArray(data?.buildings) ? data.buildings : [];
        if (!items.length) {
            updateMainSearchMapItems([]);
            document.getElementById("totalCount").innerText = "전체: 0건";
            list.innerHTML = '<div class="text-center text-slate-400 py-20">검색 결과가 없습니다.</div>';
            return;
        }

        currentBuildingTotalPages = Number(data?.buildings_total_pages || 0);
        renderBuildingCards(items);
        renderPagination(page, Number(data?.buildings_total_count || items.length), currentBuildingTotalPages);
    } catch (err) {
        updateMainSearchMapItems([]);
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">데이터를 가져오는데 실패했습니다.</div>';
    }
}

async function searchCustomer(page = 1) {
    const keyword = document.getElementById('addressInput').value.trim();
    const status = document.getElementById('statusSelect')?.value || '';
    const list = document.getElementById('addressList');
    const loading = document.getElementById('loading');
    const pagination = document.getElementById('pagination');
    const safePage = Math.max(1, Number(page) || 1);

    currentAddress = keyword;
    currentcategory = status;

    list.innerHTML = '';
    pagination.innerHTML = '';
    loading.classList.remove('hidden');
    updateMainSearchMapItems([]);
    hasExecutedBuildingSearch = false;

    try {
        const params = new URLSearchParams();
        params.set('q', keyword);
        params.set('page', String(safePage));
        params.set('page_size', String(CUSTOMER_PAGE_SIZE));
        if (status) {
            params.set('status', status);
        }

        const res = await fetch(`/api/customer/search?${params.toString()}`);
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const totalCount = Number(data?.total_count || 0);
        currentCustomerTotalPages = Number(data?.total_pages || 0);
        currentPage = Number(data?.page || safePage);

        loading.classList.add('hidden');
        renderCustomerCards(items);
        renderPagination(currentPage, totalCount, currentCustomerTotalPages);
    } catch (err) {
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">고객 데이터를 불러오는데 실패했습니다.</div>';
    }
}

// 
async function fetchBuildings(page , category) {
    hasExecutedBuildingSearch = true;
    if (hasAdvancedFilters()) {
        await fetchBuildingsAdvanced(page, category);
        return;
    }

    const list = document.getElementById('addressList');
    const loading = document.getElementById('loading');
    const pagination = document.getElementById('pagination');

    list.innerHTML = '';
    pagination.innerHTML = '';
    loading.classList.remove('hidden');
    updateMainSearchMapItems([]);


    try {
        const res = await fetch('/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: currentAddress, page : page , category: category})
        });

        const data = await res.json();
        loading.classList.add('hidden');

        if (!data || data.length === 0) {
            updateMainSearchMapItems([]);
            list.innerHTML = '<div class="text-center text-slate-400 py-20">검색 결과가 없습니다.</div>';
            return;
        }
        currentBuildingTotalPages = null;
        renderBuildingCards(data.slice(1));

        const totalCount = data.length > 0 ? data[0].total_count : 0;
        currentBuildingTotalPages = totalCount > 0 ? Math.ceil(totalCount / BUILDING_PAGE_SIZE) : 0;
        renderPagination(page, totalCount, currentBuildingTotalPages);

    } catch (err) {
        updateMainSearchMapItems([]);
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">데이터를 가져오는데 실패했습니다.</div>';
    }
}

function renderPagination(page , item_count, total_pages = null) {
    const pagination = document.getElementById('pagination');
    const start = Math.floor((page - 1) / pageGroupSize) * pageGroupSize + 1;
    const total_count = item_count;

    if (total_count === 0) {
        document.getElementById("totalCount").innerText = "전체: 0건";
        return;
    }
    const total_count_comma = formatNumberWithComma(total_count)
    document.getElementById("totalCount").innerText = `전체: ${total_count_comma}건`;


    if (start > 1) {
        pagination.innerHTML += `
            <button onclick="goPage(${start - 1})"
                class="px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">
                이전
            </button>
        `;
    }

    const end = total_pages && total_pages > 0
        ? Math.min(start + pageGroupSize - 1, total_pages)
        : start + pageGroupSize - 1;

    for (let i = start; i <= end; i++) {
        const active = i === page
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50';

        pagination.innerHTML += `
            <button onclick="goPage(${i})"
                class="w-10 h-10 border rounded-lg font-medium ${active}">
                ${i}
            </button>
        `;
    }

    if (!total_pages || page < total_pages) {
        pagination.innerHTML += `
            <button onclick="goPage(${start + pageGroupSize})"
                class="px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">
                다음
            </button>
        `;
    }
}

function goPage(p) {
    const totalPages = currentSearchMode === 'customer'
        ? currentCustomerTotalPages
        : currentBuildingTotalPages;
    const safePage = totalPages && totalPages > 0
        ? Math.min(Math.max(1, p), totalPages)
        : Math.max(1, p);
    currentPage = safePage;
    if (currentSearchMode === 'customer') {
        searchCustomer(safePage);
    } else {
        fetchBuildings(safePage,currentcategory);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToDetail(id) {
    const win = window.open(`/detail/${id}`, '_blank');
    // 새 창 로드 후 상태 전달
    win.onload = () => {
        win.sidebarLocked = isLocked;
    };
}

// 새로운 건물 추가
function CreateBuilding(){
    window.open(`/detail/new`, '_blank');
}

// 새로운 고객 추가
function CreateCustomer(){
    window.open(`/customer/new`, '_blank');
}

function goToCustomer(id) {
    window.open(`/customer/${id}`, '_blank');
}

// 콤마 변경 
function formatNumberWithComma(value) {
    if (value === null || value === undefined) return '';

    // 🔑 먼저 문자열로 변환 (number 방어)
    const str = String(value);

    // 숫자가 아닌 문자는 제거
    const number = str.replace(/[^0-9]/g, '');

    // 콤마 추가
    return number.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 블러 여부 
window.isLocked = false;
function syncMainSearchLockState() {
    const searchTypeSelect = document.getElementById('searchTypeSelect');
    const insightBtn = document.getElementById('insightBtn');

    if (searchTypeSelect) {
        searchTypeSelect.classList.toggle('hidden', window.isLocked);
        applySearchTypeSelectTheme(searchTypeSelect);
    }

    if (insightBtn) {
        insightBtn.classList.toggle('hidden', window.isLocked);
    }

    if (window.isLocked) {
        currentSearchMode = 'building';
        if (searchTypeSelect) searchTypeSelect.value = 'building';
        setStatusOptions('building');
        applySearchTypeSelectTheme(searchTypeSelect);
    }
}

function toggleSidebarLock() {
    window.isLocked = !window.isLocked;
    const btn = document.getElementById("lockBtn");
    if (window.isLocked){
        btn.innerText = "🔒 잠금";
    }
    else{
        btn.innerText = "🔓 해제";
    }
    syncMainSearchLockState();
}



// DOM 로드 후 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    initializeAccountMenu();
    loadMainNoticePopup();

    const searchBar = document.getElementById('addressInput')?.parentElement;
    const buildingBtn = searchBar?.querySelector('button[onclick="search()"]');
    const customerBtn = searchBar?.querySelector('button[onclick="searchCustomer()"]');

    if (searchBar && buildingBtn && customerBtn) {
        const searchTypeSelect = document.createElement('select');
        searchTypeSelect.id = 'searchTypeSelect';
        searchTypeSelect.className = 'px-3 py-3 border rounded-xl font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors';

        const buildingOption = document.createElement('option');
        buildingOption.value = 'building';
        buildingOption.textContent = '검색하기';
        buildingOption.selected = true;

        const customerOption = document.createElement('option');
        customerOption.value = 'customer';
        customerOption.textContent = '고객검색';

        searchTypeSelect.appendChild(buildingOption);
        searchTypeSelect.appendChild(customerOption);

        searchBar.insertBefore(searchTypeSelect, buildingBtn);
        searchTypeSelect.addEventListener('change', (e) => {
            currentSearchMode = e.target.value;
            setStatusOptions(currentSearchMode);
            applySearchTypeSelectTheme(e.target);
        });
        applySearchTypeSelectTheme(searchTypeSelect);
        buildingBtn.setAttribute('onclick', 'unifiedSearch()');
        buildingBtn.textContent = '검색';
        customerBtn.classList.add('hidden');
    }

    setStatusOptions('building');
    currentSearchMode = 'building';
    syncMainSearchLockState();

    document.getElementById('addressInput')
        .addEventListener('keydown', e => {
            if (e.key === 'Enter') unifiedSearch();
        });

    const dashboardTitle = document.getElementById('mainDashboardTitle');
    if (dashboardTitle) {
        dashboardTitle.addEventListener('click', () => {
            refreshMainDashboardByTitle();
        });
        dashboardTitle.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            refreshMainDashboardByTitle();
        });
    }

    const advApplyBtn = document.getElementById('advancedFilterApplyBtn');
    if (advApplyBtn) advApplyBtn.addEventListener('click', applyAdvancedFilters);

    const advResetBtn = document.getElementById('advancedFilterResetBtn');
    if (advResetBtn) advResetBtn.addEventListener('click', resetAdvancedFilters);

    document.addEventListener('click', (event) => {
        const panel = document.getElementById('advancedFilterPanel');
        const toggle = document.getElementById('advancedFilterToggle');
        if (!panel || !toggle) return;
        if (panel.classList.contains('-translate-x-full')) return;
        if (panel.contains(event.target) || toggle.contains(event.target)) return;
        closeAdvancedFilterPanel();
    });
});
